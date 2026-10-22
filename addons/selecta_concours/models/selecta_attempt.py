# -*- coding: utf-8 -*-
"""Moteur d'épreuve SELECTA.

Principes de sécurité :
* le serveur est la seule autorité (temps, page courante, correction) ;
* la clé de correction ne quitte jamais le serveur ;
* toute écriture hors moteur est refusée (anti-corruption) ;
* chaque événement significatif est scellé dans le journal d'audit chaîné.
"""
import base64
import hashlib
import json
import math
import random
import secrets
from datetime import timedelta, timezone

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

from .selecta_concours import is_engine, require_group, G_ADMIN, G_PROCTOR

CRITICAL_EVENTS = {'multiple_faces', 'identity_mismatch', 'camera_lost', 'devtools'}
WARNING_EVENTS = {'face_absent', 'look_away', 'tab_hidden', 'fullscreen_exit', 'window_blur',
                  'copy_paste', 'shortcut', 'heartbeat_missing'}
LEVEL_MAX_WARNINGS = {'tolerant': 5, 'standard': 2, 'zero': 0}
EVENT_LABELS = {
    'face_absent': "Visage absent du champ de la caméra",
    'multiple_faces': "Plusieurs personnes détectées",
    'look_away': "Regard détourné de l'écran de façon prolongée",
    'identity_mismatch': "Visage différent du candidat identifié",
    'camera_lost': "Caméra coupée, masquée ou débranchée",
    'tab_hidden': "Sortie de la fenêtre d'examen (onglet / application)",
    'window_blur': "Perte de focus de la fenêtre d'examen",
    'fullscreen_exit': "Sortie du mode plein écran",
    'copy_paste': "Tentative de copier / coller",
    'shortcut': "Raccourci clavier interdit",
    'devtools': "Tentative d'ouverture des outils développeur",
    'heartbeat_missing': "Perte du signal de surveillance",
    'manual': "Décision d'un surveillant",
    'info': "Information",
}
IDENTITY_DISTANCE = 0.6  # seuil euclidien standard des descripteurs faciaux 128D


def to_ms(dt):
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000) if dt else None


