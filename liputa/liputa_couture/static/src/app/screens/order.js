/** @odoo-module **/
import { markup, onWillStart, useState, xml } from "@odoo/owl";
import { api, toast } from "../core/api";
import { Base, Icon, Skeleton, Tape, TopBar } from "../core/ui";
import { healthLabel, longDate, money, num, relative } from "../core/format";
import { buildMannequin, SKIN_TONES } from "@liputa_couture/backend/mannequin/mannequin_geometry";

const NEXT_ACTION = {
    draft: ["confirm", "Confirm the order", "Order confirmed"],
    confirmed: ["ready", "Mark as ready", "Order ready: the client is notified"],
    cutting: ["ready", "Mark as ready", "Order ready: the client is notified"],
    sewing: ["ready", "Mark as ready", "Order ready: the client is notified"],
    fitting: ["ready", "Mark as ready", "Order ready: the client is notified"],
    finishing: ["ready", "Mark as ready", "Order ready: the client is notified"],
    ready: ["deliver", "Hand over to client", "Order delivered"],
};

async function loadOrder(component) {
    component.state.order = await api.order(component.props.id);
}

// ============================================================== order detail
export class OrderScreen extends Base {
    static template = xml`
    <div class="lp-screen lp-no-tabbar">
        <TopBar title="state.order ? state.order.ref : ''" fallback="'/orders'"/>
        <Skeleton t-if="!state.order" count="5" height="90"/>
        <t t-else="">
            <t t-set="o" t-value="state.order"/>
            <section class="lp-hero">
                <img class="lp-thumb lp-thumb-lg" t-att-src="'/web/image/liputa.garment.model/' + o.model_id + '/image_512'" t-att-alt="o.model"/>
                <div style="min-width: 0">
                    <span t-if="o.stage_code !== 'draft'" t-attf-class="lp-pill lp-#{o.health}" t-esc="healthLabel(o.health)"/>
                    <h1 class="lp-hero-name" t-esc="o.client"/>
                    <div class="lp-hero-model" t-esc="o.model"/>
                    <div class="lp-small lp-muted" t-if="o.event" t-esc="o.event"/>
                    <div class="lp-small lp-muted" t-if="o.event_date" t-esc="t('Event on %s', longDate(o.event_date))"/>
                    <div class="lp-hero-actions" t-if="o.phone">
                        <a class="lp-btn lp-btn-ghost lp-btn-sm" t-attf-href="tel:#{o.phone}"><Icon name="'phone'" size="18"/><t t-esc="t('Call')"/></a>
                        <a class="lp-btn lp-btn-ghost lp-btn-sm" t-att-href="whatsapp" target="_blank" rel="noopener"><Icon name="'chat'" size="18"/>WhatsApp</a>
                    </div>
                </div>
            </section>

            <div class="lp-steps" aria-label="Stages">
                <div t-foreach="stages" t-as="s" t-key="s.id" t-attf-class="lp-step lp-#{s.state}">
                    <i/><span t-esc="s.name"/>
                </div>
            </div>

            <section class="lp-sheet lp-pad" style="margin-top: 16px">
                <div class="lp-deliv">
                    <div>
                        <div class="lp-small lp-muted" t-esc="t('Delivery planned')"/>
                        <div class="lp-deliv-date" t-esc="capital(longDate(o.promised))"/>
                    </div>
                    <span t-attf-class="lp-due lp-#{o.health}" t-esc="relative(o.promised)"/>
                </div>
                <Tape value="o.progress" health="o.health"/>
                <div class="lp-tape-labels"><span t-esc="num(o.progress, 0) + ' %'"/><span t-if="o.tailor" t-esc="o.tailor"/></div>
                <p t-if="o.estimation_note" class="lp-small lp-muted" style="margin: 12px 0 0" t-esc="o.estimation_note"/>
            </section>

            <div class="lp-tiles" style="margin-top: 12px">
                <a class="lp-tile" t-attf-href="#/order/#{o.id}/fitting">
                    <span class="lp-tile-icon"><Icon name="'figure'"/></span><b t-esc="t('Fitting')"/><span t-esc="t('Virtual fitting')"/>
                </a>
                <a class="lp-tile" t-attf-href="#/order/#{o.id}/pattern">
                    <span class="lp-tile-icon"><Icon name="'pattern'"/></span><b t-esc="t('Pattern')"/><span t-esc="t('%s m of fabric', num(o.fabric_metres, 2))"/>
                </a>
                <a class="lp-tile" t-attf-href="#/order/#{o.id}/measures">
                    <span class="lp-tile-icon"><Icon name="'ruler'"/></span><b t-esc="t('Measurements')"/><span t-esc="measureSummary"/>
                </a>
            </div>

            <h2 class="lp-h2" t-if="o.tasks.length" t-esc="t('Production')"/>
            <div class="lp-sheet" t-if="o.tasks.length">
                <ul class="lp-list">
                    <li t-foreach="o.tasks" t-as="task" t-key="task.id" class="lp-row" style="cursor: default">
                        <div class="lp-row-main">
                            <div class="lp-row-title" t-esc="task.label"/>
                            <div class="lp-row-sub"><t t-esc="task.tailor"/><t t-if="task.tailor"> · </t><t t-esc="num(task.hours)"/> h · <t t-esc="relative(task.end)"/></div>
                        </div>
                        <button t-attf-class="lp-check #{task.state === 'done' ? 'lp-done' : (task.state === 'in_progress' ? 'lp-doing' : '')}"
                                t-on-click="() => this.taskDone(task)" t-att-disabled="task.state === 'done'" t-att-aria-label="t('Task done')">
                            <Icon name="'check'" size="20" stroke="2.4"/>
                        </button>
                    </li>
                </ul>
            </div>

            <h2 class="lp-h2" t-esc="t('Payment')"/>
            <div class="lp-sheet">
                <div class="lp-kv"><span t-esc="t('Making')"/><span t-esc="money(o.amounts.making)"/></div>
                <div class="lp-kv" t-if="o.amounts.fabric"><span t-esc="t('Fabric')"/><span t-esc="money(o.amounts.fabric)"/></div>
                <div class="lp-kv" t-if="o.amounts.options"><span t-esc="t('Extras')"/><span t-esc="money(o.amounts.options)"/></div>
                <div class="lp-kv" t-if="o.amounts.urgency"><span t-esc="t('Express')"/><span t-esc="money(o.amounts.urgency)"/></div>
                <div class="lp-kv lp-total"><span t-esc="t('Total')"/><span t-esc="money(o.amounts.total)"/></div>
                <div class="lp-kv"><span t-esc="t('Deposit')"/><span t-esc="money(o.amounts.deposit)"/></div>
                <div class="lp-kv lp-strong"><span t-esc="t('Left to pay')"/><span t-esc="money(o.amounts.residual)"/></div>
                <div class="lp-kv" t-if="!o.amounts.invoiced and o.stage_code !== 'draft'">
                    <span class="lp-muted" t-esc="t('Not invoiced yet')"/>
                    <button class="lp-btn lp-btn-line lp-btn-sm" t-on-click="() => this.run('invoice', 'Invoice created')" t-esc="t('Create the invoice')"/>
                </div>
            </div>

            <div class="lp-actionbar">
                <button t-if="o.tracking_url" class="lp-btn lp-btn-ghost" t-on-click="share" t-att-aria-label="t('Share tracking')"><Icon name="'share'"/></button>
                <button t-if="next" class="lp-btn lp-btn-primary" t-att-disabled="state.busy" t-on-click="() => this.run(next[0], next[2])" t-esc="t(next[1])"/>
                <span t-else="" class="lp-btn lp-btn-ghost" style="flex: 1"><Icon name="'check'"/><t t-esc="t('Delivered')"/></span>
            </div>
        </t>
    </div>`;
    static components = { TopBar, Icon, Tape, Skeleton };
    static props = { id: Number };

