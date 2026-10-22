/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { Icon, notify } from "@selecta_concours/common/ui";
import { fmtNum } from "@selecta_concours/common/utils";
import { errMessage, limitLabel, money, papi, pstore } from "@selecta_saas/platform/papi";

const FEATURE_LABELS = {
    ai_analysis: "Analyse IA (psychométrie, fraude)",
    llm: "Assistant de rédaction (LLM)",
    branding: "Personnalisation (logo, couleur, slogan)",
};
const CODE_RE = /^[a-z0-9_]+$/;

function blankPlan() {
    return {
        id: false, code: "", name: "", audience: "", description: "", price_monthly: 0, price_yearly: 0,
        max_active_concours: 0, max_candidates_month: 0, max_staff: 0, support: "Par e-mail", highlight: false,
        active: true, sequence: 50, features: { ai_analysis: true, llm: false, branding: false },
    };
}

export class PlansPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div>
                    <p class="pf-eyebrow">Administration centrale</p>
                    <h1>Catégories et tarifs</h1>
                    <p class="sl-muted">Grille publiée sur la page de présentation et proposée aux structures lors de la souscription. Une modification de prix s'applique aux prochaines factures.</p>
                </div>
                <div class="ad-head-actions"><button class="sl-btn sl-btn-primary" t-on-click="() => this.edit(null)"><Icon name="'plus'"/>Nouvelle catégorie</button></div>
            </header>
            <div t-if="state.error" class="sl-alert sl-alert-danger ad-mb" role="alert"><t t-esc="state.error"/></div>
            <div t-if="!state.loaded and !state.error" class="ad-loading"><span class="sl-spinner"/></div>
            <div t-elif="!state.plans.length and state.loaded" class="ad-panel ad-empty"><p>Aucune catégorie. Créez la première pour ouvrir les inscriptions.</p></div>
            <div class="pf-plans">
                <article t-foreach="state.plans" t-as="p" t-key="p.id" class="pf-plan" t-att-class="{'is-highlight': p.highlight, 'is-inactive': !p.active}">
                    <header class="pf-plan-head">
                        <div class="sl-grow">
                            <div class="sl-row sl-wrap pf-plan-flags">
                                <span class="sl-mono ad-small sl-muted" t-esc="p.code"/>
                                <span t-if="p.highlight" class="sl-badge sl-badge-info">Mise en avant</span>
                                <span t-if="!p.active" class="sl-badge">Inactive</span>
                            </div>
                            <h2 t-esc="p.name"/>
                            <p class="sl-muted ad-small" t-esc="p.audience"/>
                        </div>
                        <button class="sl-btn sl-btn-sm" t-on-click="() => this.edit(p)" t-att-aria-label="'Modifier la catégorie ' + p.name"><Icon name="'edit'" size="16"/>Modifier</button>
                    </header>
                    <div class="pf-plan-price">
                        <span class="sl-figures"><t t-esc="num(p.price_monthly)"/><i t-esc="p.symbol"/></span><small>/ mois</small>
                    </div>
                    <p class="ad-small pf-plan-yearly">
                        <t t-esc="money(p.price_yearly, p.symbol)"/> / an
                        <t t-if="p.yearly_saving"> · économie <strong t-esc="money(p.yearly_saving, p.symbol)"/> (<t t-esc="savingPct(p)"/>)</t>
                    </p>
                    <p t-if="p.description" class="pf-plan-desc" t-esc="p.description"/>
                    <dl class="pf-plan-limits">
                        <div><dt>Concours actifs</dt><dd t-esc="limit(p.max_active_concours)"/></div>
                        <div><dt>Candidats / mois</dt><dd t-esc="limit(p.max_candidates_month)"/></div>
                        <div><dt>Comptes du personnel</dt><dd t-esc="limit(p.max_staff)"/></div>
                        <div><dt>Support</dt><dd t-esc="p.support or '—'"/></div>
                    </dl>
                    <ul class="pf-plan-features">
                        <li t-foreach="featureKeys" t-as="f" t-key="f" t-att-class="p.features[f] ? 'is-on' : 'is-off'">
                            <Icon name="p.features[f] ? 'check' : 'x'" size="14"/><span t-esc="featureLabels[f]"/>
                            <span class="sl-sr" t-esc="p.features[f] ? '(incluse)' : '(non incluse)'"/>
                        </li>
                    </ul>
                    <footer class="pf-plan-foot ad-small">
                        <span><b class="sl-figures" t-esc="p.tenant_count"/> structure(s)</span>
                        <span class="sl-muted">Ordre d'affichage <t t-esc="p.sequence"/></span>
                    </footer>
                </article>
            </div>

            <div t-if="state.form" class="sl-overlay" t-on-keydown="(ev) => ev.key == 'Escape' and this.close()">
                <form class="sl-dialog sl-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="pf-plan-title" t-on-submit.prevent="save">
                    <t t-set="f" t-value="state.form"/>
                    <div class="sl-dialog-head"><h3 id="pf-plan-title" t-esc="f.id ? 'Modifier la catégorie « ' + f.name + ' »' : 'Nouvelle catégorie'"/></div>
                    <div class="sl-dialog-body">
                        <div class="ad-form">
                            <div class="sl-field">
                                <label for="pf-p-name">Nom de la catégorie</label>
                                <input id="pf-p-name" class="sl-input" t-model="f.name" required="required"/>
                            </div>
                            <div class="sl-field">
                                <label for="pf-p-code">Code</label>
                                <input id="pf-p-code" class="sl-input sl-mono" t-model="f.code" t-att-readonly="f.id" placeholder="ex. : cabinet_rh" autocomplete="off"/>
                                <span t-if="codeError" class="pf-field-error" t-esc="codeError"/>
                                <span t-else="" class="sl-help" t-esc="f.id ? 'Identifiant technique, utilisé dans les liens d’inscription : non modifiable.' : 'Minuscules, chiffres et « _ » uniquement. Non modifiable ensuite.'"/>
                            </div>
                            <div class="sl-field ad-span-2">
                                <label for="pf-p-aud">Public visé</label>
                                <input id="pf-p-aud" class="sl-input" t-model="f.audience" placeholder="ex. : PME, cabinets de recrutement"/>
                            </div>
                            <div class="sl-field ad-span-2">
                                <label for="pf-p-desc">Description</label>
                                <textarea id="pf-p-desc" class="sl-textarea" rows="2" t-model="f.description"/>
                            </div>

                            <h4 class="ad-form-title ad-span-2">Tarifs</h4>
                            <div class="sl-field">
                                <label for="pf-p-pm">Prix mensuel ($)</label>
                                <input id="pf-p-pm" class="sl-input" type="number" min="0" step="1" t-model.number="f.price_monthly"/>
                            </div>
                            <div class="sl-field">
                                <label for="pf-p-py">Prix annuel ($)</label>
                                <div class="pf-inline">
                                    <input id="pf-p-py" class="sl-input" type="number" min="0" step="1" t-model.number="f.price_yearly"/>
                                    <button type="button" class="sl-btn sl-btn-sm sl-btn-ghost" t-on-click="yearlyFromMonthly" title="Prix annuel = 10 × prix mensuel">10 × mensuel</button>
                                </div>
                                <span class="sl-help" t-att-class="{'ad-danger-text': formSaving lt 0 or (f.price_monthly gt 0 and !(f.price_yearly gt 0))}" t-esc="savingText"/>
                            </div>

                            <h4 class="ad-form-title ad-span-2">Limites <span class="sl-muted ad-small">(0 = illimité)</span></h4>
                            <div class="ad-span-2 pf-grid-3">
                                <div class="sl-field"><label for="pf-p-l1">Concours actifs simultanés</label><input id="pf-p-l1" class="sl-input" type="number" min="0" t-model.number="f.max_active_concours"/></div>
                                <div class="sl-field"><label for="pf-p-l2">Candidats par mois</label><input id="pf-p-l2" class="sl-input" type="number" min="0" t-model.number="f.max_candidates_month"/></div>
                                <div class="sl-field"><label for="pf-p-l3">Comptes du personnel</label><input id="pf-p-l3" class="sl-input" type="number" min="0" t-model.number="f.max_staff"/></div>
                            </div>

                            <h4 class="ad-form-title ad-span-2">Fonctions incluses et présentation</h4>
                            <div class="ad-span-2 pf-switches">
                                <label t-foreach="featureKeys" t-as="k" t-key="k" class="ad-toggle">
                                    <span class="sl-switch"><input type="checkbox" t-model="f.features[k]"/><span/></span>
                                    <span t-esc="featureLabels[k]"/>
                                </label>
                                <label class="ad-toggle">
                                    <span class="sl-switch"><input type="checkbox" t-model="f.highlight"/><span/></span>
                                    <span><strong>Mise en avant</strong><small class="sl-muted">Recommandée sur la grille publique</small></span>
                                </label>
                                <label class="ad-toggle">
                                    <span class="sl-switch"><input type="checkbox" t-model="f.active"/><span/></span>
                                    <span><strong>Active</strong><small class="sl-muted">Proposée à l'inscription et à la souscription</small></span>
                                </label>
                            </div>
                            <div class="sl-field">
                                <label for="pf-p-sup">Support</label>
                                <input id="pf-p-sup" class="sl-input" t-model="f.support" placeholder="ex. : E-mail et téléphone"/>
                            </div>
                            <div class="sl-field">
                                <label for="pf-p-seq">Ordre d'affichage</label>
                                <input id="pf-p-seq" class="sl-input" type="number" t-model.number="f.sequence"/>
                                <span class="sl-help">Les catégories sont présentées par ordre croissant.</span>
                            </div>
                        </div>
                        <div t-if="state.formError" class="sl-alert sl-alert-danger ad-mt" role="alert" t-esc="state.formError"/>
                    </div>
                    <div class="sl-dialog-foot">
                        <button type="button" class="sl-btn" t-on-click="close">Annuler</button>
                        <button type="submit" class="sl-btn sl-btn-primary" t-att-disabled="!canSave or state.saving">
                            <t t-if="state.saving"><span class="sl-spinner"/> Enregistrement…</t><t t-else="">Enregistrer</t>
                        </button>
                    </div>
                </form>
            </div>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ plans: [], loaded: false, error: "", form: null, formError: "", saving: false });
        this.featureLabels = { ...FEATURE_LABELS, ...(pstore.session?.features || {}) };
        this.featureKeys = Object.keys(this.featureLabels);
        onWillStart(() => this.load());
    }
    async load() {
        try {
            this.state.plans = await papi("plans_list");
            this.state.loaded = true;
        } catch (e) {
            this.state.error = errMessage(e);
        }
    }
    edit(p) {
        const base = p ? JSON.parse(JSON.stringify(p)) : blankPlan();
        this.state.form = { ...blankPlan(), ...base, features: { ...blankPlan().features, ...(base.features || {}) } };
        this.state.formError = "";
        setTimeout(() => document.getElementById("pf-p-name")?.focus(), 30);
    }
    yearlyFromMonthly() {
        const f = this.state.form;
        f.price_yearly = (Number(f.price_monthly) || 0) * 10;
    }
    close() {
        this.state.form = null;
    }
    get codeError() {
        const c = (this.state.form.code || "").trim();
        if (this.state.form.id || !c) {
            return "";
        }
        return CODE_RE.test(c) ? "" : "Utilisez uniquement des minuscules, des chiffres et « _ ».";
    }
    get formSaving() {
        const f = this.state.form;
        return (Number(f.price_monthly) || 0) * 12 - (Number(f.price_yearly) || 0);
    }
    get savingText() {
        const f = this.state.form;
        const s = this.formSaving;
        const full = (Number(f.price_monthly) || 0) * 12;
        if (!full) {
            return "Saisissez le prix mensuel pour calculer l'économie annuelle.";
        }
        if (!(Number(f.price_yearly) > 0)) {
            return "Indiquez le prix annuel (habituellement 10 × le prix mensuel).";
        }
        if (s < 0) {
            return `Le prix annuel dépasse 12 mensualités (${money(full)}).`;
        }
        if (s === 0) {
            return "Aucune économie par rapport à 12 mensualités.";
        }
        return `Économie de ${money(s)} par an, soit ${fmtNum((100 * s) / full, 0)} % (${fmtNum(s / (Number(f.price_monthly) || 1), 1)} mois offerts).`;
    }
    get canSave() {
        const f = this.state.form;
        const nums = [f.price_monthly, f.price_yearly, f.max_active_concours, f.max_candidates_month, f.max_staff];
        const yearlyOk = !(Number(f.price_monthly) > 0) || Number(f.price_yearly) > 0;
        return (f.name || "").trim() && (f.code || "").trim() && !this.codeError && yearlyOk && nums.every((n) => n !== "" && Number(n) >= 0);
    }
    async save() {
        if (!this.canSave) {
            return;
        }
        const f = this.state.form;
        const vals = {
            name: f.name.trim(), audience: (f.audience || "").trim(), description: (f.description || "").trim(),
            price_monthly: Number(f.price_monthly) || 0, price_yearly: Number(f.price_yearly) || 0,
            max_active_concours: parseInt(f.max_active_concours) || 0, max_candidates_month: parseInt(f.max_candidates_month) || 0,
            max_staff: parseInt(f.max_staff) || 0, support: (f.support || "").trim(), highlight: !!f.highlight, active: !!f.active,
            sequence: parseInt(f.sequence) || 0, features: { ...f.features },
        };
        if (f.id) {
            vals.id = f.id;
        } else {
            vals.code = f.code.trim();
        }
        this.state.saving = true;
        this.state.formError = "";
        try {
            this.state.plans = await papi("plan_save", [vals]);
            notify(f.id ? "Catégorie enregistrée." : "Catégorie créée.", "ok");
            this.state.form = null;
        } catch (e) {
            this.state.formError = errMessage(e);
        } finally {
            this.state.saving = false;
        }
    }
    num(v) {
        return fmtNum(v, 2);
    }
    money(v, s) {
        return money(v, s);
    }
    limit(v) {
        return limitLabel(v);
    }
    savingPct(p) {
        const full = p.price_monthly * 12;
        return full ? `${fmtNum((100 * p.yearly_saving) / full, 0)} %` : "";
    }
}
