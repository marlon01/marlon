# -*- coding: utf-8 -*-
"""Régressions de sécurité : un client RPC contrôle le contexte et peut appeler l'ORM générique."""
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import SaasCommon


@tagged('post_install', '-at_install', 'selecta_saas')
class TestSelectaSaasSecurity(SaasCommon):

    def _question(self, user, name='Capitale de la RDC ?'):
        bo = self.bo(user)
        return bo.question_save({'name': name, 'qtype': 'single', 'points': 1, 'choices': [
            {'name': 'Kinshasa', 'is_correct': True}, {'name': 'Lubumbashi', 'is_correct': False}]})

    def test_choices_and_answers_are_company_scoped(self):
        qb = self._question(self.user_b)
        Choice_a = self.as_user(self.user_a, 'selecta.choice')
        self.assertFalse(Choice_a.search([('question_id', '=', qb['id'])]))
        with self.assertRaises(AccessError):
            Choice_a.browse(qb['choices'][0]['id']).read(['name'])
        self.assertFalse(self.as_user(self.user_a, 'selecta.attempt.answer').search([]))

    def test_engine_context_flag_from_client_is_ignored(self):
        ca = self._concours(self.user_a)
        Concours = self.as_user(self.user_a, 'selecta.concours').with_context(selecta_engine=True)
        with self.assertRaises(AccessError):
            Concours.browse(ca.id).write({'state': 'open'})
        with self.assertRaises(AccessError):
            Concours.browse(ca.id).write({'results_hash': 'f' * 64})
        with self.assertRaises(AccessError):
            Concours.create({'name': 'Forcé', 'state': 'published'})
        Attempt = self.as_user(self.user_a, 'selecta.attempt').with_context(selecta_engine=True)
        with self.assertRaises(AccessError):
            Attempt.create({'concours_id': ca.id})

    def test_records_cannot_be_moved_to_another_company(self):
        ca = self._concours(self.user_a)
        qa = self._question(self.user_a)
        other = self.tenant_b.company_id.id
        with self.assertRaises(AccessError):
            self.as_user(self.user_a, 'selecta.concours').browse(ca.id).write({'company_id': other})
        with self.assertRaises(AccessError):
            self.as_user(self.user_a, 'selecta.question').browse(qa['id']).write({'company_id': other})

    def test_candidate_engine_fields_locked(self):
        ca = self._concours(self.user_a)
        cand = self.bo(self.user_a).candidate_save({'concours_id': ca.id, 'name': 'Awa', 'reference': 'R-1'})
        Cand = self.as_user(self.user_a, 'selecta.candidate')
        with self.assertRaises(AccessError):
            Cand.browse(cand['id']).write({'state': 'passed'})
        cb = self._concours(self.user_b)
        with self.assertRaises(Exception) as ctx:
            Cand.create({'concours_id': cb.id, 'name': 'Intrus', 'reference': 'X-1'})
        self.assertIsInstance(ctx.exception, (AccessError, UserError))

    def test_company_rename_must_be_unique(self):
        with self.assertRaises(UserError):
            self.bo(self.user_a).settings_save({'company_name': 'banque beta'})
