# -*- coding: utf-8 -*-
import hashlib
import hmac
import json
from datetime import timedelta

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
