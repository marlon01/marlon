# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import HttpCase, TransactionCase, tagged


def _signup(env, category, email, nif, code):
    Platform = env['norma.platform'].sudo()
    vals = Platform._validate_signup({'company': 'Entreprise %s' % code, 'contact': 'Resp', 'email': email,
                                      'password': 'MotDePasse2026', 'nif': nif, 'address': 'Gombe',
                                      'category': category, 'site_code': code})
    return Platform._signup(vals, '127.0.0.9')


@tagged('post_install', '-at_install', 'norma')
class TestSubscription(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.shop = _signup(cls.env, 'magasin', 'boutique@test.cd', 'M1234567N', 'BTQ-01')
        cls.admin = cls.shop.norma_owner_id
        cls.site = cls.shop.norma_site_ids[0]
        cls.product = cls.env['norma.product'].sudo().search([('company_id', '=', cls.shop.id)], limit=1)

    def call(self, op, user=None, **params):
        user = user or self.admin
        return self.env['norma.api'].with_user(user).with_company(user.company_id)._dispatch(op, params)

    def sale(self, **kw):
        p = self.product
        params = dict(site_id=self.site.id, lines=[{'product_id': p.id, 'quantity': 1}],
                      payments=[{'method': 'ESPECES', 'amount': p.price}])
        params.update(kw)
        return self.call('checkout', **params)

    def expire(self):
        self.shop.write({'norma_trial_end': fields.Datetime.now() - timedelta(days=30), 'norma_period_end': False})

    def test_trial_and_cheapest_plan(self):
        self.assertEqual(self.shop._norma_sub_state(), 'trial')
        self.assertGreaterEqual(self.shop._norma_days_left(), 13)
        self.assertEqual(self.shop._norma_plan().price_month, 5.0)
        self.assertEqual(min(self.env['norma.plan'].search([]).mapped('price_month')), 5.0)
        self.assertEqual(self.call('bootstrap')['subscription']['state'], 'trial')

    def test_expired_is_read_only_but_keeps_normalizing(self):
        inv = self.sale()
        self.expire()
        self.assertEqual(self.shop._norma_sub_state(), 'expired')
        with self.assertRaises(AccessError):
            self.sale()
        with self.assertRaises(AccessError):
            self.call('product_save', name='Nouveau', price=10, tax_group='B')
        self.assertEqual(self.call('invoice_get', id=inv['id'])['number'], inv['number'])
        self.assertTrue(self.call('billing')['quotes'])

    def test_grace_period_still_allows_sales(self):
        self.shop.write({'norma_trial_end': fields.Datetime.now() - timedelta(days=2)})
        self.assertEqual(self.shop._norma_sub_state(), 'grace')
        self.assertEqual(self.sale()['state'], 'normalized')

    def test_payment_declared_then_validated_keeps_trial_days(self):
        trial_end = self.shop.norma_trial_end
        b = self.call('billing_declare', months=12, method='MPESA', reference='MP261023.1452.A12345', payer_phone='+243810000000')
        self.assertEqual(b['payments'][0]['state'], 'submitted')
        self.assertEqual(b['payments'][0]['amount'], 50.0)
        with self.assertRaises(UserError):
            self.call('billing_declare', months=1, method='MPESA', reference='MP261023.1452.A12345')
        cashier_login = 'caisse@test.cd'
        self.call('user_save', name='Caisse', login=cashier_login, role='cashier', password='Caisse2026ok')
        cashier = self.env['res.users'].search([('login', '=', cashier_login)])
        with self.assertRaises(AccessError):
            self.call('billing_declare', user=cashier, months=1, method='MPESA', reference='OTHER1234')
        with self.assertRaises(AccessError):
            self.env['norma.platform'].with_user(self.admin).payment_decide(b['payments'][0]['id'], True)
        platform = self.env.ref('base.user_admin')
        self.env['norma.platform'].with_user(platform).payment_decide(b['payments'][0]['id'], True)
        self.assertEqual(self.shop._norma_sub_state(), 'active')
        self.assertGreater(self.shop.norma_period_end, trial_end + timedelta(days=360))
        self.assertTrue(self.shop.norma_payment_ids[0].number.startswith('ABO-'))

    def test_paid_sites_limit_and_offline_rights(self):
        b = self.call('billing_declare', months=1, method='ORANGE', reference='OM.SITES.0001')
        self.env['norma.platform'].with_user(self.env.ref('base.user_admin')).payment_decide(b['payments'][0]['id'], True)
        self.assertEqual(self.shop.norma_paid_sites, 1)
        with self.assertRaises(UserError):
            self.call('site_save', name='Annexe', code='BTQ-03')
        b = self.call('billing_declare', months=1, method='ORANGE', reference='OM.SITES.0002', extra_sites=1)
        self.assertEqual(b['payments'][0]['amount'], 7.0)
        self.env['norma.platform'].with_user(self.env.ref('base.user_admin')).payment_decide(b['payments'][0]['id'], True)
        self.call('site_save', name='Annexe', code='BTQ-03')
        # Une vente hors ligne n'utilise pas les droits de prix ou de remise d'un gestionnaire.
        with self.assertRaises(UserError):
            self.sale(request_key='poste-0009-hors-ligne', offline_at=fields.Datetime.to_string(fields.Datetime.now() - timedelta(hours=1)),
                      lines=[{'product_id': self.product.id, 'quantity': 1, 'discount_pct': 50}],
                      payments=[{'method': 'ESPECES', 'amount': self.product.price / 2}])

    def test_expired_admin_can_still_revoke_access(self):
        users = self.call('user_save', name='Ex', login='ex@test.cd', role='cashier', password='Caisse2026ok')
        uid = [u for u in users if u['login'] == 'ex@test.cd'][0]['id']
        self.expire()
        self.call('user_save', id=uid, name='Ex', login='ex@test.cd', role='cashier', active=False)
        self.assertFalse(self.env['res.users'].with_context(active_test=False).browse(uid).active)
        with self.assertRaises(AccessError):
            self.call('user_save', name='Nouveau', login='new@test.cd', role='cashier', password='Caisse2026ok')

    def test_extra_sites_are_billed(self):
        self.call('site_save', name='Annexe', code='BTQ-02')
        q = self.shop._norma_quote(1)
        self.assertEqual(q['extra_sites'], 1)
        self.assertEqual(q['total'], 5.0 + 2.0)

    # ================================================================ ventes hors ligne
    def test_offline_sale_uses_price_at_sale_time(self):
        old_price = self.product.price
        sold_at = fields.Datetime.now() - timedelta(hours=2)
        self.env['norma.product.price'].sudo().search([('product_id', '=', self.product.id)]).write({'date_from': sold_at - timedelta(days=1)})
        self.call('product_save', id=self.product.id, name=self.product.name, price=old_price + 500,
                  tax_group=self.product.tax_group_id.code, item_type='BIE')
        self.call('user_save', name='C', login='c2@test.cd', role='cashier', password='Caisse2026ok')
        cashier = self.env['res.users'].search([('login', '=', 'c2@test.cd')])
        inv = self.call('checkout', user=cashier, site_id=self.site.id, request_key='poste-0001-hors-ligne',
                        offline_at=fields.Datetime.to_string(sold_at),
                        lines=[{'product_id': self.product.id, 'quantity': 1, 'price': old_price}],
                        payments=[{'method': 'ESPECES', 'amount': old_price}])
        self.assertEqual(inv['total'], old_price)
        self.assertTrue(inv['offline_at'])
        with self.assertRaises(AccessError):  # prix jamais affiché
            self.call('checkout', user=cashier, site_id=self.site.id, request_key='poste-0002-hors-ligne',
                      offline_at=fields.Datetime.to_string(sold_at),
                      lines=[{'product_id': self.product.id, 'quantity': 1, 'price': 1}],
                      payments=[{'method': 'ESPECES', 'amount': 1}])
        with self.assertRaises(AccessError):  # prix nouveau ou ancien, mais pas celui de l'heure annoncée
            self.call('checkout', user=cashier, site_id=self.site.id, request_key='poste-0006-hors-ligne',
                      offline_at=fields.Datetime.to_string(sold_at - timedelta(days=2)),
                      lines=[{'product_id': self.product.id, 'quantity': 1, 'price': old_price + 1000}],
                      payments=[{'method': 'ESPECES', 'amount': old_price + 1000}])
        self.assertTrue(self.env['norma.audit'].sudo().search_count([('company_id', '=', self.shop.id), ('event', '=', 'offline.price')]))
        with self.assertRaises(UserError):  # trop ancienne
            self.sale(request_key='poste-0003-hors-ligne', offline_at=fields.Datetime.to_string(fields.Datetime.now() - timedelta(hours=73)))
        with self.assertRaises(UserError):  # sans clé
            self.sale(offline_at=fields.Datetime.to_string(sold_at))

    def test_offline_sale_made_before_expiry_still_syncs(self):
        sold_at = fields.Datetime.now() - timedelta(hours=1)
        self.shop.write({'norma_trial_end': fields.Datetime.now() - timedelta(days=5, hours=12)})  # grâce finie il y a 12 h
        with self.assertRaises(AccessError):
            self.sale(request_key='poste-0004-hors-ligne', offline_at=fields.Datetime.to_string(sold_at))
        old = fields.Datetime.now() - timedelta(days=1)
        inv = self.sale(request_key='poste-0005-hors-ligne', offline_at=fields.Datetime.to_string(old))
        self.assertEqual(inv['state'], 'normalized')


@tagged('post_install', '-at_install', 'norma')
class TestOfflineHttp(HttpCase):

    def test_provisional_ticket_link(self):
        shop = _signup(self.env, 'supermarche', 'super@test.cd', 'S7654321T', 'SUP-01')
        p = self.env['norma.product'].sudo().search([('company_id', '=', shop.id)], limit=1)
        api = self.env['norma.api'].with_user(shop.norma_owner_id).with_company(shop)
        inv = api._dispatch('checkout', {'site_id': shop.norma_site_ids[0].id, 'request_key': 'abcdef0123456789abcd',
                                         'lines': [{'product_id': p.id, 'quantity': 1}],
                                         'payments': [{'method': 'ESPECES', 'amount': p.price}]})
        res = self.url_open('/norma/r/abcdef0123456789abcd', allow_redirects=False)
        self.assertEqual(res.status_code, 303)
        self.assertIn('/norma/v/%s' % inv['verify_token'], res.headers['Location'])
        waiting = self.url_open('/norma/r/ffffffffffffffffffff')
        self.assertIn('en cours de normalisation', waiting.text)
        self.assertEqual(self.url_open('/norma/sw.js').headers.get('Service-Worker-Allowed'), '/norma/')
        self.assertIn('NORMA', self.url_open('/norma/manifest.webmanifest').text)
        other = _signup(self.env, 'magasin', 'other@test.cd', 'O7654321T', 'OTH-01')
        q = self.env['norma.product'].sudo().search([('company_id', '=', other.id)], limit=1)
        api2 = self.env['norma.api'].with_user(other.norma_owner_id).with_company(other)
        with self.assertRaises(UserError):  # la clé d'une autre entreprise ne peut ni être reprise ni renvoyer sa facture
            api2._dispatch('checkout', {'site_id': other.norma_site_ids[0].id, 'request_key': 'abcdef0123456789abcd',
                                        'lines': [{'product_id': q.id, 'quantity': 1}],
                                        'payments': [{'method': 'ESPECES', 'amount': q.price}]})
        landing = self.url_open('/norma')
        self.assertIn('5 $', landing.text)
