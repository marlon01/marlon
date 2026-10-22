# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import AccessError

from .selecta_attempt import EVENT_LABELS
from .selecta_concours import is_engine


class SelectaProctorEvent(models.Model):
    _name = 'selecta.proctor.event'
    _description = 'Événement de surveillance IA'
    _order = 'date desc, id desc'

    attempt_id = fields.Many2one('selecta.attempt', required=True, ondelete='cascade', index=True)
    candidate_id = fields.Many2one(related='attempt_id.candidate_id', store=True, index=True)
    concours_id = fields.Many2one(related='attempt_id.concours_id', store=True, index=True)
    company_id = fields.Many2one(related='attempt_id.company_id', store=True)
    date = fields.Datetime(default=fields.Datetime.now, index=True)
    client_ts = fields.Char()
    event_type = fields.Selection(list(EVENT_LABELS.items()), required=True, index=True)
    severity = fields.Selection([('info', 'Information'), ('warning', 'Avertissement'), ('critical', 'Critique')],
                                default='info', index=True)
    description = fields.Char()
    snapshot = fields.Image(max_width=640, max_height=480, attachment=True, string="Cliché probatoire")
    action_taken = fields.Selection([('none', 'Aucune'), ('warning', 'Avertissement'),
                                     ('disqualified', 'Disqualification')], default='none')

    def write(self, vals):
        raise AccessError(_("Les preuves de surveillance sont immuables."))

    def unlink(self):
        if not is_engine(self.env):
            raise AccessError(_("Les preuves de surveillance ne peuvent être supprimées."))
        return super().unlink()