    setup() {
        this.state = useState({ order: null, busy: false });
        Object.assign(this, { money, num, relative, longDate, healthLabel });
        onWillStart(() => loadOrder(this));
    }
    capital(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    }
    get stages() {
        const o = this.state.order;
        const idx = o.stages.findIndex((s) => s.code === o.stage_code);
        return o.stages.map((s, i) => ({ ...s, state: i < idx ? "done" : i === idx ? "current" : "todo" }));
    }
    get next() {
        return NEXT_ACTION[this.state.order.stage_code];
    }
    get whatsapp() {
        const digits = (this.state.order.phone || "").replace(/\D/g, "");
        return `https://wa.me/${digits}`;
    }
    get measureSummary() {
        const m = this.state.order.measurements;
        return [m.bust, m.waist, m.hip].filter(Boolean).map((v) => num(v, 0)).join(" / ") || "-";
    }
    async run(action, done) {
        this.state.busy = true;
        try {
            this.state.order = await api.action(this.state.order.id, action);
            toast(this.t(done));
        } catch (e) {
            toast(e.message, "error");
        } finally {
            this.state.busy = false;
        }
    }
    async taskDone(task) {
        this.state.order = await api.action(this.state.order.id, "task_done", { task_id: task.id });
        toast(this.t("Task done"));
    }
    async share() {
        const url = this.state.order.tracking_url;
        if (navigator.share) {
            await navigator.share({ title: this.state.order.ref, url }).catch(() => {});
        } else {
            await navigator.clipboard?.writeText(url);
            toast(this.t("Tracking link copied"));
        }
    }
}

