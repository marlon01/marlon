# -*- coding: utf-8 -*-
from odoo import fields, models
from odoo.exceptions import AccessDenied

ROLE_GROUPS = [
    ('admin', 'norma_facture.group_norma_admin'),
    ('manager', 'norma_facture.group_norma_manager'),
    ('cashier', 'norma_facture.group_norma_cashier'),
]
ROLE_RANK = {'cashier': 1, 'manager': 2, 'admin': 3}
ROLE_LABELS = {'admin': "Administrateur", 'manager': "Gestionnaire", 'cashier': "Caissier / réception"}


class ResUsers(models.Model):
    _inherit = 'res.users'

    norma_site_ids = fields.Many2many('norma.site', 'norma_site_user_rel', 'user_id', 'site_id',
                                      string="Établissements autorisés",
                                      help="Vide : tous les établissements de l'entreprise.")

    def _norma_role(self):
        self.ensure_one()
        for role, xmlid in ROLE_GROUPS:
            if self.has_group(xmlid):
                return role
        return None

    def _norma_is_platform(self):
        self.ensure_one()
        return self.has_group('norma_facture.group_norma_platform')

    def _norma_sites(self):
        """Établissements accessibles à l'utilisateur (actifs, de son entreprise)."""
        self.ensure_one()
        sites = self.env['norma.site'].sudo().search([('company_id', '=', self.company_id.id), ('active', '=', True)])
        if self.norma_site_ids:
            sites = sites & self.norma_site_ids
        return sites

    def _check_credentials(self, credential, env):
        # Le verrouillage après échecs répétés vaut pour toutes les routes de connexion (/norma, /web, RPC).
        if self.share and self.env['norma.throttle'].sudo().is_locked('login-user:%s' % (self.login or '').lower()):
            raise AccessDenied()
        return super()._check_credentials(credential, env)
