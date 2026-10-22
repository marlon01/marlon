/** @odoo-module */
import { Component, mount, onMounted, useState, whenReady, xml } from "@odoo/owl";
import { jsonrpc } from "@selecta_concours/common/rpc";
import { Icon } from "@selecta_concours/common/ui";
import { fmtNum, readConfig } from "@selecta_concours/common/utils";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const FIELD_ORDER = ["plan", "organization", "contact_name", "email", "phone", "country", "password", "accept_terms"];
const FEATURE_LABELS = {
    ai_analysis: "analyse IA (psychométrie, fraude)",
    llm: "assistant de rédaction (LLM)",
    branding: "personnalisation (logo, couleur, slogan)",
};

/** Indication de robustesse du mot de passe (purement indicative : la règle est vérifiée par le serveur). */
function passwordStrength(pw) {
    const rules = { length: pw.length >= 10, mix: /[A-Za-z]/.test(pw) && /\d/.test(pw) };
    if (!pw) {
        return { level: 0, label: "", rules };
    }
    let score = 0;
    score += pw.length >= 10 ? 1 : 0;
    score += pw.length >= 14 ? 1 : 0;
    score += /[a-z]/.test(pw) && /[A-Z]/.test(pw) ? 1 : 0;
    score += /[^A-Za-z0-9]/.test(pw) ? 1 : 0;
    if (!rules.length || !rules.mix) {
        return { level: 1, label: "Insuffisant", rules };
    }
    if (score <= 1) {
        return { level: 2, label: "Acceptable", rules };
    }
    if (score === 2) {
        return { level: 3, label: "Bon", rules };
    }
    return { level: 4, label: "Excellent", rules };
}