// ============================================================== virtual fitting
export class FittingScreen extends Base {
    static template = xml`
    <div class="lp-screen lp-no-tabbar">
        <TopBar title="t('Virtual fitting')" fallback="'/order/' + props.id"/>
        <Skeleton t-if="!state.geo" count="1" height="460"/>
        <t t-else="">
            <t t-set="g" t-value="state.geo"/>
            <div class="lp-fitting">
                <svg xmlns="http://www.w3.org/2000/svg" t-att-viewBox="g.viewBox" role="img" aria-label="Mannequin">
                    <defs>
                        <pattern t-if="state.data.has_fabric" id="lp-fab" patternUnits="userSpaceOnUse" width="64" height="64">
                            <image t-att-href="'/web/image/liputa.order/' + props.id + '/fabric_image'" width="64" height="64" preserveAspectRatio="xMidYMid slice"/>
                        </pattern>
                        <linearGradient id="lp-shade" x1="0" x2="1">
                            <stop offset="0" stop-color="#000" stop-opacity="0.26"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.12"/>
                            <stop offset="0.62" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/>
                        </linearGradient>
                    </defs>
                    <ellipse t-att-cx="g.shadow.cx" t-att-cy="g.shadow.cy" t-att-rx="g.shadow.rx" ry="5" fill="#16213E" opacity="0.12"/>
                    <g t-att-fill="skin">
                        <path t-foreach="g.arms" t-as="a" t-key="a_index" t-att-d="a" fill="none" t-att-stroke="skin" t-att-stroke-width="g.armWidth" stroke-linecap="round"/>
                        <circle t-foreach="g.hands" t-as="h" t-key="h_index" t-att-cx="h.cx" t-att-cy="h.cy" t-att-r="h.r"/>
                        <rect t-att-x="g.neck.x" t-att-y="g.neck.y" t-att-width="g.neck.w" t-att-height="g.neck.h" rx="4"/>
                        <path t-att-d="g.body"/>
                        <ellipse t-att-cx="g.head.cx" t-att-cy="g.head.cy" t-att-rx="g.head.rx" t-att-ry="g.head.ry"/>
                    </g>
                    <g>
                        <t t-if="g.garment.second">
                            <path t-att-d="g.garment.second" t-att-fill="state.data.color"/>
                            <path t-att-d="g.garment.second" fill="url(#lp-shade)"/>
                        </t>
                        <path t-att-d="g.garment.main" t-att-fill="fill"/>
                        <path t-att-d="g.garment.main" fill="url(#lp-shade)"/>
                        <path t-foreach="g.garment.sleeves" t-as="s" t-key="s_index" t-att-d="s" fill="none" t-att-stroke="fill" t-att-stroke-width="g.garment.sleeveWidth" stroke-linecap="round"/>
                        <path t-foreach="g.garment.details" t-as="dt" t-key="dt_index" t-att-d="dt" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="1.2" stroke-dasharray="3 3"/>
                        <path t-if="g.garment.headwrap" t-att-d="g.garment.headwrap" t-att-fill="fill"/>
                    </g>
                    <g t-if="state.dims" font-size="10" font-weight="700" fill="#16213E">
                        <t t-foreach="g.dims" t-as="d" t-key="d_index">
                            <line t-att-x1="d.x1" t-att-x2="d.x2" t-att-y1="d.y" t-att-y2="d.y" stroke="#16213E" stroke-dasharray="2 2"/>
                            <rect t-att-x="d.x2 + 2" t-att-y="d.y - 8" width="44" height="16" rx="8" fill="#F2C230"/>
                            <text t-att-x="d.x2 + 24" t-att-y="d.y + 3.5" text-anchor="middle" t-esc="d.label"/>
                        </t>
                    </g>
                </svg>
            </div>
            <div class="lp-swatches" role="radiogroup" t-att-aria-label="t('Skin tone')">
                <button t-foreach="tones" t-as="tone" t-key="tone[0]" role="radio" t-att-aria-checked="state.tone === tone[0]"
                        t-attf-class="lp-swatch #{state.tone === tone[0] ? 'lp-on' : ''}" t-attf-style="background: #{tone[1]}"
                        t-on-click="() => state.tone = tone[0]"/>
            </div>
            <div class="lp-sheet" style="margin-top: 14px">
                <div class="lp-toggle-row">
                    <span t-esc="t('Show measurements')"/>
                    <button t-attf-class="lp-switch #{state.dims ? 'lp-on' : ''}" role="switch" t-att-aria-checked="state.dims" t-on-click="() => state.dims = !state.dims"/>
                </div>
            </div>
            <button class="lp-btn lp-btn-primary lp-btn-block" style="margin-top: 14px" t-att-disabled="!state.data.has_photo or state.busy" t-on-click="render">
                <Icon name="'sparkle'"/><t t-esc="t('Photoreal render (AI)')"/>
            </button>
            <p t-if="!state.data.has_photo" class="lp-small lp-muted lp-center" style="margin-top: 8px" t-esc="t('Add a client photo with consent to get a photoreal render.')"/>
            <img t-if="state.data.has_ai_render" t-att-src="'/web/image/liputa.order/' + props.id + '/ai_render_image?unique=' + state.data.write_date" alt="" style="margin-top: 14px; border-radius: 22px"/>
        </t>
    </div>`;
    static components = { TopBar, Icon, Skeleton };
    static props = { id: Number };

