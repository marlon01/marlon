/** @odoo-module */
import { Component, onMounted, onWillUnmount, useRef, useState, xml } from "@odoo/owl";
import { Icon } from "@selecta_concours/common/ui";
import { fmtDuration, fmtPct } from "@selecta_concours/common/utils";

// ======================================================================= sceau circulaire
export class SealRing extends Component {
    static template = xml`
        <svg t-att-width="props.size" t-att-height="props.size" t-att-viewBox="'0 0 ' + props.size + ' ' + props.size" class="sl-seal" role="img">
            <circle t-att-cx="c" t-att-cy="c" t-att-r="r" fill="none" t-att-stroke-width="props.stroke" class="sl-seal-track"/>
            <circle t-att-cx="c" t-att-cy="c" t-att-r="r" fill="none" t-att-stroke-width="props.stroke"
                    t-att-stroke="props.color" stroke-linecap="round"
                    t-att-stroke-dasharray="circ" t-att-stroke-dashoffset="offset"
                    t-att-transform="'rotate(-90 ' + c + ' ' + c + ')'" class="sl-seal-value"/>
            <circle t-att-cx="c" t-att-cy="c" t-att-r="r - props.stroke - 6" fill="none" class="sl-seal-inner" stroke-dasharray="2 5"/>
        </svg>`;
    static props = { value: Number, size: { type: Number, optional: true }, stroke: { type: Number, optional: true }, color: { type: String, optional: true } };
    static defaultProps = { size: 160, stroke: 10, color: "var(--brand)" };
    get c() {
        return this.props.size / 2;
    }
    get r() {
        return this.props.size / 2 - this.props.stroke / 2 - 2;
    }
    get circ() {
        return 2 * Math.PI * this.r;
    }
    get offset() {
        const v = Math.max(0, Math.min(1, this.props.value));
        return this.circ * (1 - v);
    }
}

