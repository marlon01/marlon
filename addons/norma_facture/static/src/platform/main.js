/** @odoo-module */
import { Component, mount, onWillStart, useState, whenReady, xml } from "@odoo/owl";
import { platformApi } from "@norma_facture/common/rpc";
import { confirm, Icon, notify, notifyError, UiHost } from "@norma_facture/common/ui";
import { date } from "@norma_facture/common/format";

class PlatformApp extends Component {
    static template = xml`
        <div class="nm-shell">
            <aside class="nm-nav">
                <div class="nm-nav-brand"><img src="/norma_facture/static/description/icon.png" alt=""/><div class="nm-grow"><b>NORMA</b><small>Administration centrale</small></div></div>
                <nav><div class="nm-nav-group">
                    <a href="#" class="nm-nav-item" t-att-class="{'is-on': state.tab === 'companies'}" t-on-click.prevent="() => this.state.tab = 'companies'"><Icon name="'building'"/><span>Entreprises</span></a>
                    <a href="#" class="nm-nav-item" t-att-class="{'is-on': state.tab === 'taxes'}" t-on-click.prevent="() => this.state.tab = 'taxes'"><Icon name="'chart'"/><span>Groupes de taxation</span></a>
                </div></nav>
                <div class="nm-nav-user"><div class="nm-grow"><b>Naxoris</b><small>Éditeur</small></div><a href="/norma/logout" class="nm-btn nm-btn-ghost nm-btn-icon" aria-label="Se déconnecter"><Icon name="'logout'"/></a></div>
            </aside>
            <div class="nm-main"><div class="nm-page" t-if="state.d">
                <t t-set="d" t-value="state.d"/>
                <t t-if="state.tab === 'companies'">
                    <header class="nm-page-head"><div class="nm-grow"><h1>Entreprises clientes</h1><p>Comptes, établissements et santé de la normalisation.</p></div></header>
                    <div class="nm-kpis">
                        <div class="nm-kpi is-main"><span>Entreprises</span><b class="nm-num" t-esc="d.count"/><small><t t-esc="d.active"/> active(s)</small></div>
                        <div class="nm-kpi"><span>Factures normalisées ce mois</span><b class="nm-num" t-esc="d.invoices_month"/></div>
                        <div class="nm-kpi"><span>Factures en attente</span><b class="nm-num" t-esc="d.attention"/><small>toutes entreprises</small></div>
                        <div class="nm-kpi"><span>Catégories</span><b class="nm-num" t-esc="d.by_category.length"/><small t-esc="d.by_category.map((c) => c.name + ' ' + c.count).join(' · ')"/></div>
                    </div>
                    <div class="nm-filters"><input class="nm-input" style="max-width:320px" placeholder="Nom, NIF, administrateur" t-model="state.q"/></div>
                    <div class="nm-panel nm-table-wrap">
                        <table class="nm-table">
                            <thead><tr><th>Entreprise</th><th>NIF</th><th>Catégorie</th><th>Établissements</th><th class="nm-right">Factures du mois</th><th class="nm-right">En attente</th><th>Inscription</th><th>État</th><th/></tr></thead>
                            <tbody><tr t-foreach="companies" t-as="c" t-key="c.id">
                                <td><b t-esc="c.name"/><div class="nm-muted" style="font-size:12px" t-esc="c.owner"/></td>
                                <td class="nm-mono" t-esc="c.nif"/><td t-esc="c.category"/>
                                <td><t t-esc="c.sites"/> <span class="nm-muted">(<t t-esc="c.sites_prod"/> en production<t t-if="c.sites_error">, <span style="color:var(--bad)"><t t-esc="c.sites_error"/> en erreur</span></t>)</span></td>
                                <td class="nm-right nm-num" t-esc="c.invoices_month"/>
                                <td class="nm-right nm-num"><span t-att-style="c.attention ? 'color:var(--warn);font-weight:700' : ''" t-esc="c.attention"/></td>
                                <td t-esc="date(c.created)"/>
                                <td><span class="nm-tag" t-att-class="c.state === 'active' ? 'nm-tag-ok' : 'nm-tag-bad'" t-esc="c.state === 'active' ? 'Active' : 'Suspendue'"/>
                                    <div t-if="!c.verified" class="nm-muted" style="font-size:12px;margin-top:4px">Non vérifiée : simulation seule</div></td>
                                <td class="nm-row">
                                    <button class="nm-btn nm-btn-sm" t-att-class="c.verified ? '' : 'nm-btn-primary'" t-on-click="() => this.verify(c)" t-esc="c.verified ? 'Retirer la vérification' : 'Vérifier'"/>
                                    <button class="nm-btn nm-btn-sm" t-on-click="() => this.toggle(c)" t-esc="c.state === 'active' ? 'Suspendre' : 'Réactiver'"/>
                                </td>
                            </tr></tbody>
                        </table>
                    </div>
                </t>
                <t t-if="state.tab === 'taxes'">
                    <header class="nm-page-head"><div class="nm-grow"><h1>Groupes de taxation</h1><p>Nomenclature DGI commune à toutes les entreprises. Toute modification s'applique aux factures suivantes ; les factures émises gardent leurs taux.</p></div></header>
                    <div class="nm-panel nm-table-wrap">
                        <table class="nm-table">
                            <thead><tr><th>Code</th><th>Libellé</th><th>Nature</th><th class="nm-right">Taux (%)</th><th>Actif</th><th/></tr></thead>
                            <tbody><tr t-foreach="state.groups" t-as="g" t-key="g.code">
                                <td><span class="nm-group" t-esc="g.code"/></td>
                                <td><input class="nm-input" t-model="g.name"/></td>
                                <td><select class="nm-select" t-model="g.kind"><option value="taxable">Taxable</option><option value="exempt">Exonéré</option><option value="export">Exportation</option><option value="specific">Régime particulier</option></select></td>
                                <td><input class="nm-input nm-num nm-right" type="number" min="0" max="100" step="0.01" style="width:100px" t-model.number="g.rate"/></td>
                                <td><input type="checkbox" t-model="g.active"/></td>
                                <td><button class="nm-btn nm-btn-sm" t-on-click="() => this.saveGroup(g)">Enregistrer</button></td>
                            </tr></tbody>
                        </table>
                    </div>
                </t>
            </div></div>
            <UiHost/>
        </div>`;
    static components = { Icon, UiHost };
    static props = {};
    setup() {
        this.date = date;
        this.state = useState({ d: null, tab: "companies", q: "", groups: [] });
        onWillStart(() => this.load());
    }
    get companies() {
        const q = this.state.q.trim().toLowerCase();
        return this.state.d.companies.filter((c) => !q || [c.name, c.nif, c.owner].some((v) => (v || "").toLowerCase().includes(q)));
    }
    async load() {
        this.state.d = await platformApi("overview");
        this.state.groups = this.state.d.tax_groups.map((g) => ({ ...g }));
    }
    async toggle(c) {
        const next = c.state === "active" ? "suspended" : "active";
        if (!(await confirm(next === "active" ? "Réactiver" : "Suspendre", `${c.name} : ${next === "active" ? "les utilisateurs retrouvent l'accès." : "plus aucune facture ne pourra être émise."}`, { danger: next !== "active" }))) return;
        try { await platformApi("set_state", { company_id: c.id, state: next }); await this.load(); } catch (err) { notifyError(err); }
    }
    async verify(c) {
        const ok = !c.verified;
        const msg = ok ? `Vous avez contrôlé le RCCM, le NIF et le mandat du responsable de ${c.name}. L'entreprise pourra relier l'e-MCF de la DGI.`
            : `${c.name} repassera en simulation sur tous ses établissements.`;
        if (!(await confirm(ok ? "Vérifier l'entreprise" : "Retirer la vérification", msg, { danger: !ok }))) return;
        try { await platformApi("set_verified", { company_id: c.id, verified: ok }); await this.load(); } catch (err) { notifyError(err); }
    }
    async saveGroup(g) {
        try {
            await platformApi("tax_group_save", { code: g.code, name: g.name, rate: g.rate, kind: g.kind, active: g.active });
            notify(`Groupe ${g.code} enregistré.`, "ok");
        } catch (err) { notifyError(err); }
    }
}

whenReady(() => {
    const root = document.getElementById("norma-root");
    root.replaceChildren();
    mount(PlatformApp, root, { dev: false });
});