    setup() {
        this.state = useState({ data: null, geo: null, tone: "5", dims: true, busy: false });
        this.tones = Object.entries(SKIN_TONES);
        onWillStart(async () => {
            const data = await api.mannequin(this.props.id);
            this.state.data = data;
            this.state.tone = String(data.skin_tone || "5");
            this.state.geo = buildMannequin(data);
        });
    }
    get skin() {
        return SKIN_TONES[this.state.tone];
    }
    get fill() {
        return this.state.data.has_fabric ? "url(#lp-fab)" : this.state.data.color;
    }
    async render() {
        this.state.busy = true;
        try {
            await api.render(this.props.id);
            this.state.data = await api.mannequin(this.props.id);
        } catch (e) {
            toast(e.message, "error");
        } finally {
            this.state.busy = false;
        }
    }
}

// ============================================================== cutting pattern
export class PatternScreen extends Base {
    static template = xml`
    <div class="lp-screen lp-no-tabbar">
        <TopBar title="t('Cutting pattern')" fallback="'/order/' + props.id"/>
        <Skeleton t-if="!state.data" count="1" height="420"/>
        <t t-else="">
            <div class="lp-deliv">
                <div>
                    <div class="lp-deliv-date"><t t-esc="num(state.data.fabric.metres, 2)"/> m</div>
                    <div class="lp-small lp-muted"><t t-esc="num(state.data.fabric.yards)"/> yards · <t t-esc="t('Fabric')"/> <t t-esc="num(state.data.fabric.fabric_width_cm, 0)"/> cm</div>
                </div>
                <div class="lp-zoom">
                    <button t-on-click="() => this.zoom(-0.5)" aria-label="-"><Icon name="'minus'" size="20"/></button>
                    <span t-esc="Math.round(state.zoom * 100) + ' %'"/>
                    <button t-on-click="() => this.zoom(0.5)" aria-label="+"><Icon name="'plus'" size="20"/></button>
                </div>
            </div>
            <div class="lp-chips">
                <span t-foreach="state.data.pieces" t-as="p" t-key="p_index" class="lp-chip" style="cursor: default">
                    <t t-esc="p.label or p.key"/><b>×<t t-esc="p.cut"/></b>
                </span>
            </div>
            <div class="lp-pattern"><div class="lp-pattern-inner" t-attf-style="width: #{state.zoom * 100}%"><t t-out="svg"/></div></div>
            <p class="lp-small lp-muted" style="margin: 12px 4px" t-esc="t('Base pattern drawn from the measurements. Check it on a toile before cutting the fabric.')"/>
            <div class="lp-actionbar">
                <button class="lp-btn lp-btn-ghost" t-on-click="print" t-att-aria-label="t('Print')"><Icon name="'print'"/></button>
                <a class="lp-btn lp-btn-primary" t-att-href="'/liputa/order/' + props.id + '/pattern.svg'"><Icon name="'download'"/><t t-esc="t('Download (1:1)')"/></a>
            </div>
        </t>
    </div>`;
    static components = { TopBar, Icon, Skeleton };
    static props = { id: Number };

