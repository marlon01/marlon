/** @odoo-module */
/* Page « Abonnement » de la console d'une structure : catégorie, consommation, offres, paiement, factures. */
import { Component, onWillStart, useRef, useState, xml } from "@odoo/owl";
import { extensions, store } from "@selecta_concours/admin/store";
import { api } from "@selecta_concours/common/rpc";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { fmtDateTime, fmtNum, readFileAsDataURL } from "@selecta_concours/common/utils";
import { SubscriptionBanner } from "@selecta_saas/tenant/banner";
import {
    CYCLE_LABELS, FEATURE_LABELS, INVOICE_BADGE, TENANT_BADGE, daysLabel, fmtDate, fmtMoney, saasBus,
} from "@selecta_saas/tenant/common";
import { printInvoice } from "@selecta_saas/tenant/invoice_print";

const PROOF_MAX = 5 * 1024 * 1024;
const PROOF_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export class SubscriptionPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page ss-page">
            <header class="ad-head">
                <div>
                    <h1>Abonnement</h1>
                    <p class="sl-muted">Catégorie, consommation, paiements et factures de votre structure.</p>
                </div>
                <div t-if="state.info" class="ad-head-actions">
                    <button class="sl-btn sl-btn-ghost sl-btn-sm" t-on-click="() => this.load()" t-att-disabled="state.loading"><Icon name="'refresh'" size="16"/>Actualiser</button>
                </div>
            </header>

            <div t-if="state.loading and !state.info" class="ad-loading"><span class="sl-spinner"/> Chargement de l'abonnement…</div>
            <div t-elif="state.error" class="ad-panel ss-error" role="alert">
                <Icon name="'alert'" size="22"/>
                <div class="sl-grow"><strong>Impossible d'afficher l'abonnement.</strong><div t-esc="state.error"/></div>
                <button class="sl-btn" t-on-click="() => this.load()">Réessayer</button>
            </div>
            <t t-elif="state.info">
                <t t-set="t" t-value="state.info.tenant"/>
                <!-- Situation -->
                <section class="ss-status" aria-labelledby="ss-status-title">
                    <div class="ss-status-main">
                        <div class="ss-eyebrow">Catégorie actuelle</div>
                        <h2 id="ss-status-title" class="ss-plan-name" t-esc="t.plan.name"/>
                        <div class="ss-status-line">
                            <span t-attf-class="sl-badge {{tenantBadge(t.state)}}" t-esc="t.state_label"/>
                            <span class="sl-muted" t-if="t.state != 'trial'">Facturation <t t-esc="cycleLabel(t.billing_cycle).toLowerCase()"/></span>
                            <span class="sl-muted" t-if="t.plan.audience" t-esc="t.plan.audience"/>
                        </div>
                    </div>
                    <dl class="ss-dates">
                        <div t-if="t.trial_end"><dt>Fin de l'essai</dt><dd t-esc="date(t.trial_end)"/></div>
                        <div t-if="t.period_end"><dt>Payé jusqu'au</dt><dd t-esc="date(t.period_end)"/></div>
                        <div t-if="t.state == 'past_due'"><dt>Fin du délai de grâce</dt><dd class="ad-danger-text" t-esc="date(t.grace_end)"/></div>
                    </dl>
                    <div t-attf-class="ss-days is-{{daysTone}}">
                        <t t-if="['trial', 'active', 'past_due'].includes(t.state)">
                            <span class="sl-figures" t-esc="t.days_left"/>
                            <small t-esc="t.days_left == 1 ? 'jour restant' : 'jours restants'"/>
                        </t>
                        <t t-else="">
                            <span class="ss-days-icon"><Icon name="'lock'" size="26"/></span>
                            <small t-esc="t.state == 'suspended' ? 'Accès bloqué' : 'Consultation seule'"/>
                        </t>
                    </div>
                </section>

                <div t-if="t.state == 'expired'" class="sl-alert sl-alert-danger ad-mb">
                    <strong>La console est en consultation seule.</strong> Vos concours, candidats et résultats restent consultables
                    et exportables. Choisissez une catégorie ci-dessous et réglez la facture pour reprendre la création de concours
                    et l'inscription de candidats.
                </div>
                <div t-elif="t.state == 'suspended'" class="sl-alert sl-alert-danger ad-mb">
                    <strong>Compte suspendu.</strong> Contactez le support SELECTA pour rétablir l'accès<t t-if="supportLine"> : <t t-esc="supportLine"/></t>.
                </div>
                <div t-elif="t.state == 'past_due'" class="sl-alert sl-alert-warn ad-mb">
                    <strong>Échéance dépassée.</strong> Réglez votre abonnement avant le <t t-esc="date(t.grace_end)"/> : passé ce délai,
                    la console passera en consultation seule.
                </div>

                <!-- Paiement en attente -->
                <section t-if="current" class="ad-panel ss-pay" t-att-class="'is-' + current.state" id="ss-payment" aria-labelledby="ss-pay-title">
                    <div class="ad-panel-head">
                        <h2 id="ss-pay-title" t-esc="current.state == 'pending' ? 'Paiement en cours de validation' : 'Facture à régler'"/>
                        <span t-attf-class="sl-badge {{invoiceBadge(current.state)}}" t-esc="current.state_label"/>
                    </div>
                    <div class="ss-pay-summary">
                        <div><div class="ss-eyebrow">Montant</div><div class="ss-amount sl-figures" t-esc="money(current.amount, current.symbol)"/></div>
                        <div><div class="ss-eyebrow">Facture</div><div class="sl-mono" t-esc="current.name"/></div>
                        <div><div class="ss-eyebrow">Objet</div><div>Catégorie « <t t-esc="current.plan"/> », <t t-esc="cycleLabel(current.billing_cycle).toLowerCase()"/></div></div>
                        <div class="ss-pay-print"><button class="sl-btn sl-btn-sm" t-on-click="() => this.print(current)"><Icon name="'print'" size="16"/>Facture</button></div>
                    </div>

                    <t t-if="current.state == 'pending'">
                        <div class="ss-pending">
                            <span class="ss-pending-icon"><Icon name="'clock'" size="22"/></span>
                            <div class="sl-grow">
                                <p>Votre déclaration du <strong t-esc="dt(current.declared_date)"/> est en cours de vérification par l'équipe SELECTA.
                                L'abonnement sera activé dès la validation ; aucune action n'est requise de votre part.</p>
                                <dl class="ss-facts">
                                    <div><dt>Moyen</dt><dd t-esc="current.payment_method_label or '—'"/></div>
                                    <div><dt>Référence</dt><dd class="sl-mono" t-esc="current.payment_reference or '—'"/></div>
                                    <div t-if="current.payer_phone"><dt>Téléphone payeur</dt><dd t-esc="current.payer_phone"/></div>
                                    <div><dt>Justificatif</dt><dd t-esc="current.has_proof ? (current.proof_filename or 'Joint') : 'Aucun'"/></div>
                                </dl>
                            </div>
                        </div>
                        <div class="ss-pay-foot">
                            <span class="sl-muted ad-small">Erreur dans la déclaration ? Annulez la facture puis choisissez à nouveau votre catégorie.</span>
                            <button class="sl-btn sl-btn-sm" t-att-disabled="state.busy" t-on-click="cancelInvoice">Annuler la déclaration</button>
                        </div>
                    </t>
                    <t t-else="">
                        <div t-if="current.state == 'rejected'" class="sl-alert sl-alert-danger ad-mb" role="alert">
                            <strong>Paiement refusé par l'équipe SELECTA.</strong>
                            <t t-if="current.reject_reason"> Motif : « <t t-esc="current.reject_reason"/> ».</t>
                            Vérifiez la référence ou le montant, puis déclarez à nouveau votre paiement.
                        </div>
                        <ol class="ss-steps">
                            <li>
                                <h3><span>1</span>Réglez <t t-esc="money(current.amount, current.symbol)"/></h3>
                                <div t-if="state.info.payment_instructions" class="ss-instructions" t-esc="state.info.payment_instructions"/>
                                <p t-else="" class="sl-muted">Les modalités de paiement vous seront communiquées par le support SELECTA.</p>
                                <p class="ad-small sl-muted">Indiquez le numéro <strong class="sl-mono" t-esc="current.name"/> en motif de paiement.</p>
                                <a t-if="state.info.payment_link" class="sl-btn sl-btn-primary" t-att-href="state.info.payment_link" target="_blank" rel="noopener noreferrer">
                                    Payer en ligne<Icon name="'external'" size="16"/>
                                </a>
                            </li>
                            <li>
                                <h3><span>2</span>Déclarez votre paiement</h3>
                                <form class="ss-declare" t-on-submit.prevent="declare" novalidate="">
                                    <div class="sl-field">
                                        <label for="ss-method">Moyen de paiement</label>
                                        <select id="ss-method" class="sl-select" t-model="form.method">
                                            <option t-foreach="state.info.methods" t-as="m" t-key="m.key" t-att-value="m.key" t-esc="m.label"/>
                                        </select>
                                    </div>
                                    <div class="sl-field">
                                        <label for="ss-ref">Référence de la transaction <span class="ss-req" aria-hidden="true">*</span></label>
                                        <input id="ss-ref" class="sl-input" t-model="form.reference" required="" maxlength="120" autocomplete="off"
                                               placeholder="Ex. : MP241022.1530.A12345" t-att-aria-invalid="form.errors.reference ? 'true' : 'false'"
                                               aria-describedby="ss-ref-help"/>
                                        <span id="ss-ref-help" t-attf-class="sl-help {{form.errors.reference ? 'ad-danger-text' : ''}}"
                                              t-esc="form.errors.reference or 'Fournie par SMS par votre opérateur, ou sur l’avis de virement.'"/>
                                    </div>
                                    <div class="sl-field">
                                        <label for="ss-phone">Téléphone du payeur <span class="sl-muted">(facultatif)</span></label>
                                        <input id="ss-phone" class="sl-input" type="tel" t-model="form.phone" maxlength="40" autocomplete="tel" placeholder="+243 …"/>
                                    </div>
                                    <div class="sl-field">
                                        <label for="ss-proof">Justificatif <span class="sl-muted">(facultatif)</span></label>
                                        <div class="ss-file">
                                            <input id="ss-proof" type="file" class="ss-file-input" accept="application/pdf,image/png,image/jpeg,image/webp"
                                                   t-ref="proof" t-on-change="onProof" aria-describedby="ss-proof-help"/>
                                            <label for="ss-proof" class="sl-btn sl-btn-sm"><Icon name="'upload'" size="16"/>Choisir un fichier</label>
                                            <span class="ss-file-name" t-if="form.proofName"><t t-esc="form.proofName"/>
                                                <button type="button" class="sl-btn sl-btn-ghost sl-btn-icon" aria-label="Retirer le justificatif" t-on-click="clearProof"><Icon name="'x'" size="14"/></button>
                                            </span>
                                        </div>
                                        <span id="ss-proof-help" t-attf-class="sl-help {{form.errors.proof ? 'ad-danger-text' : ''}}"
                                              t-esc="form.errors.proof or 'Capture du SMS ou reçu : PDF, PNG, JPEG ou WebP, 5 Mo maximum.'"/>
                                    </div>
                                    <div class="ss-declare-foot">
                                        <button type="submit" class="sl-btn sl-btn-primary" t-att-disabled="state.busy">
                                            <span t-if="state.busy" class="sl-spinner"/><Icon t-else="" name="'check'" size="16"/>Déclarer mon paiement
                                        </button>
                                        <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" t-att-disabled="state.busy" t-on-click="cancelInvoice">Annuler la facture</button>
                                    </div>
                                </form>
                            </li>
                        </ol>
                    </t>
                </section>

                <!-- Consommation -->
                <section class="ad-panel" aria-labelledby="ss-usage-title">
                    <div class="ad-panel-head">
                        <h2 id="ss-usage-title">Consommation</h2>
                        <span class="sl-muted ad-small">Mois en cours, depuis le <t t-esc="monthStart"/></span>
                    </div>
                    <div class="ss-meters">
                        <div t-foreach="meters" t-as="m" t-key="m.key" t-attf-class="ss-meter is-{{m.tone}}">
                            <div class="ss-meter-head">
                                <span class="ss-meter-label" t-att-id="'ss-m-' + m.key" t-esc="m.label"/>
                                <span class="ss-meter-value">
                                    <strong class="sl-figures" t-esc="num(m.used)"/>
                                    <span class="sl-muted"> / <t t-esc="m.limit ? num(m.limit) : 'Illimité'"/></span>
                                </span>
                            </div>
                            <div class="ss-meter-track" role="meter" t-att-aria-labelledby="'ss-m-' + m.key"
                                 aria-valuemin="0" t-att-aria-valuemax="m.limit or m.used" t-att-aria-valuenow="m.used"
                                 t-att-aria-valuetext="m.limit ? (num(m.used) + ' sur ' + num(m.limit)) : (num(m.used) + ', illimité')">
                                <div t-att-style="'width:' + m.pct + '%'"/>
                            </div>
                            <div class="ss-meter-note" t-esc="m.note"/>
                        </div>
                    </div>
                </section>

                <!-- Offres -->
                <section class="ss-plans-section" aria-labelledby="ss-plans-title">
                    <div class="ss-plans-head">
                        <div>
                            <h2 id="ss-plans-title">Catégories et tarifs</h2>
                            <p class="sl-muted">Le changement de catégorie prend effet à la validation du paiement ; la période déjà payée et les jours d'essai restants sont conservés.</p>
                        </div>
                        <div class="ss-cycle" role="radiogroup" aria-label="Cycle de facturation">
                            <button type="button" role="radio" t-att-aria-checked="state.cycle == 'monthly' ? 'true' : 'false'"
                                    t-att-class="{'is-active': state.cycle == 'monthly'}" t-on-click="() => this.state.cycle = 'monthly'">Mensuel</button>
                            <button type="button" role="radio" t-att-aria-checked="state.cycle == 'yearly' ? 'true' : 'false'"
                                    t-att-class="{'is-active': state.cycle == 'yearly'}" t-on-click="() => this.state.cycle = 'yearly'">
                                Annuel<small t-if="freeMonths"> · <t t-esc="freeMonths"/> mois offerts</small>
                            </button>
                        </div>
                    </div>
                    <div t-if="current and current.state == 'pending'" class="sl-alert sl-alert-info ad-mb">Un paiement est en cours de validation : vous pourrez changer de catégorie après son traitement.</div>
                    <div class="ss-plans">
                        <article t-foreach="state.info.plans" t-as="p" t-key="p.id" class="ss-plan"
                                 t-att-class="{'is-current': p.id == t.plan.id, 'is-highlight': p.highlight}" t-att-aria-label="'Catégorie ' + p.name">
                            <div class="ss-plan-tags">
                                <span t-if="p.id == t.plan.id" class="ss-tag is-current">Catégorie actuelle</span>
                                <span t-elif="p.highlight" class="ss-tag">Recommandée</span>
                            </div>
                            <h3 t-esc="p.name"/>
                            <p class="ss-plan-audience" t-esc="p.audience"/>
                            <div class="ss-price">
                                <span class="sl-figures" t-esc="money(price(p), p.symbol)"/>
                                <small t-esc="state.cycle == 'yearly' ? '/ an' : '/ mois'"/>
                            </div>
                            <div class="ss-price-note" t-esc="priceNote(p)"/>
                            <ul class="ss-features">
                                <li><Icon name="'trophy'" size="15"/><t t-esc="limitLabel(p.max_active_concours, 'concours actif simultané', 'concours actifs simultanés', 'Concours actifs illimités')"/></li>
                                <li><Icon name="'users'" size="15"/><t t-esc="limitLabel(p.max_candidates_month, 'candidat par mois', 'candidats par mois', 'Candidats illimités')"/></li>
                                <li><Icon name="'user'" size="15"/><t t-esc="limitLabel(p.max_staff, 'compte du personnel', 'comptes du personnel', 'Comptes du personnel illimités')"/></li>
                                <li t-foreach="featureKeys" t-as="f" t-key="f" t-att-class="{'is-off': !p.features[f]}">
                                    <Icon name="p.features[f] ? 'check' : 'x'" size="15"/>
                                    <span t-esc="featureLabels[f]"/><span t-if="!p.features[f]" class="sl-sr"> (non incluse)</span>
                                </li>
                                <li t-if="p.support"><Icon name="'phone'" size="15"/>Support : <t t-esc="p.support"/></li>
                            </ul>
                            <button class="sl-btn ss-plan-btn" t-att-class="(p.id == t.plan.id or p.highlight) ? 'sl-btn-primary' : ''"
                                    t-att-disabled="!canChoose" t-att-title="chooseHint" t-on-click="() => this.choose(p)"
                                    t-esc="chooseLabel(p)"/>
                        </article>
                    </div>
                </section>

                <!-- Factures -->
                <section class="ad-panel ad-panel-flush ss-invoices" aria-labelledby="ss-inv-title">
                    <div class="ad-panel-head ss-inv-head"><h2 id="ss-inv-title">Historique des factures</h2></div>
                    <div t-if="!state.info.invoices.length" class="ad-empty">
                        <Icon name="'receipt'" size="26"/>
                        <strong>Aucune facture pour l'instant.</strong>
                        <span>Votre première facture sera émise lorsque vous choisirez une catégorie.</span>
                    </div>
                    <div t-else="" class="ss-table-wrap">
                        <table class="ad-table">
                            <thead><tr><th scope="col">Numéro</th><th scope="col">Date</th><th scope="col">Catégorie</th><th scope="col">Cycle</th><th scope="col" class="num">Montant</th><th scope="col">Statut</th><th scope="col">Période</th><th scope="col"><span class="sl-sr">Actions</span></th></tr></thead>
                            <tbody>
                                <tr t-foreach="state.info.invoices" t-as="inv" t-key="inv.id" t-att-class="{'is-muted': inv.state == 'cancelled'}">
                                    <td class="sl-mono" t-esc="inv.name"/>
                                    <td t-esc="date(inv.date, 'medium')"/>
                                    <td t-esc="inv.plan"/>
                                    <td t-esc="cycleLabel(inv.billing_cycle)"/>
                                    <td class="num sl-figures" t-esc="money(inv.amount, inv.symbol)"/>
                                    <td><span t-attf-class="sl-badge {{invoiceBadge(inv.state)}}" t-esc="inv.state_label"/></td>
                                    <td class="ad-small" t-esc="periodLabel(inv)"/>
                                    <td class="num"><button class="sl-btn sl-btn-ghost sl-btn-sm" t-on-click="() => this.print(inv)" t-att-aria-label="'Imprimer la facture ' + inv.name"><Icon name="'print'" size="16"/>Facture</button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <footer class="ss-support">
                    <div><strong>Une question sur votre abonnement ?</strong> L'équipe SELECTA vous répond.</div>
                    <div class="ss-support-links">
                        <a t-if="state.info.support_email" t-att-href="'mailto:' + state.info.support_email"><Icon name="'mail'" size="16"/><t t-esc="state.info.support_email"/></a>
                        <span t-if="state.info.support_phone"><Icon name="'phone'" size="16"/><t t-esc="state.info.support_phone"/></span>
                    </div>
                </footer>
            </t>
        </div>`;
    static props = { route: { type: Object, optional: true } };

    setup() {
        this.proofRef = useRef("proof");
        this.featureKeys = Object.keys(FEATURE_LABELS);
        this.featureLabels = FEATURE_LABELS;
        this.state = useState({ info: null, loading: true, error: "", busy: false, cycle: "monthly" });
        this.form = useState(this.emptyForm());
        onWillStart(() => this.load(true));
    }

    emptyForm(method = "") {
        return { method, reference: "", phone: "", proofData: null, proofName: "", errors: {} };
    }

    async load(initial = false) {
        this.state.loading = true;
        this.state.error = "";
        try {
            this.apply(await api("billing_info"));
            if (initial) {
                this.state.cycle = this.state.info.tenant.billing_cycle === "yearly" ? "yearly" : "monthly";
            }
        } catch (e) {
            this.state.error = e.message || "Erreur inattendue.";
        } finally {
            this.state.loading = false;
        }
    }

    apply(info) {
        this.state.info = info;
        saasBus.summary = info.tenant;
        saasBus.support = { email: info.support_email, phone: info.support_phone };
        if (store.session) {
            store.session.saas = info.tenant;
        }
        if (!this.form.method || !info.methods.some((m) => m.key === this.form.method)) {
            this.form.method = info.methods[0]?.key || "";
        }
    }

    // ------------------------------------------------------------------ dérivés
    get current() {
        const invoices = this.state.info?.invoices || [];
        return invoices.find((i) => i.state === "pending") || invoices.find((i) => ["open", "rejected"].includes(i.state)) || null;
    }
    get canChoose() {
        const t = this.state.info.tenant;
        return !this.state.busy && t.access !== "blocked" && !(this.current && this.current.state === "pending");
    }
    get chooseHint() {
        if (this.state.info.tenant.access === "blocked") {
            return "Compte suspendu : contactez le support SELECTA.";
        }
        if (this.current && this.current.state === "pending") {
            return "Un paiement est en cours de validation.";
        }
        return "";
    }
    get supportLine() {
        const i = this.state.info;
        return [i.support_email, i.support_phone].filter(Boolean).join(" · ");
    }
    get daysTone() {
        const t = this.state.info.tenant;
        if (["expired", "suspended"].includes(t.state)) {
            return "danger";
        }
        if (t.state === "past_due" || t.days_left <= 3) {
            return "warn";
        }
        return "ok";
    }
    get monthStart() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    }
    get freeMonths() {
        const months = (this.state.info.plans || [])
            .filter((p) => p.price_monthly > 0)
            .map((p) => Math.round(p.yearly_saving / p.price_monthly));
        const best = Math.max(0, ...months);
        return best >= 1 && months.every((m) => m === best) ? best : 0;
    }
    get meters() {
        const { usage, limits } = this.state.info;
        const make = (key, label, used, limit, unit) => {
            const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
            const ratio = limit ? used / limit : 0;
            const tone = !limit ? "unlimited" : ratio >= 1 ? "danger" : ratio >= 0.8 ? "warn" : "ok";
            let note;
            if (!limit) {
                note = "Aucune limite dans votre catégorie.";
            } else if (ratio >= 1) {
                note = `Limite atteinte : passez à une catégorie supérieure pour ${unit}.`;
            } else {
                note = `${fmtNum(limit - used, 0)} disponible(s) — ${Math.round(ratio * 100)} % utilisés.`;
            }
            return { key, label, used, limit, pct: limit ? pct : 100, tone, note };
        };
        const list = [
            make("concours", "Concours actifs", usage.active_concours, limits.active_concours, "ouvrir d'autres concours"),
            make("candidates", "Candidats inscrits ce mois", usage.candidates_month, limits.candidates_month, "inscrire davantage de candidats"),
            make("staff", "Comptes du personnel", usage.staff, limits.staff, "créer d'autres comptes"),
        ];
        if (limits.trial_candidates) {
            list.splice(2, 0, make("trial", "Candidats pendant l'essai", usage.candidates_total, limits.trial_candidates, "inscrire davantage de candidats (abonnement requis)"));
        }
        return list;
    }

    // ------------------------------------------------------------------ présentation
    tenantBadge(state) {
        return TENANT_BADGE[state] || "";
    }
    invoiceBadge(state) {
        return INVOICE_BADGE[state] || "";
    }
    cycleLabel(c) {
        return CYCLE_LABELS[c] || c || "";
    }
    money(v, s) {
        return fmtMoney(v, s);
    }
    num(v) {
        return fmtNum(v, 0);
    }
    date(v, style = "long") {
        return fmtDate(v, style);
    }
    dt(v) {
        return fmtDateTime(v);
    }
    days(n) {
        return daysLabel(n);
    }
    price(p) {
        return this.state.cycle === "yearly" ? p.price_yearly : p.price_monthly;
    }
    priceNote(p) {
        if (this.state.cycle === "yearly") {
            const perMonth = fmtMoney(Math.round((p.price_yearly / 12) * 100) / 100, p.symbol);
            return p.yearly_saving > 0 ? `soit ${perMonth} / mois · économie de ${fmtMoney(p.yearly_saving, p.symbol)}` : `soit ${perMonth} / mois`;
        }
        return p.yearly_saving > 0
            ? `ou ${fmtMoney(p.price_yearly, p.symbol)} / an (économie de ${fmtMoney(p.yearly_saving, p.symbol)})`
            : `ou ${fmtMoney(p.price_yearly, p.symbol)} / an`;
    }
    limitLabel(n, one, many, unlimited) {
        if (!n) {
            return unlimited;
        }
        return `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
    }
    chooseLabel(p) {
        const t = this.state.info.tenant;
        if (p.id === t.plan.id) {
            return t.state === "trial" ? "Souscrire à cette catégorie" : "Renouveler";
        }
        return "Choisir";
    }
    periodLabel(inv) {
        if (inv.period_start && inv.period_end) {
            return `${fmtDate(inv.period_start, "medium")} → ${fmtDate(inv.period_end, "medium")}`;
        }
        return "—";
    }

    // ------------------------------------------------------------------ actions
    async choose(p) {
        const cycle = this.state.cycle;
        const amount = fmtMoney(this.price(p), p.symbol);
        const replaces = this.current && ["open", "rejected"].includes(this.current.state)
            ? `\n\nLa facture ${this.current.name} en attente sera remplacée.`
            : "";
        const ok = await confirmDialog({
            title: `Souscrire à « ${p.name} »`,
            body: `Cycle : ${CYCLE_LABELS[cycle].toLowerCase()}\nMontant : ${amount}${cycle === "yearly" ? " pour 12 mois" : " pour 1 mois"}\n\n`
                + `Une facture va être émise. Réglez-la selon les modalités indiquées, puis déclarez votre paiement : `
                + `l'abonnement est activé dès sa validation.${replaces}`,
            confirmLabel: `Émettre la facture (${amount})`,
        });
        if (!ok) {
            return;
        }
        this.state.busy = true;
        try {
            const inv = await api("billing_checkout", [p.id, cycle]);
            await this.load();
            notify(`Facture ${inv.name} émise : ${fmtMoney(inv.amount, inv.symbol)}.`, "ok");
            this.scrollToPayment();
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.busy = false;
        }
    }

    scrollToPayment() {
        requestAnimationFrame(() => {
            const el = document.getElementById("ss-payment");
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                el.querySelector("#ss-ref")?.focus({ preventScroll: true });
            }
        });
    }

    async onProof(ev) {
        const file = ev.target.files && ev.target.files[0];
        this.form.errors.proof = "";
        if (!file) {
            return;
        }
        if (!PROOF_TYPES.includes(file.type)) {
            this.form.errors.proof = "Format non accepté : choisissez un PDF, PNG, JPEG ou WebP.";
            ev.target.value = "";
            return;
        }
        if (file.size > PROOF_MAX) {
            this.form.errors.proof = `Fichier trop volumineux (${fmtNum(file.size / 1048576, 1)} Mo) : 5 Mo maximum.`;
            ev.target.value = "";
            return;
        }
        try {
            this.form.proofData = await readFileAsDataURL(file);
            this.form.proofName = file.name;
        } catch {
            this.form.errors.proof = "Lecture du fichier impossible.";
        }
    }

    clearProof() {
        this.form.proofData = null;
        this.form.proofName = "";
        if (this.proofRef.el) {
            this.proofRef.el.value = "";
        }
    }

    async declare() {
        const f = this.form;
        f.errors = {};
        if (!f.reference.trim()) {
            f.errors.reference = "Indiquez la référence de la transaction.";
            document.getElementById("ss-ref")?.focus();
            return;
        }
        const inv = this.current;
        this.state.busy = true;
        try {
            const info = await api("billing_declare", [inv.id, f.method, f.reference.trim(), f.phone.trim(), f.proofData || false, f.proofName || ""]);
            Object.assign(this.form, this.emptyForm(f.method));
            this.apply(info);
            notify("Paiement déclaré : l'équipe SELECTA va le vérifier.", "ok");
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.busy = false;
        }
    }

    async cancelInvoice() {
        const inv = this.current;
        const pending = inv.state === "pending";
        const ok = await confirmDialog({
            title: pending ? "Annuler la déclaration ?" : "Annuler la facture ?",
            body: pending
                ? `La déclaration et la facture ${inv.name} seront annulées. Si vous avez déjà payé, ne l'annulez pas : l'équipe SELECTA est en train de vérifier votre paiement.`
                : `La facture ${inv.name} sera annulée. Vous pourrez choisir une autre catégorie ou un autre cycle.`,
            confirmLabel: pending ? "Annuler la déclaration" : "Annuler la facture",
            cancelLabel: "Conserver",
            danger: true,
        });
        if (!ok) {
            return;
        }
        this.state.busy = true;
        try {
            this.apply(await api("billing_cancel", [inv.id]));
            notify(`Facture ${inv.name} annulée.`, "ok");
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.busy = false;
        }
    }

    print(inv) {
        printInvoice(inv, this.state.info);
    }
}

// ------------------------------------------------------------------ enregistrement dans la console
extensions.nav.push(
    { key: "subscription", label: "Abonnement", icon: "receipt", roles: ["admin"], sequence: 85, visible: (s) => !!s.saas },
    { key: "platform", label: "Administration centrale", icon: "building", href: "/selecta/platform", roles: ["admin"], sequence: 95, visible: (s) => !!s.is_platform }
);
extensions.pages.subscription = SubscriptionPage;
extensions.banners.push(SubscriptionBanner);
