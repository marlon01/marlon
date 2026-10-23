/** @odoo-module **/
import { onWillStart, useState, xml } from "@odoo/owl";
import { api, store, toast } from "../core/api";
import { Base, BottomSheet, Empty, Icon, Skeleton, Tape, TopBar } from "../core/ui";
import { go } from "../core/router";
import { money, num, parseDate, today } from "../core/format";
import { getLang } from "../core/i18n";

// ============================================================== catalogue
export class CatalogueScreen extends Base {
    static template = xml`
    <div class="lp-screen">
        <header class="lp-head"><h1 class="lp-title" t-esc="t('Catalogue')"/></header>
        <div class="lp-seg">
            <button t-att-class="state.scope === 'library' ? 'lp-on' : ''" t-on-click="() => this.set('scope', 'library')" t-esc="t('Library')"/>
            <button t-att-class="state.scope === 'mine' ? 'lp-on' : ''" t-on-click="() => this.set('scope', 'mine')" t-esc="t('My workshop')"/>
        </div>
        <div class="lp-search">
            <Icon name="'search'" size="20"/>
            <input class="lp-input" type="search" t-att-placeholder="t('Search a model')" t-on-input="onSearch"/>
        </div>
        <div class="lp-chips">
            <button t-foreach="genders" t-as="g" t-key="g[0]" t-attf-class="lp-chip #{state.gender === g[0] ? 'lp-on' : ''}"
                    t-on-click="() => this.set('gender', g[0])" t-esc="t(g[1])"/>
            <button t-foreach="state.events" t-as="e" t-key="e.id" t-attf-class="lp-chip #{state.event === e.id ? 'lp-on' : ''}"
                    t-on-click="() => this.set('event', state.event === e.id ? null : e.id)" t-esc="e.name"/>
        </div>
        <Skeleton t-if="state.loading" count="4" height="220"/>
        <div t-elif="!state.models.length" class="lp-sheet"><Empty icon="'hanger'" title="t('No model found')" text="t('Change the filters or add your own model.')"/></div>
        <div t-else="" class="lp-model-grid">
            <button t-foreach="state.models" t-as="m" t-key="m.id" class="lp-model" t-on-click="() => state.open = m">
                <div class="lp-model-top">
                    <img t-att-src="'/web/image/liputa.garment.model/' + m.id + '/image_512'" alt="" loading="lazy"/>
                    <span t-if="!m.is_library" class="lp-pill lp-tape" t-esc="t('My workshop')"/>
                </div>
                <div class="lp-model-body">
                    <span class="lp-model-name" t-esc="m.name"/>
                    <span class="lp-model-meta" t-esc="m.category"/>
                </div>
            </button>
        </div>
        <BottomSheet t-if="state.open" onClose="() => state.open = null">
            <t t-set="m" t-value="state.open"/>
            <div class="lp-hero">
                <img class="lp-thumb lp-thumb-lg" t-att-src="'/web/image/liputa.garment.model/' + m.id + '/image_512'" alt=""/>
                <div>
                    <h2 class="lp-hero-name" style="font-size: 24px" t-esc="m.name"/>
                    <div class="lp-muted" t-esc="m.category"/>
                    <div class="lp-small lp-muted" style="margin-top: 6px"><Icon name="'scissors'" size="15"/> <t t-esc="t('Made %s times', m.uses)"/></div>
                </div>
            </div>
            <div class="lp-chips" style="margin-top: 16px"><span t-foreach="m.events" t-as="e" t-key="e" class="lp-chip" style="cursor: default" t-esc="e"/></div>
            <button class="lp-btn lp-btn-tape lp-btn-block" t-on-click="() => this.use(m)"><Icon name="'plus'"/><t t-esc="t('Use for an order')"/></button>
        </BottomSheet>
    </div>`;
    static components = { Icon, Skeleton, Empty, BottomSheet };
    static props = {};
    setup() {
        this.genders = [["women", "Women"], ["men", "Men"], ["child", "Children"]];
        this.state = useState({ scope: "library", gender: null, event: null, search: "", models: [], events: [], loading: true, open: null });
        onWillStart(() => this.load());
    }
    async load() {
        this.state.loading = true;
        const res = await api.catalogue({ scope: this.state.scope, gender: this.state.gender, event_type_id: this.state.event,
                                          search: this.state.search });
        this.state.models = res.models;
        this.state.events = res.events;
        this.state.loading = false;
    }
    set(key, value) {
        this.state[key] = key === "gender" && this.state.gender === value ? null : value;
        this.load();
    }
    onSearch(ev) {
        this.state.search = ev.target.value;
        clearTimeout(this._t);
        this._t = setTimeout(() => this.load(), 250);
    }
    use(m) {
        this.state.open = null;
        go(`/new?model=${m.id}`);
    }
}

