# -*- coding: utf-8 -*-
"""API candidat SELECTA (publique, jeton d'épreuve à usage unique par session)."""
import json
import logging
import os

from odoo import fields, http, _
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request
from markupsafe import Markup

from odoo.tools import file_open

_logger = logging.getLogger(__name__)
VERSION = '18.0.1.1.0'


def _ip():
    # Jamais l'en-tête X-Forwarded-For brut (falsifiable) : derrière un proxy, activer ``proxy_mode``
    # et Odoo remplace remote_addr par l'adresse transmise par ce proxy de confiance.
    return request.httprequest.remote_addr or ''


def _company_branding(company):
    return {
        'id': company.id, 'name': company.name,
        'logo': '/web/binary/company_logo?company=%s' % company.id,
        'color': company.selecta_brand_color or '#0B5FFF',
        'tagline': company.selecta_tagline or '',
    }


def render_app(app, title, config, company=None):
    company = company or request.env.company.sudo()
    config = dict(config, app=app, version=VERSION, company=_company_branding(company))
    # Neutralise toute séquence de fermeture de balise dans le JSON embarqué.
    config_json = Markup(json.dumps(config, ensure_ascii=False).replace('</', '<\\/'))
    html = request.env['ir.qweb']._render('selecta_concours.selecta_layout', {
        'app': app, 'title': title, 'config_json': config_json,
        'brand_color': company.selecta_brand_color or '#0B5FFF',
    })
    response = request.make_response(Markup('<!DOCTYPE html>\n') + html, [('Content-Type', 'text/html; charset=utf-8')])
    headers = response.headers
    headers['X-Frame-Options'] = 'DENY'
    headers['X-Content-Type-Options'] = 'nosniff'
    headers['Referrer-Policy'] = 'no-referrer'
    headers['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=()'
    headers['Cache-Control'] = 'no-store'
    return response


class SelectaExamController(http.Controller):

    # ------------------------------------------------------------------ pages
    @http.route(['/selecta', '/selecta/'], type='http', auth='public', sitemap=False)
    def root(self, **kw):
        return request.redirect('/selecta/exam')

    @http.route('/selecta/exam', type='http', auth='public', sitemap=False)
    def exam_page(self, **kw):
        company = request.env.company.sudo()
        if kw.get('org'):
            org = request.env['res.company'].sudo().browse(int(kw['org'])).exists() if str(kw['org']).isdigit() else None
            company = org or company
        return render_app('exam', "SELECTA — Espace candidat", {
            'facelib': '/selecta_concours/static/lib/face-api/face-api.js',
            'models': '/selecta_concours/static/lib/face-api/model',
        }, company=company)

    @http.route('/selecta/manifest.webmanifest', type='http', auth='public', sitemap=False)
    def manifest(self, **kw):
        company = request.env.company.sudo()
        data = {
            'name': 'SELECTA — %s' % company.name, 'short_name': 'SELECTA',
            'start_url': '/selecta/exam', 'scope': '/selecta/', 'display': 'fullscreen',
            'background_color': '#0B1220', 'theme_color': company.selecta_brand_color or '#0B5FFF',
            'lang': 'fr', 'orientation': 'any',
            'icons': [{'src': '/selecta_concours/static/description/icon.png', 'sizes': '256x256', 'type': 'image/png'}],
        }
        return request.make_response(json.dumps(data), [('Content-Type', 'application/manifest+json')])

    @http.route('/selecta/sw.js', type='http', auth='public', sitemap=False)
    def service_worker(self, **kw):
        with file_open('selecta_concours/static/src/sw/selecta_sw.js', 'r') as f:
            body = f.read().replace('__SELECTA_VERSION__', VERSION)
        return request.make_response(body, [
            ('Content-Type', 'application/javascript; charset=utf-8'),
            ('Service-Worker-Allowed', '/selecta/'), ('Cache-Control', 'no-cache')])

    @http.route('/selecta/ping', type='http', auth='none', sitemap=False, cors=False)
    def ping(self, **kw):
        return request.make_response('ok', [('Content-Type', 'text/plain'), ('Cache-Control', 'no-store')])

    @http.route('/selecta/verify/<string:digest>', type='http', auth='public', sitemap=False)
    def verify(self, digest, **kw):
        concours = request.env['selecta.concours'].sudo().search(
            [('results_hash', '=', digest), ('state', '=', 'published')], limit=1) if len(digest) == 64 else None
        rows = concours._official_rows() if concours else []
        html = request.env['ir.qweb']._render('selecta_concours.selecta_verify', {'concours': concours, 'rows': rows})
        return request.make_response(Markup('<!DOCTYPE html>\n') + html, [('Content-Type', 'text/html; charset=utf-8')])

    # ------------------------------------------------------------------ outils API
    def _attempt(self, token):
        att = request.env['selecta.attempt'].sudo()._by_token(token)
        if not att:
            raise AccessError(_("Session d'épreuve invalide ou ouverte sur un autre poste."))
        return att

    def _safe(self, fn):
        """Exécute dans un point de sauvegarde ; renvoie une erreur métier propre au client."""
        try:
            with request.env.cr.savepoint():
                return fn()
        except (UserError, ValidationError) as exc:
            return {'error': exc.args[0] if exc.args else str(exc), 'code': 'business'}
        except AccessError as exc:
            return {'error': exc.args[0] if exc.args else str(exc), 'code': 'auth'}

    def _exam_info(self, att):
        c = att.concours_id.sudo()
        cand = att.candidate_id.sudo()
        return {
            'candidate': {'name': cand.name, 'reference': cand.reference, 'room': cand.room or ''},
            'concours': {
                'name': c.name, 'reference': c.reference, 'instructions': c.instructions or '',
                'duration_minutes': c.duration_minutes, 'questions_per_page': c.questions_per_page,
                'pass_threshold': c.pass_threshold, 'require_all_answers': c.require_all_answers,
                'show_result': c.show_result, 'offline_prefetch': c.offline_prefetch,
                'exam_mode': c.exam_mode, 'exam_venue': c.exam_venue or '',
                'company': _company_branding(c.company_id),
            },
            'proctoring': {
                'enabled': c.proctoring_enabled, 'level': c.proctoring_level,
                'face_absent_seconds': c.face_absent_seconds, 'look_away_seconds': c.look_away_seconds,
                'identity_check': c.identity_check, 'require_fullscreen': c.require_fullscreen,
            },
            'status': att._status(),
        }

    # ------------------------------------------------------------------ API candidat
    @http.route('/selecta/api/login', type='json', auth='public', csrf=False)
    def api_login(self, code='', **kw):
        def run():
            Throttle = request.env['selecta.login.throttle'].sudo()
            ip = _ip()
            key = 'candidate:%s' % ip
            locked = Throttle.is_locked(key)
            if locked:
                return {'error': _("Trop de tentatives infructueuses depuis ce poste. Réessayez dans %s minute(s) "
                                   "ou appelez un surveillant.", locked), 'code': 'locked'}
            cand = request.env['selecta.candidate'].sudo()._find_by_code(code)
            if not cand:
                left = Throttle.register_failure(key)
                if not left:
                    request.env['selecta.audit.log'].sudo()._log('login.locked', _("Poste verrouillé (force brute)"),
                                                                 {'ip': ip}, ip=ip)
                return {'error': _("Code d'accès invalide.") + (
                    ' ' + _("%s essai(s) restant(s).", left) if left else ' ' + _("Poste temporairement verrouillé.")),
                    'code': 'invalid'}
            Throttle.reset(key)
            concours = cand.concours_id.sudo()
            now = fields.Datetime.now()
            attempt = cand.attempt_ids[:1]
            if attempt and attempt.state in ('submitted', 'expired', 'disqualified', 'absent'):
                token = attempt._issue_token()
                info = self._exam_info(attempt)
                info.update(token=token, finished=True)
                return info
            if concours.state in ('draft', 'ready'):
                return {'error': _("L'épreuve « %s » n'est pas encore ouverte.", concours.name), 'code': 'not_open'}
            if concours.state in ('closed', 'published'):
                return {'error': _("L'épreuve « %s » est clôturée.", concours.name), 'code': 'closed'}
            if concours.date_start and now < concours.date_start:
                return {'error': _("Les connexions ouvriront le %s (UTC).", fields.Datetime.to_string(concours.date_start)),
                        'code': 'not_open'}
            if not attempt and concours.date_end and now > concours.date_end:
                return {'error': _("La fenêtre de connexion est fermée."), 'code': 'closed'}
            if not concours._venue_allows(ip):
                request.env['selecta.audit.log'].sudo()._log(
                    'login.offsite', _("Connexion hors de la salle d'examen refusée"),
                    {'candidate': cand.reference, 'ip': ip}, concours=concours, ip=ip)
                return {'error': _("Cette épreuve se passe en présentiel : composez depuis un poste de la salle "
                                   "d'examen%s.", (" (%s)" % concours.exam_venue) if concours.exam_venue else ""),
                        'code': 'offsite'}
            concours.company_id._selecta_guard('exam.login', concours=concours)
            ua = (request.httprequest.headers.get('User-Agent') or '')[:250]
            Attempt = request.env['selecta.attempt'].sudo().with_context(selecta_engine=True)
            if not attempt:
                attempt = Attempt.create([dict(Attempt._prepare_for(cand), ip_address=ip, user_agent=ua, login_count=1)])
            else:
                if attempt.state == 'in_progress' and not attempt.allow_resume:
                    request.env['selecta.audit.log'].sudo()._log(
                        'login.duplicate', _("Tentative de connexion parallèle refusée"),
                        {'candidate': cand.reference, 'ip': ip}, concours=concours, ip=ip)
                    return {'error': _("Votre épreuve est déjà ouverte sur un poste. En cas d'incident, demandez à un "
                                       "surveillant d'autoriser la reprise."), 'code': 'resume_required'}
                attempt._engine().write({'allow_resume': False, 'login_count': attempt.login_count + 1,
                                         'ip_address': ip, 'user_agent': ua})
            token = attempt._issue_token()
            request.env['selecta.audit.log'].sudo()._log(
                'attempt.login', _("Connexion du candidat"), {'candidate': cand.reference, 'ip': ip,
                                                              'resume': attempt.state == 'in_progress'},
                concours=concours, ip=ip)
            info = self._exam_info(attempt)
            info.update(token=token, finished=False, resume=attempt.state == 'in_progress')
            return info
        return self._safe(run)

    @http.route('/selecta/api/state', type='json', auth='public', csrf=False)
    def api_state(self, token='', **kw):
        def run():
            att = self._attempt(token)
            info = self._exam_info(att)
            if att.state == 'in_progress':
                info['package'] = att._package()
            return info
        return self._safe(run)

    @http.route('/selecta/api/identity', type='json', auth='public', csrf=False)
    def api_identity(self, token='', descriptor=None, photo=None, **kw):
        def run():
            att = self._attempt(token)
            res = att._set_identity(descriptor, photo)
            res['status'] = att._status()
            return res
        return self._safe(run)

    @http.route('/selecta/api/start', type='json', auth='public', csrf=False)
    def api_start(self, token='', **kw):
        def run():
            att = self._attempt(token)
            att._start()
            return att._package()
        return self._safe(run)

    @http.route('/selecta/api/submit', type='json', auth='public', csrf=False)
    def api_submit(self, token='', page=0, answers=None, elapsed_ms=None, time_up=False, **kw):
        def run():
            att = self._attempt(token)
            status = att._submit_page(page, answers or {}, elapsed_ms=elapsed_ms, time_up=bool(time_up))
            out = {'status': status}
            if status['state'] == 'in_progress' and not att.concours_id.offline_prefetch:
                out['package'] = att._package()
            return out
        return self._safe(run)

    @http.route('/selecta/api/event', type='json', auth='public', csrf=False)
    def api_event(self, token='', type='info', details='', snapshot=None, ts=None, **kw):
        def run():
            att = self._attempt(token)
            return att._apply_event(type, details, snapshot, client_ts=ts)
        return self._safe(run)

    @http.route('/selecta/api/heartbeat', type='json', auth='public', csrf=False)
    def api_heartbeat(self, token='', descriptor=None, faces=None, **kw):
        def run():
            att = self._attempt(token)
            return {'status': att._heartbeat(descriptor=descriptor, faces=faces)}
        return self._safe(run)

    @http.route('/selecta/api/sync', type='json', auth='public', csrf=False)
    def api_sync(self, token='', ops=None, **kw):
        """Rejoue dans l'ordre la file d'attente constituée pendant une coupure réseau."""
        att = None
        results = []
        for op in (ops or [])[:200]:
            kind = op.get('kind')

            def run(op=op, kind=kind):
                a = self._attempt(token)
                if kind == 'submit':
                    return {'status': a._submit_page(op.get('page', 0), op.get('answers') or {},
                                                     elapsed_ms=op.get('elapsed_ms'), time_up=bool(op.get('time_up')))}
                if kind == 'event':
                    return a._apply_event(op.get('type', 'info'), op.get('details', ''), op.get('snapshot'),
                                          client_ts=op.get('ts'))
                return {'error': 'op inconnue'}
            res = self._safe(run)
            results.append({'id': op.get('id'), 'result': res})
            if res.get('code') == 'auth':
                break
        try:
            att = self._attempt(token)
            status = att._status()
        except AccessError:
            status = None
        return {'results': results, 'status': status}
