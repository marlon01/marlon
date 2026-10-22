# -*- coding: utf-8 -*-
import base64
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import HttpCase, tagged

from odoo.addons.selecta_saas.controllers.main import render_legal_text
from odoo.addons.selecta_saas.models.payment_providers import CinetPay, Stripe

from .common import SaasCommon


class FakeResponse:
    def __init__(self, data, status=200):
        self._data, self.status_code = data, status

    def json(self):
        return self._data


@tagged('post_install', '-at_install', 'selecta_saas')
class TestSaasFeatures(SaasCommon):

    def setUp(self):
        super().setUp()
        icp = self.env['ir.config_parameter'].sudo()
        icp.set_param('selecta_saas.cinetpay_enabled', 'True')
        icp.set_param('selecta_saas.cinetpay_site_id', '123456')
        icp.set_param('selecta_saas.cinetpay_api_key', 'cle-test')
        icp.set_param('selecta_saas.stripe_enabled', 'True')
        icp.set_param('selecta_saas.stripe_secret_key', 'sk_test_123')
        self.Mail = self.env['selecta.saas.mail']

    def _paid_period(self, tenant, plan, days_total=30, days_left=15, amount=None):
        """Simule un abonnement payé dont il reste ``days_left`` jours."""
        now = fields.Datetime.now()
        start, end = now - timedelta(days=days_total - days_left), now + timedelta(days=days_left)
        tenant.write({'plan_id': plan.id, 'period_end': end, 'state': 'active'})
        return self.env['selecta.saas.invoice'].create({
            'tenant_id': tenant.id, 'plan_id': plan.id, 'billing_cycle': 'monthly', 'state': 'paid',
            'currency_id': plan.currency_id.id, 'amount': amount if amount is not None else plan.price_monthly,
            'period_start': start, 'period_end': end})

    # ------------------------------------------------------------------ courriels
    def test_signup_queues_welcome_and_platform_mails(self):
        mails = self.Mail.search([('tenant_id', '=', self.tenant_a.id)])
        self.assertIn('signup_welcome', mails.mapped('template'))
        welcome = mails.filtered(lambda m: m.template == 'signup_welcome')
        self.assertEqual(welcome.email_to, 'alpha@test.cd')
        self.assertIn('Lycée Alpha', welcome.body_html)
        self.assertIn('/selecta/login', welcome.body_html)

    def test_mail_sending_retries_then_succeeds(self):
        self.env['ir.config_parameter'].sudo().set_param('selecta_saas.mail_enabled', 'True')
        mail = self.Mail.search([('template', '=', 'signup_welcome'), ('tenant_id', '=', self.tenant_a.id)])
        with patch.object(type(self.env['ir.mail_server']), 'send_email', side_effect=OSError('SMTP indisponible')):
            mail._send_now()
        self.assertEqual((mail.state, mail.attempts), ('queued', 1))
        self.assertIn('SMTP', mail.last_error)
        with patch.object(type(self.env['ir.mail_server']), 'send_email', return_value='<id>') as send:
            mail._send_now()
        self.assertEqual(mail.state, 'sent')
        self.assertEqual(send.call_count, 1)

    def test_trial_reminders_are_sent_once(self):
        self.tenant_a.trial_end = fields.Datetime.now() + timedelta(days=2, hours=1)
        self.Tenant._cron_lifecycle()
        self.Tenant._cron_lifecycle()
        reminders = self.Mail.search([('tenant_id', '=', self.tenant_a.id), ('template', '=', 'trial_reminder')])
        self.assertEqual(len(reminders), 1)
        self.tenant_a.trial_end = fields.Datetime.now() - timedelta(minutes=5)
        self.Tenant._cron_lifecycle()
        self.Tenant._cron_lifecycle()
        self.assertEqual(self.Mail.search_count([('tenant_id', '=', self.tenant_a.id), ('template', '=', 'trial_expired')]), 1)

    def test_payment_events_notify_tenant(self):
        bo = self.bo(self.user_a)
        inv = bo.billing_checkout(self.plan_pme.id, 'monthly')
        self.assertTrue(self.Mail.search([('template', '=', 'invoice_issued'), ('tenant_id', '=', self.tenant_a.id)]))
        bo.billing_declare(inv['id'], 'mobile_money', 'MP-1')
        admin = self.env.ref('base.user_admin')
        self.env['selecta.saas.platform'].with_user(admin).invoice_action(inv['id'], 'validate')
        self.assertTrue(self.Mail.search([('template', '=', 'payment_validated'), ('tenant_id', '=', self.tenant_a.id)]))

    # ------------------------------------------------------------------ paiement en ligne
    def test_cinetpay_payment_is_verified_server_side(self):
        bo = self.bo(self.user_a)
        inv = bo.billing_checkout(self.plan_pme.id, 'monthly')
        with patch.object(CinetPay, '_post', return_value=FakeResponse(
                {'code': '201', 'data': {'payment_url': 'https://checkout.cinetpay.com/payment/abc'}})) as post:
            res = bo.billing_pay_online(inv['id'], 'cinetpay')
        self.assertEqual(res['url'], 'https://checkout.cinetpay.com/payment/abc')
        payload = post.call_args.kwargs['json']
        self.assertEqual((payload['amount'], payload['currency']), (79, 'USD'))
        record = self.env['selecta.saas.invoice'].browse(inv['id'])
        # Montant insuffisant annoncé par le prestataire : la facture reste due.
        with patch.object(CinetPay, '_post', return_value=FakeResponse(
                {'code': '00', 'data': {'status': 'ACCEPTED', 'amount': '5', 'currency': 'USD'}})):
            self.assertEqual(record._online_check(), 'failed')
        self.assertEqual(record.state, 'open')
        with patch.object(CinetPay, '_post', return_value=FakeResponse(
                {'code': '00', 'data': {'status': 'ACCEPTED', 'amount': '79', 'currency': 'USD', 'operator_id': 'OP-9'}})):
            self.assertEqual(record._online_check(), 'paid')
        self.assertEqual(record.state, 'paid')
        self.assertEqual(record.payment_reference, 'OP-9')
        self.assertEqual(self.tenant_a._effective_state(), 'active')

    def test_stripe_session_must_match_invoice(self):
        bo = self.bo(self.user_a)
        inv = bo.billing_checkout(self.plan_pme.id, 'monthly')
        with patch.object(Stripe, '_post', return_value=FakeResponse({'id': 'cs_1', 'url': 'https://checkout.stripe.com/c/cs_1'})):
            bo.billing_pay_online(inv['id'], 'stripe')
        record = self.env['selecta.saas.invoice'].browse(inv['id'])
        foreign = {'client_reference_id': 'AUTRE', 'payment_status': 'paid', 'amount_total': 7900, 'currency': 'usd'}
        with patch.object(Stripe, '_get', return_value=FakeResponse(foreign)):
            self.assertEqual(record._online_check(), 'failed')
        ok = dict(foreign, client_reference_id=record.online_reference, payment_intent='pi_1')
        with patch.object(Stripe, '_get', return_value=FakeResponse(ok)):
            self.assertEqual(record._online_check(), 'paid')

    def test_disabled_provider_is_refused(self):
        self.env['ir.config_parameter'].sudo().set_param('selecta_saas.stripe_enabled', 'False')
        inv = self.bo(self.user_a).billing_checkout(self.plan_pme.id, 'monthly')
        with self.assertRaises(UserError):
            self.bo(self.user_a).billing_pay_online(inv['id'], 'stripe')

    # ------------------------------------------------------------------ proratisation
    def test_upgrade_deducts_unused_value(self):
        self._paid_period(self.tenant_a, self.plan_pme, days_total=30, days_left=15)
        grande = self.env.ref('selecta_saas.plan_grande')
        quote = self.bo(self.user_a).billing_quote(grande.id, 'monthly')
        self.assertTrue(quote['prorated'])
        self.assertAlmostEqual(quote['credit'], 39, delta=1)
        inv = self.bo(self.user_a).billing_checkout(grande.id, 'monthly')
        self.assertAlmostEqual(inv['amount'], 199 - quote['credit'], delta=0.01)
        self.env['selecta.saas.invoice'].browse(inv['id'])._validate()
        self.assertEqual(self.tenant_a.plan_id, grande)
        self.assertAlmostEqual((self.tenant_a.period_end - fields.Datetime.now()).days, 30, delta=1)

    def test_downgrade_applies_at_period_end(self):
        self._paid_period(self.tenant_a, self.plan_pme, days_left=10)
        old_end = self.tenant_a.period_end
        inv = self.bo(self.user_a).billing_checkout(self.plan_ecole.id, 'monthly')
        self.assertEqual(inv['amount'], self.plan_ecole.price_monthly)
        record = self.env['selecta.saas.invoice'].browse(inv['id'])
        record._validate()
        self.assertEqual(self.tenant_a.plan_id, self.plan_pme, "la catégorie supérieure reste acquise jusqu'à l'échéance")
        self.assertEqual(record.period_start, old_end)
        record.period_start = fields.Datetime.now() - timedelta(minutes=1)
        self.Tenant._cron_lifecycle()
        self.assertEqual(self.tenant_a.plan_id, self.plan_ecole)

    # ------------------------------------------------------------------ données, logo, documents
    def test_biometric_data_purged_after_retention(self):
        Concours = self.env['selecta.concours']
        c = self.as_user(self.user_a, 'selecta.concours').create({'name': 'Ancien concours'})
        cand = self.bo(self.user_a).candidate_save({'concours_id': c.id, 'name': 'Awa', 'reference': 'R-1'})
        png = base64.b64encode(base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
        cand_rec = self.env['selecta.candidate'].browse(cand['id'])
        cand_rec.sudo().photo_reference = png
        c._engine().write({'state': 'closed', 'closed_date': fields.Datetime.now() - timedelta(days=200)})
        Concours._cron_purge_biometrics()
        self.assertFalse(cand_rec.sudo().photo_reference)
        self.assertTrue(c.biometrics_purged_date)
        self.assertTrue(self.env['selecta.audit.log'].verify_chain(self.tenant_a.company_id.id)['ok'])

    def test_generated_logo_is_svg_monogram(self):
        logo = base64.b64decode(self.tenant_a.company_id.logo)
        self.assertTrue(logo.startswith(b'<svg'))
        self.assertIn(b'>LA<', logo)

    def test_legal_text_is_escaped(self):
        html = str(render_legal_text("# Titre\n\nTexte <script>alert(1)</script>\n- point"))
        self.assertIn('<h1>Titre</h1>', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('<li>point</li>', html)


@tagged('post_install', '-at_install', 'selecta_saas')
class TestSaasHttp(HttpCase):

    def test_public_pages_and_signup_records_terms(self):
        for url in ('/selecta', '/selecta/conditions', '/selecta/confidentialite', '/selecta/signup'):
            self.assertEqual(self.url_open(url).status_code, 200, url)
        self.assertIn('Conditions générales', self.url_open('/selecta/conditions').text)
        res = self.make_jsonrpc_request('/selecta/saas/signup', {
            'organization': 'Collège Gamma', 'contact_name': 'Jean Gamma', 'email': 'jean@gamma.cd',
            'phone': '', 'country': 'CD', 'password': 'Motdepasse123', 'plan': 'ecole_ong', 'accept_terms': True})
        self.assertTrue(res.get('ok'), res)
        tenant = self.env['selecta.saas.tenant'].search([('email', '=', 'jean@gamma.cd')])
        self.assertTrue(tenant.terms_accepted_date)

    def test_payment_notification_triggers_verification(self):
        tenant = self.env['selecta.saas.tenant']._create_space({
            'organization': 'Delta SARL', 'contact_name': 'D', 'email': 'd@delta.cd', 'password': 'Motdepasse123',
            'plan': self.env.ref('selecta_saas.plan_pme')})
        icp = self.env['ir.config_parameter'].sudo()
        for k, v in (('cinetpay_enabled', 'True'), ('cinetpay_site_id', '1'), ('cinetpay_api_key', 'k')):
            icp.set_param('selecta_saas.%s' % k, v)
        inv = self.env['selecta.saas.invoice'].create({
            'tenant_id': tenant.id, 'plan_id': tenant.plan_id.id, 'billing_cycle': 'monthly',
            'currency_id': tenant.plan_id.currency_id.id, 'amount': 79,
            'online_provider': 'cinetpay', 'online_reference': 'ABO-TEST-1', 'online_started': fields.Datetime.now()})
        accepted = FakeResponse({'code': '00', 'data': {'status': 'ACCEPTED', 'amount': '79', 'currency': 'USD'}})
        with patch.object(CinetPay, '_post', return_value=accepted):
            resp = self.url_open('/selecta/saas/pay/notify/cinetpay', data={'cpm_trans_id': 'ABO-TEST-1'})
        self.assertEqual(resp.status_code, 200)
        inv.invalidate_recordset()
        self.assertEqual(inv.state, 'paid')
