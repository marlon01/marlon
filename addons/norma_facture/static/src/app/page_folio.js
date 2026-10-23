/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";
import { BusyButton, confirm, Dialog, Icon, notify, notifyError, openDialog, useInterval } from "@norma_facture/common/ui";
import { date, isoDay, money } from "@norma_facture/common/format";
import { can, currentSite, loadCatalog, session } from "@norma_facture/app/store";
import { autoPrint, CustomerPicker, IssuedDialog, PageHead, PaymentDialog } from "@norma_facture/app/components";
import { Receipt } from "@norma_facture/app/page_pos";

const HK = { clean: ["Prête", "ok"], dirty: ["À nettoyer", "warn"], maintenance: ["Maintenance", "bad"] };

class CheckinDialog extends Component {
    static template = xml`
        <Dialog title="'Arrivée — chambre ' + props.place.name" onClose="() => props.close(null)">
            <div class="nm-stack">
                <div class="nm-field"><span>Client</span>
                    <button class="nm-btn" style="justify-content:flex-start" t-on-click="pick">
                        <Icon name="'user'"/> <t t-esc="state.customer ? state.customer.name : 'Choisir ou enregistrer le client'"/>
                    </button>
                </div>
                <div class="nm-grid-2">
                    <label class="nm-field"><span>Personnes</span><input class="nm-input" type="number" min="1" t-model.number="state.guests"/></label>
                    <label class="nm-field"><span>Départ prévu</span><input class="nm-input" type="date" t-att-min="today" t-model="state.checkout"/></label>
                </div>
                <div class="nm-note">Tarif : <b t-esc="money(props.place.rate, currency)"/> la nuit. La première nuitée est portée sur la note à l'arrivée, puis une par jour à partir de midi.</div>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" disabled="!state.customer" onClick.bind="save">Enregistrer l'arrivée</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, Icon, BusyButton };
    static props = ["*"];
    setup() {
        this.money = money;
        this.currency = session.company.currency;
        this.today = isoDay();
        const tomorrow = new Date(Date.now() + 86400000);
        this.state = useState({ customer: null, guests: 1, checkout: isoDay(tomorrow) });
    }
    async pick() {
        const c = await openDialog(CustomerPicker, { guest: true });
        if (c) this.state.customer = c;
    }
    async save() {
        const folio = await api("folio_open", { place_id: this.props.place.id, customer_id: this.state.customer.id,
            guests: this.state.guests, checkout_planned: this.state.checkout });
        notify(`Arrivée enregistrée : chambre ${this.props.place.name}.`, "ok");
        this.props.close(folio);
    }
}

class TableOpenDialog extends Component {
    static template = xml`
        <Dialog title="'Ouvrir la table ' + props.place.name" onClose="() => props.close(null)">
            <label class="nm-field"><span>Nombre de couverts</span><input class="nm-input" type="number" min="1" t-model.number="state.guests"/></label>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" onClick.bind="save">Ouvrir la table</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() { this.state = useState({ guests: Math.min(2, this.props.place.capacity || 2) }); }
    async save() { this.props.close(await api("folio_open", { place_id: this.props.place.id, guests: this.state.guests })); }
}

