/** @odoo-module */
import { Component, onMounted, onWillUnmount, useRef, useState, xml } from "@odoo/owl";
import { Icon } from "@selecta_concours/common/ui";
import { escapeHTML, fmtDuration } from "@selecta_concours/common/utils";
import { SealRing } from "@selecta_concours/exam/components";

const LETTERS = "ABCDEFGHIJ";

export class ExamScreen extends Component {
    static components = { Icon, SealRing };
    static template = xml`
        <div class="ex-shell" t-att-class="{'is-urgent': remaining lt 60000, 'is-warning': remaining lt 300000}">
            <header class="ex-top">
                <div class="ex-top-title">
                    <img t-att-src="info.concours.company.logo" alt="" class="ex-top-logo" t-on-error="(ev) => ev.target.style.display='none'"/>
                    <div>
                        <div class="ex-top-concours" t-esc="info.concours.name"/>
                        <div class="ex-top-cand"><t t-esc="info.candidate.name"/>, n° <t t-esc="info.candidate.reference"/></div>
                    </div>
                </div>
                <div class="ex-top-status">
                    <span t-if="!session.online" class="sl-badge sl-badge-warn" title="Les réponses sont conservées sur le poste">Hors ligne<t t-if="session.pending">, <t t-esc="session.pending"/> en attente</t></span>
                    <span t-elif="session.syncing" class="sl-badge sl-badge-info">Synchronisation…</span>
                    <span t-if="info.proctoring.enabled" class="sl-badge" t-att-class="warnings ? 'sl-badge-warn' : 'sl-badge-ok'">
                        Avertissements <t t-esc="warnings"/>/<t t-esc="maxWarnings"/>
                    </span>
                </div>
            </header>

            <div class="ex-body">
                <main class="ex-main" t-att-style="watermark">
                    <div class="ex-page-head">
                        <h2>Page <t t-esc="page + 1"/> <span class="sl-muted">sur <t t-esc="totalPages"/></span></h2>
                        <span class="sl-muted"><t t-esc="answeredCount"/> / <t t-esc="questions.length"/> répondue(s)</span>
                    </div>
                    <t t-if="!questions.length">
                        <div class="ex-waiting"><span class="sl-spinner"/> Récupération des questions…</div>
                    </t>
                    <article t-foreach="questions" t-as="q" t-key="q.id" class="ex-q" t-att-class="{'is-answered': isAnswered(q)}">
                        <div class="ex-q-head">
                            <span class="ex-q-num sl-figures" t-esc="questionNumber(q_index)"/>
                            <span class="ex-q-meta">
                                <t t-if="q.category"><t t-esc="q.category"/>, </t><t t-esc="q.points"/> pt<t t-if="q.points gt 1">s</t>
                                <t t-if="q.type == 'multiple'">, plusieurs réponses possibles</t>
                            </span>
                        </div>
                        <p class="ex-q-text" t-esc="q.text"/>
                        <img t-if="q.image" t-att-src="q.image" class="ex-q-img" alt="Illustration de la question" draggable="false"/>
                        <div class="ex-choices" t-att-role="q.type == 'single' ? 'radiogroup' : 'group'">
                            <button t-foreach="q.choices" t-as="ch" t-key="ch.id" type="button"
                                    class="ex-choice" t-att-class="{'is-selected': isSelected(q, ch)}"
                                    t-att-role="q.type == 'single' ? 'radio' : 'checkbox'"
                                    t-att-aria-checked="isSelected(q, ch) ? 'true' : 'false'"
                                    t-on-click="() => this.toggle(q, ch)">
                                <span class="ex-choice-key" t-esc="letter(ch_index)"/>
                                <span class="ex-choice-text" t-esc="ch.text"/>
                                <span class="ex-choice-mark" t-att-class="q.type == 'multiple' ? 'is-square' : ''"><Icon name="'check'" size="14"/></span>
                            </button>
                        </div>
                    </article>
                    <footer class="ex-main-foot" t-if="questions.length">
                        <div class="sl-muted" t-if="!canSubmit">Répondez à toutes les questions de la page pour la valider.</div>
                        <div class="sl-grow"/>
                        <button class="sl-btn sl-btn-primary sl-btn-lg" t-att-disabled="!canSubmit or state.submitting" t-on-click="askSubmit">
                            <t t-if="state.submitting"><span class="sl-spinner"/> Enregistrement…</t>
                            <t t-elif="isLast">Valider et terminer l'épreuve</t>
                            <t t-else="">Valider cette page</t>
                        </button>
                    </footer>
                </main>

                <aside class="ex-rail">
                    <div class="ex-timer" role="timer" aria-live="off">
                        <SealRing value="timeRatio" size="168" stroke="9" color="timerColor"/>
                        <div class="ex-timer-value">
                            <span class="sl-figures" t-esc="remainingText"/>
                            <small>temps restant</small>
                        </div>
                    </div>
                    <ol class="ex-steps" aria-label="Progression">
                        <li t-foreach="pageList" t-as="p" t-key="p" t-att-class="{'is-done': p lt page, 'is-current': p == page}">
                            <span class="sl-figures" t-esc="p + 1"/>
                        </li>
                    </ol>
                    <div t-if="info.proctoring.enabled" class="ex-cam" t-att-class="'is-' + camStatus">
                        <video t-ref="cam" autoplay="autoplay" muted="muted" playsinline="playsinline"/>
                        <div class="ex-cam-label"><span class="ex-cam-dot"/><t t-esc="camLabel"/></div>
                    </div>
                </aside>
            </div>

            <div t-if="state.confirm" class="sl-overlay">
                <div class="sl-dialog" role="alertdialog" aria-modal="true">
                    <div class="sl-dialog-head"><h3 t-esc="isLast ? 'Terminer l’épreuve ?' : 'Valider la page ' + (page + 1) + ' ?'"/></div>
                    <div class="sl-dialog-body">
                        <p>Après validation, vous ne pourrez plus revenir sur les réponses de cette page.</p>
                        <p t-if="isLast">Votre copie sera corrigée immédiatement et votre résultat affiché.</p>
                        <p t-if="answeredCount lt questions.length" class="sl-alert sl-alert-warn">
                            <t t-esc="questions.length - answeredCount"/> question(s) sans réponse.
                        </p>
                    </div>
                    <div class="sl-dialog-foot">
                        <button class="sl-btn" t-on-click="() => this.state.confirm = false">Relire</button>
                        <button class="sl-btn sl-btn-primary" t-on-click="submit" t-esc="isLast ? 'Terminer' : 'Valider la page'"/>
                    </div>
                </div>
            </div>

            <div t-if="props.warning" class="ex-warning" role="alert">
                <Icon name="'alert'" size="28"/>
                <div>
                    <strong>Avertissement <t t-esc="warnings"/> sur <t t-esc="maxWarnings"/></strong>
                    <div t-esc="props.warning"/>
                    <small>Au prochain manquement au-delà de cette limite, l'épreuve sera interrompue.</small>
                </div>
            </div>

            <div t-if="needFullscreen" class="sl-overlay ex-fs-lock">
                <div class="sl-dialog">
                    <div class="sl-dialog-head"><h3>Plein écran requis</h3></div>
                    <div class="sl-dialog-body"><p>L'épreuve doit être composée en plein écran. La sortie a été signalée à la surveillance. Le chronomètre continue de tourner.</p></div>
                    <div class="sl-dialog-foot"><button class="sl-btn sl-btn-primary" t-on-click="enterFullscreen"><Icon name="'fullscreen'"/>Revenir en plein écran</button></div>
                </div>
            </div>
        </div>`;
    static props = ["session", "info", "proctor", "warning", "onFinished", "onError"];

