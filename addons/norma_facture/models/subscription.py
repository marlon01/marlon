# -*- coding: utf-8 -*-
"""Abonnements : essai gratuit, formule par catégorie d'activité, paiement Mobile Money validé par la plateforme.

Politique commerciale : des prix bas pour équiper le plus grand nombre d'entreprises.
* essai gratuit (14 jours par défaut) avec toutes les fonctions ;
* puis abonnement mensuel ou annuel (2 mois offerts) selon la catégorie ; un établissement inclus,
  chaque établissement supplémentaire au tarif de la formule ;
* échéance dépassée : délai de grâce (5 jours par défaut), puis consultation seule. Les factures déjà émises
  continuent d'être normalisées auprès de la DGI, restent consultables, imprimables et exportables.
"""
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models, _
from odoo.exceptions import UserError

ACCESS_FULL, ACCESS_READONLY = 'full', 'readonly'
MOBILE_METHODS = [
    ('MPESA', 'M-Pesa (Vodacom)'),
    ('ORANGE', 'Orange Money'),
    ('AIRTEL', 'Airtel Money'),
    ('AFRIMONEY', 'Afrimoney'),
    ('VIREMENT', 'Virement bancaire'),
    ('ESPECES', 'Espèces (agence Naxoris)'),
]
DEFAULTS = {
    'norma.trial_days': '14',
    'norma.grace_days': '5',
    'norma.pay_instructions': "M-Pesa : +243 828 317 540 · Orange Money : +243 831 509 420 · "
                              "Bénéficiaire : NAXORIS. Indiquez le nom de votre entreprise en motif.",
}


def setting(env, key, cast=str):
    raw = env['ir.config_parameter'].sudo().get_param(key, DEFAULTS.get(key, ''))
    try:
        return cast(raw)
    except (TypeError, ValueError):
        return cast(DEFAULTS.get(key, '0'))


class NormaPlan(models.Model):
    _name = 'norma.plan'
    _description = "Formule d'abonnement"
    _order = 'sequence, price_month'

    category_id = fields.Many2one('norma.category', required=True, ondelete='cascade')
    name = fields.Char(required=True)
    price_month = fields.Float("Prix mensuel (USD)", digits=(10, 2), required=True)
    price_year = fields.Float("Prix annuel (USD)", digits=(10, 2), required=True)
    sites_included = fields.Integer("Établissements inclus", default=1)
    extra_site_price = fields.Float("Établissement supplémentaire (USD / mois)", digits=(10, 2), default=3)
    users_included = fields.Integer("Utilisateurs inclus (0 = illimité)", default=0)
    highlight = fields.Char("Argument")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _sql_constraints = [('category_unique', 'unique(category_id)', "Une seule formule par catégorie.")]

    def _public_dict(self):
        return [{'id': p.id, 'name': p.name, 'category': p.category_id.code, 'category_name': p.category_id.name,
                 'price_month': p.price_month, 'price_year': p.price_year, 'sites_included': p.sites_included,
                 'extra_site_price': p.extra_site_price, 'users_included': p.users_included,
                 'highlight': p.highlight or '', 'active': p.active} for p in self]


class ResCompany(models.Model):
    _inherit = 'res.company'

    norma_trial_end = fields.Datetime("Fin de l'essai")
    norma_period_end = fields.Datetime("Abonnement payé jusqu'au")
    norma_payment_ids = fields.One2many('norma.subscription.payment', 'company_id')
    norma_paid_sites = fields.Integer("Établissements payés", default=0,
                                      help="Établissements couverts par la période payée en cours.")

    def _norma_trial(self):
        """Fin de l'essai ; pour une entreprise créée avant les abonnements : date de création + durée d'essai."""
        self.ensure_one()
        return self.norma_trial_end or (self.create_date + timedelta(days=setting(self.env, 'norma.trial_days', int))
                                        if self.create_date else None)

    def _norma_plan(self):
        self.ensure_one()
        return self.env['norma.plan'].sudo().search([('category_id', '=', self.norma_category_id.id)], limit=1)

    def _norma_grace_end(self):
        self.ensure_one()
        end = max(filter(None, [self.norma_period_end, self._norma_trial()]), default=None)
        return end + timedelta(days=setting(self.env, 'norma.grace_days', int)) if end else None

    def _norma_sub_state(self, now=None):
        """État calculé à partir des dates (juste même si la tâche planifiée a du retard)."""
        self.ensure_one()
        now = now or fields.Datetime.now()
        if self.norma_period_end and now <= self.norma_period_end:
            return 'active'
        if not self.norma_period_end and self._norma_trial() and now <= self._norma_trial():
            return 'trial'
        grace = self._norma_grace_end()
        if grace and now <= grace:
            return 'grace'
        return 'expired'

    def _norma_access(self):
        self.ensure_one()
        return ACCESS_READONLY if self._norma_sub_state() == 'expired' else ACCESS_FULL

    def _norma_billable_sites(self):
        self.ensure_one()
        return self.env['norma.site'].sudo().search_count([('company_id', '=', self.id), ('active', '=', True)])

    def _norma_quote(self, months, add_sites=0):
        """Montant d'une période : formule + établissements au-delà de ceux inclus."""
        self.ensure_one()
        plan = self._norma_plan()
        if not plan:
            raise UserError(_("Aucune formule n'est définie pour votre catégorie. Contactez le support."))
        extra = max(0, self._norma_billable_sites() + add_sites - plan.sites_included)
        if months == 12:
            base = plan.price_year
            extra_amount = extra * plan.extra_site_price * 10  # deux mois offerts aussi sur les sites supplémentaires
        else:
            base = plan.price_month * months
            extra_amount = extra * plan.extra_site_price * months
        return {'plan': plan, 'months': months, 'extra_sites': extra, 'base': round(base, 2),
                'extra': round(extra_amount, 2), 'total': round(base + extra_amount, 2)}

    def _norma_days_left(self):
        self.ensure_one()
        end = self.norma_period_end or self._norma_trial()
        if not end:
            return 0
        return max(0, (end - fields.Datetime.now()).days + (1 if (end - fields.Datetime.now()).seconds else 0))