/* Une note ouverte : consommations à gauche, ticket à droite. */
class FolioView extends Component {
    static template = xml`
        <div class="nm-folio">
            <div class="nm-folio-catalog">
                <div class="nm-row" style="margin-bottom:12px">
                    <button class="nm-btn" t-on-click="() => props.onBack()"><Icon name="'undo'"/> <t t-esc="isRoom ? 'Plan des chambres' : 'Plan de salle'"/></button>
                    <div class="nm-grow"/>
                    <button t-if="!isRoom" class="nm-btn" t-on-click="move"><Icon name="'move'"/> Changer de table</button>
                </div>
                <div class="nm-chips">
                    <button class="nm-chip" t-att-class="{'is-on': !state.cat}" t-on-click="() => this.state.cat = null">Tous</button>
                    <button t-foreach="session.catalog.categories" t-as="c" t-key="c.id" class="nm-chip" t-att-class="{'is-on': state.cat === c.id}" t-on-click="() => this.state.cat = c.id"><i t-att-style="'background:' + c.color"/><t t-esc="c.name"/></button>
                </div>
                <div class="nm-tiles">
                    <button t-foreach="products" t-as="p" t-key="p.id" class="nm-tile" t-on-click="() => this.add(p)" t-att-disabled="state.busy">
                        <i t-att-style="'background:' + p.color"/>
                        <span class="nm-tile-name" t-esc="p.name"/>
                        <span class="nm-tile-foot"><b class="nm-num" t-esc="money(p.price)"/><span class="nm-group" t-esc="p.tax_group"/></span>
                    </button>
                </div>
            </div>
            <Receipt lines="lines" editable="false" title="title" subtitle="subtitle" customer="customer"
                     onCustomer.bind="pickCustomer" onRemove.bind="remove" emptyText="'Touchez un plat, une boisson ou un service pour l’ajouter à la note.'">
                <t t-set-slot="actions">
                    <div class="nm-receipt-actions">
                        <button t-if="!isRoom" class="nm-btn" t-on-click="send" t-att-disabled="!unsent"><Icon name="'send'"/> Cuisine<t t-if="unsent"> (<t t-esc="unsent"/>)</t></button>
                        <button t-if="can('manager') and !state.folio.lines.length" class="nm-btn nm-btn-danger" t-on-click="cancel">Annuler</button>
                        <button class="nm-btn nm-btn-gold nm-btn-lg nm-grow" t-on-click="checkout" t-att-disabled="!state.folio.lines.length or state.busy">
                            <t t-esc="isRoom ? 'Départ et facture' : 'Encaisser'"/>
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
        this.session = useState(session);
        this.state = useState({ folio: this.props.folio, cat: null, busy: false, customer: null });
    }
    get isRoom() { return this.state.folio.kind === "room"; }
    get title() { return (this.isRoom ? "Chambre " : "Table ") + this.state.folio.place; }
    get subtitle() {
        const f = this.state.folio;
        return this.isRoom ? `Arrivée le ${date(f.checkin)} · ${f.nights_posted} nuitée(s)${f.checkout_planned ? " · départ prévu " + date(f.checkout_planned) : ""}`
            : `${f.guests} couvert(s)`;
    }
    get customer() { return this.state.customer || (this.state.folio.customer_id ? { id: this.state.folio.customer_id, name: this.state.folio.customer } : null); }
    get lines() {
        return this.state.folio.lines.map((l) => {
            const p = session.catalog.products.find((x) => x.id === l.product_id) || {};
            return { ...l, tax_group: p.tax_group || "B", specific_tax: p.specific_tax || 0, discount_pct: 0,
                removable: can("manager") || (!l.sent && !l.is_night) };
        });
    }
    get unsent() { return this.state.folio.lines.filter((l) => !l.sent && !l.is_night).length; }
    get products() {
        return session.catalog.products.filter((p) => (!this.state.cat || p.category_id === this.state.cat) && p.kind !== "room");
    }
    async run(fn) {
        this.state.busy = true;
        try { this.state.folio = await fn(); } catch (err) { notifyError(err); } finally { this.state.busy = false; }
    }
    add(p) { return this.run(() => api("folio_add", { id: this.state.folio.id, product_id: p.id, quantity: 1 })); }
    remove(i) { return this.run(() => api("folio_remove", { id: this.state.folio.id, line_id: this.state.folio.lines[i].id })); }
    async send() {
        await this.run(() => api("folio_send", { id: this.state.folio.id }));
        notify("Commande envoyée en cuisine.", "ok");
    }
    async pickCustomer() {
        const c = await openDialog(CustomerPicker, { allowNone: !this.isRoom, guest: this.isRoom });
        if (c !== undefined) this.state.customer = c;
    }
    async move() {
        const places = (await api("places", { site_id: session.siteId, kind: "table" })).filter((p) => !p.folio);
        if (!places.length) { notify("Aucune table libre.", "bad"); return; }
        const name = await confirm("Changer de table", `Tables libres : ${places.map((p) => p.name).join(", ")}`, { input: "Nouvelle table", confirm: "Déplacer" });
        const target = name && places.find((p) => p.name.toLowerCase() === String(name).toLowerCase());
        if (name && !target) { notify("Table introuvable ou occupée.", "bad"); return; }
        if (target) await this.run(() => api("folio_move", { id: this.state.folio.id, place_id: target.id }));
    }
    async cancel() {
        if (await confirm("Annuler la note", "La note vide sera fermée.", { danger: true, confirm: "Annuler la note" })) {
            await api("folio_cancel", { id: this.state.folio.id, reason: "Note vide" });
            this.props.onBack();
        }
    }
    async checkout() {
        const f = await api("folio_get", { id: this.state.folio.id });
        this.state.folio = f;
        const customer = this.customer;
        const payments = await openDialog(PaymentDialog, { total: f.total, currency: session.company.currency, allowCredit: !!customer,
            defaultMethod: this.isRoom ? "CARTEBANCAIRE" : "ESPECES" });
        if (!payments) return;
        this.state.busy = true;
        try {
            const inv = await api("folio_checkout", { id: f.id, payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
                customer_id: customer ? customer.id : null });
            autoPrint(inv, payments.change);
            await openDialog(IssuedDialog, { invoice: inv, nextLabel: this.isRoom ? "Retour au plan" : "Retour à la salle" });
            this.props.onBack();
        } catch (err) {
            notifyError(err);
        } finally {
            this.state.busy = false;
        }
    }
}

export class FolioPage extends Component {
    static template = xml`
        <div class="nm-page">
            <t t-if="state.folio"><FolioView folio="state.folio" onBack.bind="back" t-key="state.folio.id"/></t>
            <t t-else="">
                <PageHead title="isRoom ? 'Chambres' : 'Salle'" subtitle="summary">
                    <div class="nm-legend" t-if="isRoom">
                        <span><i class="is-free"/>Libre</span><span><i class="is-busy"/>Occupée</span><span><i class="is-dirty"/>À nettoyer</span>
                    </div>
                </PageHead>
                <div t-if="!state.places.length and !state.loading" class="nm-panel nm-empty">
                    <h3 t-esc="isRoom ? 'Aucune chambre' : 'Aucune table'"/>
                    <p t-if="can('manager')">Créez-les dans <a href="#/catalog?tab=places">Catalogue</a>.</p>
                </div>
                <section t-foreach="zones" t-as="z" t-key="z.name" class="nm-zone">
                    <h2 t-esc="z.name"/>
                    <div class="nm-plan" t-att-class="isRoom ? 'is-rooms' : 'is-tables'">
                        <button t-foreach="z.places" t-as="p" t-key="p.id" class="nm-place" t-att-class="placeClass(p)" t-on-click="() => this.open(p)">
                            <span class="nm-place-name" t-esc="p.name"/>
                            <t t-if="p.folio">
                                <span class="nm-place-who" t-esc="isRoom ? p.folio.customer : p.folio.guests + ' couvert(s)'"/>
                                <span class="nm-place-total nm-num" t-esc="money(p.folio.total)"/>
                                <span t-if="isRoom and p.folio.checkout_planned" class="nm-place-meta">Départ <t t-esc="date(p.folio.checkout_planned)"/></span>
                            </t>
                            <t t-else="">
                                <span class="nm-place-who" t-esc="isRoom ? hk(p)[0] : 'Libre · ' + p.capacity + ' places'"/>
                                <span t-if="isRoom" class="nm-place-meta nm-num"><t t-esc="money(p.rate)"/> / nuit</span>
                            </t>
                        </button>
                    </div>
                </section>
            </t>
        </div>`;
    static components = { FolioView, PageHead };
    static props = ["*"];
    setup() {
        this.money = money;
        this.date = date;
        this.can = can;
        this.state = useState({ places: [], loading: true, folio: null });
        onWillStart(async () => { await loadCatalog(); await this.load(); });
        useInterval(() => { if (!this.state.folio) this.load().catch(() => {}); }, 30000);
    }
    get isRoom() { return this.props.kind === "room"; }
    get zones() {
        const map = new Map();
        for (const p of this.state.places) {
            const key = p.zone || (this.isRoom ? "Chambres" : "Salle");
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(p);
        }
        return [...map.entries()].map(([name, places]) => ({ name, places }));
    }
    get summary() {
        const busy = this.state.places.filter((p) => p.folio).length;
        const site = currentSite();
        return `${site ? site.name + " · " : ""}${busy} sur ${this.state.places.length} ${this.isRoom ? "occupée(s)" : "table(s) occupée(s)"}`;
    }
    hk(p) { return HK[p.housekeeping] || HK.clean; }
    placeClass(p) {
        if (p.folio) return "is-busy";
        if (this.isRoom && p.housekeeping !== "clean") return p.housekeeping === "dirty" ? "is-dirty" : "is-maint";
        return "is-free";
    }
    async load() {
        this.state.places = await api("places", { site_id: session.siteId, kind: this.props.kind });
        this.state.loading = false;
    }
    async open(p) {
        try {
            if (p.folio) {
                this.state.folio = await api("folio_get", { id: p.folio.id });
                return;
            }
            if (this.isRoom && p.housekeeping !== "clean") {
                const label = p.housekeeping === "dirty" ? "La chambre est-elle prête ?" : "Fin de la maintenance ?";
                if (await confirm(`Chambre ${p.name}`, label, { confirm: "Marquer prête" })) {
                    await api("housekeeping", { id: p.id, state: "clean" });
                    await this.load();
                }
                return;
            }
            const folio = await openDialog(this.isRoom ? CheckinDialog : TableOpenDialog, { place: p });
            if (folio) this.state.folio = folio;
        } catch (err) {
            notifyError(err);
        }
    }
    async back() {
        this.state.folio = null;
        await this.load();
    }
}
