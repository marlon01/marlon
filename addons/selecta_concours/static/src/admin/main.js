/** @odoo-module */
import { Component, mount, onWillStart, onWillUnmount, useState, whenReady, xml } from "@odoo/owl";
import { extensions, store } from "@selecta_concours/admin/store";
import { api } from "@selecta_concours/common/rpc";
import { Icon, UiHost } from "@selecta_concours/common/ui";
import { readConfig } from "@selecta_concours/common/utils";
import { DashboardPage } from "@selecta_concours/admin/page_dashboard";
import { ConcoursListPage, ConcoursEditPage } from "@selecta_concours/admin/page_concours";
import { QuestionBankPage } from "@selecta_concours/admin/page_questions";
import { MonitorPage } from "@selecta_concours/admin/page_monitor";
import { ResultsPage } from "@selecta_concours/admin/page_results";
import { AnalysisPage } from "@selecta_concours/admin/page_analysis";
import { AuditPage, SettingsPage, StaffPage } from "@selecta_concours/admin/page_admin";

const NAV = [
    { key: "dashboard", label: "Tableau de bord", icon: "dashboard", roles: ["admin", "concepteur", "jury", "surveillant"], sequence: 10 },
    { key: "concours", label: "Concours", icon: "trophy", roles: ["admin", "concepteur", "jury", "surveillant"], sequence: 20 },
    { key: "questions", label: "Banque de questions", icon: "book", roles: ["admin", "concepteur", "jury"], sequence: 30 },
    { key: "monitor", label: "Surveillance en direct", icon: "eye", roles: ["admin", "jury", "surveillant"], sequence: 40 },
    { key: "results", label: "Résultats", icon: "chart", roles: ["admin", "jury"], sequence: 50 },
    { key: "analysis", label: "Analyse IA", icon: "brain", roles: ["admin", "jury"], sequence: 60 },
    { key: "audit", label: "Journal d'audit", icon: "shield", roles: ["admin", "jury"], sequence: 70 },
    { key: "staff", label: "Personnel et accès", icon: "users", roles: ["admin"], sequence: 80 },
    { key: "settings", label: "Paramètres", icon: "settings", roles: ["admin"], sequence: 90 },
];

function parseHash() {
    const h = (location.hash || "#/").replace(/^#\/?/, "");
    const [path, query] = h.split("?");
    const parts = path.split("/").filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query || ""));
    return { name: parts[0] || "dashboard", id: parts[1] ? parseInt(parts[1]) : null, params };
}

