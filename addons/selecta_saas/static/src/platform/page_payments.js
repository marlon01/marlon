/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { CYCLE_LABELS, errMessage, fmtDate, fmtDateTime, INVOICE_BADGE, money, papi, pstore } from "@selecta_saas/platform/papi";

export class PaymentsPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div>
                    <p class="pf-eyebrow">Administration centrale</p>
                    <h1>Paiements</h1>
                    <p class="sl-muted">Vérifiez chaque déclaration auprès de l'opérateur ou de la banque avant de la valider : la validation prolonge immédiatement l'abonnement.</p>
                </div>
                <div class="ad-head-actions"><button class="sl-btn sl-btn-sm" t-on-click="load" t-att-disabled="state.loading"><Icon name="'refresh'" size="16"/>Actualiser</button></div>
            </header>
            <div class="ad-tabs" role="tablist" aria-label="Paiements">
                <button role="tab" class="ad-tab" t-att-class="{'is-active': state.tab == 'pending'}" t-att-aria-selected="state.tab == 'pending' ? 'true' : 'false'" t-on-click="() => this.setTab('pending')">
                    À valider <span class="ad-tab-count" t-esc="pending"/>
                </button>
                <button role="tab" class="ad-tab" t-att-class="{'is-active': state.tab == 'all'}" t-att-aria-selected="state.tab == 'all' ? 'true' : 'false'" t-on-click="() => this.setTab('all')">
                    Toutes les factures
                </button>
            </div>
            <div t-if="state.error" class="sl-alert sl-alert-danger ad-mb" role="alert"><t t-esc="state.error"/></div>
            <section class="ad-panel ad-panel-flush" role="tabpanel">
                <div t-if="state.loading and !state.loaded" class="ad-loading"><span class="sl-spinner"/></div>
                <table t-elif="state.rows.length" class="ad-table pf-payments">
                    <thead><tr>
                        <th scope="col">Structure</th><th scope="col">Facture</th><th scope="col" class="num">Montant</th>
                        <th t-if="state.tab == 'all'" scope="col">Statut</th>
                        <th scope="col">Moyen</th><th scope="col">Référence</th><th scope="col">Téléphone</th>
                        <th scope="col">Déclaré le</th><th scope="col">Justificatif</th><th scope="col" class="num"><span class="sl-sr">Actions</span></th>
                    </tr></thead>
                    <tbody>
                        <tr t-foreach="state.rows" t-as="i" t-key="i.id">
                            <td><a t-att-href="'#/tenants/' + i.tenant_id" class="pf-cell-title" t-esc="i.tenant"/></td>
                            <td><span class="sl-mono" t-esc="i.name"/><div class="sl-muted ad-small"><t t-esc="i.plan"/> · <t t-esc="cycle[i.billing_cycle]"/></div></td>
                            <td class="num sl-figures pf-amount" t-esc="money(i.amount, i.symbol)"/>
                            <td t-if="state.tab == 'all'">
                                <span t-attf-class="sl-badge {{badge[i.state]}}" t-esc="i.state_label"/>
                                <div t-if="i.reject_reason" class="ad-small ad-danger-text pf-clip" t-att-title="i.reject_reason" t-esc="i.reject_reason"/>
                            </td>
                            <td class="ad-small" t-esc="i.payment_method_label or '—'"/>
                            <td class="sl-mono ad-small" t-esc="i.payment_reference or '—'"/>
                            <td class="ad-small"><a t-if="i.payer_phone" t-att-href="'tel:' + i.payer_phone" t-esc="i.payer_phone"/><t t-else="">—</t></td>
                            <td class="ad-small" t-esc="i.declared_date ? dt(i.declared_date) : '—'"/>
                            <td class="ad-small">
                                <a t-if="i.has_proof" t-att-href="proofUrl(i)" class="pf-proof" target="_blank" rel="noopener" t-att-title="i.proof_filename or 'Justificatif'">
                                    <Icon name="'download'" size="14"/>Télécharger
                                </a>
                                <span t-else="" class="sl-muted">Aucun</span>
                            </td>
                            <td class="num">
                                <div t-if="i.state == 'pending'" class="pf-row-actions">
                                    <button class="sl-btn sl-btn-sm sl-btn-primary" t-on-click="() => this.validate(i)" t-att-disabled="state.busy == i.id"><Icon name="'check'" size="16"/>Valider</button>
                                    <button class="sl-btn sl-btn-sm pf-btn-danger-ghost" t-on-click="() => this.reject(i)" t-att-disabled="state.busy == i.id">Refuser</button>
                                </div>
                                <span t-elif="i.validated_date" class="sl-muted ad-small">le <t t-esc="date(i.validated_date)"/></span>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div t-else="" class="ad-empty">
                    <Icon name="'check'" size="28"/>
                    <p t-if="state.tab == 'pending'">Aucun paiement en attente de validation.</p>
                    <p t-else="">Aucune facture n'a encore été émise.</p>
                </div>
            </section>
        </div>`;
    static props = { route: Object };
    setup() {
        this.state = useState({ tab: this.props.route.params?.tab === "all" ? "all" : "pending", rows: [], loading: false, loaded: false, busy: 0, error: "" });
        this.store = useState(pstore);
        this.badge = INVOICE_BADGE;
        this.cycle = CYCLE_LABELS;
        onWillStart(() => this.load());
    }
    get pending() {
        return this.state.tab === "pending" && this.state.loaded ? this.state.rows.length : this.store.pending;
    }
    setTab(tab) {
        if (tab !== this.state.tab) {
            this.state.tab = tab;
            this.state.loaded = false;
            this.state.rows = [];
            this.load();
        }
    }
    async load() {
        this.state.loading = true;
        this.state.error = "";
        try {
            const rows = await papi("invoices_list", [this.state.tab === "pending" ? "pending" : ""]);
            // Les déclarations les plus anciennes d'abord : premières arrivées, premières traitées.
            if (this.state.tab === "pending") {
                rows.sort((a, b) => String(a.declared_date).localeCompare(String(b.declared_date)));
                pstore.pending = rows.length;
            }
            this.state.rows = rows;
            this.state.loaded = true;
        } catch (e) {
            this.state.error = errMessage(e);
        } finally {
            this.state.loading = false;
        }
    }
    proofUrl(i) {
        return `/web/content/selecta.saas.invoice/${i.id}/proof?download=true`;
    }
    async validate(i) {
        const cycle = i.billing_cycle === "yearly" ? "d'un an" : "d'un mois";
        const ok = await confirmDialog({
            title: "Valider ce paiement ?",
            body:
                `${i.tenant}\nFacture ${i.name} : ${money(i.amount, i.symbol)} (${i.plan}, ${CYCLE_LABELS[i.billing_cycle].toLowerCase()})\n` +
                `${i.payment_method_label}, référence ${i.payment_reference || "non renseignée"}\n\n` +
                `L'abonnement sera prolongé ${cycle} à partir de l'échéance en cours et la catégorie « ${i.plan} » sera appliquée. ` +
                "Ne validez qu'après avoir constaté l'encaissement.",
            confirmLabel: `Valider ${money(i.amount, i.symbol)}`,
        });
        if (ok) {
            await this.act(i, "validate", "", `Paiement validé : l'abonnement de ${i.tenant} est prolongé.`);
        }
    }
    async reject(i) {
        const reason = await confirmDialog({
            title: "Refuser ce paiement",
            body: `${i.tenant} · facture ${i.name} · ${money(i.amount, i.symbol)}\nLa structure verra ce motif et pourra déclarer à nouveau son paiement.`,
            confirmLabel: "Refuser le paiement",
            danger: true,
            input: { label: "Motif du refus (5 caractères minimum)", placeholder: "Ex. : référence introuvable chez l'opérateur, montant reçu incomplet…", minLength: 5 },
        });
        if (reason) {
            await this.act(i, "reject", reason, "Paiement refusé, la structure en est informée.");
        }
    }
    async act(i, action, reason, message) {
        this.state.busy = i.id;
        try {
            await papi("invoice_action", [i.id, action, reason]);
            notify(message, "ok");
            await this.load();
            if (this.state.tab !== "pending") {
                pstore.pending = (await papi("invoices_list", ["pending"])).length;
            }
        } catch (e) {
            notify(errMessage(e), "danger", 7000);
        } finally {
            this.state.busy = 0;
        }
    }
    money(v, s) {
        return money(v, s);
    }
    date(v) {
        return fmtDate(v);
    }
    dt(v) {
        return fmtDateTime(v);
    }
}
