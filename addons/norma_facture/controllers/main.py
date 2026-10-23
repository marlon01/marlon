# -*- coding: utf-8 -*-
"""Routes NORMA : présentation, inscription, connexion, applications OWL, API, impression, vérification."""
import base64
import csv
import io
import json
import logging
import os
import re
from datetime import timedelta

from markupsafe import Markup, escape

from odoo import fields, http, _
from odoo.exceptions import AccessDenied, AccessError, UserError, ValidationError
from odoo.http import request

from odoo.addons.web.controllers.home import Home

from ..lib import fiscal
from ..lib.qr import qr_svg
from ..models.invoice import INVOICE_TYPES, REFERENCE_TYPES
from ..models.subscription import setting

_logger = logging.getLogger(__name__)
VERSION = '18.0.1.0.0'
SIGNUPS_PER_IP_PER_DAY = 5
TITLES = {
    'FV': "FACTURE DE VENTE", 'FT': "FACTURE D'ACOMPTE", 'FA': "FACTURE D'AVOIR",
    'EV': "FACTURE DE VENTE — EXPORTATION", 'ET': "FACTURE D'ACOMPTE — EXPORTATION", 'EA': "FACTURE D'AVOIR — EXPORTATION",
}
SECURITY_HEADERS = [
    ('X-Frame-Options', 'DENY'), ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'same-origin'),
    ('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()'),
]


def _ip():
    return request.httprequest.remote_addr or ''


def _html(html, cache=False):
    headers = [('Content-Type', 'text/html; charset=utf-8')] + SECURITY_HEADERS
    if not cache:
        headers.append(('Cache-Control', 'no-store'))
    return request.make_response(Markup('<!DOCTYPE html>\n') + html, headers)


def render_app(app, title, config):
    config = dict(config, app=app, version=VERSION)
    config_json = Markup(json.dumps(config, ensure_ascii=False).replace('</', '<\\/'))
    html = request.env['ir.qweb']._render('norma_facture.layout', {
        'app': app, 'title': title, 'config_json': config_json,
        'color': config.get('color') or '#0E4D64',
    })
    return _html(html)


def _norma_user():
    if not request.session.uid:
        return None
    user = request.env.user
    if not user._norma_role() or not user.company_id.norma_enabled:
        return None
    return user


class NormaHome(Home):

    @http.route()
    def web_client(self, s_action=None, **kw):
        # Les comptes des entreprises n'ont rien à faire dans le client générique : retour à leur espace.
        uid = request.session.uid
        if uid:
            user = request.env['res.users'].sudo().browse(uid).exists()
            if user and user._norma_role() and not user._is_internal():
                return request.redirect('/norma/app', 303)
        return super().web_client(s_action=s_action, **kw)


