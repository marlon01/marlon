# -*- coding: utf-8 -*-
import hashlib
import ipaddress
import json
import re
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError

G_ADMIN = 'selecta_concours.group_selecta_admin'
G_DESIGN = 'selecta_concours.group_selecta_concepteur'
G_JURY = 'selecta_concours.group_selecta_jury'
G_PROCTOR = 'selecta_concours.group_selecta_surveillant'

# Champs tenus exclusivement par le moteur (cycle de vie, scellés) ; l'ORM n'applique pas
# ``readonly`` aux appels RPC, d'où ce verrou explicite.
ENGINE_FIELDS = {
    'state', 'reference', 'company_id', 'opened_date', 'closed_date', 'published_date', 'published_by',
    'results_hash', 'analysis_json', 'analysis_date', 'biometrics_purged_date',
}
FROZEN_FIELDS = {
    'duration_minutes', 'questions_per_page', 'question_ids', 'nb_questions_drawn', 'shuffle_questions',
    'shuffle_choices', 'pass_threshold', 'places', 'scoring_multi', 'negative_marking', 'negative_ratio',
    'require_all_answers', 'exam_mode', 'venue_networks',
}


def parse_networks(text):
    """« 196.0.1.0/24, 41.243.12.7 » -> réseaux ipaddress ; ValueError si une entrée est invalide."""
    nets = []
    for part in re.split(r'[\s,;]+', text or ''):
        if part:
            nets.append(ipaddress.ip_network(part.strip(), strict=False))
    return nets


def is_engine(env):
    """Opération interne du moteur. Le contexte d'un appel RPC est contrôlé par le client :
    le drapeau seul ne suffit pas, il doit accompagner un environnement superutilisateur."""
    return bool(env.su and env.context.get('selecta_engine'))


def require_group(env, *xmlids):
    if env.su:
        return True
    if not any(env.user.has_group(x) for x in xmlids):
        raise AccessError(_("Vous n'avez pas les droits nécessaires pour cette opération."))
    return True