// ============================================================== planning
const TAILOR_COLORS = ["#16213E", "#138A5E", "#C99A06", "#D6453D", "#6A4FB3", "#0F7A8C"];

export class PlanningScreen extends Base {
    static template = xml`
    <div class="lp-screen">
        <header class="lp-head"><h1 class="lp-title" t-esc="t('Planning')"/></header>
        <div class="lp-days" role="tablist">
            <button t-foreach="days" t-as="d" t-key="d.iso" role="tab" t-attf-class="lp-day #{state.day === d.iso ? 'lp-on' : ''}"
                    t-att-aria-selected="state.day === d.iso" t-on-click="() => state.day = d.iso">
                <small t-esc="d.wd"/><b t-esc="d.n"/><i t-if="d.count" aria-hidden="true"/>
            </button>
        </div>
        <Skeleton t-if="!state.data" count="3" height="120"/>
        <t t-else="">
            <div t-if="!byTailor.length" class="lp-sheet"><Empty icon="'calendar'" title="t('Nothing planned this day.')"/></div>
            <div t-foreach="byTailor" t-as="row" t-key="row.tailor.id" class="lp-sheet">
                <div class="lp-tailor-head">
                    <span class="lp-tailor-dot" t-attf-style="background: #{row.color}" t-esc="row.tailor.name.charAt(0)"/>
                    <div class="lp-row-main">
                        <div class="lp-row-title" t-esc="row.tailor.name"/>
                        <div class="lp-load-mini">
                            <Tape value="row.hours" max="row.tailor.daily_hours" small="true" health="row.hours > row.tailor.daily_hours ? 'late' : ''"/>
                            <span t-esc="t('%s h planned of %s h', num(row.hours), num(row.tailor.daily_hours))"/>
                        </div>
                    </div>
                </div>
                <ul class="lp-list">
                    <li t-foreach="row.tasks" t-as="task" t-key="task.id">
                        <a class="lp-row" t-attf-href="#/order/#{task.order_id}">
                            <span class="lp-flag" t-attf-style="background: #{row.color}"/>
                            <div class="lp-row-main">
                                <div class="lp-row-title"><t t-esc="task.label"/> · <t t-esc="task.client"/></div>
                                <div class="lp-row-sub"><t t-esc="task.model"/> · <t t-esc="num(task.hours)"/> h</div>
                            </div>
                            <span t-if="task.state === 'done'" class="lp-check lp-done"><Icon name="'check'" size="18" stroke="2.4"/></span>
                            <Icon t-else="" name="'chevron'" size="18"/>
                        </a>
                    </li>
                </ul>
            </div>
        </t>
    </div>`;
    static components = { Icon, Skeleton, Empty, Tape };
    static props = {};
    setup() {
        this.num = num;
        const d = today();
        this.start = d;
        this.state = useState({ data: null, day: this.iso(d) });
        onWillStart(async () => (this.state.data = await api.planning({ date_from: this.iso(d), days: 7 })));
    }
    iso(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    get days() {
        const loc = getLang() === "fr" ? "fr-FR" : "en-GB";
        const out = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(this.start);
            d.setDate(d.getDate() + i);
            const iso = this.iso(d);
            const count = (this.state.data?.tasks || []).filter((t) => t.start <= iso && t.end >= iso).length;
            out.push({ iso, n: d.getDate(), wd: d.toLocaleDateString(loc, { weekday: "short" }).replace(".", ""), count });
        }
        return out;
    }
    get byTailor() {
        const day = this.state.day;
        const tasks = this.state.data.tasks.filter((t) => t.start <= day && t.end >= day);
        return this.state.data.tailors.map((tailor, i) => {
            const own = tasks.filter((t) => t.tailor_id === tailor.id);
            const hours = own.reduce((s, t) => {
                const span = Math.max(1, (parseDate(t.end) - parseDate(t.start)) / 86400000 + 1);
                return s + t.hours / span;
            }, 0);
            return { tailor, tasks: own, hours, color: TAILOR_COLORS[i % TAILOR_COLORS.length] };
        }).filter((r) => r.tasks.length);
    }
}

