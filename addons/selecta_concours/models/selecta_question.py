# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError

from .selecta_concours import is_engine

LOCKED_STATES = ('open', 'closed', 'published')
_DESIGN_GROUPS = 'selecta_concours.group_selecta_concepteur,selecta_concours.group_selecta_jury'


class SelectaQuestionCategory(models.Model):
    _name = 'selecta.question.category'
    _description = 'Catégorie / matière de questions'
    _order = 'sequence, name'

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    color = fields.Char(default='#0B5FFF')
    company_id = fields.Many2one('res.company', default=lambda s: s.env.company, required=True)
    question_count = fields.Integer(compute='_compute_question_count')

    def write(self, vals):
        if 'company_id' in vals and not self.env.su:
            raise AccessError(_("Une matière ne peut pas changer de structure."))
        return super().write(vals)

    def _compute_question_count(self):
        data = self.env['selecta.question']._read_group(
            [('category_id', 'in', self.ids)], ['category_id'], ['__count'])
        mapped = {cat.id: count for cat, count in data}
        for rec in self:
            rec.question_count = mapped.get(rec.id, 0)


class SelectaQuestion(models.Model):
    _name = 'selecta.question'
    _description = 'Question QCM'
    _order = 'category_id, sequence, id'
    _check_company_auto = True

    name = fields.Text(string="Énoncé", required=True)
    sequence = fields.Integer(default=10)
    category_id = fields.Many2one('selecta.question.category', string="Matière", ondelete='restrict', index=True,
                                  check_company=True)
    qtype = fields.Selection([('single', 'Choix unique'), ('multiple', 'Choix multiples')],
                             default='single', required=True)
    points = fields.Float(default=1.0, required=True)
    difficulty = fields.Selection([('easy', 'Facile'), ('medium', 'Moyenne'), ('hard', 'Difficile')],
                                  default='medium', required=True)
    explanation = fields.Text(string="Explication (jury)", groups=_DESIGN_GROUPS)
    image = fields.Image(max_width=1280, max_height=1280, attachment=True)
    choice_ids = fields.One2many('selecta.choice', 'question_id', copy=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one('res.company', default=lambda s: s.env.company, required=True, index=True)
    concours_ids = fields.Many2many('selecta.concours', 'selecta_concours_question_rel',
                                    'question_id', 'concours_id', string="Concours")

    @api.constrains('points')
    def _check_points(self):
        for q in self:
            if q.points <= 0:
                raise ValidationError(_("Le barème d'une question doit être strictement positif."))

    def _selecta_validate(self):
        """Contrôle de cohérence avant ouverture d'un concours. Retourne la liste des anomalies."""
        problems = []
        for q in self:
            correct = q.choice_ids.sudo().filtered('is_correct')
            label = (q.name or '')[:60]
            if len(q.choice_ids) < 2:
                problems.append(_("« %s » : au moins deux propositions sont requises.", label))
            if not correct:
                problems.append(_("« %s » : aucune bonne réponse définie.", label))
            if q.qtype == 'single' and len(correct) > 1:
                problems.append(_("« %s » : choix unique mais plusieurs bonnes réponses.", label))
        return problems

    def _check_not_locked(self):
        if is_engine(self.env):
            return
        for q in self:
            locked = q.sudo().concours_ids.filtered(lambda c: c.state in LOCKED_STATES)
            if locked:
                raise UserError(_(
                    "La question « %(q)s » est utilisée par le concours « %(c)s » déjà ouvert ou clôturé. "
                    "Elle est figée pour garantir l'équité : dupliquez-la pour créer une nouvelle version.",
                    q=(q.name or '')[:50], c=locked[0].name))

    @api.model_create_multi
    def create(self, vals_list):
        companies = {vals.get('company_id') or self.env.company.id for vals in vals_list}
        for company in self.env['res.company'].browse(companies):
            company._selecta_guard('question.create', count=len(vals_list))
        return super().create(vals_list)

    def write(self, vals):
        if 'company_id' in vals and not self.env.su:
            raise AccessError(_("Une question ne peut pas changer de structure."))
        content_fields = {'name', 'qtype', 'points', 'choice_ids', 'image'}
        if content_fields & set(vals):
            self._check_not_locked()
        return super().write(vals)

    def unlink(self):
        self._check_not_locked()
        return super().unlink()


class SelectaChoice(models.Model):
    _name = 'selecta.choice'
    _description = 'Proposition de réponse'
    _order = 'sequence, id'

    question_id = fields.Many2one('selecta.question', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='question_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char(string="Proposition", required=True)
    # La clé de correction n'est jamais lisible par les surveillants ni exposée aux candidats.
    is_correct = fields.Boolean(string="Bonne réponse", groups=_DESIGN_GROUPS)

    def write(self, vals):
        if not is_engine(self.env):
            self.mapped('question_id')._check_not_locked()
        return super().write(vals)

    def unlink(self):
        if not is_engine(self.env):
            self.mapped('question_id')._check_not_locked()
        return super().unlink()

    @api.model_create_multi
    def create(self, vals_list):
        questions = self.env['selecta.question'].browse([v.get('question_id') for v in vals_list if v.get('question_id')])
        questions._check_not_locked()
        return super().create(vals_list)
