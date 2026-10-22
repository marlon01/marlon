# -*- coding: utf-8 -*-
"""Back-office et authentification du personnel SELECTA."""
import io

from odoo import fields, http, _
from odoo.exceptions import AccessDenied
from odoo.http import request
from odoo.addons.web.controllers.home import Home

from .exam import _ip, render_app


class SelectaHome(Home):
    """Après une connexion Odoo standard, le personnel SELECTA arrive directement sur la console."""

    @http.route()
    def web_client(self, s_action=None, **kw):
        # Le personnel des structures n'utilise jamais le client Odoo : il reste dans sa console,
        # ce qui évite d'exposer des écrans génériques (contacts, discussions…) partagés entre structures.
        if request.db and request.session.uid:
            user = request.env['res.users'].sudo().browse(request.session.uid)
            if user._selecta_is_staff() and not user.has_group('base.group_system'):
                return request.redirect('/selecta/admin')
        return super().web_client(s_action=s_action, **kw)

    def _login_redirect(self, uid, redirect=None):
        if not redirect:
            user = request.env['res.users'].sudo().browse(uid)
            if user._selecta_is_staff() and not user.has_group('base.group_system'):
                return '/selecta/admin'
        return super()._login_redirect(uid, redirect=redirect)


class SelectaAdminController(http.Controller):

    @http.route('/selecta/login', type='http', auth='public', sitemap=False)
    def login_page(self, **kw):
        if request.session.uid:
            user = request.env['res.users'].sudo().browse(request.session.uid)
            if user._selecta_is_staff():
                return request.redirect('/selecta/admin')
        return render_app('login', "SELECTA — Connexion du personnel", {
            'db': request.db, 'error': kw.get('error') or '',
        })

    @http.route('/selecta/auth/login', type='json', auth='none', csrf=False)
    def auth_login(self, login='', password='', **kw):
        env = request.env(user=1) if request.db else None
        if env is None:
            return {'error': _("Aucune base de données sélectionnée.")}
        Throttle = env['selecta.login.throttle'].sudo()
        key = 'staff:%s' % _ip()
        locked = Throttle.is_locked(key)
        if locked:
            return {'error': _("Trop de tentatives. Réessayez dans %s minute(s).", locked)}
        try:
            credential = {'login': (login or '').strip(), 'password': password or '', 'type': 'password'}
            auth_info = request.session.authenticate(request.db, credential)
        except AccessDenied:
            left = Throttle.register_failure(key)
            env.cr.commit()
            return {'error': _("Identifiant ou mot de passe incorrect.") +
                    (' ' + _("%s essai(s) restant(s).", left) if left else '')}
        uid = auth_info.get('uid') if isinstance(auth_info, dict) else request.session.uid
        if not uid:
            return {'error': _("Authentification à deux facteurs requise : utilisez /web/login."),
                    'redirect': '/web/login?redirect=/selecta/admin'}
        user = env['res.users'].browse(uid)
        if not user._selecta_is_staff():
            request.session.logout(keep_db=True)
            return {'error': _("Ce compte n'a aucun rôle SELECTA. Contactez l'administrateur.")}
        Throttle.reset(key)
        env['selecta.audit.log']._log('staff.login', _("Connexion du personnel"), {'ip': _ip()}, user=user, ip=_ip())
        return {'ok': True, 'redirect': user._selecta_home_url()}

    @http.route('/selecta/logout', type='http', auth='public', sitemap=False)
    def logout(self, **kw):
        request.session.logout(keep_db=True)
        return request.redirect('/selecta/login')

    @http.route('/selecta/admin', type='http', auth='public', sitemap=False)
    def admin_page(self, **kw):
        if not request.session.uid:
            return request.redirect('/selecta/login')
        user = request.env.user
        if not user._selecta_is_staff():
            return request.redirect('/selecta/login?error=access')
        return render_app('admin', "SELECTA — Console des concours", {
            'db': request.db, 'uid': user.id,
        }, company=request.env.company)

    @http.route('/selecta/admin/export/<int:concours_id>', type='http', auth='user', sitemap=False)
    def export_results(self, concours_id, **kw):
        data = request.env['selecta.backoffice'].results(concours_id)
        import xlsxwriter
        buf = io.BytesIO()
        wb = xlsxwriter.Workbook(buf, {'in_memory': True})
        title = wb.add_format({'bold': True, 'font_size': 14})
        head = wb.add_format({'bold': True, 'bg_color': '#0B5FFF', 'font_color': '#FFFFFF', 'border': 1})
        cell = wb.add_format({'border': 1})
        pct = wb.add_format({'border': 1, 'num_format': '0.00" %"'})
        ok = wb.add_format({'border': 1, 'font_color': '#047857', 'bold': True})
        ko = wb.add_format({'border': 1, 'font_color': '#B91C1C'})
        labels = {'submitted': 'Terminé', 'expired': 'Temps écoulé', 'disqualified': 'Disqualifié',
                  'in_progress': 'En cours', 'ready': 'Connecté', 'absent': 'Absent'}
        c = data['concours']
        for sheet_name, rows in (('Classement', data['rows']), ('Admis', data['admitted'])):
            ws = wb.add_worksheet(sheet_name)
            ws.write(0, 0, '%s — %s' % (c['name'], c['reference']), title)
            ws.write(1, 0, 'Seuil : %s %% · Statut : %s · Empreinte : %s' % (
                c['pass_threshold'], 'OFFICIEL' if data['official'] else 'PROVISOIRE', data['results_hash'] or '—'))
            headers = ['Rang', "N° d'inscription", 'Nom', 'Salle', 'Statut', 'Score', 'Barème', 'Pourcentage',
                       'Décision', 'Durée (min)', 'Avertissements', 'Empreinte des réponses']
            for col, h in enumerate(headers):
                ws.write(3, col, h, head)
            for i, r in enumerate(rows, start=4):
                ws.write(i, 0, r['rank'] or '', cell)
                ws.write(i, 1, r['reference'], cell)
                ws.write(i, 2, r['candidate'], cell)
                ws.write(i, 3, r['room'], cell)
                ws.write(i, 4, labels.get(r['state'], r['state']), cell)
                ws.write_number(i, 5, r['score'] or 0, cell)
                ws.write_number(i, 6, r['max_score'] or 0, cell)
                ws.write_number(i, 7, r['percentage'] or 0, pct)
                ws.write(i, 8, 'ADMIS' if r['admitted'] else ('Réussi' if r['passed'] else 'Non admis'),
                         ok if r['admitted'] else ko)
                ws.write_number(i, 9, round((r['duration'] or 0) / 60.0, 1), cell)
                ws.write_number(i, 10, r['warnings'] or 0, cell)
                ws.write(i, 11, r['digest'], cell)
            ws.set_column(0, 0, 7)
            ws.set_column(1, 1, 18)
            ws.set_column(2, 2, 32)
            ws.set_column(3, 10, 13)
            ws.set_column(11, 11, 66)
            ws.freeze_panes(4, 0)
        wb.close()
        request.env['selecta.audit.log']._log('results.export', _("Export des résultats"), {},
                                              concours=request.env['selecta.concours'].browse(concours_id))
        filename = 'resultats_%s.xlsx' % (c['reference'] or concours_id)
        return request.make_response(buf.getvalue(), [
            ('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
            ('Content-Disposition', 'attachment; filename="%s"' % filename)])
