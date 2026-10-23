# -*- coding: utf-8 -*-
"""Client portal (/c): public directory of workshops ranked by rating, WhatsApp
contact, client accounts, followed orders, installable app and push notifications."""
import logging
import re
from datetime import timedelta
from urllib.parse import quote, urlsplit

from odoo import _, fields, http
from odoo.exceptions import AccessDenied, ValidationError
from odoo.http import request
from odoo.tools import consteq, file_open

from ..models.push import is_push_endpoint
from .main import EMAIL_RE

_logger = logging.getLogger(__name__)

CLIENT_SIGNUPS_PER_IP_HOUR = 5


def _safe_redirect(target, default="/c"):
    """Only local paths: never redirect a client to another site after login."""
    target = target or ""
    parts = urlsplit(target)
    if parts.scheme or parts.netloc or not target.startswith("/") or target.startswith("//"):
        return default
    return target


def _stars(value):
    full = int(round(value or 0))
    return "★" * full + "☆" * (5 - full)


class LiputaClientPortal(http.Controller):

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _client_user():
        user = request.env.user
        return None if user._is_public() else user

    def _render(self, template, values=None, **kw):
        values = dict(values or {})
        values.setdefault("client_user", self._client_user())
        values.update(client_nav=True, stars=_stars, manifest_url="/c/manifest.webmanifest")
        return request.render(template, values, **kw)

    def _my_orders(self, user, company=None):
        dom = user.partner_id._liputa_order_domain()
        if company:
            dom = [("company_id", "=", company.id)] + dom
        return request.env["liputa.order"].sudo().search(dom, order="id desc", limit=100)

    def _listed_workshop(self, company_id):
        Company = request.env["res.company"].sudo()
        return Company.search([("id", "=", int(company_id))] + Company._liputa_directory_domain(), limit=1)

    def _login_url(self, redirect):
        return "/c/connexion?redirect=%s" % quote(redirect)

    # ------------------------------------------------------------------ directory
    @http.route("/c", type="http", auth="public", sitemap=True)
    def directory(self, q="", **kw):
        workshops = request.env["res.company"]._liputa_directory(search=q)
        return self._render("liputa_couture.client_directory", {"workshops": workshops, "q": q[:60],
                                                                 "title": "Liputa - Ateliers de couture"})

    @http.route("/c/atelier/<int:company_id>", type="http", auth="public", sitemap=False)
    def workshop(self, company_id, **kw):
        company = self._listed_workshop(company_id)
        if not company:
            return request.not_found()
        user = self._client_user()
        reviews = company.liputa_review_ids.filtered("is_published")[:20]
        my_review = user and company.liputa_review_ids.filtered(lambda r: r.user_id == user)[:1]
        return self._render("liputa_couture.client_workshop", {
            "company": company, "reviews": reviews, "my_review": my_review,
            "orders": self._my_orders(user, company) if user else [],
            "can_rate": bool(user) and not (not user.share and company in user.company_ids),
            "whatsapp_url": company._liputa_whatsapp_url(),
            "title": "%s - Liputa" % company.name, "error": kw.get("error"), "saved": kw.get("saved"),
        })

    @http.route("/c/atelier/<int:company_id>/logo", type="http", auth="public", sitemap=False)
    def workshop_logo(self, company_id, **kw):
        company = self._listed_workshop(company_id)
        if company and company.logo:
            return request.env["ir.binary"]._get_image_stream_from(
                company, "logo", width=256, height=256, crop=True).get_response(max_age=3600)
        return request.redirect("/liputa_couture/static/src/app/img/icon-512.png", 303)

    @http.route("/c/atelier/<int:company_id>/avis", type="http", auth="public", methods=["POST"], csrf=True)
    def workshop_review(self, company_id, rating=0, comment="", **kw):
        back = "/c/atelier/%s" % int(company_id)
        user = self._client_user()
        if not user:
            return request.redirect(self._login_url(back), 303)
        company = self._listed_workshop(company_id)
        if not company:
            return request.not_found()
        try:
            rating = int(rating or 0)
        except ValueError:
            rating = 0
        if not 1 <= rating <= 5:
            return request.redirect(back + "?error=rating#avis", 303)
        try:
            request.env["liputa.review"]._liputa_rate(company, user, rating, comment)
        except ValidationError:
            return request.redirect(back + "?error=staff#avis", 303)
        return request.redirect(back + "?saved=1#avis", 303)

    # ------------------------------------------------------------------ my orders
    @http.route("/c/commandes", type="http", auth="public", sitemap=False)
    def my_orders(self, **kw):
        user = self._client_user()
        if not user:
            return request.redirect(self._login_url("/c/commandes"), 303)
        orders = self._my_orders(user)
        groups = []
        for company in orders.company_id:
            groups.append({"company": company, "orders": orders.filtered(lambda o: o.company_id == company),
                           "whatsapp_url": company._liputa_whatsapp_url()})
        return self._render("liputa_couture.client_orders", {"groups": groups, "title": "Mes commandes - Liputa"})

    @http.route("/c/commande/<int:order_id>", type="http", auth="public", sitemap=False)
    def my_order(self, order_id, **kw):
        user = self._client_user()
        if not user:
            return request.redirect(self._login_url("/c/commande/%s" % order_id), 303)
        order = request.env["liputa.order"].sudo().search(
            [("id", "=", int(order_id))] + user.partner_id._liputa_order_domain(), limit=1)
        if not order:
            return request.not_found()
        stages = request.env["liputa.order.stage"].sudo().search(
            [("client_visible", "=", True), ("code", "!=", "cancelled")])
        return self._render("liputa_couture.portal_couture_order", {
            "order": order, "stages": stages, "page_name": "couture", "token": None, "followed": True})

    @http.route("/c/commande/<int:order_id>/suivre", type="http", auth="public", methods=["POST"], csrf=True)
    def follow_order(self, order_id, access_token="", **kw):
        """Add an order to the client's app. Proof of ownership: the tracking link's token."""
        order = request.env["liputa.order"].sudo().browse(int(order_id)).exists()
        if not order or not access_token or not order.access_token \
                or not consteq(order.access_token, str(access_token)):
            return request.not_found()
        user = self._client_user()
        if not user:
            back = "/my/couture/%s?access_token=%s" % (order.id, quote(access_token))
            return request.redirect("/c/inscription?redirect=%s" % quote(back), 303)
        order.client_partner_ids = [(4, user.partner_id.id)]
        return request.redirect("/c/commande/%s" % order.id, 303)

    # ------------------------------------------------------------------ accounts
    @http.route("/c/connexion", type="http", auth="public", methods=["GET", "POST"], csrf=True, sitemap=False)
    def client_login(self, redirect="", **post):
        redirect = _safe_redirect(redirect)
        values = {"login": post.get("login", ""), "error": None, "redirect": redirect,
                  "title": "Connexion - Liputa"}
        if request.httprequest.method == "POST":
            credential = {"login": (post.get("login") or "").strip().lower(),
                          "password": post.get("password") or "", "type": "password"}
            try:
                request.session.authenticate(request.db, credential)
                user = request.env["res.users"].sudo().browse(request.session.uid)
                if not user.share and redirect == "/c":
                    redirect = "/app"
                return request.redirect(redirect, 303)
            except AccessDenied:
                values["error"] = _("Wrong email or password.")
        return self._render("liputa_couture.client_login", values)

    @http.route("/c/inscription", type="http", auth="public", methods=["GET", "POST"], csrf=True, sitemap=False)
    def client_signup(self, redirect="", **post):
        redirect = _safe_redirect(redirect)
        values = {k: (post.get(k) or "").strip() for k in ("name", "email", "phone")}
        values.update(redirect=redirect, error=None, title="Créer mon compte - Liputa")
        if request.httprequest.method == "GET":
            return self._render("liputa_couture.client_signup", values)
        env = request.env
        ip = request.httprequest.remote_addr or "?"
        email = values["email"].lower()
        password = post.get("password") or ""
        Users = env["res.users"].sudo()
        if not values["name"] or not email or not password:
            values["error"] = _("Please fill in all required fields.")
        elif not EMAIL_RE.match(email):
            values["error"] = _("Invalid email address.")
        elif len(password) < 10:
            values["error"] = _("The password must contain at least 10 characters.")
        elif Users.search_count([("login", "=", email)]):
            values["error"] = _("An account already exists with this email.")
        elif Users.search_count([("liputa_signup_ip", "=", ip),
                                 ("create_date", ">=", fields.Datetime.now() - timedelta(hours=1))]) \
                >= CLIENT_SIGNUPS_PER_IP_HOUR:
            values["error"] = _("Too many sign-ups from this network. Please try again later.")
        if values["error"]:
            return self._render("liputa_couture.client_signup", values)
        main = env.ref("base.main_company")
        user = Users.with_context(no_reset_password=True).create({
            "name": values["name"][:120], "login": email, "email": email, "password": password,
            "groups_id": [(6, 0, [env.ref("base.group_portal").id])],
            "company_id": main.id, "company_ids": [(6, 0, [main.id])], "liputa_signup_ip": ip,
            "lang": next((code for code in (request.env.lang, "fr_FR", "en_US")
                          if code and env["res.lang"]._lang_get(code)), "en_US"),
        })
        # Le contact du client reste à la plateforme : aucun atelier ne le voit dans ses contacts.
        user.partner_id.write({"company_id": main.id, "mobile": values["phone"][:40]})
        request.session.authenticate(request.db, {"login": email, "password": password, "type": "password"})
        return request.redirect(redirect, 303)

    @http.route("/c/deconnexion", type="http", auth="public", sitemap=False)
    def client_logout(self, **kw):
        request.session.logout(keep_db=True)
        return request.redirect("/c", 303)

    # ------------------------------------------------------------------ installable app
    @http.route("/c/manifest.webmanifest", type="http", auth="public", sitemap=False)
    def manifest(self, **kw):
        data = {
            "name": "Liputa - Ateliers de couture", "short_name": "Liputa", "id": "/c",
            "start_url": "/c", "scope": "/c", "display": "standalone",
            "background_color": "#F5F6FA", "theme_color": "#16213E", "lang": "fr", "orientation": "portrait",
            "description": "Trouvez un atelier, contactez-le sur WhatsApp et suivez vos commandes.",
            "icons": [
                {"src": "/liputa_couture/static/description/icon.png", "sizes": "256x256", "type": "image/png"},
                {"src": "/liputa_couture/static/src/app/img/icon-512.png", "sizes": "512x512",
                 "type": "image/png", "purpose": "any maskable"},
            ],
            "shortcuts": [{"name": "Mes commandes", "url": "/c/commandes"}],
        }
        return request.make_json_response(data, headers=[("Content-Type", "application/manifest+json")])

    @http.route("/c/sw.js", type="http", auth="public", sitemap=False)
    def service_worker(self, **kw):
        with file_open("liputa_couture/static/src/pwa/client_sw.js") as fh:
            body = fh.read()
        return request.make_response(body, headers=[
            ("Content-Type", "text/javascript"), ("Service-Worker-Allowed", "/c"), ("Cache-Control", "no-cache")])

    # ------------------------------------------------------------------ push notifications
    @http.route("/liputa/push/key", type="json", auth="public")
    def push_key(self):
        return {"key": request.env["mail.push.device"].sudo().get_web_push_vapid_public_key()}

    @http.route("/liputa/push/subscribe", type="json", auth="user")
    def push_subscribe(self, subscription=None, vapid_public_key=None):
        """Register this phone for push (clients, workshops and administrators alike)."""
        sub = subscription or {}
        endpoint = str(sub.get("endpoint") or "")
        keys = sub.get("keys") or {}
        if not is_push_endpoint(endpoint) or not keys.get("p256dh") or not keys.get("auth"):
            raise ValidationError(_("Invalid push subscription."))
        request.env["mail.push.device"].register_devices(
            endpoint=endpoint[:1024], keys={"p256dh": str(keys["p256dh"])[:200], "auth": str(keys["auth"])[:100]},
            expirationTime=sub.get("expirationTime"), vapid_public_key=vapid_public_key)
        return True

    @http.route("/liputa/push/unsubscribe", type="json", auth="user")
    def push_unsubscribe(self, endpoint=None):
        device = request.env["mail.push.device"].sudo().search(
            [("endpoint", "=", str(endpoint or "")), ("partner_id", "=", request.env.user.partner_id.id)])
        device.unlink()
        return True
