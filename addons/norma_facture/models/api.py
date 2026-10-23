# -*- coding: utf-8 -*-
"""Façade unique des interfaces NORMA.

Chaque méthode publique déclare le rôle minimal requis. Les écritures passent par le superutilisateur
après des contrôles explicites : entreprise de l'utilisateur, établissements autorisés, rôle.
Aucune valeur calculée (prix imposé, total, taxe, état, code DGI) n'est acceptée depuis le navigateur.
"""
import base64
import re
from datetime import datetime, time, timedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError

from .invoice import INVOICE_TYPES, PAYMENT_METHODS, REFERENCE_TYPES
from .catalog import CLIENT_TYPES, ITEM_TYPES
from .res_users import ROLE_LABELS, ROLE_RANK

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')
PUBLIC = {}


def role(minimum):
    """Déclare une opération de la façade et son rôle minimal.

    La méthode devient privée pour l'ORM : seul ``_dispatch`` (route /norma/api) peut l'appeler, après le contrôle
    du rôle, de l'entreprise et de son état. /web/dataset/call_kw la refuse.
    """
    def deco(fn):
        PUBLIC[fn.__name__] = minimum
        return api.private(fn)
    return deco


def _int(value, name='id'):
    try:
        v = int(value)
    except (TypeError, ValueError):
        raise UserError("Paramètre invalide : %s" % name)
    if v <= 0:
        raise UserError("Paramètre invalide : %s" % name)
    return v


def _num(value, name, minimum=None, maximum=None):
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise UserError("Valeur numérique invalide : %s" % name)
    if v != v or v in (float('inf'), float('-inf')):
        raise UserError("Valeur numérique invalide : %s" % name)
    if minimum is not None and v < minimum:
        raise UserError("%s : valeur trop petite." % name)
    if maximum is not None and v > maximum:
        raise UserError("%s : valeur trop grande." % name)
    return v


def _txt(value, size=120):
    return (str(value or '')).strip()[:size]


