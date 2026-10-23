/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api, newKey } from "@norma_facture/common/rpc";
import { confirm, Icon, notify, notifyError, openDialog } from "@norma_facture/common/ui";
import { money } from "@norma_facture/common/format";
import { can, currentSite, loadCatalog, session } from "@norma_facture/app/store";
import { estimate, lineTotal } from "@norma_facture/app/fiscal";
import { CustomerPicker, IssuedDialog, PageHead, PaymentDialog } from "@norma_facture/app/components";

/* Éditeur de facture détaillée (prestataires, B2B, acomptes, exportation). */
export class EditorPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Nouvelle facture'" subtitle="site ? site.name + ' · ' + site.code : ''"/>
            <div class="nm-editor">
                <div class="nm-stack">
                    <div class="nm-panel nm-panel-body nm-grid-2">
                        <div class="nm-field nm-span-2"><span>Client</span>
                            <button class="nm-btn nm-editor-client" t-on-click="pickCustomer">
                                <Icon name="'user'"/>
                                <span class="nm-grow" style="text-align:left">
                                    <t t-if="state.customer"><b t-esc="state.customer.name"/> <span class="nm-muted">· <t t-esc="state.customer.client_type"/><t t-if="state.customer.nif"> · NIF <t t-esc="state.customer.nif"/></t></span></t>
                                    <t t-else="">Choisir le client</t>
                                </span>
                                <Icon name="'edit'" size="16"/>
                            </button>
                        </div>
                        <label class="nm-field"><span>Type de facture</span>
                            <select class="nm-select" t-model="state.type">
                                <option value="FV">FV — Facture de vente</option>
                                <option value="FT">FT — Facture d'acompte</option>
                                <option value="EV">EV — Vente à l'exportation</option>
                                <option value="ET">ET — Acompte à l'exportation</option>
                            </select></label>
                        <label class="nm-field"><span>Référence (bon de commande, contrat)</span><input class="nm-input" t-model="state.origin" maxlength="80"/></label>
                        <div t-if="isExport" class="nm-note nm-span-2">Exportation : les articles passent au groupe E (0 %). Le client doit être identifié.</div>
                    </div>

                    <div class="nm-panel">
                        <div class="nm-table-wrap">
                            <table class="nm-table nm-editor-lines">
                                <thead><tr><th style="width:38%">Article ou prestation</th><th>Gr.</th><th class="nm-right">Qté</th><th class="nm-right">P.U. TTC</th><th class="nm-right">Remise %</th><th class="nm-right">Montant</th><th/></tr></thead>
                                <tbody>
                                    <tr t-foreach="state.lines" t-as="l" t-key="l.key">
                                        <td>
                                            <select class="nm-select" t-on-change="(ev) => this.setProduct(l, ev.target.value)">
                                                <option value="">Choisir…</option>
                                                <option t-foreach="session.catalog.products" t-as="p" t-key="p.id" t-att-value="p.id" t-att-selected="p.id === l.product_id" t-esc="p.name"/>
                                            </select>
                                            <input t-if="l.item_type === 'SER'" class="nm-input" style="margin-top:6px" placeholder="Description (facultatif)" t-model="l.name" maxlength="120"/>
                                        </td>
                                        <td><span t-if="l.tax_group" class="nm-group" t-esc="isExport ? 'E' : l.tax_group"/></td>
                                        <td><input class="nm-input nm-num nm-right" type="number" min="0" step="any" t-model.number="l.quantity" style="width:90px"/></td>
                                        <td><input class="nm-input nm-num nm-right" type="number" min="0" step="0.01" t-model.number="l.price" t-att-readonly="!can('manager')" style="width:130px"/></td>
                                        <td><input class="nm-input nm-num nm-right" type="number" min="0" t-att-max="session.max_discount" step="0.01" t-model.number="l.discount_pct" style="width:80px"/></td>
                                        <td class="nm-right nm-num" t-esc="l.product_id ? money(lineTotal(l)) : ''"/>
                                        <td><button class="nm-btn nm-btn-ghost nm-btn-icon nm-btn-sm" t-on-click="() => this.state.lines.splice(l_index, 1)" aria-label="Retirer"><Icon name="'trash'" size="15"/></button></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div class="nm-panel-body"><button class="nm-btn" t-on-click="addLine"><Icon name="'plus'"/> Ajouter une ligne</button></div>
                    </div>
                    <label class="nm-field"><span>Note imprimée sur la facture</span><input class="nm-input" t-model="state.note" maxlength="200"/></label>
                </div>

                <aside class="nm-panel nm-editor-sum">
                    <div class="nm-panel-body nm-stack">
                        <h2 style="font-size:17px">Récapitulatif</h2>
                        <table class="nm-table">
                            <tr t-foreach="est.groups" t-as="g" t-key="g.code"><td>Groupe <t t-esc="g.code"/> (<t t-esc="g.rate"/> %)</td><td class="nm-right nm-num">TVA <t t-esc="money(g.tax)"/></td></tr>
                            <tr><td>Total HT</td><td class="nm-right nm-num" t-esc="money(est.ht)"/></tr>
                            <tr><td>Total TVA</td><td class="nm-right nm-num" t-esc="money(est.tax)"/></tr>
                        </table>
                        <div class="nm-receipt-total" style="padding:0"><span>Total TTC</span><b class="nm-num" t-esc="money(est.total, session.company.currency)"/></div>
                        <label class="nm-check"><input type="checkbox" t-model="state.paid"/><span>Payée à l'émission (sinon : à crédit)</span></label>
                        <button class="nm-btn nm-btn-gold nm-btn-lg nm-btn-block" t-att-disabled="!ready or state.busy" t-on-click="issue">
                            <span t-if="state.busy" class="nm-spinner"/> Émettre la facture normalisée
                        </button>
                        <p class="nm-muted" style="margin:0;font-size:12px">Une fois normalisée, la facture ne se modifie plus : une correction passe par une facture d'avoir.</p>
                    </div>
                </aside>
            </div>
        </div>`;
    static components = { Icon, PageHead };
    static props = ["*"];
    setup() {
        this.money = money;
        this.can = can;
        this.lineTotal = lineTotal;
        this.session = useState(session);
        this.key = 0;
        this.state = useState({ customer: null, type: "FV", origin: "", note: "", paid: false, busy: false, lines: [] });
        onWillStart(async () => { await loadCatalog(); this.addLine(); });
    }
    get site() { return currentSite(); }
    get isExport() { return ["EV", "ET"].includes(this.state.type); }
    get valid() { return this.state.lines.filter((l) => l.product_id && Number(l.quantity) > 0); }
    get est() { return estimate(this.valid.map((l) => ({ ...l, tax_group: this.isExport ? "E" : l.tax_group }))); }
    get ready() { return this.valid.length && (!this.isExport || this.state.customer); }
    addLine() {
        this.state.lines.push({ key: ++this.key, product_id: null, name: "", quantity: 1, price: 0, discount_pct: 0, tax_group: "", item_type: "" });
    }
    setProduct(l, id) {
        const p = session.catalog.products.find((x) => x.id === parseInt(id));
        Object.assign(l, p ? { product_id: p.id, price: p.price, tax_group: p.tax_group, item_type: p.item_type, specific_tax: p.specific_tax, name: "" }
            : { product_id: null, tax_group: "" });
    }
    async pickCustomer() {
        const c = await openDialog(CustomerPicker, {});
        if (c) this.state.customer = c;
    }
    async issue() {
        if (!this.ready) return;
        const total = this.est.total;
        let payments = [{ method: "CREDIT", amount: total }];
        if (this.state.paid) {
            payments = await openDialog(PaymentDialog, { total, currency: session.company.currency, defaultMethod: "VIREMENT", allowCredit: true });
            if (!payments) return;
        } else if (!this.state.customer) {
            notify("Une facture à crédit exige l'identification du client.", "bad");
            return;
        } else if (!(await confirm("Émettre la facture", `Facture de ${money(total, session.company.currency)} à crédit pour ${this.state.customer.name}. Elle sera transmise à la DGI.`, { confirm: "Émettre" }))) {
            return;
        }
        this.state.busy = true;
        try {
            this.saleKey = this.saleKey || newKey();
            const inv = await api("checkout", {
                request_key: this.saleKey,
                site_id: this.site.id, invoice_type: this.state.type, customer_id: this.state.customer ? this.state.customer.id : null,
                origin: this.state.origin, note: this.state.note, payments,
                lines: this.valid.map((l) => ({ product_id: l.product_id, quantity: l.quantity, discount_pct: l.discount_pct || 0,
                    name: l.name || undefined, price: can("manager") ? l.price : undefined })),
            });
            this.saleKey = null;
            const next = await openDialog(IssuedDialog, { invoice: inv, nextLabel: "Nouvelle facture" });
            Object.assign(this.state, { customer: null, origin: "", note: "", paid: false, lines: [] });
            this.addLine();
            if (next !== "next") location.hash = `#/invoices/${inv.id}`;
        } catch (err) {
            notifyError(err);
        } finally {
            this.state.busy = false;
        }
    }
}
