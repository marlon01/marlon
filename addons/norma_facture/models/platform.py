# -*- coding: utf-8 -*-
"""Inscription des entreprises et administration centrale de la plateforme."""
import logging
import re

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError

from .company import NIF_RE, SITE_CODE_RE

_logger = logging.getLogger(__name__)
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')

# Catalogue de départ par interface : l'entreprise peut facturer dès l'inscription, puis l'adapte.
STARTER = {
    'pos': {
        'categories': [('Alimentation', '#0E7C66'), ('Boissons', '#1D4ED8'), ('Hygiène', '#9333EA')],
        'products': [
            ('Riz parfumé 5 kg', 'Alimentation', 32000, 'C', 'BIE', 'goods', '6001000000017'),
            ('Huile végétale 1 L', 'Alimentation', 9500, 'C', 'BIE', 'goods', '6001000000024'),
            ('Sucre 1 kg', 'Alimentation', 4800, 'C', 'BIE', 'goods', '6001000000031'),
            ('Eau minérale 1,5 L', 'Boissons', 1500, 'B', 'BIE', 'goods', '6001000000048'),
            ('Jus de fruits 1 L', 'Boissons', 6500, 'B', 'BIE', 'goods', '6001000000055'),
            ('Savon de ménage', 'Hygiène', 2500, 'B', 'BIE', 'goods', '6001000000062'),
        ],
    },
    'hotel': {
        'categories': [('Hébergement', '#0E4D64'), ('Restaurant & bar', '#B45309'), ('Services', '#6D28D9')],
        'products': [
            ('Nuitée chambre standard', 'Hébergement', 120000, 'B', 'SER', 'room', None),
            ('Nuitée chambre supérieure', 'Hébergement', 180000, 'B', 'SER', 'room', None),
            ('Nuitée suite', 'Hébergement', 300000, 'B', 'SER', 'room', None),
            ('Petit-déjeuner', 'Restaurant & bar', 25000, 'B', 'SER', 'dish', None),
            ('Dîner', 'Restaurant & bar', 45000, 'B', 'SER', 'dish', None),
            ('Boisson minibar', 'Restaurant & bar', 8000, 'B', 'BIE', 'dish', None),
            ('Blanchisserie', 'Services', 15000, 'B', 'SER', 'service', None),
            ('Transfert aéroport', 'Services', 90000, 'B', 'SER', 'service', None),
        ],
        'rooms': [('101', '1er étage', 0), ('102', '1er étage', 0), ('103', '1er étage', 1), ('201', '2e étage', 1),
                  ('202', '2e étage', 1), ('301', '3e étage', 2)],
    },
    'restaurant': {
        'categories': [('Entrées', '#15803D'), ('Plats', '#B45309'), ('Boissons', '#1D4ED8'), ('Desserts', '#BE185D')],
        'products': [
            ('Salade de saison', 'Entrées', 15000, 'B', 'SER', 'dish', None),
            ('Poulet moambe', 'Plats', 35000, 'B', 'SER', 'dish', None),
            ('Liboke de poisson', 'Plats', 40000, 'B', 'SER', 'dish', None),
            ('Pondu et chikwangue', 'Plats', 25000, 'B', 'SER', 'dish', None),
            ('Bière 65 cl', 'Boissons', 7000, 'B', 'BIE', 'dish', None),
            ('Eau minérale 50 cl', 'Boissons', 3000, 'B', 'BIE', 'dish', None),
            ('Jus naturel', 'Boissons', 8000, 'B', 'BIE', 'dish', None),
            ('Salade de fruits', 'Desserts', 12000, 'B', 'SER', 'dish', None),
        ],
        'tables': [('T1', 'Salle', 4), ('T2', 'Salle', 4), ('T3', 'Salle', 2), ('T4', 'Salle', 6),
                   ('T5', 'Terrasse', 4), ('T6', 'Terrasse', 4), ('T7', 'Terrasse', 8), ('VIP', 'Salon', 10)],
    },
    'invoice': {
        'categories': [('Prestations', '#0E4D64'), ('Fournitures', '#B45309')],
        'products': [
            ('Prestation de conseil (jour)', 'Prestations', 450000, 'B', 'SER', 'service', None),
            ('Maintenance mensuelle', 'Prestations', 250000, 'B', 'SER', 'service', None),
            ('Formation (participant)', 'Prestations', 150000, 'B', 'SER', 'service', None),
            ('Matériel fourni', 'Fournitures', 100000, 'B', 'BIE', 'goods', None),
            ('Débours (frais refacturés)', 'Fournitures', 10000, 'J', 'TAX', 'service', None),
        ],
    },
}


