/** @odoo-module */
import { Component, mount, onWillStart, useState, whenReady, xml } from "@odoo/owl";
import { Icon, UiHost, notifyError } from "@norma_facture/common/ui";
import { initials } from "@norma_facture/common/format";
import { can, currentSite, loadSession, route, session, setSite } from "@norma_facture/app/store";
import { DashboardPage, ReportsPage } from "@norma_facture/app/page_dashboard";
import { PosPage } from "@norma_facture/app/page_pos";
import { FolioPage } from "@norma_facture/app/page_folio";
import { EditorPage } from "@norma_facture/app/page_editor";
import { InvoiceDetail, InvoicesPage } from "@norma_facture/app/page_invoices";
import { CatalogPage, CustomersPage } from "@norma_facture/app/page_catalog";
import { AuditPage, SettingsPage } from "@norma_facture/app/page_settings";

/* Navigation : l'espace de vente dépend de la catégorie de l'entreprise. */
const SELL = {
    pos: [{ key: "sell", label: "Caisse", icon: "cart" }],
    hotel: [{ key: "rooms", label: "Chambres", icon: "bed" }, { key: "new", label: "Facture directe", icon: "file" }],
    restaurant: [{ key: "tables", label: "Salle", icon: "utensils" }, { key: "sell", label: "Vente au comptoir", icon: "cart" }],
    invoice: [{ key: "new", label: "Nouvelle facture", icon: "file" }, { key: "sell", label: "Vente au comptoir", icon: "cart" }],
};

class Welcome extends Component {
    static template = xml`
        <div class="nm-page nm-welcome">
            <h1>Bienvenue sur NORMA, <t t-esc="session.user.name.split(' ')[0]"/>.</h1>
            <p class="nm-muted">Le compte de <b t-esc="session.company.name"/> est prêt, avec un catalogue de départ adapté à votre activité (<t t-esc="session.category.name"/>). Vos factures sont en mode simulation tant que l'e-MCF de la DGI n'est pas relié.</p>
            <ol class="nm-checklist">
                <li><b>Vérifiez votre profil fiscal</b><span>NIF, RCCM, identification nationale, adresse et logo, imprimés sur chaque facture.</span><a class="nm-btn nm-btn-sm" href="#/settings?tab=company">Profil</a></li>
                <li><b>Adaptez le catalogue</b><span>Vos articles, prix TTC et groupes de taxation (B 16 %, Q 8 %, C 5 %, A exonéré…).</span><a class="nm-btn nm-btn-sm" href="#/catalog">Catalogue</a></li>
                <li><b>Ajoutez votre équipe</b><span>Caissiers, réceptionnistes, gestionnaires, chacun limité à ses établissements.</span><a class="nm-btn nm-btn-sm" href="#/settings?tab=users">Utilisateurs</a></li>
                <li><b>Reliez l'e-MCF de la DGI</b><span>Pour chaque établissement : adresse de l'API, ISF et jeton obtenus auprès de la DGI après homologation.</span><a class="nm-btn nm-btn-sm" href="#/settings?tab=sites">Établissements</a></li>
            </ol>
            <a class="nm-btn nm-btn-gold nm-btn-lg" t-att-href="'#/' + first">Faire une première vente de démonstration</a>
        </div>`;
    static props = ["*"];
    setup() { this.session = session; }
    get first() { return (SELL[session.category.workspace] || SELL.invoice)[0].key; }
}

