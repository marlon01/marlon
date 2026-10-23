# -*- coding: utf-8 -*-
"""Arrivée des abonnements : les entreprises déjà inscrites reçoivent un essai complet à partir de la mise à jour."""


def migrate(cr, version):
    cr.execute("""
        UPDATE res_company
           SET norma_trial_end = now() AT TIME ZONE 'UTC' + (
                   COALESCE((SELECT value FROM ir_config_parameter WHERE key = 'norma.trial_days'), '14') || ' days')::interval
         WHERE norma_enabled AND norma_trial_end IS NULL AND norma_period_end IS NULL
    """)
