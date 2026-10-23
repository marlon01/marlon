# -*- coding: utf-8 -*-
"""Pages publiques du SaaS (présentation, tarifs, inscription) et console de la plateforme."""
import logging
import re
from datetime import timedelta

from markupsafe import Markup, escape

from odoo import fields, http, _
from odoo.exceptions import AccessDenied, UserError, ValidationError
from odoo.http import request

from odoo.addons.selecta_concours.controllers.admin import SelectaHome
from odoo.addons.selecta_concours.controllers.exam import SelectaExamController, _ip, render_app

from ..models.saas_platform import G_PLATFORM, read_setting

_logger = logging.getLogger(__name__)
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')
SIGNUPS_PER_IP_PER_DAY = 5


def _plans():
    return request.env['selecta.saas.plan'].sudo().search([])


def render_legal_text(text):
    """Texte juridique saisi dans l'administration centrale → HTML sûr.

    Syntaxe minimale : « # Titre », « ## Sous-titre », « - élément de liste », lignes vides entre paragraphes.
    Tout le reste est échappé : aucun balisage n'est interprété.
    """
    out, items = [], []

    def flush():
        if items:
            out.append(Markup('<ul>%s</ul>') % Markup('').join(Markup('<li>%s</li>') % i for i in items))
            items.clear()
    for block in re.split(r'\n\s*\n', (text or '').strip()):
        for line in block.split('\n'):
            line = line.rstrip()
            if line.startswith('- '):
                items.append(line[2:].strip())
                continue
            flush()
            if line.startswith('## '):
                out.append(Markup('<h2>%s</h2>') % line[3:].strip())
            elif line.startswith('# '):
                out.append(Markup('<h1>%s</h1>') % line[2:].strip())
            elif line.strip():
                out.append(Markup('<p>%s</p>') % line.strip())
        flush()
    return Markup('').join(out)


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
        # Noms des pays en français lorsque la langue est chargée (--load-language=fr_FR).
        Country = request.env['res.country'].sudo()
        if request.env['res.lang']._lang_get('fr_FR'):
            Country = Country.with_context(lang='fr_FR')
        countries = Country.search([]).sorted('name')
        return render_app('signup', "SELECTA — Créer votre espace", {
            'plans': [p._public_dict() for p in _plans()],
            'plan': plan or '',
            'trial_days': read_setting(request.env, 'trial_days'),
            'trial_max_candidates': read_setting(request.env, 'trial_max_candidates'),
            'signup_enabled': read_setting(request.env, 'signup_enabled'),
            'countries': [{'code': c.code, 'name': c.name} for c in countries],
            'default_country': 'CD',
            'support_email': read_setting(request.env, 'support_email'),
            'terms_url': '/selecta/conditions', 'privacy_url': '/selecta/confidentialite',
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
                tenant = env['selecta.saas.tenant'].sudo()._create_space(vals, ip)
                tenant.write({'terms_accepted_date': fields.Datetime.now(),
                              'terms_version': read_setting(env, 'legal_updated') or 'initiale'})
        except (UserError, ValidationError) as exc:
            _logger.warning("SELECTA SaaS : inscription refusée : %s", exc, exc_info=True)
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

    # ------------------------------------------------------------------ documents juridiques
    @http.route(['/selecta/conditions', '/selecta/confidentialite'], type='http', auth='public', sitemap=True)
    def legal(self, **kw):
        kind = 'terms' if request.httprequest.path.endswith('/conditions') else 'privacy'
        custom = read_setting(request.env, '%s_text' % kind)
        values = {
            'kind': kind, 'custom': render_legal_text(custom) if custom else False,
            'issuer': read_setting(request.env, 'issuer_name'),
            'issuer_details': read_setting(request.env, 'issuer_details'),
            'support_email': read_setting(request.env, 'support_email'),
            'support_phone': read_setting(request.env, 'support_phone'),
            'trial_days': read_setting(request.env, 'trial_days'),
            'grace_days': read_setting(request.env, 'grace_days'),
            'retention_days': read_setting(request.env, 'biometric_retention_days'),
            'updated': read_setting(request.env, 'legal_updated'),
            'year': fields.Date.today().year,
        }
        html = request.env['ir.qweb']._render('selecta_saas.legal_page', values)
        return request.make_response(Markup('<!DOCTYPE html>\n') + html, [
            ('Content-Type', 'text/html; charset=utf-8'), ('X-Content-Type-Options', 'nosniff')])

    # ------------------------------------------------------------------ paiement en ligne
    @http.route('/selecta/saas/pay/return', type='http', auth='public', sitemap=False)
    def pay_return(self, ref='', **kw):
        """Retour du client depuis la page du prestataire : on vérifie auprès du prestataire, jamais sur parole."""
        inv = request.env['selecta.saas.invoice'].sudo().search([('online_reference', '=', ref)], limit=1) if ref else None
        status = 'none'
        if inv:
            if kw.get('session_id') and inv.online_provider == 'stripe' and not inv.online_session:
                inv.online_session = kw['session_id']
            try:
                status = inv._online_check()
            except Exception as exc:  # noqa: BLE001 - la page de retour ne doit jamais échouer
                _logger.warning("SELECTA SaaS : vérification au retour de %s impossible : %s", ref, exc)
                status = 'pending'
        return request.redirect('/selecta/admin#/subscription?payment=%s' % status, 303)

    @http.route('/selecta/saas/pay/notify/<string:provider>', type='http', auth='public', methods=['POST'],
                csrf=False, sitemap=False)
    def pay_notify(self, provider, **kw):
        """Notification serveur à serveur. Le contenu ne sert qu'à identifier la transaction."""
        ref = False
        if provider == 'cinetpay':
            ref = kw.get('cpm_trans_id') or kw.get('transaction_id')
        elif provider == 'flexpay':
            try:
                ref = (request.get_json_data() or {}).get('reference')
            except Exception:  # noqa: BLE001 - corps illisible : rien à identifier
                ref = kw.get('reference')
        elif provider == 'stripe':
            try:
                event = request.get_json_data()
                obj = ((event or {}).get('data') or {}).get('object') or {}
                ref = obj.get('client_reference_id')
                session = obj.get('id')
            except Exception:  # noqa: BLE001
                event, session = None, None
        inv = request.env['selecta.saas.invoice'].sudo().search(
            [('online_reference', '=', ref), ('online_provider', '=', provider)], limit=1) if ref else None
        if inv:
            if provider == 'stripe' and session and not inv.online_session:
                inv.online_session = session
            try:
                inv._online_check()
            except Exception as exc:  # noqa: BLE001
                _logger.warning("SELECTA SaaS : notification %s pour %s non traitée : %s", provider, ref, exc)
        return request.make_response('OK', [('Content-Type', 'text/plain')])

    # ------------------------------------------------------------------ administration centrale
    @http.route('/selecta/platform', type='http', auth='public', sitemap=False)
    def platform_page(self, **kw):
        if not request.session.uid:
            return request.redirect('/selecta/login')
        if not request.env.user.has_group(G_PLATFORM):
            return request.redirect('/selecta/admin')
        return render_app('platform', "SELECTA — Administration centrale", {'uid': request.env.uid})
