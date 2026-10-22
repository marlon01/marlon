/** @odoo-module */
/* Confirmation d'un choix de catégorie : détail du montant (prix, avoir, à régler) et date d'effet. */
import { Component, onMounted, onWillUnmount, useRef, xml } from "@odoo/owl";
import { Icon } from "@selecta_concours/common/ui";
import { CYCLE_LABELS, fmtDate, fmtMoney } from "@selecta_saas/tenant/common";

export class CheckoutDialog extends Component {
    static components = { Icon };
    static template = xml`
        <div class="sl-overlay" t-on-click.self="() => props.onClose()">
            <div class="sl-dialog ss-quote" role="dialog" aria-modal="true" aria-labelledby="ss-quote-title" aria-describedby="ss-quote-note">
                <div class="sl-dialog-head">
                    <div class="ss-eyebrow" t-esc="eyebrow"/>
                    <h3 id="ss-quote-title" t-esc="title"/>
                </div>
                <div class="sl-dialog-body">
                    <table class="ss-quote-lines">
                        <caption class="sl-sr">Détail du montant</caption>
                        <tbody>
                            <tr>
                                <th scope="row">Prix de la période<small>Catégorie « <t t-esc="props.plan.name"/> », <t t-esc="periodLabel"/></small></th>
                                <td class="sl-figures" t-esc="money(q.gross)"/>
                            </tr>
                            <tr t-if="q.credit > 0" class="is-credit">
                                <th scope="row">Avoir sur votre abonnement en cours<small>Part non consommée de « <t t-esc="props.tenant.plan.name"/> »<t t-if="q.period_end"> jusqu'au <t t-esc="date(q.period_end)"/></t></small></th>
                                <td class="sl-figures">−&#160;<t t-esc="money(q.credit)"/></td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr>
                                <th scope="row" t-esc="covered ? 'Montant à régler' : 'À régler'"/>
                                <td class="sl-figures" t-esc="money(q.amount)"/>
                            </tr>
                        </tfoot>
                    </table>

                    <div t-if="blocked" id="ss-quote-note" class="sl-alert sl-alert-warn ss-quote-alert" role="alert">
                        <p>La part non consommée de votre abonnement (<t t-esc="money(q.credit)"/>) couvre déjà un mois entier de cette catégorie.
                        Choisissez le cycle annuel pour en bénéficier pleinement.</p>
                        <button type="button" class="sl-btn sl-btn-sm" t-att-disabled="props.busy" t-on-click="() => props.onSwitchCycle('yearly')">Voir le tarif annuel</button>
                    </div>
                    <div t-else="" id="ss-quote-note" class="ss-quote-note">
                        <span class="ss-quote-icon"><Icon name="noteIcon" size="18"/></span>
                        <div>
                            <p t-if="q.deferred">
                                La catégorie « <t t-esc="props.plan.name"/> » s'appliquera à l'échéance du <strong t-esc="date(q.period_end)"/> ;
                                jusque-là vous conservez votre catégorie actuelle (« <t t-esc="props.tenant.plan.name"/> »). La période réglée s'ajoute à la suite.
                            </p>
                            <p t-elif="covered">
                                Le montant est entièrement couvert par votre avoir : la catégorie « <t t-esc="props.plan.name"/> » est activée immédiatement,
                                sans paiement, pour une nouvelle période <t t-esc="cyclePhrase"/>.
                            </p>
                            <p t-elif="q.prorated">
                                Nouvelle période <t t-esc="cyclePhrase"/> à compter du paiement : la catégorie « <t t-esc="props.plan.name"/> » s'applique
                                dès sa confirmation et remplace l'échéance actuelle<t t-if="q.period_end"> du <t t-esc="date(q.period_end)"/></t>.
                            </p>
                            <p t-else="">
                                Une facture va être émise. Réglez-la en ligne ou selon les modalités indiquées : l'abonnement est activé dès la
                                confirmation du paiement. La période déjà payée et les jours d'essai restants sont conservés.
                            </p>
                            <p t-if="props.replaces" class="sl-muted">La facture <span class="sl-mono" t-esc="props.replaces"/> en attente sera remplacée.</p>
                        </div>
                    </div>
                </div>
                <div class="sl-dialog-foot">
                    <button type="button" class="sl-btn" t-on-click="() => props.onClose()">Annuler</button>
                    <button type="button" class="sl-btn sl-btn-primary" t-ref="confirm" t-att-disabled="blocked or props.busy" t-on-click="() => props.onConfirm()">
                        <span t-if="props.busy" class="sl-spinner"/><t t-esc="confirmLabel"/>
                    </button>
                </div>
            </div>
        </div>`;
    static props = {
        plan: Object, cycle: String, quote: Object, tenant: Object, replaces: { type: String, optional: true },
        busy: { type: Boolean, optional: true }, onConfirm: Function, onClose: Function, onSwitchCycle: Function,
    };

    setup() {
        this.confirmRef = useRef("confirm");
        this.onKey = (ev) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                this.props.onClose();
            }
        };
        onMounted(() => {
            document.addEventListener("keydown", this.onKey);
            const el = this.confirmRef.el;
            if (el && !el.disabled) {
                el.focus();
            } else {
                document.querySelector(".ss-quote .sl-dialog-foot .sl-btn")?.focus();
            }
        });
        onWillUnmount(() => document.removeEventListener("keydown", this.onKey));
    }

    get q() {
        return this.props.quote;
    }
    get yearly() {
        return this.props.cycle === "yearly";
    }
    get periodLabel() {
        return this.yearly ? "12 mois" : "1 mois";
    }
    get cyclePhrase() {
        return this.yearly ? "de 12 mois" : "d'un mois";
    }
    /** Mensuel entièrement couvert par l'avoir : refusé par le serveur, on oriente vers l'annuel. */
    get blocked() {
        return this.q.prorated && this.q.credit >= this.q.gross && !this.yearly;
    }
    get covered() {
        return this.q.amount <= 0 && !this.blocked;
    }
    get eyebrow() {
        if (this.q.deferred) {
            return "Catégorie inférieure";
        }
        if (this.q.prorated) {
            return "Catégorie supérieure";
        }
        return `Facturation ${CYCLE_LABELS[this.props.cycle].toLowerCase()}`;
    }
    get title() {
        const t = this.props.tenant;
        if (this.props.plan.id === t.plan.id) {
            return t.period_end ? `Renouveler « ${this.props.plan.name} »` : `Souscrire à « ${this.props.plan.name} »`;
        }
        return t.period_end ? `Passer à « ${this.props.plan.name} »` : `Souscrire à « ${this.props.plan.name} »`;
    }
    get noteIcon() {
        return this.q.deferred ? "clock" : this.covered ? "check" : "receipt";
    }
    get confirmLabel() {
        if (this.covered) {
            return "Activer sans paiement";
        }
        return `Émettre la facture (${this.money(this.q.amount)})`;
    }
    money(v) {
        return fmtMoney(v, this.props.plan.symbol);
    }
    date(v) {
        return fmtDate(v);
    }
}
