/** @odoo-module */
import { Component, onMounted, onWillStart, onWillUnmount, useRef, useState, xml } from "@odoo/owl";
import { api, newKey } from "@norma_facture/common/rpc";
import { ConfirmDialog, Icon, notify, notifyError, openDialog } from "@norma_facture/common/ui";
import { money, qty } from "@norma_facture/common/format";
import { can, currentSite, loadCatalog, session } from "@norma_facture/app/store";
import { estimate, lineTotal } from "@norma_facture/app/fiscal";
import { autoPrint, CustomerPicker, IssuedDialog, PaymentDialog } from "@norma_facture/app/components";
import { printerSettings, printTicket } from "@norma_facture/common/printer";
import { qrSvg } from "@norma_facture/common/qr";
import { queueSale } from "@norma_facture/app/sync";
import { Dialog } from "@norma_facture/common/ui";

/* Le ticket en cours : partagé par la caisse, l'éditeur et les notes (hôtel, restaurant). */
export class Receipt extends Component {
    static template = xml`
        <section class="nm-receipt" aria-label="Ticket en cours">
            <div class="nm-receipt-paper">
                <header class="nm-receipt-head">
                    <div>
                        <b t-esc="props.title or 'Vente en cours'"/>
                        <div class="nm-muted" t-esc="props.subtitle or ''"/>
                    </div>
                    <button t-if="props.onCustomer" class="nm-receipt-client" t-on-click="() => props.onCustomer()">
                        <Icon name="'user'" size="16"/>
                        <span t-esc="props.customer ? props.customer.name : 'Client comptant'"/>
                    </button>
                </header>
                <div class="nm-receipt-lines">
                    <div t-if="!props.lines.length" class="nm-receipt-empty">
                        <Icon name="'barcode'" size="30"/>
                        <p t-esc="props.emptyText or 'Scannez un code-barres ou touchez un article.'"/>
                    </div>
                    <div t-foreach="props.lines" t-as="l" t-key="l_index" class="nm-rl" t-att-class="{'is-sent': l.sent}">
                        <div class="nm-rl-main">
                            <span class="nm-rl-name"><t t-esc="l.name"/> <span class="nm-group" t-esc="l.tax_group"/></span>
                            <span class="nm-num nm-rl-total" t-esc="money(lineTotal(l))"/>
                        </div>
                        <div class="nm-rl-sub">
                            <t t-if="props.editable and !l.locked">
                                <button class="nm-qty" t-on-click="() => props.onQty(l_index, -1)" aria-label="Moins"><Icon name="'minus'" size="14"/></button>
                                <input class="nm-qty-in nm-num" type="number" min="0" step="any" t-att-value="l.quantity" t-on-change="(ev) => props.onSetQty(l_index, ev.target.value)" aria-label="Quantité"/>
                                <button class="nm-qty" t-on-click="() => props.onQty(l_index, 1)" aria-label="Plus"><Icon name="'plus'" size="14"/></button>
                            </t>
                            <span t-else="" class="nm-num" t-esc="qty(l.quantity)"/>
                            <span class="nm-num nm-muted">× <t t-esc="money(l.price)"/></span>
                            <button t-if="props.editable and props.onDiscount and !l.locked" class="nm-disc" t-att-class="{'is-on': l.discount_pct}" t-on-click="() => props.onDiscount(l_index)">
                                <t t-if="l.discount_pct">−<t t-esc="l.discount_pct"/> %</t><t t-else="">Remise</t>
                            </button>
                            <span t-if="l.sent" class="nm-tag nm-tag-plain" style="height:20px">Envoyé</span>
                            <button t-if="props.onRemove and (props.editable or l.removable)" class="nm-rl-del" t-on-click="() => props.onRemove(l_index)" aria-label="Retirer la ligne"><Icon name="'trash'" size="15"/></button>
                        </div>
                    </div>
                </div>
                <footer class="nm-receipt-foot">
                    <div t-foreach="est.groups" t-as="g" t-key="g.code" class="nm-receipt-tax">
                        <span>Groupe <t t-esc="g.code"/> · <t t-esc="g.rate"/> % · HT <t t-esc="money(g.base)"/></span>
                        <span class="nm-num">TVA <t t-esc="money(g.tax)"/></span>
                    </div>
                    <div class="nm-receipt-total">
                        <span>Total TTC</span>
                        <b class="nm-num" t-esc="money(est.total, currency)"/>
                    </div>
                    <t t-slot="actions"/>
                </footer>
            </div>
        </section>`;
    static components = { Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.qty = qty;
        this.lineTotal = lineTotal;
    }
    get est() { return estimate(this.props.lines); }
    get currency() { return session.company.currency; }
}

