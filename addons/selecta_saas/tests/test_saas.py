# -*- coding: utf-8 -*-
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'selecta_saas')
class TestSelectaSaas(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Tenant = cls.env['selecta.saas.tenant']
        cls.plan_pme = cls.env.ref('selecta_saas.plan_pme')
        cls.plan_ecole = cls.env.ref('selecta_saas.plan_ecole')
        cls.tenant_a = cls._signup('Lycée Alpha', 'alpha@test.cd', cls.plan_pme)
        cls.tenant_b = cls._signup('Banque Beta', 'beta@test.cd', cls.plan_ecole)
        cls.user_a = cls.tenant_a.owner_id
        cls.user_b = cls.tenant_b.owner_id

    @classmethod
    def _signup(cls, org, email, plan):
        return cls.Tenant._create_space({
            'organization': org, 'contact_name': 'Contact %s' % org, 'email': email,
            'password': 'Motdepasse123', 'phone': '+243800000000', 'plan': plan,
            'country': cls.env.ref('base.cd'),
        }, ip='10.0.0.1')

    def as_user(self, user, model):
        return self.env[model].with_user(user).with_company(user.company_id)

    def bo(self, user):
        return self.as_user(user, 'selecta.backoffice')

    def _concours(self, user, name='Concours test'):
        return self.as_user(user, 'selecta.concours').create({'name': name})

    # ------------------------------------------------------------------ inscription
    def test_signup_creates_isolated_space_with_trial(self):
        t = self.tenant_a
        self.assertEqual(t.state, 'trial')
        self.assertEqual(t._access(), 'full')
        self.assertAlmostEqual((t.trial_end - t.trial_start).total_seconds(), 14 * 86400, delta=5)
        self.assertEqual(self.user_a.company_ids, t.company_id)
        self.assertEqual(self.user_a.partner_id.company_id, t.company_id)
        self.assertTrue(self.user_a.has_group('selecta_concours.group_selecta_admin'))
        self.assertFalse(self.user_a.has_group('base.group_system'))
        self.assertFalse(self.user_a.has_group('selecta_saas.group_platform_admin'))
        self.assertTrue(self.user_a._selecta_is_staff())

    def test_references_are_numbered_per_company(self):
        ca = self._concours(self.user_a)
        cb = self._concours(self.user_b)
        self.assertEqual(ca.reference, cb.reference, "chaque structure a sa propre séquence")

    # ------------------------------------------------------------------ cloisonnement
    def test_tenant_cannot_read_other_tenant_data(self):
        cb = self._concours(self.user_b, 'Secret B')
        Concours_a = self.as_user(self.user_a, 'selecta.concours')
        self.assertFalse(Concours_a.search([('id', '=', cb.id)]))
        with self.assertRaises(AccessError):
            Concours_a.browse(cb.id).read(['name'])
        self.assertNotIn(cb.id, [c['id'] for c in self.bo(self.user_a).concours_list()])

    def test_cannot_link_other_tenant_questions(self):
        qb = self.as_user(self.user_b, 'selecta.question').create({'name': 'Question privée de B ?'})
        ca = self._concours(self.user_a)
        with self.assertRaises(UserError):
            self.bo(self.user_a).concours_save({'id': ca.id, 'question_ids': [qb.id]})

    def test_staff_management_is_scoped(self):
        staff_a = self.bo(self.user_a).staff_list()['users']
        self.assertEqual({u['id'] for u in staff_a}, {self.user_a.id})
        with self.assertRaises(AccessError):
            self.bo(self.user_a).staff_save({'id': self.user_b.id, 'role': 'surveillant', 'password': 'Piratage12345'})
        with self.assertRaises(AccessError):
            self.bo(self.user_a).staff_toggle(self.user_b.id)

    def test_audit_chains_are_per_company(self):
        Log = self.env['selecta.audit.log']
        self._concours(self.user_a)
        self._concours(self.user_b)
        for t in (self.tenant_a, self.tenant_b):
            res = Log.verify_chain(t.company_id.id)
            self.assertTrue(res['ok'], res)
        logs_a = self.as_user(self.user_a, 'selecta.audit.log').search([])
        self.assertTrue(logs_a)
        self.assertEqual(logs_a.company_id, self.tenant_a.company_id)
        self.assertEqual(self.bo(self.user_a).audit_list()['total'], len(logs_a))

    def test_tenant_cannot_change_server_settings(self):
        icp = self.env['ir.config_parameter'].sudo()
        before = icp.get_param('selecta.llm_endpoint')
        self.bo(self.user_a).settings_save({'company_name': 'Lycée Alpha', 'llm_endpoint': 'http://169.254.169.254/'})
        self.assertEqual(icp.get_param('selecta.llm_endpoint'), before)
        self.assertNotIn('llm_endpoint', self.bo(self.user_a).settings_get())

    def test_platform_api_is_reserved(self):
        with self.assertRaises(AccessError):
            self.as_user(self.user_a, 'selecta.saas.platform').overview()
        admin = self.env.ref('base.user_admin')
        data = self.env['selecta.saas.platform'].with_user(admin).overview()
        self.assertGreaterEqual(data['kpi']['tenants'], 2)

    # ------------------------------------------------------------------ essai, échéance, quotas
    def test_expired_trial_is_read_only(self):
        ca = self._concours(self.user_a)
        self.tenant_a.trial_end = fields.Datetime.now() - timedelta(minutes=1)
        self.assertEqual(self.tenant_a._effective_state(), 'expired')
        with self.assertRaises(UserError):
            self._concours(self.user_a, 'Interdit')
        with self.assertRaises(UserError):
            self.bo(self.user_a).candidate_save({'concours_id': ca.id, 'name': 'X', 'reference': 'R1'})
        # La consultation reste possible.
        self.assertTrue(self.bo(self.user_a).concours_get(ca.id))
        self.Tenant._cron_lifecycle()
        self.assertEqual(self.tenant_a.state, 'expired')

    def test_hosting_company_is_unrestricted(self):
        admin = self.env.ref('base.user_admin')
        self.assertFalse(admin.company_id._selecta_tenant())
        self.as_user(admin, 'selecta.concours').create({'name': 'Concours de la plateforme'})

    def test_trial_candidate_cap_and_monthly_quota(self):
        icp = self.env['ir.config_parameter'].sudo()
        icp.set_param('selecta_saas.trial_max_candidates', 2)
        ca = self._concours(self.user_a)
        bo = self.bo(self.user_a)
        bo.candidate_save({'concours_id': ca.id, 'name': 'Un', 'reference': 'C1'})
        bo.candidate_save({'concours_id': ca.id, 'name': 'Deux', 'reference': 'C2'})
        with self.assertRaises(UserError):
            bo.candidate_save({'concours_id': ca.id, 'name': 'Trois', 'reference': 'C3'})
        # Abonné : le plafond d'essai ne s'applique plus, le quota mensuel de la catégorie oui.
        self.tenant_a.period_end = fields.Datetime.now() + timedelta(days=30)
        self.plan_pme.max_candidates_month = 3
        bo.candidate_save({'concours_id': ca.id, 'name': 'Trois', 'reference': 'C3'})
        with self.assertRaises(UserError):
            bo.candidate_save({'concours_id': ca.id, 'name': 'Quatre', 'reference': 'C4'})

    def test_staff_quota(self):
        self.plan_pme.max_staff = 1
        with self.assertRaises(UserError):
            self.bo(self.user_a).staff_save({'login': 'jury@alpha.cd', 'name': 'Jury', 'role': 'jury',
                                             'password': 'Motdepasse123'})

    def test_features_follow_plan(self):
        self.assertFalse(self.tenant_b.company_id._selecta_feature('branding'))
        self.assertTrue(self.tenant_a.company_id._selecta_feature('branding'))
        self.bo(self.user_b).settings_save({'company_name': 'Banque Beta', 'brand_color': '#FF0000'})
        self.assertNotEqual(self.tenant_b.company_id.selecta_brand_color, '#FF0000')

    def test_suspension_blocks_everything(self):
        admin = self.env.ref('base.user_admin')
        Platform = self.env['selecta.saas.platform'].with_user(admin)
        Platform.tenant_action(self.tenant_a.id, 'suspend', {'reason': 'Impayés répétés'})
        self.assertEqual(self.tenant_a._access(), 'blocked')
        with self.assertRaises(UserError):
            self.tenant_a.company_id._selecta_guard('exam.login')
        Platform.tenant_action(self.tenant_a.id, 'reactivate')
        self.assertEqual(self.tenant_a._effective_state(), 'trial')

    # ------------------------------------------------------------------ facturation
    def test_payment_flow_keeps_remaining_trial_days(self):
        bo = self.bo(self.user_a)
        grande = self.env.ref('selecta_saas.plan_grande')
        inv = bo.billing_checkout(grande.id, 'yearly')
        self.assertEqual(inv['state'], 'open')
        self.assertEqual(inv['amount'], grande.price_yearly)
        png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        info = bo.billing_declare(inv['id'], 'mobile_money', 'MP240101.1234.A12345', '+243811111111', png, 'recu.png')
        self.assertEqual(info['invoices'][0]['state'], 'pending')
        with self.assertRaises(UserError):
            bo.billing_checkout(grande.id, 'monthly')  # un paiement est déjà en attente
        admin = self.env.ref('base.user_admin')
        self.env['selecta.saas.platform'].with_user(admin).invoice_action(inv['id'], 'validate')
        t = self.tenant_a
        self.assertEqual(t._effective_state(), 'active')
        self.assertEqual(t.plan_id, grande)
        self.assertEqual(t.billing_cycle, 'yearly')
        expected = t.trial_end + timedelta(days=365)
        self.assertLess(abs((t.period_end - expected).total_seconds()), 86400 + 5)

    def test_declaration_rules(self):
        bo = self.bo(self.user_a)
        inv = bo.billing_checkout(self.plan_pme.id, 'monthly')
        with self.assertRaises(UserError):
            bo.billing_declare(inv['id'], 'mobile_money', '   ')
        with self.assertRaises(UserError):
            bo.billing_declare(inv['id'], 'mobile_money', 'REF1', '', 'data:text/html;base64,PGgxPng8L2gxPg==', 'x.html')
        # Une structure ne peut pas agir sur la facture d'une autre.
        with self.assertRaises(UserError):
            self.bo(self.user_b).billing_declare(inv['id'], 'mobile_money', 'REF1')
        bo.billing_declare(inv['id'], 'bank_transfer', 'VIR-2026-001')
        admin = self.env.ref('base.user_admin')
        Platform = self.env['selecta.saas.platform'].with_user(admin)
        with self.assertRaises(UserError):
            Platform.invoice_action(inv['id'], 'reject', '')
        res = Platform.invoice_action(inv['id'], 'reject', 'Référence introuvable sur le relevé')
        self.assertEqual(res['state'], 'rejected')
        self.assertEqual(self.tenant_a._effective_state(), 'trial')

    def test_grace_period_then_read_only(self):
        t = self.tenant_a
        t.period_end = fields.Datetime.now() - timedelta(days=1)
        self.assertEqual(t._effective_state(), 'past_due')
        self.assertEqual(t._access(), 'full')
        t.period_end = fields.Datetime.now() - timedelta(days=10)
        self.assertEqual(t._access(), 'readonly')
