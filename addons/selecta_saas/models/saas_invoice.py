# -*- coding: utf-8 -*-
"""Factures d'abonnement et paiements.

Parcours : la structure choisit sa catégorie et son cycle (facture « À payer »), paie par le
moyen indiqué par la plateforme (Mobile Money, virement, lien de paiement en ligne…), déclare
son paiement avec sa référence et un justificatif (« À valider »), puis l'administration
centrale valide (« Payée » : l'abonnement est prolongé) ou refuse en motivant.
"""
from odoo import api, fields, models, _
from odoo.exceptions import UserError

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
    amount = fields.Monetary(required=True)
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

    def _validate(self, method=None, reference=None):
        """Encaissement confirmé : prolonge l'abonnement et applique la catégorie facturée."""
        self.ensure_one()
        if self.state not in ('open', 'pending', 'rejected'):
            raise UserError(_("Cette facture est déjà soldée ou annulée."))
        tenant = self.tenant_id
        tenant.plan_id = self.plan_id
        start, end = tenant._extend_period(self.billing_cycle)
        vals = {'state': 'paid', 'period_start': start, 'period_end': end, 'validated_date': fields.Datetime.now(),
                'validated_by': self.env.uid, 'reject_reason': False}
        if method:
            vals['payment_method'] = method
        if reference:
            vals['payment_reference'] = reference
        self.write(vals)
        self.env['selecta.audit.log']._log('saas.payment.validated', _("Abonnement activé jusqu'au %s",
                                                                      fields.Date.to_string(end.date())),
                                           {'invoice': self.name, 'amount': self.amount, 'plan': self.plan_id.code},
                                           company=self.company_id)

    def _reject(self, reason):
        self.ensure_one()
        if self.state != 'pending':
            raise UserError(_("Seul un paiement déclaré peut être refusé."))
        if len((reason or '').strip()) < 5:
            raise UserError(_("Motivez le refus : la structure verra ce message."))
        self.write({'state': 'rejected', 'reject_reason': reason.strip()[:250]})
        self.env['selecta.audit.log']._log('saas.payment.rejected', _("Paiement refusé (%s)", self.name),
                                           {'invoice': self.name, 'reason': reason}, company=self.company_id)

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
        }
