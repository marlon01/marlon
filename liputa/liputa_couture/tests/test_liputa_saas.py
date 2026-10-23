# -*- coding: utf-8 -*-
import hashlib
import hmac
import json
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import HttpCase, TransactionCase, tagged

from odoo.addons.liputa_couture.controllers.app import LiputaApp


class LiputaCommon(TransactionCase):
    """Deux ateliers inscrits, chacun avec son chef d'atelier."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Company = cls.env["res.company"]
        cd = cls.env.ref("base.cd")
        cls.atelier_a = Company._liputa_create_workshop(
            {"atelier": "Atelier Mama Ngondo", "name": "Mama Ngondo", "email": "ngondo@test.cd",
             "phone": "+243810000001", "password": "Motdepasse123"}, cd, "10.0.0.1")
        cls.atelier_b = Company._liputa_create_workshop(
            {"atelier": "Couture Kin Style", "name": "Papa Kin", "email": "kin@test.cd",
             "phone": "+243810000002", "password": "Motdepasse123"}, cd, "10.0.0.1")
        cls.user_a = cls.env["res.users"].search([("login", "=", "ngondo@test.cd")])
        cls.user_b = cls.env["res.users"].search([("login", "=", "kin@test.cd")])
        cls.model_lib = cls.env.ref("liputa_couture.lib_kaba_ngondo")

    def as_user(self, user, model):
        return self.env[model].with_user(user).with_company(user.company_id)

    def _order(self, user, partner_name="Cliente Test", **extra):
        partner = self.as_user(user, "res.partner").create({"name": partner_name, "company_id": user.company_id.id})
        vals = {"partner_id": partner.id, "garment_model_id": self.model_lib.id, "gender": "women",
                "bust": 96, "waist": 78, "hip": 104, "height": 165}
        vals.update(extra)
        return self.as_user(user, "liputa.order").create(vals)


@tagged("post_install", "-at_install", "liputa")
class TestLiputaSaas(LiputaCommon):

    # ------------------------------------------------------------------ inscription
    def test_signup_creates_isolated_workshop_with_trial(self):
        a = self.atelier_a
        self.assertTrue(a.is_atelier)
        sub = a.liputa_subscription_id
        self.assertEqual(sub.state, "trial")
        self.assertEqual(sub.next_due_date, fields.Date.context_today(sub) + timedelta(days=14))
        self.assertEqual(self.user_a.company_ids, a)
        self.assertEqual(self.user_a.partner_id.company_id, a)
        self.assertEqual(a.partner_id.company_id, a)
        self.assertTrue(self.user_a.has_group("liputa_couture.group_liputa_manager"))
        self.assertFalse(self.user_a.has_group("liputa_couture.group_liputa_saas_admin"))
        self.assertTrue(self.env["liputa.tailor"].search([("company_id", "=", a.id)]))

    def test_order_numbering_is_per_workshop(self):
        oa, ob = self._order(self.user_a), self._order(self.user_b)
        self.assertEqual(oa.name, ob.name)

    # ------------------------------------------------------------------ cloisonnement
    def test_workshop_cannot_see_other_orders_or_clients(self):
        ob = self._order(self.user_b, partner_name="Cliente secrète de B")
        Order_a = self.as_user(self.user_a, "liputa.order")
        self.assertFalse(Order_a.search([("id", "=", ob.id)]))
        with self.assertRaises(AccessError):
            Order_a.browse(ob.id).read(["name"])
        names = [p.name for p in self.as_user(self.user_a, "res.partner").search([])]
        self.assertNotIn("Cliente secrète de B", names)
        self.assertNotIn("Papa Kin", names)

    def test_order_cannot_use_other_workshop_client(self):
        ob = self._order(self.user_b, partner_name="Cliente de B")
        with self.assertRaises(Exception) as ctx:
            self._order_with_partner(self.user_a, ob.partner_id)
        self.assertIsInstance(ctx.exception, (AccessError, UserError, ValidationError))

    def _order_with_partner(self, user, partner):
        return self.as_user(user, "liputa.order").create({
            "partner_id": partner.id, "garment_model_id": self.model_lib.id, "gender": "women", "bust": 90})

    def test_order_options_are_isolated(self):
        ob = self._order(self.user_b)
        self.env["liputa.order.option"].create({"order_id": ob.id, "name": "Broderie or", "price": 10000})
        self.assertFalse(self.as_user(self.user_a, "liputa.order.option").search([]))

    def test_adopt_only_library_models(self):
        private_b = self.as_user(self.user_b, "liputa.garment.model").browse(self.model_lib.id).action_adopt()
        model_b = self.env["liputa.garment.model"].browse(private_b["res_id"])
        self.assertEqual(model_b.company_id, self.atelier_b)
        with self.assertRaises(Exception) as ctx:
            self.as_user(self.user_a, "liputa.garment.model").browse(model_b.id).action_adopt()
        self.assertIsInstance(ctx.exception, (AccessError, UserError))

    # ------------------------------------------------------------------ abonnement
    def test_manager_cannot_confirm_own_payment(self):
        sub = self.atelier_a.liputa_subscription_id
        pay = self.env["liputa.subscription.payment"].create({"subscription_id": sub.id, "amount": 5000,
                                                              "method": "mpesa", "phone": "+243810000001"})
        with self.assertRaises(UserError):
            pay.with_user(self.user_a).action_confirm()
        due = sub.next_due_date
        pay.with_user(self.env.ref("base.user_admin")).action_confirm()
        self.assertEqual(pay.state, "done")
        self.assertEqual(sub.state, "active")
        self.assertGreater(sub.next_due_date, due)

    def test_suspended_workshop_cannot_take_orders(self):
        self.atelier_a.liputa_subscription_id.state = "suspended"
        with self.assertRaises(UserError):
            self._order(self.user_a)

    def test_monthly_order_quota(self):
        self.env.ref("liputa_couture.plan_standard").max_orders_month = 1
        self._order(self.user_a)
        with self.assertRaises(UserError):
            self._order(self.user_a, partner_name="Deuxième cliente")
        self._order(self.user_b)  # quota compté par atelier

    def test_subscription_lifecycle_cron(self):
        sub = self.atelier_a.liputa_subscription_id
        sub.next_due_date = fields.Date.context_today(sub) - timedelta(days=1)
        self.env["liputa.subscription"]._cron_check_subscriptions()
        self.assertEqual(sub.state, "grace")
        sub.next_due_date = fields.Date.context_today(sub) - timedelta(days=30)
        self.env["liputa.subscription"]._cron_check_subscriptions()
        self.assertEqual(sub.state, "suspended")

    # ------------------------------------------------------------------ métier
    def test_pattern_and_estimate_work_for_an_order(self):
        order = self._order(self.user_a)
        data = order.get_pattern_data()
        self.assertIn("<svg", data.get("svg", "") if isinstance(data, dict) else str(data))
        order.action_estimate_delivery()
        self.assertTrue(order.delivery_date_estimated)


@tagged("post_install", "-at_install", "liputa")
class TestLiputaHttp(HttpCase):

    def test_signup_form_and_signed_webhook(self):
        page = self.url_open("/liputa/signup")
        self.assertEqual(page.status_code, 200)
        token = page.text.split('name="csrf_token" value="')[1].split('"')[0]
        resp = self.url_open("/liputa/signup", data={
            "csrf_token": token, "atelier": "Atelier Beauté Wax", "name": "Awa Test", "email": "awa@wax.cd",
            "phone": "+243810000009", "country_id": str(self.env.ref("base.cd").id), "password": "Motdepasse123"},
            allow_redirects=False)
        self.assertIn(resp.status_code, (302, 303))
        company = self.env["res.company"].search([("name", "=", "Atelier Beauté Wax")])
        sub = company.liputa_subscription_id
        self.assertEqual(sub.state, "trial")

        pay = self.env["liputa.subscription.payment"].create(
            {"subscription_id": sub.id, "amount": 5000, "method": "mpesa", "phone": "+243810000009"})
        self.env["ir.config_parameter"].sudo().set_param("liputa.payment.secret.flexpay", "secret-test")
        body = json.dumps({"reference": pay.reference, "status": "success", "provider_reference": "FP-1"}).encode()
        bad = self.url_open("/liputa/payment/webhook/flexpay", data=body,
                            headers={"Content-Type": "application/json", "X-Liputa-Signature": "0" * 64})
        self.assertEqual(bad.status_code, 403)
        sig = hmac.new(b"secret-test", body, hashlib.sha256).hexdigest()
        ok = self.url_open("/liputa/payment/webhook/flexpay", data=body,
                           headers={"Content-Type": "application/json", "X-Liputa-Signature": sig})
        self.assertEqual(ok.status_code, 200)
        pay.invalidate_recordset()
        self.assertEqual(pay.state, "done")
        self.assertEqual(sub.state, "active")


class FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data


@tagged("post_install", "-at_install", "liputa")
class TestLiputaFlexpay(LiputaCommon):

    def setUp(self):
        super().setUp()
        icp = self.env["ir.config_parameter"].sudo()
        icp.set_param("liputa.payment.provider", "flexpay")
        icp.set_param("liputa.flexpay.merchant", "LIPUTA")
        icp.set_param("liputa.flexpay.token", "jeton-test")
        icp.set_param("web.base.url", "https://app.liputa.test")
        self.sub = self.atelier_a.liputa_subscription_id

    def _pay(self, phone="+243 81 234 5678", method="mpesa"):
        pay = self.env["liputa.subscription.payment"].create(
            {"subscription_id": self.sub.id, "amount": 5000, "method": method, "phone": phone})
        with patch("odoo.addons.liputa_couture.models.saas.requests.post",
                   return_value=FakeResponse({"code": "0", "message": "OK", "orderNumber": "FP-123"})) as post:
            pay._liputa_initiate()
        return pay, post

    def test_payment_request_sent_to_flexpay(self):
        pay, post = self._pay()
        url, kwargs = post.call_args.args[0], post.call_args.kwargs
        self.assertEqual(url, "https://backend.flexpay.cd/api/rest/v1/paymentService")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer jeton-test")
        body = kwargs["json"]
        self.assertEqual((body["merchant"], body["type"], body["phone"]), ("LIPUTA", "1", "243812345678"))
        self.assertEqual((body["amount"], body["currency"], body["reference"]), ("5000", "CDF", pay.reference))
        self.assertEqual(body["callbackUrl"], "https://app.liputa.test/liputa/payment/flexpay/callback")
        self.assertEqual((pay.provider, pay.provider_order, pay.state), ("flexpay", "FP-123", "pending"))

    def test_local_number_and_invalid_inputs(self):
        pay, post = self._pay(phone="0991234567")
        self.assertEqual(post.call_args.kwargs["json"]["phone"], "243991234567")
        with self.assertRaises(UserError):
            self._pay(phone="12345")
        with self.assertRaises(UserError):
            self._pay(method="card")

    def test_success_is_verified_with_flexpay(self):
        pay, _post = self._pay()
        due = self.sub.next_due_date
        ok = {"code": "0", "transaction": {"status": "0", "amount": "5000", "currency": "CDF", "reference": pay.reference}}
        with patch("odoo.addons.liputa_couture.models.saas.requests.get", return_value=FakeResponse(ok)) as get:
            pay._liputa_check_flexpay()
        self.assertEqual(get.call_args.args[0], "https://backend.flexpay.cd/api/rest/v1/check/FP-123")
        self.assertEqual(pay.state, "done")
        self.assertEqual(self.sub.state, "active")
        self.assertGreater(self.sub.next_due_date, due)

    def test_underpaid_or_failed_transaction_does_not_renew(self):
        pay, _post = self._pay()
        low = {"code": "0", "transaction": {"status": "0", "amount": "50", "currency": "CDF", "reference": pay.reference}}
        with patch("odoo.addons.liputa_couture.models.saas.requests.get", return_value=FakeResponse(low)):
            pay._liputa_check_flexpay()
        self.assertEqual(pay.state, "failed")
        self.assertEqual(self.sub.state, "trial")
        pay2, _post = self._pay()
        ko = {"code": "1", "message": "Solde insuffisant", "transaction": {"status": "1"}}
        with patch("odoo.addons.liputa_couture.models.saas.requests.get", return_value=FakeResponse(ko)):
            pay2._liputa_check_flexpay()
        self.assertEqual((pay2.state, pay2.provider_message), ("failed", "Solde insuffisant"))

    def test_pending_stays_pending_and_cron_retries(self):
        pay, _post = self._pay()
        waiting = {"code": "0", "transaction": {"status": "2", "amount": "5000", "currency": "CDF"}}
        with patch("odoo.addons.liputa_couture.models.saas.requests.get", return_value=FakeResponse(waiting)):
            self.env["liputa.subscription.payment"]._cron_check_flexpay()
        self.assertEqual(pay.state, "pending")

    def test_status_endpoint_is_scoped_to_the_workshop(self):
        pay, _post = self._pay()
        app = self.env["liputa.subscription.payment"].with_user(self.user_b).with_company(self.atelier_b)
        self.assertFalse(app.sudo().search([("reference", "=", pay.reference), ("company_id", "=", self.atelier_b.id)]))


@tagged("post_install", "-at_install", "liputa")
class TestLiputaFlexpayHttp(HttpCase):

    def test_forged_callback_cannot_validate_a_payment(self):
        company = self.env["res.company"]._liputa_create_workshop(
            {"atelier": "Atelier Rappel", "name": "R", "email": "r@rappel.cd", "password": "Motdepasse123"})
        icp = self.env["ir.config_parameter"].sudo()
        icp.set_param("liputa.flexpay.merchant", "LIPUTA")
        icp.set_param("liputa.flexpay.token", "jeton-test")
        pay = self.env["liputa.subscription.payment"].create({
            "subscription_id": company.liputa_subscription_id.id, "amount": 5000, "method": "mpesa",
            "phone": "243812345678", "provider": "flexpay", "provider_order": "FP-9"})
        body = json.dumps({"code": "0", "reference": pay.reference, "orderNumber": "FP-9"})
        # FlexPay répond que la transaction a échoué : le rappel « succès » est ignoré.
        ko = FakeResponse({"code": "1", "transaction": {"status": "1"}})
        with patch("odoo.addons.liputa_couture.models.saas.requests.get", return_value=ko):
            resp = self.url_open("/liputa/payment/flexpay/callback", data=body,
                                 headers={"Content-Type": "application/json"})
        self.assertEqual(resp.status_code, 200)
        pay.invalidate_recordset()
        self.assertEqual(pay.state, "failed")
        self.assertEqual(company.liputa_subscription_id.state, "trial")


@tagged("post_install", "-at_install", "liputa")
class TestLiputaPaymentRouting(LiputaCommon):
    """Choix automatique de l'agrégateur selon le pays, et parcours CinetPay."""

    def setUp(self):
        super().setUp()
        icp = self.env["ir.config_parameter"].sudo()
        for key, value in (("liputa.payment.provider", "auto"), ("liputa.flexpay.merchant", "LIPUTA"),
                           ("liputa.flexpay.token", "jeton"), ("liputa.cinetpay.site_id", "123"),
                           ("liputa.cinetpay.api_key", "cle"), ("web.base.url", "https://app.liputa.test")):
            icp.set_param(key, value)
        self.Payment = self.env["liputa.subscription.payment"]

    def test_provider_chosen_by_country(self):
        self.assertEqual(self.Payment._liputa_provider_for(self.atelier_a), "flexpay")  # RDC
        self.atelier_b.country_id = self.env.ref("base.sn")
        self.assertEqual(self.Payment._liputa_provider_for(self.atelier_b), "cinetpay")  # Sénégal
        self.assertEqual(self.Payment._liputa_flow_for(self.atelier_b), "redirect")
        self.env["ir.config_parameter"].sudo().set_param("liputa.flexpay.token", "")
        self.assertEqual(self.Payment._liputa_provider_for(self.atelier_a), "cinetpay")  # RDC sans FlexPay
        self.env["ir.config_parameter"].sudo().set_param("liputa.cinetpay.api_key", "")
        self.assertEqual(self.Payment._liputa_flow_for(self.atelier_a), "manual")

    def _cinetpay_payment(self):
        self.atelier_b.country_id = self.env.ref("base.sn")
        sub = self.atelier_b.liputa_subscription_id
        pay = self.Payment.create({"subscription_id": sub.id, "amount": 5000, "method": "online"})
        created = FakeResponse({"code": "201", "data": {"payment_url": "https://checkout.cinetpay.com/payment/xyz"}})
        with patch("odoo.addons.liputa_couture.models.saas.requests.post", return_value=created) as post:
            pay._liputa_initiate()
        return pay, post

    def test_cinetpay_redirect_then_verified_payment(self):
        pay, post = self._cinetpay_payment()
        body = post.call_args.kwargs["json"]
        self.assertEqual(post.call_args.args[0], "https://api-checkout.cinetpay.com/v2/payment")
        self.assertEqual((body["transaction_id"], body["amount"], body["site_id"]), (pay.reference, 5000, "123"))
        self.assertEqual(body["return_url"], "https://app.liputa.test/liputa/payment/cinetpay/return?ref=%s" % pay.reference)
        self.assertEqual((pay.provider, pay.provider_url), ("cinetpay", "https://checkout.cinetpay.com/payment/xyz"))
        low = FakeResponse({"code": "00", "data": {"status": "ACCEPTED", "amount": "10", "currency": pay.currency_id.name}})
        with patch("odoo.addons.liputa_couture.models.saas.requests.post", return_value=low):
            pay._liputa_check_cinetpay()
        self.assertEqual(pay.state, "failed")
        pay2, _post = self._cinetpay_payment()
        ok = FakeResponse({"code": "00", "data": {"status": "ACCEPTED", "amount": "5000",
                                                  "currency": pay2.currency_id.name, "operator_id": "OM-1"}})
        with patch("odoo.addons.liputa_couture.models.saas.requests.post", return_value=ok):
            pay2._liputa_check_online()
        self.assertEqual((pay2.state, pay2.provider_reference), ("done", "OM-1"))
        self.assertEqual(self.atelier_b.liputa_subscription_id.state, "active")


