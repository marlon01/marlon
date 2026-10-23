/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";
import { BusyButton, confirm, Dialog, Icon, notify, notifyError, openDialog } from "@norma_facture/common/ui";
import { money } from "@norma_facture/common/format";
import { can, session } from "@norma_facture/app/store";
import { CustomerForm, PageHead } from "@norma_facture/app/components";

const KINDS = { goods: "Article", room: "Nuitée", dish: "Plat / boisson", service: "Prestation" };

class ProductForm extends Component {
    static template = xml`
        <Dialog title="state.f.id ? 'Modifier l’article' : 'Nouvel article'" onClose="() => props.close(null)">
            <div class="nm-grid-2">
                <label class="nm-field nm-span-2"><span>Désignation</span><input class="nm-input" t-model="state.f.name" maxlength="120"/></label>
                <label class="nm-field"><span>Prix unitaire TTC (<t t-esc="session.company.currency"/>)</span><input class="nm-input nm-num" type="number" min="0" step="0.01" t-model.number="state.f.price"/></label>
                <label class="nm-field"><span>Groupe de taxation DGI</span>
                    <select class="nm-select" t-model="state.f.tax_group">
                        <option t-foreach="session.tax_groups" t-as="g" t-key="g.code" t-att-value="g.code"><t t-esc="g.code"/> — <t t-esc="g.name"/> (<t t-esc="g.rate"/> %)</option>
                    </select></label>
                <label class="nm-field"><span>Nature (DGI)</span>
                    <select class="nm-select" t-model="state.f.item_type">
                        <option t-foreach="session.item_types" t-as="t" t-key="t.code" t-att-value="t.code"><t t-esc="t.code"/> — <t t-esc="t.label"/></option>
                    </select></label>
                <label class="nm-field"><span>Usage</span>
                    <select class="nm-select" t-model="state.f.kind">
                        <option t-foreach="kinds" t-as="k" t-key="k" t-att-value="k" t-esc="kinds[k]"/>
                    </select></label>
                <label class="nm-field"><span>Rayon</span>
                    <select class="nm-select" t-model="state.f.category_id">
                        <option value="">Sans rayon</option>
                        <option t-foreach="props.categories" t-as="c" t-key="c.id" t-att-value="c.id" t-esc="c.name"/>
                    </select></label>
                <label class="nm-field"><span>Unité</span><input class="nm-input" t-model="state.f.unit" maxlength="12"/></label>
                <label class="nm-field"><span>Code-barres</span><input class="nm-input" t-model="state.f.barcode" maxlength="40"/></label>
                <label class="nm-field"><span>Référence interne</span><input class="nm-input" t-model="state.f.code" maxlength="40"/></label>
                <label class="nm-field"><span>Taxe spécifique par unité (HT)</span><input class="nm-input nm-num" type="number" min="0" step="0.01" t-model.number="state.f.specific_tax"/><small>Droits d'accises ou taxe spécifique ; elle entre dans la base de TVA.</small></label>
                <label class="nm-check nm-span-2"><input type="checkbox" t-model="state.f.active"/><span>Article en vente</span></label>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" onClick.bind="save">Enregistrer l'article</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() {
        this.session = session;
        this.kinds = KINDS;
        this.state = useState({ f: Object.assign({ name: "", price: 0, tax_group: "B", item_type: "BIE", kind: "goods", category_id: "",
            unit: "u", barcode: "", code: "", specific_tax: 0, active: true }, this.props.product || {}) });
    }
    async save() {
        const f = this.state.f;
        const res = await api("product_save", { ...f, category_id: f.category_id ? parseInt(f.category_id) : null });
        notify("Article enregistré.", "ok");
        this.props.close(res);
    }
}

class PlaceForm extends Component {
    static template = xml`
        <Dialog title="(state.f.id ? 'Modifier ' : 'Ajouter ') + (props.kind === 'room' ? 'une chambre' : 'une table')" onClose="() => props.close(null)">
            <div class="nm-grid-2">
                <label class="nm-field"><span t-esc="props.kind === 'room' ? 'Numéro de chambre' : 'Nom de la table'"/><input class="nm-input" t-model="state.f.name" maxlength="30"/></label>
                <label class="nm-field"><span t-esc="props.kind === 'room' ? 'Étage' : 'Salle / zone'"/><input class="nm-input" t-model="state.f.zone" maxlength="40"/></label>
                <label class="nm-field"><span>Capacité</span><input class="nm-input" type="number" min="1" t-model.number="state.f.capacity"/></label>
                <label t-if="props.kind === 'room'" class="nm-field"><span>Tarif de la nuitée</span>
                    <select class="nm-select" t-model="state.f.rate_product_id">
                        <option value="">Choisir…</option>
                        <option t-foreach="rates" t-as="p" t-key="p.id" t-att-value="p.id"><t t-esc="p.name"/> — <t t-esc="money(p.price)"/></option>
                    </select></label>
                <label class="nm-check nm-span-2"><input type="checkbox" t-model="state.f.active"/><span>En service</span></label>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" onClick.bind="save">Enregistrer</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() {
        this.money = money;
        this.rates = this.props.products.filter((p) => p.kind === "room" && p.active);
        this.state = useState({ f: Object.assign({ name: "", zone: "", capacity: 2, rate_product_id: "", active: true }, this.props.place || {}) });
    }
    async save() {
        const f = this.state.f;
        const res = await api("place_save", { id: f.id || null, site_id: session.siteId, kind: this.props.kind, name: f.name, zone: f.zone,
            capacity: f.capacity, active: f.active, rate_product_id: f.rate_product_id ? parseInt(f.rate_product_id) : null });
        this.props.close(res);
    }
}

