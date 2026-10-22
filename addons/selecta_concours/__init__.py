# -*- coding: utf-8 -*-
from . import models
from . import controllers


def _selecta_post_init(env):
    """Initialise le maillon zéro du journal d'audit et les paramètres par défaut."""
    params = env['ir.config_parameter'].sudo()
    defaults = {
        'selecta.llm_enabled': 'False',
        'selecta.llm_endpoint': 'http://127.0.0.1:11434/v1/chat/completions',
        'selecta.llm_model': 'llama3.1:8b',
        'selecta.login_max_failures': '8',
        'selecta.login_lock_minutes': '15',
    }
    for key, value in defaults.items():
        if not params.get_param(key):
            params.set_param(key, value)
    env['selecta.audit.log'].sudo()._log('system.install', "Installation de SELECTA", {})
