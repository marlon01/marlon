# -*- coding: utf-8 -*-
"""Factures d'abonnement et paiements.

Parcours : la structure choisit sa catégorie et son cycle (facture « À payer »), paie par le
moyen indiqué par la plateforme (Mobile Money, virement, lien de paiement en ligne…), déclare
son paiement avec sa référence et un justificatif (« À valider »), puis l'administration
centrale valide (« Payée » : l'abonnement est prolongé) ou refuse en motivant.
Avec un prestataire en ligne configuré, le paiement est vérifié auprès du prestataire et la
facture est soldée automatiquement.

Changement de catégorie en cours d'abonnement :
* vers une catégorie supérieure : la valeur non consommée de la période payée est déduite
  (« avoir ») et une nouvelle période démarre à la validation ;
* vers une catégorie inférieure : la nouvelle catégorie s'applique à l'échéance en cours.
"""
import logging
import secrets
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import UserError

from .payment_providers import get_provider

_logger = logging.getLogger(__name__)

PAYMENT_METHODS = [
    ('mobile_money', "Mobile Money"), ('bank_transfer', "Virement bancaire"), ('card', "Carte bancaire / lien en ligne"),
    ('cash', "Espèces / dépôt"), ('manual', "Activation manuelle (plateforme)"),
]
INVOICE_STATES = [
    ('open', "À payer"), ('pending', "Paiement à valider"), ('paid', "Payée"),
    ('rejected', "Paiement refusé"), ('cancelled', "Annulée"),
]


