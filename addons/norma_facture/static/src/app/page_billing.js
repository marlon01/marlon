/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";
import { BusyButton, Icon, notify, notifyError } from "@norma_facture/common/ui";
import { date, dateTime, money } from "@norma_facture/common/format";
import { session } from "@norma_facture/app/store";
import { PageHead } from "@norma_facture/app/components";

const STATES = { trial: ["Essai gratuit", "info"], active: ["Abonnement actif", "ok"], grace: ["Échéance dépassée", "warn"],
    expired: ["Consultation seule", "bad"] };
const PAY_STATES = { submitted: ["À valider", "warn"], validated: ["Validé", "ok"], refused: ["Refusé", "bad"] };

export class BillingPage extends Component {
    static template = xml`
        <div class="nm-page" t-if="state.b">
            <t t-set="b" t-value="state.b"/>
            <t t-set="sub" t-value="b.subscription"/>
            <PageHead title="'Abonnement'" subtitle="sub.plan ? 'Formule ' + sub.plan.name + ' · ' + session.category.name : ''"/>
            <div class="nm-billing">
                <section class="nm-panel nm-panel-body nm-sub" t-att-class="'is-' + sub.state">
                    <span class="nm-tag" t-att-class="'nm-tag-' + st[1]" t-esc="st[0]"/>
                    <t t-if="sub.state === 'trial'">
                        <h2><t t-esc="sub.days_left"/> jour(s) d'essai restant(s)</h2>
                        <p>Toutes les fonctions sont ouvertes jusqu'au <b t-esc="date(sub.trial_end)"/>. Payez maintenant : les jours d'essai restants s'ajoutent à votre abonnement.</p>
                    </t>
                    <t t-elif="sub.state === 'active'">
                        <h2>Payé jusqu'au <t t-esc="date(sub.period_end)"/></h2>
                        <p><t t-esc="sub.days_left"/> jour(s) restant(s). Un paiement anticipé prolonge la date d'échéance.</p>
                    </t>
                    <t t-elif="sub.state === 'grace'">
                        <h2>Renouvelez avant le <t t-esc="date(sub.grace_end)"/></h2>
                        <p>Après cette date, l'espace passe en consultation seule : plus de nouvelles factures, mais vos factures restent consultables, imprimables et exportables.</p>
                    </t>
                    <t t-else="">
                        <h2>Facturation suspendue</h2>
                        <p>Vos factures restent consultables et celles déjà émises continuent d'être normalisées. Renouvelez pour reprendre la facturation.</p>
                    </t>
                    <div t-if="sub.pending" class="nm-note" style="margin-top:12px">Un paiement attend la validation de l'équipe NORMA (en général dans la journée).</div>
                </section>
                <section class="nm-panel nm-panel-body nm-plan" t-if="sub.plan">
                    <h2><t t-esc="sub.plan.name"/></h2>
                    <div class="nm-plan-price"><b class="nm-num" t-esc="money(sub.plan.price_month)"/> $ <span>par mois</span></div>
                    <ul>
                        <li>Factures normalisées illimitées</li>
                        <li><t t-esc="sub.plan.sites_included"/> établissement(s) inclus, puis <t t-esc="money(sub.plan.extra_site_price)"/> $ par établissement et par mois</li>
                        <li>Utilisateurs illimités, mises à jour DGI incluses</li>
                        <li>Annuel : <t t-esc="money(sub.plan.price_year)"/> $ (deux mois offerts)</li>
                    </ul>
                    <p class="nm-muted" style="margin:0">Vous avez <t t-esc="b.sites"/> établissement(s) actif(s).</p>
                </section>
            </div>

            <section t-if="b.can_pay and Object.keys(b.quotes).length" class="nm-panel" style="margin-top:16px">
                <div class="nm-panel-head"><h2>Payer par Mobile Money</h2></div>
                <div class="nm-panel-body nm-pay-grid">
                    <div class="nm-stack">
                        <div class="nm-durations" role="radiogroup" aria-label="Durée">
                            <button t-foreach="[1, 3, 12]" t-as="m" t-key="m" class="nm-duration" t-att-class="{'is-on': state.months === m}" role="radio"
                                    t-att-aria-checked="state.months === m ? 'true' : 'false'" t-on-click="() => this.state.months = m">
                                <b t-esc="m === 12 ? '12 mois' : m + ' mois'"/>
                                <span class="nm-num"><t t-esc="money(b.quotes[m].total)"/> $</span>
                                <small t-if="m === 12">2 mois offerts</small>
                                <small t-elif="b.quotes[m].extra_sites"><t t-esc="b.quotes[m].extra_sites"/> établissement(s) en plus</small>
                            </button>
                        </div>
                        <div class="nm-note"><b>1.</b> Envoyez <b class="nm-num"><t t-esc="money(b.quotes[state.months].total)"/> $</b> (ou l'équivalent en CDF) : <t t-esc="b.instructions"/></div>
                        <div class="nm-grid-2">
                            <label class="nm-field"><span>Moyen de paiement</span>
                                <select class="nm-select" t-model="state.method"><option t-foreach="b.methods" t-as="m" t-key="m.code" t-att-value="m.code" t-esc="m.label"/></select></label>
                            <label class="nm-field"><span>Numéro qui a payé</span><input class="nm-input" t-model="state.phone" placeholder="+243 8…"/></label>
                            <label class="nm-field nm-span-2"><span>2. Référence de la transaction (reçue par SMS)</span><input class="nm-input nm-mono" t-model="state.reference" maxlength="60" style="text-transform:uppercase"/></label>
                            <label class="nm-field nm-span-2"><span>Capture du SMS ou reçu (facultatif)</span><input class="nm-input" type="file" accept="image/png,image/jpeg,application/pdf" t-on-change="onProof" style="padding-top:7px"/></label>
                        </div>
                        <BusyButton class="'nm-btn-gold nm-btn-lg'" disabled="state.reference.trim().length &lt; 4" onClick.bind="declare">3. Déclarer mon paiement</BusyButton>
                    </div>
                </div>
            </section>
            <div t-elif="!b.can_pay" class="nm-note" style="margin-top:16px">Seul un administrateur de l'entreprise peut renouveler l'abonnement.</div>

            <section class="nm-panel" style="margin-top:16px" t-if="b.payments.length">
                <div class="nm-panel-head"><h2>Historique des paiements</h2></div>
                <div class="nm-table-wrap"><table class="nm-table">
                    <thead><tr><th>Date</th><th>Reçu</th><th>Durée</th><th>Moyen</th><th>Référence</th><th>Période</th><th>État</th><th class="nm-right">Montant</th></tr></thead>
                    <tbody><tr t-foreach="b.payments" t-as="p" t-key="p.id">
                        <td t-esc="dateTime(p.date)"/><td class="nm-mono" t-esc="p.number or '—'"/><td><t t-esc="p.months"/> mois</td>
                        <td t-esc="p.method_label"/><td class="nm-mono" t-esc="p.reference"/>
                        <td><t t-if="p.period_end">jusqu'au <t t-esc="date(p.period_end)"/></t></td>
                        <td><span class="nm-tag" t-att-class="'nm-tag-' + pst(p)[1]" t-esc="pst(p)[0]"/><div t-if="p.refusal_reason" class="nm-muted" style="font-size:12px" t-esc="p.refusal_reason"/></td>
                        <td class="nm-right nm-num"><t t-esc="money(p.amount)"/> $</td>
                    </tr></tbody>
                </table></div>
            </section>
        </div>`;
    static components = { PageHead, BusyButton, Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.date = date;
        this.dateTime = dateTime;
        this.session = session;
        this.state = useState({ b: null, months: 1, method: "MPESA", phone: "", reference: "", proof: null });
        onWillStart(() => this.load());
    }
    get st() { return STATES[this.state.b.subscription.state] || STATES.expired; }
    pst(p) { return PAY_STATES[p.state] || ["", ""]; }
    async load() {
        try {
            this.state.b = await api("billing");
            session.subscription = this.state.b.subscription;
        } catch (err) { notifyError(err); }
    }
    onProof(ev) {
        const f = ev.target.files[0];
        if (!f) return;
        if (f.size > 3 * 1024 * 1024) { notify("Justificatif trop lourd (3 Mo maximum).", "bad"); return; }
        const r = new FileReader();
        r.onload = () => (this.state.proof = r.result);
        r.readAsDataURL(f);
    }
    async declare() {
        this.state.b = await api("billing_declare", { months: this.state.months, method: this.state.method, reference: this.state.reference,
            payer_phone: this.state.phone, proof: this.state.proof || undefined });
        session.subscription = this.state.b.subscription;
        Object.assign(this.state, { reference: "", proof: null });
        notify("Paiement déclaré. L'équipe NORMA le valide et votre abonnement est prolongé.", "ok");
    }
}
