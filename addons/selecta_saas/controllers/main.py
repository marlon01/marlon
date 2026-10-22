# -*- coding: utf-8 -*-
"""Pages publiques du SaaS (présentation, tarifs, inscription) et console de la plateforme."""
import re
from datetime import timedelta

from markupsafe import Markup

from odoo import fields, http, _
from odoo.exceptions import AccessDenied, UserError, ValidationError
from odoo.http import request

from odoo.addons.selecta_concours.controllers.admin import SelectaHome
from odoo.addons.selecta_concours.controllers.exam import SelectaExamController, _ip, render_app

from ..models.saas_platform import G_PLATFORM, read_setting

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')
SIGNUPS_PER_IP_PER_DAY = 5


def _plans():
    return request.env['selecta.saas.plan'].sudo().search([])


class SelectaSaasHome(SelectaHome):

    @http.route()
    def index(self, s_action=None, db=None, **kw):
        # La racine du site présente l'offre aux visiteurs ; les utilisateurs connectés gardent le comportement Odoo.
        if request.db and not request.session.uid:
            return request.redirect('/selecta', 303)
        return super().index(s_action=s_action, db=db, **kw)

    def _login_redirect(self, uid, redirect=None):
        if not redirect:
            user = request.env['res.users'].sudo().browse(uid)
            if user.has_group(G_PLATFORM):
                return '/selecta/platform'
        return super()._login_redirect(uid, redirect=redirect)


class SelectaSaasController(SelectaExamController):

    # ------------------------------------------------------------------ présentation et tarifs
    @http.route(['/selecta', '/selecta/'], type='http', auth='public', sitemap=True)
    def root(self, **kw):
        plans = _plans()
        html = request.env['ir.qweb']._render('selecta_saas.landing', {
            'plans': plans,
            'trial_days': read_setting(request.env, 'trial_days'),
            'signup_enabled': read_setting(request.env, 'signup_enabled'),
            'support_email': read_setting(request.env, 'support_email'),
            'support_phone': read_setting(request.env, 'support_phone'),
            'issuer': read_setting(request.env, 'issuer_name'),
            'year': fields.Date.today().year,
        })
        return request.make_response(Markup('<!DOCTYPE html>\n') + html, [
            ('Content-Type', 'text/html; charset=utf-8'), ('X-Content-Type-Options', 'nosniff'),
            ('Referrer-Policy', 'strict-origin-when-cross-origin')])

    # ------------------------------------------------------------------ inscription
    @http.route('/selecta/signup', type='http', auth='public', sitemap=True)
    def signup_page(self, plan=None, **kw):
        if request.session.uid:
            return request.redirect('/selecta/admin')
        countries = request.env['res.country'].sudo().search([])
        return render_app('signup', "SELECTA — Créer votre espace", {
            'plans': [p._public_dict() for p in _plans()],
            'plan': plan or '',
            'trial_days': read_setting(request.env, 'trial_days'),
            'trial_max_candidates': read_setting(request.env, 'trial_max_candidates'),
            'signup_enabled': read_setting(request.env, 'signup_enabled'),
            'countries': [{'code': c.code, 'name': c.name} for c in countries],
            'default_country': 'CD',
        })

    @http.route('/selecta/saas/signup', type='json', auth='public', csrf=False)
    def signup(self, **data):
        env = request.env
        if not read_setting(env, 'signup_enabled'):
            return {'error': _("Les inscriptions sont momentanément fermées. Contactez-nous.")}
        if data.get('website'):  # champ piège invisible : seuls les robots le remplissent
            return {'error': _("Inscription refusée.")}
        ip = _ip()
        Tenant = env['selecta.saas.tenant'].sudo()
        since = fields.Datetime.now() - timedelta(days=1)
        if Tenant.search_count([('signup_ip', '=', ip), ('create_date', '>=', since)]) >= SIGNUPS_PER_IP_PER_DAY:
            return {'error': _("Trop d'inscriptions depuis cette connexion. Réessayez demain ou contactez-nous.")}
        try:
            vals = self._validate_signup(data)
        except UserError as exc:
            return {'error': exc.args[0], 'field': getattr(exc, 'selecta_field', None)}
        try:
            with env.cr.savepoint():
                env['selecta.saas.tenant'].sudo()._create_space(vals, ip)
        except (UserError, ValidationError) as exc:
            return {'error': exc.args[0]}
        # L'authentification ouvre son propre curseur : le compte doit être enregistré avant.
        env.cr.commit()
        try:
            credential = {'login': vals['email'], 'password': vals['password'], 'type': 'password'}
            request.session.authenticate(request.db, credential)
        except AccessDenied:  # pragma: no cover - le compte vient d'être créé
            return {'ok': True, 'redirect': '/selecta/login'}
        return {'ok': True, 'redirect': '/selecta/admin#/dashboard'}

    def _validate_signup(self, data):
        def fail(field, message):
            exc = UserError(message)
            exc.selecta_field = field
            raise exc
        org = (data.get('organization') or '').strip()
        contact = (data.get('contact_name') or '').strip()
        email = (data.get('email') or '').strip().lower()
        phone = (data.get('phone') or '').strip()
        password = data.get('password') or ''
        if not 2 <= len(org) <= 120:
            fail('organization', _("Indiquez le nom de votre structure."))
        if not 2 <= len(contact) <= 120:
            fail('contact_name', _("Indiquez votre nom complet."))
        if not EMAIL_RE.match(email) or len(email) > 160:
            fail('email', _("Adresse e-mail invalide."))
        if len(password) < 10 or not re.search(r'[A-Za-z]', password) or not re.search(r'\d', password):
            fail('password', _("Le mot de passe doit comporter au moins 10 caractères, dont des lettres et des chiffres."))
        if not data.get('accept_terms'):
            fail('accept_terms', _("Vous devez accepter les conditions d'utilisation."))
        env = request.env
        plan = env['selecta.saas.plan'].sudo().search([('code', '=', data.get('plan') or '')], limit=1)
        if not plan:
            fail('plan', _("Choisissez votre catégorie."))
        if env['res.users'].sudo().with_context(active_test=False).search_count([('login', '=ilike', email)]):
            fail('email', _("Un compte existe déjà avec cette adresse. Connectez-vous ou utilisez une autre adresse."))
        if env['res.company'].sudo().search_count([('name', '=ilike', org)]):
            fail('organization', _("Une structure porte déjà ce nom. Précisez-le (ville, sigle…)."))
        country = env['res.country'].sudo().search([('code', '=', (data.get('country') or '').upper())], limit=1)
        return {'organization': org, 'contact_name': contact, 'email': email, 'phone': phone[:40],
                'password': password, 'plan': plan, 'country': country}

    # ------------------------------------------------------------------ administration centrale
    @http.route('/selecta/platform', type='http', auth='public', sitemap=False)
    def platform_page(self, **kw):
        if not request.session.uid:
            return request.redirect('/selecta/login')
        if not request.env.user.has_group(G_PLATFORM):
            return request.redirect('/selecta/admin')
        return render_app('platform', "SELECTA — Administration centrale", {'uid': request.env.uid})