class SelectaConcours(models.Model):
    _name = 'selecta.concours'
    _description = 'Concours / test de sélection'
    _order = 'date_start desc, id desc'
    _check_company_auto = True

    name = fields.Char(required=True)
    reference = fields.Char(readonly=True, copy=False, index=True)
    company_id = fields.Many2one('res.company', default=lambda s: s.env.company, required=True, index=True)
    description = fields.Text()
    instructions = fields.Text(string="Consignes aux candidats",
                               default="Lisez attentivement chaque question. Une fois une page validée, "
                                       "vous ne pourrez plus y revenir. Restez face à la caméra pendant "
                                       "toute la durée de l'épreuve.")
    state = fields.Selection([
        ('draft', 'Préparation'), ('ready', 'Prêt'), ('open', 'En cours'),
        ('closed', 'Clôturé'), ('published', 'Résultats publiés')],
        default='draft', required=True, index=True, readonly=True)
    date_start = fields.Datetime(string="Ouverture des connexions")
    date_end = fields.Datetime(string="Fermeture des connexions")
    auto_close = fields.Boolean(default=True,
                                string="Clôture automatique quand tous les candidats ont terminé")

    # --- Règles d'épreuve -------------------------------------------------
    duration_minutes = fields.Integer(default=60, required=True)
    # Mode de passage. Par défaut, en ligne mais en présentiel, dans les locaux de la structure ;
    # à distance, chaque candidat compose là où il se trouve, sous surveillance par webcam.
    exam_mode = fields.Selection([
        ('onsite', "En ligne, en présentiel dans nos locaux"),
        ('remote', "En ligne, à distance"),
    ], string="Mode de passage", default='onsite', required=True)
    exam_venue = fields.Char(string="Lieu de l'épreuve",
                             help="Adresse et salles où les candidats composent, rappelées sur la convocation.")
    venue_networks = fields.Char(
        string="Réseaux de la salle d'examen",
        help="Adresses IP ou plages (ex. 196.0.1.0/24) des postes de la salle, séparées par des virgules. "
             "En présentiel, une connexion venue d'ailleurs est refusée. Vide : pas de contrôle par le réseau.")
    questions_per_page = fields.Integer(default=5, required=True)
    question_ids = fields.Many2many('selecta.question', 'selecta_concours_question_rel',
                                    'concours_id', 'question_id', string="Questions", check_company=True)
    nb_questions_drawn = fields.Integer(default=0, string="Questions tirées par candidat (0 = toutes)")
    shuffle_questions = fields.Boolean(default=True)
    shuffle_choices = fields.Boolean(default=True)
    pass_threshold = fields.Float(default=50.0, string="Seuil de réussite (%)")
    places = fields.Integer(default=0, string="Nombre de places (0 = illimité)")
    scoring_multi = fields.Selection([('all_or_nothing', 'Tout ou rien'), ('partial', 'Crédit partiel')],
                                     default='all_or_nothing', required=True)
    negative_marking = fields.Boolean(default=False)
    negative_ratio = fields.Float(default=0.25)
    require_all_answers = fields.Boolean(default=True, string="Réponse obligatoire à chaque question")
    show_result = fields.Boolean(default=True, string="Afficher le résultat au candidat")

    # --- Surveillance IA ---------------------------------------------------
    proctoring_enabled = fields.Boolean(default=True)
    proctoring_level = fields.Selection([
        ('tolerant', 'Tolérant (5 avertissements)'),
        ('standard', 'Standard (2 avertissements)'),
        ('zero', 'Tolérance zéro (disqualification immédiate)')], default='standard', required=True)
    face_absent_seconds = fields.Integer(default=5)
    look_away_seconds = fields.Integer(default=4)
    identity_check = fields.Boolean(default=True, string="Contrôle continu d'identité faciale")
    require_fullscreen = fields.Boolean(default=True)
    offline_prefetch = fields.Boolean(default=True, string="Mode résilience (préchargement hors-ligne)")
    grace_seconds = fields.Integer(default=10, string="Tolérance réseau (s)")
    offline_tolerance_seconds = fields.Integer(default=180, string="Tolérance de synchronisation hors-ligne (s)")

    # --- Relations / résultats --------------------------------------------
    candidate_ids = fields.One2many('selecta.candidate', 'concours_id')
    attempt_ids = fields.One2many('selecta.attempt', 'concours_id')
    question_count = fields.Integer(compute='_compute_counts')
    candidate_count = fields.Integer(compute='_compute_counts')
    max_score = fields.Float(compute='_compute_counts')
    opened_date = fields.Datetime(readonly=True)
    closed_date = fields.Datetime(readonly=True)
    published_date = fields.Datetime(readonly=True)
    published_by = fields.Many2one('res.users', readonly=True)
    results_hash = fields.Char(readonly=True, copy=False, index=True)
    analysis_json = fields.Text(readonly=True, copy=False)
    analysis_date = fields.Datetime(readonly=True, copy=False)
    biometrics_purged_date = fields.Datetime(readonly=True, copy=False,
                                             string="Données biométriques effacées le")

    _sql_constraints = [
        ('duration_pos', 'CHECK(duration_minutes > 0)', "La durée doit être positive."),
        ('qpp_pos', 'CHECK(questions_per_page > 0)', "Le nombre de questions par page doit être positif."),
        ('threshold_range', 'CHECK(pass_threshold >= 0 AND pass_threshold <= 100)',
         "Le seuil doit être compris entre 0 et 100 %."),
    ]

    @api.depends('question_ids', 'candidate_ids', 'nb_questions_drawn')
    def _compute_counts(self):
        for c in self:
            # Comptages seulement : aucune donnée de question n'est exposée (surveillants inclus).
            questions = c.sudo().question_ids
            c.question_count = len(questions)
            c.candidate_count = len(c.sudo().candidate_ids)
            pts = sorted(questions.mapped('points'), reverse=True)
            n = c.nb_questions_drawn or len(pts)
            c.max_score = sum(pts[:n])

    @api.constrains('exam_mode', 'proctoring_enabled', 'identity_check', 'venue_networks')
    def _check_exam_mode(self):
        for c in self:
            if c.exam_mode == 'remote' and not (c.proctoring_enabled and c.identity_check):
                raise ValidationError(_("À distance, personne ne surveille la salle : la surveillance par webcam et "
                                        "le contrôle continu d'identité sont obligatoires."))
            try:
                parse_networks(c.venue_networks)
            except ValueError:
                raise ValidationError(_("Réseaux de la salle d'examen : « %s » n'est pas une adresse IP ou une plage "
                                        "valide (ex. 196.0.1.0/24).", c.venue_networks))

    def _venue_allows(self, ip):
        """En présentiel, avec des réseaux déclarés : la connexion doit venir d'un poste de la salle."""
        self.ensure_one()
        if self.exam_mode != 'onsite' or not (self.venue_networks or '').strip():
            return True
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(addr in net for net in parse_networks(self.venue_networks))

    @api.constrains('date_start', 'date_end')
    def _check_dates(self):
        for c in self:
            if c.date_start and c.date_end and c.date_end <= c.date_start:
                raise ValidationError(_("La fermeture doit être postérieure à l'ouverture."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not self.env.su and (ENGINE_FIELDS - {'company_id'}) & set(vals):
                raise AccessError(_("Ces informations sont gérées par le moteur SELECTA."))
            company = self.env['res.company'].browse(vals.get('company_id')) if vals.get('company_id') else self.env.company
            company._selecta_guard('concours.create')
            if not vals.get('reference'):
                Sequence = self.env['ir.sequence'].sudo()
                own = Sequence.search([('code', '=', 'selecta.concours'), ('company_id', '=', company.id)], limit=1)
                vals['reference'] = (own.next_by_id() if own else Sequence.next_by_code('selecta.concours')) or '/'
        records = super().create(vals_list)
        for rec in records:
            self.env['selecta.audit.log']._log('concours.create', _("Création du concours %s", rec.name),
                                               {'reference': rec.reference}, concours=rec)
        return records

    def write(self, vals):
        if not self.env.su and ENGINE_FIELDS & set(vals):
            raise AccessError(_("Ces informations sont gérées par le moteur SELECTA (cycle de vie, scellés)."))
        if not is_engine(self.env):
            if FROZEN_FIELDS & set(vals):
                for c in self:
                    if c.state not in ('draft', 'ready'):
                        raise UserError(_("Les règles d'un concours ouvert ou clôturé sont figées."))
        res = super().write(vals)
        if not is_engine(self.env) and (FROZEN_FIELDS & set(vals)):
            for c in self:
                self.env['selecta.audit.log']._log('concours.rules', _("Modification des règles"),
                                                   {k: str(v) for k, v in vals.items() if k in FROZEN_FIELDS},
                                                   concours=c)
        return res

    def unlink(self):
        for c in self:
            if c.state != 'draft' or c.attempt_ids:
                raise UserError(_("Seul un concours en préparation sans participation peut être supprimé."))
        return super().unlink()

    # ------------------------------------------------------------------ cycle de vie
    def _engine(self):
        return self.sudo().with_context(selecta_engine=True)

    def action_ready(self):
        require_group(self.env, G_ADMIN, G_DESIGN)
        for c in self:
            if c.state != 'draft':
                raise UserError(_("Le concours n'est pas en préparation."))
            if not c.question_ids:
                raise UserError(_("Aucune question n'est associée au concours."))
            problems = c.question_ids._selecta_validate()
            if problems:
                raise UserError(_("Questionnaire incohérent :\n• %s", "\n• ".join(problems[:15])))
            if c.nb_questions_drawn and c.nb_questions_drawn > len(c.question_ids):
                raise UserError(_("Le nombre de questions tirées dépasse la banque sélectionnée."))
            c.company_id._selecta_guard('concours.ready', concours=c)
            c._engine().write({'state': 'ready'})
            self.env['selecta.audit.log']._log('concours.ready', _("Concours validé et prêt"),
                                               {'questions': len(c.question_ids)}, concours=c)
        return True

    def action_back_to_draft(self):
        require_group(self.env, G_ADMIN)
        for c in self:
            if c.state != 'ready':
                raise UserError(_("Retour en préparation possible uniquement depuis l'état « Prêt »."))
            c._engine().write({'state': 'draft'})
            self.env['selecta.audit.log']._log('concours.draft', _("Retour en préparation"), {}, concours=c)
        return True

    def action_open(self):
        require_group(self.env, G_ADMIN)
        for c in self:
            if c.state != 'ready':
                raise UserError(_("Le concours doit être validé avant ouverture."))
            if not c.candidate_ids:
                raise UserError(_("Aucun candidat inscrit."))
            if not c.candidate_ids.filtered('code_hash'):
                raise UserError(_("Générez les codes d'accès des candidats avant l'ouverture."))
            c.company_id._selecta_guard('concours.open', concours=c)
            c._engine().write({'state': 'open', 'opened_date': fields.Datetime.now()})
            snapshot = hashlib.sha256(json.dumps(c._question_snapshot(), sort_keys=True).encode()).hexdigest()
            self.env['selecta.audit.log']._log('concours.open', _("Ouverture de l'épreuve"),
                                               {'questionnaire_sha256': snapshot}, concours=c)
        return True

    def action_close(self):
        require_group(self.env, G_ADMIN, G_JURY)
        for c in self:
            if c.state != 'open':
                raise UserError(_("Le concours n'est pas en cours."))
            c._do_close(_("Clôture manuelle"))
        return True

    def _do_close(self, reason):
        self.ensure_one()
        attempts = self.env['selecta.attempt'].sudo().search(
            [('concours_id', '=', self.id), ('state', 'in', ('ready', 'in_progress'))])
        for att in attempts.with_context(selecta_closing=True):
            if att.state == 'in_progress':
                att._finalize('expired')
            else:
                att._engine().write({'state': 'absent', 'finish_reason': 'Non commencé'})
        self.env['selecta.candidate'].sudo().search([
            ('concours_id', '=', self.id), ('state', 'in', ('registered', 'in_progress'))]).write({'state': 'absent'})
        self._engine().write({'state': 'closed', 'closed_date': fields.Datetime.now()})
        self._compute_ranking()
        self.env['selecta.audit.log']._log('concours.close', reason,
                                           {'finalized': len(attempts)}, concours=self)

    def action_publish(self):
        require_group(self.env, G_ADMIN, G_JURY)
        for c in self:
            if c.state != 'closed':
                raise UserError(_("Seul un concours clôturé peut être publié."))
            c._compute_ranking()
            rows = c._official_rows()
            material = json.dumps({
                'concours': c.reference, 'name': c.name,
                'admis': [(r['rank'], r['reference'], r['name'], r['percentage']) for r in rows],
                'audit_head': self.env['selecta.audit.log'].head_hash(c.company_id.id),
            }, sort_keys=True, ensure_ascii=False)
            digest = hashlib.sha256(material.encode('utf-8')).hexdigest()
            c._engine().write({'state': 'published', 'results_hash': digest,
                               'published_date': fields.Datetime.now(), 'published_by': self.env.uid})
            self.env['selecta.audit.log']._log('concours.publish', _("Publication officielle des résultats"),
                                               {'sha256': digest, 'admis': len(rows)}, concours=c)
        return True

    # ------------------------------------------------------------------ outils
    def _question_snapshot(self):
        self.ensure_one()
        return [{
            'id': q.id, 'name': q.name, 'type': q.qtype, 'points': q.points,
            'choices': [(ch.id, ch.name, ch.is_correct) for ch in q.choice_ids.sudo()],
        } for q in self.question_ids.sudo()]

    def _compute_ranking(self):
        """Classement : % décroissant, puis durée de composition croissante (départage)."""
        for c in self:
            attempts = self.env['selecta.attempt'].sudo().search([
                ('concours_id', '=', c.id), ('state', 'in', ('submitted', 'expired'))])
            ranked = attempts.sorted(lambda a: (-a.percentage, a.duration_seconds or 10 ** 9, a.id))
            for idx, att in enumerate(ranked, start=1):
                admitted = att.passed and (not c.places or idx <= c.places)
                att._engine().write({'rank': idx, 'admitted': admitted})
            others = self.env['selecta.attempt'].sudo().search([
                ('concours_id', '=', c.id), ('state', 'not in', ('submitted', 'expired'))])
            others._engine().write({'rank': 0, 'admitted': False})

    def _official_rows(self):
        self.ensure_one()
        attempts = self.env['selecta.attempt'].sudo().search(
            [('concours_id', '=', self.id), ('admitted', '=', True)], order='rank asc')
        return [{
            'rank': a.rank, 'reference': a.candidate_id.reference, 'name': a.candidate_id.name,
            'percentage': round(a.percentage, 2), 'score': a.score, 'max_score': a.max_score,
        } for a in attempts]

    def _check_auto_close(self):
        for c in self.sudo():
            if c.state != 'open' or not c.auto_close:
                continue
            pending = self.env['selecta.candidate'].sudo().search_count([
                ('concours_id', '=', c.id), ('state', 'in', ('registered', 'in_progress'))])
            if not pending:
                c._do_close(_("Clôture automatique : tous les candidats ont terminé"))

    def _demo_open(self):
        """Données de démonstration : valide et ouvre le concours de test."""
        for c in self.sudo():
            if c.state == 'draft':
                c.action_ready()
            if c.state == 'ready':
                c.action_open()

    # ------------------------------------------------------------------ conservation des données
    @api.model
    def _cron_purge_biometrics(self):
        """Efface photos d'identité, gabarits faciaux et clichés probatoires des concours clôturés
        depuis plus de ``selecta.biometric_retention_days`` jours (0 = conservation illimitée).
        Les résultats, procès-verbaux, journaux et motifs d'incident sont conservés."""
        try:
            days = int(self.env['ir.config_parameter'].sudo().get_param('selecta.biometric_retention_days', 180))
        except ValueError:
            days = 180
        if days <= 0:
            return
        limit = fields.Datetime.now() - timedelta(days=days)
        for c in self.sudo().search([('state', 'in', ('closed', 'published')), ('closed_date', '<', limit),
                                     ('biometrics_purged_date', '=', False)], limit=50):
            c._purge_biometrics()

    def _purge_biometrics(self):
        self.ensure_one()
        engine = {'selecta_engine': True}
        cands = self.env['selecta.candidate'].sudo().search([('concours_id', '=', self.id)])
        cands.filtered('photo_reference').write({'photo_reference': False})
        attempts = self.env['selecta.attempt'].sudo().search([('concours_id', '=', self.id)])
        attempts.filtered('identity_descriptor').with_context(**engine).write({'identity_descriptor': False})
        events = self.env['selecta.proctor.event'].sudo().search([('concours_id', '=', self.id)])
        events.filtered('snapshot').with_context(**engine).write({'snapshot': False})
        self._engine().write({'biometrics_purged_date': fields.Datetime.now()})
        self.env['selecta.audit.log']._log('privacy.purge', _("Effacement des données biométriques (durée de conservation échue)"),
                                           {'photos': len(cands), 'snapshots': len(events)}, concours=self)

    @api.model
    def _cron_housekeeping(self):
        """Expire les épreuves dont le temps est écoulé et ferme les concours arrivés à échéance."""
        self.env['selecta.attempt'].sudo()._expire_overdue()
        now = fields.Datetime.now()
        for c in self.sudo().search([('state', '=', 'open'), ('date_end', '!=', False), ('date_end', '<', now)]):
            # On laisse finir les candidats déjà en composition.
            running = self.env['selecta.attempt'].sudo().search_count(
                [('concours_id', '=', c.id), ('state', '=', 'in_progress')])
            if not running:
                c._do_close(_("Clôture automatique : fenêtre de connexion expirée"))
        self.sudo().search([('state', '=', 'open')])._check_auto_close()
