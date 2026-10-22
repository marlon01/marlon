# -*- coding: utf-8 -*-
"""Dossier client d'une structure hébergée : essai, abonnement, quotas, suspension.

Une structure = une société Odoo (``res.company``) : les règles d'enregistrement de
``selecta_concours`` cloisonnent déjà toutes ses données. La structure qui héberge la
plateforme n'a pas de dossier client : elle n'est soumise à aucune limite.
"""
import logging
import math
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

STATES = [
    ('trial', "Essai gratuit"), ('active', "Abonné"), ('past_due', "Paiement en retard"),
    ('expired', "Expiré"), ('suspended', "Suspendu"),
]
# Accès effectif : complet, consultation seule (essai ou abonnement échu), bloqué (suspension).
ACCESS_FULL, ACCESS_READONLY, ACCESS_BLOCKED = 'full', 'readonly', 'blocked'
ACTIVE_CONCOURS_STATES = ('ready', 'open')
WRITE_ACTIONS = {'concours.create', 'concours.ready', 'concours.open', 'candidate.create', 'question.create',
                 'staff.create', 'codes.generate'}


def icp_int(env, key, default):
    try:
        return int(env['ir.config_parameter'].sudo().get_param(key, default))
    except (TypeError, ValueError):
        return default


class SelectaSaasTenant(models.Model):
    _name = 'selecta.saas.tenant'
    _description = "Structure cliente SELECTA"
    _order = 'create_date desc, id desc'
    _rec_name = 'name'

    company_id = fields.Many2one('res.company', required=True, ondelete='cascade', index=True)
    name = fields.Char(related='company_id.name', store=True, readonly=False)
    plan_id = fields.Many2one('selecta.saas.plan', string="Catégorie", required=True, ondelete='restrict')
    state = fields.Selection(STATES, required=True, default='trial', index=True)
    billing_cycle = fields.Selection([('monthly', "Mensuel"), ('yearly', "Annuel")], default='monthly', required=True)
    trial_start = fields.Datetime(default=fields.Datetime.now)
    trial_end = fields.Datetime(index=True)
    period_end = fields.Datetime(string="Abonnement payé jusqu'au", index=True)
    owner_id = fields.Many2one('res.users', string="Administrateur principal", ondelete='set null')
    contact_name = fields.Char()
    email = fields.Char()
    phone = fields.Char()
    country_id = fields.Many2one('res.country')
    signup_ip = fields.Char()
    suspended_reason = fields.Char()
    notes = fields.Text(string="Notes internes (plateforme)")
    invoice_ids = fields.One2many('selecta.saas.invoice', 'tenant_id')

    _sql_constraints = [('company_unique', 'unique(company_id)', "Cette structure a déjà un dossier client.")]

    # ------------------------------------------------------------------ cycle de vie
    @api.model_create_multi
    def create(self, vals_list):
        trial_days = icp_int(self.env, 'selecta_saas.trial_days', 14)
        for vals in vals_list:
            start = vals.get('trial_start') or fields.Datetime.now()
            vals.setdefault('trial_start', start)
            vals.setdefault('trial_end', fields.Datetime.to_datetime(start) + timedelta(days=trial_days))
        return super().create(vals_list)

    @api.model
    def _create_space(self, vals, ip=None):
        """Crée la structure, son espace cloisonné, son administrateur et démarre l'essai.

        ``vals`` : organization, contact_name, email, password, phone, plan (enregistrement), country (enregistrement).
        """
        env = self.env(su=True)
        company = env['res.company'].create({
            'name': vals['organization'], 'email': vals['email'], 'phone': vals.get('phone') or False,
            'country_id': vals['country'].id if vals.get('country') else False,
            'currency_id': env.ref('base.USD').id,
        })
        # Numérotation propre à la structure : les références ne révèlent rien de l'activité des autres.
        env['ir.sequence'].create({
            'name': 'Référence concours SELECTA — %s' % company.name, 'code': 'selecta.concours',
            'prefix': 'CNC-%(year)s-', 'padding': 4, 'company_id': company.id, 'implementation': 'no_gap',
        })
        lang = 'fr_FR' if env['res.lang']._lang_get('fr_FR') else False
        user = env['res.users'].with_context(no_reset_password=True).create({
            'lang': lang or env.lang or 'en_US',
            'name': vals['contact_name'], 'login': vals['email'], 'email': vals['email'], 'password': vals['password'],
            'company_id': company.id, 'company_ids': [(6, 0, [company.id])],
            'groups_id': [(6, 0, [env.ref('base.group_user').id, env.ref('selecta_concours.group_selecta_admin').id])],
        })
        user.partner_id.write({'company_id': company.id, 'phone': vals.get('phone') or False})
        company.partner_id.company_id = company
        tenant = env['selecta.saas.tenant'].create({
            'company_id': company.id, 'plan_id': vals['plan'].id, 'owner_id': user.id,
            'contact_name': vals['contact_name'], 'email': vals['email'], 'phone': vals.get('phone') or False,
            'country_id': vals['country'].id if vals.get('country') else False, 'signup_ip': ip,
        })
        env['selecta.audit.log']._log('saas.signup', _("Création de l'espace et début de l'essai gratuit"),
                                      {'plan': vals['plan'].code, 'trial_end': fields.Datetime.to_string(tenant.trial_end)},
                                      company=company, user=user, ip=ip)
        _logger.info("SELECTA SaaS : nouvelle structure %s (#%s), essai jusqu'au %s",
                     company.name, company.id, tenant.trial_end)
        return tenant

    def _grace_end(self):
        self.ensure_one()
        return self.period_end + timedelta(days=icp_int(self.env, 'selecta_saas.grace_days', 3)) if self.period_end else None

    def _effective_state(self, now=None):
        """État calculé à partir des dates : l'accès est juste même si la tâche planifiée a du retard."""
        self.ensure_one()
        now = now or fields.Datetime.now()
        if self.state == 'suspended':
            return 'suspended'
        if self.period_end and now <= self.period_end:
            return 'active'
        if self.period_end and now <= self._grace_end():
            return 'past_due'
        if not self.period_end and self.trial_end and now <= self.trial_end:
            return 'trial'
        return 'expired'

    def _access(self):
        state = self._effective_state()
        if state == 'suspended':
            return ACCESS_BLOCKED
        return ACCESS_READONLY if state == 'expired' else ACCESS_FULL

    def _days_left(self):
        self.ensure_one()
        state = self._effective_state()
        end = {'trial': self.trial_end, 'active': self.period_end, 'past_due': self._grace_end()}.get(state)
        if not end:
            return 0
        return max(0, math.ceil((end - fields.Datetime.now()).total_seconds() / 86400))

    @api.model
    def _cron_lifecycle(self):
        """Aligne l'état enregistré (listes, filtres, statistiques) sur l'état calculé."""
        for tenant in self.sudo().search([('state', '!=', 'suspended')]):
            state = tenant._effective_state()
            if state != tenant.state:
                tenant.state = state
                self.env['selecta.audit.log']._log('saas.state', _("Abonnement : %s", dict(STATES)[state]),
                                                   {'state': state}, company=tenant.company_id)

    def _extend_period(self, cycle):
        """Prolonge l'abonnement d'un cycle à partir de l'échéance en cours (ou de maintenant)."""
        self.ensure_one()
        now = fields.Datetime.now()
        # Les jours d'essai restants et la période déjà payée sont conservés.
        candidates = [now, self.period_end or now]
        if self._effective_state() == 'trial':
            candidates.append(self.trial_end)
        start = max(candidates)
        end = start + (relativedelta(years=1) if cycle == 'yearly' else relativedelta(months=1))
        vals = {'period_end': end, 'billing_cycle': cycle}
        if self.state != 'suspended':
            vals['state'] = 'active'
        self.write(vals)
        return start, end

    # ------------------------------------------------------------------ usage et quotas
    def _month_start(self):
        now = fields.Datetime.now()
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    def _usage(self):
        self.ensure_one()
        company = self.company_id
        Concours = self.env['selecta.concours'].sudo()
        Candidate = self.env['selecta.candidate'].sudo()
        from odoo.addons.selecta_concours.models.selecta_backoffice import ROLE_GROUPS
        group_ids = [self.env.ref(g).id for g in ROLE_GROUPS.values()]
        return {
            'active_concours': Concours.search_count([('company_id', '=', company.id),
                                                      ('state', 'in', ACTIVE_CONCOURS_STATES)]),
            'concours_total': Concours.search_count([('company_id', '=', company.id)]),
            'candidates_month': Candidate.search_count([('company_id', '=', company.id),
                                                        ('create_date', '>=', self._month_start())]),
            'candidates_total': Candidate.search_count([('company_id', '=', company.id)]),
            'staff': self.env['res.users'].sudo().search_count([
                ('company_id', '=', company.id), ('share', '=', False), ('groups_id', 'in', group_ids)]),
        }

    def _limits(self):
        """Limites applicables ; pendant l'essai, le volume de candidats est plafonné."""
        self.ensure_one()
        plan = self.plan_id
        limits = {'active_concours': plan.max_active_concours, 'candidates_month': plan.max_candidates_month,
                  'staff': plan.max_staff, 'trial_candidates': 0}
        if self._effective_state() == 'trial':
            limits['trial_candidates'] = icp_int(self.env, 'selecta_saas.trial_max_candidates', 100)
        return limits

    def _check(self, action, concours=None, count=1):
        """Applique l'abonnement à une opération. Lève une UserError explicite sinon."""
        self.ensure_one()
        access = self._access()
        if access == ACCESS_BLOCKED:
            raise UserError(_("Le compte de « %(org)s » est suspendu. Contactez le support SELECTA.",
                              org=self.company_id.name))
        if access == ACCESS_READONLY and action in WRITE_ACTIONS:
            raise UserError(_("Votre période d'essai ou votre abonnement est arrivé à échéance : la console est en "
                              "consultation seule. Souscrivez un abonnement depuis la page « Abonnement » pour "
                              "reprendre l'organisation de vos concours."))
        if action == 'analysis' and not self.plan_id.feature_ai_analysis:
            raise UserError(_("L'analyse IA n'est pas incluse dans la catégorie « %s ».", self.plan_id.name))
        limits, usage = self._limits(), None
        if action in ('concours.ready', 'concours.open') and limits['active_concours']:
            usage = self._usage()
            others = usage['active_concours'] - (1 if concours and concours.state in ACTIVE_CONCOURS_STATES else 0)
            if others >= limits['active_concours']:
                raise UserError(_("Votre abonnement « %(p)s » permet %(n)s concours actif(s) simultanément. Clôturez un "
                                  "concours ou passez à une catégorie supérieure.", p=self.plan_id.name,
                                  n=limits['active_concours']))
        if action == 'candidate.create':
            usage = usage or self._usage()
            if limits['trial_candidates'] and usage['candidates_total'] + count > limits['trial_candidates']:
                raise UserError(_("La période d'essai est limitée à %s candidats. Souscrivez un abonnement pour "
                                  "inscrire davantage de candidats.", limits['trial_candidates']))
            if limits['candidates_month'] and usage['candidates_month'] + count > limits['candidates_month']:
                raise UserError(_("Quota mensuel atteint : votre abonnement « %(p)s » permet %(n)s candidats par mois "
                                  "(%(u)s déjà inscrits).", p=self.plan_id.name, n=limits['candidates_month'],
                                  u=usage['candidates_month']))
        if action == 'staff.create' and limits['staff']:
            usage = usage or self._usage()
            if usage['staff'] + 1 > limits['staff']:
                raise UserError(_("Votre abonnement « %(p)s » permet %(n)s comptes du personnel.",
                                  p=self.plan_id.name, n=limits['staff']))
        return True

    # ------------------------------------------------------------------ présentation
    def _summary(self):
        self.ensure_one()
        state = self._effective_state()
        return {
            'id': self.id, 'company_id': self.company_id.id, 'name': self.company_id.name,
            'state': state, 'state_label': dict(STATES)[state], 'access': self._access(),
            'plan': self.plan_id._public_dict(), 'billing_cycle': self.billing_cycle,
            'days_left': self._days_left(),
            'trial_start': fields.Datetime.to_string(self.trial_start) if self.trial_start else False,
            'trial_end': fields.Datetime.to_string(self.trial_end) if self.trial_end else False,
            'period_end': fields.Datetime.to_string(self.period_end) if self.period_end else False,
            'grace_end': fields.Datetime.to_string(self._grace_end()) if self.period_end else False,
        }