class Signup extends Component {
    static components = { Icon };
    static template = xml`
        <div class="su-wrap" t-att-class="{ 'su-wrap-single': !(config.signup_enabled and plan) }">
            <main class="su-main">
                <div class="su-card">
                    <a class="su-mark" href="/selecta" aria-label="SELECTA, retour à la présentation">
                        <span class="su-mark-seal" aria-hidden="true">S</span>
                        <span class="su-mark-word">SELECTA</span>
                    </a>

                    <t t-if="!config.signup_enabled">
                        <h1>Inscriptions momentanément fermées</h1>
                        <div class="sl-alert sl-alert-info" role="status">
                            La création d'espace en ligne est suspendue pour le moment. Écrivez-nous et nous ouvrirons votre espace avec vous.
                        </div>
                        <div class="su-closed-actions">
                            <a class="sl-btn sl-btn-primary sl-btn-lg" t-att-href="'mailto:' + contactEmail + '?subject=Ouverture%20d%27un%20espace%20SELECTA'">Nous contacter</a>
                            <a class="sl-btn sl-btn-lg" href="/selecta">Retour à la présentation</a>
                        </div>
                        <p class="su-login">Déjà inscrit ? <a href="/selecta/login">Se connecter</a></p>
                    </t>

                    <form t-else="" class="su-form" t-on-submit.prevent="submit" novalidate="novalidate" autocomplete="on">
                        <div class="su-head">
                            <h1>Créer votre espace</h1>
                            <p class="su-sub">Essai gratuit de <t t-esc="config.trial_days"/> jours, sans carte bancaire. Vous serez l'administrateur de votre espace.</p>
                        </div>

                        <div t-if="state.error" class="sl-alert sl-alert-danger" role="alert" t-esc="state.error"/>

                        <!-- Mobile : récapitulatif compact de la catégorie choisie -->
                        <div t-if="plan" class="su-recap-m" role="note" aria-label="Récapitulatif de l'essai">
                            <div class="su-recap-m-top">
                                <span class="su-recap-m-name" t-esc="plan.name"/>
                                <span>puis <t t-esc="money(plan.price_monthly, plan)"/> / mois</span>
                            </div>
                            <div class="su-recap-m-facts"><t t-esc="config.trial_days"/> jours gratuits · jusqu'à <t t-esc="fmtNum(config.trial_max_candidates, 0)"/> candidats · toutes les fonctions de la catégorie · sans carte bancaire</div>
                        </div>

                        <fieldset class="su-plans" t-att-class="{ 'su-invalid': state.errors.plan }" t-att-aria-describedby="state.errors.plan ? 'su-err-plan' : null">
                            <legend class="sl-label">Catégorie de votre structure</legend>
                            <div t-if="!plans.length" class="sl-alert sl-alert-warn">Aucune catégorie n'est disponible pour le moment.</div>
                            <div class="su-plan-grid" t-att-data-count="plans.length">
                                <label t-foreach="plans" t-as="p" t-key="p.code" class="su-plan" t-att-class="{ 'su-plan-on': state.plan === p.code }">
                                    <input type="radio" name="plan" t-att-id="p_index === 0 ? 'su-plan' : null" t-att-value="p.code" t-att-checked="state.plan === p.code" t-on-change="() => this.pickPlan(p.code)"/>
                                    <span class="su-plan-name"><t t-esc="p.name"/><span t-if="p.highlight" class="su-plan-tag">Recommandé</span></span>
                                    <span class="su-plan-price"><span class="sl-figures" t-esc="money(p.price_monthly, p)"/> / mois</span>
                                </label>
                            </div>
                            <div t-if="state.errors.plan" id="su-err-plan" class="su-err" t-esc="state.errors.plan"/>
                        </fieldset>

                        <div class="su-grid">
                            <div class="sl-field su-col-2" t-att-class="{ 'su-invalid': state.errors.organization }">
                                <label for="su-organization">Nom de la structure</label>
                                <input id="su-organization" class="sl-input" t-model="state.organization" t-on-input="() => this.clear('organization')" autocomplete="organization" maxlength="120" required="required" placeholder="Ex. : Banque Commerciale du Congo" t-att-aria-invalid="state.errors.organization ? 'true' : null" t-att-aria-describedby="state.errors.organization ? 'su-err-organization' : null"/>
                                <div t-if="state.errors.organization" id="su-err-organization" class="su-err" t-esc="state.errors.organization"/>
                            </div>
                            <div class="sl-field" t-att-class="{ 'su-invalid': state.errors.contact_name }">
                                <label for="su-contact_name">Votre nom</label>
                                <input id="su-contact_name" class="sl-input" t-model="state.contact_name" t-on-input="() => this.clear('contact_name')" autocomplete="name" maxlength="120" required="required" t-att-aria-invalid="state.errors.contact_name ? 'true' : null" t-att-aria-describedby="state.errors.contact_name ? 'su-err-contact_name' : null"/>
                                <div t-if="state.errors.contact_name" id="su-err-contact_name" class="su-err" t-esc="state.errors.contact_name"/>
                            </div>
                            <div class="sl-field" t-att-class="{ 'su-invalid': state.errors.phone }">
                                <label for="su-phone">Téléphone <span class="su-opt">(facultatif)</span></label>
                                <input id="su-phone" class="sl-input" type="tel" t-model="state.phone" t-on-input="() => this.clear('phone')" autocomplete="tel" maxlength="40" placeholder="+243 …"/>
                                <div t-if="state.errors.phone" id="su-err-phone" class="su-err" t-esc="state.errors.phone"/>
                            </div>
                            <div class="sl-field su-col-2" t-att-class="{ 'su-invalid': state.errors.email }">
                                <label for="su-email">E-mail professionnel</label>
                                <input id="su-email" class="sl-input" type="email" t-model="state.email" t-on-input="() => this.clear('email')" autocomplete="email" maxlength="160" required="required" spellcheck="false" aria-describedby="su-help-email" t-att-aria-invalid="state.errors.email ? 'true' : null"/>
                                <div t-if="state.errors.email" id="su-err-email" class="su-err" t-esc="state.errors.email"/>
                                <div id="su-help-email" class="sl-help">Il vous servira d'identifiant de connexion.</div>
                            </div>
                            <div class="sl-field su-col-2" t-att-class="{ 'su-invalid': state.errors.country }">
                                <label for="su-country">Pays</label>
                                <select id="su-country" class="sl-input sl-select" t-model="state.country" t-on-change="() => this.clear('country')" autocomplete="country">
                                    <option value="">— Choisir —</option>
                                    <option t-foreach="countries" t-as="c" t-key="c.code" t-att-value="c.code" t-esc="c.name"/>
                                </select>
                                <div t-if="state.errors.country" id="su-err-country" class="su-err" t-esc="state.errors.country"/>
                            </div>
                            <div class="sl-field su-col-2" t-att-class="{ 'su-invalid': state.errors.password }">
                                <label for="su-password">Mot de passe</label>
                                <div class="su-pass">
                                    <input id="su-password" class="sl-input" t-att-type="state.show ? 'text' : 'password'" t-model="state.password" t-on-input="() => this.clear('password')" autocomplete="new-password" required="required" minlength="10" aria-describedby="su-pass-hint" t-att-aria-invalid="state.errors.password ? 'true' : null"/>
                                    <button type="button" class="sl-btn sl-btn-ghost sl-btn-icon" t-on-click="() => this.state.show = !this.state.show" t-att-aria-label="state.show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'" t-att-aria-pressed="state.show ? 'true' : 'false'"><Icon name="'eye'" size="16"/></button>
                                </div>
                                <div t-if="state.errors.password" id="su-err-password" class="su-err" t-esc="state.errors.password"/>
                                <div id="su-pass-hint" class="su-strength" t-att-data-level="strength.level" aria-live="polite">
                                    <div class="su-meter" aria-hidden="true"><span/><span/><span/><span/></div>
                                    <ul class="su-rules">
                                        <li t-att-class="{ 'su-rule-ok': strength.rules.length }"><Icon name="strength.rules.length ? 'check' : 'x'" size="13"/>10 caractères minimum</li>
                                        <li t-att-class="{ 'su-rule-ok': strength.rules.mix }"><Icon name="strength.rules.mix ? 'check' : 'x'" size="13"/>lettres et chiffres</li>
                                        <li t-if="strength.label" class="su-strength-label">Robustesse : <strong t-esc="strength.label"/></li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Champ piège : invisible pour les personnes, rempli par les robots. -->
                        <div class="su-hp" aria-hidden="true">
                            <label for="su-website">Site web</label>
                            <input id="su-website" name="website" type="text" tabindex="-1" autocomplete="off" t-model="state.website"/>
                        </div>

                        <div class="su-terms" t-att-class="{ 'su-invalid': state.errors.accept_terms }">
                            <label class="sl-check">
                                <input id="su-accept_terms" type="checkbox" t-model="state.accept_terms" t-on-change="() => this.clear('accept_terms')" t-att-aria-invalid="state.errors.accept_terms ? 'true' : null"/>
                                <span>J'accepte les conditions d'utilisation et la politique de confidentialité.</span>
                            </label>
                            <div t-if="state.errors.accept_terms" id="su-err-accept_terms" class="su-err" t-esc="state.errors.accept_terms"/>
                        </div>

                        <button class="sl-btn sl-btn-primary sl-btn-lg su-submit" type="submit" t-att-disabled="state.loading or !plans.length" t-att-aria-busy="state.loading ? 'true' : 'false'">
                            <t t-if="state.loading"><span class="sl-spinner"/> Création de votre espace…</t>
                            <t t-else="">Créer mon espace et démarrer l'essai</t>
                        </button>
                        <p class="su-login">Déjà inscrit ? <a href="/selecta/login">Se connecter</a></p>
                    </form>
                </div>
            </main>

            <aside class="su-side" t-if="config.signup_enabled and plan" aria-labelledby="su-side-title">
                <div class="su-side-in">
                    <p class="su-side-eyebrow">Votre essai gratuit</p>
                    <h2 id="su-side-title"><t t-esc="plan.name"/></h2>
                    <p t-if="plan.audience" class="su-side-aud" t-esc="plan.audience"/>
                    <div class="su-side-price">
                        <span class="sl-figures su-side-amt" t-esc="config.trial_days"/>
                        <span>jours gratuits, puis <strong><t t-esc="money(plan.price_monthly, plan)"/> / mois</strong> ou <t t-esc="money(plan.price_yearly, plan)"/> / an</span>
                    </div>
                    <h3>L'essai comprend</h3>
                    <ul class="su-side-list">
                        <li><Icon name="'clock'" size="16"/><span><t t-esc="config.trial_days"/> jours d'accès complet, dès maintenant</span></li>
                        <li><Icon name="'users'" size="16"/><span>Jusqu'à <t t-esc="fmtNum(config.trial_max_candidates, 0)"/> candidats pendant l'essai</span></li>
                        <li><Icon name="'shield'" size="16"/><span>Toutes les fonctions de la catégorie : surveillance webcam, procès-verbal scellé<t t-foreach="planFeatures" t-as="f" t-key="f">, <t t-esc="f"/></t></span></li>
                        <li><Icon name="'lock'" size="16"/><span>Sans carte bancaire, aucun prélèvement automatique</span></li>
                    </ul>
                    <dl class="su-side-limits">
                        <div><dt>Concours actifs</dt><dd t-esc="limit(plan.max_active_concours)"/></div>
                        <div><dt>Candidats / mois</dt><dd t-esc="limit(plan.max_candidates_month)"/></div>
                        <div><dt>Comptes du personnel</dt><dd t-esc="limit(plan.max_staff)"/></div>
                    </dl>
                    <p class="su-side-foot">À la fin de l'essai, sans abonnement, votre espace passe en consultation seule : vos résultats restent accessibles.</p>
                </div>
            </aside>
        </div>`;
    static props = {};

