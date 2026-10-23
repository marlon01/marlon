/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";
import { Icon, notifyError, useInterval } from "@norma_facture/common/ui";
import { dateTime, isoDay, money } from "@norma_facture/common/format";
import { can, session } from "@norma_facture/app/store";
import { PageHead, StateTag, TypeTag } from "@norma_facture/app/components";

const WORK = { pos: ["#/sell", "Ouvrir la caisse", "cart"], hotel: ["#/rooms", "Plan des chambres", "bed"],
    restaurant: ["#/tables", "Plan de salle", "utensils"], invoice: ["#/new", "Nouvelle facture", "file"] };

/* Barres des 14 derniers jours (SVG, sans bibliothèque). */
class Bars extends Component {
    static template = xml`
        <svg class="nm-bars" t-att-viewBox="'0 0 ' + W + ' ' + H" role="img" aria-label="Ventes des 14 derniers jours" preserveAspectRatio="none">
            <line t-att-x1="0" t-att-x2="W" t-att-y1="H - 18" t-att-y2="H - 18" stroke="var(--line)"/>
            <g t-foreach="bars" t-as="b" t-key="b.date">
                <rect t-att-x="b.x" t-att-y="b.y" t-att-width="b.w" t-att-height="b.h" rx="3" t-att-fill="b_last ? 'var(--gold)' : 'var(--river)'" t-att-opacity="b_last ? 1 : .85"><title t-esc="b.title"/></rect>
                <text t-if="b_index % 2 === 1 or b_last" t-att-x="b.x + b.w / 2" t-att-y="H - 4" text-anchor="middle" font-size="10" fill="var(--muted)" t-esc="b.label"/>
            </g>
        </svg>`;
    static props = { series: Array };
    W = 560; H = 170;
    get bars() {
        const s = this.props.series;
        const max = Math.max(1, ...s.map((d) => d.total));
        const step = this.W / s.length;
        return s.map((d) => {
            const h = Math.max(2, (d.total / max) * (this.H - 30));
            const day = new Date(d.date + "T12:00:00");
            return { date: d.date, x: step * s.indexOf(d) + step * 0.18, w: step * 0.64, h, y: this.H - 18 - h,
                label: day.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
                title: `${day.toLocaleDateString("fr-FR")} : ${money(d.total)} (${d.count} facture(s))` };
        });
    }
}

