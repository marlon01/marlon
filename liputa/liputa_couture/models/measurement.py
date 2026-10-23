# -*- coding: utf-8 -*-
from odoo import api, fields, models

from ..lib.pattern import FIELDS as PATTERN_FIELDS

MEASUREMENT_FIELDS = PATTERN_FIELDS  # single source of truth with the pattern engine


class LiputaMeasurementMixin(models.AbstractModel):
    """Body measurements (cm). Shared by client profiles and order snapshots."""

    _name = "liputa.measurement.mixin"
    _description = "Body measurements"

    height = fields.Float("Height", help="Total height, head to floor (cm).")
    neck = fields.Float("Neck", help="Neck circumference at the base (cm).")
    shoulder_width = fields.Float("Shoulder width", help="Shoulder point to shoulder point, across the back.")
    bust = fields.Float("Bust / chest", help="Fullest part of the bust or chest.")
    under_bust = fields.Float("Under bust")
    waist = fields.Float("Waist", help="Natural waist circumference.")
    hip = fields.Float("Hip", help="Fullest part of the hips.")
    back_waist_length = fields.Float("Back waist length", help="Nape of the neck to the waist.")
    front_waist_length = fields.Float("Front waist length", help="Neck point over the bust to the waist.")
    arm_length = fields.Float("Arm length", help="Shoulder point to wrist, elbow slightly bent.")
    biceps = fields.Float("Biceps")
    wrist = fields.Float("Wrist")
    hip_depth = fields.Float("Hip depth", help="Waist to fullest hip, vertically.")
    thigh = fields.Float("Thigh")
    knee = fields.Float("Knee")
    hem_width = fields.Float("Trouser hem", help="Trouser hem circumference.")
    inseam = fields.Float("Inseam", help="Crotch to floor.")
    outseam = fields.Float("Trouser length", help="Waist to floor along the side.")
    skirt_length = fields.Float("Skirt length")
    dress_length = fields.Float("Dress length", help="Shoulder/neck point to hem.")

    def _liputa_measurements(self):
        self.ensure_one()
        return {f: self[f] for f in MEASUREMENT_FIELDS if self[f]}

    def _liputa_measurement_values(self):
        self.ensure_one()
        return {f: self[f] for f in MEASUREMENT_FIELDS}


class LiputaMeasurementProfile(models.Model):
    _name = "liputa.measurement.profile"
    _description = "Client measurement profile"
    _inherit = ["liputa.measurement.mixin", "mail.thread"]
    _order = "date desc, id desc"
    _check_company_auto = True

    name = fields.Char(compute="_compute_name", store=True)
    partner_id = fields.Many2one("res.partner", "Client", required=True, index=True, ondelete="cascade")
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    date = fields.Date(default=fields.Date.context_today, tracking=True)
    gender = fields.Selection([("women", "Woman"), ("men", "Man"), ("child", "Child")], default="women")
    photo = fields.Image("Full-length photo", max_width=1280, max_height=1280, attachment=True)
    photo_consent = fields.Boolean(
        "Photo consent", help="The client agreed that the photo is used for fittings and AI rendering.")
    notes = fields.Text()

    @api.depends("partner_id", "date")
    def _compute_name(self):
        for rec in self:
            rec.name = "%s - %s" % (rec.partner_id.name or "", rec.date or "")


class ResPartner(models.Model):
    _inherit = "res.partner"

    liputa_measurement_ids = fields.One2many("liputa.measurement.profile", "partner_id", "Measurements")
    liputa_order_ids = fields.One2many("liputa.order", "partner_id", "Tailoring orders")
    liputa_order_count = fields.Integer(compute="_compute_liputa_order_count")

    def _compute_liputa_order_count(self):
        data = self.env["liputa.order"]._read_group(
            [("partner_id", "in", self.ids)], ["partner_id"], ["__count"])
        counts = {p.id: c for p, c in data}
        for rec in self:
            rec.liputa_order_count = counts.get(rec.id, 0)

    def action_liputa_orders(self):
        self.ensure_one()
        action = self.env["ir.actions.act_window"]._for_xml_id("liputa_couture.action_liputa_order")
        action["domain"] = [("partner_id", "=", self.id)]
        action["context"] = {"default_partner_id": self.id}
        return action
