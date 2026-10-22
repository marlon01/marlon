# -*- coding: utf-8 -*-
"""Journal d'audit infalsifiable (chaîne de hachage SHA-256).

Une chaîne indépendante par structure (société) : chaque organisation vérifie son propre
journal sans jamais voir celui des autres. Chaque entrée contient l'empreinte de l'entrée précédente : toute modification,
suppression ou insertion frauduleuse directement en base casse la chaîne et est
détectée par ``verify_chain``. Aucune écriture / suppression n'est autorisée via l'ORM.
"""
import hashlib
import json

from odoo import api, fields, models, _
from odoo.exceptions import AccessError

GENESIS = '0' * 64
_LOCK_KEY = 74_610_221  # verrou consultatif PostgreSQL dédié au journal


class SelectaAuditLog(models.Model):
    _name = 'selecta.audit.log'
    _description = "Journal d'audit SELECTA (chaîné)"
    _order = 'sequence desc'
    _rec_name = 'event'

    company_id = fields.Many2one('res.company', readonly=True, index=True, ondelete='restrict')
    sequence = fields.Integer(readonly=True, index=True)
    date = fields.Datetime(readonly=True, default=fields.Datetime.now)
    user_id = fields.Many2one('res.users', readonly=True, ondelete='set null')
    user_label = fields.Char(readonly=True)
    event = fields.Char(readonly=True, index=True)
    message = fields.Char(readonly=True)
    concours_id = fields.Many2one('selecta.concours', readonly=True, ondelete='set null', index=True)
    payload = fields.Text(readonly=True)
    ip_address = fields.Char(readonly=True)
    prev_hash = fields.Char(readonly=True)
    hash = fields.Char(readonly=True, index=True)

    # ------------------------------------------------------------------
    @staticmethod
    def _compute_digest(prev_hash, sequence, date, user_label, event, message, concours_id, payload):
        material = '|'.join([
            prev_hash or GENESIS, str(sequence), date, user_label or '', event or '',
            message or '', str(concours_id or 0), payload or '',
        ])
        return hashlib.sha256(material.encode('utf-8')).hexdigest()

    @api.model
    def _chain_company(self, concours=None, user=None, company=None):
        """Structure propriétaire de l'entrée : celle du concours, sinon celle de l'acteur."""
        if company:
            return company
        if concours:
            return concours.sudo().company_id
        if user and not user._is_public():
            return user.company_id
        return self.env.company

    @api.model
    def _last_link(self, company_id):
        self.env.cr.execute('SELECT sequence, hash FROM selecta_audit_log WHERE company_id = %s '
                            'ORDER BY sequence DESC LIMIT 1', (company_id,))
        return self.env.cr.fetchone()

    @api.model
    def _log(self, event, message, payload=None, concours=None, ip=None, user=None, company=None):
        """Ajoute une entrée chaînée. Sérialisé par structure (verrou consultatif transactionnel)."""
        user = user or self.env.user
        company = self._chain_company(concours, user, company)
        self.env.cr.execute('SELECT pg_advisory_xact_lock(%s, %s)', (_LOCK_KEY, company.id))
        row = self._last_link(company.id)
        prev_seq, prev_hash = (row[0], row[1]) if row else (0, GENESIS)
        user_label = user and '%s (#%s)' % (user.login, user.id) or 'public'
        if user and user._is_public():
            user_label = 'candidat/public'
        now = fields.Datetime.now()
        date_str = fields.Datetime.to_string(now)
        payload_str = json.dumps(payload or {}, sort_keys=True, ensure_ascii=False, default=str)
        seq = prev_seq + 1
        concours_id = concours.id if concours else False
        digest = self._compute_digest(prev_hash, seq, date_str, user_label, event, message,
                                      concours_id, payload_str)
        vals = {
            'company_id': company.id, 'sequence': seq, 'date': now, 'user_id': user.id if user and not user._is_public() else False,
            'user_label': user_label, 'event': event, 'message': message,
            'concours_id': concours_id, 'payload': payload_str, 'ip_address': ip,
            'prev_hash': prev_hash, 'hash': digest,
        }
        return self.sudo().with_context(selecta_audit_write=True).create([vals])

    @api.model
    def verify_chain(self, company_id=None):
        """Recalcule la chaîne d'une structure. Retourne un diagnostic exploitable par l'interface."""
        company_id = company_id or self.env.company.id
        self.env.cr.execute("""
            SELECT id, sequence, date, user_label, event, message, concours_id, payload, prev_hash, hash
              FROM selecta_audit_log WHERE company_id = %s ORDER BY sequence ASC""", (company_id,))
        prev_hash, expected_seq, count = GENESIS, 1, 0
        for (rid, seq, date, user_label, event, message, concours_id, payload, p_hash, h) in self.env.cr.fetchall():
            count += 1
            date_str = fields.Datetime.to_string(date)
            if seq != expected_seq:
                return {'ok': False, 'count': count, 'broken_at': seq,
                        'reason': _("Rupture de séquence : entrée %(exp)s manquante ou insérée.", exp=expected_seq)}
            if p_hash != prev_hash:
                return {'ok': False, 'count': count, 'broken_at': seq,
                        'reason': _("Le maillon %(s)s ne pointe pas sur l'entrée précédente.", s=seq)}
            digest = self._compute_digest(prev_hash, seq, date_str, user_label, event, message, concours_id, payload)
            if digest != h:
                return {'ok': False, 'count': count, 'broken_at': seq,
                        'reason': _("Contenu altéré à l'entrée %(s)s (empreinte invalide).", s=seq)}
            prev_hash, expected_seq = h, seq + 1
        return {'ok': True, 'count': count, 'head': prev_hash}

    @api.model
    def head_hash(self, company_id=None):
        row = self._last_link(company_id or self.env.company.id)
        return row[1] if row else GENESIS

    # ------------------------------------------------------------------ verrous
    @api.model_create_multi
    def create(self, vals_list):
        if not (self.env.su and self.env.context.get('selecta_audit_write')):
            raise AccessError(_("Le journal d'audit ne peut être alimenté que par le moteur SELECTA."))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(_("Le journal d'audit est immuable."))

    def unlink(self):
        raise AccessError(_("Le journal d'audit est immuable : aucune suppression possible."))
