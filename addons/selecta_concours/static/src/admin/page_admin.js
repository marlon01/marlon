/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { Icon, notify } from "@selecta_concours/common/ui";
import { debounce, fmtDateTime, readFileAsDataURL } from "@selecta_concours/common/utils";
import { store } from "@selecta_concours/admin/store";

// ======================================================================= journal d'audit
export class AuditPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div><h1>Journal d'audit</h1><p class="sl-muted">Chaque opération est chaînée à la précédente par une empreinte SHA-256 : toute modification en base est détectable.</p></div>
                <div class="ad-head-actions"><button class="sl-btn sl-btn-ink" t-att-disabled="state.verifying" t-on-click="verify"><Icon name="'shield'"/>Vérifier l'intégrité</button></div>
            </header>
            <div t-if="state.check" class="ad-check" t-att-class="state.check.ok ? 'is-ok' : 'is-ko'">
                <Icon name="state.check.ok ? 'check' : 'alert'" size="28"/>
                <div>
                    <strong t-if="state.check.ok">Chaîne intègre : <t t-esc="state.check.count"/> entrées vérifiées.</strong>
                    <strong t-else="">Anomalie détectée à l'entrée n° <t t-esc="state.check.broken_at"/></strong>
                    <div t-if="state.check.ok" class="sl-mono ad-small">Empreinte de tête <t t-esc="state.check.head"/></div>
                    <div t-else="" t-esc="state.check.reason"/>
                </div>
            </div>
            <div class="ad-toolbar">
                <div class="ad-search"><Icon name="'search'" size="16"/><input class="sl-input" placeholder="Filtrer par événement ou message" t-on-input="onSearch"/></div>
                <span class="sl-muted"><t t-esc="state.total"/> entrée(s)</span>
                <div class="sl-grow"/>
                <button class="sl-btn sl-btn-sm" t-att-disabled="state.offset == 0" t-on-click="() => this.page(-1)"><Icon name="'chevronLeft'" size="16"/></button>
                <span class="sl-muted ad-small"><t t-esc="state.offset + 1"/> à <t t-esc="Math.min(state.offset + limit, state.total)"/></span>
                <button class="sl-btn sl-btn-sm" t-att-disabled="state.offset + limit gte state.total" t-on-click="() => this.page(1)"><Icon name="'chevronRight'" size="16"/></button>
            </div>
            <section class="ad-panel ad-panel-flush">
                <table class="ad-table ad-table-dense">
                    <thead><tr><th class="num">N°</th><th>Date</th><th>Utilisateur</th><th>Événement</th><th>Détail</th><th>Concours</th><th>Empreinte</th></tr></thead>
                    <tbody>
                        <t t-foreach="state.rows" t-as="l" t-key="l.id">
                            <tr class="is-link" t-on-click="() => this.state.open = this.state.open == l.id ? 0 : l.id">
                                <td class="num sl-figures" t-esc="l.sequence"/>
                                <td t-esc="date(l.date)"/>
                                <td class="ad-small" t-esc="l.user"/>
                                <td class="sl-mono ad-small" t-esc="l.event"/>
                                <td t-esc="l.message"/>
                                <td class="ad-small" t-esc="l.concours"/>
                                <td class="sl-mono ad-small" t-att-title="l.hash" t-esc="l.hash.slice(0, 12)"/>
                            </tr>
                            <tr t-if="state.open == l.id" class="ad-detail"><td colspan="7">
                                <div class="ad-small"><strong>Empreinte précédente</strong> <span class="sl-mono" t-esc="l.prev_hash"/></div>
                                <div class="ad-small"><strong>Empreinte</strong> <span class="sl-mono" t-esc="l.hash"/></div>
                                <div t-if="l.ip" class="ad-small"><strong>Adresse</strong> <t t-esc="l.ip"/></div>
                                <pre class="ad-pre" t-esc="pretty(l.payload)"/>
                            </td></tr>
                        </t>
                    </tbody>
                </table>
            </section>
        </div>`;
    static props = {};
    setup() {
        this.limit = 60;
        this.state = useState({ rows: [], total: 0, offset: 0, search: "", open: 0, check: null, verifying: false });
        this.onSearch = debounce((ev) => {
            this.state.search = ev.target.value;
            this.state.offset = 0;
            this.load();
        }, 300);
        onWillStart(() => this.load());
    }
    async load() {
        const res = await api("audit_list", [this.state.offset, this.limit, false, this.state.search]);
        this.state.rows = res.rows;
        this.state.total = res.total;
    }
    page(dir) {
        this.state.offset = Math.max(0, this.state.offset + dir * this.limit);
        this.load();
    }
    async verify() {
        this.state.verifying = true;
        try {
            this.state.check = await api("audit_verify");
            await this.load();
        } finally {
            this.state.verifying = false;
        }
    }
    date(v) {
        return fmtDateTime(v);
    }
    pretty(p) {
        try {
            return JSON.stringify(JSON.parse(p), null, 2);
        } catch {
            return p;
        }
    }
}

// ======================================================================= personnel
export class StaffPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page">
            <header class="ad-head">
                <div><h1>Personnel et accès</h1><p class="sl-muted">Séparation des pouvoirs : les concepteurs ne voient pas les candidats en direct, les surveillants n'ont jamais accès aux questions ni aux corrigés.</p></div>
                <div class="ad-head-actions"><button class="sl-btn sl-btn-primary" t-on-click="() => this.edit(null)"><Icon name="'plus'"/>Ajouter un membre</button></div>
            </header>
            <section class="ad-roles">
                <div t-foreach="roleCards" t-as="r" t-key="r.key" class="ad-role">
                    <strong t-esc="r.label"/><p t-esc="r.help"/>
                </div>
            </section>
            <section class="ad-panel ad-panel-flush">
                <table class="ad-table">
                    <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Dernière connexion</th><th>Statut</th><th/></tr></thead>
                    <tbody>
                        <tr t-foreach="state.users" t-as="u" t-key="u.id" t-att-class="{'is-muted': !u.active}">
                            <td><strong t-esc="u.name"/><span t-if="u.is_me" class="sl-badge sl-badge-info ad-ml">vous</span><div class="sl-muted ad-small" t-esc="u.email"/></td>
                            <td class="sl-mono" t-esc="u.login"/>
                            <td t-esc="u.role_label"/>
                            <td t-esc="date(u.login_date)"/>
                            <td><span t-attf-class="sl-badge {{u.active ? 'sl-badge-ok' : ''}}" t-esc="u.active ? 'Actif' : 'Désactivé'"/></td>
                            <td class="num">
                                <t t-if="!u.is_system or u.is_me">
                                    <button class="sl-btn sl-btn-ghost sl-btn-icon" title="Modifier" t-on-click="() => this.edit(u)"><Icon name="'edit'" size="16"/></button>
                                </t>
                                <button t-if="!u.is_me and !u.is_system" class="sl-btn sl-btn-ghost sl-btn-sm" t-on-click="() => this.toggle(u)" t-esc="u.active ? 'Désactiver' : 'Réactiver'"/>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <div t-if="state.form" class="sl-overlay">
                <div class="sl-dialog">
                    <div class="sl-dialog-head"><h3 t-esc="state.form.id ? 'Modifier le compte' : 'Nouveau membre'"/></div>
                    <div class="sl-dialog-body ad-form ad-form-1">
                        <div class="sl-field"><label>Nom complet</label><input class="sl-input" t-model="state.form.name"/></div>
                        <div class="sl-field"><label>Identifiant de connexion</label><input class="sl-input" t-model="state.form.login" t-att-disabled="state.form.id"/></div>
                        <div class="sl-field"><label>E-mail</label><input class="sl-input" type="email" t-model="state.form.email"/></div>
                        <div class="sl-field"><label>Rôle</label>
                            <select class="sl-select" t-model="state.form.role"><option t-foreach="state.roles" t-as="r" t-key="r.key" t-att-value="r.key" t-esc="r.label"/></select>
                        </div>
                        <div class="sl-field"><label t-esc="state.form.id ? 'Nouveau mot de passe (laisser vide pour conserver)' : 'Mot de passe'"/>
                            <input class="sl-input" type="password" autocomplete="new-password" t-model="state.form.password"/>
                            <span class="sl-help">10 caractères minimum. Communiquez-le en main propre.</span>
                        </div>
                    </div>
                    <div class="sl-dialog-foot">
                        <button class="sl-btn" t-on-click="() => this.state.form = null">Annuler</button>
                        <button class="sl-btn sl-btn-primary" t-on-click="save">Enregistrer</button>
                    </div>
                </div>
            </div>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ users: [], roles: [], form: null });
        this.roleCards = [
            { key: "admin", label: "Administrateur concours", help: "Concours, candidats, codes d'accès, personnel et paramètres." },
            { key: "concepteur", label: "Concepteur", help: "Banque de questions et paramétrage pédagogique." },
            { key: "jury", label: "Jury", help: "Résultats, analyse IA, clôture et publication du procès-verbal." },
            { key: "surveillant", label: "Surveillant", help: "Suivi en direct, reprise sur incident, disqualification motivée." },
        ];
        onWillStart(() => this.load());
    }
    async load() {
        const res = await api("staff_list");
        this.state.users = res.users;
        this.state.roles = res.roles;
    }
    edit(u) {
        this.state.form = u ? { id: u.id, name: u.name, login: u.login, email: u.email, role: u.role || "surveillant", password: "" } : { name: "", login: "", email: "", role: "surveillant", password: "" };
    }
    async save() {
        try {
            const res = await api("staff_save", [this.state.form]);
            this.state.users = res.users;
            this.state.form = null;
            notify("Compte enregistré.", "ok");
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    async toggle(u) {
        try {
            this.state.users = (await api("staff_toggle", [u.id])).users;
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    date(v) {
        return v ? fmtDateTime(v) : "Jamais";
    }
}

// ======================================================================= paramètres
export class SettingsPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page" t-if="state.s">
            <header class="ad-head">
                <div><h1>Paramètres</h1><p class="sl-muted">Identité de la structure, sécurité des connexions et assistant d'analyse.</p></div>
                <div class="ad-head-actions"><button class="sl-btn sl-btn-primary" t-on-click="save"><Icon name="'check'"/>Enregistrer</button></div>
            </header>
            <section class="ad-panel ad-form">
                <h2 class="ad-span-2">Structure organisatrice</h2>
                <div class="sl-field"><label>Nom affiché aux candidats</label><input class="sl-input" t-model="state.s.company_name"/></div>
                <div class="sl-field"><label>Slogan</label><input class="sl-input" t-model="state.s.tagline"/></div>
                <div class="sl-field"><label>Couleur de marque</label><div class="sl-row"><input type="color" t-model="state.s.brand_color" class="ad-color"/><span class="sl-mono" t-esc="state.s.brand_color"/></div></div>
                <div class="sl-field"><label>Logo</label><div class="sl-row"><img t-att-src="state.logoPreview or logo" class="ad-logo-preview" alt=""/><label class="sl-btn sl-btn-sm"><Icon name="'upload'" size="16"/>Changer<input type="file" accept="image/*" class="sl-hidden" t-on-change="pickLogo"/></label></div></div>
            </section>
            <section class="ad-panel ad-form">
                <h2 class="ad-span-2">Sécurité des connexions</h2>
                <div class="sl-field"><label>Essais infructueux avant verrouillage du poste</label><input type="number" min="3" class="sl-input" t-model.number="state.s.login_max_failures"/></div>
                <div class="sl-field"><label>Durée du verrouillage (minutes)</label><input type="number" min="1" class="sl-input" t-model.number="state.s.login_lock_minutes"/></div>
                <p class="sl-help ad-span-2">S'applique aux codes candidats et aux comptes du personnel. Un code compte 60 bits d'entropie : sa découverte par essais successifs est impossible en pratique.</p>
            </section>
            <section class="ad-panel ad-form">
                <h2 class="ad-span-2">Assistant de rédaction (LLM local, facultatif)</h2>
                <p class="sl-help ad-span-2">L'analyse psychométrique et la détection de fraude fonctionnent sans cet assistant. S'il est activé, seules des statistiques anonymisées lui sont transmises. Recommandé : Ollama installé sur le serveur, pour rester 100 % hors ligne.</p>
                <label class="ad-toggle ad-span-2"><span class="sl-switch"><input type="checkbox" t-model="state.s.llm_enabled"/><span/></span><span><strong>Activer l'assistant</strong></span></label>
                <div class="sl-field ad-span-2"><label>Point d'accès compatible OpenAI</label><input class="sl-input sl-mono" t-model="state.s.llm_endpoint" placeholder="http://127.0.0.1:11434/v1/chat/completions"/></div>
                <div class="sl-field"><label>Modèle</label><input class="sl-input" t-model="state.s.llm_model" placeholder="llama3.1:8b"/></div>
                <div class="sl-field"><label>Clé d'API <span class="sl-muted" t-if="state.s.llm_has_key">(enregistrée)</span></label><input class="sl-input" type="password" t-model="state.s.llm_api_key" placeholder="Facultatif"/></div>
                <div class="ad-span-2 sl-row"><button class="sl-btn sl-btn-sm" t-on-click="testLLM"><Icon name="'brain'" size="16"/>Tester la connexion</button><span t-if="state.llmTest" t-att-class="state.llmTest.ok ? 'ad-ok-text' : 'ad-danger-text'" t-esc="state.llmTest.ok ? 'Assistant opérationnel.' : state.llmTest.error"/></div>
            </section>
            <section class="ad-panel">
                <h2>Accès des postes</h2>
                <dl class="ad-statlist">
                    <div><dt>Espace candidat</dt><dd class="sl-mono" t-esc="origin + '/selecta/exam'"/></div>
                    <div><dt>Console du personnel</dt><dd class="sl-mono" t-esc="origin + '/selecta/login'"/></div>
                </dl>
                <p class="sl-help">Sur les postes candidats, utilisez le lanceur « Poste candidat » fourni : navigateur en mode kiosque verrouillé, caméra autorisée, aucune barre d'adresse.</p>
            </section>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ s: null, logoPreview: null, logoData: null, llmTest: null });
        onWillStart(async () => (this.state.s = await api("settings_get")));
    }
    get logo() {
        return store.session.company.logo;
    }
    get origin() {
        return location.origin;
    }
    async pickLogo(ev) {
        const f = ev.target.files[0];
        if (f) {
            this.state.logoData = await readFileAsDataURL(f);
            this.state.logoPreview = this.state.logoData;
        }
    }
    async save() {
        const vals = { ...this.state.s };
        if (this.state.logoData) {
            vals.logo_data = this.state.logoData;
        }
        try {
            this.state.s = await api("settings_save", [vals]);
            document.documentElement.style.setProperty("--brand", this.state.s.brand_color);
            store.session.company.name = this.state.s.company_name;
            notify("Paramètres enregistrés.", "ok");
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    async testLLM() {
        await this.save();
        this.state.llmTest = await api("llm_test");
    }
}