class OfflineSaleDialog extends Component {
    static template = xml`
        <Dialog title="'Vente enregistrée hors ligne'" onClose="() => props.close('next')">
            <div class="nm-issued is-failed">
                <div class="nm-issued-stamp" aria-hidden="true"><Icon name="'wifi'" size="34"/><span>Hors ligne</span></div>
                <div class="nm-issued-body">
                    <div class="nm-num nm-issued-total" t-esc="money(props.ticket.total, props.ticket.currency)"/>
                    <div class="nm-note nm-note-warn" style="margin-top:10px">La connexion est coupée. La vente est gardée sur ce poste et sera transmise automatiquement dès le retour du réseau, puis normalisée par la DGI. Le ticket provisoire porte un QR code qui mènera le client à sa facture normalisée.</div>
                </div>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="reprint"><Icon name="'receipt'"/> Réimprimer</button>
                <button class="nm-btn nm-btn-primary" data-autofocus="1" t-on-click="() => props.close('next')">Vente suivante</button>
            </t>
        </Dialog>`;
    static components = { Dialog, Icon };
    static props = ["*"];
    setup() { this.money = money; }
    reprint() {
        printTicket(this.props.ticket, { qrSvgMarkup: qrSvg(this.props.ticket.verify_url, 3) }).catch(notifyError);
    }
}

/* Saisie d'une remise (limitée pour le caissier). */
export async function askDiscount(line) {
    const max = session.max_discount;
    const value = await openDialog(ConfirmDialog, { title: "Remise sur la ligne", input: `Remise en % (maximum ${max} %)`,
        message: line.name, confirm: "Appliquer", placeholder: String(line.discount_pct || 0) });
    if (value === false || value === undefined) return null;
    const n = Number(String(value).replace(",", "."));
    if (!(n >= 0 && n <= max && n < 100)) {
        notify(`Remise invalide : entre 0 et ${max} %.`, "bad");
        return null;
    }
    return Math.round(n * 100) / 100;
}

