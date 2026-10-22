# -*- coding: utf-8 -*-
from odoo.tests import TransactionCase


class SaasCommon(TransactionCase):
    """Deux structures clientes inscrites, chacune avec son administrateur."""

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

