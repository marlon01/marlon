/** @odoo-module */
import { Component, onWillStart, onWillUnmount, useState, xml } from "@odoo/owl";
import { api } from "@selecta_concours/common/rpc";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { ATTEMPT_BADGE, ATTEMPT_LABELS, fmtDateTime, fmtDuration, fmtNum, fmtPct } from "@selecta_concours/common/utils";
import { hasRole } from "@selecta_concours/admin/store";
import { ConcoursPicker } from "@selecta_concours/admin/page_monitor";
import { printMinutes } from "@selecta_concours/admin/print";

export class ResultsPage extends Component {
    static components = { Icon, ConcoursPicker };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div><h1>Résultats</h1><p class="sl-muted">Correction automatique, classement et liste des admis produits en temps réel.</p></div>
                <div class="ad-head-actions"><ConcoursPicker list="state.list" value="props.concoursId" onPick.bind="pick"/></div>
            </header>
            <t t-if="state.data">
                <t t-set="d" t-value="state.data"/>
                <div class="ad-official" t-att-class="d.official ? 'is-official' : d.provisional ? 'is-live' : 'is-closed'">
                    <div class="ad-official-text">
                        <strong t-if="d.official">Procès-verbal officiel, scellé le <t t-esc="date(d.published_date)"/> par <t t-esc="d.published_by"/></strong>
                        <strong t-elif="d.provisional">Liste provisoire : l'épreuve est en cours, le classement évolue à chaque copie corrigée</strong>
                        <strong t-else="">Épreuve clôturée : vérifiez l'analyse IA puis publiez pour sceller la liste</strong>
                        <div t-if="d.official" class="sl-mono ad-small ad-hash">SHA-256 <t t-esc="d.results_hash"/></div>
                    </div>
                    <img t-if="d.qr" t-att-src="d.qr" alt="QR de vérification" class="ad-official-qr"/>
                    <div class="ad-head-actions">
                        <a class="sl-btn" t-att-href="'/selecta/admin/export/' + props.concoursId"><Icon name="'download'"/>Excel</a>
                        <button class="sl-btn" t-on-click="print"><Icon name="'print'"/>Imprimer la liste</button>
                        <a t-if="d.official" class="sl-btn" t-att-href="d.verify_url" target="_blank" rel="noopener"><Icon name="'link'"/>Page de vérification</a>
                        <button t-if="d.provisional and canJury" class="sl-btn sl-btn-danger" t-on-click="() => this.action('close')"><Icon name="'stop'"/>Clôturer</button>
                        <button t-if="d.concours.state == 'closed' and canJury" class="sl-btn sl-btn-primary" t-on-click="() => this.action('publish')"><Icon name="'lock'"/>Publier et sceller</button>
                    </div>
                </div>

                <section class="ad-kpis ad-kpis-tight">
                    <div class="ad-kpi"><span class="sl-figures" t-esc="corrected.length"/><small>copies corrigées</small></div>
                    <div class="ad-kpi is-ok"><span class="sl-figures" t-esc="d.admitted.length"/><small>admis<t t-if="d.concours.places">, sur <t t-esc="d.concours.places"/> places</t></small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="mean"/><small>moyenne</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="best"/><small>meilleur résultat</small></div>
                    <div class="ad-kpi is-danger"><span class="sl-figures" t-esc="countState('disqualified')"/><small>disqualifiés</small></div>
                    <div class="ad-kpi"><span class="sl-figures" t-esc="countState('absent')"/><small>absents</small></div>
                </section>