class NormaApi(models.AbstractModel):
    _name = 'norma.api'
    _description = 'Façade NORMA'

    # ================================================================ aiguillage
    @api.model
    def _dispatch(self, method, params):
        minimum = PUBLIC.get(method)
        if not minimum:
            raise AccessError(_("Opération inconnue."))
        user = self.env.user
        company = user.company_id
        current = user._norma_role()
        if not current or not company.norma_enabled:
            raise AccessError(_("Ce compte n'a pas accès à NORMA."))
        if company.norma_state != 'active':
            raise AccessError(_("Le compte de votre entreprise est suspendu. Contactez le support."))
        if ROLE_RANK[current] < ROLE_RANK[minimum]:
            raise AccessError(_("Votre rôle ne permet pas cette opération."))
        params = params if isinstance(params, dict) else {}
        return getattr(self, method)(**params)

    # ---------------------------------------------------------------- utilitaires
    def _company(self):
        return self.env.user.company_id.sudo()

    def _role(self):
        return self.env.user._norma_role()

    def _is(self, minimum):
        return ROLE_RANK.get(self._role(), 0) >= ROLE_RANK[minimum]

    def _site(self, site_id):
        site = self.env['norma.site'].sudo().browse(_int(site_id, 'site')).exists()
        if not site or site not in self.env.user._norma_sites():
            raise AccessError(_("Établissement non autorisé."))
        return site

    def _own(self, model, rec_id, name='id'):
        rec = self.env[model].sudo().browse(_int(rec_id, name)).exists()
        if not rec or rec.company_id != self._company():
            raise AccessError(_("Élément introuvable."))
        return rec

    def _invoice(self, invoice_id):
        inv = self._own('norma.invoice', invoice_id, 'invoice')
        if not self._is('manager') and inv.site_id not in self.env.user._norma_sites():
            raise AccessError(_("Facture d'un établissement non autorisé."))
        return inv

    def _audit(self, event, message, payload=None, invoice=None):
        self.env['norma.audit']._log(self._company(), event, message, payload, invoice=invoice)

    # ================================================================ démarrage
    @role('cashier')
    def bootstrap(self):
        user, company = self.env.user, self._company()
        cat = company.norma_category_id
        sites = user._norma_sites()
        return {
            'user': {'id': user.id, 'name': user.name, 'login': user.login, 'role': self._role(),
                     'role_label': ROLE_LABELS[self._role()]},
            'company': self._company_dict(company),
            'category': {'code': cat.code, 'name': cat.name, 'workspace': cat.workspace, 'icon': cat.icon} if cat else
                        {'code': 'services', 'name': 'Services', 'workspace': 'invoice', 'icon': 'briefcase'},
            'sites': sites._public_dict(),
            'tax_groups': self.env['norma.tax.group'].sudo().search([])._public_dict(),
            'payment_methods': [{'code': c, 'label': l} for c, l in PAYMENT_METHODS],
            'invoice_types': [{'code': c, 'label': l} for c, l in INVOICE_TYPES],
            'reference_types': [{'code': c, 'label': l} for c, l in REFERENCE_TYPES],
            'client_types': [{'code': c, 'label': l} for c, l in CLIENT_TYPES],
            'item_types': [{'code': c, 'label': l} for c, l in ITEM_TYPES],
            'max_discount': company.norma_max_discount if not self._is('manager') else 100,
        }

    def _company_dict(self, company):
        return {
            'id': company.id, 'name': company.name, 'nif': company.norma_nif or '', 'rccm': company.norma_rccm or '',
            'idnat': company.norma_idnat or '', 'regime': company.norma_tax_regime,
            'tax_center': company.norma_tax_center or '', 'address': company.street or '',
            'city': company.city or '', 'phone': company.phone or '', 'email': company.email or '',
            'currency': company.norma_currency or 'CDF', 'usd_rate': company.norma_usd_rate,
            'color': company.norma_brand_color or '#0E4D64', 'footer': company.norma_invoice_footer or '',
            'logo': '/norma/logo/%s' % company.id, 'max_discount': company.norma_max_discount,
            'category': company.norma_category_id.code or '', 'verified': company.norma_verified,
        }

    # ================================================================ catalogue
    @role('cashier')
    def catalog(self):
        company = self._company()
        products = self.env['norma.product'].sudo().search([('company_id', '=', company.id), ('active', '=', True)])
        cats = self.env['norma.product.category'].sudo().search([('company_id', '=', company.id)])
        return {'products': products._public_dict(),
                'categories': [{'id': c.id, 'name': c.name, 'color': c.color} for c in cats]}

    @role('manager')
    def products_all(self):
        products = self.env['norma.product'].sudo().with_context(active_test=False).search(
            [('company_id', '=', self._company().id)])
        return products._public_dict()

    @role('manager')
    def product_save(self, id=None, **vals):
        company = self._company()
        group = self.env['norma.tax.group'].sudo().search([('code', '=', _txt(vals.get('tax_group'), 2))], limit=1)
        if not group:
            raise UserError(_("Choisissez un groupe de taxation."))
        data = {
            'name': _txt(vals.get('name')), 'code': _txt(vals.get('code'), 40) or False,
            'barcode': _txt(vals.get('barcode'), 40) or False,
            'item_type': vals.get('item_type') if vals.get('item_type') in dict(ITEM_TYPES) else 'BIE',
            'price': _num(vals.get('price'), _('Prix'), 0.01, 1e12), 'tax_group_id': group.id,
            'specific_tax': _num(vals.get('specific_tax') or 0, _('Taxe spécifique'), 0, 1e12),
            'unit': _txt(vals.get('unit'), 12) or 'u',
            'kind': vals.get('kind') if vals.get('kind') in ('goods', 'room', 'dish', 'service') else 'goods',
            'active': bool(vals.get('active', True)),
        }
        if not data['name']:
            raise UserError(_("Le nom de l'article est obligatoire."))
        if vals.get('category_id'):
            data['category_id'] = self._own('norma.product.category', vals['category_id'], 'category').id
        else:
            data['category_id'] = False
        if id:
            product = self._own('norma.product', id)
            product.write(data)
        else:
            product = self.env['norma.product'].sudo().create(dict(data, company_id=company.id))
        self._audit('product.save', _("Article %s : %s — %s") % ('modifié' if id else 'créé', product.name, product.price),
                    {'product': product.id, 'price': product.price, 'group': group.code})
        return product._public_dict()[0]

    @role('manager')
    def category_save(self, id=None, name='', color='#0E4D64'):
        name = _txt(name, 60)
        if not name:
            raise UserError(_("Nom du rayon obligatoire."))
        color = color if re.match(r'^#[0-9A-Fa-f]{6}$', color or '') else '#0E4D64'
        if id:
            cat = self._own('norma.product.category', id)
            cat.write({'name': name, 'color': color})
        else:
            cat = self.env['norma.product.category'].sudo().create(
                {'name': name, 'color': color, 'company_id': self._company().id})
        return {'id': cat.id, 'name': cat.name, 'color': cat.color}

    @role('manager')
    def category_delete(self, id):
        cat = self._own('norma.product.category', id)
        self.env['norma.product'].sudo().with_context(active_test=False).search(
            [('category_id', '=', cat.id)]).write({'category_id': False})
        cat.unlink()
        return True

    # ================================================================ clients
    @role('cashier')
    def customers(self, search='', limit=50):
        domain = [('company_id', '=', self._company().id), ('active', '=', True)]
        search = _txt(search, 60)
        if search:
            domain += ['|', '|', '|', ('name', 'ilike', search), ('nif', 'ilike', search),
                       ('phone', 'ilike', search), ('email', 'ilike', search)]
        recs = self.env['norma.customer'].sudo().search(domain, limit=min(int(limit or 50), 200))
        return recs._public_dict()

    @role('cashier')
    def customer_save(self, id=None, **vals):
        ctype = vals.get('client_type') if vals.get('client_type') in dict(CLIENT_TYPES) else 'PP'
        email = _txt(vals.get('email'), 120)
        if email and not EMAIL_RE.match(email):
            raise UserError(_("Adresse e-mail invalide."))
        data = {
            'name': _txt(vals.get('name')), 'client_type': ctype,
            'nif': _txt(vals.get('nif'), 32).upper() or False, 'rccm': _txt(vals.get('rccm'), 40) or False,
            'address': _txt(vals.get('address'), 160) or False, 'phone': _txt(vals.get('phone'), 32) or False,
            'email': email or False, 'exemption_ref': _txt(vals.get('exemption_ref'), 60) or False,
            'id_document': _txt(vals.get('id_document'), 60) or False,
            'nationality': _txt(vals.get('nationality'), 40) or False,
        }
        if not data['name']:
            raise UserError(_("Le nom du client est obligatoire."))
        try:
            if id:
                cust = self._own('norma.customer', id)
                cust.write(data)
            else:
                cust = self.env['norma.customer'].sudo().create(dict(data, company_id=self._company().id))
        except ValidationError as exc:
            raise UserError(exc.args[0])
        return cust._public_dict()[0]

    # ================================================================ vente directe (caisse, éditeur)
    def _lines_from(self, raw_lines, allow_price):
        company = self._company()
        max_disc = 100 if self._is('manager') else company.norma_max_discount
        if not isinstance(raw_lines, list) or not raw_lines:
            raise UserError(_("Ajoutez au moins un article."))
        if len(raw_lines) > 500:
            raise UserError(_("Trop de lignes sur une seule facture."))
        lines = []
        for raw in raw_lines:
            if not isinstance(raw, dict):
                raise UserError(_("Ligne invalide."))
            product = self._own('norma.product', raw.get('product_id'), 'article')
            if not product.active:
                raise UserError(_("L'article %s est archivé.") % product.name)
            line = {'product': product, 'quantity': _num(raw.get('quantity'), _('Quantité'), 0.001, 1e7),
                    'discount_pct': _num(raw.get('discount_pct') or 0, _('Remise'), 0, max_disc)}
            if raw.get('name') and product.item_type == 'SER':
                line['name'] = _txt(raw.get('name'), 120)
            if raw.get('price') not in (None, '') and float(raw.get('price')) != product.price:
                if not allow_price:
                    raise AccessError(_("Seul un gestionnaire peut modifier un prix."))
                line['price'] = _num(raw.get('price'), _('Prix'), 0.01, 1e12)
            lines.append(line)
        return lines

    def _payments_from(self, raw):
        out = []
        for p in raw or []:
            if not isinstance(p, dict):
                raise UserError(_("Paiement invalide."))
            out.append({'method': _txt(p.get('method'), 20), 'amount': _num(p.get('amount'), _('Montant'), 0.01, 1e13)})
        return out

    def _replayed(self, request_key):
        key = _txt(request_key, 64)
        if not key:
            return None, False
        if not re.match(r'^[A-Za-z0-9\-]{8,64}$', key):
            raise UserError(_("Clé de requête invalide."))
        done = self.env['norma.invoice'].sudo().search([('company_id', '=', self._company().id), ('request_key', '=', key)], limit=1)
        return done, key

    @role('cashier')
    def checkout(self, site_id, lines, payments=None, customer_id=None, invoice_type='FV', note='', origin='', request_key=None):
        """Vente immédiate : création, numérotation, normalisation DGI. Retourne la facture complète."""
        done, key = self._replayed(request_key)
        if done:
            return done._public_dict(full=True)[0]
        if invoice_type not in ('FV', 'FT', 'EV', 'ET'):
            raise UserError(_("Type de facture non autorisé ici (utilisez « Avoir » pour un remboursement)."))
        site = self._site(site_id)
        customer = self._own('norma.customer', customer_id, 'client') if customer_id else None
        inv = self.env['norma.invoice']._build(site, {
            'invoice_type': invoice_type, 'customer': customer,
            'lines': self._lines_from(lines, allow_price=self._is('manager')),
            'payments': self._payments_from(payments), 'note': _txt(note, 200), 'origin': _txt(origin, 80),
            'request_key': key,
        }, self.env.user)
        inv._issue()
        return inv._public_dict(full=True)[0]

    # ================================================================ factures
    @role('cashier')
    def invoices(self, state=None, site_id=None, invoice_type=None, search='', date_from=None, date_to=None,
                 offset=0, limit=50):
        domain = [('company_id', '=', self._company().id), ('state', '!=', 'draft')]
        if not self._is('manager'):
            domain.append(('site_id', 'in', self.env.user._norma_sites().ids))
        if state in ('failed', 'uncertain', 'normalized', 'cancelled'):
            domain.append(('state', '=', state))
        elif state == 'attention':
            domain.append(('state', 'in', ('failed', 'uncertain')))
        if site_id:
            domain.append(('site_id', '=', _int(site_id, 'site')))
        if invoice_type in dict(INVOICE_TYPES):
            domain.append(('invoice_type', '=', invoice_type))
        search = _txt(search, 60)
        if search:
            domain += ['|', '|', '|', ('number', 'ilike', search), ('client_name', 'ilike', search),
                       ('client_nif', 'ilike', search), ('emcf_code', 'ilike', search)]
        if date_from:
            domain.append(('date', '>=', fields.Datetime.to_string(datetime.combine(fields.Date.to_date(date_from), time.min))))
        if date_to:
            domain.append(('date', '<=', fields.Datetime.to_string(datetime.combine(fields.Date.to_date(date_to), time.max))))
        Inv = self.env['norma.invoice'].sudo()
        limit = max(1, min(int(limit or 50), 200))
        recs = Inv.search(domain, offset=max(0, int(offset or 0)), limit=limit)
        return {'total': Inv.search_count(domain), 'items': recs._public_dict()}

    @role('cashier')
    def invoice_get(self, id):
        return self._invoice(id)._public_dict(full=True)[0]

    @role('cashier')
    def invoice_retry(self, id):
        inv = self._invoice(id)
        if inv.state != 'failed':
            raise UserError(_("Cette facture n'attend pas de normalisation."))
        if inv.emcf_blocked and not self._is('manager'):
            raise AccessError(_("Cette facture a été refusée par la DGI : un gestionnaire doit la traiter."))
        inv._transmit(manual=True)
        return inv._public_dict(full=True)[0]

    @role('manager')
    def invoice_abandon(self, id, reason=''):
        inv = self._invoice(id)
        reason = _txt(reason, 200)
        if len(reason) < 3:
            raise UserError(_("Indiquez le motif de l'abandon."))
        inv._abandon(reason)
        return inv._public_dict(full=True)[0]

    @role('manager')
    def invoice_check_uncertain(self, id):
        inv = self._invoice(id)
        inv._transmit(manual=True)
        return inv._public_dict(full=True)[0]

    @role('manager')
    def invoice_release_uncertain(self, id, confirm_text=''):
        inv = self._invoice(id)
        if _txt(confirm_text, 40).upper() != (inv.number or '').upper():
            raise UserError(_("Recopiez le numéro de la facture pour confirmer qu'elle est absente du portail DGI."))
        inv._release_uncertain()
        return inv._public_dict(full=True)[0]

    @role('manager')
    def credit_note(self, id, lines, reference_type='COR', reason='', payment_method='ESPECES', request_key=None):
        done, key = self._replayed(request_key)
        if done:
            return done._public_dict(full=True)[0]
        orig = self._invoice(id)
        itype = 'EA' if orig.invoice_type in ('EV', 'ET') else 'FA'
        if not isinstance(lines, list) or not lines:
            raise UserError(_("Sélectionnez les articles à rembourser."))
        built = []
        for raw in lines:
            line = self.env['norma.invoice.line'].sudo().browse(_int(raw.get('line_id'), 'ligne')).exists()
            if not line or line.invoice_id != orig:
                raise AccessError(_("Ligne étrangère à la facture d'origine."))
            qty = _num(raw.get('quantity'), _('Quantité'), 0, 1e7)
            if not qty:
                continue
            built.append({'product': line.product_id, 'quantity': qty, 'name': line.name,
                          'price': line.price_currency or line.unit_price, 'discount_pct': line.discount_pct,
                          'tax_group': line.tax_group, 'origin_line': line})
        if not built:
            raise UserError(_("Aucune quantité à rembourser."))
        if payment_method not in dict(PAYMENT_METHODS):
            raise UserError(_("Mode de remboursement inconnu."))
        credit = self.env['norma.invoice']._build(orig.site_id, {
            'invoice_type': itype, 'reversed': orig, 'lines': built, 'reference_type': reference_type,
            'reason': reason, 'payments': None, 'origin': orig.number, 'refund_method': payment_method, 'request_key': key,
        }, self.env.user)
        credit._issue()
        return credit._public_dict(full=True)[0]

    @role('cashier')
    def invoice_printed(self, id):
        inv = self._invoice(id)
        inv.with_context(norma_engine=True).sudo().write({'print_count': inv.print_count + 1})
        return inv.print_count

    # ================================================================ hôtel et restaurant
    @role('cashier')
    def places(self, site_id, kind):
        site = self._site(site_id)
        if kind not in ('room', 'table'):
            raise UserError(_("Type inconnu."))
        recs = self.env['norma.place'].sudo().search([('site_id', '=', site.id), ('kind', '=', kind), ('active', '=', True)])
        return recs._public_dict()

    @role('manager')
    def place_save(self, site_id, kind, name, id=None, zone='', capacity=2, rate_product_id=None, active=True):
        site = self._site(site_id)
        if kind not in ('room', 'table') or not _txt(name, 30):
            raise UserError(_("Nom obligatoire."))
        vals = {'name': _txt(name, 30), 'zone': _txt(zone, 40) or False,
                'capacity': int(_num(capacity or 1, _('Capacité'), 1, 500)), 'active': bool(active)}
        if kind == 'room':
            if not rate_product_id:
                raise UserError(_("Choisissez le tarif de la nuitée (article de type « Nuitée »)."))
            product = self._own('norma.product', rate_product_id, 'tarif')
            if product.kind != 'room':
                raise UserError(_("Le tarif doit être un article de type « Nuitée »."))
            vals['rate_product_id'] = product.id
        if id:
            place = self.env['norma.place'].sudo().browse(_int(id)).exists()
            if not place or place.company_id != self._company():
                raise AccessError(_("Élément introuvable."))
            place.write(vals)
        else:
            place = self.env['norma.place'].sudo().create(dict(vals, site_id=site.id, kind=kind))
        return place._public_dict()[0]

    @role('cashier')
    def housekeeping(self, id, state):
        place = self._own('norma.place', id)
        self._site(place.site_id.id)
        if state not in ('clean', 'dirty', 'maintenance'):
            raise UserError(_("État inconnu."))
        place.housekeeping = state
        return place._public_dict()[0]

    def _folio(self, folio_id):
        folio = self._own('norma.folio', folio_id, 'note')
        self._site(folio.site_id.id)
        return folio

    @role('cashier')
    def folio_open(self, place_id, customer_id=None, guests=1, checkout_planned=None, note=''):
        place = self._own('norma.place', place_id)
        self._site(place.site_id.id)
        if place.kind == 'room':
            if not customer_id:
                raise UserError(_("Enregistrez le client avant l'arrivée."))
            if place.housekeeping != 'clean':
                raise UserError(_("La chambre n'est pas prête (ménage ou maintenance)."))
        vals = {'site_id': place.site_id.id, 'place_id': place.id, 'guests': int(_num(guests or 1, _('Personnes'), 1, 500)),
                'note': _txt(note, 160) or False, 'opened_by': self.env.user.id}
        if customer_id:
            vals['customer_id'] = self._own('norma.customer', customer_id, 'client').id
        if checkout_planned:
            vals['checkout_planned'] = fields.Date.to_date(checkout_planned)
        folio = self.env['norma.folio'].sudo().create(vals)
        if place.kind == 'room':
            folio._post_nights()
        self._audit('folio.open', _("Ouverture : %s") % place.name, {'folio': folio.id})
        return folio._public_dict()

    @role('cashier')
    def folio_get(self, id):
        folio = self._folio(id)
        if folio.state == 'open' and folio.kind == 'room':
            folio._post_nights()
        return folio._public_dict()

    @role('cashier')
    def folio_add(self, id, product_id, quantity=1):
        folio = self._folio(id)
        if folio.state != 'open':
            raise UserError(_("Cette note est clôturée."))
        product = self._own('norma.product', product_id, 'article')
        if not product.active:
            raise UserError(_("Article archivé."))
        qty = _num(quantity, _('Quantité'), 0.001, 10000)
        line = folio.line_ids.filtered(lambda l: l.product_id == product and not l.sent and not l.is_night)[:1]
        if line:
            line.quantity += qty
        else:
            self.env['norma.folio.line'].sudo().create({'folio_id': folio.id, 'product_id': product.id,
                                                        'name': product.name, 'price': product.price, 'quantity': qty})
        return folio._public_dict()

    @role('cashier')
    def folio_remove(self, id, line_id):
        folio = self._folio(id)
        line = folio.line_ids.filtered(lambda l: l.id == _int(line_id, 'ligne'))
        if not line or folio.state != 'open':
            raise UserError(_("Ligne introuvable."))
        if (line.sent or line.is_night) and not self._is('manager'):
            raise AccessError(_("Seul un gestionnaire peut retirer une consommation envoyée ou une nuitée."))
        self._audit('folio.remove', _("Retrait de %s × %s sur %s") % (line.quantity, line.name, folio.place_id.name),
                    {'folio': folio.id, 'amount': line.price * line.quantity})
        if line.is_night:
            folio.nights_posted = max(0, folio.nights_posted - int(line.quantity))
        line.unlink()
        return folio._public_dict()

    @role('cashier')
    def folio_send(self, id):
        folio = self._folio(id)
        folio.line_ids.filtered(lambda l: not l.sent and not l.is_night).write({'sent': True})
        return folio._public_dict()

    @role('cashier')
    def folio_move(self, id, place_id):
        folio = self._folio(id)
        place = self._own('norma.place', place_id)
        if place.site_id != folio.site_id or place.kind != folio.kind:
            raise UserError(_("Destination incompatible."))
        folio.place_id = place
        return folio._public_dict()

    @role('cashier')
    def folio_checkout(self, id, payments=None, customer_id=None, invoice_type='FV'):
        folio = self._folio(id)
        if folio.state != 'open':
            raise UserError(_("Cette note est déjà clôturée."))
        if folio.kind == 'room':
            folio._post_nights()
        if not folio.line_ids:
            raise UserError(_("La note est vide."))
        if invoice_type not in ('FV', 'EV'):
            raise UserError(_("Type de facture non autorisé."))
        customer = self._own('norma.customer', customer_id, 'client') if customer_id else folio.customer_id or None
        lines = [{'product': l.product_id, 'quantity': l.quantity, 'name': l.name,
                  'price': l.price if l.price != l.product_id.price else None} for l in folio.line_ids]
        inv = self.env['norma.invoice']._build(folio.site_id, {
            'invoice_type': invoice_type, 'customer': customer, 'lines': lines,
            'payments': self._payments_from(payments),
            'origin': ('%s %s' % ('Chambre' if folio.kind == 'room' else 'Table', folio.place_id.name))[:80],
        }, self.env.user)
        folio.write({'state': 'invoiced', 'invoice_id': inv.id})
        if folio.kind == 'room':
            folio.place_id.housekeeping = 'dirty'
        inv._issue()
        return inv._public_dict(full=True)[0]

    @role('manager')
    def folio_cancel(self, id, reason=''):
        folio = self._folio(id)
        if folio.state != 'open':
            raise UserError(_("Note déjà clôturée."))
        if folio.line_ids.filtered(lambda l: not l.is_night or folio.nights_posted > 1):
            raise UserError(_("Retirez d'abord les consommations : une note facturable ne s'annule pas."))
        folio.line_ids.unlink()
        folio.state = 'cancelled'
        self._audit('folio.cancel', _("Annulation de la note %s : %s") % (folio.place_id.name, _txt(reason, 120)),
                    {'folio': folio.id})
        return True

    # ================================================================ tableau de bord et rapports
    def _day_bounds(self, day):
        tz_now = fields.Datetime.context_timestamp(self, fields.Datetime.now())
        offset = tz_now.utcoffset() or timedelta(0)
        start = datetime.combine(day, time.min) - offset
        return start, start + timedelta(days=1)

    @role('cashier')
    def dashboard(self, site_id=None):
        company = self._company()
        Inv = self.env['norma.invoice'].sudo()
        base = [('company_id', '=', company.id)]
        if site_id:
            base.append(('site_id', '=', self._site(site_id).id))
        elif not self._is('manager'):
            base.append(('site_id', 'in', self.env.user._norma_sites().ids))
        today = fields.Datetime.context_timestamp(self, fields.Datetime.now()).date()
        start, end = self._day_bounds(today)
        month_start, _e = self._day_bounds(today.replace(day=1))

        def totals(domain):
            sales = Inv.search(domain + [('state', '=', 'normalized'), ('invoice_type', 'in', ('FV', 'FT', 'EV', 'ET'))])
            credits = Inv.search(domain + [('state', '=', 'normalized'), ('invoice_type', 'in', ('FA', 'EA'))])
            return {'count': len(sales), 'total': round(sum(sales.mapped('total')) - sum(credits.mapped('total')), 2),
                    'tax': round(sum(sales.mapped('total_tax')) - sum(credits.mapped('total_tax')), 2),
                    'credits': len(credits)}

        day = totals(base + [('date', '>=', start), ('date', '<', end)])
        month = totals(base + [('date', '>=', month_start)])
        series = []
        for i in range(13, -1, -1):
            d = today - timedelta(days=i)
            s, e = self._day_bounds(d)
            t = totals(base + [('date', '>=', s), ('date', '<', e)])
            series.append({'date': fields.Date.to_string(d), 'total': t['total'], 'count': t['count']})
        pay = {}
        for p in self.env['norma.invoice.payment'].sudo().search([('invoice_id', 'in', Inv.search(
                base + [('state', '=', 'normalized'), ('date', '>=', start), ('date', '<', end),
                        ('invoice_type', 'in', ('FV', 'FT', 'EV', 'ET'))]).ids)]):
            pay[p.method] = round(pay.get(p.method, 0) + p.amount_cdf, 2)
        attention = Inv.search_count(base + [('state', 'in', ('failed', 'uncertain'))])
        recent = Inv.search(base + [('state', '!=', 'draft')], limit=8)
        sites = self.env.user._norma_sites()
        return {'today': day, 'month': month, 'series': series, 'attention': attention,
                'payments': [{'method': k, 'label': dict(PAYMENT_METHODS)[k], 'amount': v} for k, v in pay.items()],
                'recent': recent._public_dict(),
                'sites': [{'id': s.id, 'name': s.name, 'code': s.code, 'emcf_status': s.emcf_status,
                           'emcf_mode': s.emcf_mode} for s in sites]}

    @role('manager')
    def report(self, date_from, date_to, site_id=None):
        """Rapport fiscal de période : ventilation par type, groupe de taxation, mode de paiement et établissement."""
        company = self._company()
        d_from, d_to = fields.Date.to_date(date_from), fields.Date.to_date(date_to)
        if not d_from or not d_to or d_to < d_from or (d_to - d_from).days > 366:
            raise UserError(_("Période invalide (un an au maximum)."))
        start, _x = self._day_bounds(d_from)
        _y, end = self._day_bounds(d_to)
        domain = [('company_id', '=', company.id), ('state', '=', 'normalized'), ('date', '>=', start), ('date', '<', end)]
        if site_id:
            domain.append(('site_id', '=', self._site(site_id).id))
        invs = self.env['norma.invoice'].sudo().search(domain, order='date')
        by_type, by_group, by_pay, by_site = {}, {}, {}, {}
        for inv in invs:
            sign = -1 if inv.invoice_type in ('FA', 'EA') else 1
            t = by_type.setdefault(inv.invoice_type, {'type': inv.invoice_type, 'label': dict(INVOICE_TYPES)[inv.invoice_type],
                                                       'count': 0, 'total': 0.0, 'tax': 0.0, 'ht': 0.0})
            t['count'] += 1
            t['total'] += inv.total
            t['tax'] += inv.total_tax
            t['ht'] += inv.total_ht
            for g in inv.group_ids:
                b = by_group.setdefault(g.code, {'code': g.code, 'rate': g.rate, 'base': 0.0, 'tax': 0.0, 'ttc': 0.0})
                b['base'] += sign * g.base
                b['tax'] += sign * g.tax
                b['ttc'] += sign * g.ttc
            for p in inv.payment_ids:
                by_pay[p.method] = by_pay.get(p.method, 0.0) + sign * p.amount_cdf
            s = by_site.setdefault(inv.site_id.id, {'site': inv.site_id.name, 'code': inv.site_id.code, 'count': 0, 'total': 0.0})
            s['count'] += 1
            s['total'] += sign * inv.total
        r = lambda v: round(v, 2)
        net_total = sum(sign_total for sign_total in (
            (-1 if i.invoice_type in ('FA', 'EA') else 1) * i.total for i in invs))
        net_tax = sum((-1 if i.invoice_type in ('FA', 'EA') else 1) * i.total_tax for i in invs)
        return {
            'company': self._company_dict(company), 'date_from': date_from, 'date_to': date_to,
            'count': len(invs), 'net_total': r(net_total), 'net_tax': r(net_tax),
            'by_type': [dict(v, total=r(v['total']), tax=r(v['tax']), ht=r(v['ht'])) for v in by_type.values()],
            'by_group': [dict(v, base=r(v['base']), tax=r(v['tax']), ttc=r(v['ttc'])) for k, v in sorted(by_group.items())],
            'by_payment': [{'method': k, 'label': dict(PAYMENT_METHODS)[k], 'amount': r(v)} for k, v in by_pay.items()],
            'by_site': [dict(v, total=r(v['total'])) for v in by_site.values()],
            'first': invs[:1].number or '', 'last': invs[-1:].number or '',
            'attention': self.env['norma.invoice'].sudo().search_count(
                [('company_id', '=', company.id), ('state', 'in', ('failed', 'uncertain'))]),
        }

    @role('manager')
    def audit(self, offset=0, limit=50):
        company = self._company()
        Audit = self.env['norma.audit'].sudo()
        recs = Audit.search([('company_id', '=', company.id)], offset=max(0, int(offset or 0)),
                            limit=max(1, min(int(limit or 50), 200)))
        return {
            'total': Audit.search_count([('company_id', '=', company.id)]),
            'items': [{'sequence': a.sequence, 'event': a.event, 'message': a.message, 'user': a.user_id.name or '',
                       'date': fields.Datetime.to_string(a.create_date), 'ip': a.ip or '', 'hash': a.hash,
                       'invoice_id': a.invoice_id.id or False} for a in recs],
        }

    @role('manager')
    def integrity(self):
        company = self._company()
        return {'audit': self.env['norma.audit']._verify(company),
                'invoices': self.env['norma.invoice']._chain_verify(company)}

    @role('admin')
    def emcf_logs(self, site_id=None, offset=0, limit=50):
        domain = [('company_id', '=', self._company().id)]
        if site_id:
            domain.append(('site_id', '=', self._site(site_id).id))
        Log = self.env['norma.emcf.log'].sudo()
        recs = Log.search(domain, offset=max(0, int(offset or 0)), limit=max(1, min(int(limit or 50), 200)))
        return {'total': Log.search_count(domain), 'items': [{
            'id': l.id, 'date': fields.Datetime.to_string(l.create_date), 'site': l.site_id.code or '',
            'invoice': l.invoice_id.number or '', 'method': l.method, 'path': l.path, 'status': l.http_status,
            'duration': l.duration_ms, 'error': l.error or '', 'mode': l.mode,
            'request': l.request or '', 'response': l.response or ''} for l in recs]}

    # ================================================================ paramètres (administrateur)
    @role('manager')
    def set_rate(self, usd_rate):
        rate = _num(usd_rate, _('Taux'), 1, 1e7)
        company = self._company()
        old = company.norma_usd_rate
        company.norma_usd_rate = rate
        self._audit('company.rate', _("Taux du jour : %s → %s CDF pour 1 USD") % (old, rate), {'rate': rate})
        return rate

    @role('admin')
    def company_save(self, **vals):
        company = self._company()
        data = {
            'name': _txt(vals.get('name'), 120) or company.name,
            'norma_nif': _txt(vals.get('nif'), 32).upper() or False, 'norma_rccm': _txt(vals.get('rccm'), 60) or False,
            'norma_idnat': _txt(vals.get('idnat'), 60) or False,
            'norma_tax_center': _txt(vals.get('tax_center'), 80) or False,
            'street': _txt(vals.get('address'), 160) or False, 'city': _txt(vals.get('city'), 60) or False,
            'phone': _txt(vals.get('phone'), 40) or False, 'email': _txt(vals.get('email'), 120) or False,
            'norma_invoice_footer': _txt(vals.get('footer'), 200) or False,
            'norma_max_discount': _num(vals.get('max_discount') or 0, _('Remise maximale'), 0, 100),
        }
        if vals.get('regime') in ('reel', 'ipr'):
            data['norma_tax_regime'] = vals['regime']
        if vals.get('currency') in ('CDF', 'USD'):
            data['norma_currency'] = vals['currency']
        if re.match(r'^#[0-9A-Fa-f]{6}$', vals.get('color') or ''):
            data['norma_brand_color'] = vals['color']
        if data['email'] and not EMAIL_RE.match(data['email']):
            raise UserError(_("Adresse e-mail invalide."))
        if company.norma_nif and data['norma_nif'] != company.norma_nif and self.env['norma.invoice'].sudo().search_count(
                [('company_id', '=', company.id), ('state', '=', 'normalized')]):
            raise UserError(_("Le NIF ne se modifie plus après la première facture normalisée."))
        identity_changed = any((data[f] or False) != (company[f] or False) for f in ('norma_nif', 'norma_rccm', 'norma_idnat'))
        try:
            company.write(data)
        except ValidationError as exc:
            raise UserError(exc.args[0])
        if identity_changed and company.norma_verified:
            # L'identité fiscale vérifiée par la plateforme a changé : nouvelle vérification obligatoire.
            company.norma_verified = False
            company.norma_site_ids.write({'emcf_mode': 'simulation', 'emcf_status': 'unknown', 'emcf_nif_mismatch': True})
            self._audit('company.unverified', _("Identité fiscale modifiée : vérification de la plateforme à refaire, "
                                                "établissements repassés en simulation"), {})
        if vals.get('logo'):
            raw = base64.b64decode(str(vals['logo']).split(',')[-1], validate=False)
            if len(raw) > 1024 * 1024:
                raise UserError(_("Logo trop lourd (1 Mo maximum)."))
            if not (raw[:8] == b'\x89PNG\r\n\x1a\n' or raw[:3] == b'\xff\xd8\xff'):
                raise UserError(_("Logo au format PNG ou JPEG uniquement."))
            company.logo = base64.b64encode(raw)
        self._audit('company.save', _("Mise à jour du profil de l'entreprise"), {k: v for k, v in data.items() if k != 'name'})
        return self._company_dict(company)

    @role('admin')
    def sites_admin(self):
        sites = self.env['norma.site'].sudo().with_context(active_test=False).search([('company_id', '=', self._company().id)])
        out = sites._public_dict()
        for d, s in zip(out, sites):
            d['emcf_url'] = s.emcf_url or ''
            d['has_token'] = bool(s.emcf_token)
        return out

    @role('admin')
    def site_save(self, id=None, **vals):
        company = self._company()
        data = {'name': _txt(vals.get('name'), 80), 'code': _txt(vals.get('code'), 24).upper(),
                'address': _txt(vals.get('address'), 160) or False, 'city': _txt(vals.get('city'), 60) or False,
                'province': _txt(vals.get('province'), 60) or False, 'phone': _txt(vals.get('phone'), 40) or False,
                'active': bool(vals.get('active', True))}
        if not data['name'] or not data['code']:
            raise UserError(_("Nom et code de l'établissement obligatoires."))
        mode = vals.get('emcf_mode')
        if mode in ('simulation', 'test', 'production'):
            data['emcf_mode'] = mode
        if 'emcf_isf' in vals:
            isf = _txt(vals.get('emcf_isf'), 10).upper()
            if isf and not re.match(r'^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{2}$', isf):
                raise UserError(_("Format de l'ISF attendu : AAA-BBB-NN (fourni par la DGI)."))
            data['emcf_isf'] = isf or False
        if 'emcf_url' in vals:
            url = _txt(vals.get('emcf_url'), 200)
            if url and (not re.match(r'^https://[A-Za-z0-9.\-]+(/[A-Za-z0-9._~\-/]*)?$', url)
                        or not self.env['norma.site']._emcf_url_allowed(url)):
                raise UserError(_("Adresse de l'API e-MCF non reconnue : utilisez l'adresse officielle de la DGI "
                                  "(test : https://developper.dgirdc.cd/edef, production : https://edef.dgirdc.cd)."))
            data['emcf_url'] = url or False
        if vals.get('emcf_token'):
            data['emcf_token'] = _txt(vals['emcf_token'], 4000)
        Site = self.env['norma.site'].sudo()
        if id:
            site = Site.with_context(active_test=False).browse(_int(id)).exists()
            if not site or site.company_id != company:
                raise AccessError(_("Établissement introuvable."))
            if site.code != data['code'] and self.env['norma.invoice'].sudo().search_count([('site_id', '=', site.id)]):
                raise UserError(_("Le code d'un établissement qui a déjà facturé ne se modifie plus."))
            if (data.get('emcf_mode', site.emcf_mode) != site.emcf_mode or 'emcf_token' in data
                    or data.get('emcf_url', site.emcf_url) != site.emcf_url):
                # Nouveau jeton, nouvelle adresse ou nouveau mode : aucune transmission avant un test de connexion
                # réussi qui confirme le NIF du jeton.
                data.update(emcf_status='unknown', emcf_status_message=False, emcf_nim=False, emcf_nif_mismatch=True)
        if data.get('emcf_mode') in ('test', 'production') and not company.norma_verified:
            raise UserError(_("Votre entreprise doit d'abord être vérifiée par l'administration NORMA (NIF, RCCM, "
                              "mandat) avant de relier l'e-MCF de la DGI. Contactez le support."))
        if data.get('emcf_mode') == 'production' and not ((data.get('emcf_url') or (id and site.emcf_url))
                                                          and (data.get('emcf_token') or (id and site.emcf_token))):
            raise UserError(_("Le mode production exige l'adresse de l'API et le jeton e-MCF."))
        try:
            if id:
                site.write(data)
            else:
                site = Site.create(dict(data, company_id=company.id, emcf_nif_mismatch=data.get('emcf_mode', 'simulation') != 'simulation'))
        except ValidationError as exc:
            raise UserError(exc.args[0])
        self._audit('site.save', _("Établissement %s (%s) — mode %s") % (site.name, site.code, site.emcf_mode),
                    {'site': site.id, 'mode': site.emcf_mode, 'token_changed': bool(vals.get('emcf_token'))})
        return self.sites_admin()

    @role('admin')
    def site_check(self, id):
        site = self.env['norma.site'].sudo().with_context(active_test=False).browse(_int(id)).exists()
        if not site or site.company_id != self._company():
            raise AccessError(_("Établissement introuvable."))
        self.env['norma.emcf']._status(site)
        return self.sites_admin()

    @role('admin')
    def users(self):
        company = self._company()
        users = self.env['res.users'].sudo().with_context(active_test=False).search(
            [('company_id', '=', company.id), ('share', '=', True)])
        return [{'id': u.id, 'name': u.name, 'login': u.login, 'active': u.active, 'role': u._norma_role(),
                 'site_ids': u.norma_site_ids.ids, 'is_owner': u == company.norma_owner_id,
                 'last_login': fields.Datetime.to_string(u.login_date) if u.login_date else ''}
                for u in users if u._norma_role()]

    @role('admin')
    def user_save(self, id=None, name='', login='', role='cashier', site_ids=None, password='', active=True):
        company = self._company()
        if role not in ROLE_RANK:
            raise UserError(_("Rôle inconnu."))
        name, login = _txt(name, 80), _txt(login, 120).lower()
        if not name or not EMAIL_RE.match(login):
            raise UserError(_("Nom et adresse e-mail (identifiant) obligatoires."))
        sites = self.env['norma.site'].sudo().browse([_int(s, 'site') for s in (site_ids or [])]).exists()
        if any(s.company_id != company for s in sites):
            raise AccessError(_("Établissement non autorisé."))
        groups = [self.env.ref('base.group_portal').id,
                  self.env.ref('norma_facture.group_norma_%s' % role).id]
        Users = self.env['res.users'].sudo().with_context(no_reset_password=True, active_test=False)
        if id:
            user = Users.browse(_int(id)).exists()
            if not user or user.company_id != company or not user.share:
                raise AccessError(_("Utilisateur introuvable."))
            if user == company.norma_owner_id and (role != 'admin' or not active):
                raise UserError(_("L'administrateur principal garde son rôle et reste actif."))
            if user == self.env.user and (role != 'admin' or not active):
                raise UserError(_("Vous ne pouvez pas retirer vos propres droits d'administrateur."))
            if user == company.norma_owner_id and self.env.user != user and (password or login != user.login):
                raise AccessError(_("Seul l'administrateur principal modifie son identifiant et son mot de passe."))
            vals = {'name': name, 'active': bool(active), 'norma_site_ids': [(6, 0, sites.ids)],
                    'groups_id': [(3, self.env.ref('norma_facture.group_norma_%s' % r).id) for r in ROLE_RANK]}
            user.write(vals)
            user.write({'groups_id': [(4, g) for g in groups]})
            if login != user.login:
                if Users.search_count([('login', '=', login)]):
                    raise UserError(_("Cet identifiant est déjà utilisé."))
                user.login = login
        else:
            if Users.search_count([('login', '=', login)]):
                raise UserError(_("Cet identifiant est déjà utilisé."))
            if len(password or '') < 10:
                raise UserError(_("Mot de passe : 10 caractères au moins."))
            user = Users.create({
                'name': name, 'login': login, 'email': login, 'password': password,
                'company_id': company.id, 'company_ids': [(6, 0, [company.id])],
                'groups_id': [(6, 0, groups)], 'norma_site_ids': [(6, 0, sites.ids)],
                'lang': self.env.user.lang,
            })
            user.partner_id.company_id = company
        if password and id:
            if len(password) < 10:
                raise UserError(_("Mot de passe : 10 caractères au moins."))
            user.password = password
        self._audit('user.save', _("Utilisateur %s : rôle %s") % (user.login, ROLE_LABELS[role]),
                    {'user': user.id, 'role': role, 'sites': sites.ids, 'active': user.active})
        return self.users()
