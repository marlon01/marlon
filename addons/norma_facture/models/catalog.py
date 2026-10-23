# -*- coding: utf-8 -*-
"""Groupes de taxation DGI, articles et clients."""
import re

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError

ITEM_TYPES = [('BIE', 'Bien'), ('SER', 'Service'), ('TAX', 'Taxe / débours')]
CLIENT_TYPES = [
    ('PP', 'Personne physique'),
    ('PM', 'Personne morale'),
    ('PC', 'Commerçant (personne physique)'),
    ('PL', 'Profession libérale'),
    ('AO', 'Ambassade / organisation internationale'),
]


class NormaTaxGroup(models.Model):
    _name = 'norma.tax.group'
    _description = 'Groupe de taxation DGI'
    _order = 'code'

    code = fields.Char(required=True, size=2)
    name = fields.Char(required=True, translate=True)
    rate = fields.Float("Taux de TVA (%)", digits=(5, 2), required=True)
    kind = fields.Selection([('taxable', 'Taxable'), ('exempt', 'Exonéré'), ('export', 'Exportation'),
                             ('specific', 'Régime particulier')], default='taxable', required=True)
    active = fields.Boolean(default=True)

    _sql_constraints = [('code_unique', 'unique(code)', "Groupe déjà défini.")]

    @api.model
    def _rates(self):
        return {g.code: {'rate': g.rate, 'name': g.name, 'kind': g.kind} for g in self.sudo().search([])}

    def _public_dict(self):
        return [{'code': g.code, 'name': g.name, 'rate': g.rate, 'kind': g.kind, 'active': g.active} for g in self]


class NormaProductCategory(models.Model):
    _name = 'norma.product.category'
    _description = "Rayon / famille d'articles"
    _order = 'sequence, name'

    company_id = fields.Many2one('res.company', required=True, index=True, default=lambda s: s.env.company,
                                 ondelete='cascade')
    name = fields.Char(required=True)
    color = fields.Char(default='#0E4D64')
    sequence = fields.Integer(default=10)

    def write(self, vals):
        if 'company_id' in vals and any(r.company_id.id != vals['company_id'] for r in self):
            raise AccessError(_("Un élément ne change pas d'entreprise."))
        return super().write(vals)



class NormaProduct(models.Model):
    _name = 'norma.product'
    _description = 'Article ou prestation'
    _order = 'name'

    company_id = fields.Many2one('res.company', required=True, index=True, default=lambda s: s.env.company,
                                 ondelete='cascade')
    name = fields.Char(required=True)
    code = fields.Char("Référence")
    barcode = fields.Char("Code-barres", index=True)
    item_type = fields.Selection(ITEM_TYPES, default='BIE', required=True)
    category_id = fields.Many2one('norma.product.category', string="Rayon",
                                  domain="[('company_id', '=', company_id)]")
    price = fields.Float("Prix unitaire TTC", digits=(16, 2), required=True)
    tax_group_id = fields.Many2one('norma.tax.group', required=True, ondelete='restrict',
                                   default=lambda s: s.env['norma.tax.group'].search([('code', '=', 'B')], limit=1))
    specific_tax = fields.Float("Taxe spécifique par unité", digits=(16, 2))
    unit = fields.Char("Unité", default='u')
    kind = fields.Selection([('goods', 'Article'), ('room', 'Nuitée'), ('dish', 'Plat / boisson'),
                             ('service', 'Prestation')], default='goods')
    active = fields.Boolean(default=True)

    _sql_constraints = [('barcode_company_unique', 'unique(company_id, barcode)', "Code-barres déjà utilisé.")]

    @api.constrains('price', 'specific_tax')
    def _check_price(self):
        for p in self:
            if p.price < 0 or p.specific_tax < 0:
                raise ValidationError(_("Les prix et taxes ne peuvent pas être négatifs."))

    @api.constrains('category_id', 'company_id')
    def _check_company(self):
        for p in self:
            if p.category_id and p.category_id.company_id != p.company_id:
                raise ValidationError(_("Rayon d'une autre entreprise."))

    def _public_dict(self):
        return [{'id': p.id, 'name': p.name, 'code': p.code or '', 'barcode': p.barcode or '',
                 'item_type': p.item_type, 'category_id': p.category_id.id or False,
                 'category': p.category_id.name or '', 'color': p.category_id.color or '#64748B',
                 'price': p.price, 'tax_group': p.tax_group_id.code, 'specific_tax': p.specific_tax,
                 'unit': p.unit or '', 'kind': p.kind, 'active': p.active} for p in self]

    def write(self, vals):
        if 'company_id' in vals and any(r.company_id.id != vals['company_id'] for r in self):
            raise AccessError(_("Un élément ne change pas d'entreprise."))
        return super().write(vals)



class NormaCustomer(models.Model):
    _name = 'norma.customer'
    _description = 'Client'
    _order = 'name'

    company_id = fields.Many2one('res.company', required=True, index=True, default=lambda s: s.env.company,
                                 ondelete='cascade')
    name = fields.Char(required=True)
    client_type = fields.Selection(CLIENT_TYPES, default='PP', required=True)
    nif = fields.Char("NIF")
    rccm = fields.Char("RCCM")
    address = fields.Char()
    phone = fields.Char()
    email = fields.Char()
    exemption_ref = fields.Char("Référence d'exonération", help="Obligatoire pour une ambassade ou organisation internationale (AO).")
    id_document = fields.Char("Pièce d'identité")
    nationality = fields.Char()
    active = fields.Boolean(default=True)

    @api.constrains('nif', 'client_type')
    def _check_nif(self):
        for c in self:
            if c.nif and not re.match(r'^[A-Z0-9][A-Z0-9\-/ ]{4,30}$', c.nif):
                raise ValidationError(_("NIF du client invalide."))
            if c.client_type in ('PM', 'PC', 'PL') and not c.nif:
                raise ValidationError(_("Le NIF est obligatoire pour ce type de client (PM, PC, PL)."))
            if c.client_type == 'AO' and not c.exemption_ref:
                raise ValidationError(_("La référence d'exonération est obligatoire pour une ambassade ou organisation internationale."))

    def _check_for_invoice(self):
        """Contrôles e-MCF (erreurs 41/42) refaits au moment de facturer."""
        for c in self:
            if not (c.name or '').strip():
                raise ValidationError(_("Le nom du client est obligatoire."))
            c._check_nif()

    def _public_dict(self):
        return [{'id': c.id, 'name': c.name, 'client_type': c.client_type, 'nif': c.nif or '',
                 'rccm': c.rccm or '', 'address': c.address or '', 'phone': c.phone or '',
                 'email': c.email or '', 'exemption_ref': c.exemption_ref or '', 'id_document': c.id_document or '', 'nationality': c.nationality or '',
                 'active': c.active} for c in self]

    def write(self, vals):
        if 'company_id' in vals and any(r.company_id.id != vals['company_id'] for r in self):
            raise AccessError(_("Un élément ne change pas d'entreprise."))
        return super().write(vals)
