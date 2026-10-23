# -*- coding: utf-8 -*-
"""Catalogue: categories, event types, garment models (shared library) and pricing."""
from odoo import _, api, fields, models
from odoo.exceptions import UserError

from ..lib.pattern import TEMPLATES

GENDERS = [("women", "Women"), ("men", "Men"), ("unisex", "Unisex"), ("child", "Children")]
SILHOUETTES = [
    ("dress", "Dress"), ("top_skirt", "Top + skirt"), ("wrap", "Wrap (pagne)"),
    ("boubou", "Boubou / kaftan"), ("tunic_trousers", "Tunic + trousers"),
    ("shirt_trousers", "Shirt + trousers"), ("suit", "Suit / abacost"),
]
LENGTHS = [("hip", "Hip"), ("knee", "Knee"), ("midi", "Midi"), ("ankle", "Ankle"), ("floor", "Floor")]
SLEEVES = [("none", "Sleeveless"), ("cap", "Cap"), ("short", "Short"),
           ("three_quarter", "Three-quarter"), ("long", "Long")]


class LiputaGarmentCategory(models.Model):
    _name = "liputa.garment.category"
    _description = "Garment category"
    _order = "sequence, name"
    _parent_store = True

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    parent_id = fields.Many2one("liputa.garment.category", ondelete="restrict", index=True)
    parent_path = fields.Char(index=True)
    gender = fields.Selection(GENDERS, default="unisex")
    silhouette = fields.Selection(SILHOUETTES, default="dress", required=True,
                                  help="Drives the virtual mannequin dressing.")
    company_id = fields.Many2one("res.company", help="Empty = shared with every workshop.")
    model_count = fields.Integer(compute="_compute_model_count")

    def _compute_model_count(self):
        data = self.env["liputa.garment.model"]._read_group(
            [("category_id", "in", self.ids)], ["category_id"], ["__count"])
        counts = {c.id: n for c, n in data}
        for rec in self:
            rec.model_count = counts.get(rec.id, 0)


class LiputaEventType(models.Model):
    _name = "liputa.event.type"
    _description = "Event type"
    _order = "sequence, name"

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    description = fields.Text(translate=True)
    dress_code = fields.Text(translate=True, help="Cultural dress code - used by the AI stylist.")
    keywords = fields.Char(help="Comma separated tags for matching (e.g. wedding,ceremony,white).")
    regions = fields.Char(help="ISO country codes where this event is common, e.g. CD,CG,CM,SN.")
    typical_lead_days = fields.Integer("Typical lead time (days)", default=14)
    color = fields.Integer()
    company_id = fields.Many2one("res.company", help="Empty = shared with every workshop.")


