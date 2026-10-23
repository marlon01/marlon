# -*- coding: utf-8 -*-
import hashlib
import hmac
import json
import logging
import re
from datetime import timedelta

from odoo import _, fields, http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.portal.controllers.portal import CustomerPortal

_logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")
SIGNUPS_PER_IP_HOUR = 3


class LiputaPortal(CustomerPortal):
    """Client side: list of orders (logged-in clients) and token-based tracking."""

    def _prepare_home_portal_values(self, counters):
        values = super()._prepare_home_portal_values(counters)
        if "liputa_order_count" in counters:
            values["liputa_order_count"] = request.env["liputa.order"].sudo().search_count(
                request.env.user.partner_id._liputa_order_domain())
        return values

    @http.route(["/my/couture"], type="http", auth="user", website=False)
    def portal_my_couture(self, **kw):
        orders = request.env["liputa.order"].sudo().search(
            request.env.user.partner_id._liputa_order_domain(), order="id desc", limit=50)
        return request.render("liputa_couture.portal_my_couture", {"orders": orders, "page_name": "couture"})

    @http.route(["/my/couture/<int:order_id>"], type="http", auth="public", website=False)
    def portal_couture_order(self, order_id, access_token=None, **kw):
        try:
            order = self._document_check_access("liputa.order", order_id, access_token=access_token)
        except (AccessError, MissingError):
            return request.not_found()
        stages = request.env["liputa.order.stage"].sudo().search(
            [("client_visible", "=", True), ("code", "!=", "cancelled")])
        return request.render("liputa_couture.portal_couture_order", {
            "order": order, "stages": stages, "page_name": "couture",
            "token": access_token,
        })


