# -*- coding: utf-8 -*-
import json
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests import HttpCase, tagged

from odoo.addons.liputa_couture.models.client_portal import whatsapp_digits
from .test_liputa_saas import LiputaCommon


def _client(env, login, name="Cliente Portail"):
    main = env.ref("base.main_company")
    user = env["res.users"].with_context(no_reset_password=True).create({
        "name": name, "login": login, "email": login, "password": "Motdepasse123",
        "groups_id": [(6, 0, [env.ref("base.group_portal").id])],
        "company_id": main.id, "company_ids": [(6, 0, [main.id])]})
    user.partner_id.company_id = main
    return user


def _device(env, partner, n=1):
    return env["mail.push.device"].sudo().create({
        "partner_id": partner.id, "endpoint": "https://push.example.org/%s/%s" % (partner.id, n),
        "keys": json.dumps({"p256dh": "x", "auth": "y"})})


@tagged("post_install", "-at_install", "liputa")
class TestClientPortal(LiputaCommon):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.client_1 = _client(cls.env, "awa@client.cd", "Awa Mbuyi")
        cls.client_2 = _client(cls.env, "ruth@client.cd", "Ruth Kanku")
        cls.client_3 = _client(cls.env, "esther@client.cd", "Esther Ilunga")

    def test_directory_ranks_by_rating_and_needs_reviews_to_climb(self):
        Review = self.env["liputa.review"]
        # A : une seule note de 5 ; B : trois notes de 5. B passe devant, A devant un atelier sans note.
        Review._liputa_rate(self.atelier_a, self.client_1, 5, "Parfait")
        for c in (self.client_1, self.client_2, self.client_3):
            Review._liputa_rate(self.atelier_b, c, 5)
        cd = self.env.ref("base.cd")
        atelier_c = self.env["res.company"]._liputa_create_workshop(
            {"atelier": "Atelier Sans Avis", "name": "Maman C", "email": "c@test.cd",
             "phone": "+243810000003", "password": "Motdepasse123"}, cd, "10.0.0.2")
        ranked = self.env["res.company"]._liputa_directory()
        order = [c for c in ranked if c in (self.atelier_a, self.atelier_b, atelier_c)]
        self.assertEqual(order, [self.atelier_b, self.atelier_a, atelier_c])
        self.assertEqual(self.atelier_b.liputa_rating_count, 3)
        self.assertAlmostEqual(self.atelier_b.liputa_rating_avg, 5.0)

    def test_directory_hides_suspended_and_unlisted_workshops(self):
        self.atelier_b.liputa_subscription_id.state = "suspended"
        self.atelier_a.atelier_listed = False
        ranked = self.env["res.company"]._liputa_directory()
        self.assertNotIn(self.atelier_b, ranked)
        self.assertNotIn(self.atelier_a, ranked)

    def test_one_review_per_client_updated_not_duplicated(self):
        Review = self.env["liputa.review"]
        Review._liputa_rate(self.atelier_a, self.client_1, 2, "Retard")
        Review._liputa_rate(self.atelier_a, self.client_1, 4, "Finalement très bien")
        reviews = Review.search([("company_id", "=", self.atelier_a.id)])
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews.rating, 4)
        with self.assertRaises(ValidationError):
            Review._liputa_rate(self.atelier_a, self.client_2, 6)

    def test_workshop_cannot_rate_itself_and_hidden_reviews_do_not_count(self):
        Review = self.env["liputa.review"]
        with self.assertRaises(ValidationError):
            Review._liputa_rate(self.atelier_a, self.user_a, 5)
        review = Review._liputa_rate(self.atelier_a, self.client_1, 1, "insulte")
        self.assertEqual(self.atelier_a.liputa_rating_count, 1)
        review.is_published = False
        self.assertEqual(self.atelier_a.liputa_rating_count, 0)

    def test_review_is_verified_only_for_a_followed_order(self):
        order = self._order(self.user_a)
        Review = self.env["liputa.review"]
        self.assertFalse(Review._liputa_rate(self.atelier_a, self.client_1, 5).verified)
        order.client_partner_ids = [(4, self.client_1.partner_id.id)]
        self.assertTrue(Review._liputa_rate(self.atelier_a, self.client_1, 5).verified)

    def test_whatsapp_link(self):
        self.assertEqual(whatsapp_digits("+243 81 000 0001"), "243810000001")
        self.assertEqual(whatsapp_digits("00243-810000001"), "243810000001")
        self.assertEqual(whatsapp_digits("12"), "")
        self.atelier_a.atelier_whatsapp = "+243 81 234 5678"
        url = self.atelier_a._liputa_whatsapp_url()
        self.assertTrue(url.startswith("https://wa.me/243812345678?text="))

    def test_client_account_is_invisible_to_workshops(self):
        names = self.as_user(self.user_a, "res.partner").search([]).mapped("name")
        self.assertNotIn("Awa Mbuyi", names)

    def test_stage_change_pushes_to_followers_and_late_order_to_managers(self):
        order = self._order(self.user_a)
        order.client_partner_ids = [(4, self.client_1.partner_id.id)]
        _device(self.env, self.client_1.partner_id)
        _device(self.env, self.user_a.partner_id)
        Push = self.env["liputa.push.message"].sudo()
        order.sudo().action_confirm()
        to_client = Push.search([("device_id.partner_id", "=", self.client_1.partner_id.id)])
        self.assertTrue(to_client, "the client following the order is notified")
        payload = json.loads(to_client[-1].payload)
        self.assertEqual(payload["options"]["data"]["url"], "/c/commande/%s" % order.id)
        self.assertNotIn(self.client_2.partner_id, Push.search([]).device_id.partner_id)
        Push.search([]).unlink()
        order.sudo()._liputa_alert_managers("late")
        self.assertTrue(Push.search([("device_id.partner_id", "=", self.user_a.partner_id.id)]))

    def test_new_review_pushes_to_the_workshop_and_signup_to_admins(self):
        _device(self.env, self.user_a.partner_id)
        Push = self.env["liputa.push.message"].sudo()
        self.env["liputa.review"]._liputa_rate(self.atelier_a, self.client_1, 5, "Merci")
        msg = Push.search([("device_id.partner_id", "=", self.user_a.partner_id.id)])
        self.assertIn("★★★★★", json.loads(msg.payload)["title"])
        admin = self.env.ref("base.user_admin")
        admin.groups_id = [(4, self.env.ref("liputa_couture.group_liputa_saas_admin").id)]
        _device(self.env, admin.partner_id)
        self.env["res.company"]._liputa_create_workshop(
            {"atelier": "Atelier Nouveau", "name": "Jean", "email": "jean@test.cd",
             "phone": "+243810000004", "password": "Motdepasse123"}, self.env.ref("base.cd"), "10.0.0.3")
        self.assertTrue(Push.search([("device_id.partner_id", "=", admin.partner_id.id)]))

    def test_sender_drops_gone_devices_and_uses_a_long_ttl(self):
        device = _device(self.env, self.client_1.partner_id)
        Push = self.env["liputa.push.message"].sudo()
        Push._liputa_send(self.client_1.partner_id, "Test", "Corps")
        calls = []

        class Resp:
            status_code = 410

        def fake_post(session, url, data=None, timeout=None, headers=None):
            calls.append(headers)
            return Resp()

        with patch("odoo.addons.liputa_couture.models.push._encrypt_payload", return_value=b"x"), \
                patch("odoo.addons.liputa_couture.models.push.jwt.sign", return_value="jwt"), \
                patch("requests.Session.post", fake_post):
            Push._cron_send()
        self.assertEqual(int(calls[0]["TTL"]), 3 * 24 * 3600)
        self.assertFalse(device.exists(), "a device the push service no longer knows is removed")
        self.assertFalse(Push.search([]))