// ============================================================== account
export class AccountScreen extends Base {
    static template = xml`
    <div class="lp-screen lp-no-tabbar">
        <TopBar title="t('My account')" fallback="'/home'"/>
        <section class="lp-hero" style="align-items: center; margin-bottom: 18px">
            <span class="lp-avatar" style="width: 64px; height: 64px; font-size: 24px; border-radius: 20px" t-esc="me.first_name.charAt(0)"/>
            <div>
                <h1 class="lp-hero-name" style="font-size: 24px" t-esc="me.atelier"/>
                <div class="lp-muted" t-esc="me.name"/>
            </div>
        </section>
        <h2 class="lp-h2" t-esc="t('Subscription')"/>
        <div class="lp-sheet">
            <div class="lp-kv"><span t-esc="t('Plan')"/><span class="lp-strong" t-esc="me.subscription.plan"/></div>
            <div class="lp-kv"><span t-esc="t('Status')"/>
                <span t-attf-class="lp-pill #{me.subscription.state === 'active' ? 'lp-on_track' : (me.subscription.state === 'suspended' ? 'lp-late' : 'lp-at_risk')}">
                    <t t-esc="t(me.subscription.state)"/><t t-if="me.subscription.state === 'trial'">, <t t-esc="t('%s days left', me.subscription.days_left)"/></t>
                </span></div>
            <div class="lp-kv"><span t-esc="t('Price')"/><span><t t-esc="money(me.subscription.price)"/> <span class="lp-muted" t-esc="t('per month')"/></span></div>
            <div class="lp-kv"><span t-esc="t('AI credits left this month')"/><span class="lp-strong" t-esc="me.subscription.ai_left"/></div>
        </div>
        <button class="lp-btn lp-btn-tape lp-btn-block" style="margin-top: 14px" t-on-click="() => state.pay = { step: 'form', method: 'mpesa', phone: '' }">
            <Icon name="'wallet'"/><t t-esc="t('Pay with Mobile Money')"/>
        </button>
        <h2 class="lp-h2" t-esc="t('Language')"/>
        <div class="lp-sheet">
            <button t-foreach="langs" t-as="l" t-key="l[0]" class="lp-row" style="min-height: 52px" t-on-click="() => this.setLang(l[0])">
                <span class="lp-row-main" t-esc="l[1]"/>
                <Icon t-if="me.lang === l[0]" name="'check'" size="20" stroke="2.4"/>
            </button>
        </div>
        <a class="lp-btn lp-btn-line lp-btn-block" style="margin-top: 22px" href="/app/logout"><Icon name="'logout'"/><t t-esc="t('Log out')"/></a>

        <BottomSheet t-if="state.pay" onClose="() => state.pay = null">
            <t t-if="state.pay.step === 'form'">
                <h2 class="lp-hero-name" style="font-size: 24px; margin-bottom: 16px" t-esc="t('Renew the subscription')"/>
                <div class="lp-operators" role="radiogroup">
                    <button t-foreach="operators" t-as="op" t-key="op[0]" role="radio" t-att-aria-checked="state.pay.method === op[0]"
                            t-attf-class="lp-operator #{state.pay.method === op[0] ? 'lp-on' : ''}" t-on-click="() => state.pay.method = op[0]">
                        <i t-attf-style="background: #{op[2]}"/><t t-esc="op[1]"/>
                    </button>
                </div>
                <label class="lp-field"><span class="lp-label" t-esc="t('Mobile Money number')"/>
                    <input class="lp-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="+243 81 000 0000" t-model="state.pay.phone"/></label>
                <button class="lp-btn lp-btn-primary lp-btn-block" t-att-disabled="state.busy" t-on-click="pay" t-esc="t('Pay %s', money(me.subscription.price))"/>
            </t>
            <div t-else="" class="lp-pay-wait">
                <div class="lp-empty-icon"><Icon name="'phone'" size="30"/></div>
                <h2 class="lp-hero-name" style="font-size: 22px" t-esc="t('Confirm the payment on your phone')"/>
                <p class="lp-muted" t-esc="t('Enter your PIN in the %s prompt to pay %s. Your subscription is renewed as soon as the payment is confirmed.', operatorName, money(me.subscription.price))"/>
                <p class="lp-small lp-muted lp-num" t-esc="state.pay.reference"/>
                <button class="lp-btn lp-btn-ghost lp-btn-block" t-on-click="() => state.pay = null" t-esc="t('Close')"/>
            </div>
        </BottomSheet>
    </div>`;
    static components = { TopBar, Icon, BottomSheet };
    static props = {};
    setup() {
        this.money = money;
        this.store = useState(store);
        this.state = useState({ pay: null, busy: false });
        this.langs = [["fr", "Français"], ["en", "English"]];
        this.operators = [["mpesa", "M-Pesa", "#E3262E"], ["orange_money", "Orange Money", "#FF7900"], ["airtel_money", "Airtel Money", "#ED1C24"]];
    }
    get me() {
        return this.store.me;
    }
    get operatorName() {
        return (this.operators.find((o) => o[0] === this.state.pay.method) || [])[1] || "";
    }
    async pay() {
        if ((this.state.pay.phone || "").replace(/\D/g, "").length < 9) {
            toast(this.t("Enter a valid phone number"), "error");
            return;
        }
        this.state.busy = true;
        try {
            const res = await api.pay(this.state.pay.method, this.state.pay.phone);
            Object.assign(this.state.pay, { step: "wait", reference: res.reference });
        } catch (e) {
            toast(e.message, "error");
        } finally {
            this.state.busy = false;
        }
    }
    async setLang(lang) {
        if (lang === this.me.lang) {
            return;
        }
        await api.setLang(lang);
        window.location.reload();
    }
}
