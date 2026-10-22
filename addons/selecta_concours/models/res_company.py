# -*- coding: utf-8 -*-
from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    selecta_brand_color = fields.Char(string="Couleur de marque SELECTA", default='#0B5FFF')
    selecta_tagline = fields.Char(string="Slogan affiché aux candidats",
                                  default="La culture de l'excellence")
