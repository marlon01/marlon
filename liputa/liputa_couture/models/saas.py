# -*- coding: utf-8 -*-
"""SaaS layer: workshop tenants (res.company), plans, subscriptions, payments."""
import logging
import re
from datetime import timedelta

import requests

from dateutil.relativedelta import relativedelta

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# FlexPay (Infoset, RDC) — Mobile Money M-Pesa, Orange Money, Airtel Money, Afrimoney.
FLEXPAY_URLS = {"prod": "https://backend.flexpay.cd/api/rest/v1", "dev": "https://beta-backend.flexpay.cd/api/rest/v1"}
FLEXPAY_METHODS = ("mpesa", "orange_money", "airtel_money", "afrimoney")
FLEXPAY_TIMEOUT = 30
# CinetPay — Mobile Money et cartes, Afrique francophone (paiement sur la page CinetPay, puis retour).
CINETPAY_API = "https://api-checkout.cinetpay.com/v2"
CINETPAY_CURRENCIES = ("XOF", "XAF", "CDF", "GNF", "USD")

PAYMENT_METHODS = [
    ("mpesa", "M-Pesa"),
    ("orange_money", "Orange Money"),
    ("airtel_money", "Airtel Money"),
    ("afrimoney", "Afrimoney"),
    ("mtn_momo", "MTN MoMo"),
    ("wave", "Wave"),
    ("card", "Bank card"),
    ("online", "Online (CinetPay: Mobile Money or card)"),
    ("bank", "Bank transfer"),
    ("cash", "Cash (agent)"),
]


class ResCompany(models.Model):
    _inherit = "res.company"

    is_atelier = fields.Boolean("Is a tailoring workshop", default=False)
    atelier_slogan = fields.Char("Slogan", translate=True)
    atelier_working_days = fields.Char(
        "Working days", default="0,1,2,3,4,5",
        help="Comma separated weekdays (0 = Monday ... 6 = Sunday).")
    atelier_efficiency = fields.Float("Efficiency rate", default=0.8,
                                      help="Share of paid hours really spent sewing (0-1).")
    atelier_fitting_buffer = fields.Integer("Fitting buffer (days)", default=2)
    atelier_urgency_pct = fields.Float("Urgency surcharge (%)", default=30.0)
    atelier_deposit_pct = fields.Float("Deposit (%)", default=50.0)
    atelier_default_fabric_width = fields.Float("Default fabric width (cm)", default=115.0,
                                                help="African wax-print is usually 115-120 cm wide.")
    atelier_whatsapp = fields.Char("WhatsApp number")
    liputa_subscription_id = fields.Many2one("liputa.subscription", compute="_compute_liputa_subscription",
                                             search="_search_liputa_subscription")
    liputa_subscription_state = fields.Selection(related="liputa_subscription_id.state")

    def _compute_liputa_subscription(self):
        subs = self.env["liputa.subscription"].sudo().search([("company_id", "in", self.ids)])
        by_company = {s.company_id.id: s for s in subs}
        for rec in self:
            rec.liputa_subscription_id = by_company.get(rec.id, False)

    @api.model
    def _liputa_create_workshop(self, values, country=None, ip=None, lang=None):
        """Create a workshop tenant: company, head of workshop, trial subscription, first tailor.

        ``values``: atelier, name, email, phone, password (already validated by the caller).
        """
        env = self.env(su=True)
        email = values["email"].lower()
        company = env["res.company"].create({
            "name": values["atelier"][:120], "is_atelier": True, "phone": (values.get("phone") or "")[:40],
            "email": email, "country_id": country.id if country else False,
            "currency_id": ((country and country.currency_id) or env.ref("base.CDF")).id,
        })
        groups = [env.ref("base.group_user").id,
                  env.ref("liputa_couture.group_liputa_manager").id,
                  env.ref("account.group_account_invoice").id]
        user = env["res.users"].with_context(no_reset_password=True).create({
            "name": values["name"][:120], "login": email, "email": email,
            "password": values["password"], "company_id": company.id, "company_ids": [(6, 0, [company.id])],
            "groups_id": [(6, 0, groups)], "lang": lang if lang and env["res.lang"]._lang_get(lang) else "en_US",
        })
        # Contacts de l'atelier rattachés à l'atelier : invisibles des autres ateliers.
        (user.partner_id | company.partner_id).write({"company_id": company.id})
        # Numérotation propre à l'atelier : une référence ne révèle rien de l'activité des autres.
        env["ir.sequence"].create({
            "name": "Liputa orders — %s" % company.name, "code": "liputa.order", "company_id": company.id,
            "prefix": "CMD/%(year)s/", "padding": 4, "implementation": "no_gap",
        })
        env["liputa.subscription"].create({
            "company_id": company.id, "plan_id": env.ref("liputa_couture.plan_standard").id, "signup_ip": ip,
        })
        env["liputa.tailor"].create({"name": values["name"][:120], "company_id": company.id, "user_id": user.id})
        env["liputa.push.message"]._liputa_send(
            env["res.company"]._liputa_admin_partners(), _("New workshop: %s", company.name),
            _("%(name)s has just created a workshop (%(country)s).", name=user.name,
              country=country.name if country else "?"),
            url="/odoo", model="res.company", res_id=company.id, tag="signup-%s" % company.id)
        return company

    def _search_liputa_subscription(self, operator, value):
        subs = self.env["liputa.subscription"].sudo().search([("id", operator, value)])
        return [("id", "in", subs.mapped("company_id").ids)]

    def _liputa_check_order_quota(self, count=1):
        """Monthly order quota of the plan (0 = unlimited)."""
        for company in self.filtered("is_atelier"):
            sub = company.sudo().liputa_subscription_id
            limit = sub.plan_id.max_orders_month if sub else 0
            if not limit:
                continue
            month_start = fields.Date.context_today(self).replace(day=1)
            used = self.env["liputa.order"].sudo().search_count([
                ("company_id", "=", company.id), ("create_date", ">=", month_start)])
            if used + count > limit:
                raise UserError(_("Your plan allows %(n)s orders per month. Upgrade your plan to take more orders.",
                                  n=limit))

    def _liputa_working_weekdays(self):
        self.ensure_one()
        try:
            days = {int(d) for d in (self.atelier_working_days or "").split(",") if d.strip() != ""}
        except ValueError:
            days = set()
        return days or {0, 1, 2, 3, 4, 5}

    def _liputa_ensure_active(self):
        """Block business operations of suspended workshops (read stays allowed)."""
        for company in self:
            if not company.is_atelier:
                continue
            sub = company.sudo().liputa_subscription_id
            if not sub or sub.state in ("suspended", "cancelled"):
                raise UserError(_(
                    "The subscription of workshop %(name)s is not active. "
                    "Please renew it (Mobile Money accepted) to continue.", name=company.name))


