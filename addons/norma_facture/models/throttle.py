# -*- coding: utf-8 -*-
"""Limitation des tentatives (connexion, inscription, vérification publique), persistée en base."""
from datetime import timedelta

from odoo import api, fields, models


class NormaThrottle(models.Model):
    _name = 'norma.throttle'
    _description = 'Limitation des tentatives'

    key = fields.Char(required=True, index=True)
    failures = fields.Integer(default=0)
    last_failure = fields.Datetime()
    locked_until = fields.Datetime()

    _sql_constraints = [('key_unique', 'unique(key)', 'Clé unique')]

    @api.private
    @api.model
    def is_locked(self, key):
        rec = self.sudo().search([('key', '=', key)], limit=1)
        now = fields.Datetime.now()
        if rec and rec.locked_until and rec.locked_until > now:
            return int((rec.locked_until - now).total_seconds() // 60) + 1
        return 0

    @api.private
    @api.model
    def hit(self, key, max_failures=8, minutes=15):
        """Enregistre un échec ; retourne le nombre d'essais restants (0 : verrouillé)."""
        now = fields.Datetime.now()
        rec = self.sudo().search([('key', '=', key)], limit=1) or self.sudo().create({'key': key})
        recent = rec.last_failure and rec.last_failure > now - timedelta(minutes=minutes)
        failures = rec.failures + 1 if recent else 1
        vals = {'failures': failures, 'last_failure': now}
        if failures >= max_failures:
            vals.update(locked_until=now + timedelta(minutes=minutes), failures=0)
        rec.write(vals)
        return max(0, max_failures - failures) if failures < max_failures else 0

    @api.private
    @api.model
    def reset(self, key):
        self.sudo().search([('key', '=', key)]).unlink()

    @api.private
    @api.model
    def _cron_cleanup(self):
        self.sudo().search([('last_failure', '<', fields.Datetime.now() - timedelta(days=2))]).unlink()
