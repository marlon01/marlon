# -*- coding: utf-8 -*-
"""Façade API du back-office OWL (aucune vue native : toutes les données transitent ici).

Chaque méthode vérifie explicitement le rôle de l'utilisateur ; les droits d'accès
(ACL + règles multi-structure) s'appliquent en plus sur les lectures standard.
"""
import base64
import io
from datetime import timedelta
from urllib.parse import quote

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

from .selecta_concours import G_ADMIN, G_DESIGN, G_JURY, G_PROCTOR, require_group
from .selecta_attempt import EVENT_LABELS, LEVEL_MAX_WARNINGS, to_ms
from .selecta_messaging import normalize_phone

CONCOURS_FIELDS = [
    'name', 'description', 'instructions', 'date_start', 'date_end', 'auto_close', 'duration_minutes',
    'questions_per_page', 'nb_questions_drawn', 'shuffle_questions', 'shuffle_choices', 'pass_threshold',
    'places', 'scoring_multi', 'negative_marking', 'negative_ratio', 'require_all_answers', 'show_result',
    'proctoring_enabled', 'proctoring_level', 'face_absent_seconds', 'look_away_seconds', 'identity_check',
    'require_fullscreen', 'offline_prefetch', 'grace_seconds', 'offline_tolerance_seconds',
    'exam_mode', 'exam_venue', 'venue_networks',
]
ROLE_GROUPS = {
    'admin': G_ADMIN, 'concepteur': G_DESIGN, 'jury': G_JURY, 'surveillant': G_PROCTOR,
}
ROLE_LABELS = {
    'admin': "Administrateur concours", 'concepteur': "Concepteur de questionnaires",
    'jury': "Jury / délibération", 'surveillant': "Surveillant de salle",
}


def _dt(value):
    return fields.Datetime.to_string(value) if value else False


