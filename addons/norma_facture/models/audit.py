# -*- coding: utf-8 -*-
"""Journal d'audit chaîné par entreprise : chaque entrée scelle la précédente (SHA-256)."""
import hashlib
import json

from odoo import api, fields, models, _
from odoo.exceptions import AccessError


class NormaAudit(models.Model):
    _name = 'norma.audit'
    _description = "Journal d'audit"
    _order = 'sequence desc'

    company_id = fields.Many2one('res.company', required=True, index=True, readonly=True)
    sequence = fields.Integer(readonly=True, index=True)
    event = fields.Char(readonly=True, required=True)
    message = fields.Char(readonly=True)
    payload = fields.Text(readonly=True)
    user_id = fields.Many2one('res.users', readonly=True)
    invoice_id = fields.Many2one('norma.invoice', readonly=True, index=True, ondelete='restrict')
    ip = fields.Char(readonly=True)
    prev_hash = fields.Char(readonly=True)
    hash = fields.Char(readonly=True)

    _sql_constraints = [('seq_unique', 'unique(company_id, sequence)', "Séquence d'audit dupliquée.")]

    def write(self, vals):
        raise AccessError(_("Le journal d'audit est en ajout seul."))

    def unlink(self):
        raise AccessError(_("Le journal d'audit est en ajout seul."))

    @staticmethod
    def _digest(prev, seq, event, message, payload, user_id, ts):
        raw = '|'.join([prev, str(seq), event, message or '', payload or '', str(user_id or 0), ts])
        return hashlib.sha256(raw.encode()).hexdigest()

    @api.model
    def _log(self, company, event, message, payload=None, invoice=None, user=None, ip=None):
        if not company:
            return self.browse()
        user = user or self.env.user
        if ip is None:
            try:
                from odoo.http import request
                ip = request.httprequest.remote_addr if request else None
            except Exception:
                ip = None
        cr = self.env.cr
        # Verrou par entreprise : deux écritures simultanées ne peuvent pas prendre la même place.
        cr.execute('SELECT pg_advisory_xact_lock(%s, %s)', (7070, company.id))
        cr.execute('SELECT sequence, hash FROM norma_audit WHERE company_id = %s ORDER BY sequence DESC LIMIT 1',
                   (company.id,))
        row = cr.fetchone()
        seq, prev = (row[0] + 1, row[1]) if row else (1, '0' * 64)
        payload_s = json.dumps(payload or {}, sort_keys=True, default=str)
        now = fields.Datetime.now()
        ts = fields.Datetime.to_string(now)
        rec = super(NormaAudit, self.sudo()).create({
            'company_id': company.id, 'sequence': seq, 'event': event, 'message': (message or '')[:250],
            'payload': payload_s, 'user_id': user.id, 'invoice_id': invoice.id if invoice else False, 'ip': ip,
            'prev_hash': prev,
            'hash': self._digest(prev, seq, event, (message or '')[:250], payload_s, user.id, ts),
        })
        # La date de création sert au calcul : on la fige à la valeur scellée.
        cr.execute('UPDATE norma_audit SET create_date = %s WHERE id = %s', (now, rec.id))
        rec.invalidate_recordset(['create_date'])
        return rec

    @api.model
    def _verify(self, company):
        self.env.cr.execute("""SELECT sequence, event, message, payload, user_id, create_date, prev_hash, hash
                               FROM norma_audit WHERE company_id = %s ORDER BY sequence""", (company.id,))
        prev, expected, broken = '0' * 64, 1, None
        rows = self.env.cr.fetchall()
        for seq, event, message, payload, user_id, cdate, prev_hash, h in rows:
            ts = fields.Datetime.to_string(cdate)
            if seq != expected or prev_hash != prev or self._digest(prev, seq, event, message, payload, user_id, ts) != h:
                broken = seq
                break
            prev, expected = h, expected + 1
        return {'count': len(rows), 'ok': broken is None, 'broken_at': broken}
