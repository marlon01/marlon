# -*- coding: utf-8 -*-
"""Protection anti force brute sur les codes d'accès et la connexion du personnel."""
from datetime import timedelta

from odoo import api, fields, models


class SelectaLoginThrottle(models.Model):
    _name = 'selecta.login.throttle'
    _description = 'Limitation des tentatives de connexion'

    key = fields.Char(required=True, index=True)
    failures = fields.Integer(default=0)
    last_failure = fields.Datetime()
    locked_until = fields.Datetime()

    _sql_constraints = [('key_unique', 'unique(key)', 'Clé unique')]

    def _params(self):
        icp = self.env['ir.config_parameter'].sudo()
        return int(icp.get_param('selecta.login_max_failures', 8)), int(icp.get_param('selecta.login_lock_minutes', 15))

    @api.model
    def is_locked(self, key):
        rec = self.sudo().search([('key', '=', key)], limit=1)
        if rec and rec.locked_until and rec.locked_until > fields.Datetime.now():
            return int((rec.locked_until - fields.Datetime.now()).total_seconds() // 60) + 1
        return 0

    @api.model
    def register_failure(self, key):
        max_f, lock_min = self._params()
        now = fields.Datetime.now()
        rec = self.sudo().search([('key', '=', key)], limit=1)
        if not rec:
            rec = self.sudo().create({'key': key})
        failures = rec.failures + 1 if rec.last_failure and rec.last_failure > now - timedelta(minutes=lock_min) else 1
        vals = {'failures': failures, 'last_failure': now}
        if failures >= max_f:
            vals.update(locked_until=now + timedelta(minutes=lock_min), failures=0)
        rec.write(vals)
        return max(0, max_f - failures) if failures < max_f else 0

    @api.model
    def reset(self, key):
        self.sudo().search([('key', '=', key)]).unlink()

    @api.model
    def _cron_cleanup(self):
        self.sudo().search([('last_failure', '<', fields.Datetime.now() - timedelta(days=1))]).unlink()