class AdminApp extends Component {
    static components = {
        Icon, UiHost, DashboardPage, ConcoursListPage, ConcoursEditPage, QuestionBankPage, MonitorPage,
        ResultsPage, AnalysisPage, AuditPage, StaffPage, SettingsPage,
    };
    static template = xml`
        <div class="ad-shell" t-att-class="{'is-nav-open': state.navOpen}">
            <aside class="ad-nav">
                <div class="ad-brand">
                    <img t-att-src="session.company.logo" alt="" t-on-error="(ev) => ev.target.style.visibility='hidden'"/>
                    <div class="sl-grow">
                        <div class="ad-brand-name" t-esc="session.company.name"/>
                        <div class="ad-brand-app">SELECTA by Naxoris</div>
                    </div>
                </div>
                <nav>
                    <t t-foreach="nav" t-as="item" t-key="item.key">
                        <a t-att-href="item.href or ('#/' + item.key)" class="ad-nav-item" t-att-class="{'is-active': isActive(item.key)}" t-on-click="() => this.state.navOpen = false">
                            <Icon name="item.icon"/>
                            <span t-esc="item.label"/>
                        </a>
                    </t>
                </nav>
                <div class="ad-user">
                    <div class="ad-user-avatar" t-esc="initials"/>
                    <div class="sl-grow">
                        <div class="ad-user-name" t-esc="session.name"/>
                        <div class="ad-user-role" t-esc="roleLabel"/>
                    </div>
                    <div class="sl-lang-switch sl-lang-dark" role="group" aria-label="Langue / Language" data-no-i18n=""><button type="button" data-selecta-lang="fr" lang="fr">FR</button><button type="button" data-selecta-lang="en" lang="en">EN</button></div>
                    <a href="/selecta/logout" class="sl-btn sl-btn-ghost sl-btn-icon" title="Se déconnecter" aria-label="Se déconnecter"><Icon name="'logout'"/></a>
                </div>
            </aside>
            <div class="ad-main">
                <div class="ad-mobilebar">
                    <button class="sl-btn sl-btn-ghost sl-btn-icon" t-on-click="() => this.state.navOpen = !this.state.navOpen" aria-label="Menu"><Icon name="'menu'"/></button>
                    <strong>SELECTA</strong>
                </div>
                <t t-foreach="banners" t-as="Banner" t-key="Banner_index"><t t-component="Banner"/></t>
                <t t-set="r" t-value="state.route"/>
                <t t-if="extensionPage" t-component="extensionPage" t-key="'x' + r.name + (r.id or 0)" route="r"/>
                <DashboardPage t-elif="r.name == 'dashboard'"/>
                <ConcoursEditPage t-elif="r.name == 'concours' and r.id" t-key="'c' + r.id" concoursId="r.id" tab="r.params.tab or 'general'"/>
                <ConcoursEditPage t-elif="r.name == 'concours' and r.params.new" t-key="'cnew'" concoursId="0" tab="'general'"/>
                <ConcoursListPage t-elif="r.name == 'concours'"/>
                <QuestionBankPage t-elif="r.name == 'questions'"/>
                <MonitorPage t-elif="r.name == 'monitor'" t-key="'m' + (r.id or 0)" concoursId="r.id or 0"/>
                <ResultsPage t-elif="r.name == 'results'" t-key="'r' + (r.id or 0)" concoursId="r.id or 0"/>
                <AnalysisPage t-elif="r.name == 'analysis'" t-key="'a' + (r.id or 0)" concoursId="r.id or 0"/>
                <AuditPage t-elif="r.name == 'audit'"/>
                <StaffPage t-elif="r.name == 'staff'"/>
                <SettingsPage t-elif="r.name == 'settings'"/>
                <div t-else="" class="ad-page"><h1>Page introuvable</h1></div>
            </div>
            <UiHost/>
        </div>`;
    static props = {};

    setup() {
        this.config = readConfig();
        this.state = useState({ route: parseHash(), navOpen: false });
        this.session = null;
        store.config = this.config;
        onWillStart(async () => {
            this.session = await api("session_info");
            store.session = this.session;
            document.documentElement.style.setProperty("--brand", this.session.company.color);
        });
        this.onHash = () => {
            this.state.route = parseHash();
            window.scrollTo({ top: 0 });
        };
        window.addEventListener("hashchange", this.onHash);
        onWillUnmount(() => window.removeEventListener("hashchange", this.onHash));
    }
    get nav() {
        const roles = this.session.roles;
        return [...NAV, ...extensions.nav]
            .filter((n) => n.roles.some((r) => roles[r]) && (!n.visible || n.visible(this.session)))
            .sort((a, b) => (a.sequence || 100) - (b.sequence || 100));
    }
    get banners() {
        return extensions.banners;
    }
    get extensionPage() {
        return extensions.pages[this.state.route.name] || null;
    }
    isActive(key) {
        return this.state.route.name === key;
    }
    get initials() {
        return (this.session.name || "?")
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
    }
    get roleLabel() {
        const r = this.session.roles;
        return r.admin ? "Administrateur" : r.jury ? "Jury" : r.concepteur ? "Concepteur" : "Surveillant";
    }
}

whenReady(() => {
    const root = document.getElementById("selecta-root");
    root.innerHTML = "";
    mount(AdminApp, root, { dev: false, name: "SELECTA Console", env: {} });
});