class NormaSubscriptionPayment(models.Model):
    _name = 'norma.subscription.payment'
    _description = "Paiement d'abonnement"
    _order = 'id desc'

    company_id = fields.Many2one('res.company', required=True, index=True, readonly=True)
    number = fields.Char(readonly=True, copy=False)
    plan_id = fields.Many2one('norma.plan', readonly=True)
    months = fields.Integer(readonly=True)
    extra_sites = fields.Integer(readonly=True)
    amount = fields.Float("Montant (USD)", digits=(10, 2), readonly=True)
    method = fields.Selection(MOBILE_METHODS, readonly=True)
    payer_phone = fields.Char(readonly=True)
    reference = fields.Char("Référence de la transaction", readonly=True, index=True)
    proof = fields.Binary("Justificatif", attachment=True, readonly=True)
    proof_type = fields.Char(readonly=True)
    state = fields.Selection([('submitted', 'À valider'), ('validated', 'Validé'), ('refused', 'Refusé')],
                             default='submitted', readonly=True, index=True)
    refusal_reason = fields.Char(readonly=True)
    declared_by = fields.Many2one('res.users', readonly=True)
    validated_by = fields.Many2one('res.users', readonly=True)
    validated_at = fields.Datetime(readonly=True)
    period_start = fields.Datetime(readonly=True)
    period_end = fields.Datetime(readonly=True)

    _sql_constraints = [('reference_unique', 'unique(method, reference)',
                         "Cette référence de transaction a déjà été déclarée.")]

    def _public_dict(self):
        labels = dict(MOBILE_METHODS)
        return [{'id': p.id, 'number': p.number or '', 'company': p.company_id.name, 'company_id': p.company_id.id,
                 'plan': p.plan_id.name or '', 'months': p.months, 'extra_sites': p.extra_sites, 'amount': p.amount,
                 'method': p.method, 'method_label': labels.get(p.method, ''), 'payer_phone': p.payer_phone or '',
                 'reference': p.reference or '', 'state': p.state, 'refusal_reason': p.refusal_reason or '',
                 'has_proof': bool(p.proof), 'date': fields.Datetime.to_string(p.create_date),
                 'declared_by': p.declared_by.name or '',
                 'period_start': fields.Datetime.to_string(p.period_start) if p.period_start else '',
                 'period_end': fields.Datetime.to_string(p.period_end) if p.period_end else ''} for p in self]

    def _validate(self, user):
        """Prolonge l'abonnement. Les jours d'essai ou d'abonnement restants sont conservés."""
        self.ensure_one()
        if self.state != 'submitted':
            raise UserError(_("Ce paiement a déjà été traité."))
        company = self.company_id
        now = fields.Datetime.now()
        start = max(filter(None, [now, company.norma_period_end, company._norma_trial()]))
        end = start + relativedelta(months=self.months)
        seq = self.env['ir.sequence'].sudo().next_by_code('norma.subscription.payment') or str(self.id)
        self.sudo().write({'state': 'validated', 'validated_by': user.id, 'validated_at': now,
                           'period_start': start, 'period_end': end, 'number': seq})
        company.sudo().write({'norma_period_end': end,
                              'norma_paid_sites': (self.plan_id.sites_included or 1) + self.extra_sites})
        unpaid = company._norma_billable_sites() - company.norma_paid_sites
        if unpaid > 0:
            self.env['norma.audit']._log(company, 'subscription.unpaid_sites',
                                         _("%s établissement(s) actif(s) au-delà de la période payée : inclus au prochain paiement") % unpaid,
                                         {'unpaid_sites': unpaid}, user=user)
        self.env['norma.audit']._log(company, 'subscription.paid',
                                     _("Abonnement prolongé jusqu'au %s (%s mois, %s USD)") %
                                     (fields.Date.to_string(end.date()), self.months, self.amount),
                                     {'payment': self.id, 'end': fields.Datetime.to_string(end)}, user=user)