class SelectaAttempt(models.Model):
    _name = 'selecta.attempt'
    _description = 'Épreuve (tentative) d\'un candidat'
    _order = 'id desc'
    _rec_name = 'candidate_id'

    candidate_id = fields.Many2one('selecta.candidate', required=True, ondelete='cascade', index=True)
    concours_id = fields.Many2one('selecta.concours', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='concours_id.company_id', store=True, index=True)
    state = fields.Selection([
        ('ready', 'Connecté (contrôles)'), ('in_progress', 'En composition'), ('submitted', 'Terminé'),
        ('expired', 'Temps écoulé'), ('disqualified', 'Disqualifié'), ('absent', 'Absent')],
        default='ready', required=True, index=True)
    token_hash = fields.Char(index=True, groups='base.group_system')
    allow_resume = fields.Boolean()
    login_count = fields.Integer(default=0)
    last_seen = fields.Datetime()
    ip_address = fields.Char()
    user_agent = fields.Char()
    start_date = fields.Datetime()
    deadline = fields.Datetime(index=True)
    end_date = fields.Datetime()
    duration_seconds = fields.Integer()
    finish_reason = fields.Char()
    question_order = fields.Json(groups='base.group_system')
    choice_order = fields.Json(groups='base.group_system')
    current_page = fields.Integer(default=0)
    total_pages = fields.Integer(default=1)
    page_times = fields.Json()
    answer_ids = fields.One2many('selecta.attempt.answer', 'attempt_id')
    event_ids = fields.One2many('selecta.proctor.event', 'attempt_id')
    score = fields.Float(digits=(16, 2))
    max_score = fields.Float(digits=(16, 2))
    percentage = fields.Float(digits=(16, 2))
    passed = fields.Boolean(index=True)
    admitted = fields.Boolean(index=True)
    rank = fields.Integer()
    warnings_count = fields.Integer(default=0)
    disqualified_reason = fields.Char()
    disqualified_date = fields.Datetime()
    identity_descriptor = fields.Text(groups='base.group_system')
    identity_mismatch_streak = fields.Integer(default=0)
    digest = fields.Char(string="Empreinte des réponses (SHA-256)")

    # ------------------------------------------------------------------ verrous
    def _engine(self):
        return self.sudo().with_context(selecta_engine=True)

    @api.model_create_multi
    def create(self, vals_list):
        if not is_engine(self.env):
            raise AccessError(_("Les épreuves ne peuvent être créées que par le moteur SELECTA."))
        return super().create(vals_list)

    def write(self, vals):
        if not is_engine(self.env):
            raise AccessError(_("Les épreuves sont scellées : aucune modification manuelle n'est permise."))
        return super().write(vals)

    def unlink(self):
        if not is_engine(self.env):
            raise AccessError(_("Les épreuves ne peuvent pas être supprimées."))
        return super().unlink()

    # ------------------------------------------------------------------ création
    @api.model
    def _prepare_for(self, candidate):
        """Tirage et mélange individuels — figés pour la durée de l'épreuve."""
        concours = candidate.concours_id.sudo()
        rng = random.SystemRandom()
        questions = list(concours.question_ids.filtered('active').sorted(lambda q: (q.category_id.sequence, q.sequence, q.id)))
        if concours.nb_questions_drawn and concours.nb_questions_drawn < len(questions):
            drawn = set(q.id for q in rng.sample(questions, concours.nb_questions_drawn))
            questions = [q for q in questions if q.id in drawn]
        if concours.shuffle_questions:
            rng.shuffle(questions)
        choice_order = {}
        for q in questions:
            ids = q.choice_ids.ids
            if concours.shuffle_choices:
                rng.shuffle(ids)
            choice_order[str(q.id)] = ids
        qpp = max(1, concours.questions_per_page)
        return {
            'candidate_id': candidate.id,
            'concours_id': concours.id,
            'question_order': [q.id for q in questions],
            'choice_order': choice_order,
            'total_pages': max(1, math.ceil(len(questions) / qpp)),
            'max_score': sum(q.points for q in questions),
            'page_times': {},
        }

    def _issue_token(self):
        self.ensure_one()
        token = secrets.token_urlsafe(32)
        self._engine().write({'token_hash': hashlib.sha256(token.encode()).hexdigest()})
        return token

    @api.model
    def _by_token(self, token):
        if not token or len(token) < 20:
            return self.browse()
        digest = hashlib.sha256(token.encode()).hexdigest()
        return self.sudo().search([('token_hash', '=', digest)], limit=1)

    # ------------------------------------------------------------------ temps
    @api.model
    def _now(self):
        return fields.Datetime.now()

    def _remaining_seconds(self):
        self.ensure_one()
        if not self.deadline:
            return self.concours_id.duration_minutes * 60
        return max(0, int((self.deadline - self._now()).total_seconds()))

    def _status(self):
        self.ensure_one()
        c = self.concours_id.sudo()
        return {
            'state': self.state,
            'current_page': self.current_page,
            'total_pages': self.total_pages,
            'question_count': len(self.sudo().question_order or []),
            'server_now': to_ms(self._now()),
            'deadline': to_ms(self.deadline),
            'duration_seconds': c.duration_minutes * 60,
            'warnings': self.warnings_count,
            'max_warnings': LEVEL_MAX_WARNINGS[c.proctoring_level],
            'disqualified_reason': self.disqualified_reason,
            'identity_set': bool(self.sudo().identity_descriptor) or not c.proctoring_enabled,
            'result': self._result() if self.state in ('submitted', 'expired', 'disqualified') else None,
        }

    # ------------------------------------------------------------------ questionnaire
    def _public_question(self, q):
        order = (self.sudo().choice_order or {}).get(str(q.id)) or q.choice_ids.ids
        choices = {ch.id: ch for ch in q.choice_ids}
        image = False
        if q.image:
            image = 'data:image/png;base64,' + (q.image.decode() if isinstance(q.image, bytes) else q.image)
        return {
            'id': q.id,
            'text': q.name,
            'type': q.qtype,
            'points': q.points,
            'category': q.category_id.name or '',
            'image': image,
            'choices': [{'id': cid, 'text': choices[cid].name} for cid in order if cid in choices],
        }

    def _page_question_ids(self, page):
        self.ensure_one()
        qpp = max(1, self.concours_id.sudo().questions_per_page)
        order = self.sudo().question_order or []
        return order[page * qpp:(page + 1) * qpp]

    def _page_payload(self, page):
        Question = self.env['selecta.question'].sudo().with_context(active_test=False)
        ids = self._page_question_ids(page)
        qs = {q.id: q for q in Question.browse(ids)}
        return [self._public_question(qs[i]) for i in ids if i in qs]

    def _package(self):
        """Questions à afficher. En mode résilience, l'épreuve complète (sans corrigé) est préchargée."""
        self.ensure_one()
        c = self.concours_id.sudo()
        pages = {}
        if c.offline_prefetch:
            for p in range(self.current_page, self.total_pages):
                pages[p] = self._page_payload(p)
        else:
            pages[self.current_page] = self._page_payload(self.current_page)
        return {'pages': pages, 'status': self._status()}

    # ------------------------------------------------------------------ déroulé
    def _start(self):
        self.ensure_one()
        c = self.concours_id.sudo()
        if self.state != 'ready':
            return
        if c.state != 'open':
            raise UserError(_("L'épreuve n'est pas ouverte."))
        if c.proctoring_enabled and not self.sudo().identity_descriptor:
            raise UserError(_("Le contrôle d'identité par caméra doit être réalisé avant de commencer."))
        now = self._now()
        self._engine().write({
            'state': 'in_progress', 'start_date': now,
            'deadline': now + timedelta(minutes=c.duration_minutes), 'last_seen': now,
            'page_times': {'_last': to_ms(now)},
        })
        self.candidate_id.sudo().write({'state': 'in_progress'})
        self.env['selecta.audit.log']._log('attempt.start', _("Début de composition"),
                                           {'candidate': self.candidate_id.reference,
                                            'deadline': fields.Datetime.to_string(self.deadline)},
                                           concours=c, ip=self.ip_address)

    def _score_question(self, question, chosen_ids):
        c = self.concours_id.sudo()
        correct_ids = set(question.choice_ids.filtered('is_correct').ids)
        chosen = set(chosen_ids)
        if not chosen:
            return False, 0.0
        is_correct = chosen == correct_ids
        if is_correct:
            return True, question.points
        if question.qtype == 'multiple' and c.scoring_multi == 'partial' and correct_ids:
            unit = question.points / len(correct_ids)
            raw = unit * len(chosen & correct_ids) - unit * len(chosen - correct_ids)
            if not c.negative_marking:
                raw = max(0.0, raw)
            return False, round(raw, 4)
        if c.negative_marking:
            return False, -round(question.points * c.negative_ratio, 4)
        return False, 0.0

    def _record_answers(self, page, answers, allow_blank=False):
        """Valide et enregistre les réponses d'une page (non modifiables ensuite)."""
        self.ensure_one()
        c = self.concours_id.sudo()
        page_ids = self._page_question_ids(page)
        Question = self.env['selecta.question'].sudo().with_context(active_test=False)
        answers = {int(k): [int(x) for x in (v or [])] for k, v in (answers or {}).items()}
        if set(answers) - set(page_ids):
            raise UserError(_("Réponses non conformes à la page en cours."))
        missing = [qid for qid in page_ids if not answers.get(qid)]
        if missing and c.require_all_answers and not allow_blank:
            raise UserError(_("Veuillez répondre à toutes les questions de la page avant de valider."))
        now = self._now()
        vals_list = []
        for qid in page_ids:
            q = Question.browse(qid)
            chosen = answers.get(qid, [])
            valid_ids = set(q.choice_ids.ids)
            if set(chosen) - valid_ids:
                raise UserError(_("Proposition invalide."))
            if q.qtype == 'single' and len(chosen) > 1:
                raise UserError(_("Une seule proposition est autorisée pour cette question."))
            is_correct, points = self._score_question(q, chosen)
            vals_list.append({
                'attempt_id': self.id, 'question_id': qid, 'page': page,
                'choice_ids': [(6, 0, chosen)], 'is_correct': is_correct, 'points': points,
                'answered_at': now,
            })
        self.env['selecta.attempt.answer'].sudo().with_context(selecta_engine=True).create(vals_list)
        times = dict(self.page_times or {})
        last = times.get('_last') or to_ms(self.start_date)
        times[str(page)] = round((to_ms(now) - last) / 1000.0, 1)
        times['_last'] = to_ms(now)
        return times

    def _is_late(self, elapsed_ms=None):
        """Retourne True si la soumission doit être refusée pour dépassement du temps."""
        self.ensure_one()
        c = self.concours_id.sudo()
        now = self._now()
        if now <= self.deadline + timedelta(seconds=c.grace_seconds):
            return False
        # Synchronisation différée (micro-coupure réseau) : on se fie au chronomètre monotone
        # du poste, borné par la tolérance hors-ligne configurée.
        if elapsed_ms is not None and now <= self.deadline + timedelta(seconds=c.offline_tolerance_seconds):
            return float(elapsed_ms) > (c.duration_minutes * 60 + c.grace_seconds) * 1000
        return True

    def _submit_page(self, page, answers, elapsed_ms=None, time_up=False):
        self.ensure_one()
        if self.state != 'in_progress':
            return self._status()
        page = int(page)
        if page < self.current_page:
            return self._status()  # renvoi idempotent après coupure réseau
        if page > self.current_page:
            raise UserError(_("Ordre des pages non respecté."))
        if self._is_late(elapsed_ms):
            self._finalize('expired')
            return self._status()
        times = self._record_answers(page, answers, allow_blank=time_up)
        next_page = page + 1
        self._engine().write({'current_page': next_page, 'page_times': times, 'last_seen': self._now()})
        self.env['selecta.audit.log']._log(
            'attempt.page', _("Validation de la page %s", page + 1),
            {'candidate': self.candidate_id.reference, 'page': page + 1}, concours=self.concours_id, ip=self.ip_address)
        if time_up:
            self._finalize('expired')
        elif next_page >= self.total_pages:
            self._finalize('submitted')
        return self._status()

    def _finalize(self, state):
        """Correction automatique, scellement et mise à jour du candidat."""
        for att in self:
            if att.state not in ('in_progress', 'ready'):
                continue
            c = att.concours_id.sudo()
            now = self._now()
            answers = att.answer_ids.sudo()
            score = max(0.0, sum(answers.mapped('points')))
            pct = round(score / att.max_score * 100.0, 2) if att.max_score else 0.0
            passed = pct >= c.pass_threshold
            canonical = json.dumps(sorted(
                [(a.question_id.id, sorted(a.choice_ids.ids)) for a in answers]))
            digest = hashlib.sha256(('%s|%s|%s' % (att.id, att.candidate_id.reference, canonical)).encode()).hexdigest()
            end = min(now, att.deadline) if att.deadline else now
            att._engine().write({
                'state': state, 'end_date': now, 'score': score, 'percentage': pct, 'passed': passed,
                'duration_seconds': int((end - att.start_date).total_seconds()) if att.start_date else 0,
                'digest': digest, 'finish_reason': 'Temps écoulé' if state == 'expired' else 'Épreuve terminée',
            })
            att.candidate_id.sudo().write({'state': 'passed' if passed else 'failed'})
            self.env['selecta.audit.log']._log(
                'attempt.finish', _("Fin d'épreuve (%s)", state),
                {'candidate': att.candidate_id.reference, 'score': score, 'percentage': pct,
                 'passed': passed, 'answers_sha256': digest}, concours=c, ip=att.ip_address)
            if not self.env.context.get('selecta_closing'):
                c._check_auto_close()

    def _disqualify(self, reason, by_user=False):
        for att in self:
            if att.state in ('submitted', 'expired', 'disqualified'):
                continue
            now = self._now()
            att._engine().write({
                'state': 'disqualified', 'disqualified_reason': reason, 'disqualified_date': now,
                'end_date': now, 'score': 0.0, 'percentage': 0.0, 'passed': False, 'admitted': False,
                'finish_reason': 'Disqualification',
            })
            att.candidate_id.sudo().write({'state': 'disqualified'})
            self.env['selecta.audit.log']._log(
                'attempt.disqualify', _("Disqualification : %s", reason),
                {'candidate': att.candidate_id.reference, 'by_user': bool(by_user)},
                concours=att.concours_id, ip=att.ip_address)
            if not self.env.context.get('selecta_closing'):
                att.concours_id._check_auto_close()

    def _result(self):
        self.ensure_one()
        c = self.concours_id.sudo()
        show = c.show_result
        answered = self.answer_ids.sudo().filtered(lambda a: a.choice_ids)
        return {
            'state': self.state,
            'percentage': self.percentage if show else None,
            'passed': self.passed if show else None,
            'score': self.score if show else None,
            'max_score': self.max_score if show else None,
            'threshold': c.pass_threshold,
            'places': c.places,
            'answered': len(answered),
            'question_count': len(self.sudo().question_order or []),
            'correct': len(self.answer_ids.sudo().filtered('is_correct')) if show else None,
            'duration_seconds': self.duration_seconds,
            'digest': self.digest,
            'disqualified_reason': self.disqualified_reason,
            'show': show,
        }

    # ------------------------------------------------------------------ surveillance
    def _apply_event(self, etype, details='', snapshot=None, client_ts=None):
        """Applique la politique de surveillance. Le serveur décide, le poste exécute."""
        self.ensure_one()
        c = self.concours_id.sudo()
        etype = etype if etype in EVENT_LABELS else 'info'
        severity = 'info'
        if c.proctoring_enabled:
            if etype in CRITICAL_EVENTS and (etype != 'identity_mismatch' or c.identity_check):
                severity = 'critical'
            elif etype in WARNING_EVENTS:
                severity = 'warning'
            if etype in ('fullscreen_exit',) and not c.require_fullscreen:
                severity = 'info'
        action = 'none'
        vals = {}
        if self.state == 'in_progress' and severity != 'info':
            max_w = LEVEL_MAX_WARNINGS[c.proctoring_level]
            if severity == 'critical' or max_w == 0:
                action = 'disqualified'
            else:
                count = self.warnings_count + 1
                vals['warnings_count'] = count
                action = 'disqualified' if count > max_w else 'warning'
        if vals:
            self._engine().write(vals)
        snap = False
        if snapshot and isinstance(snapshot, str) and snapshot.startswith('data:image'):
            snap = snapshot.split(',', 1)[1]
            if len(snap) > 400_000:  # ~300 Ko max par cliché
                snap = False
        self.env['selecta.proctor.event'].sudo().create({
            'attempt_id': self.id, 'event_type': etype, 'severity': severity,
            'description': (details or EVENT_LABELS.get(etype, ''))[:500],
            'snapshot': snap, 'action_taken': action,
            'client_ts': client_ts and str(client_ts)[:32],
        })
        if action == 'disqualified':
            self._disqualify(EVENT_LABELS.get(etype, etype))
        return {'severity': severity, 'action': action, 'status': self._status()}

    def _set_identity(self, descriptor, photo):
        self.ensure_one()
        if not isinstance(descriptor, list) or len(descriptor) != 128:
            raise UserError(_("Empreinte faciale invalide : recommencez le contrôle caméra."))
        ref = self.sudo().identity_descriptor
        if self.state != 'ready':
            # Reprise sur incident : le visage doit correspondre à celui enregistré au départ.
            if self.state != 'in_progress' or not ref:
                raise UserError(_("Le contrôle d'identité n'est plus possible pour cette épreuve."))
            ref_v = json.loads(ref)
            dist = math.sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(ref_v, descriptor)))
            if dist > IDENTITY_DISTANCE:
                self._apply_event('identity_mismatch',
                                  _("Reprise refusée : visage non conforme (écart %.2f)", dist))
                return {'ok': False, 'error': _("Visage non reconnu : la reprise est refusée et l'incident a été signalé.")}
            self.env['selecta.audit.log']._log('attempt.identity_resume', _("Identité confirmée à la reprise"),
                                               {'candidate': self.candidate_id.reference, 'distance': round(dist, 3)},
                                               concours=self.concours_id, ip=self.ip_address)
            return {'ok': True}
        vals = {'identity_descriptor': json.dumps([round(float(x), 5) for x in descriptor])}
        self._engine().write(vals)
        if photo and isinstance(photo, str) and photo.startswith('data:image'):
            self.candidate_id.sudo().write({'photo_reference': photo.split(',', 1)[1]})
        self.env['selecta.audit.log']._log('attempt.identity', _("Contrôle d'identité faciale validé"),
                                           {'candidate': self.candidate_id.reference},
                                           concours=self.concours_id, ip=self.ip_address)
        return {'ok': True}

    def _heartbeat(self, descriptor=None, faces=None):
        """Battement de surveillance ; contrôle d'identité côté serveur (non contournable)."""
        self.ensure_one()
        self._engine().write({'last_seen': self._now()})
        if self.state != 'in_progress':
            return self._status()
        c = self.concours_id.sudo()
        ref = self.sudo().identity_descriptor
        if c.proctoring_enabled and c.identity_check and ref and isinstance(descriptor, list) and len(descriptor) == 128:
            ref_v = json.loads(ref)
            dist = math.sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(ref_v, descriptor)))
            if dist > IDENTITY_DISTANCE:
                streak = self.identity_mismatch_streak + 1
                self._engine().write({'identity_mismatch_streak': streak})
                if streak >= 2:
                    return self._apply_event('identity_mismatch',
                                             _("Écart biométrique %.2f (seuil %.2f) confirmé par le serveur",
                                               dist, IDENTITY_DISTANCE))['status']
            elif self.identity_mismatch_streak:
                self._engine().write({'identity_mismatch_streak': 0})
        if self._is_late():
            self._finalize('expired')
        return self._status()

    # ------------------------------------------------------------------ tâches planifiées
    @api.model
    def _expire_overdue(self):
        now = self._now()
        candidates = self.sudo().search([('state', '=', 'in_progress'), ('deadline', '<', now - timedelta(seconds=15))])
        for att in candidates:
            tol = att.concours_id.offline_tolerance_seconds or 0
            if now > att.deadline + timedelta(seconds=tol):
                att._finalize('expired')

    # ------------------------------------------------------------------ actions surveillant
    def action_allow_resume(self):
        require_group(self.env, G_ADMIN, G_PROCTOR)
        for att in self:
            if att.state not in ('ready', 'in_progress'):
                raise UserError(_("Cette épreuve est terminée."))
            att._engine().write({'allow_resume': True})
            self.env['selecta.audit.log']._log('attempt.resume_allowed', _("Reprise sur incident autorisée"),
                                               {'candidate': att.candidate_id.reference}, concours=att.concours_id)
        return True

    def action_manual_disqualify(self, reason):
        require_group(self.env, G_ADMIN, G_PROCTOR)
        reason = (reason or '').strip()
        if len(reason) < 5:
            raise UserError(_("Un motif explicite (5 caractères minimum) est obligatoire."))
        for att in self:
            att.sudo()._apply_event('manual', reason)
            att.sudo()._disqualify(_("Décision du surveillant : %s", reason), by_user=True)
        return True