    setup() {
        this.session = useState(this.props.session.state);
        this.state = useState({ answers: {}, submitting: false, confirm: false, tick: 0, camStatus: "ok", fs: true });
        this.cam = useRef("cam");
        this.autoSubmitted = false;
        onMounted(() => {
            this.timer = setInterval(() => this.onTick(), 250);
            if (this.props.proctor && this.cam.el && this.props.proctor.stream) {
                this.cam.el.srcObject = this.props.proctor.stream;
                this.cam.el.play().catch(() => {});
            }
            this.fsHandler = () => (this.state.fs = !!document.fullscreenElement);
            document.addEventListener("fullscreenchange", this.fsHandler);
            this.state.fs = !!document.fullscreenElement;
            history.pushState(null, "", location.href);
            this.popHandler = () => history.pushState(null, "", location.href);
            window.addEventListener("popstate", this.popHandler);
            this.unloadHandler = (e) => {
                e.preventDefault();
                e.returnValue = "";
            };
            window.addEventListener("beforeunload", this.unloadHandler);
            this.restoreDraft();
        });
        onWillUnmount(() => {
            clearInterval(this.timer);
            document.removeEventListener("fullscreenchange", this.fsHandler);
            window.removeEventListener("popstate", this.popHandler);
            window.removeEventListener("beforeunload", this.unloadHandler);
        });
    }

