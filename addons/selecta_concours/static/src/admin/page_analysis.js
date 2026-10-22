/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { Icon, notify } from "@selecta_concours/common/ui";
import { fmtDateTime, fmtDuration, fmtPct } from "@selecta_concours/common/utils";
import { ConcoursPicker } from "@selecta_concours/admin/page_monitor";

const FLAGS = {
    too_easy: ["Trop facile", ""],
    too_hard: ["Très difficile", "sl-badge-warn"],
    negative_discrimination: ["Discrimination négative", "sl-badge-danger"],
    weak_discrimination: ["Peu discriminante", "sl-badge-warn"],
    suspicious_key: ["Clé suspecte", "sl-badge-danger"],
    dead_distractor: ["Distracteur inutile", ""],
};
const QUALITY = { excellent: "Excellente", good: "Bonne", fair: "Moyenne", poor: "Faible" };
const EVENT_SHORT = {
    face_absent: "absence", multiple_faces: "plusieurs personnes", look_away: "regard", identity_mismatch: "identité",
    camera_lost: "caméra", tab_hidden: "onglet", window_blur: "focus", fullscreen_exit: "plein écran", copy_paste: "copier-coller",
    shortcut: "raccourci", devtools: "outils dév.", manual: "surveillant",
};

export class AnalysisPage extends Component {
    static components = { Icon, ConcoursPicker };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div><h1>Analyse IA des résultats</h1><p class="sl-muted">Qualité de l'épreuve, questions à revoir et indices de fraude, calculés localement sur le serveur.</p></div>
                <div class="ad-head-actions">
                    <ConcoursPicker list="state.list" value="props.concoursId" onPick.bind="pick"/>
                    <button t-if="props.concoursId" class="sl-btn" t-att-disabled="state.loading" t-on-click="() => this.load(true)"><Icon name="'refresh'"/>Recalculer</button>
                    <button t-if="props.concoursId" class="sl-btn sl-btn-ink" t-att-disabled="state.loading" t-on-click="() => this.load(true, true)"><Icon name="'brain'"/>Rapport rédigé (LLM local)</button>
                </div>
            </header>
            <div t-if="state.loading" class="ad-loading"><span class="sl-spinner"/> Analyse en cours…</div>
            <t t-elif="state.data">
                <t t-set="d" t-value="state.data"/>
                <section class="ad-analysis-hero">
                    <div class="ad-integrity" t-att-class="integrityClass">
                        <span class="sl-figures" t-esc="d.integrity_score === null ? '—' : d.integrity_score"/>
                        <small>indice d'intégrité sur 100</small>
                    </div>
                    <div class="sl-grow">
                        <p class="ad-narrative" t-esc="d.narrative or 'Analyse disponible dès les premières copies corrigées.'"/>
                        <ul class="ad-insights">
                            <li t-foreach="d.insights" t-as="i" t-key="i_index" t-att-class="'is-' + i.level" t-esc="i.text"/>
                        </ul>
                        <div class="sl-muted ad-small">Calculé le <t t-esc="date(d.generated_at)"/></div>
                    </div>
                </section>

                <section t-if="d.llm" class="ad-panel">
                    <div class="ad-panel-head"><h2>Rapport rédigé par l'assistant</h2><span t-if="d.llm.ok" class="sl-badge sl-badge-info" t-esc="d.llm.model"/></div>
                    <div t-if="d.llm.ok" class="ad-llm" t-esc="d.llm.text"/>
                    <div t-else="" class="sl-alert sl-alert-warn" t-esc="d.llm.error"/>
                </section>