export class CatalogPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Catalogue'" subtitle="'Articles, prix TTC et groupes de taxation transmis à la DGI.'">
                <div class="nm-seg">
                    <button t-att-class="{'is-on': state.tab === 'products'}" t-on-click="() => this.state.tab = 'products'">Articles</button>
                    <button t-att-class="{'is-on': state.tab === 'categories'}" t-on-click="() => this.state.tab = 'categories'">Rayons</button>
                    <button t-if="hasPlaces" t-att-class="{'is-on': state.tab === 'places'}" t-on-click="openPlaces" t-esc="placeKind === 'room' ? 'Chambres' : 'Tables'"/>
                </div>
            </PageHead>

            <t t-if="state.tab === 'products'">
                <div class="nm-filters">
                    <input class="nm-input" style="max-width:320px" placeholder="Rechercher un article" t-model="state.q"/>
                    <label class="nm-check"><input type="checkbox" t-model="state.archived"/><span>Afficher les articles retirés</span></label>
                    <div class="nm-grow"/>
                    <button class="nm-btn nm-btn-primary" t-on-click="() => this.edit()"><Icon name="'plus'"/> Nouvel article</button>
                </div>
                <div class="nm-panel nm-table-wrap">
                    <table class="nm-table">
                        <thead><tr><th>Désignation</th><th>Rayon</th><th>Usage</th><th>Gr.</th><th>Nature</th><th>Code-barres</th><th class="nm-right">Prix TTC</th></tr></thead>
                        <tbody>
                            <tr t-foreach="products" t-as="p" t-key="p.id" class="is-click" t-att-style="p.active ? '' : 'opacity:.55'" t-on-click="() => this.edit(p)">
                                <td><b t-esc="p.name"/><div t-if="p.specific_tax" class="nm-muted" style="font-size:12px">Taxe spécifique <t t-esc="money(p.specific_tax)"/></div></td>
                                <td t-esc="p.category"/><td t-esc="kinds[p.kind]"/><td><span class="nm-group" t-esc="p.tax_group"/></td>
                                <td t-esc="p.item_type"/><td class="nm-mono" t-esc="p.barcode"/>
                                <td class="nm-right nm-num" t-esc="money(p.price, session.company.currency)"/>
                            </tr>
                        </tbody>
                    </table>
                    <div t-if="!products.length" class="nm-empty"><h3>Aucun article</h3><p>Créez votre premier article pour commencer à facturer.</p></div>
                </div>
            </t>

            <t t-if="state.tab === 'categories'">
                <div class="nm-panel nm-panel-body nm-stack" style="max-width:640px">
                    <div t-foreach="state.categories" t-as="c" t-key="c.id" class="nm-row">
                        <input type="color" t-att-value="c.color" t-on-change="(ev) => this.saveCat(c, {color: ev.target.value})" aria-label="Couleur"/>
                        <input class="nm-input" t-att-value="c.name" t-on-change="(ev) => this.saveCat(c, {name: ev.target.value})"/>
                        <button class="nm-btn nm-btn-ghost nm-btn-icon" t-on-click="() => this.deleteCat(c)" aria-label="Supprimer le rayon"><Icon name="'trash'"/></button>
                    </div>
                    <div class="nm-row"><input class="nm-input" placeholder="Nouveau rayon" t-model="state.newCat" t-on-keydown="(ev) => ev.key === 'Enter' and this.addCat()"/><button class="nm-btn" t-on-click="addCat"><Icon name="'plus'"/> Ajouter</button></div>
                </div>
            </t>

            <t t-if="state.tab === 'places'">
                <div class="nm-filters"><span class="nm-muted">Établissement : <b t-esc="siteName"/></span><div class="nm-grow"/>
                    <button class="nm-btn nm-btn-primary" t-on-click="() => this.editPlace()"><Icon name="'plus'"/> <t t-esc="placeKind === 'room' ? 'Ajouter une chambre' : 'Ajouter une table'"/></button></div>
                <div class="nm-panel nm-table-wrap">
                    <table class="nm-table">
                        <thead><tr><th>Nom</th><th>Zone</th><th>Capacité</th><th t-if="placeKind === 'room'">Tarif</th><th>État</th></tr></thead>
                        <tbody><tr t-foreach="state.places" t-as="p" t-key="p.id" class="is-click" t-on-click="() => this.editPlace(p)">
                            <td><b t-esc="p.name"/></td><td t-esc="p.zone"/><td t-esc="p.capacity"/><td t-if="placeKind === 'room'" class="nm-num" t-esc="money(p.rate)"/>
                            <td><span class="nm-tag" t-att-class="p.folio ? 'nm-tag-info' : 'nm-tag-ok'" t-esc="p.folio ? 'Occupée' : 'Libre'"/></td>
                        </tr></tbody>
                    </table>
                </div>
            </t>
        </div>`;
    static components = { PageHead, Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.kinds = KINDS;
        this.session = session;
        this.state = useState({ tab: this.props.params.tab || "products", q: "", archived: false, items: [], categories: [], places: [], newCat: "" });
        onWillStart(async () => {
            await this.load();
            if (this.state.tab === "places") await this.loadPlaces();
        });
    }
    get hasPlaces() { return ["hotel", "restaurant"].includes(session.category.workspace); }
    get placeKind() { return session.category.workspace === "hotel" ? "room" : "table"; }
    get siteName() { const s = session.sites.find((x) => x.id === session.siteId); return s ? s.name : ""; }
    get products() {
        const q = this.state.q.trim().toLowerCase();
        return this.state.items.filter((p) => (this.state.archived || p.active) && (!q || p.name.toLowerCase().includes(q) || p.barcode.includes(q)));
    }
    async load() {
        const [items, cat] = await Promise.all([api("products_all"), api("catalog")]);
        this.state.items = items;
        this.state.categories = cat.categories;
    }
    async loadPlaces() { this.state.places = await api("places", { site_id: session.siteId, kind: this.placeKind }); }
    async openPlaces() { this.state.tab = "places"; await this.loadPlaces(); }
    async edit(p) {
        const res = await openDialog(ProductForm, { product: p ? { ...p, category_id: p.category_id || "" } : null, categories: this.state.categories });
        if (res) await this.load();
    }
    async editPlace(p) {
        const res = await openDialog(PlaceForm, { place: p ? { ...p, rate_product_id: p.rate_product_id || "" } : null, kind: this.placeKind, products: this.state.items });
        if (res) await this.loadPlaces();
    }
    async addCat() {
        if (!this.state.newCat.trim()) return;
        try { await api("category_save", { name: this.state.newCat, color: "#0E4D64" }); this.state.newCat = ""; await this.load(); } catch (err) { notifyError(err); }
    }
    async saveCat(c, vals) {
        try { await api("category_save", { id: c.id, name: vals.name || c.name, color: vals.color || c.color }); await this.load(); } catch (err) { notifyError(err); }
    }
    async deleteCat(c) {
        if (await confirm("Supprimer le rayon", `Les articles du rayon « ${c.name} » resteront, sans rayon.`, { danger: true, confirm: "Supprimer" })) {
            await api("category_delete", { id: c.id });
            await this.load();
        }
    }
}

export class CustomersPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Clients'" subtitle="'Identification transmise à la DGI : type de client, NIF, adresse.'">
                <button class="nm-btn nm-btn-primary" t-on-click="() => this.edit()"><Icon name="'plus'"/> Nouveau client</button>
            </PageHead>
            <div class="nm-filters"><input class="nm-input" style="max-width:320px" placeholder="Nom, NIF, téléphone, e-mail" t-model="state.q" t-on-input="debounce"/></div>
            <div class="nm-panel nm-table-wrap">
                <table class="nm-table">
                    <thead><tr><th>Nom</th><th>Type</th><th>NIF</th><th>Téléphone</th><th>E-mail</th><th>Adresse</th></tr></thead>
                    <tbody><tr t-foreach="state.items" t-as="c" t-key="c.id" class="is-click" t-on-click="() => this.edit(c)">
                        <td><b t-esc="c.name"/></td><td><span class="nm-tag nm-tag-plain nm-tag-info" t-esc="c.client_type"/></td><td class="nm-mono" t-esc="c.nif"/>
                        <td t-esc="c.phone"/><td t-esc="c.email"/><td t-esc="c.address"/>
                    </tr></tbody>
                </table>
                <div t-if="!state.items.length" class="nm-empty"><h3>Aucun client</h3><p>Les clients enregistrés à la caisse, à la réception ou sur une facture apparaissent ici.</p></div>
            </div>
        </div>`;
    static components = { PageHead, Icon };
    static props = ["*"];
    setup() {
        this.state = useState({ q: "", items: [] });
        onWillStart(() => this.load());
    }
    async load() { this.state.items = await api("customers", { search: this.state.q, limit: 200 }); }
    debounce() { clearTimeout(this.t); this.t = setTimeout(() => this.load().catch(notifyError), 250); }
    async edit(c) {
        const res = await openDialog(CustomerForm, { customer: c ? { ...c } : null, guest: session.category.workspace === "hotel" });
        if (res) await this.load();
    }
}