    // ------------------------------------------------------------------ données
    get info() {
        return this.props.info;
    }
    get page() {
        return this.session.localPage;
    }
    get totalPages() {
        return this.session.status?.total_pages || 1;
    }
    get pageList() {
        return [...Array(this.totalPages).keys()];
    }
    get isLast() {
        return this.page + 1 >= this.totalPages;
    }
    get questions() {
        return this.props.session.pageQuestions(this.page) || [];
    }
    get warnings() {
        return this.session.warnings || 0;
    }
    get maxWarnings() {
        return this.session.status?.max_warnings ?? 0;
    }
    get remaining() {
        void this.state.tick;
        return this.props.session.remainingMs();
    }
    get remainingText() {
        return fmtDuration(this.remaining / 1000);
    }
    get timeRatio() {
        const total = (this.session.status?.duration_seconds || 1) * 1000;
        return this.remaining / total;
    }
    get timerColor() {
        return this.remaining < 60000 ? "var(--sl-danger)" : this.remaining < 300000 ? "var(--sl-warn)" : "var(--brand)";
    }
    get needFullscreen() {
        return this.info.proctoring.enabled && this.info.proctoring.require_fullscreen && !this.state.fs;
    }
    get camStatus() {
        void this.state.tick;
        return this.props.proctor?.metrics?.status || "ok";
    }
    get camLabel() {
        return (
            {
                ok: "Surveillance IA active",
                absent: "Visage non détecté",
                away: "Regardez l'écran",
                multiple: "Plusieurs personnes",
                dark: "Caméra masquée",
                frozen: "Image caméra figée",
                init: "Initialisation…",
            }[this.camStatus] || "Surveillance IA active"
        );
    }
    get watermark() {
        const text = escapeHTML(`${this.info.candidate.name} · ${this.info.candidate.reference}`);
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='220'><text x='10' y='120' transform='rotate(-22 210 110)' font-family='sans-serif' font-size='15' fill='rgba(20,33,61,0.045)'>${text}</text></svg>`;
        return `background-image: url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    }
    get answeredCount() {
        return this.questions.filter((q) => this.isAnswered(q)).length;
    }
    get canSubmit() {
        return !this.info.concours.require_all_answers || this.answeredCount === this.questions.length;
    }
    questionNumber(idx) {
        const qpp = this.info.concours.questions_per_page || this.questions.length;
        return this.page * qpp + idx + 1;
    }
    letter(i) {
        return LETTERS[i] || String(i + 1);
    }
    isAnswered(q) {
        return (this.state.answers[q.id] || []).length > 0;
    }
    isSelected(q, ch) {
        return (this.state.answers[q.id] || []).includes(ch.id);
    }

    // ------------------------------------------------------------------ brouillon local (page courante)
    draftKey() {
        return `selecta.draft.${this.info.candidate.reference}.${this.page}`;
    }
    restoreDraft() {
        try {
            this.state.answers = JSON.parse(sessionStorage.getItem(this.draftKey()) || "{}");
        } catch {
            this.state.answers = {};
        }
    }
    saveDraft() {
        try {
            sessionStorage.setItem(this.draftKey(), JSON.stringify(this.state.answers));
        } catch {
            /* ignoré */
        }
    }

    toggle(q, ch) {
        const cur = this.state.answers[q.id] || [];
        if (q.type === "single") {
            this.state.answers[q.id] = [ch.id];
        } else {
            this.state.answers[q.id] = cur.includes(ch.id) ? cur.filter((x) => x !== ch.id) : [...cur, ch.id];
        }
        this.saveDraft();
    }

    // ------------------------------------------------------------------ validation
    askSubmit() {
        if (this.canSubmit) {
            this.state.confirm = true;
        }
    }

    async submit(timeUp = false) {
        this.state.confirm = false;
        if (this.state.submitting) {
            return;
        }
        this.state.submitting = true;
        const page = this.page;
        const answers = {};
        for (const q of this.questions) {
            if ((this.state.answers[q.id] || []).length) {
                answers[q.id] = this.state.answers[q.id];
            }
        }
        try {
            const res = await this.props.session.submitPage(page, answers, timeUp === true);
            if (res.error) {
                this.props.onError(res.error);
                return;
            }
            sessionStorage.removeItem(`selecta.draft.${this.info.candidate.reference}.${page}`);
            this.state.answers = {};
            this.restoreDraft();
            window.scrollTo({ top: 0 });
            const st = this.session.status;
            if (this.session.localFinished || (st && st.state !== "in_progress")) {
                this.props.onFinished();
            }
        } catch (e) {
            this.props.onError(e.message || String(e));
        } finally {
            this.state.submitting = false;
        }
    }

    onTick() {
        this.state.tick++;
        if (!this.autoSubmitted && this.session.status?.deadline && this.remaining <= 0) {
            this.autoSubmitted = true;
            this.submit(true);
        }
    }

    enterFullscreen() {
        document.documentElement.requestFullscreen?.().catch(() => {});
    }
}
