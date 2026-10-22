/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { Icon, notify } from "@selecta_concours/common/ui";
import { errMessage, papi } from "@selecta_saas/platform/papi";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export class SettingsPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page">
            <header class="ad-head">
                <div>
                    <p class="pf-eyebrow">Administration centrale</p>
                    <h1>Paramètres de la plateforme</h1>
                    <p class="sl-muted">Règles d'essai, modalités de paiement et coordonnées communiquées aux structures.</p>
                </div>
            </header>
            <div t-if="state.error" class="sl-alert sl-alert-danger ad-mb" role="alert"><t t-esc="state.error"/></div>
            <div t-if="!state.form and !state.error" class="ad-loading"><span class="sl-spinner"/></div>
            <form t-if="state.form" class="pf-settings" t-on-submit.prevent="save" novalidate="novalidate">
                <t t-set="f" t-value="state.form"/>
                <section class="ad-panel">
                    <div class="ad-panel-head"><h2>Essai gratuit et inscriptions</h2></div>
                    <div class="ad-form">
                        <label class="ad-toggle ad-span-2">
                            <span class="sl-switch"><input type="checkbox" t-model="f.signup_enabled"/><span/></span>
                            <span><strong>Inscriptions ouvertes</strong><small class="sl-muted">Désactivées, la page publique n'accepte plus de nouvelles structures ; les comptes existants ne sont pas affectés.</small></span>
                        </label>
                        <div class="sl-field">
                            <label for="pf-s-trial">Durée de l'essai gratuit (jours)</label>
                            <input id="pf-s-trial" class="sl-input" type="number" min="1" max="90" t-model.number="f.trial_days" t-att-aria-invalid="errors.trial_days ? 'true' : 'false'"/>
                            <span t-if="errors.trial_days" class="pf-field-error" t-esc="errors.trial_days"/>
                            <span t-else="" class="sl-help">De 1 à 90 jours. S'applique aux nouvelles inscriptions.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-grace">Délai de grâce après échéance (jours)</label>
                            <input id="pf-s-grace" class="sl-input" type="number" min="0" t-model.number="f.grace_days" t-att-aria-invalid="errors.grace_days ? 'true' : 'false'"/>
                            <span t-if="errors.grace_days" class="pf-field-error" t-esc="errors.grace_days"/>
                            <span t-else="" class="sl-help">Accès complet maintenu (statut « Paiement en retard ») avant le passage en consultation seule.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-cap">Plafond de candidats pendant l'essai</label>
                            <input id="pf-s-cap" class="sl-input" type="number" min="0" t-model.number="f.trial_max_candidates" t-att-aria-invalid="errors.trial_max_candidates ? 'true' : 'false'"/>
                            <span t-if="errors.trial_max_candidates" class="pf-field-error" t-esc="errors.trial_max_candidates"/>
                            <span t-else="" class="sl-help">Nombre total de candidats qu'une structure peut inscrire avant de souscrire. 0 = pas de plafond.</span>
                        </div>
                    </div>
                </section>

                <section class="ad-panel">
                    <div class="ad-panel-head"><h2>Paiement</h2><span class="sl-muted ad-small">Affiché aux structures sur leur page « Abonnement »</span></div>
                    <div class="ad-form">
                        <div class="sl-field ad-span-2">
                            <label for="pf-s-instr">Instructions de paiement</label>
                            <textarea id="pf-s-instr" class="sl-textarea" rows="6" t-model="f.payment_instructions"
                                      placeholder="Ex. : M-Pesa, numéro marchand 123456 (Naxoris SARL). Virement : Rawbank, compte n° … Indiquez le numéro de facture en référence."/>
                            <span class="sl-help">Numéros Mobile Money, coordonnées bancaires, mentions à reporter. Le texte est affiché tel quel, retours à la ligne compris.</span>
                        </div>
                        <div class="sl-field ad-span-2">
                            <label for="pf-s-link">Lien de paiement en ligne</label>
                            <input id="pf-s-link" class="sl-input" type="url" inputmode="url" t-model="f.payment_link" placeholder="https://" t-att-aria-invalid="errors.payment_link ? 'true' : 'false'"/>
                            <span t-if="errors.payment_link" class="pf-field-error" t-esc="errors.payment_link"/>
                            <span t-else="" class="sl-help">Facultatif. Page de paiement par carte ou Mobile Money de votre prestataire ; doit commencer par https://</span>
                        </div>
                    </div>
                </section>

                <section class="ad-panel">
                    <div class="ad-panel-head"><h2>Support et facturation</h2></div>
                    <div class="ad-form">
                        <div class="sl-field">
                            <label for="pf-s-mail">E-mail du support</label>
                            <input id="pf-s-mail" class="sl-input" type="email" t-model="f.support_email" placeholder="support@exemple.com" t-att-aria-invalid="errors.support_email ? 'true' : 'false'"/>
                            <span t-if="errors.support_email" class="pf-field-error" t-esc="errors.support_email"/>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-phone">Téléphone du support</label>
                            <input id="pf-s-phone" class="sl-input" type="tel" t-model="f.support_phone" placeholder="+243 …"/>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-issuer">Émetteur des factures</label>
                            <input id="pf-s-issuer" class="sl-input" t-model="f.issuer_name" placeholder="Raison sociale"/>
                            <span class="sl-help">Nom figurant en tête des factures d'abonnement.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-details">Coordonnées de l'émetteur</label>
                            <textarea id="pf-s-details" class="sl-textarea" rows="4" t-model="f.issuer_details" placeholder="Adresse&#10;RCCM, Id. Nat., N° impôt&#10;Téléphone, e-mail"/>
                        </div>
                    </div>
                </section>

                <div class="pf-savebar" t-att-class="{'is-dirty': dirty}">
                    <span class="sl-muted ad-small" aria-live="polite" t-esc="dirty ? 'Modifications non enregistrées' : 'Paramètres à jour'"/>
                    <button type="button" class="sl-btn" t-att-disabled="!dirty or state.saving" t-on-click="revert">Annuler les modifications</button>
                    <button type="submit" class="sl-btn sl-btn-primary" t-att-disabled="!dirty or state.saving or hasErrors">
                        <t t-if="state.saving"><span class="sl-spinner"/> Enregistrement…</t><t t-else="">Enregistrer</t>
                    </button>
                </div>
            </form>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ form: null, saved: null, saving: false, error: "" });
        onWillStart(async () => {
            try {
                this.setData(await papi("settings_get"));
            } catch (e) {
                this.state.error = errMessage(e);
            }
        });
    }
    setData(data) {
        this.state.saved = JSON.stringify(data);
        this.state.form = { ...data };
    }
    get dirty() {
        return JSON.stringify(this.state.form) !== this.state.saved;
    }
    get errors() {
        const f = this.state.form;
        const e = {};
        const int = (v) => v !== "" && Number.isInteger(Number(v));
        if (!int(f.trial_days) || f.trial_days < 1 || f.trial_days > 90) {
            e.trial_days = "Entre 1 et 90 jours.";
        }
        if (!int(f.grace_days) || f.grace_days < 0) {
            e.grace_days = "Nombre entier positif ou nul.";
        }
        if (!int(f.trial_max_candidates) || f.trial_max_candidates < 0) {
            e.trial_max_candidates = "Nombre entier positif ou nul.";
        }
        if (f.payment_link && !String(f.payment_link).trim().startsWith("https://")) {
            e.payment_link = "Le lien doit commencer par https://";
        }
        if (f.support_email && !EMAIL_RE.test(String(f.support_email).trim())) {
            e.support_email = "Adresse e-mail invalide.";
        }
        return e;
    }
    get hasErrors() {
        return Object.keys(this.errors).length > 0;
    }
    revert() {
        this.state.form = JSON.parse(this.state.saved);
    }
    async save() {
        if (this.hasErrors) {
            return;
        }
        const f = this.state.form;
        const vals = { ...f };
        for (const k of ["payment_link", "support_email", "support_phone", "issuer_name"]) {
            vals[k] = String(vals[k] || "").trim();
        }
        this.state.saving = true;
        try {
            this.setData(await papi("settings_save", [vals]));
            notify("Paramètres enregistrés.", "ok");
        } catch (e) {
            notify(errMessage(e), "danger", 7000);
        } finally {
            this.state.saving = false;
        }
    }
}