export class DashboardPage extends Component {
    static template = xml`
        <div class="nm-page" t-if="state.d">
            <t t-set="d" t-value="state.d"/>
            <PageHead title="greeting" subtitle="session.company.name + ' · ' + session.category.name">
                <a class="nm-btn nm-btn-gold nm-btn-lg" t-att-href="work[0]"><Icon name="work[2]"/> <t t-esc="work[1]"/></a>
            </PageHead>
            <a t-if="d.attention" class="nm-alert" href="#/invoices?state=attention">
                <Icon name="'alert'"/>
                <span><b t-esc="d.attention"/> facture(s) en attente de normalisation ou à vérifier. Elles ne valent pas facture tant que la DGI ne les a pas confirmées.</span>
            </a>
            <div t-if="simulation" class="nm-alert is-info">
                <Icon name="'shield'"/>
                <span>Vos établissements sont en mode simulation : les factures sont des démonstrations sans valeur fiscale.<t t-if="can('admin')"> <a href="#/settings?tab=sites">Relier l'e-MCF de la DGI</a></t></span>
            </div>
            <div class="nm-kpis">
                <div class="nm-kpi is-main">
                    <span>Ventes du jour</span>
                    <b class="nm-num" t-esc="money(d.today.total, 'CDF')"/>
                    <small><t t-esc="d.today.count"/> facture(s)<t t-if="d.today.credits"> · <t t-esc="d.today.credits"/> avoir(s)</t></small>
                </div>
                <div class="nm-kpi"><span>TVA collectée aujourd'hui</span><b class="nm-num" t-esc="money(d.today.tax, 'CDF')"/><small>nette des avoirs</small></div>
                <div class="nm-kpi"><span>Ventes du mois</span><b class="nm-num" t-esc="money(d.month.total, 'CDF')"/><small><t t-esc="d.month.count"/> facture(s)</small></div>
                <div class="nm-kpi"><span>TVA du mois</span><b class="nm-num" t-esc="money(d.month.tax, 'CDF')"/><small>à déclarer avant le 15</small></div>
            </div>
            <div class="nm-dash">
                <section class="nm-panel">
                    <div class="nm-panel-head"><h2 class="nm-grow">Quatorze derniers jours</h2><span class="nm-muted">TTC net, en CDF</span></div>
                    <div class="nm-panel-body"><Bars series="d.series"/></div>
                </section>
                <section class="nm-panel">
                    <div class="nm-panel-head"><h2>Encaissements du jour</h2></div>
                    <div class="nm-panel-body">
                        <div t-if="!d.payments.length" class="nm-muted">Aucun encaissement aujourd'hui.</div>
                        <div t-foreach="d.payments" t-as="p" t-key="p.method" class="nm-split">
                            <span t-esc="p.label"/><b class="nm-num" t-esc="money(p.amount)"/>
                            <i t-att-style="'width:' + pct(p.amount) + '%'"/>
                        </div>
                    </div>
                </section>
                <section class="nm-panel">
                    <div class="nm-panel-head"><h2 class="nm-grow">Dernières factures</h2><a href="#/invoices" class="nm-btn nm-btn-sm">Tout voir</a></div>
                    <table class="nm-table">
                        <tbody>
                            <tr t-foreach="d.recent" t-as="i" t-key="i.id" class="is-click" t-on-click="() => this.open(i.id)">
                                <td><div class="nm-mono" t-esc="i.number"/><div class="nm-muted" style="font-size:12px" t-esc="dateTime(i.date)"/></td>
                                <td><TypeTag type="i.type"/></td>
                                <td><StateTag state="i.state"/></td>
                                <td class="nm-right nm-num" t-esc="money(i.total)"/>
                            </tr>
                        </tbody>
                    </table>
                    <div t-if="!d.recent.length" class="nm-empty">Aucune facture pour l'instant. Votre première vente apparaîtra ici.</div>
                </section>
                <section class="nm-panel">
                    <div class="nm-panel-head"><h2>Dispositifs fiscaux</h2></div>
                    <div class="nm-panel-body nm-stack">
                        <div t-foreach="d.sites" t-as="s" t-key="s.id" class="nm-device">
                            <span class="nm-device-dot" t-att-class="'is-' + (s.emcf_mode === 'simulation' ? 'sim' : s.emcf_status)"/>
                            <div class="nm-grow"><b t-esc="s.name"/><div class="nm-muted" style="font-size:12px"><t t-esc="s.code"/> · <t t-esc="modeLabel(s)"/></div></div>
                        </div>
                    </div>
                </section>
            </div>
        </div>`;
    static components = { PageHead, Icon, Bars, StateTag, TypeTag };
    static props = ["*"];
    setup() {
        this.money = money;
        this.dateTime = dateTime;
        this.can = can;
        this.session = session;
        this.state = useState({ d: null });
        onWillStart(() => this.load());
        useInterval(() => this.load().catch(() => {}), 60000);
    }
    async load() {
        try { this.state.d = await api("dashboard", {}); } catch (err) { notifyError(err); }
    }
    get work() { return WORK[session.category.workspace] || WORK.invoice; }
    get greeting() {
        const h = new Date().getHours();
        return `${h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"}, ${session.user.name.split(" ")[0]}`;
    }
    get simulation() { return this.state.d.sites.some((s) => s.emcf_mode === "simulation"); }
    pct(v) { const max = Math.max(...this.state.d.payments.map((p) => p.amount), 1); return Math.round((v / max) * 100); }
    modeLabel(s) {
        if (s.emcf_mode === "simulation") return "Simulation";
        return (s.emcf_mode === "production" ? "Production DGI" : "Test DGI") + " · " + ({ ok: "connecté", error: "erreur", unknown: "non vérifié" }[s.emcf_status] || "");
    }
    open(id) { location.hash = `#/invoices/${id}`; }
}

