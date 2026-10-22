/** @odoo-module */
import { Component, onWillStart, onWillUnmount, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { ATTEMPT_BADGE, ATTEMPT_LABELS, fmtDuration, fmtPct, fmtTime } from "@selecta_concours/common/utils";
import { hasRole } from "@selecta_concours/admin/store";

/** Sélecteur de concours partagé par les pages Surveillance, Résultats et Analyse. */
export class ConcoursPicker extends Component {
    static template = xml`
        <select class="sl-select ad-picker" t-on-change="onChange" aria-label="Concours">
            <option value="0" t-att-selected="!props.value">Choisir un concours</option>
            <option t-foreach="sorted" t-as="c" t-key="c.id" t-att-value="c.id" t-att-selected="c.id == props.value">
                <t t-esc="c.name"/> (<t t-esc="labels[c.state]"/>)
            </option>
        </select>`;
    static props = ["list", "value", "onPick"];
    setup() {
        this.labels = { draft: "préparation", ready: "prêt", open: "en cours", closed: "clôturé", published: "publié" };
    }
    onChange(ev) {
        this.props.onPick(Number(ev.target.value));
    }
    get sorted() {
        const order = { open: 0, closed: 1, ready: 2, published: 3, draft: 4 };
        return [...this.props.list].sort((a, b) => order[a.state] - order[b.state]);
    }
}

export class MonitorPage extends Component {
    static components = { Icon, ConcoursPicker };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div>
                    <h1>Surveillance en direct</h1>
                    <p class="sl-muted">Actualisation automatique toutes les 4 secondes<t t-if="state.updated">, dernière à <t t-esc="state.updated"/></t>.</p>
                </div>
                <div class="ad-head-actions"><ConcoursPicker list="state.list" value="props.concoursId" onPick.bind="pick"/></div>
            </header>
            <t t-if="state.data">
                <t t-set="d" t-value="state.data"/>
                <section class="ad-kpis ad-kpis-tight">
                    <div class="ad-kpi"><span class="sl-figures" t-esc="d.not_logged"/><small>pas encore connectés</small></div>
                    <div class="ad-kpi is-live"><span class="sl-figures" t-esc="count('in_progress')"/><small>en composition</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="count('submitted') + count('expired')"/><small>terminés</small></div>
                    <div class="ad-kpi is-warn"><span class="sl-figures" t-esc="withWarnings"/><small>avec avertissement</small></div>
                    <div class="ad-kpi is-danger"><span class="sl-figures" t-esc="count('disqualified')"/><small>disqualifiés</small></div>
                    <div class="ad-kpi" t-att-class="offline ? 'is-warn' : ''"><span class="sl-figures" t-esc="offline"/><small>postes sans signal</small></div>
                </section>
                <div t-if="d.state != 'open'" class="sl-alert sl-alert-info ad-mb">Ce concours n'est pas en cours : la vue est figée.</div>
                <div class="ad-monitor">
                    <section>
                        <div class="ad-filters">
                            <button t-foreach="filters" t-as="f" t-key="f.key" class="ad-chip" t-att-class="{'is-active': state.filter == f.key}" t-on-click="() => this.state.filter = f.key" t-esc="f.label"/>
                            <div class="ad-search ad-search-sm"><Icon name="'search'" size="14"/><input class="sl-input" placeholder="Nom, numéro, salle" t-model="state.search"/></div>
                        </div>
                        <div class="ad-tiles">
                            <article t-foreach="rows" t-as="r" t-key="r.id" class="ad-tile" t-att-class="'is-' + r.state + (r.warnings ? ' has-warn' : '') + (r.state == 'in_progress' and !r.online ? ' is-offline' : '')">
                                <div class="ad-tile-head">
                                    <img t-if="r.photo" t-att-src="r.photo" class="ad-tile-photo" alt=""/>
                                    <div t-else="" class="ad-tile-photo ad-tile-nophoto"><Icon name="'user'"/></div>
                                    <div class="sl-grow">
                                        <div class="ad-tile-name" t-esc="r.candidate"/>
                                        <div class="sl-muted ad-small"><span class="sl-mono" t-esc="r.reference"/><t t-if="r.room">, <t t-esc="r.room"/></t></div>
                                    </div>
                                    <span t-attf-class="sl-badge {{abadge[r.state]}}" t-esc="alabels[r.state]"/>
                                </div>
                                <t t-if="r.state == 'in_progress'">
                                    <div class="ad-tile-progress"><div t-attf-style="width: {{r.progress}}%"/></div>
                                    <div class="ad-tile-facts">
                                        <span>Page <b t-esc="r.page + 1"/>/<t t-esc="r.pages"/></span>
                                        <span class="sl-figures" t-att-class="{'is-urgent': r.remaining lt 300}"><Icon name="'clock'" size="13"/><t t-esc="dur(r.remaining)"/></span>
                                        <span t-att-class="{'is-warn': r.warnings}"><Icon name="'alert'" size="13"/><t t-esc="r.warnings"/>/<t t-esc="d.max_warnings"/></span>
                                        <span t-att-class="r.online ? 'is-ok' : 'is-warn'"><Icon name="r.online ? 'wifi' : 'wifiOff'" size="13"/><t t-esc="r.online ? 'en ligne' : 'sans signal'"/></span>
                                    </div>
                                </t>
                                <div t-elif="r.state == 'submitted' or r.state == 'expired'" class="ad-tile-result" t-att-class="r.passed ? 'is-ok' : 'is-ko'">
                                    <span class="sl-figures" t-esc="pct(r.percentage)"/><span t-esc="r.passed ? 'Réussi' : 'Échoué'"/>
                                </div>
                                <div t-elif="r.state == 'disqualified'" class="ad-tile-disq" t-esc="r.disqualified_reason"/>
                                <div t-if="r.last_event and r.state == 'in_progress'" class="ad-tile-event" t-att-class="'is-' + r.last_event.severity">
                                    <t t-esc="r.last_event.label"/>, <t t-esc="time(r.last_event.date)"/>
                                </div>
                                <div class="ad-tile-actions">
                                    <button class="sl-btn sl-btn-sm sl-btn-ghost" t-on-click="() => this.showEvents(r)"><Icon name="'eye'" size="14"/>Incidents</button>
                                    <t t-if="canAct and (r.state == 'in_progress' or r.state == 'ready')">
                                        <button class="sl-btn sl-btn-sm sl-btn-ghost" t-att-disabled="r.allow_resume" t-on-click="() => this.resume(r)" title="Autorise une nouvelle connexion (panne de poste)"><Icon name="'unlock'" size="14"/><t t-esc="r.allow_resume ? 'Reprise autorisée' : 'Autoriser la reprise'"/></button>
                                        <button class="sl-btn sl-btn-sm sl-btn-ghost ad-danger-text" t-on-click="() => this.disqualify(r)"><Icon name="'flag'" size="14"/>Disqualifier</button>
                                    </t>
                                </div>
                            </article>
                        </div>
                        <div t-if="!rows.length" class="ad-empty"><p>Aucun candidat dans cette catégorie. Les candidats apparaissent dès qu'ils saisissent leur code.</p></div>
                    </section>
                    <aside class="ad-panel ad-feed">
                        <div class="ad-panel-head"><h2>Fil des incidents</h2></div>
                        <div t-if="!d.events.length" class="ad-empty"><p>Aucun incident.</p></div>
                        <ul class="ad-events">
                            <li t-foreach="d.events" t-as="e" t-key="e.id" t-att-class="'is-' + e.severity">
                                <img t-if="e.snapshot" t-att-src="e.snapshot" alt="" loading="lazy" class="is-zoomable" t-on-click="() => this.state.zoom = e"/>
                                <div t-else="" class="ad-events-noimg"><Icon name="'alert'"/></div>
                                <div class="sl-grow">
                                    <div><strong t-esc="e.candidate"/></div>
                                    <div t-esc="e.label"/>
                                    <div class="sl-muted ad-small"><t t-esc="time(e.date)"/><t t-if="e.description">, <t t-esc="e.description"/></t></div>
                                </div>
                                <span t-if="e.action == 'disqualified'" class="sl-badge sl-badge-danger">Disqualifié</span>
                                <span t-elif="e.action == 'warning'" class="sl-badge sl-badge-warn">Avertissement</span>
                            </li>
                        </ul>
                    </aside>
                </div>
            </t>
            <div t-elif="!props.concoursId" class="ad-empty ad-panel"><p>Choisissez un concours en cours pour suivre les candidats en temps réel.</p></div>
            <div t-else="" class="ad-loading"><span class="sl-spinner"/></div>

            <div t-if="state.events" class="sl-overlay" t-on-click.self="() => this.state.events = null">
                <div class="sl-dialog sl-dialog-wide">
                    <div class="sl-dialog-head"><h3>Incidents de <t t-esc="state.eventsFor"/></h3></div>
                    <div class="sl-dialog-body">
                        <div t-if="!state.events.length" class="ad-empty"><p>Aucun événement enregistré.</p></div>
                        <div class="ad-evgrid">
                            <figure t-foreach="state.events" t-as="e" t-key="e.id" t-att-class="'is-' + e.severity">
                                <img t-if="e.snapshot" t-att-src="e.snapshot" alt=""/>
                                <figcaption><strong t-esc="e.label"/><div class="ad-small"><t t-esc="time(e.date)"/>, <t t-esc="e.description"/></div></figcaption>
                            </figure>
                        </div>
                    </div>
                    <div class="sl-dialog-foot"><button class="sl-btn" t-on-click="() => this.state.events = null">Fermer</button></div>
                </div>
            </div>
            <div t-if="state.zoom" class="sl-overlay" t-on-click="() => this.state.zoom = null">
                <figure class="ad-zoom"><img t-att-src="state.zoom.snapshot" alt=""/><figcaption><strong t-esc="state.zoom.candidate"/>, <t t-esc="state.zoom.label"/>, <t t-esc="time(state.zoom.date)"/></figcaption></figure>
            </div>
        </div>`;
    static props = ["concoursId"];

    setup() {
        this.state = useState({ list: [], data: null, filter: "active", search: "", events: null, eventsFor: "", zoom: null, updated: "" });
        this.alabels = ATTEMPT_LABELS;
        this.abadge = ATTEMPT_BADGE;
        this.filters = [
            { key: "active", label: "En composition" }, { key: "alerts", label: "Avec alertes" },
            { key: "done", label: "Terminés" }, { key: "disqualified", label: "Disqualifiés" }, { key: "all", label: "Tous" },
        ];
        onWillStart(async () => {
            this.state.list = await api("concours_list");
            if (!this.props.concoursId) {
                const open = this.state.list.find((c) => c.state === "open");
                if (open) {
                    location.hash = `#/monitor/${open.id}`;
                    return;
                }
            } else {
                await this.load();
            }
        });
        this.timer = setInterval(() => this.props.concoursId && this.load(), 4000);
        onWillUnmount(() => clearInterval(this.timer));
    }
    async load() {
        try {
            this.state.data = await api("monitor", [this.props.concoursId]);
            this.state.updated = new Date().toLocaleTimeString("fr-FR");
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    pick(id) {
        location.hash = `#/monitor/${id}`;
    }
    get canAct() {
        return hasRole("admin", "surveillant") && this.state.data?.state === "open";
    }
    count(state) {
        return this.state.data.rows.filter((r) => r.state === state).length;
    }
    get withWarnings() {
        return this.state.data.rows.filter((r) => r.warnings && r.state === "in_progress").length;
    }
    get offline() {
        return this.state.data.rows.filter((r) => r.state === "in_progress" && !r.online).length;
    }
    get rows() {
        const s = this.state.search.toLowerCase();
        const f = this.state.filter;
        return this.state.data.rows.filter((r) => {
            if (s && !`${r.candidate} ${r.reference} ${r.room}`.toLowerCase().includes(s)) {
                return false;
            }
            if (f === "active") {
                return ["in_progress", "ready"].includes(r.state);
            }
            if (f === "alerts") {
                return r.warnings > 0 || r.state === "disqualified" || (r.state === "in_progress" && !r.online);
            }
            if (f === "done") {
                return ["submitted", "expired"].includes(r.state);
            }
            if (f === "disqualified") {
                return r.state === "disqualified";
            }
            return true;
        });
    }
    dur(s) {
        return fmtDuration(s);
    }
    pct(v) {
        return fmtPct(v, 1);
    }
    time(v) {
        return fmtTime(v);
    }
    async showEvents(r) {
        this.state.eventsFor = r.candidate;
        this.state.events = await api("attempt_events", [r.id]);
    }
    async resume(r) {
        const ok = await confirmDialog({
            title: `Autoriser la reprise pour ${r.candidate} ?`,
            body: "À utiliser uniquement en cas de panne du poste. Le candidat pourra se reconnecter une seule fois avec son code, sur n'importe quel poste. Son visage sera de nouveau vérifié. Le chronomètre n'est pas suspendu.",
            confirmLabel: "Autoriser la reprise",
        });
        if (ok) {
            await api("attempt_action", [r.id, "resume"]);
            notify("Reprise autorisée.", "ok");
            this.load();
        }
    }
    async disqualify(r) {
        const reason = await confirmDialog({
            title: `Disqualifier ${r.candidate} ?`,
            body: "La décision est immédiate, définitive et consignée dans le journal d'audit avec votre identité.",
            confirmLabel: "Disqualifier",
            danger: true,
            input: { label: "Motif (obligatoire)", placeholder: "Ex. : téléphone portable constaté par le surveillant", minLength: 5 },
        });
        if (reason) {
            try {
                await api("attempt_action", [r.id, "disqualify", reason]);
                notify("Candidat disqualifié.", "warn");
                this.load();
            } catch (e) {
                notify(e.message, "danger");
            }
        }
    }
}
