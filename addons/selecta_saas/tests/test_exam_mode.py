# -*- coding: utf-8 -*-
import json

from odoo import fields
from odoo.exceptions import UserError, ValidationError
from odoo.tests import HttpCase, tagged

from .common import SaasCommon


def _open_concours(env, user, **vals):
    """Concours ouvert, un candidat inscrit, son code d'accès en clair."""
    Q = env['selecta.question'].with_user(user).with_company(user.company_id)
    q = Q.create({'name': "2 + 2 ?", 'choice_ids': [(0, 0, {'name': '4', 'is_correct': True}),
                                                    (0, 0, {'name': '5'})]})
    concours = env['selecta.concours'].with_user(user).with_company(user.company_id).create(
        dict({'name': "Concours mode", 'question_ids': [(6, 0, q.ids)]}, **vals))
    cand = env['selecta.candidate'].with_user(user).with_company(user.company_id).create(
        {'concours_id': concours.id, 'name': "Grâce Ngalula", 'reference': "MODE-001"})
    code = cand._generate_codes()[0]['code']
    concours.action_ready()
    concours.action_open()
    return concours, cand, code


@tagged('post_install', '-at_install')
class TestExamMode(SaasCommon):

    def test_onsite_is_the_default(self):
        c = self._concours(self.user_a)
        self.assertEqual(c.exam_mode, 'onsite')

    def test_remote_requires_webcam_and_identity_check(self):
        with self.assertRaises(ValidationError):
            self._concours(self.user_a).write({'exam_mode': 'remote', 'proctoring_enabled': False})
        with self.assertRaises(ValidationError):
            self._concours(self.user_a).write({'exam_mode': 'remote', 'identity_check': False})
        c = self._concours(self.user_a)
        c.write({'exam_mode': 'remote'})
        self.assertTrue(c.proctoring_enabled and c.identity_check)

    def test_venue_networks(self):
        c = self._concours(self.user_a)
        self.assertTrue(c._venue_allows('8.8.8.8'), "sans réseau déclaré, pas de contrôle")
        c.write({'venue_networks': '10.20.0.0/24, 41.243.12.7'})
        self.assertTrue(c._venue_allows('10.20.0.42'))
        self.assertTrue(c._venue_allows('41.243.12.7'))
        self.assertFalse(c._venue_allows('10.20.1.1'))
        self.assertFalse(c._venue_allows('not-an-ip'))
        c.write({'exam_mode': 'remote'})
        self.assertTrue(c._venue_allows('8.8.8.8'), "à distance, le réseau n'est pas contrôlé")
        with self.assertRaises(ValidationError):
            c.write({'venue_networks': '10.20.0.0/33'})

    def test_mode_is_frozen_once_open(self):
        concours, _cand, _code = _open_concours(self.env, self.user_a)
        with self.assertRaises(UserError):
            concours.with_user(self.user_a).write({'exam_mode': 'remote'})

    def test_dossier_deposit_recorded_when_staff_registers_the_candidate(self):
        c = self._concours(self.user_a)
        row = self.bo(self.user_a).candidate_save({'concours_id': c.id, 'name': "Ruth Kanku", 'reference': "D-1"})
        self.assertEqual(row['dossier_date'], str(fields.Date.context_today(c)))
        self.assertEqual(row['dossier_received_by'], self.user_a.name)
        row = self.bo(self.user_a).candidate_save({'concours_id': c.id, 'name': "Esther Ilunga", 'reference': "D-2",
                                                   'dossier_date': '2026-10-01'})
        self.assertEqual(row['dossier_date'], '2026-10-01')
        self.bo(self.user_a).candidates_import(c.id, [{'reference': 'D-3', 'name': 'Patrick T.',
                                                       'dossier_date': '2026-09-30'}])
        imported = self.env['selecta.candidate'].search([('reference', '=', 'D-3')])
        self.assertEqual(str(imported.dossier_date), '2026-09-30')

    def test_codes_payload_carries_mode_and_venue(self):
        c = self._concours(self.user_a)
        c.write({'exam_venue': "Centre d'examen, Gombe"})
        self.bo(self.user_a).candidate_save({'concours_id': c.id, 'name': "Ruth Kanku", 'reference': "V-1"})
        res = self.bo(self.user_a).generate_codes(c.id)
        self.assertEqual(res['concours']['exam_mode'], 'onsite')
        self.assertEqual(res['concours']['exam_venue'], "Centre d'examen, Gombe")


@tagged('post_install', '-at_install')
class TestExamModeHttp(HttpCase):

    def _login(self, code):
        resp = self.url_open('/selecta/api/login', data=json.dumps(
            {'jsonrpc': '2.0', 'method': 'call', 'params': {'code': code}}),
            headers={'Content-Type': 'application/json'})
        return resp.json()['result']

    def test_onsite_exam_refuses_connections_from_outside_the_room(self):
        tenant = self.env['selecta.saas.tenant']._create_space({
            'organization': 'Groupe Mode', 'contact_name': 'Clarisse', 'email': 'mode@test.cd',
            'password': 'Motdepasse123', 'phone': '+243800000000', 'plan': self.env.ref('selecta_saas.plan_pme'),
            'country': self.env.ref('base.cd')}, ip='10.0.0.9')
        user = tenant.owner_id
        concours, cand, code = _open_concours(self.env, user, exam_venue="Salle A, Gombe",
                                              venue_networks="10.99.0.0/16")
        res = self._login(code)
        self.assertEqual(res.get('code'), 'offsite')
        self.assertIn("Salle A, Gombe", res['error'])
        self.assertFalse(cand.attempt_ids, "aucune épreuve n'est ouverte depuis l'extérieur")
        concours.sudo().with_context(selecta_engine=True).write({'venue_networks': '127.0.0.0/8'})
        res = self._login(code)
        self.assertFalse(res.get('error'), res)
        self.assertEqual(res['concours']['exam_mode'], 'onsite')
        self.assertEqual(res['concours']['exam_venue'], "Salle A, Gombe")


@tagged('post_install', '-at_install')
class TestSelectaLanding(HttpCase):
    """https://selecta.naxoris.com : présentation pour tous, une connexion, chacun vers son espace."""

    def test_root_and_old_login_lead_to_the_landing_and_the_single_login(self):
        resp = self.url_open('/', allow_redirects=False)
        self.assertTrue(resp.headers['Location'].endswith('/selecta'))
        page = self.url_open('/selecta')
        self.assertIn("Pour plus d'informations, contactez", page.text)
        self.assertIn('tel:+243831509420', page.text)
        self.assertIn('By ', page.text)
        resp = self.url_open('/web/login', allow_redirects=False)
        self.assertTrue(resp.headers['Location'].endswith('/selecta/login'))
        self.assertEqual(self.url_open('/web/login?operator=1').status_code, 200)
        self.assertIn('+243 831 509 420', self.url_open('/selecta/login').text)

    def test_logged_in_staff_sees_its_console_button(self):
        self.env['selecta.saas.tenant']._create_space({
            'organization': 'Lycée Landing', 'contact_name': 'Directrice', 'email': 'landing@test.cd',
            'password': 'Motdepasse123', 'phone': '+243800000000', 'plan': self.env.ref('selecta_saas.plan_pme'),
            'country': self.env.ref('base.cd')}, ip='10.0.0.8')
        self.authenticate('landing@test.cd', 'Motdepasse123')
        resp = self.url_open('/', allow_redirects=False)
        self.assertTrue(resp.headers['Location'].endswith('/selecta'))
        page = self.url_open('/selecta')
        self.assertIn('Ma console', page.text)
        self.assertIn('href="/selecta/admin"', page.text)
