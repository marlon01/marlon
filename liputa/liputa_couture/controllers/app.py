# -*- coding: utf-8 -*-
"""Liputa mobile app: shell, login, PWA files and the JSON API it uses.

Workshop users never see the Odoo web client: they are sent to /app, a
standalone OWL application. Platform administrators keep /web.
"""
import base64
import binascii
import logging
from datetime import timedelta

from odoo import _, fields, http
from odoo.exceptions import AccessDenied, UserError, ValidationError
from odoo.http import request
from odoo.tools import file_open

from odoo.addons.web.controllers.home import Home

from ..models.measurement import MEASUREMENT_FIELDS

_logger = logging.getLogger(__name__)

OPEN_CODES = ("confirmed", "cutting", "sewing", "fitting", "finishing")
MAX_IMAGE_B64 = 8 * 1024 * 1024  # ~6 MB binary


def _is_platform_admin(env, uid):
    return env["res.users"].sudo().browse(uid).has_group("liputa_couture.group_liputa_saas_admin")


def _clean_image(value):
    """Accept a base64 image (optionally a data: URL); reject anything else."""
    if not value:
        return False
    if isinstance(value, str) and value.startswith("data:image/"):
        value = value.split(",", 1)[-1]
    if not isinstance(value, str) or len(value) > MAX_IMAGE_B64:
        raise ValidationError(_("The image is too large (6 MB maximum)."))
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise ValidationError(_("This file is not a valid image."))
    if not raw.startswith((b"\xff\xd8", b"\x89PNG", b"RIFF", b"GIF8")):
        raise ValidationError(_("Use a JPEG, PNG or WebP photo."))
    return value


class LiputaHome(Home):
    """Route workshop users to the Liputa app instead of the Odoo web client."""

    def _login_redirect(self, uid, redirect=None):
        if not redirect and not _is_platform_admin(request.env, uid):
            return "/app"
        return super()._login_redirect(uid, redirect=redirect)

    @http.route()
    def web_client(self, s_action=None, **kw):
        uid = request.session.uid
        if uid and not _is_platform_admin(request.env, uid):
            return request.redirect("/app", 303)
        return super().web_client(s_action=s_action, **kw)

    @http.route()
    def web_login(self, redirect=None, **kw):
        # The branded login lives at /app/login; /web/login stays for operators (?operator=1).
        if request.httprequest.method == "GET" and not kw.get("operator") and not request.session.uid:
            return request.redirect("/app/login", 303)
        return super().web_login(redirect=redirect, **kw)