class NormaController(http.Controller):

    # ================================================================ pages publiques
    @http.route(['/norma', '/norma/'], type='http', auth='public', sitemap=True)
    def landing(self, **kw):
        cats = request.env['norma.category'].sudo().search([])
        user = _norma_user()
        space = None
        if user:
            space = '/norma/app'
        elif request.session.uid and request.env.user._norma_is_platform():
            space = '/norma/platform'
        html = request.env['ir.qweb']._render('norma_facture.landing', {
            'categories': cats, 'space': space, 'year': fields.Date.today().year,
            'tax_groups': request.env['norma.tax.group'].sudo().search([('rate', '>', 0)]),
            'plans': request.env['norma.plan'].sudo().search([]),
            'trial_days': setting(request.env, 'norma.trial_days', int),
        })
        return _html(html, cache=True)

    @http.route('/norma/signup', type='http', auth='public', sitemap=True)
    def signup_page(self, category=None, **kw):
        if _norma_user():
            return request.redirect('/norma/app')
        cats = request.env['norma.category'].sudo().search([])
        plans = {p.category_id.code: p.price_month for p in request.env['norma.plan'].sudo().search([])}
        return render_app('signup', "NORMA — Créer le compte de votre entreprise", {
            'categories': [dict(c, price=plans.get(c['code'])) for c in cats._public_dict()], 'category': category or '',
            'trial_days': setting(request.env, 'norma.trial_days', int),
        })

    @http.route('/norma/login', type='http', auth='public', sitemap=False)
    def login_page(self, **kw):
        if _norma_user():
            return request.redirect('/norma/app')
        return render_app('login', "NORMA — Connexion", {'error': kw.get('error') or ''})

    @http.route('/norma/app', type='http', auth='public', sitemap=False)
    def app_page(self, **kw):
        user = _norma_user()
        if not user:
            return request.redirect('/norma/login')
        return render_app('app', "NORMA — %s" % user.company_id.name, {
            'color': user.company_id.norma_brand_color or '#0E4D64'})

    @http.route('/norma/platform', type='http', auth='public', sitemap=False)
    def platform_page(self, **kw):
        if not request.session.uid or not request.env.user._norma_is_platform():
            return request.redirect('/norma/login')
        return render_app('platform', "NORMA — Administration centrale", {})

    @http.route('/norma/sw.js', type='http', auth='public', sitemap=False)
    def service_worker(self, **kw):
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static', 'src', 'sw', 'sw.js')
        with open(path, 'rb') as f:
            body = f.read()
        return request.make_response(body, [('Content-Type', 'text/javascript; charset=utf-8'),
                                            ('Service-Worker-Allowed', '/norma/'), ('Cache-Control', 'no-cache')])

    @http.route('/norma/manifest.webmanifest', type='http', auth='public', sitemap=False)
    def manifest(self, **kw):
        data = {'name': 'NORMA — Facturation normalisée', 'short_name': 'NORMA', 'start_url': '/norma/app#/',
                'scope': '/norma/', 'display': 'standalone', 'background_color': '#10212B', 'theme_color': '#10212B',
                'lang': 'fr', 'icons': [{'src': '/norma_facture/static/description/icon.png', 'sizes': '256x256', 'type': 'image/png'}]}
        return request.make_response(json.dumps(data), [('Content-Type', 'application/manifest+json'),
                                                        ('Cache-Control', 'public, max-age=3600')])

    @http.route('/norma/logout', type='http', auth='public', sitemap=False)
    def logout(self, **kw):
        request.session.logout(keep_db=True)
        return request.redirect('/norma/login')

    @http.route('/norma/logo/<int:company_id>', type='http', auth='public', sitemap=False)
    def logo(self, company_id, **kw):
        company = request.env['res.company'].sudo().browse(company_id).exists()
        if not company or not company.norma_enabled:
            return request.redirect('/norma_facture/static/description/icon.png')
        raw = base64.b64decode(company.logo) if company.logo and not company.uses_default_logo else b''
        ctype = 'image/png' if raw[:4] == b'\x89PNG' else ('image/jpeg' if raw[:3] == b'\xff\xd8\xff' else None)
        if not ctype:
            # Pas de logo propre : monogramme aux initiales de l'entreprise, à sa couleur.
            words = [w for w in re.split(r'[^0-9A-Za-zÀ-ÿ]+', company.name or '') if w and w.upper() not in ('SARL', 'SA', 'SAS', 'SPRL', 'SU', 'ETS')]
            letters = ''.join(w[0] for w in words[:2]).upper() or 'N'
            color = company.norma_brand_color if re.match(r'^#[0-9A-Fa-f]{6}$', company.norma_brand_color or '') else '#0E4D64'
            svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%s"/>'
                   '<text x="32" y="41" text-anchor="middle" font-family="Bahnschrift,Arial,sans-serif" font-size="26" '
                   'font-weight="700" fill="#fff">%s</text></svg>') % (color, escape(letters))
            return request.make_response(svg, [('Content-Type', 'image/svg+xml'), ('Cache-Control', 'public, max-age=600'),
                                               ('X-Content-Type-Options', 'nosniff'),
                                               ('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")])
        return request.make_response(raw, [('Content-Type', ctype), ('Cache-Control', 'public, max-age=3600'),
                                           ('X-Content-Type-Options', 'nosniff')])

    # ================================================================ authentification
    @http.route('/norma/auth/login', type='json', auth='none', csrf=False, readonly=False)
    def auth_login(self, login='', password='', **kw):
        if not request.db:
            return {'error': _("Service indisponible.")}
        env = request.env(user=1)
        Throttle = env['norma.throttle'].sudo()
        login = (login or '').strip().lower()[:120]
        keys = ['login-ip:%s' % _ip(), 'login-user:%s' % login]
        for key in keys:
            locked = Throttle.is_locked(key)
            if locked:
                return {'error': _("Trop de tentatives. Réessayez dans %s minute(s).") % locked}
        try:
            auth = request.session.authenticate(request.db, {'login': login, 'password': password or '',
                                                             'type': 'password'})
        except AccessDenied:
            left = min(Throttle.hit(keys[0], 20, 15), Throttle.hit(keys[1], 8, 15))
            env.cr.commit()
            return {'error': _("Identifiant ou mot de passe incorrect.") +
                    (' ' + _("%s essai(s) restant(s).") % left if 0 < left <= 3 else '')}
        uid = auth.get('uid') if isinstance(auth, dict) else request.session.uid
        if not uid:
            return {'error': _("Vérification en deux étapes requise."), 'redirect': '/web/login'}
        user = env['res.users'].browse(uid)
        for key in keys:
            Throttle.reset(key)
        if user._norma_is_platform():
            return {'ok': True, 'redirect': '/norma/platform'}
        if not user._norma_role() or not user.company_id.norma_enabled:
            request.session.logout(keep_db=True)
            return {'error': _("Ce compte n'a pas accès à NORMA.")}
        if user.company_id.norma_state != 'active':
            request.session.logout(keep_db=True)
            return {'error': _("Le compte de votre entreprise est suspendu. Contactez le support.")}
        env['norma.audit']._log(user.company_id, 'user.login', _("Connexion de %s") % user.login, {}, user=user, ip=_ip())
        return {'ok': True, 'redirect': '/norma/app'}

    @http.route('/norma/auth/signup', type='json', auth='public', csrf=False, readonly=False)
    def signup(self, **data):
        env = request.env
        if data.get('website'):  # champ piège invisible
            return {'error': _("Inscription refusée.")}
        ip = _ip()
        since = fields.Datetime.now() - timedelta(days=1)
        if env['res.company'].sudo().search_count([('norma_signup_ip', '=', ip), ('create_date', '>=', since)]) \
                >= SIGNUPS_PER_IP_PER_DAY:
            return {'error': _("Trop d'inscriptions depuis cette connexion. Réessayez demain ou contactez-nous.")}
        if not data.get('terms'):
            return {'error': _("Acceptez les conditions d'utilisation pour continuer.")}
        Platform = env['norma.platform'].sudo()
        try:
            vals = Platform._validate_signup(data)
            with env.cr.savepoint():
                Platform._signup(vals, ip)
        except (UserError, ValidationError) as exc:
            return {'error': exc.args[0]}
        except Exception:
            _logger.exception("NORMA : inscription impossible")
            env.cr.rollback()
            return {'error': _("L'inscription n'a pas pu aboutir. Vérifiez vos informations ou contactez le support.")}
        env.cr.commit()
        try:
            request.session.authenticate(request.db, {'login': vals['email'], 'password': vals['password'],
                                                      'type': 'password'})
        except AccessDenied:
            return {'ok': True, 'redirect': '/norma/login'}
        return {'ok': True, 'redirect': '/norma/app#/welcome'}

    # ================================================================ API
    @http.route('/norma/api/<string:op>', type='json', auth='user', csrf=False)
    def api(self, op, **params):
        # « op » et non « method » : un paramètre JSON peut s'appeler method (moyen de paiement).
        try:
            return {'result': request.env['norma.api']._dispatch(op, params)}
        except (UserError, ValidationError, AccessError) as exc:
            request.env.cr.rollback()
            return {'error': exc.args[0] if exc.args else str(exc)}
        except (ValueError, TypeError):
            request.env.cr.rollback()
            return {'error': _("Paramètres invalides.")}

    @http.route('/norma/platform/api/<string:op>', type='json', auth='user', csrf=False)
    def platform_api(self, op, **params):
        method = op
        if method not in ('overview', 'set_state', 'set_verified', 'tax_group_save', 'sync_tax_groups', 'settings_save',
                          'payment_decide', 'extend_trial', 'plan_save'):
            return {'error': _("Opération inconnue.")}
        Platform = request.env['norma.platform']
        try:
            if method == 'sync_tax_groups':
                Platform._check_platform()
                site = request.env['norma.site'].sudo().browse(int(params.get('site_id') or 0)).exists()
                if not site or site.emcf_mode != 'production' or not site.company_id.norma_verified:
                    raise UserError(_("Établissement de référence introuvable."))
                return {'result': request.env['norma.emcf']._sync_tax_groups(site)}
            return {'result': getattr(Platform, method)(**params)}
        except (UserError, ValidationError, AccessError) as exc:
            request.env.cr.rollback()
            return {'error': exc.args[0] if exc.args else str(exc)}

    @http.route('/norma/platform/proof/<int:payment_id>', type='http', auth='user', sitemap=False)
    def payment_proof(self, payment_id, **kw):
        if not request.env.user._norma_is_platform():
            return request.not_found()
        pay = request.env['norma.subscription.payment'].sudo().browse(payment_id).exists()
        if not pay or not pay.proof:
            return request.not_found()
        return request.make_response(base64.b64decode(pay.proof), [
            ('Content-Type', pay.proof_type or 'application/octet-stream'), ('X-Content-Type-Options', 'nosniff'),
            ('Content-Security-Policy', "default-src 'none'"), ('Cache-Control', 'no-store'),
            ('Content-Disposition', 'inline; filename="justificatif-%s"' % pay.id)])

    # ================================================================ impression
    def _print_values(self, inv):
        company, site = inv.company_id, inv.site_id
        base = request.httprequest.host_url.rstrip('/')
        return {
            'inv': inv, 'company': company, 'site': site, 'title': TITLES[inv.invoice_type],
            'types': dict(INVOICE_TYPES), 'references': dict(REFERENCE_TYPES),
            'qr': qr_svg(inv.emcf_qr) if inv.state == 'normalized' else Markup(''),
            'verify_url': '%s/norma/v/%s' % (base, inv.verify_token) if inv.verify_token else '',
            'verify_qr': qr_svg('%s/norma/v/%s' % (base, inv.verify_token)) if inv.verify_token else Markup(''),
            'words': fiscal.amount_in_words(inv.total),
            'fmt': lambda v, d=2: ('{:,.%df}' % d).format(v or 0).replace(',', ' ').replace('.', ','),
            'local_date': fields.Datetime.context_timestamp(inv.with_context(tz=inv.company_id.norma_tz or 'Africa/Kinshasa'), inv.date).strftime('%d/%m/%Y %H:%M') if inv.date else '',
            'offline_date': fields.Datetime.context_timestamp(inv.with_context(tz=inv.company_id.norma_tz or 'Africa/Kinshasa'), inv.offline_at).strftime('%d/%m/%Y %H:%M') if inv.offline_at else '',
            'simulation': inv.emcf_mode == 'simulation', 'version': VERSION,
            'payments_label': dict(request.env['norma.invoice.payment']._fields['method'].selection),
        }

    @http.route('/norma/print/<int:invoice_id>', type='http', auth='user', sitemap=False)
    def print_invoice(self, invoice_id, format='a4', **kw):
        try:
            if not _norma_user():
                raise AccessError('')
            inv = request.env['norma.api']._invoice(invoice_id)
        except (AccessError, UserError):
            return request.not_found()
        template = 'norma_facture.print_ticket' if format == 'ticket' else 'norma_facture.print_a4'
        html = request.env['ir.qweb']._render(template, dict(self._print_values(inv), auto=kw.get('auto')))
        response = _html(html)
        # Impression directe depuis la caisse : la page est chargée dans un cadre caché de NORMA lui-même.
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Content-Security-Policy'] = "frame-ancestors 'self'"
        return response

    # ================================================================ vérification publique
    @http.route('/norma/v/<string:token>', type='http', auth='public', sitemap=False)
    def verify(self, token, **kw):
        Throttle = request.env['norma.throttle'].sudo()
        key = 'verify:%s' % _ip()
        inv = None
        if not Throttle.is_locked(key) and 16 <= len(token or '') <= 64:
            inv = request.env['norma.invoice'].sudo().search(
                [('verify_token', '=', token), ('state', 'in', ('normalized', 'failed', 'uncertain'))], limit=1)
            if not inv:
                Throttle.hit(key, 30, 10)
        values = {'inv': inv, 'title': TITLES.get(inv.invoice_type, '') if inv else '',
                  'fmt': lambda v: '{:,.2f}'.format(v or 0).replace(',', ' ').replace('.', ','),
                  'local_date': fields.Datetime.context_timestamp(inv.with_context(tz=inv.company_id.norma_tz or 'Africa/Kinshasa'), inv.date).strftime('%d/%m/%Y %H:%M') if inv else ''}
        html = request.env['ir.qweb']._render('norma_facture.verify', values)
        response = _html(html)
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    @http.route('/norma/r/<string:key>', type='http', auth='public', sitemap=False)
    def provisional(self, key, **kw):
        """QR du ticket provisoire (vente hors ligne ou DGI indisponible) : mène à la facture normalisée dès qu'elle existe."""
        Throttle = request.env['norma.throttle'].sudo()
        ip_key = 'verify:%s' % _ip()
        inv = None
        if not Throttle.is_locked(ip_key) and re.match(r'^[A-Za-z0-9\-]{16,64}$', key or ''):
            inv = request.env['norma.invoice'].sudo().search([('request_key', '=', key)], limit=1)
            if not inv:
                Throttle.hit(ip_key, 30, 10)
        if inv and inv.verify_token:
            return request.redirect('/norma/v/%s' % inv.verify_token, 303)
        html = request.env['ir.qweb']._render('norma_facture.provisional', {})
        response = _html(html)
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    # ================================================================ export
    @http.route('/norma/export/invoices.csv', type='http', auth='user', sitemap=False)
    def export_csv(self, date_from=None, date_to=None, site_id=None, **kw):
        user = _norma_user()
        if not user or user._norma_role() not in ('manager', 'admin'):
            return request.not_found()
        Api = request.env['norma.api']
        try:
            date_from = fields.Date.to_date(date_from)
            date_to = fields.Date.to_date(date_to)
            if not date_from or not date_to:
                raise UserError('')
            start, _x = Api._day_bounds(date_from)
            _y, end = Api._day_bounds(date_to)
            domain = [('company_id', '=', user.company_id.id), ('state', '!=', 'draft'),
                      ('date', '>=', start), ('date', '<', end)]
            if site_id:
                domain.append(('site_id', '=', Api._site(site_id).id))
        except (UserError, AccessError, ValueError):
            return request.not_found()
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=';')
        w.writerow(['Numéro', 'Type', 'État', 'Date', 'Établissement', 'Client', 'NIF client', 'Total HT (CDF)',
                    'TVA (CDF)', 'Taxe spécifique (CDF)', 'Total TTC (CDF)', 'Devise', 'Total devise', 'Code DEF/DGI',
                    'NIM', 'Compteurs', 'Heure DEF', 'Facture d\'origine'])

        def safe(v):
            v = '' if v is None or v is False else str(v)
            return "'" + v if v[:1] in ('=', '+', '-', '@', '\t', '\r') else v
        for inv in request.env['norma.invoice'].sudo().search(domain, order='date'):
            w.writerow([safe(x) for x in (
                inv.number, inv.invoice_type, dict(inv._fields['state'].selection)[inv.state],
                fields.Datetime.to_string(inv.date), inv.site_id.code, inv.client_name, inv.client_nif,
                '%.2f' % inv.total_ht, '%.2f' % inv.total_tax, '%.2f' % inv.total_specific, '%.2f' % inv.total,
                inv.currency, '%.2f' % inv.total_currency, inv.emcf_code, inv.emcf_nim, inv.emcf_counters,
                inv.emcf_datetime, inv.reversed_id.number)])
        data = '﻿' + buf.getvalue()
        name = 'factures_%s_%s.csv' % (date_from, date_to)
        return request.make_response(data.encode('utf-8'), [
            ('Content-Type', 'text/csv; charset=utf-8'), ('Content-Disposition', 'attachment; filename="%s"' % name),
            ('Cache-Control', 'no-store')])
