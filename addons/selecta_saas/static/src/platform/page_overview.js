/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { Icon } from "@selecta_concours/common/ui";
import { fmtNum, fmtPct } from "@selecta_concours/common/utils";
import { BarChart } from "@selecta_saas/platform/charts";
import { daysLabel, errMessage, fmtDate, money, papi, pstore, TENANT_BADGE } from "@selecta_saas/platform/papi";

import { locale } from "@selecta_concours/common/i18n";

const monthName = (i, style) => new Date(2000, i, 1).toLocaleDateString(locale(), { month: style });

export class OverviewPage extends Component {
    static components = { Icon, BarChart };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div>
                    <p class="pf-eyebrow">Administration centrale</p>
                    <h1>Vue d'ensemble</h1>
                    <p class="sl-muted">Activité de toutes les structures hébergées sur la plateforme.</p>
                </div>
                <div class="ad-head-actions">
                    <button class="sl-btn sl-btn-sm" t-on-click="load" t-att-disabled="state.loading"><Icon name="'refresh'" size="16"/>Actualiser</button>
                </div>
            </header>
            <div t-if="state.error" class="sl-alert sl-alert-danger ad-mb" role="alert">
                <t t-esc="state.error"/> <button class="sl-btn sl-btn-sm ad-ml" t-on-click="load">Réessayer</button>
            </div>
            <t t-if="state.data">
                <t t-set="k" t-value="state.data.kpi"/>
                <t t-set="cur" t-value="state.data.currency"/>
                <section class="ad-kpis pf-kpis" aria-label="Indicateurs clés">
                    <div class="ad-kpi"><span class="sl-figures" t-esc="num(k.tenants)"/><small>structures</small></div>
                    <div class="ad-kpi is-live"><span class="sl-figures" t-esc="num(k.trial)"/><small>en essai gratuit</small></div>
                    <div class="ad-kpi is-ok"><span class="sl-figures" t-esc="num(k.active)"/><small>abonnées</small></div>
                    <div class="ad-kpi" t-att-class="{'is-warn': k.past_due}"><span class="sl-figures" t-esc="num(k.past_due)"/><small>paiement en retard</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="num(k.expired)"/><small>expirées<t t-if="k.suspended">, <t t-esc="k.suspended"/> suspendue(s)</t></small></div>
                    <a href="#/payments" class="ad-kpi pf-kpi-link" t-att-class="{'is-warn': k.pending_payments}">
                        <span class="sl-figures" t-esc="num(k.pending_payments)"/>
                        <small>paiement(s) à valider <Icon name="'chevronRight'" size="14"/></small>
                    </a>
                    <div class="ad-kpi pf-kpi-money"><span class="sl-figures"><t t-esc="num(k.mrr)"/><i t-esc="cur"/></span><small>revenu mensuel récurrent (MRR)</small></div>
                    <div class="ad-kpi pf-kpi-money"><span class="sl-figures"><t t-esc="num(k.arr)"/><i t-esc="cur"/></span><small>revenu annuel récurrent (ARR)</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="pct(k.conversion)"/><small>conversion essai → payant</small></div>
                    <div class="ad-kpi pf-kpi-money is-ok"><span class="sl-figures"><t t-esc="num(k.revenue_month)"/><i t-esc="cur"/></span><small>encaissé ce mois-ci</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="num(k.concours)"/><small>concours créés</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="num(k.candidates)"/><small>candidats inscrits</small></div>
                </section>

                <div class="ad-grid-2">
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Inscriptions par semaine</h2><span class="sl-muted ad-small">12 dernières semaines</span></div>
                        <BarChart data="state.data.signups" title="'Nouvelles structures inscrites par semaine, sur 12 semaines'" integer="true" labelFn="weekLabel"/>
                    </section>
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Encaissements par mois</h2><span class="sl-muted ad-small">12 derniers mois, paiements validés</span></div>
                        <BarChart data="revenue" title="'Montants encaissés par mois, sur 12 mois'" unit="cur" tone="'accent'"/>
                    </section>
                </div>