class NormaPlatform(models.AbstractModel):
    _name = 'norma.platform'
    _description = 'Plateforme NORMA'

    # ================================================================ inscription
    @api.model
    def _validate_signup(self, data):
        def need(key, label, size=120):
            v = (str(data.get(key) or '')).strip()[:size]
            if not v:
                raise UserError(_("%s est obligatoire.") % label)
            return v
        vals = {
            'company': need('company', _("Le nom de l'entreprise")),
            'contact': need('contact', _("Votre nom"), 80),
            'email': need('email', _("L'adresse e-mail")).lower(),
            'phone': (str(data.get('phone') or '')).strip()[:40],
            'password': str(data.get('password') or ''),
            'nif': need('nif', _("Le NIF"), 32).upper(),
            'rccm': (str(data.get('rccm') or '')).strip()[:60],
            'idnat': (str(data.get('idnat') or '')).strip()[:60],
            'address': need('address', _("L'adresse"), 160),
            'city': (str(data.get('city') or 'Kinshasa')).strip()[:60],
            'site_name': (str(data.get('site_name') or '')).strip()[:80],
            'site_code': (str(data.get('site_code') or '')).strip().upper()[:24],
            'regime': data.get('regime') if data.get('regime') in ('reel', 'ipr') else 'reel',
            'currency': data.get('currency') if data.get('currency') in ('CDF', 'USD') else 'CDF',
        }
        if not EMAIL_RE.match(vals['email']):
            raise UserError(_("Adresse e-mail invalide."))
        if len(vals['password']) < 10 or vals['password'].isdigit() or vals['password'].isalpha():
            raise UserError(_("Mot de passe : 10 caractères au moins, avec des lettres et des chiffres."))
        if not NIF_RE.match(vals['nif']):
            raise UserError(_("NIF invalide (lettres majuscules, chiffres, tirets)."))
        if vals['site_code'] and not SITE_CODE_RE.match(vals['site_code']):
            raise UserError(_("Code établissement invalide (majuscules, chiffres et tirets)."))
        category = self.env['norma.category'].sudo().search([('code', '=', data.get('category')), ('active', '=', True)], limit=1)
        if not category:
            raise UserError(_("Choisissez votre catégorie d'activité."))
        vals['category'] = category
        if self.env['res.users'].sudo().with_context(active_test=False).search_count([('login', '=', vals['email'])]):
            raise UserError(_("Un compte existe déjà avec cette adresse e-mail. Connectez-vous."))
        if self.env['res.company'].sudo().search_count([('norma_nif', '=', vals['nif'])]):
            raise UserError(_("Une entreprise est déjà inscrite avec ce NIF. Contactez le support."))
        return vals

    @api.model
    def _signup(self, vals, ip=None):
        env = self.env(su=True)
        company = env['res.company'].create({
            'name': vals['company'], 'email': vals['email'], 'phone': vals['phone'] or False,
            'street': vals['address'], 'city': vals['city'], 'country_id': env.ref('base.cd').id,
            'currency_id': (env.ref('base.CDF', raise_if_not_found=False) or env.ref('base.USD')).id,
            'norma_enabled': True, 'norma_category_id': vals['category'].id, 'norma_nif': vals['nif'],
            'norma_rccm': vals['rccm'] or False, 'norma_idnat': vals['idnat'] or False,
            'norma_tax_regime': vals['regime'], 'norma_currency': vals['currency'],
            'norma_usd_rate': 2850.0 if vals['currency'] == 'USD' else 0, 'norma_signup_ip': ip,
        })
        site = env['norma.site'].create({
            'company_id': company.id, 'name': vals['site_name'] or _("Siège"),
            'code': vals['site_code'] or 'ETS-001', 'address': vals['address'], 'city': vals['city'],
            'emcf_mode': 'simulation',
        })
        lang = 'fr_FR' if env['res.lang']._lang_get('fr_FR') else (env.lang or 'en_US')
        user = env['res.users'].with_context(no_reset_password=True).create({
            'name': vals['contact'], 'login': vals['email'], 'email': vals['email'], 'password': vals['password'],
            'company_id': company.id, 'company_ids': [(6, 0, [company.id])], 'lang': lang,
            'groups_id': [(6, 0, [env.ref('base.group_portal').id, env.ref('norma_facture.group_norma_admin').id])],
        })
        user.partner_id.write({'company_id': company.id, 'phone': vals['phone'] or False})
        company.partner_id.company_id = company
        company.norma_owner_id = user
        self._seed_starter(company, site)
        env['norma.audit']._log(company, 'company.signup', _("Création du compte de l'entreprise"),
                                {'category': vals['category'].code, 'site': site.code}, user=user, ip=ip)
        _logger.info("NORMA : nouvelle entreprise %s (#%s), catégorie %s", company.name, company.id, vals['category'].code)
        return company

    @api.model
    def _seed_starter(self, company, site):
        env = self.env(su=True)
        workspace = company.norma_category_id.workspace or 'invoice'
        starter = STARTER.get(workspace, STARTER['invoice'])
        groups = {g.code: g for g in env['norma.tax.group'].search([])}
        cats = {}
        for i, (name, color) in enumerate(starter['categories']):
            cats[name] = env['norma.product.category'].create({'company_id': company.id, 'name': name,
                                                               'color': color, 'sequence': i})
        products = []
        for name, cat, price, group, itype, kind, barcode in starter['products']:
            g = groups.get(group) or groups.get('B')
            if company.norma_tax_regime != 'reel':
                g = groups.get('A') or g
            products.append(env['norma.product'].create({
                'company_id': company.id, 'name': name, 'category_id': cats[cat].id, 'price': price,
                'tax_group_id': g.id, 'item_type': itype, 'kind': kind, 'barcode': barcode,
            }))
        rates = [p for p in products if p.kind == 'room']
        for name, zone, idx in starter.get('rooms', []):
            env['norma.place'].create({'site_id': site.id, 'kind': 'room', 'name': name, 'zone': zone,
                                       'rate_product_id': rates[min(idx, len(rates) - 1)].id})
        for name, zone, cap in starter.get('tables', []):
            env['norma.place'].create({'site_id': site.id, 'kind': 'table', 'name': name, 'zone': zone, 'capacity': cap})

    # ================================================================ administration centrale
    def _check_platform(self):
        if not self.env.user._norma_is_platform():
            raise AccessError(_("Réservé à l'administration centrale."))

    @api.private
    @api.model
    def overview(self):
        self._check_platform()
        Company = self.env['res.company'].sudo()
        Inv = self.env['norma.invoice'].sudo()
        companies = Company.search([('norma_enabled', '=', True)], order='create_date desc')
        month = fields.Datetime.now().replace(day=1, hour=0, minute=0, second=0)
        rows = []
        for c in companies:
            sites = c.norma_site_ids
            rows.append({
                'id': c.id, 'name': c.name, 'nif': c.norma_nif or '', 'category': c.norma_category_id.name or '',
                'state': c.norma_state, 'created': fields.Datetime.to_string(c.create_date),
                'sites': len(sites), 'sites_prod': len(sites.filtered(lambda s: s.emcf_mode == 'production')),
                'sites_error': len(sites.filtered(lambda s: s.emcf_status == 'error')),
                'invoices_month': Inv.search_count([('company_id', '=', c.id), ('state', '=', 'normalized'),
                                                    ('date', '>=', month)]),
                'attention': Inv.search_count([('company_id', '=', c.id), ('state', 'in', ('failed', 'uncertain'))]),
                'owner': c.norma_owner_id.login or '', 'verified': c.norma_verified,
            })
        by_cat = {}
        for r in rows:
            by_cat[r['category']] = by_cat.get(r['category'], 0) + 1
        return {
            'companies': rows, 'count': len(rows), 'active': len([r for r in rows if r['state'] == 'active']),
            'invoices_month': sum(r['invoices_month'] for r in rows), 'attention': sum(r['attention'] for r in rows),
            'by_category': [{'name': k, 'count': v} for k, v in by_cat.items()],
            'tax_groups': self.env['norma.tax.group'].sudo().with_context(active_test=False).search([])._public_dict(),
        }

    @api.private
    @api.model
    def set_state(self, company_id, state):
        self._check_platform()
        company = self.env['res.company'].sudo().browse(int(company_id)).exists()
        if not company or not company.norma_enabled or state not in ('active', 'suspended'):
            raise UserError(_("Entreprise introuvable."))
        company.norma_state = state
        self.env['norma.audit']._log(company, 'platform.state', _("Compte %s par la plateforme") %
                                     (_("réactivé") if state == 'active' else _("suspendu")), {'state': state})
        return True

    @api.private
    @api.model
    def set_verified(self, company_id, verified):
        """Vérification de l'entreprise (pièces : RCCM, NIF, mandat du signataire) avant tout lien avec la DGI."""
        self._check_platform()
        company = self.env['res.company'].sudo().browse(int(company_id)).exists()
        if not company or not company.norma_enabled:
            raise UserError(_("Entreprise introuvable."))
        company.norma_verified = bool(verified)
        if not verified:
            company.norma_site_ids.write({'emcf_mode': 'simulation'})
        self.env['norma.audit']._log(company, 'platform.verified', _("Vérification de l'entreprise : %s") %
                                     (_("accordée") if verified else _("retirée")), {'verified': bool(verified)})
        return True

    @api.private
    @api.model
    def tax_group_save(self, code, name, rate, kind, active=True):
        self._check_platform()
        code = (code or '').strip().upper()[:2]
        if not re.match(r'^[A-Z]{1,2}$', code):
            raise UserError(_("Code de groupe invalide."))
        if kind not in ('taxable', 'exempt', 'export', 'specific'):
            raise UserError(_("Nature inconnue."))
        Group = self.env['norma.tax.group'].sudo().with_context(active_test=False)
        vals = {'name': (name or code)[:120], 'rate': float(rate or 0), 'kind': kind, 'active': bool(active)}
        group = Group.search([('code', '=', code)], limit=1)
        if group:
            group.write(vals)
        else:
            Group.create(dict(vals, code=code))
        return self.overview()['tax_groups']