    setup() {
        this.config = readConfig();
        this.fmtNum = fmtNum;
        this.plans = this.config.plans || [];
        this.countries = this.config.countries || [];
        this.contactEmail = this.config.support_email || "contact@naxoris.com";
        const wanted = this.plans.find((p) => p.code === this.config.plan);
        const initial = wanted || this.plans.find((p) => p.highlight) || this.plans[0];
        const defaultCountry = this.countries.some((c) => c.code === this.config.default_country) ? this.config.default_country : "";
        this.state = useState({
            plan: initial ? initial.code : "",
            organization: "",
            contact_name: "",
            email: "",
            phone: "",
            country: defaultCountry,
            password: "",
            accept_terms: false,
            website: "",
            show: false,
            loading: false,
            error: "",
            errors: {},
        });
        onMounted(() => {
            if (this.config.signup_enabled) {
                document.getElementById("su-organization")?.focus();
            }
        });
    }

    get plan() {
        return this.plans.find((p) => p.code === this.state.plan) || null;
    }
    get planFeatures() {
        const features = this.plan?.features || {};
        return Object.keys(FEATURE_LABELS).filter((k) => features[k]).map((k) => FEATURE_LABELS[k]);
    }
    get strength() {
        return passwordStrength(this.state.password);
    }
    money(amount, plan) {
        return `${fmtNum(amount, 2)} ${plan?.symbol || "$"}`;
    }
    limit(value) {
        return value ? fmtNum(value, 0) : "Illimité";
    }