                <section class="ad-panel">
                    <div class="ad-panel-head">
                        <h2>Répartition par catégorie</h2>
                        <div class="pf-legend ad-small"><span><i class="pf-key is-total"/>Structures</span><span><i class="pf-key is-paying"/>Dont payantes</span></div>
                    </div>
                    <div t-if="!state.data.by_plan.length" class="ad-empty"><p>Aucune structure inscrite pour le moment.</p></div>
                    <div class="pf-hbars">
                        <div t-foreach="state.data.by_plan" t-as="p" t-key="p_index" class="pf-hbar" t-att-title="p.name + ' : ' + p.count + ' structure(s), dont ' + p.paying + ' payante(s)'">
                            <span class="pf-hbar-label" t-esc="p.name"/>
                            <div class="pf-hbar-track" aria-hidden="true">
                                <div class="pf-hbar-total" t-attf-style="width: {{share(p.count)}}%"/>
                                <div class="pf-hbar-paying" t-attf-style="width: {{share(p.paying)}}%"/>
                            </div>
                            <span class="pf-hbar-value sl-figures"><b t-esc="p.count"/> <span class="sl-muted">/ <t t-esc="p.paying"/> payante(s)</span></span>
                        </div>
                    </div>
                </section>

                <div class="ad-grid-2">
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Essais qui se terminent sous 3 jours</h2><a href="#/tenants?state=trial" class="ad-link">Tous les essais</a></div>
                        <div t-if="!state.data.trials_ending.length" class="ad-empty"><p>Aucun essai n'arrive à échéance dans les trois prochains jours.</p></div>
                        <ul class="pf-list">
                            <li t-foreach="state.data.trials_ending" t-as="t" t-key="t.id">
                                <a t-att-href="'#/tenants/' + t.id" class="pf-list-row">
                                    <div class="sl-grow">
                                        <strong t-esc="t.name"/>
                                        <div class="sl-muted ad-small"><t t-esc="t.plan_name"/> · <t t-esc="t.contact_name"/> · <t t-esc="t.email"/></div>
                                    </div>
                                    <span class="pf-due" t-att-class="{'is-urgent': t.days_left lte 1}">
                                        <b class="sl-figures" t-esc="daysLabel(t)"/><small>fin le <t t-esc="date(t.trial_end)"/></small>
                                    </span>
                                </a>
                            </li>
                        </ul>
                    </section>
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Dernières inscriptions</h2><a href="#/tenants" class="ad-link">Toutes les structures</a></div>
                        <div t-if="!state.data.recent.length" class="ad-empty"><p>Aucune inscription pour le moment.</p></div>
                        <ul class="pf-list">
                            <li t-foreach="state.data.recent" t-as="t" t-key="t.id">
                                <a t-att-href="'#/tenants/' + t.id" class="pf-list-row">
                                    <div class="sl-grow">
                                        <strong t-esc="t.name"/>
                                        <div class="sl-muted ad-small"><t t-esc="t.plan_name"/><t t-if="t.country"> · <t t-esc="t.country"/></t> · inscrite le <t t-esc="date(t.created)"/></div>
                                    </div>
                                    <span t-attf-class="sl-badge {{badge[t.state]}}" t-esc="t.state_label"/>
                                </a>
                            </li>
                        </ul>
                    </section>
                </div>
            </t>
            <div t-elif="!state.error" class="ad-loading" aria-live="polite"><span class="sl-spinner"/><span class="sl-sr">Chargement</span></div>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ data: null, error: "", loading: false });
        this.badge = TENANT_BADGE;
        this.daysLabel = daysLabel;
        onWillStart(() => this.load());
    }
    async load() {
        this.state.loading = true;
        this.state.error = "";
        try {
            this.state.data = await papi("overview");
            pstore.pending = this.state.data.kpi.pending_payments;
        } catch (e) {
            this.state.error = errMessage(e);
        } finally {
            this.state.loading = false;
        }
    }
    num(v) {
        return fmtNum(v, 0);
    }
    pct(v) {
        return fmtPct(v, 1);
    }
    money(v) {
        return money(v, this.state.data.currency);
    }
    date(v) {
        return fmtDate(v);
    }
    share(v) {
        const max = Math.max(1, ...this.state.data.by_plan.map((p) => p.count));
        return Math.round((100 * v) / max);
    }
    get revenue() {
        return this.state.data.revenue.map((r) => {
            const [m, y] = String(r.label).split("/");
            const i = parseInt(m, 10) - 1;
            const known = i >= 0 && i < 12;
            return { value: r.value, label: known ? monthName(i, "short") : r.label, long: known ? `${monthName(i, "long")} ${y}` : r.label };
        });
    }
    weekLabel(label) {
        return `Semaine du ${label}`;
    }
}