class App extends Component {
    static template = xml`
        <div class="nm-shell" t-att-class="{'is-open': state.nav, 'is-focus': focusMode}">
            <aside class="nm-nav" aria-label="Navigation">
                <div class="nm-nav-brand">
                    <img t-att-src="session.company.logo" alt="" t-on-error="(ev) => ev.target.src = '/norma_facture/static/description/icon.png'"/>
                    <div class="nm-grow"><b t-esc="session.company.name"/><small t-esc="session.category.name"/></div>
                </div>
                <label t-if="session.sites.length > 1" class="nm-nav-site">
                    <span>Établissement</span>
                    <select t-on-change="(ev) => this.changeSite(ev.target.value)">
                        <option t-foreach="session.sites" t-as="s" t-key="s.id" t-att-value="s.id" t-att-selected="s.id === session.siteId"><t t-esc="s.code"/> — <t t-esc="s.name"/></option>
                    </select>
                </label>
                <div t-else="" class="nm-nav-site is-single"><span>Établissement</span><b t-esc="site ? site.code + ' — ' + site.name : 'Aucun'"/></div>
                <nav>
                    <t t-foreach="nav" t-as="group" t-key="group_index">
                        <div class="nm-nav-group">
                            <a t-foreach="group" t-as="item" t-key="item.key" t-att-href="'#/' + item.key" class="nm-nav-item"
                               t-att-class="{'is-on': route.name === item.key}" t-att-aria-current="route.name === item.key ? 'page' : false" t-on-click="() => this.state.nav = false">
                                <Icon name="item.icon"/><span t-esc="item.label"/>
                            </a>
                        </div>
                    </t>
                </nav>
                <div class="nm-nav-user">
                    <span class="nm-avatar" t-esc="initials(session.user.name)"/>
                    <div class="nm-grow"><b t-esc="session.user.name"/><small t-esc="session.user.role_label"/></div>
                    <a href="/norma/logout" class="nm-btn nm-btn-ghost nm-btn-icon" title="Se déconnecter" aria-label="Se déconnecter"><Icon name="'logout'"/></a>
                </div>
            </aside>
            <div class="nm-main">
                <div class="nm-mobilebar">
                    <button class="nm-btn nm-btn-ghost nm-btn-icon" aria-label="Menu" t-on-click="() => this.state.nav = !this.state.nav"><Icon name="'menu'"/></button>
                    <b t-esc="session.company.name"/>
                </div>
                <t t-set="r" t-value="route"/>
                <Welcome t-if="r.name === 'welcome'"/>
                <PosPage t-elif="r.name === 'sell'" t-key="'pos' + session.siteId"/>
                <FolioPage t-elif="r.name === 'rooms'" kind="'room'" t-key="'rooms' + session.siteId"/>
                <FolioPage t-elif="r.name === 'tables'" kind="'table'" t-key="'tables' + session.siteId"/>
                <EditorPage t-elif="r.name === 'new'" t-key="'new' + session.siteId"/>
                <InvoiceDetail t-elif="r.name === 'invoices' and r.id" id="r.id"/>
                <InvoicesPage t-elif="r.name === 'invoices'" params="r.params" t-key="'inv' + (r.params.state or '')"/>
                <CustomersPage t-elif="r.name === 'customers'"/>
                <CatalogPage t-elif="r.name === 'catalog' and can('manager')" params="r.params"/>
                <ReportsPage t-elif="r.name === 'reports' and can('manager')"/>
                <AuditPage t-elif="r.name === 'audit' and can('manager')"/>
                <SettingsPage t-elif="r.name === 'settings'" params="r.params" t-key="'set' + (r.params.tab or '')"/>
                <DashboardPage t-else=""/>
            </div>
            <UiHost/>
        </div>`;
    static components = { Icon, UiHost, Welcome, DashboardPage, PosPage, FolioPage, EditorPage, InvoiceDetail, InvoicesPage,
        CustomersPage, CatalogPage, ReportsPage, AuditPage, SettingsPage };
    static props = {};
    setup() {
        this.session = useState(session);
        this.route = useState(route);
        this.state = useState({ nav: false });
        this.initials = initials;
        this.can = can;
    }
    get site() { return currentSite(); }
    get focusMode() { return ["sell"].includes(this.route.name); }
    get nav() {
        const sell = SELL[session.category.workspace] || SELL.invoice;
        const main = [{ key: "home", label: "Tableau de bord", icon: "home" }, ...sell,
            { key: "invoices", label: "Factures", icon: "receipt" }, { key: "customers", label: "Clients", icon: "users" }];
        const manage = [];
        if (can("manager")) {
            manage.push({ key: "catalog", label: "Catalogue", icon: "box" }, { key: "reports", label: "Rapports fiscaux", icon: "chart" },
                { key: "audit", label: "Intégrité", icon: "shield" });
        }
        manage.push({ key: "settings", label: "Paramètres", icon: "settings" });
        return [main, manage];
    }
    changeSite(id) { setSite(parseInt(id)); }
}

whenReady(async () => {
    const root = document.getElementById("norma-root");
    try {
        await loadSession();
    } catch (err) {
        root.textContent = err.message || "Impossible de charger votre espace.";
        notifyError(err);
        return;
    }
    root.replaceChildren();
    document.documentElement.style.setProperty("--brand", session.company.color || "#0E4D64");
    mount(App, root, { dev: false });
});
