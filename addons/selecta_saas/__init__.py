# -*- coding: utf-8 -*-
from . import models
from . import controllers


def _selecta_saas_post_init(env):
    """Interface en français pour l'administration centrale lorsque la langue est chargée."""
    if env['res.lang']._lang_get('fr_FR'):
        env.ref('base.user_admin').lang = 'fr_FR'
