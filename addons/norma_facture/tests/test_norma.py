# -*- coding: utf-8 -*-
from unittest.mock import patch

import requests

from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'norma')
class TestNorma(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Platform = cls.env['norma.platform'].sudo()
        cls.shop = cls._signup('supermarche', 'Kin Marché SARL', 'admin@kinmarche.cd', 'A1234567B', 'KIN-01')
        cls.hotel = cls._signup('hotel', 'Hôtel du Fleuve', 'admin@fleuve.cd', 'B7654321C', 'HTL-01')
        cls.resto = cls._signup('restaurant', 'Chez Maman', 'admin@maman.cd', 'C1112223D', 'RST-01')
        cls.admin = cls.shop.norma_owner_id
        cls.site = cls.shop.norma_site_ids[0]
        cls.api = cls.env['norma.api']

    @classmethod
    def _signup(cls, category, name, email, nif, code):
        vals = cls.Platform._validate_signup({
            'company': name, 'contact': 'Responsable', 'email': email, 'password': 'MotDePasse2026',
            'nif': nif, 'address': 'Boulevard du 30 Juin, Gombe', 'city': 'Kinshasa', 'category': category,
            'site_name': 'Siège', 'site_code': code,
        })
        return cls.Platform._signup(vals, '127.0.0.1')

    def call(self, user, method, **params):
        return self.api.with_user(user).with_company(user.company_id)._dispatch(method, params)

    def product(self, company, name=None):
        domain = [('company_id', '=', company.id)]
        if name:
            domain.append(('name', '=', name))
        return self.env['norma.product'].sudo().search(domain, limit=1)

    def make_user(self, role, sites=None):
        users = self.call(self.admin, 'user_save', name='Agent %s' % role, login='%s.agent@kinmarche.cd' % role, role=role,
                          site_ids=sites or [], password='Caisse2026ok')
        return self.env['res.users'].browse([u['id'] for u in users if u['login'] == '%s.agent@kinmarche.cd' % role][0])

    def sell(self, user=None, qty=2, payments=None, **kw):
        p = self.product(self.shop, 'Eau minérale 1,5 L')
        return self.call(user or self.admin, 'checkout', site_id=self.site.id,
                         lines=[{'product_id': p.id, 'quantity': qty}],
                         payments=payments or [{'method': 'ESPECES', 'amount': p.price * qty}], **kw)

    # ================================================================ inscription
    def test_signup_creates_tenant_with_workspace(self):
        self.assertTrue(self.shop.norma_enabled)
        self.assertEqual(self.shop.norma_category_id.workspace, 'pos')
        self.assertTrue(self.admin.share, "les comptes d'entreprise n'accèdent pas au client générique")
        self.assertEqual(self.admin._norma_role(), 'admin')
        self.assertEqual(self.site.code, 'KIN-01')
        self.assertTrue(self.env['norma.place'].sudo().search_count([('company_id', '=', self.hotel.id), ('kind', '=', 'room')]))
        self.assertTrue(self.env['norma.place'].sudo().search_count([('company_id', '=', self.resto.id), ('kind', '=', 'table')]))
        boot = self.call(self.admin, 'bootstrap')
        self.assertEqual(boot['category']['workspace'], 'pos')

    def test_signup_rejects_duplicates_and_weak_password(self):
        base = {'company': 'X', 'contact': 'Y', 'email': 'admin@kinmarche.cd', 'password': 'MotDePasse2026',
                'nif': 'Z9999999Z', 'address': 'a', 'category': 'magasin'}
        with self.assertRaises(UserError):
            self.Platform._validate_signup(base)
        with self.assertRaises(UserError):
            self.Platform._validate_signup(dict(base, email='new@x.cd', nif='A1234567B'))
        with self.assertRaises(UserError):
            self.Platform._validate_signup(dict(base, email='new@x.cd', password='1234567890'))

    # ================================================================ normalisation
    def test_checkout_normalizes_in_simulation(self):
        inv = self.sell()
        self.assertEqual(inv['state'], 'normalized')
        self.assertTrue(inv['number'].startswith('KIN-01-FV-'))
        self.assertTrue(inv['emcf_code'].startswith('SIMU-'))
        self.assertEqual(len(inv['emcf_code']), 24)
        self.assertTrue(inv['emcf_qr'].startswith('RDCDEF01;'))
        self.assertEqual(inv['total'], 3000.0)
        self.assertEqual(inv['groups'][0]['tax'], 413.80)  # 3000 × 16 / 116 = 413,79… → 413,80
        record = self.env['norma.invoice'].sudo().browse(inv['id'])
        self.assertTrue(record.chain_hash)
        logs = self.env['norma.emcf.log'].sudo().search([('invoice_id', '=', record.id)])
        self.assertTrue({'POST', 'PUT'} <= set(logs.mapped('method')))
        self.assertNotIn('Bearer', ''.join(logs.mapped('request')))

    def test_numbering_is_sequential_per_site_and_type(self):
        a, b = self.sell(), self.sell()
        na, nb = int(a['number'].split('-')[-1]), int(b['number'].split('-')[-1])
        self.assertEqual(nb, na + 1)

    def test_normalized_invoice_is_immutable(self):
        inv = self.env['norma.invoice'].sudo().browse(self.sell()['id'])
        with self.assertRaises(AccessError):
            inv.write({'total': 1})
        with self.assertRaises(UserError):
            inv.with_context(norma_engine=True).write({'total': 1})
        with self.assertRaises(UserError):
            inv.unlink()
        with self.assertRaises(AccessError):
            inv.line_ids[0].write({'quantity': 99})
        with self.assertRaises(AccessError):
            self.env['norma.invoice'].sudo().create({'company_id': self.shop.id, 'site_id': self.site.id})

    def test_payments_must_cover_total(self):
        with self.assertRaises(UserError):
            self.sell(payments=[{'method': 'ESPECES', 'amount': 1000}])

    def test_cashier_cannot_override_price_or_exceed_discount(self):
        cashier = self.make_user('cashier')
        p = self.product(self.shop, 'Eau minérale 1,5 L')
        with self.assertRaises(AccessError):
            self.call(cashier, 'checkout', site_id=self.site.id, lines=[{'product_id': p.id, 'quantity': 1, 'price': 1}],
                      payments=[{'method': 'ESPECES', 'amount': 1}])
        with self.assertRaises(UserError):
            self.call(cashier, 'checkout', site_id=self.site.id,
                      lines=[{'product_id': p.id, 'quantity': 1, 'discount_pct': 50}],
                      payments=[{'method': 'ESPECES', 'amount': 750}])
        with self.assertRaises(AccessError):
            self.call(cashier, 'product_save', name='Gratuit', price=1, tax_group='B')
        with self.assertRaises(AccessError):
            self.call(cashier, 'credit_note', id=self.sell()['id'], lines=[], reason='x')

    def test_cashier_site_restriction(self):
        sites = self.call(self.admin, 'site_save', name='Limete', code='KIN-02', address='Limete')
        other = [s for s in sites if s['code'] == 'KIN-02'][0]
        cashier = self.make_user('cashier', sites=[other['id']])
        p = self.product(self.shop)
        with self.assertRaises(AccessError):
            self.call(cashier, 'checkout', site_id=self.site.id, lines=[{'product_id': p.id, 'quantity': 1}],
                      payments=[{'method': 'ESPECES', 'amount': p.price}])
        own = self.call(cashier, 'checkout', site_id=other['id'], lines=[{'product_id': p.id, 'quantity': 1}],
                        payments=[{'method': 'ESPECES', 'amount': p.price}])
        self.assertTrue(own['number'].startswith('KIN-02-FV-'))
        hidden = self.sell()
        with self.assertRaises(AccessError):
            self.call(cashier, 'invoice_get', id=hidden['id'])
        listed = self.call(cashier, 'invoices')['items']
        self.assertEqual({i['site_code'] for i in listed}, {'KIN-02'})

    # ================================================================ cloisonnement
    def test_tenant_isolation(self):
        inv = self.sell()
        hotel_admin = self.hotel.norma_owner_id
        with self.assertRaises(AccessError):
            self.call(hotel_admin, 'invoice_get', id=inv['id'])
        with self.assertRaises(AccessError):
            self.call(hotel_admin, 'checkout', site_id=self.site.id,
                      lines=[{'product_id': self.product(self.hotel).id, 'quantity': 1}])
        with self.assertRaises(AccessError):
            self.call(hotel_admin, 'checkout', site_id=self.hotel.norma_site_ids[0].id,
                      lines=[{'product_id': self.product(self.shop).id, 'quantity': 1}])
        with self.assertRaises(AccessError):
            self.call(hotel_admin, 'customer_save', id=self.env['norma.customer'].sudo().create(
                {'company_id': self.shop.id, 'name': 'Secret'}).id, name='Volé')
        # Lecture directe par le modèle : les règles d'accès filtrent l'autre entreprise.
        seen = self.env['norma.invoice'].with_user(hotel_admin).with_company(self.hotel).search([])
        self.assertNotIn(inv['id'], seen.ids)
        self.assertFalse(self.env['norma.product'].with_user(hotel_admin).search([('company_id', '=', self.shop.id)]))

    def test_suspended_company_blocked(self):
        self.shop.norma_state = 'suspended'
        with self.assertRaises(AccessError):
            self.call(self.admin, 'bootstrap')

    def test_unknown_method_rejected(self):
        with self.assertRaises(AccessError):
            self.call(self.admin, '_build')
        with self.assertRaises(AccessError):
            self.call(self.admin, 'unlink')

    # ================================================================ avoirs
    def test_credit_note_flow_and_cap(self):
        inv = self.sell(qty=3)
        line = inv['lines'][0]
        credit = self.call(self.admin, 'credit_note', id=inv['id'], reference_type='RAM', reason='Retour client',
                           lines=[{'line_id': line['id'], 'quantity': 2}])
        self.assertEqual(credit['state'], 'normalized')
        self.assertEqual(credit['type'], 'FA')
        self.assertTrue(credit['number'].startswith('KIN-01-FA-'))
        self.assertEqual(credit['reversed_code'], inv['emcf_code'])
        payload = self.env['norma.emcf.log'].sudo().search([('invoice_id', '=', credit['id']), ('method', '=', 'POST')]).request
        self.assertIn('"reference": "%s"' % inv['emcf_code'], payload)
        self.assertIn('"referenceType": "RAM"', payload)
        with self.assertRaises(UserError):
            self.call(self.admin, 'credit_note', id=inv['id'], reason='Encore',
                      lines=[{'line_id': line['id'], 'quantity': 2}])
        last = self.call(self.admin, 'credit_note', id=inv['id'], reason='Solde',
                         lines=[{'line_id': line['id'], 'quantity': 1}])
        self.assertEqual(last['state'], 'normalized')
        with self.assertRaises(UserError):
            self.call(self.admin, 'credit_note', id=credit['id'], reason='Avoir d\'avoir',
                      lines=[{'line_id': credit['lines'][0]['id'], 'quantity': 1}])

    # ================================================================ incidents e-MCF
    def test_total_mismatch_blocks_and_cancels(self):
        Sim = type(self.env['norma.emcf.sim'])
        original = Sim._post

        def tampered(self_, site, req):
            status, data = original(self_, site, req)
            if 'total' in data:
                data['total'] += 1
            return status, data
        with patch.object(Sim, '_post', tampered):
            inv = self.sell()
        self.assertEqual(inv['state'], 'failed')
        self.assertTrue(inv['emcf_blocked'])
        self.assertIn('Écart', inv['emcf_error'])
        self.assertFalse(self.env['norma.emcf.sim'].sudo().search([('rn', '=', inv['number']), ('state', '=', 'pending')]))
        # Pas de reprise automatique d'un cas bloquant
        self.env['norma.invoice']._cron_retry()
        self.assertEqual(self.env['norma.invoice'].sudo().browse(inv['id']).state, 'failed')

    def _production_site(self):
        self.shop.norma_verified = True
        self.site.sudo().write({'emcf_mode': 'test', 'emcf_url': 'https://developper.dgirdc.cd/edef',
                                'emcf_token': 'jeton-secret', 'emcf_isf': 'ABC-DEF-01'})

    def test_network_failure_then_retry_reuses_pending(self):
        self._production_site()
        with patch('odoo.addons.norma_facture.models.emcf.requests.request', side_effect=requests.ConnectionError()):
            inv = self.sell()
        self.assertEqual(inv['state'], 'failed')
        self.assertFalse(inv['emcf_blocked'])
        record = self.env['norma.invoice'].sudo().browse(inv['id'])
        # La DGI revient : la demande est rejouée par le simulateur via le transport HTTP.
        sim = self.env['norma.emcf.sim']

        def fake(method, url, json=None, timeout=None, headers=None, **kw):
            self.assertEqual(headers['Authorization'], 'Bearer jeton-secret')
            status, data = sim._handle(record.site_id, method, url.split('/edef', 1)[1], json)
            resp = requests.Response()
            resp.status_code = status
            resp._content = __import__('json').dumps(data).encode()
            return resp
        with patch('odoo.addons.norma_facture.models.emcf.requests.request', side_effect=fake):
            self.env['norma.invoice']._cron_retry()
        self.assertEqual(record.state, 'normalized')
        self.assertEqual(record.emcf_attempts, 2)
        logs = self.env['norma.emcf.log'].sudo().search([('invoice_id', '=', record.id)])
        self.assertNotIn('jeton-secret', ''.join(logs.mapped('request')) + ''.join(logs.mapped('response')))

    def test_confirm_timeout_is_uncertain_and_not_resent(self):
        self._production_site()
        sim = self.env['norma.emcf.sim']
        site = self.site

        def fake(method, url, json=None, timeout=None, headers=None, **kw):
            path = url.split('/edef', 1)[1]
            if path.endswith('/confirm'):
                raise requests.Timeout()
            status, data = sim._handle(site, method, path, json)
            resp = requests.Response()
            resp.status_code = status
            resp._content = __import__('json').dumps(data).encode()
            return resp
        with patch('odoo.addons.norma_facture.models.emcf.requests.request', side_effect=fake):
            inv = self.sell()
            self.assertEqual(inv['state'], 'uncertain')
            self.env['norma.invoice']._cron_retry()  # ne touche pas aux confirmations incertaines
        record = self.env['norma.invoice'].sudo().browse(inv['id'])
        self.assertEqual(record.state, 'uncertain')
        posts = self.env['norma.emcf.log'].sudo().search_count([('invoice_id', '=', record.id), ('method', '=', 'POST')])
        self.assertEqual(posts, 1)
        # Vérification manuelle : la demande est toujours en attente côté DGI, on peut confirmer sans doublon.
        with patch('odoo.addons.norma_facture.models.emcf.requests.request',
                   side_effect=lambda method, url, json=None, timeout=None, headers=None, **kw: _ok(sim, site, method, url, json)):
            self.call(self.admin, 'invoice_check_uncertain', id=record.id)
        self.assertEqual(record.state, 'normalized')

    def test_abandon_keeps_number(self):
        self._production_site()
        with patch('odoo.addons.norma_facture.models.emcf.requests.request', side_effect=requests.ConnectionError()):
            inv = self.sell()
            with self.assertRaises(UserError):
                self.call(self.admin, 'invoice_abandon', id=inv['id'], reason='')
            res = self.call(self.admin, 'invoice_abandon', id=inv['id'], reason='Client parti sans payer')
        self.assertEqual(res['state'], 'cancelled')
        self.assertTrue(res['number'])

    # ================================================================ hôtel et restaurant
    def test_hotel_stay_checkout(self):
        admin = self.hotel.norma_owner_id
        site = self.hotel.norma_site_ids[0]
        rooms = self.call(admin, 'places', site_id=site.id, kind='room')
        guest = self.call(admin, 'customer_save', name='Jean Mukendi', client_type='PP', phone='+243810000000')
        folio = self.call(admin, 'folio_open', place_id=rooms[0]['id'], customer_id=guest['id'])
        self.assertEqual(folio['nights_posted'], 1)
        breakfast = self.product(self.hotel, 'Petit-déjeuner')
        folio = self.call(admin, 'folio_add', id=folio['id'], product_id=breakfast.id, quantity=2)
        total = folio['total']
        inv = self.call(admin, 'folio_checkout', id=folio['id'], payments=[{'method': 'CARTEBANCAIRE', 'amount': total}])
        self.assertEqual(inv['state'], 'normalized')
        self.assertEqual(inv['client_name'], 'Jean Mukendi')
        self.assertTrue(inv['origin'].startswith('Chambre'))
        room = self.env['norma.place'].sudo().browse(rooms[0]['id'])
        self.assertEqual(room.housekeeping, 'dirty')
        with self.assertRaises(UserError):
            self.call(admin, 'folio_open', place_id=room.id, customer_id=guest['id'])

    def test_restaurant_table_bill(self):
        admin = self.resto.norma_owner_id
        site = self.resto.norma_site_ids[0]
        tables = self.call(admin, 'places', site_id=site.id, kind='table')
        folio = self.call(admin, 'folio_open', place_id=tables[0]['id'], guests=3)
        dish = self.product(self.resto, 'Poulet moambe')
        beer = self.product(self.resto, 'Bière 65 cl')
        self.call(admin, 'folio_add', id=folio['id'], product_id=dish.id, quantity=3)
        folio = self.call(admin, 'folio_add', id=folio['id'], product_id=beer.id, quantity=4)
        folio = self.call(admin, 'folio_send', id=folio['id'])
        self.assertTrue(all(l['sent'] for l in folio['lines']))
        inv = self.call(admin, 'folio_checkout', id=folio['id'],
                        payments=[{'method': 'MOBILEMONEY', 'amount': folio['total']}])
        self.assertEqual(inv['total'], 3 * 35000 + 4 * 7000)
        self.assertEqual(inv['state'], 'normalized')

    # ================================================================ devises, clients, exportation
    def test_usd_invoice_sent_in_cdf(self):
        self.shop.write({'norma_currency': 'USD', 'norma_usd_rate': 2850})
        p = self.call(self.admin, 'product_save', name='Ordinateur portable', price=500, tax_group='B', item_type='BIE')
        inv = self.call(self.admin, 'checkout', site_id=self.site.id, lines=[{'product_id': p['id'], 'quantity': 2}],
                        payments=[{'method': 'VIREMENT', 'amount': 1000}])
        self.assertEqual(inv['state'], 'normalized')
        self.assertEqual(inv['total'], 2850000.0)
        self.assertEqual(inv['total_currency'], 1000.0)
        payload = self.env['norma.emcf.log'].sudo().search([('invoice_id', '=', inv['id']), ('method', '=', 'POST')]).request
        self.assertIn('"curCode": "USD"', payload)
        self.assertIn('"price": 1425000.0', payload)

    def test_client_type_rules(self):
        with self.assertRaises(UserError):
            self.call(self.admin, 'customer_save', name='Société X', client_type='PM')
        with self.assertRaises(UserError):
            self.call(self.admin, 'customer_save', name='Ambassade', client_type='AO')
        ok = self.call(self.admin, 'customer_save', name='Ambassade', client_type='AO', exemption_ref='EXO-2026-14')
        self.assertEqual(ok['client_type'], 'AO')

    def test_export_requires_client_and_forces_export_group(self):
        p = self.product(self.shop, 'Riz parfumé 5 kg')
        with self.assertRaises(UserError):
            self.call(self.admin, 'checkout', site_id=self.site.id, invoice_type='EV',
                      lines=[{'product_id': p.id, 'quantity': 1}], payments=[{'method': 'VIREMENT', 'amount': p.price}])
        client = self.call(self.admin, 'customer_save', name='Import Brazza SA', client_type='PM', nif='CG12345')
        inv = self.call(self.admin, 'checkout', site_id=self.site.id, invoice_type='EV', customer_id=client['id'],
                        lines=[{'product_id': p.id, 'quantity': 1}], payments=[{'method': 'VIREMENT', 'amount': p.price}])
        self.assertEqual(inv['lines'][0]['tax_group'], 'E')
        self.assertEqual(inv['total_tax'], 0)

    # ================================================================ intégrité et rapports
    def test_integrity_and_report(self):
        self.sell()
        self.sell(qty=1)
        check = self.call(self.admin, 'integrity')
        self.assertTrue(check['audit']['ok'])
        self.assertTrue(check['invoices']['ok'])
        self.assertEqual(check['invoices']['count'], 2)
        # Altération directe en base : la chaîne le détecte.
        inv = self.env['norma.invoice'].sudo().search([('company_id', '=', self.shop.id)], limit=1)
        self.env.cr.execute('UPDATE norma_invoice SET total = total + 1 WHERE id = %s', (inv.id,))
        inv.invalidate_recordset()
        self.assertFalse(self.call(self.admin, 'integrity')['invoices']['ok'])
        today = __import__('odoo').fields.Date.today()
        report = self.call(self.admin, 'report', date_from=str(today), date_to=str(today))
        self.assertEqual(report['count'], 2)

    def test_audit_is_append_only(self):
        entry = self.env['norma.audit'].sudo().search([('company_id', '=', self.shop.id)], limit=1)
        with self.assertRaises(AccessError):
            entry.write({'message': 'x'})
        with self.assertRaises(AccessError):
            entry.unlink()

    def test_site_token_hidden_from_non_admin(self):
        self.site.sudo().emcf_token = 'secret'
        manager = self.make_user('manager')
        with self.assertRaises(AccessError):
            self.call(manager, 'sites_admin')
        boot = self.call(manager, 'bootstrap')
        self.assertNotIn('secret', str(boot))


@tagged('post_install', '-at_install', 'norma')
class TestNormaSecurity(TestNorma):
    """Régressions de la revue de sécurité."""

    def test_facade_methods_are_private(self):
        from odoo.service.model import get_public_method
        Api = self.env['norma.api']
        for name in ('user_save', 'site_save', 'checkout', 'credit_note', 'bootstrap'):
            with self.assertRaises(AccessError):
                get_public_method(Api, name)
        for model, name in (('norma.platform', 'set_state'), ('norma.platform', 'set_verified'), ('norma.throttle', 'reset')):
            with self.assertRaises(AccessError):
                get_public_method(self.env[model], name)

    def test_no_direct_orm_writes_for_tenants(self):
        manager = self.make_user('manager')
        product = self.product(self.shop).with_user(manager)
        with self.assertRaises(AccessError):
            product.write({'price': 1})
        with self.assertRaises(AccessError):
            self.site.with_user(self.admin).write({'emcf_url': 'https://evil.example'})
        with self.assertRaises(AccessError):
            self.product(self.shop).write({'company_id': self.hotel.id})
        with self.assertRaises(AccessError):
            self.site.sudo().write({'company_id': self.hotel.id})

    def test_emcf_url_allowlist_and_verification(self):
        with self.assertRaises(UserError):
            self.call(self.admin, 'site_save', id=self.site.id, name='Siège', code='KIN-01', emcf_mode='test',
                      emcf_url='https://developper.dgirdc.cd/edef', emcf_token='x', emcf_isf='ABC-DEF-01')
        self.shop.norma_verified = True
        with self.assertRaises(UserError):
            self.call(self.admin, 'site_save', id=self.site.id, name='Siège', code='KIN-01', emcf_mode='test',
                      emcf_url='https://10.0.0.5/edef', emcf_token='x', emcf_isf='ABC-DEF-01')
        sites = self.call(self.admin, 'site_save', id=self.site.id, name='Siège', code='KIN-01', emcf_mode='test',
                          emcf_url='https://developper.dgirdc.cd/edef', emcf_token='x', emcf_isf='ABC-DEF-01')
        self.assertEqual(sites[0]['emcf_mode'], 'test')
        self.assertFalse(self.site._emcf_url_allowed('https://developper.dgirdc.cd:8443/edef'))
        self.assertFalse(self.site._emcf_url_allowed('https://user@developper.dgirdc.cd/edef'))
        self.assertFalse(self.site._emcf_url_allowed('http://edef.dgirdc.cd'))

    def test_nif_mismatch_blocks_transmission(self):
        self._production_site()
        self.site.sudo().emcf_nif_mismatch = True
        inv = self.sell()
        self.assertEqual(inv['state'], 'failed')
        self.assertTrue(inv['emcf_blocked'])

    def test_checkout_is_idempotent(self):
        p = self.product(self.shop, 'Eau minérale 1,5 L')
        params = dict(site_id=self.site.id, lines=[{'product_id': p.id, 'quantity': 1}],
                      payments=[{'method': 'ESPECES', 'amount': p.price}], request_key='poste1-0001-abcdef')
        a = self.call(self.admin, 'checkout', **params)
        b = self.call(self.admin, 'checkout', **params)
        self.assertEqual(a['id'], b['id'])

    def test_owner_credentials_protected(self):
        other_admin = self.make_user('admin')
        with self.assertRaises(AccessError):
            self.call(other_admin, 'user_save', id=self.admin.id, name=self.admin.name, login=self.admin.login,
                      role='admin', password='Nouveau2026xx')

    def test_cashier_rules_cover_lines_and_folios(self):
        sites = self.call(self.admin, 'site_save', name='Limete', code='KIN-02', address='Limete')
        other = [s for s in sites if s['code'] == 'KIN-02'][0]
        cashier = self.make_user('cashier', sites=[other['id']])
        inv = self.sell()
        lines = self.env['norma.invoice.line'].with_user(cashier).with_company(self.shop).search([('invoice_id', '=', inv['id'])])
        self.assertFalse(lines)


def _ok(sim, site, method, url, body):
    status, data = sim._handle(site, method, url.split('/edef', 1)[1], body)
    resp = requests.Response()
    resp.status_code = status
    resp._content = __import__('json').dumps(data).encode()
    return resp
