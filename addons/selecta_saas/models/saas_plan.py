# -*- coding: utf-8 -*-
"""Catégories d'abonnés et grille tarifaire (modifiable depuis l'administration centrale)."""
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError

FEATURES = {
    'ai_analysis': "Analyse IA (psychométrie, fraude)",
    'llm': "Assistant de rédaction (LLM)",
    'branding': "Personnalisation (logo, couleur, slogan)",
}


class SelectaSaasPlan(models.Model):
    _name = 'selecta.saas.plan'
    _description = "Catégorie d'abonnement SELECTA"
    _order = 'sequence, id'

    name = fields.Char(string="Catégorie", required=True, translate=True)
    code = fields.Char(required=True, index=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    audience = fields.Char(string="Public visé", translate=True)
    description = fields.Text(translate=True)
    highlight = fields.Boolean(string="Mis en avant")
    currency_id = fields.Many2one('res.currency', required=True, default=lambda s: s.env.ref('base.USD'))
    price_monthly = fields.Monetary(string="Prix mensuel", required=True)
    price_yearly = fields.Monetary(string="Prix annuel", required=True)
    max_active_concours = fields.Integer(string="Concours actifs simultanés", help="0 = illimité")
    max_candidates_month = fields.Integer(string="Candidats inscrits par mois", help="0 = illimité")
    max_staff = fields.Integer(string="Comptes du personnel", help="0 = illimité")
    feature_ai_analysis = fields.Boolean(string=FEATURES['ai_analysis'], default=True)
    feature_llm = fields.Boolean(string=FEATURES['llm'])
    feature_branding = fields.Boolean(string=FEATURES['branding'])
    support = fields.Char(string="Support", translate=True, default="Par e-mail")
    tenant_count = fields.Integer(compute='_compute_tenant_count')

    _sql_constraints = [
        ('code_unique', 'unique(code)', "Ce code de catégorie existe déjà."),
        ('prices_positive', 'CHECK(price_monthly >= 0 AND price_yearly >= 0)', "Les prix doivent être positifs."),
        ('limits_positive', 'CHECK(max_active_concours >= 0 AND max_candidates_month >= 0 AND max_staff >= 0)',
         "Les limites doivent être positives (0 = illimité)."),
    ]

    def _compute_tenant_count(self):
        data = self.env['selecta.saas.tenant'].sudo()._read_group([('plan_id', 'in', self.ids)], ['plan_id'], ['__count'])
        counts = {plan.id: n for plan, n in data}
        for plan in self:
            plan.tenant_count = counts.get(plan.id, 0)

    @api.constrains('code')
    def _check_code(self):
        for plan in self:
            if not plan.code.replace('_', '').isalnum():
                raise ValidationError(_("Le code ne doit contenir que des lettres, chiffres et « _ »."))

    def has_feature(self, feature):
        self.ensure_one()
        return bool(self['feature_%s' % feature]) if feature in FEATURES else True

    def price_for(self, cycle):
        self.ensure_one()
        return self.price_yearly if cycle == 'yearly' else self.price_monthly

    def _public_dict(self):
        self.ensure_one()
        return {
            'id': self.id, 'code': self.code, 'name': self.name, 'audience': self.audience or '',
            'description': self.description or '', 'highlight': self.highlight,
            'currency': self.currency_id.name, 'symbol': self.currency_id.symbol,
            'price_monthly': self.price_monthly, 'price_yearly': self.price_yearly,
            'yearly_saving': max(0.0, self.price_monthly * 12 - self.price_yearly),
            'max_active_concours': self.max_active_concours, 'max_candidates_month': self.max_candidates_month,
            'max_staff': self.max_staff, 'support': self.support or '',
            'features': {k: bool(self['feature_%s' % k]) for k in FEATURES},
        }
