/** @odoo-module */
import { Component, onWillStart, onWillUnmount, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { Icon } from "@selecta_concours/common/ui";
import { fmtDateTime, fmtTime, STATE_BADGE, STATE_LABELS } from "@selecta_concours/common/utils";
import { hasRole, store } from "@selecta_concours/admin/store";

export class DashboardPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page">
            <header class="ad-head">
                <div>
                    <h1>Bonjour <t t-esc="firstName"/></h1>
                    <p class="sl-muted">Situation en temps réel des concours de <t t-esc="company"/>.</p>
                </div>
                <div class="ad-head-actions">
                    <a t-if="canCreate" href="#/concours?new=1" class="sl-btn sl-btn-primary"><Icon name="'plus'"/>Nouveau concours</a>
                </div>
            </header>
            <t t-if="state.data">
                <t t-set="k" t-value="state.data.kpi"/>
                <section class="ad-kpis">
                    <div class="ad-kpi is-live"><span class="sl-figures" t-esc="k.in_progress"/><small>candidats en composition</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="k.finished"/><small>copies corrigées</small></div>
                    <div class="ad-kpi is-ok"><span class="sl-figures" t-esc="k.admitted"/><small>candidats ayant réussi</small></div>
                    <div class="ad-kpi is-danger"><span class="sl-figures" t-esc="k.disqualified"/><small>disqualifications</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="k.open"/><small>concours en cours, sur <t t-esc="k.concours"/></small></div>
                </section>

                <div class="ad-grid-2">
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Épreuves en cours</h2><span t-if="state.data.live.length" class="sl-badge sl-badge-live">En direct</span></div>
                        <div t-if="!state.data.live.length" class="ad-empty">
                            <p>Aucune épreuve n'est ouverte. Ouvrez un concours prêt pour permettre aux candidats de se connecter.</p>
                            <a href="#/concours" class="sl-btn sl-btn-sm">Voir les concours</a>
                        </div>
                        <div t-foreach="state.data.live" t-as="c" t-key="c.id" class="ad-live">
                            <div class="ad-live-head">
                                <a t-att-href="'#/monitor/' + c.id" class="ad-live-name" t-esc="c.name"/>
                                <span class="sl-muted sl-mono" t-esc="c.reference"/>
                            </div>
                            <div class="ad-stack" t-att-title="stackTitle(c)">
                                <div class="is-done" t-attf-style="width: {{pct(c.finished, c.candidates)}}%"/>
                                <div class="is-live" t-attf-style="width: {{pct(c.in_progress, c.candidates)}}%"/>
                                <div class="is-danger" t-attf-style="width: {{pct(c.disqualified, c.candidates)}}%"/>
                            </div>
                            <div class="ad-live-legend">
                                <span><i class="dot is-done"/>Terminé <b t-esc="c.finished"/></span>
                                <span><i class="dot is-live"/>En cours <b t-esc="c.in_progress"/></span>
                                <span><i class="dot is-danger"/>Disqualifiés <b t-esc="c.disqualified"/></span>
                                <span>Inscrits <b t-esc="c.candidates"/></span>
                                <a t-att-href="'#/monitor/' + c.id" class="ad-link">Surveiller</a>
                            </div>
                        </div>
                    </section>

                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Incidents des dernières 24 h</h2></div>
                        <div t-if="!state.data.events.length" class="ad-empty"><p>Aucun incident signalé par la surveillance.</p></div>
                        <ul class="ad-events">
                            <li t-foreach="state.data.events" t-as="e" t-key="e.id" t-att-class="'is-' + e.severity">
                                <img t-if="e.snapshot" t-att-src="e.snapshot" alt="" loading="lazy"/>
                                <div t-else="" class="ad-events-noimg"><Icon name="'alert'"/></div>
                                <div class="sl-grow">
                                    <div><strong t-esc="e.candidate"/> <span class="sl-muted" t-esc="e.reference"/></div>
                                    <div t-esc="e.label"/>
                                    <div class="sl-muted ad-small"><t t-esc="time(e.date)"/>, <t t-esc="e.concours"/></div>
                                </div>
                                <span t-if="e.action == 'disqualified'" class="sl-badge sl-badge-danger">Disqualifié</span>
                                <span t-elif="e.action == 'warning'" class="sl-badge sl-badge-warn">Avertissement</span>
                            </li>
                        </ul>
                    </section>
                </div>

                <section class="ad-panel">
                    <div class="ad-panel-head"><h2>Concours récents</h2><a href="#/concours" class="ad-link">Tous les concours</a></div>
                    <table class="ad-table">
                        <thead><tr><th>Concours</th><th>État</th><th>Ouverture</th><th class="num">Inscrits</th><th class="num">Corrigés</th><th class="num">Réussis</th></tr></thead>
                        <tbody>
                            <tr t-foreach="state.data.recent" t-as="c" t-key="c.id" class="is-link" t-on-click="() => this.open(c)">
                                <td><strong t-esc="c.name"/><div class="sl-muted sl-mono ad-small" t-esc="c.reference"/></td>
                                <td><span t-attf-class="sl-badge {{badge[c.state]}}" t-esc="labels[c.state]"/></td>
                                <td t-esc="date(c.date_start)"/>
                                <td class="num" t-esc="c.candidates"/>
                                <td class="num" t-esc="c.finished"/>
                                <td class="num" t-esc="c.passed"/>
                            </tr>
                        </tbody>
                    </table>
                    <div t-if="!state.data.recent.length" class="ad-empty"><p>Créez votre premier concours pour commencer.</p></div>
                </section>
            </t>
            <div t-else="" class="ad-loading"><span class="sl-spinner"/></div>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({ data: null });
        this.labels = STATE_LABELS;
        this.badge = STATE_BADGE;
        onWillStart(() => this.load());
        this.timer = setInterval(() => this.load(), 10000);
        onWillUnmount(() => clearInterval(this.timer));
    }
    async load() {
        this.state.data = await api("dashboard");
    }
    get firstName() {
        return (store.session.name || "").split(" ")[0];
    }
    get company() {
        return store.session.company.name;
    }
    get canCreate() {
        return hasRole("admin");
    }
    pct(a, b) {
        return b ? Math.round((100 * a) / b) : 0;
    }
    stackTitle(c) {
        return `${c.finished} terminés, ${c.in_progress} en cours, ${c.disqualified} disqualifiés sur ${c.candidates} inscrits`;
    }
    date(v) {
        return fmtDateTime(v);
    }
    time(v) {
        return fmtTime(v);
    }
    open(c) {
        location.hash = c.state === "open" && hasRole("surveillant") ? `#/monitor/${c.id}` : `#/concours/${c.id}`;
    }
}
