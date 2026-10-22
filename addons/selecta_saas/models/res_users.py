# -*- coding: utf-8 -*-
from odoo import models


class ResUsers(models.Model):
    _inherit = 'res.users'

    def _selecta_home_url(self):
        if self.has_group('selecta_saas.group_platform_admin'):
            return '/selecta/platform'
        return super()._selecta_home_url()