@tagged("post_install", "-at_install", "liputa")
class TestClientPortalHttp(HttpCase):

    def _csrf(self, html):
        return html.split('name="csrf_token" value="')[1].split('"')[0]

    def test_public_directory_signup_follow_and_rate(self):
        Company = self.env["res.company"]
        atelier = Company._liputa_create_workshop(
            {"atelier": "Atelier Wax Royal", "name": "Maman Wax", "email": "wax@test.cd",
             "phone": "+243810000011", "password": "Motdepasse123"}, self.env.ref("base.cd"), "10.0.0.9")
        atelier.atelier_whatsapp = "+243810000011"
        page = self.url_open("/c")
        self.assertEqual(page.status_code, 200)
        self.assertIn("Atelier Wax Royal", page.text)
        self.assertIn("https://wa.me/243810000011", page.text)
        self.assertIn("/c/manifest.webmanifest", page.text)
        self.assertEqual(self.url_open("/c/manifest.webmanifest").json()["scope"], "/c")
        self.assertIn("push", self.url_open("/c/sw.js").text)

        # Une commande de l'atelier et son lien de suivi (jeton).
        manager = self.env["res.users"].search([("login", "=", "wax@test.cd")])
        partner = self.env["res.partner"].create({"name": "Cliente Wax", "company_id": atelier.id})
        order = self.env["liputa.order"].with_user(manager).with_company(atelier).create({
            "partner_id": partner.id, "garment_model_id": self.env.ref("liputa_couture.lib_kaba_ngondo").id,
            "gender": "women", "bust": 96, "waist": 78, "hip": 104, "height": 165})
        order._portal_ensure_token()
        tracking = self.url_open("/my/couture/%s?access_token=%s" % (order.id, order.access_token))
        self.assertIn("Suivre dans mon application", tracking.text)

        # Inscription client, puis suivi de la commande avec le jeton.
        signup = self.url_open("/c/inscription")
        resp = self.url_open("/c/inscription", data={
            "csrf_token": self._csrf(signup.text), "name": "Grâce Client", "email": "grace@client.cd",
            "phone": "+243810000099", "password": "Motdepasse123", "redirect": "/c"}, allow_redirects=False)
        self.assertIn(resp.status_code, (302, 303))
        user = self.env["res.users"].search([("login", "=", "grace@client.cd")])
        self.assertTrue(user.share)
        tracking = self.url_open("/my/couture/%s?access_token=%s" % (order.id, order.access_token))
        bad = self.url_open("/c/commande/%s/suivre" % order.id, data={
            "csrf_token": self._csrf(tracking.text), "access_token": "faux"}, allow_redirects=False)
        self.assertEqual(bad.status_code, 404)
        ok = self.url_open("/c/commande/%s/suivre" % order.id, data={
            "csrf_token": self._csrf(tracking.text), "access_token": order.access_token}, allow_redirects=False)
        self.assertIn(ok.status_code, (302, 303))
        self.assertIn(user.partner_id, order.client_partner_ids)
        mine = self.url_open("/c/commandes")
        self.assertIn("Atelier Wax Royal", mine.text)
        self.assertEqual(self.url_open("/c/commande/%s" % order.id).status_code, 200)

        # Note de l'atelier, vérifiée car la cliente suit une commande.
        page = self.url_open("/c/atelier/%s" % atelier.id)
        resp = self.url_open("/c/atelier/%s/avis" % atelier.id, data={
            "csrf_token": self._csrf(page.text), "rating": "5", "comment": "Robe magnifique"},
            allow_redirects=False)
        self.assertIn(resp.status_code, (302, 303))
        review = self.env["liputa.review"].search([("company_id", "=", atelier.id)])
        self.assertEqual(review.rating, 5)
        self.assertTrue(review.verified)

        # Le client ne peut pas entrer dans l'application atelier ni voir la commande d'un autre.
        app = self.url_open("/app", allow_redirects=False)
        self.assertIn(app.headers.get("Location", ""), ("/c", self.base_url() + "/c"))
        other = self.env["liputa.order"].with_user(manager).with_company(atelier).create({
            "partner_id": partner.id, "garment_model_id": self.env.ref("liputa_couture.lib_kaba_ngondo").id,
            "gender": "women", "bust": 90, "waist": 70, "hip": 98, "height": 160})
        self.assertEqual(self.url_open("/c/commande/%s" % other.id).status_code, 404)

    def test_login_redirect_is_local_only(self):
        page = self.url_open("/c/connexion?redirect=https://evil.example/")
        self.assertNotIn("evil.example", page.text)
