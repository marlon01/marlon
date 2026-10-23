/** @odoo-module **/
import { onWillStart, useState, xml } from "@odoo/owl";
import { api, store, toast } from "../core/api";
import { Base, Empty, Icon, Skeleton, Tape } from "../core/ui";
import { go } from "../core/router";
import { initials, longDate, num, relative } from "../core/format";

export class HomeScreen extends Base {
    static template = xml`
    <div class="lp-screen">
        <header class="lp-head">
            <div>
                <p class="lp-kicker" t-esc="todayLabel"/>
                <h1 class="lp-title" t-esc="t('Hello %s', store.me.first_name)"/>
            </div>
            <button class="lp-avatar" t-on-click="() => this.go('/account')" t-att-aria-label="t('My account')" t-esc="initials"/>
        </header>

        <div t-if="sub and sub.state !== 'active'" class="lp-banner">
            <Icon name="'clock'" size="20"/>
            <span t-if="sub.state === 'trial'"><b t-esc="t('Free trial')"/> · <t t-esc="t('%s days left', sub.days_left)"/></span>
            <span t-elif="sub.state === 'grace'"><b t-esc="t('Subscription due')"/></span>
            <span t-else=""><b t-esc="t('Subscription suspended')"/></span>
            <button class="lp-btn lp-btn-primary lp-btn-sm" t-on-click="() => this.go('/account')" t-esc="t('Renew')"/>
        </div>

        <Skeleton t-if="!state.data" count="3" height="96"/>
        <t t-else="">
            <t t-set="d" t-value="state.data"/>
            <section class="lp-load" aria-labelledby="load-title">
                <div class="lp-load-top">
                    <div>
                        <div class="lp-load-days"><t t-esc="num(d.workload.days_of_work)"/><span t-esc="t('days')"/></div>
                        <p id="load-title" class="lp-load-caption" t-esc="t('days of work waiting')"/>
                    </div>
                    <Icon name="'tape'" size="30"/>
                </div>
                <Tape value="d.workload.days_of_work" max="14"/>
                <div class="lp-tape-labels"><span>0</span><span>7 j</span><span>14 j</span></div>
                <p class="lp-load-caption" style="margin: 8px 0 0" t-esc="t('%s h of capacity per day', num(d.workload.daily_capacity))"/>
                <div class="lp-load-stats">
                    <button class="lp-load-stat" t-on-click="() => this.go('/orders')">
                        <b t-esc="d.kpis.open"/><span t-esc="t('in progress')"/>
                    </button>
                    <button class="lp-load-stat lp-warn" t-on-click="() => this.go('/orders?filter=late')">
                        <b t-esc="d.kpis.late + d.kpis.at_risk"/><span t-esc="t('to watch')"/>
                    </button>
                    <button class="lp-load-stat lp-good" t-on-click="() => this.go('/orders?filter=ready')">
                        <b t-esc="d.kpis.ready"/><span t-esc="t('ready')"/>
                    </button>
                </div>
            </section>

            <h2 class="lp-h2"><t t-esc="t('To watch')"/>
                <button t-if="d.alerts.length" t-on-click="() => this.go('/orders?filter=late')" t-esc="t('See all')"/></h2>
            <div class="lp-sheet">
                <Empty t-if="!d.alerts.length" icon="'check'" title="t('Nothing to watch: every order is on time.')"/>
                <ul class="lp-list" t-else="">
                    <li t-foreach="d.alerts" t-as="o" t-key="o.id">
                        <a class="lp-row" t-attf-href="#/order/#{o.id}">
                            <span t-attf-class="lp-flag lp-#{o.health}"/>
                            <div class="lp-row-main">
                                <div class="lp-row-title" t-esc="o.client"/>
                                <div class="lp-row-sub" t-esc="o.model"/>
                            </div>
                            <div class="lp-row-side">
                                <span t-attf-class="lp-due lp-#{o.health}" t-esc="relative(o.promised)"/>
                                <div style="width: 72px"><Tape value="o.progress" health="o.health" small="true"/></div>
                            </div>
                        </a>
                    </li>
                </ul>
            </div>

            <h2 class="lp-h2" t-esc="t('My tasks today')"/>
            <div class="lp-sheet">
                <Empty t-if="!d.my_tasks.length" icon="'scissors'" title="t('No task planned for you today.')"/>
                <ul class="lp-list" t-else="">
                    <li t-foreach="d.my_tasks" t-as="task" t-key="task.id" class="lp-row" style="cursor: default">
                        <div class="lp-row-main" t-on-click="() => this.go('/order/' + task.order_id)">
                            <div class="lp-row-title"><t t-esc="task.step"/> · <t t-esc="task.client"/></div>
                            <div class="lp-row-sub"><t t-esc="task.ref"/> · <t t-esc="num(task.hours)"/> h</div>
                        </div>
                        <button t-attf-class="lp-check #{task.state === 'done' ? 'lp-done' : (task.state === 'in_progress' ? 'lp-doing' : '')}"
                                t-on-click="() => this.done(task)" t-att-aria-label="t('Task done')">
                            <Icon name="'check'" size="20" stroke="2.4"/>
                        </button>
                    </li>
                </ul>
            </div>

            <h2 class="lp-h2" t-esc="t('Due this week')"/>
            <div class="lp-sheet">
                <ul class="lp-list">
                    <li t-foreach="d.upcoming" t-as="o" t-key="o.id">
                        <a class="lp-row" t-attf-href="#/order/#{o.id}">
                            <img class="lp-thumb" t-att-src="'/web/image/liputa.garment.model/' + o.model_id + '/image_256'" t-att-alt="o.model" loading="lazy"/>
                            <div class="lp-row-main">
                                <div class="lp-row-title" t-esc="o.client"/>
                                <div class="lp-row-sub" t-esc="o.model"/>
                            </div>
                            <span t-attf-class="lp-due lp-#{o.health}" t-esc="relative(o.promised)"/>
                        </a>
                    </li>
                </ul>
            </div>
        </t>
    </div>`;
    static components = { Icon, Tape, Skeleton, Empty };
    static props = {};

    setup() {
        this.store = useState(store);
        this.state = useState({ data: null });
        this.go = go;
        this.num = num;
        this.relative = relative;
        onWillStart(() => this.load());
    }
    async load() {
        this.state.data = await api.dashboard();
    }
    get sub() {
        return this.store.me.subscription;
    }
    get initials() {
        return initials(this.store.me.name);
    }
    get todayLabel() {
        const n = new Date();
        const iso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
        const s = longDate(iso);
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    async done(task) {
        if (task.state === "done") {
            return;
        }
        await api.action(task.order_id, "task_done", { task_id: task.id });
        task.state = "done";
        toast(this.t("Task done"));
    }
}