class LiputaController(http.Controller):

    # ------------------------------------------------------------ pattern file
    @http.route("/liputa/order/<int:order_id>/pattern.svg", type="http", auth="user")
    def pattern_svg(self, order_id, **kw):
        order = request.env["liputa.order"].browse(order_id)
        order.check_access("read")  # ACL + multi-company record rules
        svg = order._liputa_draft()["svg"]
        filename = "%s-patron.svg" % re.sub(r"[^\w-]", "_", order.name)
        return request.make_response(svg, headers=[
            ("Content-Type", "image/svg+xml; charset=utf-8"),
            ("Content-Disposition", 'attachment; filename="%s"' % filename),
            ("X-Content-Type-Options", "nosniff"),
            ("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'"),
        ])

    # ------------------------------------------------------------ workshop signup
    @http.route("/liputa/signup", type="http", auth="public", methods=["GET"], website=False)
    def signup_form(self, **kw):
        countries = request.env["res.country"].sudo().search([])
        return request.render("liputa_couture.signup_page", {"countries": countries, "values": {}, "error": None})

    @http.route("/liputa/signup", type="http", auth="public", methods=["POST"], website=False, csrf=True)
    def signup_submit(self, **post):
        env = request.env
        ip = request.httprequest.remote_addr or "?"
        values = {k: (post.get(k) or "").strip() for k in
                  ("atelier", "name", "email", "phone", "country_id", "password")}
        error = None
        if not all(values[k] for k in ("atelier", "name", "email", "password")):
            error = _("Please fill in all required fields.")
        elif not EMAIL_RE.match(values["email"]):
            error = _("Invalid email address.")
        elif len(values["password"]) < 10:
            error = _("The password must contain at least 10 characters.")
        elif env["res.users"].sudo().search_count([("login", "=", values["email"].lower())]):
            error = _("An account already exists with this email.")
        else:
            since = fields.Datetime.now() - timedelta(hours=1)
            recent = env["liputa.subscription"].sudo().search_count(
                [("signup_ip", "=", ip), ("create_date", ">=", since)])
            if recent >= SIGNUPS_PER_IP_HOUR:
                error = _("Too many sign-ups from this network. Please try again later.")
        if error:
            countries = env["res.country"].sudo().search([])
            values.pop("password", None)
            return request.render("liputa_couture.signup_page",
                                  {"countries": countries, "values": values, "error": error})

        country = env["res.country"].sudo().browse(int(values["country_id"] or 0)).exists()
        env["res.company"].sudo()._liputa_create_workshop(values, country, ip, lang=request.env.lang)
        return request.redirect("/app/login", 303)

    # ------------------------------------------------------------ FlexPay callback
    @http.route("/liputa/payment/flexpay/callback", type="http", auth="public", methods=["POST"], csrf=False)
    def flexpay_callback(self, **kw):
        """Rappel FlexPay. Son contenu ne sert qu'à retrouver le paiement : le statut est
        ensuite demandé à FlexPay lui-même (un rappel falsifié ne peut rien valider)."""
        try:
            data = json.loads(request.httprequest.get_data() or b"{}")
        except ValueError:
            data = dict(kw)
        reference = str(data.get("reference") or "")[:64]
        Payment = request.env["liputa.subscription.payment"].sudo()
        payment = Payment.search([("reference", "=", reference), ("provider", "=", "flexpay")], limit=1) \
            if reference else Payment.browse()
        if payment:
            payment._liputa_check_flexpay()
        return request.make_json_response({"ok": True})

    # ------------------------------------------------------------ CinetPay
    @http.route("/liputa/payment/cinetpay/notify", type="http", auth="public", methods=["POST"], csrf=False)
    def cinetpay_notify(self, **kw):
        """Notification CinetPay : identifie la transaction, le statut est demandé à CinetPay."""
        reference = str(kw.get("cpm_trans_id") or kw.get("transaction_id") or "")[:64]
        Payment = request.env["liputa.subscription.payment"].sudo()
        payment = Payment.search([("reference", "=", reference), ("provider", "=", "cinetpay")], limit=1) \
            if reference else Payment.browse()
        if payment:
            payment._liputa_check_cinetpay()
        return request.make_response("OK", [("Content-Type", "text/plain")])

    @http.route("/liputa/payment/cinetpay/return", type="http", auth="public", methods=["GET", "POST"],
                csrf=False, sitemap=False)
    def cinetpay_return(self, ref="", **kw):
        """Retour du client depuis la page CinetPay : vérification auprès de CinetPay, puis retour à l'application."""
        Payment = request.env["liputa.subscription.payment"].sudo()
        payment = Payment.search([("reference", "=", str(ref)[:64]), ("provider", "=", "cinetpay")], limit=1) \
            if ref else Payment.browse()
        if payment:
            payment._liputa_check_cinetpay()
        state = payment.state if payment else "none"
        return request.redirect("/app#/account?payment=%s&ref=%s" % (state, payment.reference if payment else ""), 303)

    # ------------------------------------------------------------ payment webhook
    @http.route("/liputa/payment/webhook/<string:provider>", type="http", auth="public",
                methods=["POST"], csrf=False)
    def payment_webhook(self, provider, **kw):
        """Generic signed webhook for Mobile Money aggregators.

        Expects JSON {"reference": str, "status": "success|failed|cancelled",
        "provider_reference": str} and header X-Liputa-Signature = hex HMAC-SHA256
        of the raw body with the per-provider secret.
        """
        raw = request.httprequest.get_data() or b""
        secret = request.env["ir.config_parameter"].sudo().get_param(
            "liputa.payment.secret.%s" % re.sub(r"\W", "", provider))
        signature = request.httprequest.headers.get("X-Liputa-Signature", "")
        expected = hmac.new((secret or "").encode(), raw, hashlib.sha256).hexdigest() if secret else ""
        if not secret or not hmac.compare_digest(expected, signature):
            _logger.warning("Liputa webhook: bad signature from %s", request.httprequest.remote_addr)
            return request.make_json_response({"ok": False}, status=403)
        try:
            payload = json.loads(raw)
        except ValueError:
            return request.make_json_response({"ok": False}, status=400)
        payment = request.env["liputa.subscription.payment"].sudo().search(
            [("reference", "=", str(payload.get("reference", ""))[:64])], limit=1)
        if not payment:
            return request.make_json_response({"ok": False}, status=404)
        payment._liputa_webhook_update(str(payload.get("status", "")),
                                       str(payload.get("provider_reference", ""))[:128] or None)
        return request.make_json_response({"ok": True})
