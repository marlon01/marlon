# -*- coding: utf-8 -*-
"""Courriels de la plateforme (inscription, rappels d'échéance, factures, paiements).

Les messages sont d'abord mis en file puis envoyés par une tâche planifiée : une panne du
serveur SMTP ne bloque jamais une inscription ou un paiement, et chaque envoi est tracé.
Le serveur SMTP est celui d'Odoo (``ir.mail_server`` de plus haute priorité, sinon les
options ``smtp_*`` du fichier de configuration).
"""
import logging
from datetime import timedelta

from markupsafe import Markup

from odoo import api, fields, models, tools, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5
TEMPLATES = {
    'signup_welcome': "Bienvenue sur SELECTA",
    'platform_new_signup': "Nouvelle structure inscrite",
    'trial_reminder': "Rappel de fin d'essai",
    'trial_expired': "Fin de l'essai gratuit",
    'renewal_reminder': "Rappel de renouvellement",
    'subscription_expired': "Abonnement échu",
    'invoice_issued': "Facture émise",
    'payment_declared': "Paiement déclaré (plateforme)",
    'payment_validated': "Paiement validé",
    'payment_rejected': "Paiement refusé",
    'account_suspended': "Compte suspendu",
    'account_reactivated': "Compte réactivé",
    'test': "Message de test",
}


class SelectaSaasMail(models.Model):
    _name = 'selecta.saas.mail'
    _description = "Courriel de la plateforme SELECTA"
    _order = 'create_date desc, id desc'

    template = fields.Selection(list(TEMPLATES.items()), required=True)
    tenant_id = fields.Many2one('selecta.saas.tenant', ondelete='cascade', index=True)
    email_to = fields.Char(required=True)
    subject = fields.Char(required=True)
    body_html = fields.Html(sanitize=False)
    state = fields.Selection([('queued', "En file"), ('sent', "Envoyé"), ('failed', "Échec"), ('cancelled', "Annulé")],
                             default='queued', required=True, index=True)
    attempts = fields.Integer()
    last_error = fields.Char()
    sent_date = fields.Datetime()
    dedupe_key = fields.Char(index=True, help="Empêche l'envoi en double d'un même rappel.")

    _sql_constraints = [('dedupe_unique', 'unique(dedupe_key)', "Ce message a déjà été émis.")]

    # ------------------------------------------------------------------ mise en file
    @api.model
    def _setting(self, key, default=''):
        return self.env['ir.config_parameter'].sudo().get_param('selecta_saas.%s' % key) or default

    @api.model
    def _context_values(self, tenant=None, values=None):
        icp = self.env['ir.config_parameter'].sudo()
        base_url = (icp.get_param('web.base.url') or '').rstrip('/')
        return dict(values or {}, tenant=tenant, company=tenant.company_id if tenant else None,
                    base_url=base_url, platform=self._setting('issuer_name', 'Naxoris'),
                    support_email=self._setting('support_email'), support_phone=self._setting('support_phone'),
                    fmt_date=lambda d: d and tools.format_date(self.env, d, lang_code='fr_FR', date_format='d MMMM y') or '',
                    fmt_amount=lambda a, cur='$': ('{:,.2f}'.format(a or 0).replace(',', ' ').replace('.', ',')
                                                   .replace(',00', '') + ' ' + cur))

    @api.model
    def _queue(self, template, tenant=None, to=None, values=None, dedupe_key=None):
        """Prépare un courriel (rendu immédiat, envoi différé). Retourne l'enregistrement ou un vide."""
        to = to or (tenant and (tenant.email or tenant.owner_id.email))
        if not to:
            return self.browse()
        if dedupe_key and self.sudo().search_count([('dedupe_key', '=', dedupe_key)]):
            return self.browse()
        ctx = self._context_values(tenant, values)
        body = self.env['ir.qweb'].sudo()._render('selecta_saas.mail_%s' % template, ctx)
        subject = (values or {}).get('subject') or ctx.get('subject') or TEMPLATES[template]
        html = self.env['ir.qweb'].sudo()._render('selecta_saas.mail_layout', dict(ctx, body=Markup(body), subject=subject))
        mail = self.sudo().create({
            'template': template, 'tenant_id': tenant.id if tenant else False, 'email_to': to,
            'subject': subject, 'body_html': html, 'dedupe_key': dedupe_key or False,
        })
        cron = self.env.ref('selecta_saas.cron_saas_mail', raise_if_not_found=False)
        if cron:
            cron.sudo()._trigger()
        return mail

    @api.model
    def _notify_platform(self, template, tenant=None, values=None, dedupe_key=None):
        to = self._setting('platform_notify_email') or self._setting('support_email')
        return self._queue(template, tenant=tenant, to=to, values=values, dedupe_key=dedupe_key) if to else self.browse()

    # ------------------------------------------------------------------ envoi
    @api.model
    def _enabled(self):
        return self._setting('mail_enabled') in ('True', 'true', '1')

    def _send_now(self):
        IrMail = self.env['ir.mail_server'].sudo()
        email_from = self._setting('mail_from') or tools.config.get('email_from') or 'noreply@localhost'
        for mail in self:
            try:
                msg = IrMail.build_email(
                    email_from, [mail.email_to], mail.subject, mail.body_html, subtype='html',
                    body_alternative=tools.html2plaintext(mail.body_html or ''))
                IrMail.send_email(msg)
                mail.write({'state': 'sent', 'sent_date': fields.Datetime.now(), 'last_error': False,
                            'attempts': mail.attempts + 1})
            except Exception as exc:  # noqa: BLE001 - toute erreur SMTP est consignée puis retentée
                attempts = mail.attempts + 1
                # MailDeliveryException porte (titre, détail) : seul le détail est utile à l'opérateur.
                detail = exc.args[-1] if len(exc.args) > 1 else exc
                mail.write({'attempts': attempts, 'last_error': str(detail)[:250],
                            'state': 'failed' if attempts >= MAX_ATTEMPTS else 'queued'})
                _logger.warning("SELECTA SaaS : échec d'envoi du courriel %s à %s : %s", mail.id, mail.email_to, exc)

    @api.model
    def _cron_send(self):
        if not self._enabled():
            return
        # Les messages trop anciens (plus d'une semaine) ne sont plus pertinents.
        stale = fields.Datetime.now() - timedelta(days=7)
        self.sudo().search([('state', '=', 'queued'), ('create_date', '<', stale)]).write({'state': 'cancelled'})
        batch = self.sudo().search([('state', '=', 'queued')], order='id', limit=50)
        for mail in batch:
            mail._send_now()
            self.env.cr.commit()  # un échec ultérieur n'annule pas les envois déjà faits

    # ------------------------------------------------------------------ test de configuration
    @api.model
    def _send_test(self, to):
        if not to or '@' not in to:
            raise UserError(_("Indiquez une adresse e-mail de destination."))
        mail = self._queue('test', to=to, values={'subject': _("SELECTA : test d'envoi")})
        mail._send_now()
        if mail.state != 'sent':
            raise UserError(_("Échec de l'envoi : %s", mail.last_error or _("erreur inconnue")))
        return True

    def _as_dict(self):
        self.ensure_one()
        return {'id': self.id, 'template': self.template, 'label': TEMPLATES.get(self.template, self.template),
                'email_to': self.email_to, 'subject': self.subject, 'state': self.state,
                'attempts': self.attempts, 'last_error': self.last_error or '',
                'date': fields.Datetime.to_string(self.create_date),
                'sent_date': fields.Datetime.to_string(self.sent_date) if self.sent_date else False}
