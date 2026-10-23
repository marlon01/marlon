# -*- coding: utf-8 -*-
"""API de l'administration centrale (console OWL /selecta/platform).

Réservée au groupe « Administrateur de la plateforme ». Les lectures inter-structures passent
par ``sudo`` après ce contrôle explicite : aucune structure cliente ne peut atteindre ces méthodes.
"""
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

from .payment_providers import PROVIDERS
from .saas_invoice import PAYMENT_METHODS
from .saas_plan import FEATURES
from .saas_tenant import STATES

G_PLATFORM = 'selecta_saas.group_platform_admin'
SETTINGS = {
    'trial_days': ('selecta_saas.trial_days', int, 14),
    'grace_days': ('selecta_saas.grace_days', int, 3),
    'trial_max_candidates': ('selecta_saas.trial_max_candidates', int, 100),
    'signup_enabled': ('selecta_saas.signup_enabled', bool, True),
    'payment_instructions': ('selecta_saas.payment_instructions', str, ''),
    'payment_link': ('selecta_saas.payment_link', str, ''),
    'support_email': ('selecta_saas.support_email', str, ''),
    'support_phone': ('selecta_saas.support_phone', str, ''),
    'issuer_name': ('selecta_saas.issuer_name', str, 'Naxoris'),
    'issuer_details': ('selecta_saas.issuer_details', str, ''),
    'mail_enabled': ('selecta_saas.mail_enabled', bool, False),
    'mail_from': ('selecta_saas.mail_from', str, ''),
    'platform_notify_email': ('selecta_saas.platform_notify_email', str, ''),
    'cinetpay_enabled': ('selecta_saas.cinetpay_enabled', bool, False),
    'cinetpay_site_id': ('selecta_saas.cinetpay_site_id', str, ''),
    'stripe_enabled': ('selecta_saas.stripe_enabled', bool, False),
    'flexpay_enabled': ('selecta_saas.flexpay_enabled', bool, False),
    'flexpay_merchant': ('selecta_saas.flexpay_merchant', str, ''),
    'flexpay_environment': ('selecta_saas.flexpay_environment', str, 'prod'),
    'biometric_retention_days': ('selecta.biometric_retention_days', int, 180),
    # Envoi des codes d'accès aux candidats (SMS, WhatsApp) : lus par selecta.messaging.
    'msg_provider': ('selecta.msg.provider', str, 'none'),
    'msg_username': ('selecta.msg.username', str, ''),
    'msg_account_sid': ('selecta.msg.account_sid', str, ''),
    'msg_sms_from': ('selecta.msg.sms_from', str, ''),
    'msg_whatsapp_from': ('selecta.msg.whatsapp_from', str, ''),
    'terms_text': ('selecta_saas.terms_text', str, ''),
    'privacy_text': ('selecta_saas.privacy_text', str, ''),
    'legal_updated': ('selecta_saas.legal_updated', str, ''),
}
# Secrets : jamais renvoyés au navigateur ; seule leur présence est signalée.
SECRETS = {
    'cinetpay_api_key': 'selecta_saas.cinetpay_api_key',
    'stripe_secret_key': 'selecta_saas.stripe_secret_key',
    'flexpay_token': 'selecta_saas.flexpay_token',
    'msg_api_key': 'selecta.msg.api_key',
}
SMTP_FIELDS = ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_encryption')
PLAN_FIELDS = ['name', 'code', 'sequence', 'active', 'audience', 'description', 'highlight', 'price_monthly',
               'price_yearly', 'max_active_concours', 'max_candidates_month', 'max_staff', 'support'] + \
              ['feature_%s' % f for f in FEATURES]


def _dt(value):
    return fields.Datetime.to_string(value) if value else False


def read_setting(env, key):
    param, cast, default = SETTINGS[key]
    raw = env['ir.config_parameter'].sudo().get_param(param)
    if raw in (None, False, ''):
        return default
    if cast is bool:
        return raw in ('True', 'true', '1')
    if cast is int:
        try:
            return int(raw)
        except ValueError:
            return default
    return raw