@tagged("post_install", "-at_install", "liputa")
class TestLiputaCinetpayHttp(HttpCase):

    def test_return_and_notify_verify_with_cinetpay(self):
        company = self.env["res.company"]._liputa_create_workshop(
            {"atelier": "Atelier Dakar", "name": "D", "email": "d@dakar.sn", "password": "Motdepasse123"},
            self.env.ref("base.sn"))
        icp = self.env["ir.config_parameter"].sudo()
        icp.set_param("liputa.cinetpay.site_id", "123")
        icp.set_param("liputa.cinetpay.api_key", "cle")
        pay = self.env["liputa.subscription.payment"].create({
            "subscription_id": company.liputa_subscription_id.id, "amount": 5000, "method": "online",
            "provider": "cinetpay", "provider_order": "x"})
        waiting = FakeResponse({"code": "662", "data": {"status": "WAITING_FOR_CUSTOMER"}})
        with patch("odoo.addons.liputa_couture.models.saas.requests.post", return_value=waiting):
            resp = self.url_open("/liputa/payment/cinetpay/return?ref=%s" % pay.reference, allow_redirects=False)
        self.assertIn("/app#/account?payment=pending", resp.headers.get("Location", ""))
        ok = FakeResponse({"code": "00", "data": {"status": "ACCEPTED", "amount": "5000", "currency": pay.currency_id.name}})
        with patch("odoo.addons.liputa_couture.models.saas.requests.post", return_value=ok):
            notify = self.url_open("/liputa/payment/cinetpay/notify", data={"cpm_trans_id": pay.reference})
        self.assertEqual(notify.status_code, 200)
        pay.invalidate_recordset()
        self.assertEqual(pay.state, "done")
