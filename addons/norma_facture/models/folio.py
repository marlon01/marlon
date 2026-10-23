# -*- coding: utf-8 -*-
"""Notes ouvertes : séjour à l'hôtel (chambre) ou addition au restaurant (table).

Une note accumule des consommations ; à la clôture, elle devient une facture normalisée unique.
"""
import math

from odoo import api, fields, models, _
from odoo.exceptions import UserError


class NormaPlace(models.Model):
    _name = 'norma.place'
    _description = 'Chambre ou table'
    _order = 'site_id, kind, sequence, name'

    company_id = fields.Many2one(related='site_id.company_id', store=True, index=True)
    site_id = fields.Many2one('norma.site', required=True, ondelete='cascade', index=True)
    kind = fields.Selection([('room', 'Chambre'), ('table', 'Table')], required=True)
    name = fields.Char(required=True)
    zone = fields.Char("Étage / salle")
    capacity = fields.Integer(default=2)
    rate_product_id = fields.Many2one('norma.product', string="Tarif de la nuitée",
                                      domain="[('company_id', '=', company_id), ('kind', '=', 'room')]")
    housekeeping = fields.Selection([('clean', 'Propre'), ('dirty', 'À nettoyer'), ('maintenance', 'En maintenance')],
                                    default='clean')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    def _public_dict(self):
        Folio = self.env['norma.folio']
        open_folios = {f.place_id.id: f for f in Folio.search([('place_id', 'in', self.ids), ('state', '=', 'open')])}
        out = []
        for p in self:
            f = open_folios.get(p.id)
            out.append({'id': p.id, 'site_id': p.site_id.id, 'kind': p.kind, 'name': p.name, 'zone': p.zone or '',
                        'capacity': p.capacity, 'housekeeping': p.housekeeping, 'active': p.active,
                        'rate_product_id': p.rate_product_id.id or False,
                        'rate': p.rate_product_id.price if p.rate_product_id else 0,
                        'folio': f._summary() if f else None})
        return out


class NormaFolio(models.Model):
    _name = 'norma.folio'
    _description = 'Note ouverte (séjour ou table)'
    _order = 'id desc'

    company_id = fields.Many2one(related='site_id.company_id', store=True, index=True)
    site_id = fields.Many2one('norma.site', required=True, index=True)
    place_id = fields.Many2one('norma.place', required=True, index=True)
    kind = fields.Selection(related='place_id.kind', store=True)
    state = fields.Selection([('open', 'Ouverte'), ('invoiced', 'Facturée'), ('cancelled', 'Annulée')],
                             default='open', index=True)
    customer_id = fields.Many2one('norma.customer', string="Client / hôte")
    guests = fields.Integer("Personnes", default=1)
    checkin = fields.Datetime("Arrivée", default=fields.Datetime.now)
    checkout_planned = fields.Date("Départ prévu")
    nights_posted = fields.Integer(default=0)
    line_ids = fields.One2many('norma.folio.line', 'folio_id')
    invoice_id = fields.Many2one('norma.invoice', readonly=True)
    note = fields.Char()
    opened_by = fields.Many2one('res.users', default=lambda s: s.env.user)

    _sql_constraints = []

    @api.constrains('place_id', 'state')
    def _check_one_open(self):
        for f in self:
            if f.state == 'open' and self.search_count([('place_id', '=', f.place_id.id), ('state', '=', 'open')]) > 1:
                raise UserError(_("%s est déjà occupée.") % f.place_id.name)

    @property
    def total(self):
        return round(sum(l.price * l.quantity for l in self.line_ids), 2)

    def _nights_due(self, now=None):
        """Nuitées dues : au moins une, puis une par jour entamé après 12 h le lendemain."""
        self.ensure_one()
        if self.kind != 'room' or not self.checkin:
            return 0
        now = now or fields.Datetime.now()
        hours = (now - self.checkin).total_seconds() / 3600.0
        return max(1, math.ceil((hours - 2) / 24.0)) if hours > 0 else 1

    def _post_nights(self):
        """Ajoute les nuitées manquantes au tarif de la chambre (idempotent)."""
        for f in self.filtered(lambda f: f.kind == 'room' and f.state == 'open'):
            product = f.place_id.rate_product_id
            if not product:
                raise UserError(_("Aucun tarif de nuitée pour la chambre %s.") % f.place_id.name)
            due = f._nights_due()
            if due > f.nights_posted:
                self.env['norma.folio.line'].create({
                    'folio_id': f.id, 'product_id': product.id, 'name': _("Nuitée(s) — chambre %s") % f.place_id.name,
                    'price': product.price, 'quantity': due - f.nights_posted, 'is_night': True,
                })
                f.nights_posted = due

    def _summary(self):
        self.ensure_one()
        return {'id': self.id, 'customer': self.customer_id.name or '', 'customer_id': self.customer_id.id or False,
                'guests': self.guests, 'checkin': fields.Datetime.to_string(self.checkin) if self.checkin else '',
                'checkout_planned': fields.Date.to_string(self.checkout_planned) if self.checkout_planned else '',
                'total': self.total, 'count': len(self.line_ids), 'nights_due': self._nights_due(),
                'nights_posted': self.nights_posted}

    def _public_dict(self):
        self.ensure_one()
        d = self._summary()
        d.update({'place': self.place_id.name, 'place_id': self.place_id.id, 'kind': self.kind, 'state': self.state,
                  'note': self.note or '', 'invoice_id': self.invoice_id.id or False,
                  'lines': [{'id': l.id, 'name': l.name, 'price': l.price, 'quantity': l.quantity,
                             'product_id': l.product_id.id, 'is_night': l.is_night, 'sent': l.sent,
                             'date': fields.Datetime.to_string(l.create_date) if l.create_date else '',
                             'user': l.create_uid.name or ''} for l in self.line_ids]})
        return d


class NormaFolioLine(models.Model):
    _name = 'norma.folio.line'
    _description = 'Consommation sur note'
    _order = 'id'

    folio_id = fields.Many2one('norma.folio', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='folio_id.company_id', store=True, index=True)
    product_id = fields.Many2one('norma.product', required=True, ondelete='restrict')
    name = fields.Char(required=True)
    price = fields.Float(digits=(16, 2))
    quantity = fields.Float(digits=(16, 3), default=1)
    is_night = fields.Boolean()
    sent = fields.Boolean("Envoyé en cuisine")