                <div t-if="d.stats" class="ad-grid-2">
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Distribution des résultats</h2></div>
                        <div class="ad-hist" role="img" aria-label="Histogramme des pourcentages">
                            <div t-foreach="d.stats.histogram" t-as="h" t-key="h_index" class="ad-hist-col" t-att-class="{'is-pass': (h_index + 1) * 10 gt d.concours.threshold}">
                                <span class="ad-hist-n" t-esc="h or ''"/>
                                <div class="ad-hist-bar" t-attf-style="height: {{histHeight(h)}}%"/>
                                <span class="ad-hist-label" t-esc="h_index * 10"/>
                            </div>
                        </div>
                        <dl class="ad-statlist">
                            <div><dt>Copies</dt><dd t-esc="d.stats.n"/></div>
                            <div><dt>Moyenne</dt><dd t-esc="pct(d.stats.mean)"/></div>
                            <div><dt>Médiane</dt><dd t-esc="pct(d.stats.median)"/></div>
                            <div><dt>Écart-type</dt><dd t-esc="d.stats.std"/></div>
                            <div><dt>Minimum / maximum</dt><dd><t t-esc="pct(d.stats.min)"/> / <t t-esc="pct(d.stats.max)"/></dd></div>
                            <div><dt>Taux de réussite</dt><dd t-esc="pct(d.stats.pass_rate)"/></div>
                            <div><dt>Durée médiane</dt><dd t-esc="dur(d.stats.median_duration)"/></div>
                            <div><dt>Fiabilité KR-20</dt><dd t-if="d.reliability"><t t-esc="d.reliability.kr20"/> (<t t-esc="d.reliability.label"/>)</dd><dd t-else="" class="sl-muted">effectif insuffisant</dd></div>
                        </dl>
                    </section>
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Réussite par matière</h2></div>
                        <div class="ad-bars">
                            <div t-foreach="d.categories" t-as="c" t-key="c.name" class="ad-bar-row">
                                <span class="ad-bar-label"><t t-esc="c.name"/> <span class="sl-muted">(<t t-esc="c.questions"/> q.)</span></span>
                                <div class="ad-bar"><div t-attf-style="width: {{c.success}}%" t-att-class="c.success lt 40 ? 'is-ko' : c.success lt 60 ? 'is-mid' : 'is-ok'"/></div>
                                <span class="sl-figures ad-bar-value" t-esc="pct(c.success)"/>
                            </div>
                        </div>
                        <h3 class="ad-subtitle">Simulation du seuil</h3>
                        <div class="ad-sim">
                            <div t-foreach="d.threshold_simulation.grid or []" t-as="s" t-key="s.threshold" t-att-class="{'is-current': s.threshold == d.concours.threshold}">
                                <span class="sl-figures" t-esc="s.admitted"/><small><t t-esc="s.threshold"/> %</small>
                            </div>
                        </div>
                        <p class="sl-help">Nombre de candidats qui atteindraient chaque seuil.<t t-if="d.threshold_simulation.cutoff_for_places !== null and d.threshold_simulation.cutoff_for_places !== undefined"> Barre effective pour les places disponibles : <strong t-esc="pct(d.threshold_simulation.cutoff_for_places)"/>.</t></p>
                    </section>
                </div>

                <section class="ad-panel" t-if="d.items.length">
                    <div class="ad-panel-head"><h2>Analyse des questions</h2><span class="sl-muted ad-small">Difficulté = taux de bonnes réponses. Discrimination = écart de réussite entre les 27 % meilleurs et les 27 % plus faibles.</span></div>
                    <table class="ad-table">
                        <thead><tr><th>Question</th><th class="num">Réponses</th><th class="num">Difficulté</th><th class="num">Discrimination</th><th>Qualité</th><th>Signalements</th><th/></tr></thead>
                        <tbody>
                            <t t-foreach="d.items" t-as="it" t-key="it.id">
                                <tr class="is-link" t-on-click="() => this.state.open = this.state.open == it.id ? 0 : it.id">
                                    <td><div class="ad-clamp" t-esc="it.text"/><div class="sl-muted ad-small" t-esc="it.category"/></td>
                                    <td class="num" t-esc="it.n"/>
                                    <td class="num"><div class="ad-scorebar"><div t-attf-style="width: {{it.difficulty * 100}}%" class="is-ok"/><span class="sl-figures" t-esc="pct(it.difficulty * 100)"/></div></td>
                                    <td class="num sl-figures" t-att-class="it.discrimination !== null and it.discrimination lt 0 ? 'ad-danger-text' : ''" t-esc="it.discrimination === null ? '—' : it.discrimination"/>
                                    <td t-esc="quality[it.quality]"/>
                                    <td><span t-foreach="it.flags" t-as="f" t-key="f" t-attf-class="sl-badge {{flags[f][1]}} ad-mr" t-esc="flags[f][0]"/></td>
                                    <td class="num"><Icon name="state.open == it.id ? 'chevronLeft' : 'chevronRight'" size="16"/></td>
                                </tr>
                                <tr t-if="state.open == it.id" class="ad-detail">
                                    <td colspan="7">
                                        <div class="ad-distractors">
                                            <div t-foreach="it.choices" t-as="ch" t-key="ch.id" class="ad-distractor" t-att-class="{'is-correct': ch.correct}">
                                                <span class="ad-bar-label"><Icon t-if="ch.correct" name="'check'" size="14"/><t t-esc="ch.text"/></span>
                                                <div class="ad-bar"><div t-attf-style="width: {{ch.rate}}%" t-att-class="ch.correct ? 'is-ok' : 'is-mid'"/></div>
                                                <span class="sl-figures ad-bar-value" t-esc="pct(ch.rate)"/>
                                                <span class="sl-muted ad-small">meilleurs <t t-esc="ch.upper"/>, plus faibles <t t-esc="ch.lower"/></span>
                                            </div>
                                        </div>
                                        <p class="sl-help">Taux de non-réponse : <t t-esc="pct(it.blank_rate)"/>. Corrélation point-bisériale : <t t-esc="it.point_biserial === null ? '—' : it.point_biserial"/>.</p>
                                    </td>
                                </tr>
                            </t>
                        </tbody>
                    </table>
                </section>

