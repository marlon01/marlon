# -*- coding: utf-8 -*-
"""Espace « Abonnement » de chaque structure (console OWL) : état, consommation, factures."""
import base64
import binascii

from odoo import api, fields, models, _
from odoo.exceptions import UserError

from odoo.addons.selecta_concours.models.selecta_concours import G_ADMIN, require_group

from .payment_providers import enabled_providers
from .saas_invoice import PAYMENT_METHODS
from .saas_mail import fmt_amount

PROOF_MAX_BYTES = 5 * 1024 * 1024
PROOF_TYPES = (b'%PDF', b'\x89PNG', b'\xff\xd8\xff', b'RIFF')  # PDF, PNG, JPEG, WebP


class SelectaBackoffice(models.AbstractModel):
    _inherit = 'selecta.backoffice'

    @api.model
    def session_info(self):
        info = super().session_info()
        tenant = self.env.company._selecta_tenant()
        info['saas'] = tenant._summary() if tenant else False
        info['is_platform'] = self.env.user.has_group('selecta_saas.group_platform_admin')
        return info

    def _tenant(self):
        tenant = self.env.company._selecta_tenant()
        if not tenant:
            raise UserError(_("Cette structure n'est pas soumise à abonnement."))
        return tenant

    @api.model
    def billing_info(self):
        require_group(self.env, G_ADMIN)
        tenant = self._tenant()
        icp = self.env['ir.config_parameter'].sudo()
        Invoice = self.env['selecta.saas.invoice'].sudo()
        return {
            'tenant': tenant._summary(),
            'usage': tenant._usage(),
            'limits': tenant._limits(),
            'plans': [p._public_dict() for p in self.env['selecta.saas.plan'].sudo().search([])],
            'invoices': [i._as_dict() for i in Invoice.search([('tenant_id', '=', tenant.id)], limit=50)],
            'methods': [{'key': k, 'label': v} for k, v in PAYMENT_METHODS if k != 'manual'],
            'online_providers': [{'code': p.code, 'label': p.label} for p in enabled_providers(self.env)],
            'payment_instructions': icp.get_param('selecta_saas.payment_instructions') or '',
            'payment_link': icp.get_param('selecta_saas.payment_link') or '',
            'support_email': icp.get_param('selecta_saas.support_email') or '',
            'support_phone': icp.get_param('selecta_saas.support_phone') or '',
            'issuer': {'name': icp.get_param('selecta_saas.issuer_name') or 'Naxoris',
                       'details': icp.get_param('selecta_saas.issuer_details') or ''},
            'customer': {'name': tenant.company_id.name, 'contact': tenant.contact_name or '',
                         'email': tenant.email or '', 'phone': tenant.phone or '',
                         'country': (tenant.country_id.with_context(lang='fr_FR') if self.env['res.lang']._lang_get('fr_FR')
                                     else tenant.country_id).name or ''},
        }

    @api.model
    def billing_checkout(self, plan_id, cycle):
        """Crée (ou remplace) la facture à payer pour la catégorie et le cycle choisis."""
        require_group(self.env, G_ADMIN)
        tenant = self._tenant()
        if tenant._access() == 'blocked':
            raise UserError(_("Compte suspendu : contactez le support SELECTA."))
        if cycle not in ('monthly', 'yearly'):
            raise UserError(_("Cycle de facturation invalide."))
        plan = self.env['selecta.saas.plan'].sudo().browse(int(plan_id)).exists()
        if not plan or not plan.active:
            raise UserError(_("Catégorie indisponible."))
        Invoice = self.env['selecta.saas.invoice'].sudo()
        if Invoice.search_count([('tenant_id', '=', tenant.id), ('state', '=', 'pending')]):
            raise UserError(_("Un paiement est déjà en cours de validation. Patientez ou annulez-le avant d'en "
                              "déclarer un autre."))
        quote = tenant._quote(plan, cycle)
        if quote['prorated'] and quote['credit'] >= quote['gross'] and cycle == 'monthly':
            raise UserError(_("La valeur restante de votre abonnement dépasse le prix d'un mois de cette catégorie : "
                              "choisissez le cycle annuel pour en bénéficier pleinement."))
        Invoice.search([('tenant_id', '=', tenant.id), ('state', 'in', ('open', 'rejected'))])._cancel()
        inv = Invoice.create({
            'tenant_id': tenant.id, 'plan_id': plan.id, 'billing_cycle': cycle,
            'currency_id': plan.currency_id.id, 'amount': quote['amount'], 'gross_amount': quote['gross'],
            'credit_amount': quote['credit'], 'prorated': quote['prorated'], 'deferred_plan': quote['deferred'],
        })
        if inv.amount <= 0:
            inv._validate(method='manual', reference=_("Avoir sur la période en cours"))
            return inv._as_dict()
        icp = self.env['ir.config_parameter'].sudo()
        self.env['selecta.saas.mail']._queue('invoice_issued', tenant=tenant, values={
            'invoice': inv, 'online': bool(enabled_providers(self.env)),
            'instructions': icp.get_param('selecta_saas.payment_instructions') or '',
            'subject': _("Facture %(n)s — %(a)s", n=inv.name, a=fmt_amount(inv.amount))})
        self.env['selecta.audit.log']._log('saas.checkout', _("Facture %(n)s : %(p)s (%(c)s)", n=inv.name, p=plan.name,
                                                               c=dict(inv._fields['billing_cycle'].selection)[cycle]),
                                           {'invoice': inv.name, 'amount': inv.amount})
        return inv._as_dict()

    @api.model
    def billing_quote(self, plan_id, cycle):
        """Prévisualisation du montant (avoir déduit, report d'une catégorie inférieure)."""
        require_group(self.env, G_ADMIN)
        tenant = self._tenant()
        plan = self.env['selecta.saas.plan'].sudo().browse(int(plan_id)).exists()
        if not plan or cycle not in ('monthly', 'yearly'):
            raise UserError(_("Catégorie ou cycle invalide."))
        quote = tenant._quote(plan, cycle)
        quote['period_end'] = fields.Datetime.to_string(tenant.period_end) if tenant.period_end else False
        return quote

    @api.model
    def billing_pay_online(self, invoice_id, provider):
        """Ouvre une transaction chez le prestataire ; le navigateur est ensuite redirigé vers sa page."""
        require_group(self.env, G_ADMIN)
        inv = self._own_invoice(invoice_id)
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '').rstrip('/')
        return {'url': inv._online_start(provider, base_url)}

    @api.model
    def billing_check_online(self, invoice_id):
        require_group(self.env, G_ADMIN)
        inv = self._own_invoice(invoice_id)
        status = inv._online_check()
        return {'status': status, 'info': self.billing_info()}

    def _own_invoice(self, invoice_id):
        inv = self.env['selecta.saas.invoice'].sudo().browse(int(invoice_id)).exists()
        if not inv or inv.company_id != self.env.company:
            raise UserError(_("Facture introuvable."))
        return inv

    @api.model
    def billing_declare(self, invoice_id, method, reference, phone='', proof_data=None, proof_name=''):
        require_group(self.env, G_ADMIN)
        inv = self._own_invoice(invoice_id)
        proof = False
        if proof_data:
            try:
                raw = base64.b64decode(proof_data.split(',', 1)[-1], validate=True)
            except (binascii.Error, ValueError):
                raise UserError(_("Justificatif illisible."))
            if len(raw) > PROOF_MAX_BYTES:
                raise UserError(_("Le justificatif dépasse 5 Mo."))
            if not raw.startswith(PROOF_TYPES):
                raise UserError(_("Justificatif accepté : PDF, PNG, JPEG ou WebP."))
            proof = base64.b64encode(raw)
        inv._declare(method, reference, phone=phone, proof=proof, proof_filename=proof_name)
        return self.billing_info()

    @api.model
    def billing_cancel(self, invoice_id):
        require_group(self.env, G_ADMIN)
        self._own_invoice(invoice_id)._cancel()
        return self.billing_info()
