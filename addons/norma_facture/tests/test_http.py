# -*- coding: utf-8 -*-
import json

from odoo.tests import HttpCase, tagged


@tagged('post_install', '-at_install', 'norma')
class TestNormaHttp(HttpCase):

    def setUp(self):
        super().setUp()
        Platform = self.env['norma.platform'].sudo()

        def signup(cat, name, email, nif, code):
            vals = Platform._validate_signup({'company': name, 'contact': 'Resp', 'email': email,
                                              'password': 'MotDePasse2026', 'nif': nif, 'address': 'Gombe',
                                              'category': cat, 'site_code': code})
            return Platform._signup(vals, '10.0.0.1')
        self.shop = signup('supermarche', 'Kin Marché', 'a@shop.cd', 'A1111111A', 'KIN-01')
        self.other = signup('magasin', 'Autre Boutique', 'b@other.cd', 'B2222222B', 'LUB-01')
        p = self.env['norma.product'].sudo().search([('company_id', '=', self.shop.id)], limit=1)
        api = self.env['norma.api'].with_user(self.shop.norma_owner_id).with_company(self.shop)
        self.inv = api._dispatch('checkout', {'site_id': self.shop.norma_site_ids[0].id,
                                              'lines': [{'product_id': p.id, 'quantity': 2}],
                                              'payments': [{'method': 'ESPECES', 'amount': p.price * 2}]})

    def rpc(self, url, params):
        res = self.url_open(url, data=json.dumps({'jsonrpc': '2.0', 'method': 'call', 'params': params}),
                            headers={'Content-Type': 'application/json'})
        return res.json().get('result')

    def test_public_pages(self):
        for url in ('/norma', '/norma/login', '/norma/signup'):
            res = self.url_open(url)
            self.assertEqual(res.status_code, 200, url)
            self.assertNotIn('Odoo', res.text, "aucune mention d'Odoo sur %s" % url)
            self.assertEqual(res.headers.get('X-Frame-Options'), 'DENY')

    def test_print_and_verify(self):
        self.authenticate('a@shop.cd', 'MotDePasse2026')
        for fmt in ('a4', 'ticket'):
            res = self.url_open('/norma/print/%s?format=%s' % (self.inv['id'], fmt))
            self.assertEqual(res.status_code, 200)
            self.assertIn(self.inv['emcf_code'], res.text)
            self.assertIn('<svg', res.text)  # QR code
            self.assertIn('SANS VALEUR FISCALE' if fmt == 'a4' else 'SIMULATION', res.text)
        self.assertIn('NIF', res.text)
        verify = self.url_open('/norma/v/%s' % self.inv['verify_token'])
        self.assertIn(self.inv['number'], verify.text)
        self.assertIn('Facture introuvable', self.url_open('/norma/v/%s' % ('x' * 24)).text)

    def test_print_other_tenant_is_not_found(self):
        self.authenticate('b@other.cd', 'MotDePasse2026')
        res = self.url_open('/norma/print/%s' % self.inv['id'])
        self.assertEqual(res.status_code, 404)
        self.assertNotIn(self.inv['number'], res.text)
        out = self.rpc('/norma/api/invoice_get', {'id': self.inv['id']})
        self.assertIn('error', out)

    def test_csv_export_scoped(self):
        self.authenticate('a@shop.cd', 'MotDePasse2026')
        today = str(__import__('odoo').fields.Date.today())
        res = self.url_open('/norma/export/invoices.csv?date_from=%s&date_to=%s' % (today, today))
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.inv['number'], res.text)
        self.authenticate('b@other.cd', 'MotDePasse2026')
        res = self.url_open('/norma/export/invoices.csv?date_from=%s&date_to=%s' % (today, today))
        self.assertNotIn(self.inv['number'], res.text)

    def test_login_flow_and_throttle(self):
        ok = self.rpc('/norma/auth/login', {'login': 'a@shop.cd', 'password': 'MotDePasse2026'})
        self.assertEqual(ok.get('redirect'), '/norma/app')
        self.url_open('/norma/logout')
        for _i in range(8):
            out = self.rpc('/norma/auth/login', {'login': 'a@shop.cd', 'password': 'faux'})
        self.assertIn('Trop de tentatives', self.rpc('/norma/auth/login', {'login': 'a@shop.cd', 'password': 'MotDePasse2026'})['error'])

    def test_signup_honeypot_and_terms(self):
        base = {'company': 'Nouvelle', 'contact': 'X', 'email': 'n@new.cd', 'password': 'MotDePasse2026', 'nif': 'C3333333C',
                'address': 'Limete', 'category': 'hotel', 'terms': True}
        self.assertIn('error', self.rpc('/norma/auth/signup', dict(base, website='http://spam')))
        self.assertIn('error', self.rpc('/norma/auth/signup', dict(base, terms=False)))
        ok = self.rpc('/norma/auth/signup', base)
        self.assertTrue(ok.get('ok'), ok)

    def test_generic_client_redirects_tenant_users(self):
        self.authenticate('a@shop.cd', 'MotDePasse2026')
        res = self.url_open('/odoo', allow_redirects=False)
        self.assertIn(res.status_code, (302, 303))
        self.assertIn('/norma/app', res.headers.get('Location', ''))

    def test_logo_monogram_is_safe_svg(self):
        res = self.url_open('/norma/logo/%s' % self.shop.id)
        self.assertEqual(res.headers['Content-Type'], 'image/svg+xml')
        self.assertIn("default-src 'none'", res.headers.get('Content-Security-Policy', ''))
        self.assertIn('>KM<', res.text)