    setup() {
        this.state = useState({ data: null, zoom: 1 });
        this.num = num;
        onWillStart(async () => (this.state.data = await api.pattern(this.props.id)));
    }
    get svg() {
        return markup(this.state.data.svg); // generated server-side, labels escaped
    }
    zoom(d) {
        this.state.zoom = Math.min(5, Math.max(1, this.state.zoom + d));
    }
    print() {
        const w = window.open("", "_blank");
        if (!w) {
            return;
        }
        w.document.write(`<html><head><title>Liputa</title><style>@page{margin:0}body{margin:0}</style></head><body>${this.state.data.svg}</body></html>`);
        w.document.close();
        w.print();
    }
}

// ============================================================== measurements
const GROUPS = [
    ["Upper body", [["height", "Height"], ["neck", "Neck"], ["shoulder_width", "Shoulders"], ["bust", "Bust / chest"],
        ["under_bust", "Under bust"], ["waist", "Waist"], ["back_waist_length", "Back waist length"], ["front_waist_length", "Front waist length"]]],
    ["Arms", [["arm_length", "Arm length"], ["biceps", "Biceps"], ["wrist", "Wrist"]]],
    ["Lower body", [["hip", "Hip"], ["hip_depth", "Hip depth"], ["thigh", "Thigh"], ["knee", "Knee"],
        ["hem_width", "Trouser hem"], ["inseam", "Inseam"], ["outseam", "Trouser length"]]],
    ["Lengths", [["skirt_length", "Skirt length"], ["dress_length", "Dress length"]]],
];
export { GROUPS };

export class MeasuresScreen extends Base {
    static template = xml`
    <div class="lp-screen lp-no-tabbar">
        <TopBar title="t('Measurements')" fallback="'/order/' + props.id"/>
        <Skeleton t-if="!state.order" count="6"/>
        <t t-else="">
            <t t-foreach="groups" t-as="g" t-key="g[0]">
                <h2 class="lp-h2" t-esc="t(g[0])"/>
                <div class="lp-sheet">
                    <div t-foreach="g[1]" t-as="f" t-key="f[0]" class="lp-kv">
                        <span t-esc="t(f[1])"/>
                        <span t-attf-class="#{state.order.measurements[f[0]] ? 'lp-strong' : 'lp-muted'}"
                              t-esc="state.order.measurements[f[0]] ? num(state.order.measurements[f[0]]) + ' cm' : '-'"/>
                    </div>
                </div>
            </t>
        </t>
    </div>`;
    static components = { TopBar, Skeleton };
    static props = { id: Number };
    setup() {
        this.state = useState({ order: null });
        this.groups = GROUPS;
        this.num = num;
        onWillStart(() => loadOrder(this));
    }
}