class LiputaPlan(models.Model):
    _name = "liputa.plan"
    _description = "Subscription plan"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=True)
    sequence = fields.Integer(default=10)
    price = fields.Monetary(required=True)
    currency_id = fields.Many2one("res.currency", required=True,
                                  default=lambda s: s.env.ref("base.CDF", raise_if_not_found=False))
    interval_months = fields.Integer(default=1, required=True)
    trial_days = fields.Integer(default=14)
    grace_days = fields.Integer(default=7)
    max_users = fields.Integer(default=5, help="0 = unlimited")
    max_orders_month = fields.Integer(default=0, help="0 = unlimited")
    ai_credits_month = fields.Integer("AI credits / month", default=100)
    description = fields.Html(translate=True)
    active = fields.Boolean(default=True)


class LiputaSubscription(models.Model):
    _name = "liputa.subscription"
    _description = "Workshop subscription"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _rec_name = "company_id"

    company_id = fields.Many2one("res.company", required=True, ondelete="cascade", index=True)
    plan_id = fields.Many2one("liputa.plan", required=True, tracking=True)
    currency_id = fields.Many2one(related="plan_id.currency_id")
    state = fields.Selection([
        ("trial", "Trial"), ("active", "Active"), ("grace", "Grace period"),
        ("suspended", "Suspended"), ("cancelled", "Cancelled"),
    ], default="trial", required=True, tracking=True, index=True)
    start_date = fields.Date(default=fields.Date.context_today)
    next_due_date = fields.Date(tracking=True)
    last_payment_date = fields.Date()
    payment_ids = fields.One2many("liputa.subscription.payment", "subscription_id")
    ai_credits_used = fields.Integer(default=0)
    ai_period_start = fields.Date(default=fields.Date.context_today)
    signup_ip = fields.Char(groups="liputa_couture.group_liputa_saas_admin")
    days_left = fields.Integer(compute="_compute_days_left")

    _sql_constraints = [("company_uniq", "unique(company_id)", "A workshop has only one subscription.")]

    @api.depends("next_due_date")
    def _compute_days_left(self):
        today = fields.Date.context_today(self)
        for rec in self:
            rec.days_left = (rec.next_due_date - today).days if rec.next_due_date else 0

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get("next_due_date") and vals.get("plan_id"):
                plan = self.env["liputa.plan"].browse(vals["plan_id"])
                vals["next_due_date"] = fields.Date.context_today(self) + timedelta(days=plan.trial_days)
        return super().create(vals_list)

    def _register_payment(self, payment):
        """Extend the subscription after a confirmed payment (idempotent per payment)."""
        for sub in self:
            today = fields.Date.context_today(sub)
            base = max(sub.next_due_date or today, today)
            sub.write({
                "next_due_date": base + relativedelta(months=sub.plan_id.interval_months),
                "last_payment_date": today,
                "state": "active",
            })
            sub.message_post(body=_("Payment %(ref)s received: %(amount)s %(cur)s via %(method)s.",
                                    ref=payment.reference, amount=payment.amount,
                                    cur=payment.currency_id.name, method=payment.method))
            Push = self.env["liputa.push.message"]
            Push._liputa_send(self.env["res.company"]._liputa_admin_partners(),
                              _("Payment received: %s", sub.company_id.name),
                              _("%(amount)s %(cur)s via %(method)s.", amount=payment.amount,
                                cur=payment.currency_id.name, method=payment.method),
                              url="/odoo", model=sub._name, res_id=sub.id, tag="payment-%s" % payment.id)
            Push._liputa_send(sub.company_id._liputa_manager_partners(), _("Subscription renewed"),
                              _("Thank you! Your workshop is active until %s.", sub.next_due_date),
                              url="/app#/account", tag="subscription-%s" % sub.id)

    def ai_consume(self, credits=1):
        self.ensure_one()
        limit = self.plan_id.ai_credits_month
        if limit and self.ai_credits_used + credits > limit:
            raise UserError(_("Monthly AI credits exhausted (%s). They renew next month.", limit))
        self.sudo().ai_credits_used += credits

    @api.model
    def _cron_check_subscriptions(self):
        today = fields.Date.context_today(self)
        for sub in self.search([("state", "in", ("trial", "active", "grace"))]):
            if sub.ai_period_start and sub.ai_period_start + relativedelta(months=1) <= today:
                sub.write({"ai_credits_used": 0, "ai_period_start": today})
            if not sub.next_due_date:
                continue
            if sub.state in ("trial", "active") and sub.next_due_date < today:
                sub.state = "grace"
                sub.message_post(body=_("Subscription due. Grace period started."))
            elif sub.state == "grace" and sub.next_due_date + timedelta(days=sub.plan_id.grace_days) < today:
                sub.state = "suspended"
                sub.message_post(body=_("Subscription suspended for non-payment."))
            elif sub.state in ("trial", "active") and (sub.next_due_date - today).days == 3:
                sub.message_post(body=_("Reminder: your subscription renews in 3 days."),
                                 partner_ids=sub.company_id.partner_id.ids)


