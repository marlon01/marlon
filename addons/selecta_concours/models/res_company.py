# -*- coding: utf-8 -*-
from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    selecta_brand_color = fields.Char(string="Couleur de marque SELECTA", default='#0B5FFF')
    selecta_tagline = fields.Char(string="Slogan affiché aux candidats",
                                  default="La culture de l'excellence")

    # ------------------------------------------------------------------ points d'extension
    # Sans module d'abonnement, toute structure dispose de toutes les fonctions sans limite.
    # Le module ``selecta_saas`` surcharge ces deux méthodes (période d'essai, quotas, plan).
    def _selecta_guard(self, action, **context):
        """Lève une UserError si ``action`` est interdite à la structure (abonnement, quota)."""
        return True

    def _selecta_feature(self, feature):
        """Indique si une fonction optionnelle (``llm``, ``ai_analysis``, ``branding``…) est incluse."""
        return True
