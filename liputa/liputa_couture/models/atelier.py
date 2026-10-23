# -*- coding: utf-8 -*-
"""Workshop resources: tailors, order stages, production tasks, order options."""
from odoo import api, fields, models

STEPS = [
    ("cutting", "Cutting"),
    ("embroidery", "Embroidery"),
    ("sewing", "Sewing"),
    ("fitting", "Fitting"),
    ("finishing", "Finishing & ironing"),
]

STAGE_CODES = [
    ("draft", "Draft"), ("confirmed", "Confirmed"), ("cutting", "Cutting"),
    ("sewing", "Sewing"), ("fitting", "Fitting"), ("finishing", "Finishing"),
    ("ready", "Ready"), ("delivered", "Delivered"), ("cancelled", "Cancelled"),
]


class LiputaTailor(models.Model):
    _name = "liputa.tailor"
    _description = "Tailor / workshop staff"
    _inherit = ["image.mixin"]
    _order = "name"
    _check_company_auto = True

    name = fields.Char(required=True)
    user_id = fields.Many2one("res.users", "Linked user", check_company=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    phone = fields.Char()
    daily_hours = fields.Float(default=8.0)
    can_cut = fields.Boolean("Cutting", default=True)
    can_sew = fields.Boolean("Sewing", default=True)
    can_embroider = fields.Boolean("Embroidery")
    can_finish = fields.Boolean("Finishing", default=True)
    color = fields.Integer()
    active = fields.Boolean(default=True)
    task_ids = fields.One2many("liputa.order.task", "tailor_id")
    open_hours = fields.Float("Assigned open hours", compute="_compute_open_hours")

    @api.depends("task_ids.state", "task_ids.planned_hours")
    def _compute_open_hours(self):
        for rec in self:
            rec.open_hours = sum(rec.task_ids.filtered(lambda t: t.state != "done").mapped("planned_hours"))

    def _can(self, step):
        self.ensure_one()
        return {"cutting": self.can_cut, "embroidery": self.can_embroider,
                "sewing": self.can_sew, "fitting": self.can_sew or self.can_cut,
                "finishing": self.can_finish}.get(step, True)


class LiputaOrderStage(models.Model):
    _name = "liputa.order.stage"
    _description = "Order stage"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=True)
    client_label = fields.Char("Label shown to the client", translate=True)
    code = fields.Selection(STAGE_CODES, required=True)
    sequence = fields.Integer(default=10)
    fold = fields.Boolean()
    client_visible = fields.Boolean(default=True)
    notify_client = fields.Boolean()
    mail_template_id = fields.Many2one("mail.template", domain=[("model", "=", "liputa.order")])


class LiputaOrderTask(models.Model):
    _name = "liputa.order.task"
    _description = "Production task"
    _order = "date_start, sequence, id"

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    order_id = fields.Many2one("liputa.order", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="order_id.company_id", store=True, index=True)
    partner_id = fields.Many2one(related="order_id.partner_id")
    step = fields.Selection(STEPS, required=True)
    tailor_id = fields.Many2one("liputa.tailor", index=True)
    planned_hours = fields.Float()
    date_start = fields.Date()
    date_end = fields.Date()
    state = fields.Selection([("todo", "To do"), ("in_progress", "In progress"), ("done", "Done")],
                             default="todo", required=True, index=True)
    done_date = fields.Datetime(readonly=True)
    color = fields.Integer(related="tailor_id.color")

    def action_start(self):
        self.write({"state": "in_progress"})

    def action_done(self):
        self.write({"state": "done", "done_date": fields.Datetime.now()})

    def write(self, vals):
        res = super().write(vals)
        if "state" in vals:
            self.mapped("order_id")._liputa_sync_stage_from_tasks()
        return res


class LiputaOrderOption(models.Model):
    _name = "liputa.order.option"
    _description = "Order extra (embroidery, lining, beads...)"

    order_id = fields.Many2one("liputa.order", required=True, ondelete="cascade")
    name = fields.Char(required=True)
    currency_id = fields.Many2one(related="order_id.currency_id")
    price = fields.Monetary()
    extra_hours = fields.Float()
    is_embroidery = fields.Boolean()
