# -*- coding: utf-8 -*-
"""Moteur d'analyse IA des résultats (100 % local, sans dépendance externe).

1. Psychométrie classique (TCT) : difficulté, discrimination (27 %), point-bisérial, KR-20.
2. Analyse des distracteurs et détection de clés de correction suspectes.
3. Détection de fraude : collusion (réponses fausses identiques, modèle de Poisson),
   vitesse anormale (z-score robuste MAD), réponses au hasard, risque de surveillance.
4. Synthèse rédigée par un système expert ; enrichissement optionnel par un LLM local
   (Ollama / LM Studio / tout point d'accès compatible OpenAI) — données anonymisées.
"""
import json
import logging
import math
import statistics
from collections import Counter, defaultdict

import requests

from odoo import api, fields, models, _

_logger = logging.getLogger(__name__)


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _std(xs):
    return statistics.pstdev(xs) if len(xs) > 1 else 0.0


def _poisson_sf(k, lam):
    """P(X >= k) pour X ~ Poisson(lam)."""
    if k <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    term = math.exp(-lam)
    cdf = term
    for i in range(1, k):
        term *= lam / i
        cdf += term
    return max(0.0, 1.0 - cdf)


def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = _mean(xs), _mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if not sx or not sy:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


class SelectaAI(models.AbstractModel):
    _name = 'selecta.ai'
    _description = 'Moteur IA d\'analyse SELECTA'

    # ------------------------------------------------------------------ point d'entrée
    @api.model
    def analyze(self, concours, use_llm=False):
        concours = concours.sudo()
        attempts = self.env['selecta.attempt'].sudo().search([('concours_id', '=', concours.id)])
        done = attempts.filtered(lambda a: a.state in ('submitted', 'expired'))
        disq = attempts.filtered(lambda a: a.state == 'disqualified')
        result = {
            'generated_at': fields.Datetime.to_string(fields.Datetime.now()),
            'concours': {'name': concours.name, 'reference': concours.reference,
                         'threshold': concours.pass_threshold, 'places': concours.places},
            'population': {
                'registered': len(concours.candidate_ids), 'composed': len(done),
                'disqualified': len(disq),
                'absent': len(concours.candidate_ids.filtered(lambda c: c.state in ('absent', 'registered'))),
                'in_progress': len(attempts.filtered(lambda a: a.state == 'in_progress')),
            },
        }
        if not done:
            result.update(stats=None, items=[], categories=[], fraud={'collusion': [], 'speed': [], 'random': [],
                                                                     'proctoring': []},
                          threshold_simulation=[], reliability=None, integrity_score=None,
                          insights=[{'level': 'info', 'text': _("Aucune copie corrigée pour le moment : "
                                                                "l'analyse sera disponible dès les premiers résultats.")}],
                          narrative='', llm=None)
            return result

        answers = self.env['selecta.attempt.answer'].sudo().search([('attempt_id', 'in', done.ids)])
        by_attempt = defaultdict(dict)
        for a in answers:
            by_attempt[a.attempt_id.id][a.question_id.id] = a
        questions = self.env['selecta.question'].sudo().with_context(active_test=False).browse(
            sorted({a.question_id.id for a in answers}))
        pcts = {att.id: att.percentage for att in done}

        result['stats'] = self._global_stats(done, concours)
        result['items'] = self._item_analysis(done, questions, by_attempt, pcts)
        result['reliability'] = self._kr20(done, questions, by_attempt)
        result['categories'] = self._categories(questions, by_attempt, result['items'])
        result['threshold_simulation'] = self._threshold_simulation(done, concours)
        result['fraud'] = {
            'collusion': self._collusion(done, questions, by_attempt),
            'speed': self._speed_anomalies(done),
            'random': self._random_guessers(done, questions),
            'proctoring': self._proctoring_risk(attempts),
        }
        result['integrity_score'] = self._integrity_score(result)
        result['insights'] = self._insights(result)
        result['narrative'] = self._narrative(result)
        result['llm'] = self._llm_enrich(result) if use_llm else None
        return result

    # ------------------------------------------------------------------ statistiques
    def _global_stats(self, done, concours):
        p = [a.percentage for a in done]
        durations = [a.duration_seconds for a in done if a.duration_seconds]
        hist = [0] * 10
        for v in p:
            hist[min(9, int(v // 10))] += 1
        mean, sd = _mean(p), _std(p)
        skew = (sum((x - mean) ** 3 for x in p) / len(p)) / (sd ** 3) if sd else 0.0
        return {
            'n': len(p), 'mean': round(mean, 2), 'median': round(statistics.median(p), 2),
            'std': round(sd, 2), 'min': round(min(p), 2), 'max': round(max(p), 2),
            'pass_rate': round(100.0 * sum(1 for a in done if a.passed) / len(done), 1),
            'passed': sum(1 for a in done if a.passed),
            'histogram': hist, 'skewness': round(skew, 3),
            'median_duration': int(statistics.median(durations)) if durations else 0,
        }

    def _item_analysis(self, done, questions, by_attempt, pcts):
        ranked = sorted(done, key=lambda a: pcts[a.id])
        k = max(1, int(round(len(ranked) * 0.27)))
        lower = {a.id for a in ranked[:k]}
        upper = {a.id for a in ranked[-k:]}
        items = []
        for q in questions:
            correct_ids = set(q.choice_ids.filtered('is_correct').ids)
            rows = [(aid, ans) for aid, d in by_attempt.items() if (ans := d.get(q.id))]
            if not rows:
                continue
            n = len(rows)
            scores = [1.0 if ans.is_correct else 0.0 for _aid, ans in rows]
            p_val = _mean(scores)
            blank = sum(1 for _aid, ans in rows if not ans.choice_ids)
            up = [1.0 if ans.is_correct else 0.0 for aid, ans in rows if aid in upper]
            lo = [1.0 if ans.is_correct else 0.0 for aid, ans in rows if aid in lower]
            disc = round(_mean(up) - _mean(lo), 3) if up and lo else None
            rpb = _pearson(scores, [pcts[aid] for aid, _ans in rows])
            choice_stats = []
            suspicious_key = False
            for ch in q.choice_ids:
                cnt = sum(1 for _aid, ans in rows if ch.id in ans.choice_ids.ids)
                cnt_up = sum(1 for aid, ans in rows if aid in upper and ch.id in ans.choice_ids.ids)
                cnt_lo = sum(1 for aid, ans in rows if aid in lower and ch.id in ans.choice_ids.ids)
                choice_stats.append({'id': ch.id, 'text': ch.name, 'correct': ch.id in correct_ids,
                                     'rate': round(100.0 * cnt / n, 1), 'upper': cnt_up, 'lower': cnt_lo})
            key_up = max([c['upper'] for c in choice_stats if c['correct']] or [0])
            for c in choice_stats:
                if not c['correct'] and c['upper'] > key_up and c['upper'] >= 2:
                    suspicious_key = True
            flags = []
            if p_val >= 0.9:
                flags.append('too_easy')
            if p_val <= 0.2:
                flags.append('too_hard')
            if disc is not None and disc < 0:
                flags.append('negative_discrimination')
            elif disc is not None and disc < 0.2 and n >= 10:
                flags.append('weak_discrimination')
            if suspicious_key:
                flags.append('suspicious_key')
            dead = [c for c in choice_stats if not c['correct'] and c['rate'] == 0]
            if dead and n >= 20:
                flags.append('dead_distractor')
            quality = 'excellent' if disc is not None and disc >= 0.4 else 'good' if disc is not None and disc >= 0.3 \
                else 'fair' if disc is not None and disc >= 0.2 else 'poor'
            items.append({
                'id': q.id, 'text': q.name, 'category': q.category_id.name or _('Sans matière'),
                'type': q.qtype, 'n': n, 'difficulty': round(p_val, 3), 'discrimination': disc,
                'point_biserial': round(rpb, 3) if rpb is not None else None,
                'blank_rate': round(100.0 * blank / n, 1), 'choices': choice_stats,
                'flags': flags, 'quality': quality,
            })
        items.sort(key=lambda i: (0 if ('suspicious_key' in i['flags'] or 'negative_discrimination' in i['flags']) else 1,
                                  i['discrimination'] if i['discrimination'] is not None else 1))
        return items

    def _kr20(self, done, questions, by_attempt):
        n_att = len(done)
        if n_att < 5:
            return None
        common = [q.id for q in questions
                  if sum(1 for a in done if q.id in by_attempt.get(a.id, {})) >= 0.8 * n_att]
        if len(common) < 3:
            return None
        complete = [a for a in done if all(qid in by_attempt.get(a.id, {}) for qid in common)]
        if len(complete) < 5:
            return None
        totals = []
        pq = 0.0
        for qid in common:
            p = _mean([1.0 if by_attempt[a.id][qid].is_correct else 0.0 for a in complete])
            pq += p * (1 - p)
        for a in complete:
            totals.append(sum(1 for qid in common if by_attempt[a.id][qid].is_correct))
        var = statistics.pvariance(totals) if len(totals) > 1 else 0.0
        k = len(common)
        if not var:
            return None
        kr = (k / (k - 1)) * (1 - pq / var)
        sem = math.sqrt(var) * math.sqrt(max(0.0, 1 - kr))
        label = (_('Excellente') if kr >= 0.9 else _('Bonne') if kr >= 0.8 else _('Acceptable') if kr >= 0.7
                 else _('Discutable') if kr >= 0.6 else _('Insuffisante'))
        return {'kr20': round(kr, 3), 'label': label, 'items': k, 'sem_items': round(sem, 2),
                'sem_percent': round(100.0 * sem / k, 1)}

    def _categories(self, questions, by_attempt, items):
        agg = defaultdict(lambda: {'n': 0, 'ok': 0, 'questions': 0})
        item_map = {i['id']: i for i in items}
        for q in questions:
            name = q.category_id.name or _('Sans matière')
            agg[name]['questions'] += 1
            it = item_map.get(q.id)
            if it:
                agg[name]['n'] += it['n']
                agg[name]['ok'] += it['difficulty'] * it['n']
        rows = [{'name': k, 'questions': v['questions'],
                 'success': round(100.0 * v['ok'] / v['n'], 1) if v['n'] else 0.0} for k, v in agg.items()]
        return sorted(rows, key=lambda r: r['success'])

    def _threshold_simulation(self, done, concours):
        pcts = [a.percentage for a in done]
        sim = []
        for t in range(30, 95, 5):
            sim.append({'threshold': t, 'admitted': sum(1 for p in pcts if p >= t)})
        if concours.places:
            ordered = sorted(pcts, reverse=True)
            cutoff = ordered[concours.places - 1] if len(ordered) >= concours.places else None
            return {'grid': sim, 'cutoff_for_places': cutoff}
        return {'grid': sim, 'cutoff_for_places': None}

    # ------------------------------------------------------------------ fraude
    def _collusion(self, done, questions, by_attempt, limit=800):
        """Paires dont le nombre de réponses FAUSSES IDENTIQUES est statistiquement improbable."""
        att = list(done)[:limit]
        wrong_sig = {}
        same_prob = {}
        for q in questions:
            wrong = Counter()
            for a in att:
                ans = by_attempt.get(a.id, {}).get(q.id)
                if ans and ans.choice_ids and not ans.is_correct:
                    wrong[tuple(sorted(ans.choice_ids.ids))] += 1
            total = sum(wrong.values())
            same_prob[q.id] = sum((c / total) ** 2 for c in wrong.values()) if total > 1 else 0.0
        for a in att:
            wrong_sig[a.id] = {qid: tuple(sorted(ans.choice_ids.ids))
                               for qid, ans in by_attempt.get(a.id, {}).items()
                               if ans.choice_ids and not ans.is_correct}
        flagged = []
        ids = [a.id for a in att]
        info = {a.id: a for a in att}
        for i in range(len(ids)):
            wi = wrong_sig[ids[i]]
            if len(wi) < 3:
                continue
            for j in range(i + 1, len(ids)):
                wj = wrong_sig[ids[j]]
                if len(wj) < 3:
                    continue
                common = wi.keys() & wj.keys()
                if len(common) < 3:
                    continue
                same = sum(1 for qid in common if wi[qid] == wj[qid])
                lam = sum(same_prob[qid] for qid in common)
                if same >= 4:
                    p = _poisson_sf(same, lam)
                    if p < 0.001:
                        a1, a2 = info[ids[i]], info[ids[j]]
                        flagged.append({
                            'a': a1.candidate_id.name, 'a_ref': a1.candidate_id.reference, 'a_room': a1.candidate_id.room or '',
                            'b': a2.candidate_id.name, 'b_ref': a2.candidate_id.reference, 'b_room': a2.candidate_id.room or '',
                            'identical_wrong': same, 'common_wrong': len(common), 'expected': round(lam, 2),
                            'p_value': float('%.2e' % p),
                            'same_room': bool(a1.candidate_id.room and a1.candidate_id.room == a2.candidate_id.room),
                        })
        flagged.sort(key=lambda f: f['p_value'])
        return flagged[:50]

    def _speed_anomalies(self, done):
        rows = [(a, a.duration_seconds) for a in done if a.duration_seconds]
        if len(rows) < 5:
            return []
        durs = [d for _a, d in rows]
        med = statistics.median(durs)
        mad = statistics.median([abs(d - med) for d in durs]) or 1.0
        p75 = sorted(a.percentage for a in done)[int(len(done) * 0.75) - 1] if len(done) >= 4 else 100
        out = []
        for a, d in rows:
            z = 0.6745 * (d - med) / mad
            if z < -3.0 and a.percentage >= p75 and d < med * 0.5:
                out.append({'name': a.candidate_id.name, 'reference': a.candidate_id.reference,
                            'duration': d, 'median': int(med), 'percentage': a.percentage,
                            'robust_z': round(z, 2)})
        return sorted(out, key=lambda r: r['robust_z'])

    def _random_guessers(self, done, questions):
        """Profils compatibles avec des réponses au hasard (score ≈ chance et composition éclair)."""
        if not questions:
            return []
        chance = _mean([1.0 / max(2, len(q.choice_ids)) for q in questions]) * 100
        durs = [a.duration_seconds for a in done if a.duration_seconds]
        med = statistics.median(durs) if durs else 0
        return [{'name': a.candidate_id.name, 'reference': a.candidate_id.reference,
                 'percentage': a.percentage, 'duration': a.duration_seconds, 'chance_level': round(chance, 1)}
                for a in done
                if a.percentage <= chance * 1.15 and med and a.duration_seconds and a.duration_seconds < med * 0.4]

    def _proctoring_risk(self, attempts):
        weights = {'critical': 40, 'warning': 12, 'info': 1}
        rows = []
        for a in attempts:
            ev = a.event_ids.sudo()
            if not ev:
                continue
            score = min(100, sum(weights.get(e.severity, 0) for e in ev))
            types = Counter(e.event_type for e in ev if e.severity != 'info')
            if score >= 12:
                rows.append({'name': a.candidate_id.name, 'reference': a.candidate_id.reference,
                             'risk': score, 'state': a.state, 'events': dict(types),
                             'warnings': a.warnings_count})
        return sorted(rows, key=lambda r: -r['risk'])[:50]

    def _integrity_score(self, r):
        n = max(1, r['population']['composed'] + r['population']['disqualified'])
        penalty = 0.0
        penalty += 30.0 * min(1.0, len(r['fraud']['collusion']) * 2 / n)
        penalty += 20.0 * min(1.0, len(r['fraud']['speed']) / n * 5)
        penalty += 25.0 * min(1.0, r['population']['disqualified'] / n * 4)
        penalty += 10.0 * min(1.0, len([p for p in r['fraud']['proctoring'] if p['risk'] >= 40]) / n * 4)
        bad_keys = len([i for i in r['items'] if 'suspicious_key' in i['flags']])
        penalty += min(15.0, bad_keys * 5.0)
        return int(round(max(0.0, 100.0 - penalty)))

    # ------------------------------------------------------------------ synthèse
    def _insights(self, r):
        out = []
        s = r['stats']
        rel = r['reliability']
        if rel:
            lvl = 'success' if rel['kr20'] >= 0.8 else 'warning' if rel['kr20'] >= 0.6 else 'danger'
            out.append({'level': lvl, 'text': _("Fiabilité de l'épreuve (KR-20) : %(v)s — %(l)s. "
                                                 "Erreur-type de mesure ≈ ±%(sem)s points de pourcentage.",
                                                 v=rel['kr20'], l=rel['label'], sem=rel['sem_percent'])})
        bad = [i for i in r['items'] if 'suspicious_key' in i['flags'] or 'negative_discrimination' in i['flags']]
        if bad:
            out.append({'level': 'danger', 'text': _("%s question(s) présentent une discrimination négative ou une clé "
                                                     "de correction suspecte : à vérifier par le jury avant publication.",
                                                     len(bad))})
        easy = [i for i in r['items'] if 'too_easy' in i['flags']]
        hard = [i for i in r['items'] if 'too_hard' in i['flags']]
        if easy:
            out.append({'level': 'info', 'text': _("%s question(s) trop faciles (≥ 90 %% de réussite) : faible pouvoir "
                                                   "de sélection.", len(easy))})
        if hard:
            out.append({'level': 'warning', 'text': _("%s question(s) très difficiles (≤ 20 %% de réussite) : vérifier "
                                                      "l'énoncé et le programme.", len(hard))})
        if r['categories']:
            weakest = r['categories'][0]
            strongest = r['categories'][-1]
            if weakest['name'] != strongest['name']:
                out.append({'level': 'info', 'text': _("Matière la mieux maîtrisée : %(a)s (%(pa)s %%). "
                                                       "La moins maîtrisée : %(b)s (%(pb)s %%).",
                                                       a=strongest['name'], pa=strongest['success'],
                                                       b=weakest['name'], pb=weakest['success'])})
        col = r['fraud']['collusion']
        if col:
            same_room = len([c for c in col if c['same_room']])
            out.append({'level': 'danger', 'text': _("%(n)s paire(s) de candidats partagent un nombre improbable de "
                                                     "réponses fausses identiques (p < 0,001), dont %(s)s dans la même "
                                                     "salle : présomption de collusion à instruire.",
                                                     n=len(col), s=same_room)})
        if r['fraud']['speed']:
            out.append({'level': 'warning', 'text': _("%s candidat(s) obtiennent un score élevé avec une durée de "
                                                      "composition anormalement courte (z robuste < −3).",
                                                      len(r['fraud']['speed']))})
        if r['population']['disqualified']:
            out.append({'level': 'warning', 'text': _("%s candidat(s) disqualifié(s) par la surveillance IA.",
                                                      r['population']['disqualified'])})
        if s and abs(s['skewness']) > 1:
            out.append({'level': 'info', 'text': _("Distribution des notes asymétrique (%s) : l'épreuve est %s pour "
                                                   "cette population.", s['skewness'],
                                                   _('trop difficile') if s['skewness'] > 0 else _('trop facile'))})
        sim = r['threshold_simulation']
        if sim and sim.get('cutoff_for_places') is not None:
            out.append({'level': 'info', 'text': _("Pour pourvoir les %(p)s places, la barre effective se situe à "
                                                   "%(c)s %%.", p=r['concours']['places'], c=sim['cutoff_for_places'])})
        return out

    def _narrative(self, r):
        s = r['stats']
        pop = r['population']
        parts = [_("Le concours « %(n)s » a réuni %(c)s copie(s) corrigée(s) sur %(i)s inscrit(s). "
                   "La moyenne s'établit à %(m)s %% (médiane %(md)s %%, écart-type %(sd)s), "
                   "avec un taux de réussite de %(pr)s %% au seuil de %(t)s %%.",
                   n=r['concours']['name'], c=pop['composed'], i=pop['registered'], m=s['mean'], md=s['median'],
                   sd=s['std'], pr=s['pass_rate'], t=r['concours']['threshold'])]
        parts.append(_("Indice d'intégrité global : %s/100.", r['integrity_score']))
        return ' '.join(parts)

    def _llm_enrich(self, r):
        icp = self.env['ir.config_parameter'].sudo()
        if not self.env.company._selecta_feature('llm'):
            return {'ok': False, 'error': _("L'assistant de rédaction n'est pas inclus dans votre abonnement.")}
        if icp.get_param('selecta.llm_enabled') not in ('True', 'true', '1'):
            return {'ok': False, 'error': _("Assistant LLM désactivé dans les paramètres.")}
        endpoint = icp.get_param('selecta.llm_endpoint')
        model = icp.get_param('selecta.llm_model')
        key = icp.get_param('selecta.llm_api_key')
        # Données agrégées et anonymisées uniquement : aucun nom de candidat n'est transmis.
        digest = {
            'stats': r['stats'], 'reliability': r['reliability'], 'categories': r['categories'],
            'items': [{k: i[k] for k in ('category', 'difficulty', 'discrimination', 'blank_rate', 'flags')}
                      for i in r['items'][:40]],
            'fraud': {'collusion_pairs': len(r['fraud']['collusion']), 'speed_anomalies': len(r['fraud']['speed']),
                      'disqualified': r['population']['disqualified']},
            'integrity_score': r['integrity_score'], 'threshold': r['concours']['threshold'],
        }
        prompt = ("Tu es un expert en psychométrie et en organisation de concours administratifs. "
                  "À partir des statistiques JSON suivantes (anonymisées), rédige en français un rapport "
                  "concis pour le jury : 1) qualité de l'épreuve, 2) questions à revoir, 3) risques de fraude, "
                  "4) recommandations concrètes pour la délibération et la prochaine session.\n\n"
                  + json.dumps(digest, ensure_ascii=False))
        headers = {'Content-Type': 'application/json'}
        if key:
            headers['Authorization'] = 'Bearer %s' % key
        try:
            resp = requests.post(endpoint, json={
                'model': model, 'temperature': 0.2,
                'messages': [{'role': 'system', 'content': "Réponds en français, de façon factuelle et structurée."},
                             {'role': 'user', 'content': prompt}],
            }, headers=headers, timeout=90)
            resp.raise_for_status()
            text = resp.json()['choices'][0]['message']['content']
            return {'ok': True, 'model': model, 'text': text}
        except Exception as exc:  # noqa: BLE001 - l'analyse locale reste disponible
            _logger.warning("SELECTA LLM indisponible : %s", exc)
            return {'ok': False, 'error': _("Assistant LLM injoignable (%s). L'analyse experte locale reste valable.",
                                            str(exc)[:120])}