export class ReportsPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Rapports fiscaux'" subtitle="'Ventilation des factures normalisées par période, pour la déclaration de TVA.'">
                <button class="nm-btn" t-on-click="printPage" t-att-disabled="!state.r"><Icon name="'print'"/> Imprimer</button>
                <a class="nm-btn" t-att-href="csv"><Icon name="'download'"/> CSV détaillé</a>
            </PageHead>
            <div class="nm-filters">
                <button class="nm-btn nm-btn-sm" t-on-click="() => this.preset('day')">Aujourd'hui (Z)</button>
                <button class="nm-btn nm-btn-sm" t-on-click="() => this.preset('month')">Ce mois</button>
                <button class="nm-btn nm-btn-sm" t-on-click="() => this.preset('last')">Mois précédent</button>
                <input class="nm-input" type="date" style="width:auto" t-model="state.from" aria-label="Du"/>
                <input class="nm-input" type="date" style="width:auto" t-model="state.to" aria-label="Au"/>
                <select t-if="session.sites.length > 1" class="nm-select" style="width:auto" t-model="state.site">
                    <option value="">Tous les établissements</option>
                    <option t-foreach="session.sites" t-as="s" t-key="s.id" t-att-value="s.id" t-esc="s.name"/>
                </select>
                <button class="nm-btn nm-btn-primary" t-on-click="load">Calculer</button>
            </div>
            <t t-if="state.r">
                <t t-set="r" t-value="state.r"/>
                <div t-if="r.attention" class="nm-alert"><Icon name="'alert'"/><span><t t-esc="r.attention"/> facture(s) non normalisée(s) ne figurent pas dans ce rapport. <a href="#/invoices?state=attention">Les traiter</a></span></div>
                <div class="nm-kpis">
                    <div class="nm-kpi is-main"><span>Chiffre d'affaires TTC net</span><b class="nm-num" t-esc="money(r.net_total, 'CDF')"/><small><t t-esc="r.count"/> document(s)</small></div>
                    <div class="nm-kpi"><span>TVA collectée nette</span><b class="nm-num" t-esc="money(r.net_tax, 'CDF')"/><small>avoirs déduits</small></div>
                    <div class="nm-kpi"><span>Première facture</span><b class="nm-mono" style="font-size:15px" t-esc="r.first or '—'"/></div>
                    <div class="nm-kpi"><span>Dernière facture</span><b class="nm-mono" style="font-size:15px" t-esc="r.last or '—'"/></div>
                </div>
                <div class="nm-grid-2">
                    <section class="nm-panel"><div class="nm-panel-head"><h2>Par groupe de taxation</h2></div>
                        <table class="nm-table"><thead><tr><th>Groupe</th><th class="nm-right">Base HT</th><th class="nm-right">TVA</th><th class="nm-right">TTC</th></tr></thead>
                            <tbody><tr t-foreach="r.by_group" t-as="g" t-key="g.code"><td><span class="nm-group" t-esc="g.code"/> <t t-esc="g.rate"/> %</td><td class="nm-right nm-num" t-esc="money(g.base)"/><td class="nm-right nm-num" t-esc="money(g.tax)"/><td class="nm-right nm-num" t-esc="money(g.ttc)"/></tr></tbody></table></section>
                    <section class="nm-panel"><div class="nm-panel-head"><h2>Par type de facture</h2></div>
                        <table class="nm-table"><thead><tr><th>Type</th><th class="nm-right">Nombre</th><th class="nm-right">TVA</th><th class="nm-right">TTC</th></tr></thead>
                            <tbody><tr t-foreach="r.by_type" t-as="t" t-key="t.type"><td><b t-esc="t.type"/> <t t-esc="t.label"/></td><td class="nm-right nm-num" t-esc="t.count"/><td class="nm-right nm-num" t-esc="money(t.tax)"/><td class="nm-right nm-num" t-esc="money(t.total)"/></tr></tbody></table></section>
                    <section class="nm-panel"><div class="nm-panel-head"><h2>Par mode de paiement</h2></div>
                        <table class="nm-table"><tbody><tr t-foreach="r.by_payment" t-as="p" t-key="p.method"><td t-esc="p.label"/><td class="nm-right nm-num" t-esc="money(p.amount)"/></tr></tbody></table></section>
                    <section class="nm-panel"><div class="nm-panel-head"><h2>Par établissement</h2></div>
                        <table class="nm-table"><tbody><tr t-foreach="r.by_site" t-as="s" t-key="s.code"><td><t t-esc="s.code"/> — <t t-esc="s.site"/></td><td class="nm-right nm-num" t-esc="s.count"/><td class="nm-right nm-num" t-esc="money(s.total)"/></tr></tbody></table></section>
                </div>
            </t>
        </div>`;
    static components = { PageHead, Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.session = session;
        this.state = useState({ from: "", to: "", site: "", r: null });
        this.preset("month", false);
        onWillStart(() => this.load());
    }
    printPage() { window.print(); }
    get csv() { return `/norma/export/invoices.csv?date_from=${this.state.from}&date_to=${this.state.to}${this.state.site ? "&site_id=" + this.state.site : ""}`; }
    preset(kind, run = true) {
        const now = new Date();
        let a = now, b = now;
        if (kind === "month") a = new Date(now.getFullYear(), now.getMonth(), 1);
        if (kind === "last") { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
        this.state.from = isoDay(a);
        this.state.to = isoDay(b);
        if (run) this.load();
    }
    async load() {
        try {
            this.state.r = await api("report", { date_from: this.state.from, date_to: this.state.to, site_id: this.state.site || null });
        } catch (err) {
            notifyError(err);
        }
    }
}
