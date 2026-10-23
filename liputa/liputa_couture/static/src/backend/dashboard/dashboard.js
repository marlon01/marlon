/** @odoo-module **/
import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import { formatDate, deserializeDate } from "@web/core/l10n/dates";
import { formatFloat, formatInteger } from "@web/views/fields/formatters";

/** Head-of-workshop cockpit: KPIs, workload vs capacity, alerts, deliveries. */
export class LiputaDashboard extends Component {
    static template = "liputa_couture.Dashboard";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({ data: null });
        onWillStart(() => this.load());
    }

    async load() {
        this.state.data = await this.orm.call("liputa.order", "get_dashboard_data", []);
    }

    money(value) {
        const cur = this.state.data.currency;
        const v = formatInteger(Math.round(value || 0));
        return cur.position === "before" ? `${cur.symbol} ${v}` : `${v} ${cur.symbol}`;
    }

    num(value) {
        return formatFloat(value || 0, { digits: [false, 1] });
    }
    date(value) {
        return value ? formatDate(deserializeDate(value)) : "";
    }

    get maxStage() {
        return Math.max(1, ...this.state.data.by_stage.map((s) => s.count));
    }

    get loadPct() {
        const w = this.state.data.workload;
        // two weeks of capacity = 100%
        const cap = w.daily_capacity * 12;
        return cap ? Math.min(100, Math.round((100 * w.backlog_hours) / cap)) : 0;
    }

    openOrders(domain, name) {
        this.action.doAction({
            type: "ir.actions.act_window", name, res_model: "liputa.order",
            views: [[false, "list"], [false, "form"]], domain,
        });
    }
    openOrder(id) {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "liputa.order", res_id: id,
            views: [[false, "form"]] });
    }
    newOrder() {
        this.action.doAction({ type: "ir.actions.act_window", res_model: "liputa.order",
            views: [[false, "form"]], target: "current" });
    }
    openStage(stage) {
        this.openOrders([["stage_id", "=", stage.id]], stage.name);
    }
    openLate() {
        this.openOrders([["schedule_health", "in", ["late", "at_risk"]],
            ["stage_code", "in", ["confirmed", "cutting", "sewing", "fitting", "finishing"]]], _t("Alerts"));
    }
    openReady() {
        this.openOrders([["stage_code", "=", "ready"]], _t("Ready for pick-up"));
    }
    openPlanning() {
        this.action.doAction("liputa_couture.action_liputa_task");
    }
    openSubscription() {
        this.action.doAction("liputa_couture.action_my_subscription");
    }
}

registry.category("actions").add("liputa_dashboard", LiputaDashboard);
