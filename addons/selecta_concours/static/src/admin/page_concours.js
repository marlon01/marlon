/** @odoo-module */
import { Component, onWillStart, onWillUpdateProps, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import {
    CANDIDATE_BADGE, CANDIDATE_LABELS, fmtDateTime, fmtPct, fromLocalInput, parseCSV, readFileAsText,
    STATE_BADGE, STATE_LABELS, toLocalInput,
} from "@selecta_concours/common/utils";
import { hasRole, store } from "@selecta_concours/admin/store";
import { printConvocations } from "@selecta_concours/admin/print";

// ======================================================================= liste
export class ConcoursListPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page">
            <header class="ad-head">
                <div><h1>Concours</h1><p class="sl-muted">Préparez, ouvrez et clôturez vos épreuves de sélection.</p></div>
                <div class="ad-head-actions"><a t-if="isAdmin" href="#/concours?new=1" class="sl-btn sl-btn-primary"><Icon name="'plus'"/>Nouveau concours</a></div>
            </header>
            <div class="ad-filters">
                <button t-foreach="filters" t-as="f" t-key="f.key" class="ad-chip" t-att-class="{'is-active': state.filter == f.key}" t-on-click="() => this.state.filter = f.key">
                    <t t-esc="f.label"/> <span class="sl-muted" t-esc="count(f.key)"/>
                </button>
            </div>
            <section class="ad-panel ad-panel-flush">
                <table class="ad-table">
                    <thead><tr><th>Concours</th><th>État</th><th>Ouverture</th><th class="num">Durée</th><th class="num">Questions</th><th class="num">Inscrits</th><th class="num">Corrigés</th><th class="num">Réussis</th><th/></tr></thead>
                    <tbody>
                        <tr t-foreach="rows" t-as="c" t-key="c.id" class="is-link" t-on-click="() => this.open(c.id)">
                            <td><strong t-esc="c.name"/><div class="sl-muted sl-mono ad-small" t-esc="c.reference"/></td>
                            <td><span t-attf-class="sl-badge {{badge[c.state]}}" t-esc="labels[c.state]"/></td>
                            <td t-esc="date(c.date_start)"/>
                            <td class="num"><t t-esc="c.duration_minutes"/> min</td>
                            <td class="num" t-esc="c.questions"/>
                            <td class="num" t-esc="c.candidates"/>
                            <td class="num" t-esc="c.finished"/>
                            <td class="num" t-esc="c.passed"/>
                            <td class="num"><Icon name="'chevronRight'"/></td>
                        </tr>
                    </tbody>
                </table>
                <div t-if="state.loaded and !rows.length" class="ad-empty">
                    <p>Aucun concours dans cette catégorie.</p>
                    <a t-if="isAdmin" href="#/concours?new=1" class="sl-btn sl-btn-sm">Créer un concours</a>
                </div>
            </section>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ rows: [], filter: "all", loaded: false });
        this.labels = STATE_LABELS;
        this.badge = STATE_BADGE;
        this.filters = [
            { key: "all", label: "Tous" }, { key: "draft", label: "Préparation" }, { key: "ready", label: "Prêts" },
            { key: "open", label: "En cours" }, { key: "closed", label: "Clôturés" }, { key: "published", label: "Publiés" },
        ];
        onWillStart(async () => {
            this.state.rows = await api("concours_list");
            this.state.loaded = true;
        });
    }
    get isAdmin() {
        return hasRole("admin");
    }
    get rows() {
        return this.state.filter === "all" ? this.state.rows : this.state.rows.filter((r) => r.state === this.state.filter);
    }
    count(key) {
        return key === "all" ? this.state.rows.length : this.state.rows.filter((r) => r.state === key).length;
    }
    date(v) {
        return fmtDateTime(v);
    }
    open(id) {
        location.hash = `#/concours/${id}`;
    }
}

// ======================================================================= édition
const DEFAULTS = {
    id: 0, name: "", description: "", instructions: "Lisez attentivement chaque question. Une fois une page validée, vous ne pourrez plus y revenir. Restez face à la caméra pendant toute la durée de l'épreuve.",
    date_start: false, date_end: false, auto_close: true, duration_minutes: 60, questions_per_page: 5, nb_questions_drawn: 0,
    shuffle_questions: true, shuffle_choices: true, pass_threshold: 50, places: 0, scoring_multi: "all_or_nothing",
    negative_marking: false, negative_ratio: 0.25, require_all_answers: true, show_result: true, proctoring_enabled: true,
    proctoring_level: "standard", face_absent_seconds: 5, look_away_seconds: 4, identity_check: true, require_fullscreen: true,
    offline_prefetch: true, grace_seconds: 10, offline_tolerance_seconds: 180, state: "draft", question_ids: [],
};

