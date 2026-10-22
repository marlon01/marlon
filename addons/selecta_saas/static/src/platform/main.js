/** @odoo-module */
/* Console de l'administration centrale SELECTA (/selecta/platform), réservée à l'opérateur de la plateforme. */
import { Component, mount, onWillStart, onWillUnmount, useState, whenReady, xml } from "@odoo/owl";
import { Icon, UiHost } from "@selecta_concours/common/ui";
import { readConfig } from "@selecta_concours/common/utils";
import { errMessage, FormDialogHost, papi, pstore, refreshPending } from "@selecta_saas/platform/papi";
import { OverviewPage } from "@selecta_saas/platform/page_overview";
import { TenantDetailPage, TenantsListPage } from "@selecta_saas/platform/page_tenants";
import { PaymentsPage } from "@selecta_saas/platform/page_payments";
import { PlansPage } from "@selecta_saas/platform/page_plans";
import { SettingsPage } from "@selecta_saas/platform/page_settings";

const NAV = [
    { key: "overview", label: "Vue d'ensemble", icon: "dashboard" },
    { key: "tenants", label: "Structures", icon: "building" },
    { key: "payments", label: "Paiements", icon: "wallet", counter: true },
    { key: "plans", label: "Catégories et tarifs", icon: "tag" },
    { key: "settings", label: "Paramètres", icon: "settings" },
];
const TITLES = {
    overview: "Vue d'ensemble",
    tenants: "Structures",
    payments: "Paiements",
    plans: "Catégories et tarifs",
    settings: "Paramètres",
};

function parseHash() {
    const h = (location.hash || "#/").replace(/^#\/?/, "");
    const [path, query] = h.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query || ""));
    return { name: parts[0] || "overview", id: parts[1] ? parseInt(parts[1]) : null, params };
}

class PlatformApp extends Component {
    static components = { Icon, UiHost, FormDialogHost, OverviewPage, TenantsListPage, TenantDetailPage, PaymentsPage, PlansPage, SettingsPage };
    static template = xml`
        <div t-if="state.fatal" class="pf-fatal">
            <div class="ad-panel">
                <h1>Administration centrale indisponible</h1>
                <p class="sl-muted" t-esc="state.fatal"/>
                <div class="sl-row"><a href="/selecta/platform" class="sl-btn sl-btn-primary">Recharger</a><a href="/selecta/logout" class="sl-btn">Se déconnecter</a></div>
            </div>
        </div>
        <div t-else="" class="ad-shell pf-shell" t-att-class="{'is-nav-open': state.navOpen}">
            <a href="#pf-main" class="pf-skip">Aller au contenu</a>
            <aside class="ad-nav" aria-label="Navigation de l'administration centrale">
                <div class="ad-brand pf-brand">
                    <div class="pf-seal" aria-hidden="true">S</div>
                    <div class="sl-grow">
                        <div class="ad-brand-name">SELECTA</div>
                        <div class="ad-brand-app"><t t-esc="session.platform_name or 'Naxoris'"/></div>
                    </div>
                    <span class="pf-marker">Plateforme</span>
                </div>
                <nav>
                    <a t-foreach="nav" t-as="item" t-key="item.key" t-att-href="'#/' + item.key" class="ad-nav-item"
                       t-att-class="{'is-active': state.route.name == item.key}" t-att-aria-current="state.route.name == item.key ? 'page' : false"
                       t-on-click="() => this.state.navOpen = false">
                        <Icon name="item.icon"/>
                        <span class="sl-grow" t-esc="item.label"/>
                        <span t-if="item.counter and store.pending" class="pf-nav-count" t-att-aria-label="store.pending + ' à valider'" t-esc="store.pending"/>
                    </a>
                </nav>
                <div class="pf-nav-foot">
                    <a href="/selecta/admin" class="ad-nav-item pf-console-link"><Icon name="'external'"/><span>Ma console</span></a>
                </div>
                <div class="ad-user">
                    <div class="ad-user-avatar pf-avatar" t-esc="initials"/>
                    <div class="sl-grow">
                        <div class="ad-user-name" t-esc="session.name"/>
                        <div class="ad-user-role">Administration centrale</div>
                    </div>
                    <a href="/selecta/logout" class="sl-btn sl-btn-ghost sl-btn-icon" title="Se déconnecter" aria-label="Se déconnecter"><Icon name="'logout'"/></a>
                </div>
            </aside>
            <div class="ad-nav-backdrop pf-backdrop" t-if="state.navOpen" t-on-click="() => this.state.navOpen = false"/>
            <main class="ad-main" id="pf-main" tabindex="-1">
                <div class="ad-mobilebar">
                    <button class="sl-btn sl-btn-ghost sl-btn-icon" t-on-click="() => this.state.navOpen = !this.state.navOpen" aria-label="Menu" t-att-aria-expanded="state.navOpen ? 'true' : 'false'"><Icon name="'menu'"/></button>
                    <strong>SELECTA</strong><span class="pf-marker pf-marker-light">Plateforme</span>
                </div>
                <t t-set="r" t-value="state.route"/>
                <OverviewPage t-if="r.name == 'overview'"/>
                <TenantDetailPage t-elif="r.name == 'tenants' and r.id" t-key="'t' + r.id" tenantId="r.id"/>
                <TenantsListPage t-elif="r.name == 'tenants'" t-key="'tl' + (r.params.state or '')" route="r"/>
                <PaymentsPage t-elif="r.name == 'payments'" t-key="'p' + (r.params.tab or '')" route="r"/>
                <PlansPage t-elif="r.name == 'plans'"/>
                <SettingsPage t-elif="r.name == 'settings'"/>
                <div t-else="" class="ad-page"><h1>Page introuvable</h1><p><a href="#/overview">Revenir à la vue d'ensemble</a></p></div>
            </main>
            <FormDialogHost/>
            <UiHost/>
        </div>`;
    static props = {};

    setup() {
        this.config = readConfig();
        this.state = useState({ route: parseHash(), navOpen: false, fatal: "" });
        this.store = useState(pstore);
        this.session = {};
        onWillStart(async () => {
            try {
                this.session = await papi("session_info");
                pstore.session = this.session;
                refreshPending();
            } catch (e) {
                this.state.fatal = errMessage(e);
            }
            this.updateTitle();
        });
        this.onHash = () => {
            this.state.route = parseHash();
            this.state.navOpen = false;
            this.updateTitle();
            window.scrollTo({ top: 0 });
        };
        window.addEventListener("hashchange", this.onHash);
        onWillUnmount(() => window.removeEventListener("hashchange", this.onHash));
    }
    get nav() {
        return NAV;
    }
    updateTitle() {
        const t = TITLES[this.state.route.name];
        document.title = t ? `${t} · SELECTA Plateforme` : "SELECTA Plateforme";
    }
    get initials() {
        return (this.session.name || "?")
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
    }
}

whenReady(() => {
    const root = document.getElementById("selecta-root");
    root.innerHTML = "";
    mount(PlatformApp, root, { dev: false, name: "SELECTA Plateforme", env: {} });
});