class LiputaGarmentModel(models.Model):
    _name = "liputa.garment.model"
    _description = "Garment model"
    _inherit = ["mail.thread", "image.mixin"]
    _order = "is_featured desc, usage_count desc, name"

    name = fields.Char(required=True, translate=True, tracking=True)
    code = fields.Char(index=True)
    active = fields.Boolean(default=True)
    category_id = fields.Many2one("liputa.garment.category", required=True, index=True)
    silhouette = fields.Selection(related="category_id.silhouette", store=True)
    gender = fields.Selection(GENDERS, default="women", required=True)
    event_type_ids = fields.Many2many("liputa.event.type", string="Suited for events")
    description = fields.Text(translate=True)
    tags = fields.Char(help="Comma separated: wax, bazin, lace, kente, embroidery, mermaid...")
    origin_country_id = fields.Many2one("res.country", "Style origin")
    gallery_ids = fields.Many2many("ir.attachment", string="Gallery")

    # drafting parameters
    pattern_template = fields.Selection(TEMPLATES, required=True, default="dress")
    length_type = fields.Selection(LENGTHS, default="knee")
    sleeve_type = fields.Selection(SLEEVES, default="short")
    neck_type = fields.Selection([("round", "Round"), ("v", "V-neck")], default="round")
    flare = fields.Float(default=0.0, help="0 = straight, 1 = very flared skirt / hem.")
    ease_bust = fields.Float("Bust ease (cm)", help="Empty = template default.")
    ease_waist = fields.Float("Waist ease (cm)")
    ease_hip = fields.Float("Hip ease (cm)")
    leg = fields.Selection([("slim", "Slim"), ("straight", "Straight"), ("wide", "Wide")], default="straight")

    # production
    complexity = fields.Selection([("1", "Simple"), ("2", "Standard"), ("3", "Elaborate"),
                                   ("4", "Haute couture"), ("5", "Masterpiece")], default="2", required=True)
    base_hours = fields.Float("Base workload (h)", default=6.0)
    default_color = fields.Char("Mannequin colour", default="#C4502A")

    # library & tenancy
    company_id = fields.Many2one("res.company", index=True, default=lambda s: s.env.company,
                                 help="Empty = public library model shared with every workshop.")
    library_state = fields.Selection([
        ("private", "Private"), ("submitted", "Submitted to library"),
        ("published", "Published"), ("rejected", "Rejected"),
    ], default="private", tracking=True, index=True)
    author_company_id = fields.Many2one("res.company", "Contributed by", readonly=True)
    source_model_id = fields.Many2one("liputa.garment.model", "Library source", readonly=True)
    is_featured = fields.Boolean()
    usage_count = fields.Integer(readonly=True, default=0)
    is_library = fields.Boolean(compute="_compute_is_library", search="_search_is_library")

    def _compute_is_library(self):
        for rec in self:
            rec.is_library = not rec.company_id

    def _search_is_library(self, operator, value):
        positive = (operator == "=" and value) or (operator == "!=" and not value)
        return [("company_id", "=" if positive else "!=", False)]

    def _pattern_options(self):
        self.ensure_one()
        return {
            "length_type": self.length_type, "sleeve_type": self.sleeve_type, "neck": self.neck_type,
            "flare": self.flare, "ease_bust": self.ease_bust or None, "ease_waist": self.ease_waist or None,
            "ease_hip": self.ease_hip or None, "leg": self.leg,
            "gender": "men" if self.gender == "men" else ("child" if self.gender == "child" else "women"),
        }

    # ---- library workflow -------------------------------------------------
    def action_submit_to_library(self):
        for rec in self:
            if not rec.company_id:
                raise UserError(_("This model already belongs to the library."))
            if not rec.image_1920:
                raise UserError(_("Add at least one photo before submitting a model to the library."))
            rec.library_state = "submitted"

    def action_publish_to_library(self):
        """SaaS admin: copy the model into the public library (company-less)."""
        if not self.env.user.has_group("liputa_couture.group_liputa_saas_admin"):
            raise UserError(_("Only platform administrators can publish to the library."))
        for rec in self.sudo():
            public = rec.copy({"company_id": False, "author_company_id": rec.company_id.id,
                               "library_state": "published", "usage_count": 0})
            rec.write({"library_state": "published", "source_model_id": public.id})
            rec.message_post(body=_("Published to the Liputa library. Thank you for your contribution!"))

    def action_reject_from_library(self):
        if not self.env.user.has_group("liputa_couture.group_liputa_saas_admin"):
            raise UserError(_("Only platform administrators can moderate the library."))
        self.sudo().write({"library_state": "rejected"})

    def action_adopt(self):
        """Copy a library model into the current workshop to customise it."""
        self.ensure_one()
        copy = self.sudo().copy({"company_id": self.env.company.id, "library_state": "private",
                                 "source_model_id": self.id, "is_featured": False})
        return {"type": "ir.actions.act_window", "res_model": self._name, "res_id": copy.id,
                "view_mode": "form", "target": "current"}

    def action_ai_enrich(self):
        self.ensure_one()
        return self.env["liputa.ai.service"].enrich_model(self)


class LiputaPricingRule(models.Model):
    _name = "liputa.pricing.rule"
    _description = "Workshop price list rule"
    _order = "sequence, id"
    _check_company_auto = True

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    garment_model_id = fields.Many2one("liputa.garment.model", "Model")
    category_id = fields.Many2one("liputa.garment.category", "Category")
    event_type_id = fields.Many2one("liputa.event.type", "Event type")
    gender = fields.Selection(GENDERS)
    price = fields.Monetary("Making price", required=True, help="Labour price (façon).")
    fabric_price_per_metre = fields.Monetary("Fabric price / metre",
                                             help="Used when the workshop supplies the fabric.")
    complexity_multiplier = fields.Float(default=1.0)
    active = fields.Boolean(default=True)

    def _specificity(self):
        self.ensure_one()
        return (bool(self.garment_model_id) * 8 + bool(self.event_type_id) * 4
                + bool(self.category_id) * 2 + bool(self.gender))

    @api.model
    def _find_rule(self, company, model, event_type=None):
        rules = self.search([("company_id", "=", company.id)])
        candidates = rules.filtered(lambda r: (
            (not r.garment_model_id or r.garment_model_id in (model | model.source_model_id))
            and (not r.category_id or model.category_id.parent_path.startswith(r.category_id.parent_path))
            and (not r.event_type_id or r.event_type_id == event_type)
            and (not r.gender or r.gender == model.gender)))
        return candidates.sorted(lambda r: (-r._specificity(), r.sequence))[:1]
