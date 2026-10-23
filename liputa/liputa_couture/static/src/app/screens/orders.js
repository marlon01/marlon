/** @odoo-module **/
import { onWillStart, useState, xml } from "@odoo/owl";
import { api, store } from "../core/api";
import { Base, Empty, Icon, Skeleton, Tape } from "../core/ui";
import { go } from "../core/router";
import { relative, shortDate } from "../core/format";

export class OrdersScreen extends Base {
    static template = xml`
    <div class="lp-screen">
        <header class="lp-head"><h1 class="lp-title" t-esc="t('Orders')"/></header>
        <div class="lp-search">
            <Icon name="'search'" size="20"/>
            <input class="lp-input" type="search" enterkeyhint="search" t-att-placeholder="t('Search a client, a model, a reference')"
                   t-on-input="onSearch" t-att-value="state.search"/>
        </div>
        <div class="lp-chips" role="tablist">
            <button t-foreach="filters" t-as="f" t-key="f.key" role="tab" t-att-aria-selected="state.filter === f.key"
                    t-attf-class="lp-chip #{state.filter === f.key ? 'lp-on' : ''} #{f.key === 'late' ? 'lp-alert' : ''}"
                    t-on-click="() => this.setFilter(f.key)">
                <t t-esc="f.label"/><b t-if="f.count !== undefined" t-esc="f.count"/>
            </button>
        </div>
        <Skeleton t-if="state.loading and !state.orders.length" count="6" height="76"/>
        <div t-elif="!state.orders.length" class="lp-sheet">
            <Empty title="t('No order here')" text="t('Orders you take appear in this list.')">
                <button class="lp-btn lp-btn-tape" t-on-click="() => this.go('/new')"><Icon name="'plus'" size="20"/><t t-esc="t('Take an order')"/></button>
            </Empty>
        </div>
        <div t-else="" class="lp-sheet">
            <ul class="lp-list">
                <li t-foreach="state.orders" t-as="o" t-key="o.id">
                    <a class="lp-row" t-attf-href="#/order/#{o.id}">
                        <img class="lp-thumb" t-att-src="'/web/image/liputa.garment.model/' + o.model_id + '/image_256'" alt="" loading="lazy"/>
                        <div class="lp-row-main">
                            <div class="lp-row-title" t-esc="o.client"/>
                            <div class="lp-row-sub" t-esc="o.model"/>
                            <div class="lp-row-sub"><t t-esc="o.stage"/><t t-if="o.event"> · <t t-esc="o.event"/></t></div>
                        </div>
                        <div class="lp-row-side">
                            <span t-if="o.stage_code === 'ready'" class="lp-pill lp-on_track" t-esc="t('Ready')"/>
                            <span t-else="" t-attf-class="lp-due lp-#{o.health}" t-esc="relative(o.promised)"/>
                            <span class="lp-small lp-muted lp-num" t-esc="shortDate(o.promised)"/>
                            <div style="width: 68px"><Tape value="o.progress" health="o.health" small="true"/></div>
                        </div>
                    </a>
                </li>
            </ul>
        </div>
    </div>`;
    static components = { Icon, Tape, Empty, Skeleton };
    static props = {};

    setup() {
        this.store = useState(store);
        this.state = useState({ filter: store.route.query.filter || "open", search: "", orders: [], counts: {}, loading: true });
        this.go = go;
        this.relative = relative;
        this.shortDate = shortDate;
        onWillStart(() => this.load());
    }
    get filters() {
        const c = this.state.counts;
        return [
            { key: "open", label: this.t("In progress"), count: c.open },
            { key: "late", label: this.t("To watch "), count: c.late },
            { key: "ready", label: this.t("Ready"), count: c.ready },
            { key: "all", label: this.t("All") },
        ];
    }
    async load() {
        this.state.loading = true;
        const res = await api.orders({ filter: this.state.filter, search: this.state.search });
        this.state.orders = res.orders;
        this.state.counts = res.counts;
        this.state.loading = false;
    }
    setFilter(key) {
        this.state.filter = key;
        this.load();
    }
    onSearch(ev) {
        this.state.search = ev.target.value;
        clearTimeout(this._t);
        this._t = setTimeout(() => this.load(), 250);
    }
}