class SelectaBackoffice(models.AbstractModel):
    _name = 'selecta.backoffice'
    _description = 'API back-office SELECTA'

    # ------------------------------------------------------------------ session
    @api.model
    def session_info(self):
        user = self.env.user
        roles = {r: user.has_group(g) for r, g in ROLE_GROUPS.items()}
        if not any(roles.values()):
            raise AccessError(_("Votre compte n'a aucun rôle SELECTA."))
        company = self.env.company
        return {
            'uid': user.id, 'name': user.name, 'login': user.login, 'roles': roles,
            'is_system': user.has_group('base.group_system'),
            'company': {'id': company.id, 'name': company.name, 'color': company.selecta_brand_color or '#0B5FFF',
                        'tagline': company.selecta_tagline or '', 'logo': '/web/binary/company_logo?company=%s' % company.id},
            'companies': [{'id': c.id, 'name': c.name} for c in user.company_ids],
            'server_now': to_ms(fields.Datetime.now()),
            'event_labels': EVENT_LABELS,
        }

    # ------------------------------------------------------------------ tableau de bord
    @api.model
    def dashboard(self):
        require_group(self.env, G_ADMIN, G_DESIGN, G_JURY, G_PROCTOR)
        Concours = self.env['selecta.concours']
        Attempt = self.env['selecta.attempt'].sudo()
        concours = Concours.search([], limit=50)
        by_state = {s: 0 for s in ('draft', 'ready', 'open', 'closed', 'published')}
        for c in concours:
            by_state[c.state] += 1
        att_counts = dict((s, n) for s, n in Attempt._read_group(
            [('concours_id', 'in', concours.ids)], ['state'], ['__count']))
        today = fields.Datetime.now() - timedelta(hours=24)
        events = self.env['selecta.proctor.event'].browse()
        if self.env.user.has_group(G_PROCTOR):
            events = self.env['selecta.proctor.event'].search(
                [('severity', '!=', 'info'), ('date', '>=', today)], limit=12)
        live = []
        for c in concours.filtered(lambda c: c.state == 'open'):
            live.append(self._concours_card(c))
        return {
            'kpi': {
                'concours': len(concours), 'open': by_state['open'],
                'in_progress': att_counts.get('in_progress', 0),
                'finished': att_counts.get('submitted', 0) + att_counts.get('expired', 0),
                'disqualified': att_counts.get('disqualified', 0),
                'admitted': Attempt.search_count([('concours_id', 'in', concours.ids), ('passed', '=', True)]),
                'questions': self.env['selecta.question'].search_count([]) if self.env.user.has_group(G_DESIGN) else None,
                'candidates': self.env['selecta.candidate'].sudo().search_count([('company_id', 'in', self.env.companies.ids)]),
            },
            'by_state': by_state,
            'live': live,
            'recent': [self._concours_card(c) for c in concours[:6]],
            'events': [self._event_dict(e) for e in events],
        }

    def _concours_card(self, c):
        Attempt = self.env['selecta.attempt'].sudo()
        counts = dict((s, n) for s, n in Attempt._read_group([('concours_id', '=', c.id)], ['state'], ['__count']))
        passed = Attempt.search_count([('concours_id', '=', c.id), ('passed', '=', True)])
        finished = counts.get('submitted', 0) + counts.get('expired', 0)
        return {
            'id': c.id, 'name': c.name, 'reference': c.reference, 'state': c.state,
            'date_start': _dt(c.date_start), 'date_end': _dt(c.date_end),
            'duration_minutes': c.duration_minutes, 'candidates': c.candidate_count,
            'questions': c.question_count, 'in_progress': counts.get('in_progress', 0),
            'finished': finished, 'disqualified': counts.get('disqualified', 0), 'passed': passed,
            'pass_threshold': c.pass_threshold,
        }

    # ------------------------------------------------------------------ concours
    @api.model
    def concours_list(self):
        require_group(self.env, G_ADMIN, G_DESIGN, G_JURY, G_PROCTOR)
        return [self._concours_card(c) for c in self.env['selecta.concours'].search([])]

    @api.model
    def concours_get(self, concours_id):
        require_group(self.env, G_ADMIN, G_DESIGN, G_JURY, G_PROCTOR)
        c = self.env['selecta.concours'].browse(int(concours_id)).exists()
        if not c:
            raise UserError(_("Concours introuvable."))
        data = c.read(CONCOURS_FIELDS + ['state', 'reference', 'results_hash', 'published_date',
                                         'opened_date', 'closed_date', 'max_score'])[0]
        for k in ('date_start', 'date_end', 'published_date', 'opened_date', 'closed_date'):
            data[k] = _dt(c[k])
        data['question_ids'] = c.question_ids.ids if self.env.user.has_group(G_DESIGN) or self.env.user.has_group(G_JURY) else []
        data['question_count'] = c.question_count
        data['candidate_count'] = c.candidate_count
        data['codes_missing'] = len(c.candidate_ids.filtered(lambda x: not x.has_code))
        data['card'] = self._concours_card(c)
        data['max_warnings'] = LEVEL_MAX_WARNINGS[c.proctoring_level]
        return data

    @api.model
    def concours_save(self, vals):
        require_group(self.env, G_ADMIN, G_DESIGN)
        clean = {k: vals[k] for k in CONCOURS_FIELDS if k in vals}
        for k in ('date_start', 'date_end'):
            if k in clean:
                clean[k] = clean[k] or False
        if 'question_ids' in vals:
            clean['question_ids'] = [(6, 0, [int(i) for i in vals['question_ids']])]
        cid = vals.get('id')
        if cid:
            c = self.env['selecta.concours'].browse(int(cid))
            c.write(clean)
        else:
            require_group(self.env, G_ADMIN)
            c = self.env['selecta.concours'].create(clean)
        return self.concours_get(c.id)

    @api.model
    def concours_action(self, concours_id, action):
        c = self.env['selecta.concours'].browse(int(concours_id))
        actions = {
            'ready': c.action_ready, 'draft': c.action_back_to_draft, 'open': c.action_open,
            'close': c.action_close, 'publish': c.action_publish,
        }
        if action not in actions:
            raise UserError(_("Action inconnue."))
        actions[action]()
        return self.concours_get(c.id)

    @api.model
    def concours_delete(self, concours_id):
        require_group(self.env, G_ADMIN)
        c = self.env['selecta.concours'].browse(int(concours_id))
        name = c.name
        c.unlink()
        self.env['selecta.audit.log']._log('concours.delete', _("Suppression du concours %s", name), {})
        return True

    @api.model
    def concours_duplicate(self, concours_id):
        require_group(self.env, G_ADMIN)
        c = self.env['selecta.concours'].browse(int(concours_id))
        new = c.copy({'name': _("%s (copie)", c.name), 'question_ids': [(6, 0, c.question_ids.ids)]})
        return new.id

    # ------------------------------------------------------------------ banque de questions
    @api.model
    def categories_list(self):
        require_group(self.env, G_ADMIN, G_DESIGN, G_JURY)
        return [{'id': c.id, 'name': c.name, 'color': c.color, 'count': c.question_count}
                for c in self.env['selecta.question.category'].search([])]

    @api.model
    def category_save(self, vals):
        require_group(self.env, G_ADMIN, G_DESIGN)
        clean = {k: vals[k] for k in ('name', 'color', 'sequence') if k in vals}
        if vals.get('id'):
            self.env['selecta.question.category'].browse(int(vals['id'])).write(clean)
        else:
            self.env['selecta.question.category'].create(clean)
        return self.categories_list()

    @api.model
    def category_delete(self, category_id):
        require_group(self.env, G_ADMIN, G_DESIGN)
        cat = self.env['selecta.question.category'].browse(int(category_id))
        if cat.question_count:
            raise UserError(_("Cette matière contient des questions."))
        cat.unlink()
        return self.categories_list()

    def _question_dict(self, q):
        locked = bool(q.concours_ids.filtered(lambda c: c.state in ('open', 'closed', 'published')))
        return {
            'id': q.id, 'name': q.name, 'qtype': q.qtype, 'points': q.points, 'difficulty': q.difficulty,
            'explanation': q.explanation or '', 'category_id': q.category_id.id or False,
            'category': q.category_id.name or '', 'color': q.category_id.color or '#94A3B8',
            'has_image': bool(q.image), 'active': q.active, 'locked': locked,
            'usage': len(q.concours_ids),
            'choices': [{'id': ch.id, 'name': ch.name, 'is_correct': ch.is_correct} for ch in q.choice_ids],
        }

    @api.model
    def questions_list(self, search='', category_id=False, only_ids=None):
        require_group(self.env, G_ADMIN, G_DESIGN, G_JURY)
        domain = []
        if search:
            domain.append(('name', 'ilike', search))
        if category_id:
            domain.append(('category_id', '=', int(category_id)))
        if only_ids is not None:
            domain.append(('id', 'in', [int(i) for i in only_ids]))
        return [self._question_dict(q) for q in self.env['selecta.question'].search(domain, limit=2000)]

    @api.model
    def question_save(self, vals):
        require_group(self.env, G_ADMIN, G_DESIGN)
        choices = vals.get('choices') or []
        if len([c for c in choices if (c.get('name') or '').strip()]) < 2:
            raise UserError(_("Saisissez au moins deux propositions."))
        if not any(c.get('is_correct') for c in choices):
            raise UserError(_("Cochez au moins une bonne réponse."))
        if vals.get('qtype') == 'single' and len([c for c in choices if c.get('is_correct')]) > 1:
            raise UserError(_("Une question à choix unique n'admet qu'une bonne réponse."))
        clean = {k: vals[k] for k in ('name', 'qtype', 'points', 'difficulty', 'explanation') if k in vals}
        clean['category_id'] = int(vals['category_id']) if vals.get('category_id') else False
        if vals.get('image_data'):
            clean['image'] = vals['image_data'].split(',', 1)[-1]
        elif vals.get('remove_image'):
            clean['image'] = False
        Question = self.env['selecta.question']
        if vals.get('id'):
            q = Question.browse(int(vals['id']))
            q.write(clean)
        else:
            q = Question.create(clean)
        keep = []
        for seq, ch in enumerate(choices):
            name = (ch.get('name') or '').strip()
            if not name:
                continue
            data = {'name': name, 'is_correct': bool(ch.get('is_correct')), 'sequence': seq, 'question_id': q.id}
            if ch.get('id') and ch['id'] in q.choice_ids.ids:
                rec = q.choice_ids.filtered(lambda r: r.id == ch['id'])
                rec.write(data)
                keep.append(rec.id)
            else:
                keep.append(self.env['selecta.choice'].create(data).id)
        (q.choice_ids.filtered(lambda r: r.id not in keep)).unlink()
        return self._question_dict(q)

    @api.model
    def question_delete(self, question_id):
        require_group(self.env, G_ADMIN, G_DESIGN)
        q = self.env['selecta.question'].browse(int(question_id))
        if q.concours_ids or self.env['selecta.attempt.answer'].sudo().search_count([('question_id', '=', q.id)]):
            q._check_not_locked()
            q.write({'active': False})
            return {'archived': True}
        q.unlink()
        return {'deleted': True}

    @api.model
    def question_duplicate(self, question_id):
        require_group(self.env, G_ADMIN, G_DESIGN)
        q = self.env['selecta.question'].browse(int(question_id))
        new = q.copy({'name': q.name + ' (v2)', 'concours_ids': [(6, 0, [])]})
        return self._question_dict(new)

    @api.model
    def questions_import(self, rows):
        """Import en masse : [{question, type, points, category, difficulty, choices:[{text, correct}]}]."""
        require_group(self.env, G_ADMIN, G_DESIGN)
        Cat = self.env['selecta.question.category']
        cats = {c.name.lower(): c for c in Cat.search([])}
        created, errors = 0, []
        for idx, row in enumerate(rows or [], start=1):
            try:
                with self.env.cr.savepoint():
                    cname = (row.get('category') or '').strip()
                    cat = False
                    if cname:
                        cat = cats.get(cname.lower()) or Cat.create({'name': cname})
                        cats[cname.lower()] = cat
                    choices = [c for c in row.get('choices', []) if (c.get('text') or '').strip()]
                    ncorrect = len([c for c in choices if c.get('correct')])
                    if len(choices) < 2 or not ncorrect:
                        raise UserError(_("au moins 2 propositions et 1 bonne réponse requises"))
                    qtype = row.get('type') or ('multiple' if ncorrect > 1 else 'single')
                    q = self.env['selecta.question'].create({
                        'name': row['question'].strip(), 'qtype': 'multiple' if qtype.startswith('m') else 'single',
                        'points': float(row.get('points') or 1), 'category_id': cat.id if cat else False,
                        'difficulty': row.get('difficulty') if row.get('difficulty') in ('easy', 'medium', 'hard') else 'medium',
                    })
                    self.env['selecta.choice'].create([{
                        'question_id': q.id, 'name': c['text'].strip(), 'is_correct': bool(c.get('correct')),
                        'sequence': i} for i, c in enumerate(choices)])
                    created += 1
            except Exception as exc:  # noqa: BLE001 - rapport ligne par ligne
                errors.append({'line': idx, 'error': str(exc)[:200]})
        self.env['selecta.audit.log']._log('questions.import', _("Import de %s question(s)", created),
                                           {'errors': len(errors)})
        return {'created': created, 'errors': errors}

    # ------------------------------------------------------------------ candidats
    def _candidate_dict(self, c):
        att = c.attempt_ids[:1]
        return {
            'id': c.id, 'name': c.name, 'reference': c.reference, 'email': c.email or '', 'phone': c.phone or '',
            'room': c.room or '', 'id_document': c.id_document or '', 'birthdate': c.birthdate and str(c.birthdate) or '',
            'state': c.state, 'has_code': c.has_code, 'code_generated_at': _dt(c.code_generated_at),
            'percentage': att.percentage if att else None, 'has_photo': bool(c.photo_reference),
            'dossier_date': c.dossier_date and str(c.dossier_date) or '',
            'code_sent_at': _dt(c.code_sent_at), 'code_sent_via': c.code_sent_via or '',
            'dossier_received_by': c.dossier_received_by.name or '',
        }

    @api.model
    def candidates_list(self, concours_id):
        require_group(self.env, G_ADMIN, G_JURY, G_PROCTOR)
        cands = self.env['selecta.candidate'].search([('concours_id', '=', int(concours_id))])
        return [self._candidate_dict(c) for c in cands]

    @api.model
    def candidate_save(self, vals):
        require_group(self.env, G_ADMIN)
        clean = {k: (vals.get(k) or False) for k in ('name', 'reference', 'email', 'phone', 'room', 'id_document',
                                                      'birthdate', 'dossier_date') if k in vals}
        if 'dossier_date' in clean and not clean['dossier_date']:
            clean.pop('dossier_date')  # date du jour par défaut
        if vals.get('id'):
            cand = self.env['selecta.candidate'].browse(int(vals['id']))
            cand.write(clean)
        else:
            concours = self.env['selecta.concours'].browse(int(vals['concours_id']))
            if concours.state in ('closed', 'published'):
                raise UserError(_("Inscriptions closes pour ce concours."))
            clean['concours_id'] = concours.id
            cand = self.env['selecta.candidate'].create(clean)
        return self._candidate_dict(cand)

    @api.model
    def candidate_delete(self, candidate_id):
        require_group(self.env, G_ADMIN)
        cand = self.env['selecta.candidate'].browse(int(candidate_id))
        if cand.attempt_ids:
            raise UserError(_("Ce candidat a déjà participé : suppression interdite."))
        ref = cand.reference
        concours = cand.concours_id
        cand.unlink()
        self.env['selecta.audit.log']._log('candidate.delete', _("Suppression du candidat %s", ref), {}, concours=concours)
        return True

    @api.model
    def candidates_import(self, concours_id, rows):
        require_group(self.env, G_ADMIN)
        concours = self.env['selecta.concours'].browse(int(concours_id))
        existing = set(concours.candidate_ids.mapped('reference'))
        created, errors = 0, []
        for idx, row in enumerate(rows or [], start=1):
            ref = (row.get('reference') or '').strip()
            name = (row.get('name') or '').strip()
            if not ref or not name:
                errors.append({'line': idx, 'error': _("nom et numéro d'inscription obligatoires")})
                continue
            if ref in existing:
                errors.append({'line': idx, 'error': _("numéro %s déjà inscrit", ref)})
                continue
            self.env['selecta.candidate'].create({
                'concours_id': concours.id, 'name': name, 'reference': ref,
                'email': row.get('email') or False, 'phone': row.get('phone') or False,
                'room': row.get('room') or False, 'id_document': row.get('id_document') or False,
                **({'dossier_date': row['dossier_date']} if row.get('dossier_date') else {}),
            })
            existing.add(ref)
            created += 1
        self.env['selecta.audit.log']._log('candidates.import', _("Import de %s candidat(s)", created), {},
                                           concours=concours)
        return {'created': created, 'errors': errors}

    @api.model
    def generate_codes(self, concours_id, candidate_ids=None, only_missing=True):
        require_group(self.env, G_ADMIN)
        domain = [('concours_id', '=', int(concours_id)), ('state', '=', 'registered')]
        if candidate_ids:
            domain.append(('id', 'in', [int(i) for i in candidate_ids]))
        cands = self.env['selecta.candidate'].search(domain)
        if only_missing:
            cands = cands.filtered(lambda c: not c.has_code)
        concours = self.env['selecta.concours'].browse(int(concours_id))
        concours.company_id._selecta_guard('codes.generate', concours=concours)
        return {
            'codes': cands._generate_codes(),
            'concours': {'name': concours.name, 'reference': concours.reference,
                         'duration': concours.duration_minutes, 'date_start': _dt(concours.date_start),
                         'instructions': concours.instructions or '',
                         'exam_mode': concours.exam_mode, 'exam_venue': concours.exam_venue or ''},
        }

    # ------------------------------------------------------------------ envoi des codes (SMS, WhatsApp)
    @api.model
    def messaging_channels(self):
        require_group(self.env, G_ADMIN)
        return self.env['selecta.messaging'].channels()

    @api.model
    def codes_send(self, concours_id, items, channel):
        """Envoie à chaque candidat son code, que la console vient de générer et d'afficher.

        ``items`` : [{'id': candidat, 'code': code en clair}]. Un code qui ne correspond pas au
        candidat est refusé : la console ne peut rien faire envoyer d'autre que le vrai code.
        """
        require_group(self.env, G_ADMIN)
        if channel not in ('sms', 'whatsapp'):
            raise UserError(_("Canal d'envoi inconnu."))
        concours = self.env['selecta.concours'].browse(int(concours_id)).exists()
        if not concours:
            raise UserError(_("Concours introuvable."))
        Msg = self.env['selecta.messaging']
        Cand = self.env['selecta.candidate']
        results, sent = [], 0
        for item in (items or [])[:500]:
            cand = Cand.browse(int(item.get('id') or 0)).exists()
            if not cand or cand.concours_id != concours:
                continue
            code = str(item.get('code') or '')
            if not cand.sudo().code_hash or Cand._hash_code(code) != cand.sudo().code_hash:
                results.append({'id': cand.id, 'ok': False, 'error': _("code invalide")})
                continue
            phone = normalize_phone(cand.phone, concours.company_id.country_id)
            if not phone:
                results.append({'id': cand.id, 'ok': False, 'error': _("pas de numéro de téléphone valide")})
                continue
            ok, error = Msg.send(channel, phone, Msg.code_message(cand, code))
            if ok:
                cand.sudo().write({'code_sent_at': fields.Datetime.now(), 'code_sent_via': channel})
                sent += 1
            results.append({'id': cand.id, 'ok': ok, 'error': error})
        self.env['selecta.audit.log']._log(
            'codes.send', _("Envoi de %(n)s code(s) par %(c)s", n=sent, c=channel.upper() if channel == 'sms' else 'WhatsApp'),
            {'sent': sent, 'failed': len(results) - sent}, concours=concours)
        return {'sent': sent, 'results': results}

    @api.model
    def codes_whatsapp_links(self, concours_id, items):
        """Envoi manuel, sans service : un lien wa.me par candidat, ouvert depuis le téléphone du personnel."""
        require_group(self.env, G_ADMIN)
        concours = self.env['selecta.concours'].browse(int(concours_id)).exists()
        Cand = self.env['selecta.candidate']
        Msg = self.env['selecta.messaging']
        links = []
        for item in (items or [])[:500]:
            cand = Cand.browse(int(item.get('id') or 0)).exists()
            if not cand or cand.concours_id != concours:
                continue
            code = str(item.get('code') or '')
            if not cand.sudo().code_hash or Cand._hash_code(code) != cand.sudo().code_hash:
                continue
            phone = normalize_phone(cand.phone, concours.company_id.country_id)
            links.append({'id': cand.id, 'name': cand.name, 'reference': cand.reference, 'phone': phone,
                          'url': 'https://wa.me/%s?text=%s' % (phone.lstrip('+'), quote(Msg.code_message(cand, code)))
                          if phone else ''})
        return links

    # ------------------------------------------------------------------ surveillance en direct
    def _event_dict(self, e):
        return {
            'id': e.id, 'date': _dt(e.date), 'type': e.event_type, 'label': EVENT_LABELS.get(e.event_type, e.event_type),
            'severity': e.severity, 'description': e.description or '', 'action': e.action_taken,
            'candidate': e.candidate_id.name, 'reference': e.candidate_id.reference,
            'concours': e.concours_id.name, 'attempt_id': e.attempt_id.id,
            'snapshot': '/web/image/selecta.proctor.event/%s/snapshot' % e.id if e.snapshot else False,
        }

    @api.model
    def monitor(self, concours_id):
        require_group(self.env, G_ADMIN, G_JURY, G_PROCTOR)
        c = self.env['selecta.concours'].browse(int(concours_id))
        now = fields.Datetime.now()
        attempts = self.env['selecta.attempt'].search([('concours_id', '=', c.id)])
        rows = []
        for a in attempts:
            remaining = max(0, int((a.deadline - now).total_seconds())) if a.deadline and a.state == 'in_progress' else None
            online = bool(a.last_seen and (now - a.last_seen).total_seconds() < 45)
            last_crit = a.event_ids[:1]
            rows.append({
                'id': a.id, 'candidate': a.candidate_id.name, 'reference': a.candidate_id.reference,
                'room': a.candidate_id.room or '', 'state': a.state, 'page': a.current_page, 'pages': a.total_pages,
                'progress': int(100 * a.current_page / a.total_pages) if a.total_pages else 0,
                'remaining': remaining, 'warnings': a.warnings_count, 'online': online,
                'last_seen': _dt(a.last_seen), 'percentage': a.percentage if a.state in ('submitted', 'expired') else None,
                'passed': a.passed, 'allow_resume': a.allow_resume, 'login_count': a.login_count,
                'disqualified_reason': a.disqualified_reason or '', 'ip': a.ip_address or '',
                'photo': '/web/image/selecta.candidate/%s/photo_reference' % a.candidate_id.id if a.candidate_id.photo_reference else False,
                'last_event': self._event_dict(last_crit) if last_crit else False,
            })
        events = self.env['selecta.proctor.event'].search([('concours_id', '=', c.id), ('severity', '!=', 'info')], limit=40)
        not_logged = self.env['selecta.candidate'].search_count([('concours_id', '=', c.id), ('attempt_ids', '=', False)])
        return {
            'concours': self._concours_card(c), 'state': c.state, 'rows': rows,
            'events': [self._event_dict(e) for e in events], 'not_logged': not_logged,
            'max_warnings': LEVEL_MAX_WARNINGS[c.proctoring_level], 'server_now': to_ms(now),
        }

    @api.model
    def attempt_events(self, attempt_id):
        require_group(self.env, G_ADMIN, G_JURY, G_PROCTOR)
        a = self.env['selecta.attempt'].browse(int(attempt_id))
        return [self._event_dict(e) for e in a.event_ids]

    @api.model
    def attempt_action(self, attempt_id, action, reason=''):
        a = self.env['selecta.attempt'].browse(int(attempt_id))
        if action == 'resume':
            a.action_allow_resume()
        elif action == 'disqualify':
            a.action_manual_disqualify(reason)
        else:
            raise UserError(_("Action inconnue."))
        return True

    # ------------------------------------------------------------------ résultats
    @api.model
    def results(self, concours_id):
        require_group(self.env, G_ADMIN, G_JURY)
        c = self.env['selecta.concours'].browse(int(concours_id))
        if c.state == 'open':
            c.sudo()._compute_ranking()
        attempts = self.env['selecta.attempt'].search([('concours_id', '=', c.id)])
        order = {'submitted': 0, 'expired': 0, 'in_progress': 1, 'ready': 2, 'disqualified': 3, 'absent': 4}
        attempts = attempts.sorted(lambda a: (order.get(a.state, 9), a.rank or 10 ** 6, -a.percentage))
        rows = [{
            'id': a.id, 'rank': a.rank, 'candidate': a.candidate_id.name, 'reference': a.candidate_id.reference,
            'room': a.candidate_id.room or '', 'state': a.state, 'score': a.score, 'max_score': a.max_score,
            'percentage': a.percentage, 'passed': a.passed, 'admitted': a.admitted,
            'duration': a.duration_seconds, 'warnings': a.warnings_count, 'digest': a.digest or '',
            'disqualified_reason': a.disqualified_reason or '', 'end_date': _dt(a.end_date),
        } for a in attempts]
        admitted = [r for r in rows if r['admitted']]
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '')
        verify_url = '%s/selecta/verify/%s' % (base_url, c.results_hash) if c.results_hash else False
        return {
            'concours': self.concours_get(c.id), 'rows': rows, 'admitted': admitted,
            'provisional': c.state == 'open', 'official': c.state == 'published',
            'results_hash': c.results_hash or False, 'verify_url': verify_url,
            'qr': self._qr_data_uri(verify_url) if verify_url else False,
            'company': {'name': c.company_id.name, 'logo': '/web/binary/company_logo?company=%s' % c.company_id.id},
            'published_by': c.published_by.name or '', 'published_date': _dt(c.published_date),
        }

    def _qr_data_uri(self, text):
        try:
            import qrcode
            import qrcode.image.svg
            img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=8)
            buf = io.BytesIO()
            img.save(buf)
            return 'data:image/svg+xml;base64,' + base64.b64encode(buf.getvalue()).decode()
        except Exception:  # noqa: BLE001
            return False

    @api.model
    def analysis(self, concours_id, refresh=False, use_llm=False):
        require_group(self.env, G_ADMIN, G_JURY)
        import json
        c = self.env['selecta.concours'].browse(int(concours_id))
        c.check_access('read')
        c.company_id._selecta_guard('analysis', concours=c)
        if c.analysis_json and not refresh and not use_llm and c.state == 'published':
            return json.loads(c.analysis_json)
        data = self.env['selecta.ai'].analyze(c, use_llm=use_llm)
        c.sudo().with_context(selecta_engine=True).write({
            'analysis_json': json.dumps(data, ensure_ascii=False, default=str), 'analysis_date': fields.Datetime.now()})
        return data

    # ------------------------------------------------------------------ audit
    @api.model
    def audit_list(self, offset=0, limit=80, concours_id=False, search=''):
        require_group(self.env, G_ADMIN, G_JURY)
        domain = []
        if concours_id:
            domain.append(('concours_id', '=', int(concours_id)))
        if search:
            domain += ['|', ('event', 'ilike', search), ('message', 'ilike', search)]
        Log = self.env['selecta.audit.log']
        logs = Log.search(domain, offset=int(offset), limit=int(limit))
        return {
            'total': Log.search_count(domain),
            'rows': [{'id': l.id, 'sequence': l.sequence, 'date': _dt(l.date), 'user': l.user_label, 'event': l.event,
                      'message': l.message, 'concours': l.concours_id.name or '', 'payload': l.payload,
                      'hash': l.hash, 'prev_hash': l.prev_hash, 'ip': l.ip_address or ''} for l in logs],
        }

    @api.model
    def audit_verify(self):
        require_group(self.env, G_ADMIN, G_JURY)
        res = self.env['selecta.audit.log'].sudo().verify_chain(self.env.company.id)
        self.env['selecta.audit.log']._log('audit.verify', _("Vérification d'intégrité du journal : %s",
                                                             'conforme' if res['ok'] else 'ANOMALIE'), res)
        return res

    # ------------------------------------------------------------------ personnel & accès
    @api.model
    def staff_list(self):
        require_group(self.env, G_ADMIN)
        groups = [self.env.ref(g) for g in ROLE_GROUPS.values()]
        users = self.env['res.users'].sudo().with_context(active_test=False).search(
            [('groups_id', 'in', [g.id for g in groups]), ('share', '=', False),
             ('company_id', '=', self.env.company.id), ('id', '!=', self.env.ref('base.user_root').id)])
        out = []
        for u in users:
            role = next((r for r in ('admin', 'jury', 'concepteur', 'surveillant') if u.has_group(ROLE_GROUPS[r])), None)
            out.append({'id': u.id, 'name': u.name, 'login': u.login, 'email': u.email or '', 'active': u.active,
                        'role': role, 'role_label': ROLE_LABELS.get(role, ''), 'is_system': u.has_group('base.group_system'),
                        'login_date': _dt(u.login_date), 'is_me': u.id == self.env.uid})
        return {'users': out, 'roles': [{'key': k, 'label': v} for k, v in ROLE_LABELS.items()]}

    @api.model
    def staff_save(self, vals):
        require_group(self.env, G_ADMIN)
        role = vals.get('role')
        if role not in ROLE_GROUPS:
            raise UserError(_("Rôle invalide."))
        Users = self.env['res.users'].sudo()
        role_group = self.env.ref(ROLE_GROUPS[role])
        all_role_ids = [self.env.ref(g).id for g in ROLE_GROUPS.values()]
        password = vals.get('password') or ''
        if password and len(password) < 10:
            raise UserError(_("Le mot de passe doit comporter au moins 10 caractères."))
        if vals.get('id'):
            user = self._staff_user(vals['id'])
            if user.has_group('base.group_system') and user.id != self.env.uid:
                raise AccessError(_("Un administrateur système ne peut être modifié depuis SELECTA."))
            write = {'name': vals.get('name') or user.name, 'email': vals.get('email') or False}
            cmds = [(3, gid) for gid in all_role_ids] + [(4, role_group.id)]
            write['groups_id'] = cmds
            if password:
                write['password'] = password
            user.write(write)
        else:
            if not vals.get('login') or not password:
                raise UserError(_("Identifiant et mot de passe obligatoires."))
            self.env.company._selecta_guard('staff.create')
            user = Users.create({
                'name': vals.get('name') or vals['login'], 'login': vals['login'].strip(), 'email': vals.get('email') or False,
                'password': password, 'company_id': self.env.company.id, 'company_ids': [(6, 0, [self.env.company.id])],
                'groups_id': [(6, 0, [self.env.ref('base.group_user').id, role_group.id])],
            })
            # Le contact du compte appartient à la structure : invisible des autres organisations.
            user.partner_id.company_id = self.env.company
        self.env['selecta.audit.log']._log('staff.save', _("Compte %(l)s : rôle %(r)s", l=user.login, r=ROLE_LABELS[role]),
                                           {'user_id': user.id, 'password_changed': bool(password)})
        return self.staff_list()

    def _staff_user(self, user_id):
        """Compte du personnel de la structure courante ; toute autre organisation est hors d'atteinte."""
        user = self.env['res.users'].sudo().with_context(active_test=False).browse(int(user_id)).exists()
        if not user or user.company_id != self.env.company or (user.company_ids - self.env.company):
            raise AccessError(_("Ce compte n'appartient pas à votre structure."))
        return user

    @api.model
    def staff_toggle(self, user_id):
        require_group(self.env, G_ADMIN)
        user = self._staff_user(user_id)
        if user.id == self.env.uid or user.has_group('base.group_system'):
            raise AccessError(_("Opération interdite sur ce compte."))
        if not user.active:
            self.env.company._selecta_guard('staff.create')
        user.active = not user.active
        self.env['selecta.audit.log']._log('staff.toggle', _("Compte %(l)s %(s)s", l=user.login,
                                                             s='activé' if user.active else 'désactivé'), {})
        return self.staff_list()

    # ------------------------------------------------------------------ paramètres
    @api.model
    def settings_get(self):
        require_group(self.env, G_ADMIN)
        icp = self.env['ir.config_parameter'].sudo()
        company = self.env.company
        return {
            'company_id': company.id,
            'can_edit_platform': self.env.user.has_group('base.group_system'),
            'branding': company._selecta_feature('branding'),
            'company_name': company.name, 'brand_color': company.selecta_brand_color or '#0B5FFF',
            'tagline': company.selecta_tagline or '',
            'llm_enabled': icp.get_param('selecta.llm_enabled') in ('True', 'true', '1'),
            'llm_endpoint': icp.get_param('selecta.llm_endpoint') or '',
            'llm_model': icp.get_param('selecta.llm_model') or '',
            'llm_has_key': bool(icp.get_param('selecta.llm_api_key')),
            'login_max_failures': int(icp.get_param('selecta.login_max_failures', 8)),
            'login_lock_minutes': int(icp.get_param('selecta.login_lock_minutes', 15)),
            'biometric_retention_days': int(icp.get_param('selecta.biometric_retention_days', 180)),
            'base_url': icp.get_param('web.base.url') or '',
        } if self.env.user.has_group('base.group_system') else {
            'company_id': company.id, 'can_edit_platform': False, 'branding': company._selecta_feature('branding'),
            'company_name': company.name, 'brand_color': company.selecta_brand_color or '#0B5FFF',
            'tagline': company.selecta_tagline or '',
        }

    @api.model
    def settings_save(self, vals):
        require_group(self.env, G_ADMIN)
        icp = self.env['ir.config_parameter'].sudo()
        company = self.env.company.sudo()
        cvals = {}
        if vals.get('company_name') and vals['company_name'].strip() != company.name:
            name = vals['company_name'].strip()
            if self.env['res.company'].sudo().search_count([('name', '=ilike', name), ('id', '!=', company.id)]):
                raise UserError(_("Une autre structure porte déjà ce nom."))
            cvals['name'] = name
        if not company._selecta_feature('branding'):
            vals = {k: v for k, v in vals.items() if k not in ('brand_color', 'tagline', 'logo_data')}
        if 'brand_color' in vals:
            cvals['selecta_brand_color'] = vals['brand_color']
        if 'tagline' in vals:
            cvals['selecta_tagline'] = vals['tagline']
        if vals.get('logo_data'):
            cvals['logo'] = vals['logo_data'].split(',', 1)[-1]
        if cvals:
            company.write(cvals)
        # Paramètres communs à toutes les structures hébergées (point d'accès réseau, secrets,
        # anti force brute) : jamais modifiables par l'administrateur d'une organisation.
        if self.env.user.has_group('base.group_system'):
            mapping = {'llm_enabled': 'selecta.llm_enabled', 'llm_endpoint': 'selecta.llm_endpoint',
                       'llm_model': 'selecta.llm_model', 'login_max_failures': 'selecta.login_max_failures',
                       'login_lock_minutes': 'selecta.login_lock_minutes',
                       'biometric_retention_days': 'selecta.biometric_retention_days'}
            for k, p in mapping.items():
                if k in vals:
                    icp.set_param(p, str(vals[k]))
            if vals.get('llm_api_key'):
                icp.set_param('selecta.llm_api_key', vals['llm_api_key'])
        self.env['selecta.audit.log']._log('settings.save', _("Mise à jour des paramètres"),
                                           {k: v for k, v in vals.items() if k not in ('llm_api_key', 'logo_data')})
        return self.settings_get()

    @api.model
    def llm_test(self):
        require_group(self.env, 'base.group_system')
        fake = {'stats': {'n': 0}, 'reliability': None, 'categories': [], 'items': [], 'integrity_score': 100,
                'fraud': {'collusion': [], 'speed': []}, 'population': {'disqualified': 0},
                'concours': {'threshold': 50}}
        return self.env['selecta.ai']._llm_enrich(fake)