class SelectaSaasInvoice(models.Model):
    _name = 'selecta.saas.invoice'
    _description = "Facture d'abonnement SELECTA"
    _order = 'create_date desc, id desc'

    name = fields.Char(string="Numéro", readonly=True, copy=False, index=True)
    tenant_id = fields.Many2one('selecta.saas.tenant', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='tenant_id.company_id', store=True, index=True)
    plan_id = fields.Many2one('selecta.saas.plan', required=True, ondelete='restrict')
    billing_cycle = fields.Selection([('monthly', "Mensuel"), ('yearly', "Annuel")], required=True)
    currency_id = fields.Many2one('res.currency', required=True)
    amount = fields.Monetary(required=True, string="Montant à régler")
    gross_amount = fields.Monetary(string="Prix de la période")
    credit_amount = fields.Monetary(string="Avoir sur la période en cours")
    prorated = fields.Boolean(help="Changement vers une catégorie supérieure : nouvelle période dès la validation.")
    deferred_plan = fields.Boolean(help="Catégorie inférieure : appliquée au début de la période facturée.")
    plan_applied = fields.Boolean(default=True)
    online_provider = fields.Char(readonly=True)
    online_reference = fields.Char(readonly=True, index=True, copy=False)
    online_session = fields.Char(readonly=True, copy=False)
    online_started = fields.Datetime(readonly=True)
    online_message = fields.Char(readonly=True)
    state = fields.Selection(INVOICE_STATES, default='open', required=True, index=True)
    period_start = fields.Datetime(readonly=True)
    period_end = fields.Datetime(readonly=True)
    payment_method = fields.Selection(PAYMENT_METHODS)
    payment_reference = fields.Char(string="Référence de la transaction")
    payer_phone = fields.Char()
    proof = fields.Binary(string="Justificatif", attachment=True)
    proof_filename = fields.Char()
    declared_date = fields.Datetime(readonly=True)
    declared_by = fields.Many2one('res.users', readonly=True)
    validated_date = fields.Datetime(readonly=True)
    validated_by = fields.Many2one('res.users', readonly=True)
    reject_reason = fields.Char()

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('name'):
                vals['name'] = self.env['ir.sequence'].sudo().next_by_code('selecta.saas.invoice') or '/'
        return super().create(vals_list)

    # ------------------------------------------------------------------ transitions
    def _declare(self, method, reference, phone=None, proof=None, proof_filename=None):
        self.ensure_one()
        if self.state not in ('open', 'rejected'):
            raise UserError(_("Cette facture n'attend pas de paiement."))
        if method not in dict(PAYMENT_METHODS) or method == 'manual':
            raise UserError(_("Moyen de paiement invalide."))
        if not (reference or '').strip():
            raise UserError(_("Indiquez la référence de la transaction (fournie par votre opérateur ou votre banque)."))
        self.write({
            'state': 'pending', 'payment_method': method, 'payment_reference': reference.strip()[:120],
            'payer_phone': (phone or '').strip()[:40] or False, 'proof': proof or False,
            'proof_filename': (proof_filename or '')[:120] or False, 'declared_date': fields.Datetime.now(),
            'declared_by': self.env.uid, 'reject_reason': False,
        })
        self.env['selecta.audit.log']._log('saas.payment.declared', _("Paiement déclaré pour la facture %s", self.name),
                                           {'invoice': self.name, 'amount': self.amount, 'method': method},
                                           company=self.company_id)
        self.env['selecta.saas.mail']._notify_platform('payment_declared', tenant=self.tenant_id, values={
            'invoice': self, 'method_label': dict(PAYMENT_METHODS)[method],
            'subject': _("Paiement à valider : %(c)s (%(n)s)", c=self.company_id.name, n=self.name)})

    def _validate(self, method=None, reference=None):
        """Encaissement confirmé : prolonge l'abonnement et applique la catégorie facturée."""
        self.ensure_one()
        if self.state not in ('open', 'pending', 'rejected'):
            raise UserError(_("Cette facture est déjà soldée ou annulée."))
        tenant = self.tenant_id
        if self.prorated:
            start, end = tenant._start_new_period(self.billing_cycle)
        else:
            start, end = tenant._extend_period(self.billing_cycle)
        apply_now = not self.deferred_plan or start <= fields.Datetime.now()
        if apply_now:
            tenant.plan_id = self.plan_id
        vals = {'state': 'paid', 'period_start': start, 'period_end': end, 'validated_date': fields.Datetime.now(),
                'validated_by': self.env.uid, 'reject_reason': False, 'plan_applied': apply_now}
        if method:
            vals['payment_method'] = method
        if reference:
            vals['payment_reference'] = reference
        self.write(vals)
        self.env['selecta.audit.log']._log('saas.payment.validated', _("Abonnement activé jusqu'au %s",
                                                                      fields.Date.to_string(end.date())),
                                           {'invoice': self.name, 'amount': self.amount, 'plan': self.plan_id.code},
                                           company=self.company_id)
        self.env['selecta.saas.mail']._queue('payment_validated', tenant=tenant, values={
            'invoice': self, 'subject': _("Paiement reçu — abonnement actif jusqu'au %s",
                                          fields.Date.to_string(end.date()))})

    @api.model
    def _cron_apply_deferred_plans(self):
        """Applique les catégories inférieures choisies en cours d'abonnement au début de leur période."""
        for inv in self.sudo().search([('state', '=', 'paid'), ('plan_applied', '=', False),
                                       ('period_start', '<=', fields.Datetime.now())]):
            inv.tenant_id.plan_id = inv.plan_id
            inv.plan_applied = True
            self.env['selecta.audit.log']._log('saas.plan', _("Nouvelle catégorie appliquée : %s", inv.plan_id.name),
                                               {'invoice': inv.name}, company=inv.company_id)

    def _reject(self, reason):
        self.ensure_one()
        if self.state != 'pending':
            raise UserError(_("Seul un paiement déclaré peut être refusé."))
        if len((reason or '').strip()) < 5:
            raise UserError(_("Motivez le refus : la structure verra ce message."))
        self.write({'state': 'rejected', 'reject_reason': reason.strip()[:250]})
        self.env['selecta.audit.log']._log('saas.payment.rejected', _("Paiement refusé (%s)", self.name),
                                           {'invoice': self.name, 'reason': reason}, company=self.company_id)
        self.env['selecta.saas.mail']._queue('payment_rejected', tenant=self.tenant_id, values={
            'invoice': self, 'subject': _("Paiement non validé — facture %s", self.name)})

    # ------------------------------------------------------------------ paiement en ligne
    def _online_start(self, provider_code, base_url):
        """Ouvre une transaction chez le prestataire et retourne l'URL de paiement."""
        self.ensure_one()
        if self.state not in ('open', 'rejected'):
            raise UserError(_("Cette facture n'attend pas de paiement."))
        provider = get_provider(self.env, provider_code)
        if not provider or not provider.enabled():
            raise UserError(_("Ce moyen de paiement en ligne n'est pas disponible."))
        if self.amount <= 0:
            raise UserError(_("Montant nul : aucune transaction à régler."))
        # Référence unique par tentative : une transaction abandonnée ne bloque jamais la suivante.
        reference = '%s-%s' % (self.name, secrets.token_hex(4).upper())
        self.write({'online_provider': provider.code, 'online_reference': reference, 'online_session': False,
                    'online_started': fields.Datetime.now(), 'online_message': False})
        return_url = '%s/selecta/saas/pay/return?ref=%s' % (base_url, reference)
        notify_url = '%s/selecta/saas/pay/notify/%s' % (base_url, provider.code)
        url = provider.start(self, reference, return_url, notify_url)
        self.env['selecta.audit.log']._log('saas.payment.online', _("Paiement en ligne initié (%s)", provider.label),
                                           {'invoice': self.name, 'reference': reference}, company=self.company_id)
        return url

    def _online_check(self):
        """Interroge le prestataire ; solde la facture si le paiement est confirmé. Retourne l'état."""
        self.ensure_one()
        if self.state == 'paid':
            return 'paid'
        if not self.online_reference or self.state not in ('open', 'rejected'):
            return 'none'
        provider = get_provider(self.env, self.online_provider)
        if not provider:
            return 'none'
        status, provider_ref, detail = provider.check(self)
        if status == 'paid':
            self._validate(method=provider.method, reference=provider_ref or self.online_reference)
            self.online_message = False
        else:
            self.online_message = (detail or '')[:200] or False
        return status

    @api.model
    def _cron_check_online(self):
        """Filet de sécurité : rattrape les notifications perdues (transactions de moins de 48 h)."""
        since = fields.Datetime.now() - timedelta(hours=48)
        for inv in self.sudo().search([('state', 'in', ('open', 'rejected')), ('online_reference', '!=', False),
                                       ('online_started', '>=', since)], limit=100):
            try:
                with self.env.cr.savepoint():
                    inv._online_check()
            except Exception as exc:  # noqa: BLE001 - une facture en erreur ne bloque pas les autres
                _logger.warning("SELECTA SaaS : vérification du paiement %s impossible : %s", inv.name, exc)

    def _cancel(self):
        for inv in self:
            if inv.state not in ('open', 'pending', 'rejected'):
                raise UserError(_("Une facture payée ne peut pas être annulée."))
        self.write({'state': 'cancelled'})

    def _as_dict(self):
        self.ensure_one()
        return {
            'id': self.id, 'name': self.name, 'state': self.state, 'state_label': dict(INVOICE_STATES)[self.state],
            'tenant_id': self.tenant_id.id, 'tenant': self.tenant_id.company_id.name,
            'plan': self.plan_id.name, 'plan_id': self.plan_id.id, 'billing_cycle': self.billing_cycle,
            'amount': self.amount, 'currency': self.currency_id.name, 'symbol': self.currency_id.symbol,
            'period_start': fields.Datetime.to_string(self.period_start) if self.period_start else False,
            'period_end': fields.Datetime.to_string(self.period_end) if self.period_end else False,
            'payment_method': self.payment_method or False,
            'payment_method_label': dict(PAYMENT_METHODS).get(self.payment_method, ''),
            'payment_reference': self.payment_reference or '', 'payer_phone': self.payer_phone or '',
            'has_proof': bool(self.proof), 'proof_filename': self.proof_filename or '',
            'date': fields.Datetime.to_string(self.create_date),
            'declared_date': fields.Datetime.to_string(self.declared_date) if self.declared_date else False,
            'validated_date': fields.Datetime.to_string(self.validated_date) if self.validated_date else False,
            'reject_reason': self.reject_reason or '',
            'gross_amount': self.gross_amount or self.amount, 'credit_amount': self.credit_amount,
            'prorated': self.prorated, 'deferred_plan': self.deferred_plan, 'plan_applied': self.plan_applied,
            'online_provider': self.online_provider or False, 'online_message': self.online_message or '',
        }