class LiputaSubscriptionPayment(models.Model):
    _name = "liputa.subscription.payment"
    _description = "Subscription payment"
    _order = "date desc, id desc"

    subscription_id = fields.Many2one("liputa.subscription", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="subscription_id.company_id", store=True)
    reference = fields.Char(required=True, readonly=True, copy=False,
                            default=lambda s: s.env["ir.sequence"].next_by_code("liputa.subscription.payment"))
    provider_reference = fields.Char(index=True, copy=False)
    amount = fields.Monetary(required=True)
    currency_id = fields.Many2one(related="subscription_id.currency_id")
    method = fields.Selection(PAYMENT_METHODS, required=True, default="mpesa")
    phone = fields.Char("Payer phone")
    provider = fields.Char(readonly=True, copy=False)
    provider_order = fields.Char("Provider order number", readonly=True, copy=False, index=True)
    provider_message = fields.Char(readonly=True, copy=False)
    provider_url = fields.Char("Payment page", readonly=True, copy=False)
    date = fields.Datetime(default=fields.Datetime.now)
    state = fields.Selection([("pending", "Pending"), ("done", "Done"), ("failed", "Failed")],
                             default="pending", required=True, index=True)

    _sql_constraints = [("ref_uniq", "unique(reference)", "Payment reference must be unique.")]

    def _liputa_initiate(self):
        """Send the payment request (USSD push) to the operator's aggregator.

        Each aggregator (FlexPay, MaxiCash, CinetPay, Flutterwave...) gets an
        adapter method named `_liputa_initiate_<provider>` implemented from its
        official documentation; the provider is chosen with the system
        parameter `liputa.payment.provider`. Without adapter the payment stays
        pending and can be confirmed by a platform administrator.
        """
        for pay in self:
            provider = self._liputa_provider_for(pay.subscription_id.company_id)
            adapter = getattr(pay, "_liputa_initiate_%s" % provider, None) if provider else None
            if adapter:
                adapter()
            else:
                _logger.info("Liputa payment %s pending manual confirmation (no aggregator configured).",
                             pay.reference)
            pay.subscription_id.message_post(body=_(
                "Payment request %(ref)s sent to %(phone)s (%(method)s).",
                ref=pay.reference, phone=pay.phone, method=pay.method))

    @api.model
    def _liputa_provider_for(self, company):
        """Agrégateur selon le pays de l'atelier : FlexPay en RDC, CinetPay ailleurs (et en RDC si FlexPay
        n'est pas configuré). Le paramètre ``liputa.payment.provider`` peut forcer un agrégateur ;
        vide ou « auto » = choix automatique ; aucun agrégateur = confirmation manuelle."""
        icp = self.env["ir.config_parameter"].sudo()
        forced = (icp.get_param("liputa.payment.provider") or "auto").strip()
        if forced not in ("", "auto"):
            return forced
        flexpay = bool(icp.get_param("liputa.flexpay.merchant") and icp.get_param("liputa.flexpay.token"))
        cinetpay = bool(icp.get_param("liputa.cinetpay.site_id") and icp.get_param("liputa.cinetpay.api_key"))
        country = company.country_id.code
        if flexpay and country in ("CD", False, None):
            return "flexpay"
        if cinetpay:
            return "cinetpay"
        return ""

    @api.model
    def _liputa_flow_for(self, company):
        """Parcours affiché par l'application : push (code PIN sur le téléphone), redirect ou manual."""
        return {"flexpay": "push", "cinetpay": "redirect"}.get(self._liputa_provider_for(company), "manual")

    # ------------------------------------------------------------------ CinetPay
    def _cinetpay_config(self):
        icp = self.env["ir.config_parameter"].sudo()
        return {"site_id": (icp.get_param("liputa.cinetpay.site_id") or "").strip(),
                "api_key": (icp.get_param("liputa.cinetpay.api_key") or "").strip(),
                "base_url": (icp.get_param("web.base.url") or "").rstrip("/")}

    def _liputa_initiate_cinetpay(self):
        """Ouvre une transaction CinetPay ; le client paie sur la page CinetPay puis revient dans l'application."""
        cfg = self._cinetpay_config()
        if not cfg["site_id"] or not cfg["api_key"]:
            raise UserError(_("CinetPay is not configured (site ID and API key)."))
        for pay in self:
            company = pay.subscription_id.company_id
            currency = pay.currency_id.name
            if currency not in CINETPAY_CURRENCIES:
                raise UserError(_("CinetPay does not accept payments in %s.", currency))
            payload = {
                "apikey": cfg["api_key"], "site_id": cfg["site_id"], "transaction_id": pay.reference,
                "amount": int(round(pay.amount)), "currency": currency, "channels": "ALL", "lang": "FR",
                "description": ("Liputa %s" % company.name)[:100].replace("#", ""),
                "return_url": "%s/liputa/payment/cinetpay/return?ref=%s" % (cfg["base_url"], pay.reference),
                "notify_url": "%s/liputa/payment/cinetpay/notify" % cfg["base_url"],
                "customer_name": (company.name or "")[:60], "customer_surname": (company.name or "")[:60],
                "customer_email": company.email or "", "customer_phone_number": pay.phone or company.phone or "",
                "customer_address": company.street or company.city or "-", "customer_city": company.city or "-",
                "customer_country": company.country_id.code or "CD", "customer_state": company.country_id.code or "CD",
                "customer_zip_code": company.zip or "00000",
            }
            pay.write({"provider": "cinetpay", "provider_message": False, "provider_order": pay.reference})
            try:
                data = requests.post(CINETPAY_API + "/payment", json=payload, timeout=FLEXPAY_TIMEOUT).json()
            except (requests.RequestException, ValueError) as exc:
                _logger.warning("CinetPay injoignable pour %s : %s", pay.reference, exc)
                raise UserError(_("The payment service cannot be reached right now. Please try again in a few minutes."))
            url = (data.get("data") or {}).get("payment_url")
            if str(data.get("code")) != "201" or not url:
                _logger.warning("CinetPay a refusé %s : %s", pay.reference, data)
                raise UserError(_("The payment request was refused: %s",
                                  data.get("description") or data.get("message") or "?"))
            pay.provider_url = url

    def _liputa_check_cinetpay(self):
        """Interroge CinetPay : seule source de vérité (jamais le contenu d'une notification)."""
        cfg = self._cinetpay_config()
        for pay in self.filtered(lambda p: p.state == "pending" and p.provider == "cinetpay"):
            try:
                data = requests.post(CINETPAY_API + "/payment/check", timeout=FLEXPAY_TIMEOUT, json={
                    "apikey": cfg["api_key"], "site_id": cfg["site_id"], "transaction_id": pay.reference}).json()
            except (requests.RequestException, ValueError) as exc:
                _logger.warning("CinetPay : vérification de %s impossible : %s", pay.reference, exc)
                continue
            info = data.get("data") or {}
            status = (info.get("status") or "").upper()
            if str(data.get("code")) == "00" and status == "ACCEPTED":
                try:
                    amount = float(info.get("amount") or 0)
                except (TypeError, ValueError):
                    amount = 0.0
                if amount + 1e-6 < int(round(pay.amount)) or (info.get("currency") or "") != pay.currency_id.name:
                    _logger.warning("CinetPay : transaction %s non conforme : %s", pay.reference, info)
                    pay.write({"state": "failed", "provider_message": _("Amount or currency mismatch.")})
                    continue
                pay._liputa_webhook_update("success", info.get("operator_id") or pay.reference)
            elif status in ("REFUSED", "CANCELED", "CANCELLED"):
                pay.write({"provider_message": str(data.get("message") or status)[:200]})
                pay._liputa_webhook_update("failed")

    def _liputa_check_online(self):
        self._liputa_check_flexpay()
        self._liputa_check_cinetpay()

    # ------------------------------------------------------------------ FlexPay
    def _flexpay_config(self):
        icp = self.env["ir.config_parameter"].sudo()
        env_key = icp.get_param("liputa.flexpay.environment", "prod")
        return {
            "merchant": (icp.get_param("liputa.flexpay.merchant") or "").strip(),
            "token": (icp.get_param("liputa.flexpay.token") or "").strip(),
            "url": FLEXPAY_URLS.get(env_key, FLEXPAY_URLS["prod"]),
            "base_url": (icp.get_param("web.base.url") or "").rstrip("/"),
        }

    @staticmethod
    def _flexpay_phone(phone):
        """FlexPay attend 12 chiffres au format international sans « + » (243XXXXXXXXX)."""
        digits = re.sub(r"\D", "", phone or "")
        if digits.startswith("00"):
            digits = digits[2:]
        if len(digits) == 10 and digits.startswith("0"):
            digits = "243" + digits[1:]
        elif len(digits) == 9:
            digits = "243" + digits
        return digits if len(digits) == 12 else False

    def _liputa_initiate_flexpay(self):
        """Envoie la demande de paiement : le client valide avec son code PIN sur son téléphone."""
        cfg = self._flexpay_config()
        if not cfg["merchant"] or not cfg["token"]:
            raise UserError(_("FlexPay is not configured (merchant code and token)."))
        for pay in self:
            if pay.method not in FLEXPAY_METHODS:
                raise UserError(_("FlexPay accepts Mobile Money only (M-Pesa, Orange Money, Airtel Money, Afrimoney)."))
            phone = self._flexpay_phone(pay.phone)
            if not phone:
                raise UserError(_("Enter the Mobile Money number in the format 243XXXXXXXXX."))
            currency = pay.currency_id.name
            if currency not in ("CDF", "USD"):
                raise UserError(_("FlexPay only accepts payments in CDF or USD."))
            payload = {
                "merchant": cfg["merchant"], "type": "1", "phone": phone, "reference": pay.reference,
                "amount": "%s" % (int(pay.amount) if float(pay.amount).is_integer() else round(pay.amount, 2)),
                "currency": currency, "callbackUrl": "%s/liputa/payment/flexpay/callback" % cfg["base_url"],
                "description": ("Liputa %s" % pay.subscription_id.company_id.name)[:100],
            }
            pay.write({"provider": "flexpay", "provider_message": False})
            try:
                resp = requests.post(cfg["url"] + "/paymentService", json=payload, timeout=FLEXPAY_TIMEOUT,
                                     headers={"Authorization": "Bearer %s" % cfg["token"]})
                data = resp.json()
            except (requests.RequestException, ValueError) as exc:
                _logger.warning("FlexPay injoignable pour %s : %s", pay.reference, exc)
                raise UserError(_("The Mobile Money service cannot be reached right now. Please try again in a few minutes."))
            if str(data.get("code")) != "0" or not data.get("orderNumber"):
                _logger.warning("FlexPay a refusé %s : %s", pay.reference, data)
                pay.write({"state": "failed", "provider_message": str(data.get("message") or "")[:200]})
                raise UserError(_("The payment request was refused: %s", data.get("message") or "?"))
            pay.write({"provider_order": str(data["orderNumber"])[:64]})

    def _liputa_check_flexpay(self):
        """Interroge FlexPay : seule source de vérité (jamais le contenu d'un rappel)."""
        cfg = self._flexpay_config()
        for pay in self.filtered(lambda p: p.state == "pending" and p.provider == "flexpay" and p.provider_order):
            try:
                resp = requests.get(cfg["url"] + "/check/%s" % requests.utils.quote(pay.provider_order, safe=""),
                                    timeout=FLEXPAY_TIMEOUT, headers={"Authorization": "Bearer %s" % cfg["token"]})
                data = resp.json()
            except (requests.RequestException, ValueError) as exc:
                _logger.warning("FlexPay : vérification de %s impossible : %s", pay.reference, exc)
                continue
            tx = data.get("transaction") or {}
            status = str(tx.get("status", ""))
            if str(data.get("code")) == "0" and status == "0":
                try:
                    amount = float(tx.get("amount") or 0)
                except (TypeError, ValueError):
                    amount = 0.0
                if tx.get("reference") not in (None, pay.reference) or amount + 1e-6 < pay.amount or \
                        (tx.get("currency") or pay.currency_id.name) != pay.currency_id.name:
                    _logger.warning("FlexPay : transaction %s non conforme : %s", pay.reference, tx)
                    pay.write({"state": "failed", "provider_message": _("Amount, currency or reference mismatch.")})
                    continue
                pay._liputa_webhook_update("success", pay.provider_order)
            elif status == "1":
                pay.write({"provider_message": str(data.get("message") or "")[:200] or False})
                pay._liputa_webhook_update("failed")

    @api.model
    def _cron_check_flexpay(self):
        """Filet de sécurité : rattrape les rappels perdus (paiements de moins de 48 h), FlexPay et CinetPay.
        Le nom est conservé pour la tâche planifiée des bases déjà installées."""
        since = fields.Datetime.now() - timedelta(hours=48)
        self.sudo().search([("state", "=", "pending"), ("provider", "in", ("flexpay", "cinetpay")),
                            ("provider_order", "!=", False), ("date", ">=", since)], limit=200)._liputa_check_online()

    def action_confirm(self):
        """Manual confirmation (agent/cash) by a platform administrator."""
        if not self.env.su and not self.env.user.has_group("liputa_couture.group_liputa_saas_admin"):
            raise UserError(_("Only platform administrators can confirm a payment manually."))
        for pay in self.filtered(lambda p: p.state == "pending"):
            pay.state = "done"
            pay.subscription_id._register_payment(pay)

    def _liputa_webhook_update(self, status, provider_reference=None):
        """Called by the signed payment webhook. Idempotent."""
        self.ensure_one()
        if self.state != "pending":
            return
        if provider_reference:
            self.provider_reference = provider_reference
        if status == "success":
            self.state = "done"
            self.subscription_id._register_payment(self)
        elif status in ("failed", "cancelled"):
            self.state = "failed"