const STEPS = [
    { key: "draft", label: "Préparation" }, { key: "ready", label: "Validé" }, { key: "open", label: "Épreuve ouverte" },
    { key: "closed", label: "Clôturé" }, { key: "published", label: "Publié" },
];

export class ConcoursEditPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page" t-if="state.loaded">
            <t t-set="c" t-value="state.c"/>
            <header class="ad-head">
                <div class="sl-grow">
                    <a href="#/concours" class="ad-back"><Icon name="'chevronLeft'" size="16"/>Concours</a>
                    <h1 t-esc="c.name or 'Nouveau concours'"/>
                    <p class="sl-muted"><span class="sl-mono" t-esc="c.reference or 'Référence attribuée à l’enregistrement'"/></p>
                </div>
                <div class="ad-head-actions">
                    <t t-if="c.id">
                        <a t-if="c.state == 'open' and canMonitor" t-att-href="'#/monitor/' + c.id" class="sl-btn"><Icon name="'eye'"/>Surveiller</a>
                        <a t-if="['open','closed','published'].includes(c.state) and canJury" t-att-href="'#/results/' + c.id" class="sl-btn"><Icon name="'chart'"/>Résultats</a>
                        <button t-if="isAdmin" class="sl-btn sl-btn-ghost sl-btn-icon" title="Dupliquer" t-on-click="duplicate"><Icon name="'copy'"/></button>
                        <button t-if="isAdmin and c.state == 'draft'" class="sl-btn sl-btn-ghost sl-btn-icon" title="Supprimer" t-on-click="remove"><Icon name="'trash'"/></button>
                    </t>
                    <button t-if="canEdit" class="sl-btn sl-btn-primary" t-att-disabled="state.saving" t-on-click="save"><Icon name="'check'"/>Enregistrer</button>
                </div>
            </header>

            <ol t-if="c.id" class="ad-stepper">
                <li t-foreach="steps" t-as="s" t-key="s.key" t-att-class="{'is-done': stepIndex(s.key) lt stepIndex(c.state), 'is-current': s.key == c.state}">
                    <span class="sl-figures" t-esc="s_index + 1"/><t t-esc="s.label"/>
                </li>
                <li class="ad-stepper-action">
                    <button t-if="c.state == 'draft' and canDesign" class="sl-btn sl-btn-ink" t-on-click="() => this.lifecycle('ready')"><Icon name="'check'"/>Valider le questionnaire</button>
                    <button t-if="c.state == 'ready' and isAdmin" class="sl-btn" t-on-click="() => this.lifecycle('draft')">Revenir en préparation</button>
                    <button t-if="c.state == 'ready' and isAdmin" class="sl-btn sl-btn-primary" t-on-click="() => this.lifecycle('open')"><Icon name="'play'"/>Ouvrir l'épreuve</button>
                    <button t-if="c.state == 'open' and canJury" class="sl-btn sl-btn-danger" t-on-click="() => this.lifecycle('close')"><Icon name="'stop'"/>Clôturer</button>
                    <button t-if="c.state == 'closed' and canJury" class="sl-btn sl-btn-primary" t-on-click="() => this.lifecycle('publish')"><Icon name="'lock'"/>Publier et sceller</button>
                </li>
            </ol>
            <div t-if="locked" class="sl-alert sl-alert-info ad-mb">Les règles et le questionnaire sont figés depuis l'ouverture de l'épreuve : aucun candidat ne peut être avantagé par une modification en cours de route.</div>

            <nav class="ad-tabs" role="tablist">
                <button t-foreach="tabs" t-as="t" t-key="t.key" role="tab" t-att-aria-selected="state.tab == t.key ? 'true' : 'false'"
                        class="ad-tab" t-att-class="{'is-active': state.tab == t.key}" t-att-disabled="!c.id and t.needsId"
                        t-on-click="() => this.setTab(t.key)">
                    <t t-esc="t.label"/><span t-if="t.count !== undefined" class="ad-tab-count" t-esc="t.count"/>
                </button>
            </nav>

            <!-- GÉNÉRAL -->
            <section t-if="state.tab == 'general'" class="ad-panel ad-form">
                <div class="sl-field ad-span-2"><label>Intitulé du concours</label><input class="sl-input" t-model="c.name" t-att-disabled="!canEdit" placeholder="Ex. : Recrutement des agents de guichet, session 2026"/></div>
                <div class="sl-field ad-span-2"><label>Description interne</label><textarea class="sl-textarea" t-model="c.description" t-att-disabled="!canEdit"/></div>
                <div class="sl-field ad-span-2"><label>Consignes affichées aux candidats</label><textarea class="sl-textarea" rows="4" t-model="c.instructions" t-att-disabled="!canEdit"/></div>
                <div class="sl-field"><label>Ouverture des connexions</label><input type="datetime-local" class="sl-input" t-att-value="local(c.date_start)" t-on-change="(ev) => c.date_start = this.utc(ev.target.value)" t-att-disabled="!canEdit"/><span class="sl-help">Facultatif. Avant cette heure, les codes sont refusés.</span></div>
                <div class="sl-field"><label>Fermeture des connexions</label><input type="datetime-local" class="sl-input" t-att-value="local(c.date_end)" t-on-change="(ev) => c.date_end = this.utc(ev.target.value)" t-att-disabled="!canEdit"/><span class="sl-help">Les candidats déjà en composition terminent leur épreuve.</span></div>
                <label class="ad-toggle ad-span-2"><span class="sl-switch"><input type="checkbox" t-model="c.auto_close" t-att-disabled="!canEdit"/><span/></span><span><strong>Clôture automatique</strong><span class="sl-help">Dès que tous les inscrits ont terminé, le concours est clôturé et la liste des admis produite.</span></span></label>
            </section>

            <!-- RÈGLES -->
            <section t-if="state.tab == 'rules'" class="ad-panel ad-form">
                <div class="sl-field"><label>Durée de l'épreuve (minutes)</label><input type="number" min="1" class="sl-input" t-model.number="c.duration_minutes" t-att-disabled="frozen"/><span class="sl-help">Décomptée pour chaque candidat à partir de l'affichage du questionnaire.</span></div>
                <div class="sl-field"><label>Questions par page</label><input type="number" min="1" class="sl-input" t-model.number="c.questions_per_page" t-att-disabled="frozen"/><span class="sl-help">Une page validée ne peut plus être consultée.</span></div>
                <div class="sl-field"><label>Questions tirées par candidat</label><input type="number" min="0" class="sl-input" t-model.number="c.nb_questions_drawn" t-att-disabled="frozen"/><span class="sl-help">0 = toutes les questions sélectionnées. Sinon, tirage aléatoire individuel dans la sélection.</span></div>
                <div class="sl-field"><label>Seuil de réussite (%)</label><input type="number" min="0" max="100" step="0.5" class="sl-input" t-model.number="c.pass_threshold" t-att-disabled="frozen"/></div>
                <div class="sl-field"><label>Nombre de places</label><input type="number" min="0" class="sl-input" t-model.number="c.places" t-att-disabled="frozen"/><span class="sl-help">0 = tous les candidats au-dessus du seuil sont admis. Sinon, les meilleurs dans la limite des places.</span></div>
                <div class="sl-field"><label>Questions à réponses multiples</label>
                    <select class="sl-select" t-model="c.scoring_multi" t-att-disabled="frozen">
                        <option value="all_or_nothing">Tout ou rien</option>
                        <option value="partial">Crédit partiel (bonnes moins mauvaises)</option>
                    </select>
                </div>
                <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.shuffle_questions" t-att-disabled="frozen"/><span/></span><span><strong>Mélanger l'ordre des questions</strong><span class="sl-help">Chaque candidat reçoit un ordre différent : le voisin n'est d'aucune aide.</span></span></label>
                <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.shuffle_choices" t-att-disabled="frozen"/><span/></span><span><strong>Mélanger les propositions</strong><span class="sl-help">La réponse « B » d'un candidat n'est pas celle de son voisin.</span></span></label>
                <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.require_all_answers" t-att-disabled="frozen"/><span/></span><span><strong>Réponse obligatoire</strong><span class="sl-help">Une page ne se valide que si toutes ses questions ont une réponse.</span></span></label>
                <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.negative_marking" t-att-disabled="frozen"/><span/></span><span><strong>Pénalité pour réponse fausse</strong><span class="sl-help">Décourage les réponses au hasard.</span></span></label>
                <div t-if="c.negative_marking" class="sl-field"><label>Pénalité (fraction du barème)</label><input type="number" min="0" max="1" step="0.05" class="sl-input" t-model.number="c.negative_ratio" t-att-disabled="frozen"/></div>
                <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.show_result" t-att-disabled="!canEdit"/><span/></span><span><strong>Afficher le résultat au candidat</strong><span class="sl-help">Pourcentage et décision visibles dès la dernière page.</span></span></label>
                <h3 class="ad-span-2 ad-form-title">Résilience réseau</h3>
                <label class="ad-toggle ad-span-2"><span class="sl-switch"><input type="checkbox" t-model="c.offline_prefetch" t-att-disabled="frozen"/><span/></span><span><strong>Préchargement sécurisé du questionnaire</strong><span class="sl-help">En cas de coupure du réseau local, le candidat continue de composer ; ses réponses sont synchronisées au retour du réseau. Le corrigé ne quitte jamais le serveur.</span></span></label>
                <div class="sl-field"><label>Tolérance de latence (secondes)</label><input type="number" min="0" class="sl-input" t-model.number="c.grace_seconds" t-att-disabled="frozen"/></div>
                <div class="sl-field"><label>Délai maximal de synchronisation (secondes)</label><input type="number" min="0" class="sl-input" t-model.number="c.offline_tolerance_seconds" t-att-disabled="frozen"/></div>
            </section>

            <!-- SURVEILLANCE -->
            <section t-if="state.tab == 'proctoring'" class="ad-panel ad-form">
                <label class="ad-toggle ad-span-2"><span class="sl-switch"><input type="checkbox" t-model="c.proctoring_enabled" t-att-disabled="!canEdit"/><span/></span><span><strong>Surveillance IA par webcam</strong><span class="sl-help">Analyse vidéo réalisée localement sur chaque poste : aucun flux vidéo n'est transmis, seuls les clichés probatoires des incidents sont conservés.</span></span></label>
                <t t-if="c.proctoring_enabled">
                    <div class="sl-field ad-span-2"><label>Niveau de sévérité</label>
                        <div class="ad-levels">
                            <label t-foreach="levels" t-as="l" t-key="l.key" class="ad-level" t-att-class="{'is-active': c.proctoring_level == l.key}">
                                <input type="radio" name="level" t-att-value="l.key" t-att-checked="c.proctoring_level == l.key" t-on-change="() => c.proctoring_level = l.key" t-att-disabled="!canEdit"/>
                                <strong t-esc="l.label"/><span t-esc="l.help"/>
                            </label>
                        </div>
                    </div>
                    <div class="sl-field"><label>Absence du visage tolérée (secondes)</label><input type="number" min="2" class="sl-input" t-model.number="c.face_absent_seconds" t-att-disabled="!canEdit"/></div>
                    <div class="sl-field"><label>Regard détourné toléré (secondes)</label><input type="number" min="2" class="sl-input" t-model.number="c.look_away_seconds" t-att-disabled="!canEdit"/></div>
                    <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.identity_check" t-att-disabled="!canEdit"/><span/></span><span><strong>Contrôle continu d'identité</strong><span class="sl-help">L'empreinte faciale est comparée toutes les 8 secondes à celle enregistrée au départ. Toute substitution entraîne la disqualification.</span></span></label>
                    <label class="ad-toggle"><span class="sl-switch"><input type="checkbox" t-model="c.require_fullscreen" t-att-disabled="!canEdit"/><span/></span><span><strong>Plein écran obligatoire</strong><span class="sl-help">Toute sortie du plein écran est signalée.</span></span></label>
                    <div class="ad-span-2 ad-rules-table">
                        <table class="ad-table">
                            <thead><tr><th>Comportement détecté</th><th>Sanction</th></tr></thead>
                            <tbody>
                                <tr><td>Autre personne dans le champ, visage différent du candidat, caméra masquée ou coupée, outils développeur</td><td><span class="sl-badge sl-badge-danger">Disqualification immédiate</span></td></tr>
                                <tr><td>Visage absent, regard détourné prolongé, changement d'onglet ou d'application, sortie du plein écran, copier-coller, raccourcis interdits</td><td><span t-attf-class="sl-badge {{c.proctoring_level == 'zero' ? 'sl-badge-danger' : 'sl-badge-warn'}}" t-esc="c.proctoring_level == 'zero' ? 'Disqualification immédiate' : 'Avertissement, puis disqualification au-delà de ' + maxWarnings"/></td></tr>
                            </tbody>
                        </table>
                    </div>
                </t>
            </section>

            <!-- QUESTIONS -->
            <section t-if="state.tab == 'questions'" class="ad-panel">
                <div class="ad-toolbar">
                    <div class="ad-search"><Icon name="'search'" size="16"/><input class="sl-input" placeholder="Rechercher dans la banque" t-model="state.qsearch"/></div>
                    <select class="sl-select ad-w-auto" t-model="state.qcat">
                        <option value="">Toutes les matières</option>
                        <option t-foreach="state.categories" t-as="cat" t-key="cat.id" t-att-value="cat.id" t-esc="cat.name"/>
                    </select>
                    <label class="sl-check"><input type="checkbox" t-model="state.qonly"/>Sélection uniquement</label>
                    <div class="sl-grow"/>
                    <button class="sl-btn sl-btn-sm" t-att-disabled="frozen" t-on-click="() => this.selectVisible(true)">Tout cocher</button>
                    <button class="sl-btn sl-btn-sm" t-att-disabled="frozen" t-on-click="() => this.selectVisible(false)">Tout décocher</button>
                </div>
                <div class="ad-qsummary">
                    <span><b class="sl-figures" t-esc="c.question_ids.length"/> question(s) sélectionnée(s)</span>
                    <span><b class="sl-figures" t-esc="selectedPoints"/> point(s) au total</span>
                    <span><b class="sl-figures" t-esc="pages"/> page(s) par candidat</span>
                    <span t-foreach="selectedByCategory" t-as="sc" t-key="sc.name" class="ad-catpill" t-attf-style="--cat: {{sc.color}}"><t t-esc="sc.name"/> <b t-esc="sc.count"/></span>
                </div>
                <ul class="ad-qlist">
                    <li t-foreach="visibleQuestions" t-as="q" t-key="q.id" t-att-class="{'is-selected': isSelected(q.id)}">
                        <label class="sl-check"><input type="checkbox" t-att-checked="isSelected(q.id)" t-att-disabled="frozen" t-on-change="() => this.toggleQ(q.id)"/></label>
                        <div class="sl-grow">
                            <div class="ad-qtext" t-esc="q.name"/>
                            <div class="ad-qmeta">
                                <span class="ad-catpill" t-attf-style="--cat: {{q.color}}" t-esc="q.category or 'Sans matière'"/>
                                <span t-esc="q.qtype == 'single' ? 'Choix unique' : 'Choix multiples'"/>
                                <span><t t-esc="q.points"/> pt</span>
                                <span t-esc="difficulty[q.difficulty]"/>
                                <span><t t-esc="q.choices.length"/> propositions</span>
                            </div>
                        </div>
                    </li>
                </ul>
                <div t-if="!visibleQuestions.length" class="ad-empty"><p>Aucune question. Alimentez la banque de questions pour constituer le questionnaire.</p><a href="#/questions" class="sl-btn sl-btn-sm">Ouvrir la banque de questions</a></div>
            </section>

            <!-- CANDIDATS -->
            <section t-if="state.tab == 'candidates'" class="ad-panel">
                <div class="ad-toolbar">
                    <div class="ad-search"><Icon name="'search'" size="16"/><input class="sl-input" placeholder="Nom, numéro, salle" t-model="state.csearch"/></div>
                    <div class="sl-grow"/>
                    <t t-if="isAdmin and !['closed','published'].includes(c.state)">
                        <label class="sl-btn sl-btn-sm"><Icon name="'upload'"/>Importer (CSV)<input type="file" accept=".csv,text/csv" class="sl-hidden" t-on-change="importCandidates"/></label>
                        <button class="sl-btn sl-btn-sm" t-on-click="addCandidate"><Icon name="'plus'"/>Inscrire</button>
                        <button class="sl-btn sl-btn-sm sl-btn-ink" t-on-click="() => this.generateCodes(true)" t-att-disabled="!codesMissing"><Icon name="'key'"/>Générer les codes manquants (<t t-esc="codesMissing"/>)</button>
                        <button class="sl-btn sl-btn-sm" t-on-click="() => this.generateCodes(false)" t-att-disabled="!state.selected.length"><Icon name="'refresh'"/>Régénérer la sélection</button>
                    </t>
                </div>
                <p class="sl-help ad-mb">Format CSV : <span class="sl-mono">reference;nom;email;telephone;salle;piece_identite</span>. Les codes d'accès sont hachés : ils ne sont affichés qu'une fois, au moment de l'impression des convocations.</p>
                <div t-if="state.editCand" class="ad-inline-form">
                    <input class="sl-input" placeholder="N° d'inscription" t-model="state.editCand.reference"/>
                    <input class="sl-input" placeholder="Nom complet" t-model="state.editCand.name"/>
                    <input class="sl-input" placeholder="Salle" t-model="state.editCand.room"/>
                    <input class="sl-input" placeholder="E-mail" t-model="state.editCand.email"/>
                    <input class="sl-input" placeholder="Pièce d'identité" t-model="state.editCand.id_document"/>
                    <button class="sl-btn sl-btn-primary" t-on-click="saveCandidate">Enregistrer</button>
                    <button class="sl-btn sl-btn-ghost" t-on-click="() => this.state.editCand = null">Annuler</button>
                </div>
                <table class="ad-table">
                    <thead><tr>
                        <th style="width:34px"><input type="checkbox" t-on-change="(ev) => this.selectAll(ev.target.checked)"/></th>
                        <th>N°</th><th>Candidat</th><th>Salle</th><th>Code</th><th>Statut</th><th class="num">Résultat</th><th/>
                    </tr></thead>
                    <tbody>
                        <tr t-foreach="visibleCandidates" t-as="x" t-key="x.id">
                            <td><input type="checkbox" t-att-checked="state.selected.includes(x.id)" t-on-change="() => this.toggleCand(x.id)"/></td>
                            <td class="sl-mono" t-esc="x.reference"/>
                            <td><strong t-esc="x.name"/><div class="sl-muted ad-small" t-esc="x.email"/></td>
                            <td t-esc="x.room"/>
                            <td><span t-if="x.has_code" class="sl-badge sl-badge-ok" t-att-title="'Généré le ' + date(x.code_generated_at)">Émis</span><span t-else="" class="sl-badge">À générer</span></td>
                            <td><span t-attf-class="sl-badge {{cbadge[x.state]}}" t-esc="clabels[x.state]"/></td>
                            <td class="num" t-esc="x.percentage !== null ? pct(x.percentage) : '—'"/>
                            <td class="num">
                                <t t-if="isAdmin and x.state == 'registered'">
                                    <button class="sl-btn sl-btn-ghost sl-btn-icon" title="Modifier" t-on-click="() => this.editCandidate(x)"><Icon name="'edit'" size="16"/></button>
                                    <button class="sl-btn sl-btn-ghost sl-btn-icon" title="Supprimer" t-on-click="() => this.deleteCandidate(x)"><Icon name="'trash'" size="16"/></button>
                                </t>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div t-if="!state.candidates.length" class="ad-empty"><p>Aucun candidat inscrit. Importez une liste CSV ou inscrivez les candidats un par un.</p></div>
            </section>
        </div>
        <div t-else="" class="ad-loading"><span class="sl-spinner"/></div>`;
    static props = ["concoursId", "tab"];

    setup() {
        this.state = useState({
            loaded: false, c: { ...DEFAULTS }, tab: this.props.tab, saving: false,
            questions: [], categories: [], qsearch: "", qcat: "", qonly: false,
            candidates: [], csearch: "", selected: [], editCand: null,
        });
        this.steps = STEPS;
        this.cbadge = CANDIDATE_BADGE;
        this.clabels = CANDIDATE_LABELS;
        this.difficulty = { easy: "Facile", medium: "Moyenne", hard: "Difficile" };
        this.levels = [
            { key: "tolerant", label: "Tolérant", help: "5 avertissements avant disqualification. Adapté aux tests internes." },
            { key: "standard", label: "Standard", help: "2 avertissements, puis disqualification. Recommandé pour les concours." },
            { key: "zero", label: "Tolérance zéro", help: "Premier comportement suspect : disqualification immédiate." },
        ];
        onWillStart(() => this.load());
        onWillUpdateProps((next) => {
            if (next.tab !== this.props.tab) {
                this.state.tab = next.tab;
            }
        });
    }

    async load() {
        if (this.props.concoursId) {
            this.state.c = await api("concours_get", [this.props.concoursId]);
            if (hasRole("admin", "jury", "surveillant")) {
                this.state.candidates = await api("candidates_list", [this.props.concoursId]);
            }
        } else {
            this.state.c = { ...DEFAULTS, question_ids: [] };
        }
        if (hasRole("admin", "concepteur", "jury")) {
            [this.state.questions, this.state.categories] = await Promise.all([api("questions_list"), api("categories_list")]);
        }
        this.state.loaded = true;
    }

    // ------------------------------------------------------------------ droits & état
    get isAdmin() {
        return hasRole("admin");
    }
    get canDesign() {
        return hasRole("admin", "concepteur");
    }
    get canJury() {
        return hasRole("admin", "jury");
    }
    get canMonitor() {
        return hasRole("admin", "jury", "surveillant");
    }
    get canEdit() {
        return this.canDesign && !["closed", "published"].includes(this.state.c.state);
    }
    get locked() {
        return ["open", "closed", "published"].includes(this.state.c.state);
    }
    get frozen() {
        return !this.canDesign || this.locked;
    }
    get maxWarnings() {
        return { tolerant: 5, standard: 2, zero: 0 }[this.state.c.proctoring_level];
    }
    get tabs() {
        const c = this.state.c;
        const t = [
            { key: "general", label: "Général" },
            { key: "rules", label: "Règles et barème" },
            { key: "proctoring", label: "Surveillance IA" },
        ];
        if (hasRole("admin", "concepteur", "jury")) {
            t.push({ key: "questions", label: "Questionnaire", count: c.question_ids.length });
        }
        if (hasRole("admin", "jury", "surveillant")) {
            t.push({ key: "candidates", label: "Candidats", count: this.state.candidates.length, needsId: true });
        }
        return t;
    }
    stepIndex(k) {
        return STEPS.findIndex((s) => s.key === k);
    }
    setTab(key) {
        this.state.tab = key;
        if (this.state.c.id) {
            history.replaceState(null, "", `#/concours/${this.state.c.id}?tab=${key}`);
        }
    }
    local(v) {
        return toLocalInput(v);
    }
    utc(v) {
        return fromLocalInput(v);
    }
    date(v) {
        return fmtDateTime(v);
    }
    pct(v) {
        return fmtPct(v, 1);
    }

    // ------------------------------------------------------------------ enregistrement & cycle de vie
    async save() {
        const c = this.state.c;
        if (!c.name?.trim()) {
            notify("Donnez un intitulé au concours.", "danger");
            this.state.tab = "general";
            return;
        }
        this.state.saving = true;
        try {
            const vals = { ...c };
            for (const k of ["card", "reference", "state", "max_score", "results_hash", "published_date", "opened_date", "closed_date", "codes_missing", "question_count", "candidate_count", "max_warnings"]) {
                delete vals[k];
            }
            if (this.locked) {
                for (const k of ["question_ids", "duration_minutes", "questions_per_page", "nb_questions_drawn", "shuffle_questions", "shuffle_choices", "pass_threshold", "places", "scoring_multi", "negative_marking", "negative_ratio", "require_all_answers", "offline_prefetch", "grace_seconds", "offline_tolerance_seconds"]) {
                    delete vals[k];
                }
            }
            const isNew = !c.id;
            this.state.c = await api("concours_save", [vals]);
            notify("Concours enregistré.", "ok");
            if (isNew) {
                location.hash = `#/concours/${this.state.c.id}?tab=${this.state.tab}`;
            }
        } catch (e) {
            notify(e.message, "danger", 8000);
        } finally {
            this.state.saving = false;
        }
    }

    async lifecycle(action) {
        const texts = {
            ready: ["Valider le questionnaire ?", "SELECTA vérifie la cohérence de chaque question (propositions, bonnes réponses). Le concours pourra ensuite être ouvert.", "Valider"],
            draft: ["Revenir en préparation ?", "Le questionnaire redevient modifiable.", "Revenir en préparation"],
            open: ["Ouvrir l'épreuve ?", "Les candidats pourront se connecter avec leur code. Les règles et le questionnaire seront définitivement figés et leur empreinte enregistrée dans le journal d'audit.", "Ouvrir l'épreuve"],
            close: ["Clôturer l'épreuve ?", "Les candidats encore en composition seront arrêtés et corrigés sur les pages validées. Les candidats non connectés seront déclarés absents. La liste des admis est produite immédiatement.", "Clôturer"],
            publish: ["Publier les résultats ?", "Le classement est scellé par une empreinte SHA-256 et un QR code de vérification. Cette opération est irréversible.", "Publier et sceller"],
        }[action];
        const ok = await confirmDialog({ title: texts[0], body: texts[1], confirmLabel: texts[2], danger: action === "close" });
        if (!ok) {
            return;
        }
        if (["ready", "open"].includes(action) && this.canEdit && !this.locked) {
            await this.save();
        }
        try {
            this.state.c = await api("concours_action", [this.state.c.id, action]);
            notify({ ready: "Questionnaire validé.", draft: "Concours remis en préparation.", open: "Épreuve ouverte : les candidats peuvent se connecter.", close: "Épreuve clôturée, liste des admis produite.", publish: "Résultats publiés et scellés." }[action], "ok", 6000);
            if (action === "close" || action === "publish") {
                location.hash = `#/results/${this.state.c.id}`;
            }
        } catch (e) {
            notify(e.message, "danger", 10000);
        }
    }

    async duplicate() {
        const id = await api("concours_duplicate", [this.state.c.id]);
        notify("Concours dupliqué.", "ok");
        location.hash = `#/concours/${id}`;
    }

    async remove() {
        if (await confirmDialog({ title: "Supprimer ce concours ?", body: "Cette action est définitive.", confirmLabel: "Supprimer", danger: true })) {
            try {
                await api("concours_delete", [this.state.c.id]);
                location.hash = "#/concours";
            } catch (e) {
                notify(e.message, "danger");
            }
        }
    }

    // ------------------------------------------------------------------ questions
    get visibleQuestions() {
        const s = this.state.qsearch.toLowerCase();
        return this.state.questions.filter(
            (q) =>
                (!s || q.name.toLowerCase().includes(s)) &&
                (!this.state.qcat || String(q.category_id) === String(this.state.qcat)) &&
                (!this.state.qonly || this.isSelected(q.id))
        );
    }
    isSelected(id) {
        return this.state.c.question_ids.includes(id);
    }
    toggleQ(id) {
        const ids = this.state.c.question_ids;
        this.state.c.question_ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    }
    selectVisible(on) {
        const vis = this.visibleQuestions.map((q) => q.id);
        const cur = new Set(this.state.c.question_ids);
        for (const id of vis) {
            on ? cur.add(id) : cur.delete(id);
        }
        this.state.c.question_ids = [...cur];
    }
    get selectedQuestions() {
        const set = new Set(this.state.c.question_ids);
        return this.state.questions.filter((q) => set.has(q.id));
    }
    get selectedPoints() {
        const qs = this.selectedQuestions;
        const n = this.state.c.nb_questions_drawn || qs.length;
        return qs.slice(0, n).reduce((s, q) => s + q.points, 0);
    }
    get pages() {
        const n = this.state.c.nb_questions_drawn || this.state.c.question_ids.length;
        return Math.max(1, Math.ceil(n / (this.state.c.questions_per_page || 1)));
    }
    get selectedByCategory() {
        const map = {};
        for (const q of this.selectedQuestions) {
            const k = q.category || "Sans matière";
            map[k] ??= { name: k, color: q.color, count: 0 };
            map[k].count++;
        }
        return Object.values(map);
    }

    // ------------------------------------------------------------------ candidats
    get visibleCandidates() {
        const s = this.state.csearch.toLowerCase();
        return this.state.candidates.filter((x) => !s || `${x.name} ${x.reference} ${x.room}`.toLowerCase().includes(s));
    }
    get codesMissing() {
        return this.state.candidates.filter((x) => !x.has_code && x.state === "registered").length;
    }
    toggleCand(id) {
        const s = this.state.selected;
        this.state.selected = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
    }
    selectAll(on) {
        this.state.selected = on ? this.visibleCandidates.map((x) => x.id) : [];
    }
    addCandidate() {
        this.state.editCand = { reference: "", name: "", room: "", email: "", id_document: "" };
    }
    editCandidate(x) {
        this.state.editCand = { ...x };
    }
    async saveCandidate() {
        const v = { ...this.state.editCand, concours_id: this.state.c.id };
        try {
            await api("candidate_save", [v]);
            this.state.editCand = null;
            this.state.candidates = await api("candidates_list", [this.state.c.id]);
            notify("Candidat enregistré.", "ok");
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    async deleteCandidate(x) {
        if (await confirmDialog({ title: `Supprimer ${x.name} ?`, body: "Le candidat sera retiré de la liste des inscrits.", confirmLabel: "Supprimer", danger: true })) {
            try {
                await api("candidate_delete", [x.id]);
                this.state.candidates = await api("candidates_list", [this.state.c.id]);
            } catch (e) {
                notify(e.message, "danger");
            }
        }
    }
    async importCandidates(ev) {
        const file = ev.target.files[0];
        ev.target.value = "";
        if (!file) {
            return;
        }
        const rows = parseCSV(await readFileAsText(file));
        if (rows.length && /ref|num|matric/i.test(rows[0][0])) {
            rows.shift();
        }
        const data = rows.map((r) => ({
            reference: (r[0] || "").trim(), name: (r[1] || "").trim(), email: (r[2] || "").trim(),
            phone: (r[3] || "").trim(), room: (r[4] || "").trim(), id_document: (r[5] || "").trim(),
        }));
        try {
            const res = await api("candidates_import", [this.state.c.id, data]);
            this.state.candidates = await api("candidates_list", [this.state.c.id]);
            notify(`${res.created} candidat(s) importé(s)${res.errors.length ? `, ${res.errors.length} ligne(s) rejetée(s) : ` + res.errors.slice(0, 3).map((e) => `ligne ${e.line} (${e.error})`).join(", ") : ""}.`, res.errors.length ? "warn" : "ok", 9000);
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    async generateCodes(onlyMissing) {
        const ids = onlyMissing ? null : this.state.selected;
        const n = onlyMissing ? this.codesMissing : ids.length;
        const ok = await confirmDialog({
            title: `Générer ${n} code(s) d'accès ?`,
            body: onlyMissing
                ? "Les convocations s'ouvriront pour impression. Les codes ne pourront plus être affichés ensuite : imprimez-les ou enregistrez-les en PDF immédiatement."
                : "Les anciens codes de ces candidats seront invalidés. Les nouvelles convocations s'ouvriront pour impression.",
            confirmLabel: "Générer et imprimer",
        });
        if (!ok) {
            return;
        }
        try {
            const res = await api("generate_codes", [this.state.c.id, ids, onlyMissing]);
            const url = `${store.session ? location.origin : ""}/selecta/exam`;
            printConvocations(store.session.company, res, url);
            this.state.candidates = await api("candidates_list", [this.state.c.id]);
            this.state.selected = [];
            notify(`${res.codes.length} code(s) générés. Conservez les convocations imprimées en lieu sûr.`, "ok", 8000);
        } catch (e) {
            notify(e.message, "danger");
        }
    }
}