class SelectaSaasPlatform(models.AbstractModel):
    _name = 'selecta.saas.platform'
    _description = "API de l'administration centrale SELECTA"

    def _require(self):
        if not self.env.user.has_group(G_PLATFORM):
            raise AccessError(_("Accès réservé à l'administration centrale de la plateforme."))

    # ------------------------------------------------------------------ session
    @api.model
    def session_info(self):
        self._require()
        user = self.env.user
        return {'uid': user.id, 'name': user.name, 'login': user.login,
                'platform_name': read_setting(self.env, 'issuer_name'),
                'states': dict(STATES), 'methods': dict(PAYMENT_METHODS), 'features': FEATURES}

    # ------------------------------------------------------------------ vue d'ensemble
    @api.model
    def overview(self):
        self._require()
        Tenant = self.env['selecta.saas.tenant'].sudo()
        Invoice = self.env['selecta.saas.invoice'].sudo()
        tenants = Tenant.search([])
        now = fields.Datetime.now()
        by_state = {k: 0 for k, _l in STATES}
        mrr = 0.0
        by_plan = {}
        for t in tenants:
            state = t._effective_state()
            by_state[state] += 1
            plan = by_plan.setdefault(t.plan_id.id, {'name': t.plan_id.name, 'count': 0, 'paying': 0})
            plan['count'] += 1
            if state in ('active', 'past_due'):
                plan['paying'] += 1
                mrr += t.plan_id.price_yearly / 12.0 if t.billing_cycle == 'yearly' else t.plan_id.price_monthly
        # Séries : inscriptions par semaine (12 semaines) et encaissements par mois (12 mois).
        week0 = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        weeks = [week0 - timedelta(weeks=i) for i in range(11, -1, -1)]
        signups = []
        for start in weeks:
            end = start + timedelta(weeks=1)
            signups.append({'label': start.strftime('%d/%m'),
                            'value': Tenant.search_count([('create_date', '>=', start), ('create_date', '<', end)])})
        month0 = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        months = [month0 - relativedelta(months=i) for i in range(11, -1, -1)]
        revenue = []
        for start in months:
            end = start + relativedelta(months=1)
            paid = Invoice.search([('state', '=', 'paid'), ('validated_date', '>=', start), ('validated_date', '<', end)])
            revenue.append({'label': start.strftime('%m/%Y'), 'value': round(sum(paid.mapped('amount')), 2)})
        trials_total = Tenant.search_count([])
        converted = Tenant.search_count([('period_end', '!=', False)])
        soon = tenants.filtered(lambda t: t._effective_state() == 'trial' and t.trial_end <= now + timedelta(days=3))
        return {
            'kpi': {
                'tenants': len(tenants), 'trial': by_state['trial'], 'active': by_state['active'],
                'past_due': by_state['past_due'], 'expired': by_state['expired'], 'suspended': by_state['suspended'],
                'mrr': round(mrr, 2), 'arr': round(mrr * 12, 2),
                'pending_payments': Invoice.search_count([('state', '=', 'pending')]),
                'conversion': round(100.0 * converted / trials_total, 1) if trials_total else 0.0,
                'revenue_month': revenue[-1]['value'],
                'candidates': self.env['selecta.candidate'].sudo().search_count([]),
                'concours': self.env['selecta.concours'].sudo().search_count([]),
            },
            'currency': self.env.ref('base.USD').symbol,
            'signups': signups, 'revenue': revenue,
            'by_plan': sorted(by_plan.values(), key=lambda p: -p['count']),
            'trials_ending': [self._tenant_row(t) for t in soon[:10]],
            'recent': [self._tenant_row(t) for t in tenants[:8]],
        }

    # ------------------------------------------------------------------ structures
    def _tenant_row(self, t):
        summary = t._summary()
        summary.update({
            'plan_name': t.plan_id.name, 'plan_id': t.plan_id.id, 'contact_name': t.contact_name or '',
            'email': t.email or '', 'phone': t.phone or '', 'country': t.country_id.name or '',
            'created': _dt(t.create_date), 'suspended_reason': t.suspended_reason or '',
        })
        return summary

    @api.model
    def tenants_list(self, search='', state='', plan_id=False):
        self._require()
        domain = []
        if search:
            domain += ['|', '|', ('name', 'ilike', search), ('email', 'ilike', search), ('contact_name', 'ilike', search)]
        if plan_id:
            domain.append(('plan_id', '=', int(plan_id)))
        rows = [self._tenant_row(t) for t in self.env['selecta.saas.tenant'].sudo().search(domain, limit=500)]
        if state:
            rows = [r for r in rows if r['state'] == state]
        return rows

    def _get_tenant(self, tenant_id):
        tenant = self.env['selecta.saas.tenant'].sudo().browse(int(tenant_id)).exists()
        if not tenant:
            raise UserError(_("Structure introuvable."))
        return tenant

    @api.model
    def tenant_get(self, tenant_id):
        self._require()
        t = self._get_tenant(tenant_id)
        from odoo.addons.selecta_concours.models.selecta_backoffice import ROLE_GROUPS, ROLE_LABELS
        staff = self.env['res.users'].sudo().with_context(active_test=False).search([
            ('company_id', '=', t.company_id.id), ('share', '=', False),
            ('groups_id', 'in', [self.env.ref(g).id for g in ROLE_GROUPS.values()])])
        concours = self.env['selecta.concours'].sudo().search([('company_id', '=', t.company_id.id)], limit=20)
        data = self._tenant_row(t)
        data.update({
            'usage': t._usage(), 'limits': t._limits(), 'notes': t.notes or '',
            'signup_ip': t.signup_ip or '', 'owner': t.owner_id.login or '',
            'invoices': [i._as_dict() for i in t.invoice_ids],
            'staff': [{'id': u.id, 'name': u.name, 'login': u.login, 'active': u.active,
                       'role': next((ROLE_LABELS[r] for r in ('admin', 'jury', 'concepteur', 'surveillant')
                                     if u.has_group(ROLE_GROUPS[r])), ''),
                       'login_date': _dt(u.login_date)} for u in staff],
            'concours': [{'id': c.id, 'name': c.name, 'reference': c.reference, 'state': c.state,
                          'candidates': c.candidate_count, 'date_start': _dt(c.date_start)} for c in concours],
            'audit': self.env['selecta.audit.log'].sudo().verify_chain(t.company_id.id),
            'exam_url': '/selecta/exam?org=%s' % t.company_id.id,
            'mails': [m._as_dict() for m in self.env['selecta.saas.mail'].sudo().search(
                [('tenant_id', '=', t.id)], limit=30)],
        })
        return data

    @api.model
    def tenant_action(self, tenant_id, action, params=None):
        self._require()
        params = params or {}
        t = self._get_tenant(tenant_id)
        Log = self.env['selecta.audit.log']
        if action == 'extend_trial':
            days = int(params.get('days') or 0)
            if not 1 <= days <= 90:
                raise UserError(_("Prolongation possible de 1 à 90 jours."))
            base = max(t.trial_end or fields.Datetime.now(), fields.Datetime.now())
            t.write({'trial_end': base + timedelta(days=days), 'state': 'trial' if not t.period_end else t.state})
            Log._log('saas.trial.extend', _("Essai prolongé de %s jour(s)", days), {'days': days}, company=t.company_id)
        elif action == 'suspend':
            reason = (params.get('reason') or '').strip()
            if len(reason) < 5:
                raise UserError(_("Motivez la suspension."))
            t.write({'state': 'suspended', 'suspended_reason': reason[:250]})
            Log._log('saas.suspend', _("Compte suspendu par la plateforme"), {'reason': reason}, company=t.company_id)
            self.env['selecta.saas.mail']._queue('account_suspended', tenant=t, values={
                'subject': _("Votre espace SELECTA est suspendu")})
        elif action == 'reactivate':
            t.write({'state': 'trial', 'suspended_reason': False})
            t.state = t._effective_state()
            Log._log('saas.reactivate', _("Compte réactivé par la plateforme"), {}, company=t.company_id)
            self.env['selecta.saas.mail']._queue('account_reactivated', tenant=t, values={
                'subject': _("Votre espace SELECTA est de nouveau accessible")})
        elif action == 'change_plan':
            plan = self.env['selecta.saas.plan'].sudo().browse(int(params.get('plan_id') or 0)).exists()
            if not plan:
                raise UserError(_("Catégorie introuvable."))
            t.plan_id = plan
            Log._log('saas.plan', _("Catégorie modifiée : %s", plan.name), {'plan': plan.code}, company=t.company_id)
        elif action == 'activate':
            # Encaissement hors plateforme (contrat, bon de commande…) : facture soldée immédiatement.
            cycle = params.get('cycle') if params.get('cycle') in ('monthly', 'yearly') else 'monthly'
            inv = self.env['selecta.saas.invoice'].sudo().create({
                'tenant_id': t.id, 'plan_id': t.plan_id.id, 'billing_cycle': cycle,
                'currency_id': t.plan_id.currency_id.id, 'amount': t.plan_id.price_for(cycle),
            })
            inv._validate(method='manual', reference=(params.get('reference') or '').strip()[:120] or _("Activation manuelle"))
        elif action == 'notes':
            t.notes = params.get('notes') or False
        else:
            raise UserError(_("Action inconnue."))
        return self.tenant_get(t.id)

    # ------------------------------------------------------------------ paiements
    @api.model
    def invoices_list(self, state=''):
        self._require()
        domain = [('state', '=', state)] if state else []
        return [i._as_dict() for i in self.env['selecta.saas.invoice'].sudo().search(domain, limit=500)]

    @api.model
    def invoice_action(self, invoice_id, action, reason=''):
        self._require()
        inv = self.env['selecta.saas.invoice'].sudo().browse(int(invoice_id)).exists()
        if not inv:
            raise UserError(_("Facture introuvable."))
        if action == 'validate':
            inv._validate()
        elif action == 'reject':
            inv._reject(reason)
        elif action == 'cancel':
            inv._cancel()
        else:
            raise UserError(_("Action inconnue."))
        return inv._as_dict()

    # ------------------------------------------------------------------ catégories et tarifs
    @api.model
    def plans_list(self):
        self._require()
        plans = self.env['selecta.saas.plan'].sudo().with_context(active_test=False).search([])
        out = []
        for p in plans:
            d = p._public_dict()
            d.update(active=p.active, sequence=p.sequence, tenant_count=p.tenant_count)
            out.append(d)
        return out

    @api.model
    def plan_save(self, vals):
        self._require()
        clean = {k: vals[k] for k in PLAN_FIELDS if k in vals}
        for k, v in list(vals.get('features', {}).items()):
            if k in FEATURES:
                clean['feature_%s' % k] = bool(v)
        Plan = self.env['selecta.saas.plan'].sudo().with_context(active_test=False)
        if vals.get('id'):
            plan = Plan.browse(int(vals['id']))
            plan.write(clean)
        else:
            plan = Plan.create(clean)
        self.env['selecta.audit.log']._log('saas.plan.save', _("Grille tarifaire : %s", plan.name),
                                           {k: str(v) for k, v in clean.items()})
        return self.plans_list()

    # ------------------------------------------------------------------ paramètres
    def _mail_server(self):
        return self.env['ir.mail_server'].sudo().search([('name', '=', 'SELECTA')], limit=1)

    @api.model
    def settings_get(self):
        self._require()
        data = {key: read_setting(self.env, key) for key in SETTINGS}
        icp = self.env['ir.config_parameter'].sudo()
        data.update({'%s_set' % k: bool(icp.get_param(p)) for k, p in SECRETS.items()})
        server = self._mail_server()
        data.update(smtp_host=server.smtp_host or '', smtp_port=server.smtp_port or 587,
                    smtp_user=server.smtp_user or '', smtp_encryption=server.smtp_encryption or 'starttls',
                    smtp_password_set=bool(server.smtp_pass))
        data['providers'] = {code: {'label': cls.label, 'configured': cls(self.env).configured()}
                             for code, cls in PROVIDERS.items()}
        base_url = (icp.get_param('web.base.url') or '').rstrip('/')
        data['notify_urls'] = {code: '%s/selecta/saas/pay/notify/%s' % (base_url, code) for code in PROVIDERS}
        data['msg_channels'] = self.env['selecta.messaging'].channels()
        data['mail_stats'] = {state: self.env['selecta.saas.mail'].sudo().search_count([('state', '=', state)])
                              for state in ('queued', 'sent', 'failed')}
        return data

    def _save_mail_server(self, vals):
        if not any(k in vals for k in SMTP_FIELDS + ('smtp_password',)):
            return
        server = self._mail_server()
        svals = {'name': 'SELECTA', 'sequence': 1,
                 'smtp_host': (vals.get('smtp_host', server.smtp_host) or '').strip(),
                 'smtp_port': int(vals.get('smtp_port', server.smtp_port) or 587),
                 'smtp_user': (vals.get('smtp_user', server.smtp_user) or '').strip() or False,
                 'smtp_encryption': vals.get('smtp_encryption', server.smtp_encryption) or 'starttls',
                 'smtp_authentication': 'login'}
        if svals['smtp_encryption'] not in ('none', 'starttls', 'ssl'):
            raise UserError(_("Chiffrement SMTP invalide."))
        if vals.get('smtp_password'):
            svals['smtp_pass'] = vals['smtp_password']
        if not svals['smtp_host']:
            if server:
                server.active = False
            return
        if server:
            server.write(dict(svals, active=True))
        else:
            self.env['ir.mail_server'].sudo().create(svals)

    @api.model
    def mail_test(self, email_to):
        self._require()
        return self.env['selecta.saas.mail'].sudo()._send_test((email_to or '').strip())

    @api.model
    def mails_list(self, state=''):
        self._require()
        domain = [('state', '=', state)] if state else []
        return [m._as_dict() for m in self.env['selecta.saas.mail'].sudo().search(domain, limit=200)]

    @api.model
    def mail_retry(self, mail_id):
        self._require()
        mail = self.env['selecta.saas.mail'].sudo().browse(int(mail_id)).exists()
        if mail and mail.state in ('failed', 'cancelled', 'queued'):
            mail.write({'state': 'queued', 'attempts': 0})
            mail._send_now()
        return mail._as_dict() if mail else False

    @api.model
    def settings_save(self, vals):
        self._require()
        icp = self.env['ir.config_parameter'].sudo()
        # La date (version acceptée à l'inscription) ne change que si un texte change réellement.
        if any(k in vals and (vals[k] or '') != (read_setting(self.env, k) or '') for k in ('terms_text', 'privacy_text')):
            vals = dict(vals, legal_updated=fields.Date.to_string(fields.Date.today()))
        else:
            vals = {k: v for k, v in vals.items() if k != 'legal_updated'}
        for key, param in SECRETS.items():
            if vals.get(key):
                icp.set_param(param, str(vals[key]).strip())
        self._save_mail_server(vals)
        for key, (param, cast, _default) in SETTINGS.items():
            if key not in vals:
                continue
            value = vals[key]
            if cast is int:
                value = int(value or 0)
                if value < 0 or (key == 'trial_days' and not 1 <= value <= 90) or \
                        (key == 'biometric_retention_days' and value > 3650):
                    raise UserError(_("Valeur invalide pour %s.", key))
            if key == 'msg_provider' and value not in ('none', 'africastalking', 'twilio'):
                raise UserError(_("Service d'envoi inconnu."))
            if key == 'flexpay_environment' and value not in ('prod', 'dev'):
                raise UserError(_("Environnement FlexPay invalide (prod ou dev)."))
            if key == 'payment_link' and value and not str(value).startswith('https://'):
                raise UserError(_("Le lien de paiement doit commencer par https://"))
            icp.set_param(param, str(value) if cast is not bool else ('True' if value else 'False'))
        self.env['selecta.audit.log']._log('saas.settings', _("Paramètres de la plateforme mis à jour"),
                                           {k: v for k, v in vals.items()
                                            if k in SETTINGS and k not in ('terms_text', 'privacy_text')})
        return self.settings_get()
