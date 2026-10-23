# -*- coding: utf-8 -*-
"""Entreprise cliente, catégories d'activité et établissements (sites) déclarés à la DGI."""
import re
import secrets

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError

NIF_RE = re.compile(r'^[A-Z0-9][A-Z0-9\-/ ]{4,30}$')
SITE_CODE_RE = re.compile(r'^[A-Z0-9][A-Z0-9\-]{1,23}$')

WORKSPACES = [
    ('pos', "Caisse rapide (supermarché, magasin, pharmacie)"),
    ('hotel', "Hôtellerie (chambres, séjours, notes)"),
    ('restaurant', "Restauration (tables, additions)"),
    ('invoice', "Facturation classique (services, B2B)"),
]


class NormaCategory(models.Model):
    _name = 'norma.category'
    _description = "Catégorie d'activité"
    _order = 'sequence, id'

    code = fields.Char(required=True)
    name = fields.Char(required=True, translate=True)
    description = fields.Char(translate=True)
    workspace = fields.Selection(WORKSPACES, required=True,
                                 help="Interface de vente proposée aux entreprises de cette catégorie.")
    icon = fields.Char(default='store')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _sql_constraints = [('code_unique', 'unique(code)', "Code de catégorie déjà utilisé.")]

    def _public_dict(self):
        return [{'code': c.code, 'name': c.name, 'description': c.description or '', 'workspace': c.workspace,
                 'icon': c.icon} for c in self]


class ResCompany(models.Model):
    _inherit = 'res.company'

    # Deux commerces peuvent porter le même nom (dans deux villes) : l'identifiant fiscal est le NIF.
    _sql_constraints = [
        ('name_uniq', 'CHECK(true)', "Nom de société"),
        ('norma_nif_uniq', 'unique(norma_nif)', "Une entreprise est déjà inscrite avec ce NIF."),
    ]

    norma_enabled = fields.Boolean(string="Entreprise NORMA", default=False, index=True)
    norma_category_id = fields.Many2one('norma.category', string="Catégorie d'activité")
    norma_state = fields.Selection([('active', 'Active'), ('suspended', 'Suspendue')], default='active')
    norma_nif = fields.Char("NIF (numéro impôt)")
    norma_rccm = fields.Char("RCCM")
    norma_idnat = fields.Char("Identification nationale")
    norma_tax_regime = fields.Selection([
        ('reel', "Régime réel — assujetti à la TVA"),
        ('ipr', "Impôt professionnel (non assujetti)"),
    ], default='reel', string="Régime fiscal")
    norma_tax_center = fields.Char("Centre des impôts de rattachement")
    norma_brand_color = fields.Char(default='#0E4D64')
    norma_invoice_footer = fields.Char("Mention de pied de facture")
    norma_currency = fields.Selection([('CDF', 'Franc congolais (CDF)'), ('USD', 'Dollar américain (USD)')],
                                      default='CDF', string="Devise de facturation")
    norma_usd_rate = fields.Float("Taux du jour (CDF pour 1 USD)", digits=(16, 4), default=0)
    norma_verified = fields.Boolean("Entreprise vérifiée par la plateforme", default=False, copy=False,
                                    help="Identité et NIF contrôlés par l'administration centrale : condition pour relier l'e-MCF de la DGI.")
    norma_max_discount = fields.Float("Remise maximale du caissier (%)", default=10)
    norma_owner_id = fields.Many2one('res.users', string="Administrateur principal")
    norma_signup_ip = fields.Char()
    norma_site_ids = fields.One2many('norma.site', 'company_id')

    @api.constrains('norma_nif')
    def _check_nif(self):
        for c in self:
            if c.norma_nif and not NIF_RE.match(c.norma_nif):
                raise ValidationError(_("Le NIF ne contient que des lettres majuscules, chiffres, tirets ou barres."))