class LiputaApp(http.Controller):

    # ------------------------------------------------------------------ pages
    @http.route(["/app", "/app/<path:subpath>"], type="http", auth="public", sitemap=False)
    def app(self, subpath=None, **kw):
        if subpath in ("login", "manifest.webmanifest", "sw.js"):
            return request.not_found()
        if not request.session.uid or request.env.user._is_public():
            return request.redirect("/app/login", 303)
        return request.render("liputa_couture.app_shell", {
            "lang": (request.env.user.lang or "fr_FR").split("_")[0],
        }, headers={"Cache-Control": "no-store"})

    @http.route("/app/login", type="http", auth="public", methods=["GET", "POST"], csrf=True, sitemap=False)
    def app_login(self, **post):
        values = {"login": post.get("login", ""), "error": None}
        if request.httprequest.method == "POST":
            credential = {"login": (post.get("login") or "").strip().lower(),
                          "password": post.get("password") or "", "type": "password"}
            try:
                request.session.authenticate(request.db, credential)
                return request.redirect("/app", 303)
            except AccessDenied:
                values["error"] = _("Wrong email or password.")
        return request.render("liputa_couture.app_login", values)

    @http.route("/app/logout", type="http", auth="user", sitemap=False)
    def app_logout(self, **kw):
        request.session.logout(keep_db=True)
        return request.redirect("/app/login", 303)

    @http.route("/app/manifest.webmanifest", type="http", auth="public", sitemap=False)
    def manifest(self, **kw):
        data = {
            "name": "Liputa", "short_name": "Liputa", "start_url": "/app", "scope": "/app",
            "display": "standalone", "background_color": "#F5F6FA", "theme_color": "#16213E",
            "lang": "fr", "orientation": "portrait",
            "icons": [
                {"src": "/liputa_couture/static/description/icon.png", "sizes": "256x256", "type": "image/png"},
                {"src": "/liputa_couture/static/src/app/img/icon-512.png", "sizes": "512x512",
                 "type": "image/png", "purpose": "any maskable"},
            ],
        }
        return request.make_json_response(data, headers=[("Content-Type", "application/manifest+json")])

    @http.route("/app/sw.js", type="http", auth="public", sitemap=False)
    def service_worker(self, **kw):
        with file_open("liputa_couture/static/src/pwa/sw.js") as fh:
            body = fh.read()
        return request.make_response(body, headers=[
            ("Content-Type", "text/javascript"), ("Service-Worker-Allowed", "/app"), ("Cache-Control", "no-cache")])

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _m2o(rec):
        return {"id": rec.id, "name": rec.display_name} if rec else None

    def _order_row(self, o):
        return {
            "id": o.id, "ref": o.name, "client": o.partner_id.name, "model": o.garment_model_id.name,
            "model_id": o.garment_model_id.id, "event": o.event_type_id.name or "",
            "promised": fields.Date.to_string(o.delivery_date_promised), "progress": o.progress,
            "health": o.schedule_health, "stage": o.stage_id.name, "stage_code": o.stage_code,
            "tailor": o.tailor_id.name or "", "urgent": o.is_urgent, "priority": o.priority,
            "total": o.amount_total,
        }

    # ------------------------------------------------------------------ API
    @http.route("/liputa/api/me", type="json", auth="user")
    def me(self):
        user, company = request.env.user, request.env.company
        sub = company.sudo().liputa_subscription_id
        return {
            "name": user.name, "first_name": (user.name or "").split(" ")[0], "atelier": company.name,
            "lang": (user.lang or "fr_FR").split("_")[0],
            "is_manager": user.has_group("liputa_couture.group_liputa_manager"),
            "currency": {"symbol": company.currency_id.symbol, "position": company.currency_id.position,
                         "digits": company.currency_id.decimal_places},
            "subscription": {"state": sub.state if sub else False, "days_left": sub.days_left if sub else 0,
                             "plan": sub.plan_id.name if sub else "",
                             "price": sub.plan_id.price if sub else 0,
                             "ai_left": max(sub.plan_id.ai_credits_month - sub.ai_credits_used, 0) if sub else 0},
        }

    @http.route("/liputa/api/dashboard", type="json", auth="user")
    def dashboard(self):
        data = request.env["liputa.order"].get_dashboard_data()
        today = fields.Date.context_today(request.env.user)
        tailor = request.env["liputa.tailor"].search([("user_id", "=", request.env.uid)], limit=1)
        tasks = request.env["liputa.order.task"].search([
            ("state", "!=", "done"), ("date_start", "<=", today),
            ("tailor_id", "=", tailor.id) if tailor else ("id", "!=", 0)], limit=8)
        data["my_tasks"] = [{"id": t.id, "step": dict(t._fields["step"].selection)[t.step], "order_id": t.order_id.id,
                             "ref": t.order_id.name, "client": t.partner_id.name, "hours": t.planned_hours,
                             "state": t.state} for t in tasks]
        return data

    @http.route("/liputa/api/orders", type="json", auth="user")
    def orders(self, filter="open", search="", offset=0, limit=40):
        dom = [("company_id", "=", request.env.company.id)]
        if filter == "open":
            dom.append(("stage_code", "in", OPEN_CODES + ("draft",)))
        elif filter == "late":
            dom += [("stage_code", "in", OPEN_CODES), ("schedule_health", "in", ("late", "at_risk"))]
        elif filter == "ready":
            dom.append(("stage_code", "=", "ready"))
        if search:
            search = str(search)[:80]
            dom += ["|", "|", ("name", "ilike", search), ("partner_id.name", "ilike", search),
                    ("garment_model_id.name", "ilike", search)]
        Order = request.env["liputa.order"]
        recs = Order.search(dom, offset=int(offset), limit=min(int(limit), 100),
                            order="delivery_date_promised asc, id desc")
        counts = {k: Order.search_count([("company_id", "=", request.env.company.id)] + d) for k, d in {
            "open": [("stage_code", "in", OPEN_CODES + ("draft",))],
            "late": [("stage_code", "in", OPEN_CODES), ("schedule_health", "in", ("late", "at_risk"))],
            "ready": [("stage_code", "=", "ready")],
        }.items()}
        return {"orders": [self._order_row(o) for o in recs], "counts": counts}

    @http.route("/liputa/api/order", type="json", auth="user")
    def order(self, order_id):
        o = request.env["liputa.order"].browse(int(order_id)).exists()
        if not o:
            raise UserError(_("This order no longer exists."))
        o.check_access("read")
        stages = request.env["liputa.order.stage"].search([("code", "!=", "cancelled")])
        row = self._order_row(o)
        row.update({
            "phone": o.partner_id.mobile or o.partner_id.phone or "",
            "client_id": o.partner_id.id, "event_date": fields.Date.to_string(o.event_date),
            "estimated": fields.Date.to_string(o.delivery_date_estimated),
            "confidence": o.estimation_confidence, "estimation_note": o.estimation_note or "",
            "stages": [{"id": s.id, "name": s.name, "code": s.code} for s in stages],
            "measurements": {f: o[f] for f in MEASUREMENT_FIELDS},
            "gender": o.gender, "skin_tone": o.skin_tone,
            "has_photo": bool(o.client_photo), "photo_consent": o.photo_consent,
            "has_fabric": bool(o.fabric_image), "fabric_description": o.fabric_description or "",
            "fabric_supplied_by": o.fabric_supplied_by, "fabric_metres": o.fabric_metres,
            "fabric_yards": o.fabric_yards, "has_ai_render": bool(o.ai_render_image),
            "amounts": {"making": o.amount_making, "fabric": o.amount_fabric, "options": o.amount_options,
                        "urgency": o.amount_urgency, "total": o.amount_total, "deposit": o.deposit_amount,
                        "residual": o.amount_residual if o.invoice_id else o.amount_total,
                        "invoiced": bool(o.invoice_id), "payment_state": o.payment_state or ""},
            "options": [{"name": x.name, "price": x.price} for x in o.option_ids],
            "tasks": [{"id": t.id, "step": t.step, "label": dict(t._fields["step"].selection)[t.step],
                       "tailor": t.tailor_id.name or "", "hours": t.planned_hours,
                       "start": fields.Date.to_string(t.date_start), "end": fields.Date.to_string(t.date_end),
                       "state": t.state} for t in o.task_ids.sorted("sequence")],
            "tracking_url": o._liputa_tracking_url() if o.stage_code not in (False, "draft") else "",
            "write_date": fields.Datetime.to_string(o.write_date),
        })
        return row

    @http.route("/liputa/api/order/action", type="json", auth="user")
    def order_action(self, order_id, action, task_id=None):
        o = request.env["liputa.order"].browse(int(order_id)).exists()
        o.check_access("write")
        if action == "confirm":
            o.action_confirm()
        elif action == "ready":
            o.action_mark_ready()
        elif action == "deliver":
            o.action_deliver()
        elif action == "estimate":
            o.action_estimate_delivery()
        elif action == "invoice":
            o.action_create_invoice()
        elif action in ("task_start", "task_done") and task_id:
            task = o.task_ids.filtered(lambda t: t.id == int(task_id))
            task.action_start() if action == "task_start" else task.action_done()
        else:
            raise UserError(_("Unknown action."))
        return self.order(o.id)

    @http.route("/liputa/api/order/create", type="json", auth="user")
    def order_create(self, vals):
        allowed = set(MEASUREMENT_FIELDS) | {"garment_model_id", "event_type_id", "event_date", "gender",
                                             "is_urgent", "fabric_supplied_by", "fabric_description",
                                             "photo_consent", "garment_color", "skin_tone"}
        data = {k: v for k, v in (vals or {}).items() if k in allowed}
        for f in MEASUREMENT_FIELDS:
            if f in data:
                data[f] = max(0.0, min(float(data[f] or 0), 300.0))
        partner_id = vals.get("partner_id")
        if not partner_id:
            name = (vals.get("client_name") or "").strip()[:120]
            if not name:
                raise ValidationError(_("Enter the client's name."))
            partner_id = request.env["res.partner"].create({
                "name": name, "mobile": (vals.get("client_phone") or "")[:40]}).id
        data["partner_id"] = int(partner_id)
        if vals.get("client_photo"):
            data["client_photo"] = _clean_image(vals["client_photo"])
        if vals.get("fabric_image"):
            data["fabric_image"] = _clean_image(vals["fabric_image"])
        order = request.env["liputa.order"].create(data)
        if vals.get("save_profile"):
            request.env["liputa.measurement.profile"].create(dict(
                {f: data.get(f, 0.0) for f in MEASUREMENT_FIELDS},
                partner_id=order.partner_id.id, gender=order.gender,
                photo=data.get("client_photo") or False, photo_consent=bool(data.get("photo_consent"))))
        if vals.get("confirm"):
            order.action_confirm()
        return {"id": order.id}

    @http.route("/liputa/api/order/estimate_preview", type="json", auth="user")
    def estimate_preview(self, garment_model_id, is_urgent=False):
        """Delivery estimate before the order exists (wizard)."""
        Order = request.env["liputa.order"]
        draft = Order.new({"garment_model_id": int(garment_model_id), "is_urgent": bool(is_urgent),
                           "company_id": request.env.company.id})
        est = request.env["liputa.delivery.estimator"].estimate(draft)
        return {"date": fields.Date.to_string(est["date"]), "confidence": est["confidence"],
                "hours": draft.workload_hours}

    @http.route("/liputa/api/clients", type="json", auth="user")
    def clients(self, search=""):
        Partner = request.env["res.partner"]
        dom = [("liputa_order_ids", "!=", False)]
        if search:
            dom = ["|", ("name", "ilike", str(search)[:80]), ("mobile", "ilike", str(search)[:40])]
        out = []
        for p in Partner.search(dom, limit=20):
            prof = request.env["liputa.measurement.profile"].search([("partner_id", "=", p.id)], limit=1)
            out.append({"id": p.id, "name": p.name, "phone": p.mobile or p.phone or "",
                        "orders": p.liputa_order_count,
                        "measurements": {f: prof[f] for f in MEASUREMENT_FIELDS} if prof else None,
                        "gender": prof.gender if prof else "women",
                        "profile_date": fields.Date.to_string(prof.date) if prof else None})
        return out

    @http.route("/liputa/api/catalogue", type="json", auth="user")
    def catalogue(self, gender=None, event_type_id=None, scope="all", search=""):
        dom = [("active", "=", True)]
        if gender:
            dom.append(("gender", "in", (gender, "unisex")))
        if event_type_id:
            dom.append(("event_type_ids", "in", [int(event_type_id)]))
        if scope == "mine":
            dom.append(("company_id", "!=", False))
        elif scope == "library":
            dom.append(("company_id", "=", False))
        if search:
            dom.append(("name", "ilike", str(search)[:80]))
        models_ = request.env["liputa.garment.model"].search(dom, limit=80)
        events = request.env["liputa.event.type"].search([])
        return {
            "models": [{"id": m.id, "name": m.name, "category": m.category_id.name, "gender": m.gender,
                        "events": m.event_type_ids.mapped("name")[:3], "is_library": not m.company_id,
                        "featured": m.is_featured, "uses": m.usage_count, "hours": m.base_hours,
                        "has_image": bool(m.image_128)} for m in models_],
            "events": [{"id": e.id, "name": e.name} for e in events],
        }

    @http.route("/liputa/api/suggest", type="json", auth="user")
    def suggest(self, event_type_id=None, gender=None, budget=0, notes=""):
        return request.env["liputa.ai.service"].suggest_models(
            event_type_id=int(event_type_id) if event_type_id else None, gender=gender,
            budget=float(budget or 0), notes=str(notes or "")[:600])

    @http.route("/liputa/api/pattern", type="json", auth="user")
    def pattern(self, order_id):
        return request.env["liputa.order"].browse(int(order_id)).get_pattern_data()

    @http.route("/liputa/api/mannequin", type="json", auth="user")
    def mannequin(self, order_id):
        return request.env["liputa.order"].browse(int(order_id)).get_mannequin_data()

    @http.route("/liputa/api/render", type="json", auth="user")
    def render(self, order_id):
        request.env["liputa.order"].browse(int(order_id)).action_ai_render()
        return True

    @http.route("/liputa/api/planning", type="json", auth="user")
    def planning(self, date_from=None, days=6):
        start = fields.Date.to_date(date_from) if date_from else fields.Date.context_today(request.env.user)
        end = start + timedelta(days=int(days))
        tasks = request.env["liputa.order.task"].search([
            ("company_id", "=", request.env.company.id), ("date_start", "<=", end),
            ("date_end", ">=", start)], order="date_start, sequence")
        tailors = request.env["liputa.tailor"].search([("company_id", "=", request.env.company.id)])
        return {
            "tailors": [{"id": t.id, "name": t.name, "color": t.color, "daily_hours": t.daily_hours}
                        for t in tailors],
            "tasks": [{"id": t.id, "order_id": t.order_id.id, "ref": t.order_id.name, "client": t.partner_id.name,
                       "model": t.order_id.garment_model_id.name, "step": t.step,
                       "label": dict(t._fields["step"].selection)[t.step], "tailor_id": t.tailor_id.id,
                       "hours": t.planned_hours, "start": fields.Date.to_string(t.date_start),
                       "end": fields.Date.to_string(t.date_end), "state": t.state} for t in tasks],
        }

    @http.route("/liputa/api/subscription/pay", type="json", auth="user")
    def subscription_pay(self, method, phone):
        """Create a pending Mobile Money payment and send the request to the operator.

        The subscription is only extended when the aggregator confirms the
        payment through the signed webhook (/liputa/payment/webhook/<provider>).
        """
        if not request.env.user.has_group("liputa_couture.group_liputa_manager"):
            raise UserError(_("Only the head of the workshop can pay the subscription."))
        methods = dict(request.env["liputa.subscription.payment"]._fields["method"].selection)
        if method not in methods:
            raise ValidationError(_("Choose a payment operator."))
        digits = "".join(c for c in str(phone or "") if c.isdigit() or c == "+")
        if len(digits.replace("+", "")) < 9:
            raise ValidationError(_("Enter a valid phone number."))
        sub = request.env.company.sudo().liputa_subscription_id
        if not sub:
            raise UserError(_("No subscription found for this workshop."))
        payment = request.env["liputa.subscription.payment"].sudo().create({
            "subscription_id": sub.id, "amount": sub.plan_id.price, "method": method, "phone": digits[:20]})
        payment._liputa_initiate()
        return {"reference": payment.reference, "amount": payment.amount}

    @http.route("/liputa/api/lang", type="json", auth="user")
    def set_lang(self, lang):
        code = request.env["res.lang"].sudo().search(
            [("active", "=", True), ("code", "=like", "%s%%" % str(lang)[:2])], limit=1).code
        if not code:
            raise UserError(_("This language is not available yet."))
        request.env.user.sudo().lang = code
        return True

    @http.route("/liputa/api/events", type="json", auth="user")
    def events(self):
        return [{"id": e.id, "name": e.name, "lead": e.typical_lead_days}
                for e in request.env["liputa.event.type"].search([])]
