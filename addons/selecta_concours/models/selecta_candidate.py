# -*- coding: utf-8 -*-
import hashlib
import hmac
import re
import secrets

from odoo import api, fields, models, _
from odoo.exceptions import UserError

CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # sans 0/O/1/I : aucune confusion visuelle
CODE_GROUPS, CODE_GROUP_LEN = 3, 4                 # 12 caractères ≈ 60 bits d'entropie


def normalize_code(code):
    return re.sub(r'[^A-Z0-9]', '', (code or '').upper())


class SelectaCandidate(models.Model):
    _name = 'selecta.candidate'
    _description = 'Candidat'
    _order = 'concours_id, name'

    concours_id = fields.Many2one('selecta.concours', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='concours_id.company_id', store=True, index=True)
    name = fields.Char(string="Nom complet", required=True)
    reference = fields.Char(string="N° d'inscription", required=True, index=True)
    email = fields.Char()
    phone = fields.Char()
    birthdate = fields.Date()
    id_document = fields.Char(string="Pièce d'identité")
    room = fields.Char(string="Salle / centre")
    code_hash = fields.Char(copy=False, index=True, groups='base.group_system')
    has_code = fields.Boolean(compute='_compute_has_code')
    code_generated_at = fields.Datetime(readonly=True, copy=False)
    state = fields.Selection([
        ('registered', 'Inscrit'), ('in_progress', 'En composition'), ('passed', 'Réussi'),
        ('failed', 'Échoué'), ('disqualified', 'Disqualifié'), ('absent', 'Absent')],
        default='registered', required=True, readonly=True, index=True)
    attempt_ids = fields.One2many('selecta.attempt', 'candidate_id')
    photo_reference = fields.Image(max_width=480, max_height=480, attachment=True, readonly=True,
                                   string="Photo capturée au contrôle d'identité")

    _sql_constraints = [
        ('ref_unique', 'unique(concours_id, reference)', "Ce numéro d'inscription existe déjà pour ce concours."),
    ]

    def _compute_has_code(self):
        for c in self:
            c.has_code = bool(c.sudo().code_hash)

    # ------------------------------------------------------------------ codes
    @api.model
    def _hash_code(self, code):
        secret = self.env['ir.config_parameter'].sudo().get_param('database.secret') or ''
        return hmac.new(secret.encode(), normalize_code(code).encode(), hashlib.sha256).hexdigest()

    @api.model
    def _new_code(self):
        raw = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_GROUPS * CODE_GROUP_LEN))
        return '-'.join(raw[i:i + CODE_GROUP_LEN] for i in range(0, len(raw), CODE_GROUP_LEN))

    def _generate_codes(self):
        """Génère des codes uniques. Le clair n'est retourné qu'une seule fois puis oublié."""
        result = []
        Cand = self.sudo()
        for cand in self.sudo():
            if cand.concours_id.state not in ('draft', 'ready', 'open'):
                raise UserError(_("Impossible de générer des codes pour un concours clôturé."))
            if cand.state != 'registered':
                raise UserError(_("Le candidat %s a déjà composé : son code ne peut être régénéré.", cand.name))
            for _attempt in range(20):
                code = self._new_code()
                digest = self._hash_code(code)
                if not Cand.search_count([('code_hash', '=', digest)]):
                    break
            else:  # pragma: no cover - probabilité négligeable
                raise UserError(_("Collision de codes, veuillez réessayer."))
            cand.write({'code_hash': digest, 'code_generated_at': fields.Datetime.now()})
            result.append({'id': cand.id, 'name': cand.name, 'reference': cand.reference,
                           'room': cand.room or '', 'code': code})
        if self:
            self.env['selecta.audit.log']._log(
                'codes.generate', _("Génération de %s code(s) d'accès", len(result)),
                {'candidates': [r['reference'] for r in result]}, concours=self[0].concours_id)
        return result

    @api.model
    def _find_by_code(self, code):
        if len(normalize_code(code)) != CODE_GROUPS * CODE_GROUP_LEN:
            return self.browse()
        return self.sudo().search([('code_hash', '=', self._hash_code(code))], limit=1)

    def _demo_set_codes(self):
        """Données de démonstration uniquement : codes connus DEMO-xxxx."""
        for cand in self.sudo().search([('reference', '=like', 'DEMO-%')], order='reference'):
            code = 'DEMO-2026-%04d' % int(cand.reference.split('-')[-1])
            cand.write({'code_hash': self._hash_code(code), 'code_generated_at': fields.Datetime.now()})