                <nav class="ad-tabs">
                    <button class="ad-tab" t-att-class="{'is-active': state.view == 'admitted'}" t-on-click="() => this.state.view = 'admitted'">Liste des admis<span class="ad-tab-count" t-esc="d.admitted.length"/></button>
                    <button class="ad-tab" t-att-class="{'is-active': state.view == 'all'}" t-on-click="() => this.state.view = 'all'">Classement complet<span class="ad-tab-count" t-esc="d.rows.length"/></button>
                </nav>
                <section class="ad-panel ad-panel-flush">
                    <table class="ad-table">
                        <thead><tr><th class="num">Rang</th><th>N°</th><th>Candidat</th><th>Salle</th><th>Statut</th><th class="num">Score</th><th class="num">Résultat</th><th>Décision</th><th class="num">Durée</th><th>Empreinte de copie</th></tr></thead>
                        <tbody>
                            <tr t-foreach="visibleRows" t-as="r" t-key="r.id" t-att-class="{'is-admitted': r.admitted}">
                                <td class="num sl-figures" t-esc="r.rank or '—'"/>
                                <td class="sl-mono" t-esc="r.reference"/>
                                <td><strong t-esc="r.candidate"/><div t-if="r.disqualified_reason" class="ad-small ad-danger-text" t-esc="r.disqualified_reason"/></td>
                                <td t-esc="r.room"/>
                                <td><span t-attf-class="sl-badge {{abadge[r.state]}}" t-esc="alabels[r.state]"/></td>
                                <td class="num"><t t-esc="num(r.score)"/> / <t t-esc="num(r.max_score)"/></td>
                                <td class="num"><div class="ad-scorebar"><div t-attf-style="width: {{r.percentage}}%" t-att-class="r.passed ? 'is-ok' : 'is-ko'"/><span class="sl-figures" t-esc="pct(r.percentage)"/></div></td>
                                <td>
                                    <span t-if="r.admitted" class="sl-badge sl-badge-ok">Admis</span>
                                    <span t-elif="r.passed" class="sl-badge sl-badge-info">Seuil atteint</span>
                                    <span t-elif="['submitted','expired'].includes(r.state)" class="sl-badge">Non admis</span>
                                </td>
                                <td class="num sl-figures" t-esc="dur(r.duration)"/>
                                <td class="sl-mono ad-small" t-att-title="r.digest" t-esc="r.digest ? r.digest.slice(0, 16) : '—'"/>
                            </tr>
                        </tbody>
                    </table>
                    <div t-if="!visibleRows.length" class="ad-empty"><p t-esc="state.view == 'admitted' ? 'Aucun candidat admis pour le moment.' : 'Aucune copie.'"/></div>
                </section>
            </t>
            <div t-elif="!props.concoursId" class="ad-empty ad-panel"><p>Choisissez un concours pour afficher son classement.</p></div>
            <div t-else="" class="ad-loading"><span class="sl-spinner"/></div>
        </div>`;
    static props = ["concoursId"];

    setup() {
        this.state = useState({ list: [], data: null, view: "admitted" });
        this.alabels = ATTEMPT_LABELS;
        this.abadge = ATTEMPT_BADGE;
        onWillStart(async () => {
            this.state.list = (await api("concours_list")).filter((c) => ["open", "closed", "published"].includes(c.state));
            if (this.props.concoursId) {
                await this.load();
            }
        });
        this.timer = setInterval(() => this.state.data?.provisional && this.load(), 6000);
        onWillUnmount(() => clearInterval(this.timer));
    }
    async load() {
        try {
            this.state.data = await api("results", [this.props.concoursId]);
        } catch (e) {
            notify(e.message, "danger");
        }
    }
    pick(id) {
        location.hash = `#/results/${id}`;
    }
    get canJury() {
        return hasRole("admin", "jury");
    }
    get corrected() {
        return this.state.data.rows.filter((r) => ["submitted", "expired"].includes(r.state));
    }
    get mean() {
        const c = this.corrected;
        return c.length ? fmtPct(c.reduce((s, r) => s + r.percentage, 0) / c.length, 1) : "—";
    }
    get best() {
        const c = this.corrected;
        return c.length ? fmtPct(Math.max(...c.map((r) => r.percentage)), 1) : "—";
    }
    countState(s) {
        return this.state.data.rows.filter((r) => r.state === s).length;
    }
    get visibleRows() {
        return this.state.view === "admitted" ? this.state.data.admitted : this.state.data.rows;
    }
    pct(v) {
        return fmtPct(v, 1);
    }
    num(v) {
        return fmtNum(v);
    }
    dur(v) {
        return v ? fmtDuration(v) : "—";
    }
    date(v) {
        return fmtDateTime(v);
    }
    print() {
        printMinutes(this.state.data);
    }
    async action(a) {
        const ok = await confirmDialog(
            a === "close"
                ? { title: "Clôturer l'épreuve ?", body: "Les candidats encore en composition seront arrêtés et corrigés sur leurs pages validées.", confirmLabel: "Clôturer", danger: true }
                : { title: "Publier et sceller les résultats ?", body: "Le classement devient officiel et infalsifiable (empreinte SHA-256, QR code de vérification). Cette opération est irréversible.", confirmLabel: "Publier et sceller" }
        );
        if (!ok) {
            return;
        }
        try {
            await api("concours_action", [this.props.concoursId, a]);
            notify(a === "close" ? "Épreuve clôturée, liste des admis produite." : "Résultats publiés et scellés.", "ok", 6000);
            await this.load();
        } catch (e) {
            notify(e.message, "danger", 8000);
        }
    }
}