class SelectaAttemptAnswer(models.Model):
    _name = 'selecta.attempt.answer'
    _description = 'Réponse enregistrée'
    _order = 'attempt_id, page, id'

    attempt_id = fields.Many2one('selecta.attempt', required=True, ondelete='cascade', index=True)
    concours_id = fields.Many2one(related='attempt_id.concours_id', store=True, index=True)
    company_id = fields.Many2one(related='attempt_id.company_id', store=True, index=True)
    question_id = fields.Many2one('selecta.question', required=True, ondelete='restrict', index=True)
    page = fields.Integer()
    choice_ids = fields.Many2many('selecta.choice', 'selecta_answer_choice_rel', 'answer_id', 'choice_id')
    is_correct = fields.Boolean()
    points = fields.Float(digits=(16, 4))
    answered_at = fields.Datetime()

    _sql_constraints = [
        ('unique_answer', 'unique(attempt_id, question_id)', "Une question ne peut recevoir qu'une seule réponse."),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        if not is_engine(self.env):
            raise AccessError(_("Réponses enregistrables uniquement par le moteur d'épreuve."))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(_("Une réponse validée est définitive."))

    def unlink(self):
        if not is_engine(self.env):
            raise AccessError(_("Une réponse validée ne peut être supprimée."))
        return super().unlink()