export class PosPage extends Component {
    static template = xml`
        <div class="nm-pos">
            <section class="nm-pos-catalog">
                <div class="nm-pos-bar">
                    <div class="nm-scan">
                        <Icon name="'barcode'"/>
                        <input t-ref="scan" class="nm-scan-in" placeholder="Code-barres, référence ou nom de l'article  (F2)" t-model="state.q"
                               t-on-keydown="onScanKey" aria-label="Rechercher ou scanner un article"/>
                    </div>
                    <select t-if="sites.length > 1" class="nm-select" style="width:auto" t-att-value="site and site.id" disabled="1">
                        <option t-foreach="sites" t-as="s" t-key="s.id" t-att-value="s.id" t-esc="s.code"/>
                    </select>
                </div>
                <div class="nm-chips" role="tablist">
                    <button class="nm-chip" t-att-class="{'is-on': !state.cat}" t-on-click="() => this.state.cat = null">Tous</button>
                    <button t-foreach="catalog.categories" t-as="c" t-key="c.id" class="nm-chip" t-att-class="{'is-on': state.cat === c.id}"
                            t-on-click="() => this.state.cat = c.id"><i t-att-style="'background:' + c.color"/><t t-esc="c.name"/></button>
                </div>
                <div class="nm-tiles">
                    <button t-foreach="products" t-as="p" t-key="p.id" class="nm-tile" t-on-click="() => this.add(p)">
                        <i t-att-style="'background:' + p.color"/>
                        <span class="nm-tile-name" t-esc="p.name"/>
                        <span class="nm-tile-foot"><b class="nm-num" t-esc="money(p.price)"/><span class="nm-group" t-esc="p.tax_group"/></span>
                    </button>
                    <div t-if="!products.length" class="nm-empty">
                        <h3>Aucun article</h3>
                        <p t-if="can('manager')">Ajoutez vos articles dans <a href="#/catalog">Catalogue</a>.</p>
                    </div>
                </div>
            </section>
            <Receipt lines="state.lines" editable="true" customer="state.customer" subtitle="site ? site.name + ' · ' + site.code : ''"
                     onCustomer.bind="pickCustomer" onQty.bind="bump" onSetQty.bind="setQty" onRemove.bind="remove" onDiscount.bind="discount">
                <t t-set-slot="actions">
                    <div class="nm-receipt-actions">
                        <button class="nm-btn" t-on-click="clear" t-att-disabled="!state.lines.length">Vider</button>
                        <button class="nm-btn nm-btn-gold nm-btn-lg nm-grow" t-on-click="pay" t-att-disabled="!state.lines.length or state.busy">
                            <span t-if="state.busy" class="nm-spinner"/> <t t-else="">Encaisser  (F9)</t>
                        </button>
                    </div>
                </t>
            </Receipt>
        </div>`;
    static components = { Icon, Receipt };
    static props = ["*"];
    setup() {
        this.money = money;
        this.can = can;
        this.scan = useRef("scan");
        this.state = useState({ q: "", cat: null, lines: [], customer: null, busy: false });
        this.session = useState(session);
        onWillStart(() => loadCatalog());
        this.onKey = (ev) => {
            if (ev.key === "F2") { ev.preventDefault(); this.scan.el && this.scan.el.focus(); }
            if (ev.key === "F9") { ev.preventDefault(); this.pay(); }
        };
        onMounted(() => { window.addEventListener("keydown", this.onKey); this.scan.el && this.scan.el.focus(); });
        onWillUnmount(() => window.removeEventListener("keydown", this.onKey));
    }
    get catalog() { return this.session.catalog; }
    get sites() { return session.sites; }
    get site() { return currentSite(); }
    get products() {
        const q = this.state.q.trim().toLowerCase();
        return session.catalog.products.filter((p) => (!this.state.cat || p.category_id === this.state.cat)
            && (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase() === q || p.barcode === q)).slice(0, 120);
    }
    onScanKey(ev) {
        if (ev.key !== "Enter") return;
        const q = this.state.q.trim();
        if (!q) return;
        // Le lecteur envoie le code puis « Entrée » ; « 3*code » ajoute trois unités.
        const m = q.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/);
        const n = m ? Number(m[1].replace(",", ".")) : 1;
        const code = (m ? m[2] : q).trim().toLowerCase();
        const p = session.catalog.products.find((x) => x.barcode.toLowerCase() === code || x.code.toLowerCase() === code)
            || (this.products.length === 1 ? this.products[0] : null);
        if (!p) {
            notify(`Article introuvable : ${q}`, "bad");
            return;
        }
        this.add(p, n);
        this.state.q = "";
        ev.target.value = ""; // deux lectures rapprochées : le rendu ne suffit pas à vider le champ
    }
    add(p, n = 1) {
        this.saleKey = null;
        const line = this.state.lines.find((l) => l.product_id === p.id && !l.discount_pct);
        if (line) {
            line.quantity = Math.round((Number(line.quantity) + n) * 1000) / 1000;
        } else {
            this.state.lines.push({ product_id: p.id, name: p.name, price: p.price, quantity: n, discount_pct: 0,
                tax_group: p.tax_group, specific_tax: p.specific_tax });
        }
        this.scan.el && this.scan.el.focus();
    }
    bump(i, d) {
        const l = this.state.lines[i];
        const q = Math.round((Number(l.quantity) + d) * 1000) / 1000;
        if (q <= 0) this.state.lines.splice(i, 1); else l.quantity = q;
    }
    setQty(i, v) {
        const q = Math.round(Number(String(v).replace(",", ".")) * 1000) / 1000;
        if (!(q > 0)) this.state.lines.splice(i, 1); else this.state.lines[i].quantity = q;
    }
    remove(i) { this.state.lines.splice(i, 1); }
    async discount(i) {
        const d = await askDiscount(this.state.lines[i]);
        if (d !== null) this.state.lines[i].discount_pct = d;
    }
    clear() { this.state.lines.splice(0); this.state.customer = null; this.saleKey = null; }
    async pickCustomer() {
        const c = await openDialog(CustomerPicker, { allowNone: true });
        if (c !== undefined) this.state.customer = c;
    }
    async pay() {
        if (!this.state.lines.length || this.state.busy) return;
        if (!this.site) { notify("Aucun établissement disponible.", "bad"); return; }
        const total = estimate(this.state.lines).total;
        const payments = await openDialog(PaymentDialog, { total, currency: session.company.currency,
            allowCredit: !!this.state.customer && !session.offline });
        if (!payments) return;
        this.state.busy = true;
        this.saleKey = this.saleKey || newKey();
        const payload = {
            request_key: this.saleKey, site_id: this.site.id, customer_id: this.state.customer ? this.state.customer.id : null,
            lines: this.state.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, discount_pct: l.discount_pct })),
            payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
        };
        try {
            let inv = null;
            if (!session.offline) {
                try {
                    inv = await api("checkout", payload);
                } catch (err) {
                    if (!err.network) throw err;
                    session.offline = true;
                }
            }
            if (inv) {
                this.saleKey = null;
                this.clear();
                autoPrint(inv, payments.change);
                if (inv.state !== "normalized") session.dgiPending++;
                await openDialog(IssuedDialog, { invoice: inv });
            } else {
                await this.saveOffline(payload, payments);
            }
        } catch (err) {
            notifyError(err);
        } finally {
            this.state.busy = false;
            this.scan.el && this.scan.el.focus();
        }
    }
    /* Coupure : la vente est gardée sur le poste, un ticket provisoire est imprimé, l'envoi se fera tout seul. */
    async saveOffline(payload, payments) {
        const offline_at = new Date().toISOString();
        const lines = this.state.lines.map((l) => ({ ...l }));
        payload.offline_at = offline_at;
        payload.lines = lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, discount_pct: l.discount_pct, price: l.price }));
        const est = estimate(lines);
        const url = `${location.origin}/norma/r/${payload.request_key}`;
        const ticket = {
            provisional: true, company: session.company, site: this.site, type: "FV", number: "", date: new Date().toLocaleString("fr-FR"),
            operator: session.user.name, client_name: this.state.customer ? this.state.customer.name : "",
            lines: lines.map((l) => ({ name: l.name, tax_group: l.tax_group, quantity: l.quantity, price: l.price,
                discount_pct: l.discount_pct, total: lineTotal(l) })),
            groups: est.groups, total_ht: est.ht, total_tax: est.tax, total: est.total, currency: session.company.currency,
            payments: payments.map((p) => ({ label: (session.payment_methods.find((m) => m.code === p.method) || {}).label || p.method, amount: p.amount })),
            change: payments.change, verify_url: url,
        };
        await queueSale({ request_key: payload.request_key, company_id: session.company.id, uid: session.user.id,
            offline_at, payload, ticket, error: "" });
        this.saleKey = null;
        this.clear();
        if (printerSettings().auto) {
            // Impression lancée sans attendre : la caisse reste disponible pendant que le ticket sort.
            printTicket(ticket, { qrSvgMarkup: qrSvg(url, 3) }).catch(notifyError);
        }
        await openDialog(OfflineSaleDialog, { ticket });
    }
}
