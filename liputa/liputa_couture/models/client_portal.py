# -*- coding: utf-8 -*-
"""Client portal: public directory of workshops ranked by rating, client reviews,
orders followed by client accounts and the push notifications they receive."""
import re

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

# Classement : moyenne bayésienne. Un atelier noté 5/5 une seule fois ne passe pas devant
# un atelier noté 4,6/5 quarante fois : chaque atelier part de PRIOR_COUNT avis fictifs à PRIOR_MEAN.
PRIOR_MEAN = 3.5
PRIOR_COUNT = 5


def whatsapp_digits(number):
    """International number reduced to digits, as wa.me expects (``+243 81…`` → ``24381…``)."""
    digits = re.sub(r"\D", "", number or "")
    if digits.startswith("00"):
        digits = digits[2:]
    return digits if len(digits) >= 8 else ""


class LiputaReview(models.Model):
    _name = "liputa.review"
    _description = "Client review of a workshop"
    _order = "create_date desc, id desc"

    company_id = fields.Many2one("res.company", "Workshop", required=True, ondelete="cascade", index=True)
    user_id = fields.Many2one("res.users", "Client account", required=True, ondelete="cascade", index=True)
    author_name = fields.Char(required=True)
    rating = fields.Integer(required=True)
    comment = fields.Text()
    verified = fields.Boolean("Verified client", readonly=True,
                              help="The author has at least one order followed with this workshop.")
    is_published = fields.Boolean("Published", default=True,
                                  help="Platform administrators can hide an abusive review.")

    _sql_constraints = [
        ("one_review_per_client", "unique(company_id, user_id)", "A client reviews a workshop only once."),
    ]

    @api.constrains("rating")
    def _check_rating(self):
        for rec in self:
            if not 1 <= rec.rating <= 5:
                raise ValidationError(_("The rating must be between 1 and 5 stars."))

    @api.constrains("company_id", "user_id")
    def _check_not_staff(self):
        for rec in self:
            if not rec.user_id.share and rec.company_id in rec.user_id.company_ids:
                raise ValidationError(_("A workshop cannot rate itself."))

    @api.model
    def _liputa_rate(self, company, user, rating, comment=""):
        """Create or update the review of ``user`` for ``company`` (one per client)."""
        rating = int(rating)
        comment = (comment or "").strip()[:600]
        review = self.sudo().search([("company_id", "=", company.id), ("user_id", "=", user.id)], limit=1)
        verified = bool(self.env["liputa.order"].sudo().search_count(
            [("company_id", "=", company.id)] + user.partner_id._liputa_order_domain()))
        vals = {"rating": rating, "comment": comment, "verified": verified,
                "author_name": (user.name or "").split(" ")[0][:40] or _("Client")}
        if review:
            review.write(vals)
        else:
            review = self.sudo().create(dict(vals, company_id=company.id, user_id=user.id))
            stars = "★" * rating + "☆" * (5 - rating)
            self.env["liputa.push.message"]._liputa_send(
                company._liputa_manager_partners(), _("New review: %s", stars),
                comment or _("%s rated your workshop.", vals["author_name"]),
                url="/app", tag="review-%s" % review.id)
        return review


class ResCompany(models.Model):
    _inherit = "res.company"

    atelier_listed = fields.Boolean("Shown in the client directory", default=True)
    atelier_description = fields.Text("Presentation", translate=True)
    liputa_review_ids = fields.One2many("liputa.review", "company_id")
    liputa_rating_avg = fields.Float("Average rating", compute="_compute_liputa_rating", store=True, digits=(3, 2))
    liputa_rating_count = fields.Integer("Reviews", compute="_compute_liputa_rating", store=True)
    liputa_rating_score = fields.Float("Ranking score", compute="_compute_liputa_rating", store=True,
                                       digits=(4, 3), index=True)

    @api.depends("liputa_review_ids.rating", "liputa_review_ids.is_published")
    def _compute_liputa_rating(self):
        for rec in self:
            ratings = rec.liputa_review_ids.filtered("is_published").mapped("rating")
            n = len(ratings)
            rec.liputa_rating_count = n
            rec.liputa_rating_avg = sum(ratings) / n if n else 0.0
            rec.liputa_rating_score = (PRIOR_MEAN * PRIOR_COUNT + sum(ratings)) / (PRIOR_COUNT + n)

    @api.model
    def _liputa_directory_domain(self):
        return [("is_atelier", "=", True), ("atelier_listed", "=", True),
                ("liputa_subscription_state", "in", ("trial", "active", "grace"))]

    @api.model
    def _liputa_directory(self, search="", limit=60):
        """Listed workshops, best rated first (then most reviewed, then alphabetical)."""
        dom = self._liputa_directory_domain()
        if search:
            search = str(search)[:60]
            dom += ["|", "|", ("name", "ilike", search), ("city", "ilike", search),
                    ("atelier_slogan", "ilike", search)]
        workshops = self.sudo().search(dom)
        return workshops.sorted(lambda c: (-c.liputa_rating_score, -c.liputa_rating_count, c.name.lower()))[:limit]

    def _liputa_whatsapp_url(self, text=None):
        self.ensure_one()
        digits = whatsapp_digits(self.atelier_whatsapp or self.phone)
        if not digits:
            return ""
        from urllib.parse import quote
        text = text or _("Hello %s, I found your workshop on Liputa.", self.name)
        return "https://wa.me/%s?text=%s" % (digits, quote(text))

    def _liputa_manager_partners(self):
        self.ensure_one()
        group = self.env.ref("liputa_couture.group_liputa_manager")
        return group.sudo().users.filtered(lambda u: self in u.company_ids and u.active).partner_id

    @api.model
    def _liputa_admin_partners(self):
        group = self.env.ref("liputa_couture.group_liputa_saas_admin")
        return group.sudo().users.filtered("active").partner_id


class ResPartner(models.Model):
    _inherit = "res.partner"

    def _liputa_order_domain(self):
        """Orders a client account sees: those placed under its own contact and those it follows."""
        self.ensure_one()
        partner = self.commercial_partner_id
        return ["|", ("partner_id", "child_of", partner.id), ("client_partner_ids", "in", self.ids)]


class ResUsers(models.Model):
    _inherit = "res.users"

    liputa_signup_ip = fields.Char(groups="liputa_couture.group_liputa_saas_admin", copy=False)