                <section class="ad-panel" t-if="d.stats">
                    <div class="ad-panel-head"><h2>Détection de fraude</h2></div>
                    <h3 class="ad-subtitle">Collusion : réponses fausses identiques improbables</h3>
                    <p t-if="!d.fraud.collusion.length" class="sl-muted">Aucune paire suspecte (seuil statistique p &lt; 0,001).</p>
                    <table t-else="" class="ad-table">
                        <thead><tr><th>Candidat A</th><th>Candidat B</th><th class="num">Fausses identiques</th><th class="num">Attendu par hasard</th><th class="num">Probabilité</th><th/></tr></thead>
                        <tbody>
                            <tr t-foreach="d.fraud.collusion" t-as="p" t-key="p_index">
                                <td><strong t-esc="p.a"/><div class="sl-muted ad-small"><t t-esc="p.a_ref"/> <t t-esc="p.a_room"/></div></td>
                                <td><strong t-esc="p.b"/><div class="sl-muted ad-small"><t t-esc="p.b_ref"/> <t t-esc="p.b_room"/></div></td>
                                <td class="num sl-figures"><t t-esc="p.identical_wrong"/> / <t t-esc="p.common_wrong"/></td>
                                <td class="num sl-figures" t-esc="p.expected"/>
                                <td class="num sl-mono" t-esc="p.p_value"/>
                                <td><span t-if="p.same_room" class="sl-badge sl-badge-danger">Même salle</span></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="ad-grid-2">
                        <div>
                            <h3 class="ad-subtitle">Vitesse anormale avec score élevé</h3>
                            <p t-if="!d.fraud.speed.length" class="sl-muted">Aucune anomalie.</p>
                            <ul class="ad-plain">
                                <li t-foreach="d.fraud.speed" t-as="s" t-key="s.reference"><strong t-esc="s.name"/>, <t t-esc="pct(s.percentage)"/> en <t t-esc="dur(s.duration)"/> (médiane <t t-esc="dur(s.median)"/>, z = <t t-esc="s.robust_z"/>)</li>
                            </ul>
                            <h3 class="ad-subtitle">Profils de réponse au hasard</h3>
                            <p t-if="!d.fraud.random.length" class="sl-muted">Aucun profil.</p>
                            <ul class="ad-plain">
                                <li t-foreach="d.fraud.random" t-as="s" t-key="s.reference"><strong t-esc="s.name"/>, <t t-esc="pct(s.percentage)"/> (hasard ≈ <t t-esc="pct(s.chance_level)"/>) en <t t-esc="dur(s.duration)"/></li>
                            </ul>
                        </div>
                        <div>
                            <h3 class="ad-subtitle">Risque issu de la surveillance</h3>
                            <p t-if="!d.fraud.proctoring.length" class="sl-muted">Aucun candidat à risque.</p>
                            <ul class="ad-risk">
                                <li t-foreach="d.fraud.proctoring" t-as="p" t-key="p.reference">
                                    <div class="sl-grow"><strong t-esc="p.name"/><div class="sl-muted ad-small" t-esc="eventsText(p.events)"/></div>
                                    <div class="ad-riskbar"><div t-attf-style="width: {{p.risk}}%"/></div>
                                    <span class="sl-figures" t-esc="p.risk"/>
                                </li>
                            </ul>
                        </div>
                    </div>
                </section>
            </t>
            <div t-elif="!props.concoursId" class="ad-empty ad-panel"><p>Choisissez un concours pour lancer l'analyse.</p></div>
        </div>`;
    static props = ["concoursId"];

    setup() {
        this.state = useState({ list: [], data: null, loading: false, open: 0 });
        this.flags = FLAGS;
        this.quality = QUALITY;
        onWillStart(async () => {
            this.state.list = (await api("concours_list")).filter((c) => ["open", "closed", "published"].includes(c.state));
            if (this.props.concoursId) {
                await this.load(false);
            }
        });
    }
    async load(refresh, llm = false) {
        this.state.loading = true;
        try {
            this.state.data = await api("analysis", [this.props.concoursId, refresh, llm]);
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.loading = false;
        }
    }
    pick(id) {
        location.hash = `#/analysis/${id}`;
    }
    get integrityClass() {
        const s = this.state.data.integrity_score;
        if (s === null || s === undefined) {
            return "";
        }
        return s >= 85 ? "is-ok" : s >= 60 ? "is-mid" : "is-ko";
    }
    histHeight(h) {
        const max = Math.max(1, ...this.state.data.stats.histogram);
        return Math.round((100 * h) / max);
    }
    eventsText(ev) {
        return Object.entries(ev || {}).map(([k, v]) => `${EVENT_SHORT[k] || k} ×${v}`).join(", ");
    }
    pct(v) {
        return fmtPct(v, 1);
    }
    dur(v) {
        return fmtDuration(v);
    }
    date(v) {
        return fmtDateTime(v);
    }
}