    pickPlan(code) {
        this.state.plan = code;
        this.clear("plan");
    }
    clear(field) {
        if (this.state.errors[field]) {
            delete this.state.errors[field];
            if (!Object.keys(this.state.errors).length) {
                this.state.error = "";
            }
        }
    }

    validate() {
        const s = this.state;
        const errors = {};
        if (!s.plan) {
            errors.plan = "Choisissez votre catégorie.";
        }
        if (s.organization.trim().length < 2) {
            errors.organization = "Indiquez le nom de votre structure.";
        }
        if (s.contact_name.trim().length < 2) {
            errors.contact_name = "Indiquez votre nom complet.";
        }
        if (!EMAIL_RE.test(s.email.trim())) {
            errors.email = "Adresse e-mail invalide.";
        }
        if (!s.country) {
            errors.country = "Choisissez votre pays.";
        }
        const rules = passwordStrength(s.password).rules;
        if (!rules.length || !rules.mix) {
            errors.password = "Le mot de passe doit comporter au moins 10 caractères, dont des lettres et des chiffres.";
        }
        if (!s.accept_terms) {
            errors.accept_terms = "Vous devez accepter les conditions d'utilisation.";
        }
        return errors;
    }

    showErrors(errors, message) {
        this.state.errors = errors;
        const fields = FIELD_ORDER.filter((f) => errors[f]);
        this.state.error = message || (fields.length > 1 ? "Certains champs sont à corriger." : errors[fields[0]]);
        const first = fields[0];
        // Laisse OWL rendre les messages avant de placer le focus.
        requestAnimationFrame(() => {
            const el = first && document.getElementById(`su-${first}`);
            if (el) {
                el.focus();
                el.scrollIntoView({ block: "center", behavior: "smooth" });
            } else {
                document.querySelector(".su-form .sl-alert-danger")?.scrollIntoView({ block: "center" });
            }
        });
    }

    async submit() {
        if (this.state.loading) {
            return;
        }
        const errors = this.validate();
        if (Object.keys(errors).length) {
            this.showErrors(errors);
            return;
        }
        const s = this.state;
        s.loading = true;
        s.error = "";
        s.errors = {};
        try {
            const res = await jsonrpc("/selecta/saas/signup", {
                organization: s.organization.trim(),
                contact_name: s.contact_name.trim(),
                email: s.email.trim(),
                phone: s.phone.trim(),
                country: s.country,
                password: s.password,
                plan: s.plan,
                accept_terms: s.accept_terms,
                website: s.website,
            }, { timeout: 60000 });
            if (res && res.ok) {
                window.location.href = res.redirect || "/selecta/admin";
                return; // le bouton reste en chargement pendant la redirection
            }
            const err = (res && res.error) || "L'inscription n'a pas abouti. Réessayez.";
            s.loading = false;
            this.showErrors(res && res.field ? { [res.field]: err } : {}, err);
        } catch (e) {
            s.loading = false;
            this.showErrors({}, e.message || "Serveur injoignable. Vérifiez votre connexion et réessayez.");
        }
    }
}

whenReady(() => {
    const root = document.getElementById("selecta-root");
    root.innerHTML = "";
    mount(Signup, root, { dev: false, name: "SELECTA Inscription" });
});