class NormaSite(models.Model):
    """Établissement / point de vente. Son code est transmis à la DGI avec chaque facture."""
    _name = 'norma.site'
    _description = "Établissement (site)"
    _order = 'company_id, code'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda s: s.env.company)
    name = fields.Char(required=True)
    code = fields.Char("Code établissement", required=True,
                       help="Code de l'établissement communiqué par la DGI, imprimé et transmis avec chaque facture.")
    address = fields.Char("Adresse")
    city = fields.Char("Ville", default='Kinshasa')
    province = fields.Char("Province", default='Kinshasa')
    phone = fields.Char()
    active = fields.Boolean(default=True)

    # ---------------------------------------------------------------- dispositif électronique fiscal
    emcf_mode = fields.Selection([
        ('simulation', "Simulation (démonstration, sans valeur fiscale)"),
        ('test', "Environnement de test DGI (homologation)"),
        ('production', "Production DGI"),
    ], default='simulation', required=True, string="Mode e-MCF")
    emcf_url = fields.Char("Adresse de l'API e-MCF", groups='norma_facture.group_norma_admin')
    emcf_token = fields.Char("Jeton d'accès e-MCF", groups='norma_facture.group_norma_admin', copy=False)
    emcf_isf = fields.Char("Identifiant du système de facturation (ISF)", copy=False)
    emcf_nim = fields.Char("NIM (numéro du module)", readonly=True, copy=False)
    emcf_status = fields.Selection([('unknown', 'Non vérifié'), ('ok', 'Connecté'), ('error', 'Erreur')],
                                   default='unknown', readonly=True, copy=False)
    emcf_status_message = fields.Char(readonly=True, copy=False)
    emcf_checked_at = fields.Datetime(readonly=True, copy=False)
    emcf_nif_mismatch = fields.Boolean(readonly=True, copy=False,
                                       help="Le jeton e-MCF appartient à un autre NIF : aucune facture n'est transmise.")
    emcf_token_expiry = fields.Datetime(readonly=True, copy=False)
    sim_secret = fields.Char(copy=False, groups='base.group_system',
                             default=lambda s: secrets.token_hex(16))

    _sql_constraints = [('code_company_unique', 'unique(company_id, code)',
                         "Ce code d'établissement existe déjà dans l'entreprise.")]

    @api.constrains('code')
    def _check_code(self):
        for s in self:
            if not SITE_CODE_RE.match(s.code or ''):
                raise ValidationError(_("Le code établissement ne contient que des majuscules, chiffres et tirets (2 à 24)."))

    @api.constrains('emcf_mode', 'emcf_url')
    def _check_mode(self):
        for s in self.sudo():
            if s.emcf_mode != 'simulation' and s.emcf_url and not self._emcf_url_allowed(s.emcf_url):
                raise ValidationError(_("Adresse e-MCF non autorisée : seuls les serveurs de la DGI déclarés par la plateforme sont acceptés."))

    @api.model
    def _emcf_allowed_hosts(self):
        raw = self.env['ir.config_parameter'].sudo().get_param('norma.emcf_allowed_hosts',
                                                               'developper.dgirdc.cd,edef.dgirdc.cd')
        return {h.strip().lower() for h in raw.split(',') if h.strip()}

    @api.model
    def _emcf_url_allowed(self, url):
        """HTTPS, port standard, hôte de la liste tenue par la plateforme (jamais une adresse choisie par l'entreprise)."""
        from urllib.parse import urlsplit
        try:
            parts = urlsplit(url or '')
        except ValueError:
            return False
        return (parts.scheme == 'https' and not parts.username and not parts.password and parts.port in (None, 443)
                and (parts.hostname or '').lower() in self._emcf_allowed_hosts())

    def write(self, vals):
        if 'company_id' in vals and any(r.company_id.id != vals['company_id'] for r in self):
            raise AccessError(_("Un élément ne change pas d'entreprise."))
        return super().write(vals)

    def _public_dict(self):
        return [{'id': s.id, 'name': s.name, 'code': s.code, 'address': s.address or '', 'city': s.city or '',
                 'province': s.province or '', 'phone': s.phone or '', 'active': s.active,
                 'emcf_mode': s.emcf_mode, 'emcf_status': s.emcf_status, 'emcf_nim': s.emcf_nim or '',
                 'emcf_isf': s.emcf_isf or '', 'emcf_status_message': s.emcf_status_message or '',
                 'emcf_checked_at': fields.Datetime.to_string(s.emcf_checked_at) if s.emcf_checked_at else ''}
                for s in self]

    @api.model
    def _cron_status(self):
        for site in self.sudo().search([('emcf_mode', '!=', 'simulation'), ('company_id.norma_state', '=', 'active')]):
            try:
                self.env['norma.emcf']._status(site)
                self.env['norma.invoice']._commit()
            except Exception:
                self.env.cr.rollback()