// ======================================================================= connexion candidat
export class LoginScreen extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ex-login">
            <aside class="ex-login-side">
                <div class="ex-org">
                    <img t-att-src="props.company.logo" alt="" class="ex-org-logo" t-on-error="(ev) => ev.target.style.display='none'"/>
                    <div>
                        <div class="ex-org-name" t-esc="props.company.name"/>
                        <div class="ex-org-tag" t-esc="props.company.tagline"/>
                    </div>
                </div>
                <div class="ex-login-pitch">
                    <h1>Votre épreuve commence ici.</h1>
                    <p>Saisissez le code personnel imprimé sur votre convocation. Il est unique, confidentiel et ne fonctionne qu'une seule fois.</p>
                </div>
                <ul class="ex-guarantees">
                    <li><Icon name="'clock'"/><span>Le chronomètre démarre à l'ouverture du questionnaire, pas avant.</span></li>
                    <li><Icon name="'shield'"/><span>Correction automatique : votre résultat s'affiche dès la dernière page.</span></li>
                    <li><Icon name="'camera'"/><span>Une surveillance par caméra garantit l'égalité entre les candidats.</span></li>
                </ul>
                <div class="ex-powered">SELECTA, la culture de l'excellence. By Naxoris, version <t t-esc="props.version"/></div>
            </aside>
            <main class="ex-login-main">
                <form class="ex-login-form" t-on-submit.prevent="submit" autocomplete="off">
                    <h2>Code d'accès</h2>
                    <p class="sl-muted">12 caractères, lettres et chiffres. Les tirets s'ajoutent automatiquement.</p>
                    <input class="ex-code-input" t-ref="code" t-att-value="state.code" t-on-input="onInput"
                           placeholder="XXXX-XXXX-XXXX" maxlength="14" spellcheck="false" autocapitalize="characters"
                           inputmode="text" aria-label="Code d'accès" t-att-aria-invalid="props.error ? 'true' : 'false'"/>
                    <div t-if="props.error" class="sl-alert sl-alert-danger" role="alert" t-esc="props.error"/>
                    <button class="sl-btn sl-btn-primary sl-btn-lg ex-login-btn" type="submit" t-att-disabled="!valid or props.loading">
                        <t t-if="props.loading"><span class="sl-spinner"/> Vérification…</t>
                        <t t-else="">Accéder à mon épreuve</t>
                    </button>
                    <div class="ex-net" t-att-class="props.online ? 'is-on' : 'is-off'">
                        <Icon name="props.online ? 'wifi' : 'wifiOff'" size="16"/>
                        <span t-esc="props.online ? 'Connecté au serveur d’examen' : 'Serveur d’examen injoignable — vérifiez le câble ou le Wi-Fi de la salle'"/>
                    </div>
                </form>
            </main>
        </div>`;
    static props = ["company", "version", "error", "loading", "online", "onLogin"];
    setup() {
        this.state = useState({ code: "" });
        this.input = useRef("code");
        onMounted(() => this.input.el?.focus());
    }
    get valid() {
        return this.state.code.replace(/-/g, "").length === 12;
    }
    onInput(ev) {
        const raw = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
        const parts = raw.match(/.{1,4}/g) || [];
        this.state.code = parts.join("-");
        ev.target.value = this.state.code;
    }
    submit() {
        if (this.valid) {
            this.props.onLogin(this.state.code);
        }
    }
}

// ======================================================================= consignes
export class BriefingScreen extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ex-page ex-briefing">
            <header class="ex-brief-head">
                <div>
                    <div class="sl-muted" t-esc="info.concours.company.name"/>
                    <h1 t-esc="info.concours.name"/>
                </div>
                <div class="ex-idcard">
                    <div class="ex-idcard-avatar"><Icon name="'user'" size="26"/></div>
                    <div>
                        <div class="ex-idcard-name" t-esc="info.candidate.name"/>
                        <div class="sl-muted">N° <t t-esc="info.candidate.reference"/><t t-if="info.candidate.room">, <t t-esc="info.candidate.room"/></t></div>
                    </div>
                </div>
            </header>
            <section class="ex-facts">
                <div><span class="sl-figures" t-esc="info.concours.duration_minutes"/><small>minutes</small></div>
                <div><span class="sl-figures" t-esc="info.status.question_count"/><small>questions</small></div>
                <div><span class="sl-figures" t-esc="info.status.total_pages"/><small>pages</small></div>
                <div><span class="sl-figures"><t t-esc="info.concours.pass_threshold"/>%</span><small>pour réussir</small></div>
            </section>
            <section class="ex-rules">
                <h2>Règles de l'épreuve</h2>
                <ol>
                    <li>Le chronomètre démarre au moment où le questionnaire s'affiche. À la fin du temps imparti, l'épreuve se termine automatiquement et seules les pages validées sont corrigées.</li>
                    <li>Chaque page se valide une seule fois<t t-if="info.concours.require_all_answers">, après avoir répondu à toutes ses questions</t>. Il est impossible de revenir sur une page validée.</li>
                    <li t-if="info.proctoring.enabled">Votre caméra reste active pendant toute l'épreuve. Restez seul, face à l'écran, visage découvert et bien éclairé.</li>
                    <li t-if="info.proctoring.enabled">Sont considérés comme suspects : quitter la fenêtre, sortir du plein écran, regarder ailleurs de façon prolongée, la présence d'une autre personne, un visage différent, masquer la caméra, utiliser des raccourcis clavier.</li>
                    <li t-if="info.proctoring.enabled">
                        <t t-if="info.proctoring.level == 'zero'">Tolérance zéro : le premier comportement suspect entraîne la disqualification immédiate.</t>
                        <t t-else="">Vous disposez de <strong t-esc="info.status.max_warnings"/> avertissement(s). Au-delà, ou en cas de fraude caractérisée (autre personne, visage différent, caméra masquée), la disqualification est immédiate et définitive.</t>
                    </li>
                    <li>Votre résultat (pourcentage et décision) s'affiche dès la validation de la dernière page.</li>
                </ol>
                <div t-if="info.concours.instructions" class="ex-instructions">
                    <h3>Consignes de l'organisateur</h3>
                    <p t-esc="info.concours.instructions"/>
                </div>
            </section>
            <label class="sl-check ex-consent">
                <input type="checkbox" t-model="state.accepted"/>
                <span>J'ai lu ces règles, je certifie être <strong t-esc="info.candidate.name"/> et j'accepte la surveillance de l'épreuve.</span>
            </label>
            <footer class="ex-brief-foot">
                <button class="sl-btn sl-btn-ghost" t-on-click="props.onCancel">Ce n'est pas moi</button>
                <button class="sl-btn sl-btn-primary sl-btn-lg" t-att-disabled="!state.accepted" t-on-click="props.onContinue">
                    <t t-if="info.proctoring.enabled">Passer au contrôle caméra</t>
                    <t t-else="">Commencer l'épreuve</t>
                </button>
            </footer>
        </div>`;
    static props = ["info", "onContinue", "onCancel"];
    setup() {
        this.state = useState({ accepted: false });
    }
    get info() {
        return this.props.info;
    }
}

