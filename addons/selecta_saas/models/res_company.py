# -*- coding: utf-8 -*-
from odoo import models


class ResCompany(models.Model):
    _inherit = 'res.company'

    def _selecta_tenant(self):
        """Dossier client de la structure (vide pour la structure qui héberge la plateforme)."""
        self.ensure_one()
        return self.env['selecta.saas.tenant'].sudo().search([('company_id', '=', self.id)], limit=1)

    def _selecta_guard(self, action, **context):
        for company in self:
            tenant = company._selecta_tenant()
            if tenant:
                tenant._check(action, concours=context.get('concours'), count=context.get('count', 1))
        return super()._selecta_guard(action, **context)

    def _selecta_feature(self, feature):
        tenant = self._selecta_tenant() if len(self) == 1 else None
        if tenant and not tenant.plan_id.has_feature(feature):
            return False
        return super()._selecta_feature(feature)
