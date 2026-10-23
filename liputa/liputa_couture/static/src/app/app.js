/** @odoo-module **/
import { useState, xml } from "@odoo/owl";
import { store } from "./core/api";
import { Base, Icon } from "./core/ui";
import { TOP_LEVEL, go } from "./core/router";
import { HomeScreen } from "./screens/home";
import { OrdersScreen } from "./screens/orders";
import { FittingScreen, MeasuresScreen, OrderScreen, PatternScreen } from "./screens/order";
import { WizardScreen } from "./screens/wizard";
import { AccountScreen, CatalogueScreen, PlanningScreen } from "./screens/misc";

const SCREENS = {
    home: HomeScreen, orders: OrdersScreen, order: OrderScreen, fitting: FittingScreen, pattern: PatternScreen,
    measures: MeasuresScreen, new: WizardScreen, catalogue: CatalogueScreen, planning: PlanningScreen, account: AccountScreen,
};

export class LiputaApp extends Base {
    static template = xml`
    <div class="lp-app">
        <main>
            <t t-component="screen" t-props="screenProps" t-key="routeKey"/>
        </main>
        <nav t-if="showTabbar" class="lp-tabbar" t-att-aria-label="t('Home')">
            <a t-foreach="tabsLeft" t-as="tab" t-key="tab.name" t-attf-class="lp-tab #{route.name === tab.name ? 'lp-on' : ''}"
               t-attf-href="#/#{tab.name}" t-att-aria-current="route.name === tab.name ? 'page' : null">
                <Icon name="tab.icon"/><span t-esc="t(tab.label)"/>
            </a>
            <button class="lp-tab-new" t-on-click="() => this.go('/new')" t-att-aria-label="t('New order')"><Icon name="'plus'" size="28" stroke="2.4"/></button>
            <a t-foreach="tabsRight" t-as="tab" t-key="tab.name" t-attf-class="lp-tab #{route.name === tab.name ? 'lp-on' : ''}"
               t-attf-href="#/#{tab.name}" t-att-aria-current="route.name === tab.name ? 'page' : null">
                <Icon name="tab.icon"/><span t-esc="t(tab.label)"/>
            </a>
        </nav>
        <div t-if="store.toast" t-attf-class="lp-toast #{store.toast.kind === 'error' ? 'lp-error' : ''}" role="status" aria-live="polite">
            <Icon name="store.toast.kind === 'error' ? 'alert' : 'check'" size="20"/><span t-esc="store.toast.message"/>
        </div>
    </div>`;
    static components = { Icon };
    static props = {};

    setup() {
        this.store = useState(store);
        this.go = go;
        this.tabsLeft = [{ name: "home", icon: "home", label: "Home" }, { name: "orders", icon: "orders", label: "Orders" }];
        this.tabsRight = [{ name: "planning", icon: "calendar", label: "Planning" }, { name: "catalogue", icon: "hanger", label: "Catalogue" }];
    }
    get route() {
        return this.store.route;
    }
    get screen() {
        return SCREENS[this.route.name] || HomeScreen;
    }
    get screenProps() {
        return this.route.params.id ? { id: this.route.params.id } : {};
    }
    get routeKey() {
        return `${this.route.name}-${this.route.params.id || ""}-${JSON.stringify(this.route.query)}`;
    }
    get showTabbar() {
        return TOP_LEVEL.includes(this.route.name);
    }
}
