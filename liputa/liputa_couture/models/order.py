# -*- coding: utf-8 -*-
"""Tailoring order: client, measurements snapshot, photo, model, pricing,
delivery estimation, production planning, invoicing and notifications."""
import logging
from datetime import timedelta

from odoo import Command, _, api, fields, models
from odoo.exceptions import UserError

from ..lib.pattern import draft
from .measurement import MEASUREMENT_FIELDS
from .atelier import STEPS

_logger = logging.getLogger(__name__)

STEP_SHARES = {"cutting": 0.15, "sewing": 0.55, "fitting": 0.10, "finishing": 0.20}
COMPLEXITY_FACTOR = {"1": 0.7, "2": 1.0, "3": 1.4, "4": 2.0, "5": 3.0}
OPEN_CODES = ("confirmed", "cutting", "sewing", "fitting", "finishing")
CODE_FOR_STEP = {"cutting": "cutting", "embroidery": "sewing", "sewing": "sewing",
                 "fitting": "fitting", "finishing": "finishing"}


class LiputaOrder(models.Model):
    _name = "liputa.order"
    _description = "Tailoring order"
    _inherit = ["liputa.measurement.mixin", "mail.thread", "mail.activity.mixin", "portal.mixin"]
    _order = "priority desc, delivery_date_promised, id desc"
    _check_company_auto = True

    name = fields.Char("Reference", required=True, readonly=True, copy=False, default="/", index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    user_id = fields.Many2one("res.users", "Taken by", default=lambda s: s.env.user)

    # client ------------------------------------------------------------------
    partner_id = fields.Many2one("res.partner", "Client", required=True, tracking=True, index=True)
    client_phone = fields.Char(related="partner_id.phone", readonly=False)
    client_photo = fields.Image("Client photo", max_width=1280, max_height=1280, attachment=True)
    photo_consent = fields.Boolean("Photo consent",
                                   help="The client agreed that the photo is used for the virtual "
                                        "fitting and AI rendering. Required for AI rendering.")
    measurement_profile_id = fields.Many2one(
        "liputa.measurement.profile", "Measurement profile",
        domain="[('partner_id', '=', partner_id)]", check_company=True)
    gender = fields.Selection([("women", "Woman"), ("men", "Man"), ("child", "Child")], default="women")
    skin_tone = fields.Selection([(str(i), str(i)) for i in range(1, 7)], default="5",
                                 help="Mannequin skin tone (1 = very light ... 6 = very deep).")

    # model & event -----------------------------------------------------------
    garment_model_id = fields.Many2one("liputa.garment.model", "Model", required=True, tracking=True)
    category_id = fields.Many2one(related="garment_model_id.category_id", store=True)
    silhouette = fields.Selection(related="garment_model_id.silhouette")
    pattern_template = fields.Selection(related="garment_model_id.pattern_template")
    event_type_id = fields.Many2one("liputa.event.type", "Event", tracking=True)
    event_date = fields.Date(tracking=True)
    garment_color = fields.Char("Main colour", default="#C4502A")
    fabric_supplied_by = fields.Selection([("client", "Client"), ("atelier", "Workshop")],
                                          default="client", required=True)
    fabric_image = fields.Image("Fabric photo", max_width=800, max_height=800, attachment=True)
    fabric_description = fields.Char()
    fabric_width = fields.Float("Fabric width (cm)",
                                default=lambda s: s.env.company.atelier_default_fabric_width or 115.0)
    fabric_metres = fields.Float(compute="_compute_fabric", store=True, readonly=False)
    fabric_yards = fields.Float(compute="_compute_fabric", store=True)
    option_ids = fields.One2many("liputa.order.option", "order_id", "Extras")

    # workflow ----------------------------------------------------------------
    stage_id = fields.Many2one("liputa.order.stage", tracking=True, index=True, copy=False,
                               group_expand="_read_group_stage_ids",
                               default=lambda s: s.env.ref("liputa_couture.stage_draft", raise_if_not_found=False))
    stage_code = fields.Selection(related="stage_id.code", store=True, index=True)
    priority = fields.Selection([("0", "Normal"), ("1", "Important"), ("2", "Urgent")], default="0")
    is_urgent = fields.Boolean("Express", help="Client asks for a date earlier than the estimate.")
    tailor_id = fields.Many2one("liputa.tailor", "Lead tailor", check_company=True, tracking=True)
    task_ids = fields.One2many("liputa.order.task", "order_id", "Production tasks")
    progress = fields.Float(compute="_compute_progress", store=True, aggregator="avg")

    # dates & estimation ------------------------------------------------------
    date_order = fields.Date(default=fields.Date.context_today, required=True)
    date_confirmed = fields.Date(readonly=True, copy=False)
    workload_hours = fields.Float(compute="_compute_workload", store=True)
    delivery_date_estimated = fields.Date("Estimated delivery", readonly=True, copy=False)
    estimation_confidence = fields.Selection([("high", "High"), ("medium", "Medium"), ("low", "Low")],
                                             readonly=True, copy=False)
    estimation_note = fields.Text(readonly=True, copy=False)
    delivery_date_promised = fields.Date("Promised delivery", tracking=True, copy=False)
    delivery_date_actual = fields.Date(readonly=True, copy=False)
    schedule_health = fields.Selection([("on_track", "On track"), ("at_risk", "At risk"), ("late", "Late")],
                                       default="on_track", copy=False, index=True)

    # amounts -----------------------------------------------------------------
    amount_making = fields.Monetary("Making", compute="_compute_amounts", store=True, readonly=False)
    amount_fabric = fields.Monetary("Fabric", compute="_compute_amounts", store=True, readonly=False)
    amount_options = fields.Monetary("Extras", compute="_compute_amounts", store=True)
    amount_urgency = fields.Monetary("Express surcharge", compute="_compute_amounts", store=True)
    amount_total = fields.Monetary("Total", compute="_compute_total", store=True, tracking=True)
    deposit_amount = fields.Monetary("Deposit")
    invoice_id = fields.Many2one("account.move", readonly=True, copy=False, check_company=True)
    payment_state = fields.Selection(related="invoice_id.payment_state")
    amount_residual = fields.Monetary(related="invoice_id.amount_residual")

    # renders -----------------------------------------------------------------
    ai_render_image = fields.Image("AI render", max_width=1024, max_height=1536, attachment=True, copy=False)
    notes = fields.Html()

    # ------------------------------------------------------------------ compute
    @api.model
    def _read_group_stage_ids(self, stages, domain, order=None):
        return stages.search([])

    def _compute_access_url(self):
        super()._compute_access_url()
        for rec in self:
            rec.access_url = "/my/couture/%s" % rec.id

    @api.depends("garment_model_id", "fabric_width", "gender", *MEASUREMENT_FIELDS)
    def _compute_fabric(self):
        for rec in self:
            if not rec.garment_model_id:
                rec.fabric_metres = rec.fabric_yards = 0.0
                continue
            try:
                res = rec._liputa_draft(svg=False)
                rec.fabric_metres = res["fabric"]["metres"]
                rec.fabric_yards = res["fabric"]["yards"]
            except Exception:  # never block data entry on a drafting error
                _logger.exception("Fabric estimation failed for %s", rec.display_name)
                rec.fabric_metres = rec.fabric_yards = 0.0

    @api.depends("garment_model_id.base_hours", "garment_model_id.complexity", "option_ids.extra_hours")
    def _compute_workload(self):
        for rec in self:
            m = rec.garment_model_id
            base = (m.base_hours or 6.0) * COMPLEXITY_FACTOR.get(m.complexity or "2", 1.0)
            rec.workload_hours = base + sum(rec.option_ids.mapped("extra_hours"))

    @api.depends("task_ids.state", "task_ids.planned_hours", "stage_code")
    def _compute_progress(self):
        for rec in self:
            if rec.stage_code in ("ready", "delivered"):
                rec.progress = 100.0
                continue
            total = sum(rec.task_ids.mapped("planned_hours"))
            done = sum(rec.task_ids.filtered(lambda t: t.state == "done").mapped("planned_hours"))
            half = sum(rec.task_ids.filtered(lambda t: t.state == "in_progress").mapped("planned_hours")) / 2
            rec.progress = round(100.0 * (done + half) / total, 1) if total else 0.0

    @api.depends("garment_model_id", "event_type_id", "fabric_supplied_by", "fabric_metres",
                 "option_ids.price", "is_urgent", "company_id")
    def _compute_amounts(self):
        Rule = self.env["liputa.pricing.rule"]
        for rec in self:
            if not rec.garment_model_id:
                rec.amount_making = rec.amount_fabric = rec.amount_options = rec.amount_urgency = 0.0
                continue
            rule = Rule._find_rule(rec.company_id, rec.garment_model_id, rec.event_type_id)
            making = (rule.price * (rule.complexity_multiplier or 1.0)) if rule else 0.0
            rec.amount_making = making
            rec.amount_fabric = (rule.fabric_price_per_metre * rec.fabric_metres
                                 if rule and rec.fabric_supplied_by == "atelier" else 0.0)
            rec.amount_options = sum(rec.option_ids.mapped("price"))
            pct = rec.company_id.atelier_urgency_pct or 0.0
            rec.amount_urgency = (making + rec.amount_options) * pct / 100.0 if rec.is_urgent else 0.0

    @api.depends("amount_making", "amount_fabric", "amount_options", "amount_urgency")
    def _compute_total(self):
        for rec in self:
            rec.amount_total = rec.amount_making + rec.amount_fabric + rec.amount_options + rec.amount_urgency

    # ------------------------------------------------------------------ onchange
    @api.onchange("measurement_profile_id")
    def _onchange_measurement_profile(self):
        prof = self.measurement_profile_id
        if prof:
            self.update(prof._liputa_measurement_values())
            self.gender = prof.gender
            if prof.photo and not self.client_photo:
                self.client_photo = prof.photo
                self.photo_consent = prof.photo_consent

    @api.onchange("partner_id")
    def _onchange_partner_id(self):
        if self.partner_id:
            self.measurement_profile_id = self.env["liputa.measurement.profile"].search(
                [("partner_id", "=", self.partner_id.id)], limit=1)

    @api.onchange("garment_model_id")
    def _onchange_garment_model(self):
        if self.garment_model_id and self.garment_model_id.default_color:
            self.garment_color = self.garment_model_id.default_color

    # ------------------------------------------------------------------ CRUD
    @api.model_create_multi
    def create(self, vals_list):
        companies = self.env["res.company"].browse(
            {v.get("company_id") or self.env.company.id for v in vals_list})
        companies._liputa_ensure_active()
        for vals in vals_list:
            if vals.get("name", "/") == "/":
                vals["name"] = self.env["ir.sequence"].next_by_code("liputa.order") or "/"
        orders = super().create(vals_list)
        orders.mapped("garment_model_id").sudo().filtered(lambda m: m.exists())._liputa_bump_usage()
        return orders

    def write(self, vals):
        old_stages = {r.id: r.stage_id for r in self} if "stage_id" in vals else {}
        res = super().write(vals)
        if old_stages:
            for rec in self:
                if rec.stage_id != old_stages.get(rec.id):
                    rec._liputa_on_stage_changed()
        return res

    # ------------------------------------------------------------------ actions
    def _stage(self, code):
        return self.env["liputa.order.stage"].search([("code", "=", code)], limit=1)

    def action_estimate_delivery(self):
        estimator = self.env["liputa.delivery.estimator"]
        for rec in self:
            est = estimator.estimate(rec)
            rec.write({
                "delivery_date_estimated": est["date"],
                "estimation_confidence": est["confidence"],
                "estimation_note": est["note"],
            })
            if not rec.delivery_date_promised:
                rec.delivery_date_promised = est["date"]
            if rec.event_date and est["date"] > rec.event_date - timedelta(days=1):
                rec.message_post(body=_(
                    "Warning: estimated delivery (%(est)s) is too close to the event (%(ev)s). "
                    "Consider the Express option or reassigning tailors.",
                    est=est["date"], ev=rec.event_date))
        return True

    def action_confirm(self):
        self.company_id._liputa_ensure_active()
        for rec in self:
            if rec.stage_code not in (False, "draft"):
                continue
            if not rec.bust and not rec.measurement_profile_id and not rec.height:
                raise UserError(_("Please record the client's measurements before confirming."))
            rec.date_confirmed = fields.Date.context_today(rec)
            rec.action_estimate_delivery()
            rec._liputa_generate_tasks()
            rec.stage_id = rec._stage("confirmed")
            if not rec.deposit_amount:
                rec.deposit_amount = rec.amount_total * (rec.company_id.atelier_deposit_pct or 0) / 100.0
        return True

    def _liputa_generate_tasks(self):
        Task = self.env["liputa.order.task"]
        estimator = self.env["liputa.delivery.estimator"]
        for rec in self:
            rec.task_ids.filtered(lambda t: t.state == "todo").unlink()
            hours = rec.workload_hours
            embroidery = sum(rec.option_ids.filtered("is_embroidery").mapped("extra_hours"))
            plan = [(s, hours * share) for s, share in STEP_SHARES.items()]
            if embroidery:
                plan.insert(1, ("embroidery", embroidery))
                plan = [(s, h - embroidery * STEP_SHARES.get(s, 0)) if s != "embroidery" else (s, h)
                        for s, h in plan]
            day = estimator._queue_start(rec)
            labels = dict(STEPS)
            for seq, (step, h) in enumerate(plan):
                tailor = rec.tailor_id if rec.tailor_id and rec.tailor_id._can(step) \
                    else estimator._best_tailor(rec.company_id, step)
                daily = (tailor.daily_hours if tailor else 8.0) * (rec.company_id.atelier_efficiency or 0.8)
                start = day
                end = estimator._add_working_hours(rec.company_id, start, h, daily)
                Task.create({
                    "name": "%s - %s" % (labels[step], rec.name), "order_id": rec.id, "step": step,
                    "sequence": seq, "tailor_id": tailor.id if tailor else False,
                    "planned_hours": round(h, 2), "date_start": start, "date_end": end,
                })
                day = end

    def _liputa_sync_stage_from_tasks(self):
        """Move the order forward automatically as tasks are completed."""
        for rec in self.filtered(lambda r: r.stage_code in OPEN_CODES):
            tasks = rec.task_ids.sorted("sequence")
            if tasks and all(t.state == "done" for t in tasks):
                rec.action_mark_ready()
                continue
            current = tasks.filtered(lambda t: t.state != "done")[:1]
            code = CODE_FOR_STEP.get(current.step) if current else None
            if code and code != rec.stage_code:
                rec.stage_id = rec._stage(code)

    def action_mark_ready(self):
        self.write({"stage_id": self._stage("ready").id})

    def action_deliver(self):
        self.write({"stage_id": self._stage("delivered").id,
                    "delivery_date_actual": fields.Date.context_today(self)})

    def action_cancel(self):
        self.task_ids.filtered(lambda t: t.state != "done").unlink()
        self.write({"stage_id": self._stage("cancelled").id})

    def action_reset_draft(self):
        self.write({"stage_id": self._stage("draft").id})

    def action_create_invoice(self):
        self.ensure_one()
        if self.invoice_id:
            return self.action_view_invoice()
        lines = [Command.create({"name": _("Making: %s", self.garment_model_id.name),
                                 "quantity": 1, "price_unit": self.amount_making})]
        if self.amount_fabric:
            lines.append(Command.create({"name": _("Fabric (%.2f m)", self.fabric_metres),
                                         "quantity": 1, "price_unit": self.amount_fabric}))
        for opt in self.option_ids:
            lines.append(Command.create({"name": opt.name, "quantity": 1, "price_unit": opt.price}))
        if self.amount_urgency:
            lines.append(Command.create({"name": _("Express surcharge"), "quantity": 1,
                                         "price_unit": self.amount_urgency}))
        move = self.env["account.move"].create({
            "move_type": "out_invoice", "partner_id": self.partner_id.id,
            "company_id": self.company_id.id, "invoice_origin": self.name,
            "invoice_line_ids": lines,
        })
        self.invoice_id = move
        return self.action_view_invoice()

    def action_view_invoice(self):
        self.ensure_one()
        return {"type": "ir.actions.act_window", "res_model": "account.move",
                "res_id": self.invoice_id.id, "view_mode": "form", "target": "current"}

    def action_view_tasks(self):
        self.ensure_one()
        action = self.env["ir.actions.act_window"]._for_xml_id("liputa_couture.action_liputa_task")
        action["domain"] = [("order_id", "=", self.id)]
        action["context"] = {"default_order_id": self.id}
        return action

    def action_preview(self):
        self.ensure_one()
        return {"type": "ir.actions.act_url", "target": "new", "url": self.get_portal_url()}

    def action_share_tracking(self):
        """Open the composer with the tracking link (email) - SMS/WhatsApp via gateway."""
        self.ensure_one()
        template = self.env.ref("liputa_couture.mail_template_order_confirmed")
        return {
            "type": "ir.actions.act_window", "res_model": "mail.compose.message", "view_mode": "form",
            "target": "new",
            "context": {"default_model": self._name, "default_res_ids": self.ids,
                        "default_template_id": template.id, "default_composition_mode": "comment"},
        }

    # ------------------------------------------------------------------ pattern / AI
    def _liputa_draft(self, svg=True, seam=True):
        self.ensure_one()
        opts = self.garment_model_id._pattern_options()
        opts["gender"] = self.gender or opts["gender"]
        opts["fabric_width"] = self.fabric_width or 115.0
        opts["lang"] = self.env.lang or "en_US"
        opts["meta"] = {
            "title": "%s - %s" % (self.garment_model_id.name or "", self.name or ""),
            "subtitle": "%s | %s" % (self.partner_id.name or "", self.company_id.name or ""),
            "reference": self.name,
        }
        return draft(self.garment_model_id.pattern_template, self._liputa_measurements(), opts)

    def get_pattern_data(self):
        """RPC for the OWL pattern viewer."""
        self.ensure_one()
        self.check_access("read")
        res = self._liputa_draft()
        return {"svg": res["svg"], "fabric": res["fabric"], "pieces": res["pieces"],
                "measurements": {k: round(v, 1) for k, v in res["measurements"].items()}}

    def get_mannequin_data(self):
        """RPC for the OWL mannequin: completed measurements + display data."""
        self.ensure_one()
        self.check_access("read")
        from ..lib.pattern import complete
        m = complete(self._liputa_measurements(), self.gender or "women")
        return {
            "measurements": {k: round(v, 1) for k, v in m.items()},
            "silhouette": self.garment_model_id.silhouette or "dress",
            "length_type": self.garment_model_id.length_type or "knee",
            "sleeve_type": self.garment_model_id.sleeve_type or "short",
            "flare": self.garment_model_id.flare or 0.0,
            "color": self.garment_color or self.garment_model_id.default_color or "#C4502A",
            "skin_tone": self.skin_tone or "5",
            "has_fabric": bool(self.fabric_image),
            "has_photo": bool(self.client_photo) and self.photo_consent,
            "has_ai_render": bool(self.ai_render_image),
            "write_date": fields.Datetime.to_string(self.write_date),
        }

    def action_ai_render(self):
        self.ensure_one()
        self.env["liputa.ai.service"].render_order(self)
        return True

    # ------------------------------------------------------------------ notifications
    def _liputa_on_stage_changed(self):
        self.ensure_one()
        stage = self.stage_id
        managers = self._liputa_managers()
        self.message_post(
            body=_("Order moved to stage <b>%s</b>.", stage.name),
            partner_ids=managers.partner_id.ids, subtype_xmlid="mail.mt_note")
        if stage.notify_client:
            self._liputa_notify_client(stage)

    def _liputa_notify_client(self, stage):
        self.ensure_one()
        if stage.mail_template_id and self.partner_id.email:
            stage.mail_template_id.send_mail(self.id, force_send=False)
        phone = self.partner_id.mobile or self.partner_id.phone
        if phone:
            msg = _("%(atelier)s: your order %(ref)s is now '%(stage)s'. Track it: %(url)s",
                    atelier=self.company_id.name, ref=self.name,
                    stage=stage.client_label or stage.name, url=self._liputa_tracking_url())
            self.env["liputa.notification.gateway"].send(phone, msg, self.company_id)

    def _liputa_tracking_url(self):
        self.ensure_one()
        base = self.get_base_url()
        return "%s%s" % (base, self.get_portal_url())

    def _liputa_managers(self):
        group = self.env.ref("liputa_couture.group_liputa_manager")
        return group.users.filtered(lambda u: self.company_id in u.company_ids and u.active)

    def _liputa_compute_health(self):
        today = fields.Date.context_today(self)
        for rec in self:
            if rec.stage_code not in OPEN_CODES or not rec.delivery_date_promised:
                health = "on_track"
            elif today > rec.delivery_date_promised:
                health = "late"
            else:
                start = rec.date_confirmed or rec.date_order
                span = max((rec.delivery_date_promised - start).days, 1)
                expected = 100.0 * (today - start).days / span
                days_left = (rec.delivery_date_promised - today).days
                if rec.progress + 20 < expected or (days_left <= 1 and rec.progress < 80):
                    health = "at_risk"
                else:
                    health = "on_track"
            if health != rec.schedule_health:
                rec.schedule_health = health
                if health in ("at_risk", "late"):
                    rec._liputa_alert_managers(health)

    def _liputa_alert_managers(self, health):
        self.ensure_one()
        label = dict(self._fields["schedule_health"].selection)[health]
        summary = _("%(ref)s is %(state)s", ref=self.name, state=label)
        for user in self._liputa_managers():
            already = self.activity_ids.filtered(lambda a: a.user_id == user and a.summary == summary)
            if not already:
                self.activity_schedule("mail.mail_activity_data_todo", user_id=user.id, summary=summary,
                                       note=_("Promised for %(date)s - progress %(p)s%%.",
                                              date=self.delivery_date_promised, p=self.progress),
                                       date_deadline=fields.Date.context_today(self))

    @api.model
    def _cron_watch_schedule(self):
        self.search([("stage_code", "in", OPEN_CODES)])._liputa_compute_health()

    # ------------------------------------------------------------------ dashboard
    @api.model
    def get_dashboard_data(self):
        company = self.env.company
        today = fields.Date.context_today(self)
        base = [("company_id", "=", company.id)]
        open_orders = self.search(base + [("stage_code", "in", OPEN_CODES)])
        month_start = today.replace(day=1)
        month_orders = self.search(base + [("date_order", ">=", month_start),
                                           ("stage_code", "!=", "cancelled")])
        stages = self.env["liputa.order.stage"].search([("code", "not in", ("cancelled",))])
        by_stage = []
        counts = {s.id: c for s, c in self._read_group(base, ["stage_id"], ["__count"])}
        for st in stages:
            by_stage.append({"id": st.id, "name": st.name, "code": st.code, "count": counts.get(st.id, 0)})
        estimator = self.env["liputa.delivery.estimator"]
        capacity_day = estimator._daily_capacity(company)
        backlog = sum(open_orders.mapped(lambda o: o.workload_hours * (1 - o.progress / 100.0)))

        def _row(o):
            return {"id": o.id, "name": o.name, "client": o.partner_id.name,
                    "model": o.garment_model_id.name, "model_id": o.garment_model_id.id,
"promised": fields.Date.to_string(o.delivery_date_promised),
                    "progress": o.progress, "health": o.schedule_health,
                    "event": o.event_type_id.name or ""}

        sub = company.sudo().liputa_subscription_id
        return {
            "company": company.name,
            "currency": {"symbol": company.currency_id.symbol, "position": company.currency_id.position},
            "kpis": {
                "open": len(open_orders),
                "late": len(open_orders.filtered(lambda o: o.schedule_health == "late")),
                "at_risk": len(open_orders.filtered(lambda o: o.schedule_health == "at_risk")),
                "ready": self.search_count(base + [("stage_code", "=", "ready")]),
                "month_orders": len(month_orders),
                "month_revenue": sum(month_orders.mapped("amount_total")),
            },
            "by_stage": by_stage,
            "workload": {
                "backlog_hours": round(backlog, 1),
                "daily_capacity": round(capacity_day, 1),
                "days_of_work": round(backlog / capacity_day, 1) if capacity_day else 0,
            },
            "alerts": [_row(o) for o in open_orders.filtered(
                lambda o: o.schedule_health in ("late", "at_risk")).sorted("delivery_date_promised")[:8]],
            "upcoming": [_row(o) for o in open_orders.filtered(
                lambda o: o.delivery_date_promised and o.delivery_date_promised <= today + timedelta(days=7)
            ).sorted("delivery_date_promised")[:8]],
            "subscription": {
                "state": sub.state if sub else False,
                "days_left": sub.days_left if sub else 0,
                "plan": sub.plan_id.name if sub else "",
                "ai_left": max(sub.plan_id.ai_credits_month - sub.ai_credits_used, 0) if sub else 0,
            },
        }


class LiputaGarmentModelUsage(models.Model):
    _inherit = "liputa.garment.model"

    def _liputa_bump_usage(self):
        for rec in self:
            rec.usage_count += 1
            if rec.source_model_id:
                rec.source_model_id.usage_count += 1
