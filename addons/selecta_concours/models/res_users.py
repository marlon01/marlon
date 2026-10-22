# -*- coding: utf-8 -*-
from odoo import models

from .selecta_backoffice import ROLE_GROUPS


class ResUsers(models.Model):
    _inherit = 'res.users'

    def _selecta_home_url(self):
        """Page d'arrivée après connexion du personnel."""
        return '/selecta/admin'

    def _selecta_is_staff(self):
        self.ensure_one()
        return any(self.has_group(g) for g in ROLE_GROUPS.values())