// ======================================================================= contrôle caméra & identité
export class CameraCheck extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ex-page ex-camera">
            <div class="ex-camera-grid">
                <div class="ex-camera-view">
                    <video t-ref="video" class="ex-video" autoplay="autoplay" muted="muted" playsinline="playsinline"/>
                    <div class="ex-camera-frame" t-att-class="{'is-ok': allOk}"/>
                    <div t-if="state.loading" class="ex-camera-loading">
                        <span class="sl-spinner"/>
                        <span t-esc="state.loadingText"/>
                        <div class="ex-progress"><div t-attf-style="width: {{state.loadingPct}}%"/></div>
                    </div>
                </div>
                <div class="ex-camera-side">
                    <h1 t-esc="props.resume ? 'Reprise de l’épreuve' : 'Contrôle d’identité'"/>
                    <p class="sl-muted" t-if="!props.resume">Placez votre visage dans le cadre, regardez l'écran. Votre empreinte faciale est enregistrée pour toute la durée de l'épreuve.</p>
                    <p class="sl-muted" t-else="">Votre visage doit correspondre à celui enregistré au début de l'épreuve. Le chronomètre n'a pas été suspendu.</p>
                    <ul class="ex-checks">
                        <li t-att-class="state.checks.camera ? 'ok' : ''"><Icon name="state.checks.camera ? 'check' : 'camera'"/>Caméra active</li>
                        <li t-att-class="state.checks.light ? 'ok' : ''"><Icon name="state.checks.light ? 'check' : 'eye'"/>Éclairage suffisant</li>
                        <li t-att-class="state.checks.face ? 'ok' : ''"><Icon name="state.checks.face ? 'check' : 'user'"/>Visage détecté</li>
                        <li t-att-class="state.checks.single ? 'ok' : ''"><Icon name="state.checks.single ? 'check' : 'users'"/>Une seule personne</li>
                        <li t-att-class="state.checks.looking ? 'ok' : ''"><Icon name="state.checks.looking ? 'check' : 'eye'"/>Regard face à l'écran</li>
                        <li t-att-class="state.checks.identity ? 'ok' : ''"><Icon name="state.checks.identity ? 'check' : 'shield'"/>Empreinte faciale <t t-esc="props.resume ? 'vérifiée' : 'enregistrée'"/></li>
                    </ul>
                    <div t-if="state.error" class="sl-alert sl-alert-danger" t-esc="state.error"/>
                    <div t-if="state.checks.identity and !props.resume" class="sl-alert sl-alert-warn">
                        Le chronomètre de <strong t-esc="props.duration"/> minutes démarrera dès que vous cliquerez sur « Commencer ». L'écran passera en plein écran.
                    </div>
                    <button class="sl-btn sl-btn-primary sl-btn-lg" t-att-disabled="!state.checks.identity or state.starting" t-on-click="start">
                        <t t-if="state.starting"><span class="sl-spinner"/> Ouverture…</t>
                        <t t-elif="props.resume">Reprendre l'épreuve</t>
                        <t t-else="">Commencer l'épreuve</t>
                    </button>
                    <button t-if="state.error" class="sl-btn" t-on-click="retry"><Icon name="'refresh'"/>Réessayer</button>
                </div>
            </div>
        </div>`;
    static props = ["proctor", "resume", "duration", "onIdentity", "onStart"];

    setup() {
        this.video = useRef("video");
        this.state = useState({
            loading: true,
            loadingText: "Initialisation…",
            loadingPct: 0,
            error: null,
            starting: false,
            checks: { camera: false, light: false, face: false, single: false, looking: false, identity: false },
        });
        this.alive = true;
        onMounted(() => this.init());
        onWillUnmount(() => (this.alive = false));
    }

    async init() {
        const p = this.props.proctor;
        try {
            if (!p.loaded) {
                await p.load((text, pct) => Object.assign(this.state, { loadingText: text, loadingPct: pct }));
            }
            this.state.loadingText = "Ouverture de la caméra…";
            await p.attach(this.video.el);
            this.state.checks.camera = true;
            this.state.loading = false;
            this.calibrate();
        } catch (e) {
            this.state.loading = false;
            this.state.error =
                e.name === "NotAllowedError"
                    ? "L'accès à la caméra a été refusé. Autorisez la caméra dans le navigateur puis réessayez."
                    : e.name === "NotFoundError"
                      ? "Aucune caméra n'est branchée sur ce poste. Prévenez un surveillant."
                      : e.message || String(e);
        }
    }

    async calibrate() {
        const p = this.props.proctor;
        let stable = 0;
        const samples = [];
        while (this.alive && !this.state.checks.identity) {
            const m = await p.analyze().catch(() => null);
            if (m) {
                const c = this.state.checks;
                c.light = m.brightness > 30;
                c.face = m.faces >= 1;
                c.single = m.faces === 1;
                c.looking = m.faces === 1 && p.isLooking(m);
                if (c.light && c.single && c.looking) {
                    stable++;
                    if (stable >= 3) {
                        const d = await p.descriptor().catch(() => null);
                        if (d) {
                            samples.push(d);
                        }
                        if (samples.length >= 3) {
                            const avg = samples[0].map((_, i) => samples.reduce((s, v) => s + v[i], 0) / samples.length);
                            const res = await this.props.onIdentity(avg, p.snapshot(0.8));
                            if (res?.ok) {
                                p.reference = avg;
                                p.lastDescriptor = avg;
                                c.identity = true;
                                this.state.error = null;
                            } else {
                                this.state.error = res?.error || "Contrôle d'identité refusé.";
                                return;
                            }
                        }
                    }
                } else {
                    stable = 0;
                }
            }
            await new Promise((r) => setTimeout(r, 350));
        }
    }

    retry() {
        this.state.error = null;
        if (!this.state.checks.camera) {
            this.state.loading = true;
            this.init();
        } else {
            this.calibrate();
        }
    }

    async start() {
        this.state.starting = true;
        try {
            await this.props.onStart();
        } finally {
            if (this.alive) {
                this.state.starting = false;
            }
        }
    }
}

// ======================================================================= résultat
export class ResultScreen extends Component {
    static components = { SealRing, Icon };
    static template = xml`
        <div class="ex-page ex-result">
            <t t-set="r" t-value="props.result"/>
            <div t-if="r.show" class="ex-result-card" t-att-class="r.passed ? 'is-pass' : 'is-fail'">
                <div class="ex-result-seal">
                    <SealRing value="(r.percentage or 0) / 100" size="220" stroke="14" color="r.passed ? 'var(--sl-ok)' : 'var(--sl-danger)'"/>
                    <div class="ex-result-pct">
                        <span class="sl-figures" t-esc="pctText"/>
                        <small>de réussite</small>
                    </div>
                </div>
                <div class="ex-verdict">
                    <h1 t-esc="r.passed ? 'Admis' : 'Non admis'"/>
                    <p t-if="r.passed and r.places">Vous avez atteint le seuil de <t t-esc="r.threshold"/> %. Votre admission définitive dépend du classement final (<t t-esc="r.places"/> places).</p>
                    <p t-elif="r.passed">Vous avez atteint le seuil de réussite de <t t-esc="r.threshold"/> %.</p>
                    <p t-else="">Le seuil de réussite était fixé à <t t-esc="r.threshold"/> %.</p>
                    <dl class="ex-result-facts">
                        <div><dt>Score</dt><dd class="sl-figures"><t t-esc="fmt(r.score)"/> / <t t-esc="fmt(r.max_score)"/></dd></div>
                        <div><dt>Bonnes réponses</dt><dd class="sl-figures"><t t-esc="r.correct"/> / <t t-esc="r.question_count"/></dd></div>
                        <div><dt>Durée</dt><dd class="sl-figures" t-esc="duration"/></div>
                        <div t-if="props.state == 'expired'"><dt>Fin</dt><dd>Temps écoulé</dd></div>
                    </dl>
                </div>
            </div>
            <div t-else="" class="ex-result-card">
                <div class="ex-verdict"><h1>Copie enregistrée</h1><p>Les résultats seront communiqués par l'organisateur.</p></div>
            </div>
            <div class="ex-receipt">
                <Icon name="'shield'"/>
                <div>
                    <strong>Reçu de dépôt</strong>
                    <div class="sl-muted">Notez ce code : il prouve le contenu exact de votre copie en cas de contestation.</div>
                    <div class="ex-receipt-code sl-mono" t-esc="receipt"/>
                </div>
            </div>
            <button class="sl-btn sl-btn-ink sl-btn-lg" t-on-click="props.onDone">Quitter l'espace candidat</button>
        </div>`;
    static props = ["result", "state", "onDone"];
    get pctText() {
        const v = this.props.result.percentage || 0;
        return fmtPct(v, Number.isInteger(v) ? 0 : 1).replace(" %", "%");
    }
    get duration() {
        return fmtDuration(this.props.result.duration_seconds);
    }
    get receipt() {
        const d = this.props.result.digest || "";
        return d ? d.slice(0, 16).toUpperCase().match(/.{1,4}/g).join("-") : "—";
    }
    fmt(v) {
        return v === null || v === undefined ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    }
}

export class DisqualifiedScreen extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ex-page ex-disq">
            <div class="ex-disq-icon"><Icon name="'alert'" size="44"/></div>
            <h1>Épreuve interrompue</h1>
            <p class="ex-disq-reason" t-esc="props.reason or 'Comportement non conforme au règlement'"/>
            <p class="sl-muted">La surveillance a constaté une infraction au règlement de l'épreuve. Cette décision, les clichés et l'horodatage associés sont scellés dans le journal d'audit et peuvent être consultés par le jury.</p>
            <p t-if="props.pending" class="sl-alert sl-alert-warn">Décision en attente de synchronisation avec le serveur.</p>
            <button class="sl-btn sl-btn-ink sl-btn-lg" t-on-click="props.onDone">Quitter</button>
        </div>`;
    static props = ["reason", "pending", "onDone"];
}

export class PendingScreen extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ex-page ex-pending">
            <span class="sl-spinner" style="width:48px;height:48px;border-width:4px;color:var(--brand)"/>
            <h1>Copie terminée, synchronisation en cours</h1>
            <p>Le serveur d'examen est momentanément injoignable. Vos réponses sont sécurisées sur ce poste (<t t-esc="props.pending"/> envoi(s) en attente) et seront transmises automatiquement dès le retour du réseau.</p>
            <p class="sl-alert sl-alert-info">Ne fermez pas cette fenêtre et prévenez un surveillant.</p>
        </div>`;
    static props = ["pending"];
}
