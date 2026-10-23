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
                    <a href="#" class="nm-nav-item" t-att-class="{'is-on': state.tab === 'payments'}" t-on-click.prevent="() => this.state.tab = 'payments'"><Icon name="'key'"/><span>Paiements<t t-if="state.d and state.d.payments.length"> (<t t-esc="state.d.payments.length"/>)</t></span></a>
                    <a href="#" class="nm-nav-item" t-att-class="{'is-on': state.tab === 'plans'}" t-on-click.prevent="() => this.state.tab = 'plans'"><Icon name="'box'"/><span>Formules et réglages</span></a>
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
                        <div class="nm-kpi"><span>Revenu mensuel récurrent</span><b class="nm-num"><t t-esc="d.mrr"/> $</b><small><t t-esc="d.paying"/> abonnée(s) · <t t-esc="d.trials"/> en essai · <t t-esc="d.expired"/> échue(s)</small></div>
                        <div class="nm-kpi"><span>Encaissé ce mois</span><b class="nm-num"><t t-esc="d.collected_month"/> $</b><small><t t-esc="d.payments.length"/> paiement(s) à valider</small></div>
                        <div class="nm-kpi"><span>Factures normalisées ce mois</span><b class="nm-num" t-esc="d.invoices_month"/><small><t t-esc="d.attention"/> en attente DGI</small></div>
                    </div>
                    <div class="nm-filters"><input class="nm-input" style="max-width:320px" placeholder="Nom, NIF, administrateur" t-model="state.q"/></div>
                    <div class="nm-panel nm-table-wrap">
                        <table class="nm-table">
                            <thead><tr><th>Entreprise</th><th>Abonnement</th><th>Activité</th><th>État</th><th class="nm-right">Actions</th></tr></thead>
                            <tbody><tr t-foreach="companies" t-as="c" t-key="c.id">
                                <td><b t-esc="c.name"/><div class="nm-muted" style="font-size:12px">NIF <span class="nm-mono" t-esc="c.nif"/> · <t t-esc="c.category"/></div>
                                    <div class="nm-muted" style="font-size:12px"><t t-esc="c.owner"/> · inscrite le <t t-esc="date(c.created)"/></div></td>
                                <td><span class="nm-tag" t-att-class="subTag(c)[1]" t-esc="subTag(c)[0]"/>
                                    <div class="nm-muted" style="font-size:12px"><t t-esc="c.monthly"/> $/mois · <t t-esc="c.period_end ? 'payé jusqu’au ' + date(c.period_end) : 'essai jusqu’au ' + date(c.trial_end)"/></div></td>
                                <td><span class="nm-num" t-esc="c.invoices_month"/> facture(s) ce mois
                                    <div class="nm-muted" style="font-size:12px"><t t-esc="c.sites"/> établissement(s), <t t-esc="c.sites_prod"/> en production<t t-if="c.sites_error"> · <span style="color:var(--bad)"><t t-esc="c.sites_error"/> en erreur</span></t><t t-if="c.attention"> · <span style="color:var(--warn);font-weight:700"><t t-esc="c.attention"/> en attente DGI</span></t></div></td>
                                <td><span class="nm-tag" t-att-class="c.state === 'active' ? 'nm-tag-ok' : 'nm-tag-bad'" t-esc="c.state === 'active' ? 'Active' : 'Suspendue'"/>
                                    <div class="nm-muted" style="font-size:12px;margin-top:4px" t-esc="c.verified ? 'Vérifiée' : 'Non vérifiée : simulation seule'"/></td>
                                <td><div class="nm-row nm-wrap" style="justify-content:flex-end">
                                    <button class="nm-btn nm-btn-sm" t-att-class="c.verified ? '' : 'nm-btn-primary'" t-on-click="() => this.verify(c)" t-esc="c.verified ? 'Retirer la vérification' : 'Vérifier'"/>
                                    <button class="nm-btn nm-btn-sm" t-on-click="() => this.extend(c)">Prolonger l'essai</button>
                                    <button class="nm-btn nm-btn-sm" t-on-click="() => this.toggle(c)" t-esc="c.state === 'active' ? 'Suspendre' : 'Réactiver'"/>
                                </div></td>
                            </tr></tbody>
                        </table>
                    </div>
                </t>
                <t t-if="state.tab === 'payments'">
                    <header class="nm-page-head"><div class="nm-grow"><h1>Paiements Mobile Money</h1><p>Contrôlez la référence sur le relevé de l'opérateur avant de valider : l'abonnement est prolongé aussitôt.</p></div></header>
                    <div class="nm-panel nm-table-wrap">
                        <table class="nm-table">
                            <thead><tr><th>Date</th><th>Entreprise</th><th>Formule</th><th>Moyen</th><th>Numéro</th><th>Référence</th><th class="nm-right">Montant</th><th/></tr></thead>
                            <tbody><tr t-foreach="d.payments" t-as="p" t-key="p.id">
                                <td t-esc="date(p.date)"/><td><b t-esc="p.company"/><div class="nm-muted" style="font-size:12px" t-esc="p.declared_by"/></td>
                                <td><t t-esc="p.plan"/> · <t t-esc="p.months"/> mois<t t-if="p.extra_sites"> · +<t t-esc="p.extra_sites"/> site(s)</t></td>
                                <td t-esc="p.method_label"/><td t-esc="p.payer_phone"/><td class="nm-mono"><t t-esc="p.reference"/><div t-if="p.has_proof"><a t-att-href="'/norma/platform/proof/' + p.id" target="_blank" rel="noopener">Justificatif</a></div></td>
                                <td class="nm-right nm-num"><t t-esc="p.amount"/> $</td>
                                <td class="nm-row"><button class="nm-btn nm-btn-sm nm-btn-primary" t-on-click="() => this.decide(p, true)">Valider</button><button class="nm-btn nm-btn-sm nm-btn-danger" t-on-click="() => this.decide(p, false)">Refuser</button></td>
                            </tr></tbody>
                        </table>
                        <div t-if="!d.payments.length" class="nm-empty">Aucun paiement à valider.</div>
                    </div>
                    <h2 style="font-size:17px;margin:22px 0 10px">Derniers paiements traités</h2>
                    <div class="nm-panel nm-table-wrap"><table class="nm-table"><tbody>
                        <tr t-foreach="d.recent_payments" t-as="p" t-key="p.id"><td t-esc="date(p.date)"/><td t-esc="p.company"/><td class="nm-mono" t-esc="p.number or p.reference"/>
                            <td><span class="nm-tag" t-att-class="p.state === 'validated' ? 'nm-tag-ok' : 'nm-tag-bad'" t-esc="p.state === 'validated' ? 'Validé' : 'Refusé'"/></td><td class="nm-right nm-num"><t t-esc="p.amount"/> $</td></tr>
                    </tbody></table></div>
                </t>
                <t t-if="state.tab === 'plans'">
                    <header class="nm-page-head"><div class="nm-grow"><h1>Formules et réglages</h1><p>Un prix par catégorie d'activité. Des prix bas pour équiper le plus grand nombre d'entreprises.</p></div></header>
                    <div class="nm-panel nm-table-wrap" style="margin-bottom:16px">
                        <table class="nm-table">
                            <thead><tr><th>Catégorie</th><th>Nom</th><th class="nm-right">Mensuel ($)</th><th class="nm-right">Annuel ($)</th><th class="nm-right">Sites inclus</th><th class="nm-right">Site en plus ($/mois)</th><th>Argument</th><th>Active</th><th/></tr></thead>
                            <tbody><tr t-foreach="state.plans" t-as="p" t-key="p.id">
                                <td t-esc="p.category_name"/><td><input class="nm-input" t-model="p.name"/></td>
                                <td><input class="nm-input nm-num nm-right" type="number" min="0" step="0.5" style="width:90px" t-model.number="p.price_month"/></td>
                                <td><input class="nm-input nm-num nm-right" type="number" min="0" step="1" style="width:90px" t-model.number="p.price_year"/></td>
                                <td><input class="nm-input nm-num nm-right" type="number" min="1" style="width:70px" t-model.number="p.sites_included"/></td>
                                <td><input class="nm-input nm-num nm-right" type="number" min="0" step="0.5" style="width:80px" t-model.number="p.extra_site_price"/></td>
                                <td><input class="nm-input" t-model="p.highlight"/></td><td><input type="checkbox" t-model="p.active"/></td>
                                <td><button class="nm-btn nm-btn-sm" t-on-click="() => this.savePlan(p)">Enregistrer</button></td>
                            </tr></tbody>
                        </table>
                    </div>
                    <div class="nm-panel nm-panel-body nm-grid-2" style="max-width:820px" t-if="state.settings">
                        <label class="nm-field"><span>Durée de l'essai gratuit (jours)</span><input class="nm-input" type="number" min="0" max="90" t-model.number="state.settings.trial_days"/></label>
                        <label class="nm-field"><span>Délai de grâce après l'échéance (jours)</span><input class="nm-input" type="number" min="0" max="60" t-model.number="state.settings.grace_days"/></label>
                        <label class="nm-field nm-span-2"><span>Instructions de paiement (numéros Mobile Money, bénéficiaire)</span><textarea class="nm-textarea" t-model="state.settings.pay_instructions"/></label>
                        <div><button class="nm-btn nm-btn-primary" t-on-click="saveSettings">Enregistrer les réglages</button></div>
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
        this.state = useState({ d: null, tab: "companies", q: "", groups: [], plans: [], settings: null });
        onWillStart(() => this.load());
    }
    get companies() {
        const q = this.state.q.trim().toLowerCase();
        return this.state.d.companies.filter((c) => !q || [c.name, c.nif, c.owner].some((v) => (v || "").toLowerCase().includes(q)));
    }
    async load() {
        this.state.d = await platformApi("overview");
        this.state.groups = this.state.d.tax_groups.map((g) => ({ ...g }));
        this.state.plans = this.state.d.plans.map((p) => ({ ...p }));
        this.state.settings = { ...this.state.d.settings };
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
    subTag(c) {
        return { trial: ["Essai", "nm-tag-info"], active: ["Payé", "nm-tag-ok"], grace: ["Grâce", "nm-tag-warn"], expired: ["Échu", "nm-tag-bad"] }[c.sub_state] || ["", ""];
    }
    async decide(p, ok) {
        let reason = "";
        if (ok) {
            if (!(await confirm("Valider le paiement", `${p.company} : ${p.amount} $ (${p.months} mois), référence ${p.reference}. Vous l'avez retrouvé sur le relevé de l'opérateur ?`, { confirm: "Valider" }))) return;
        } else {
            reason = await confirm("Refuser le paiement", "L'entreprise verra le motif.", { input: "Motif du refus", danger: true, confirm: "Refuser" });
            if (!reason) return;
        }
        try { this.state.d = await platformApi("payment_decide", { payment_id: p.id, approve: ok, reason }); notify(ok ? "Paiement validé, abonnement prolongé." : "Paiement refusé.", "ok"); }
        catch (err) { notifyError(err); }
    }
    async extend(c) {
        const days = await confirm("Prolonger l'essai", c.name, { input: "Nombre de jours (1 à 90)", confirm: "Prolonger" });
        if (!days) return;
        try { this.state.d = await platformApi("extend_trial", { company_id: c.id, days: parseInt(days) }); notify("Essai prolongé.", "ok"); }
        catch (err) { notifyError(err); }
    }
    async savePlan(p) {
        try { this.state.plans = (await platformApi("plan_save", { ...p })).map((x) => ({ ...x })); notify(`Formule ${p.name} enregistrée.`, "ok"); }
        catch (err) { notifyError(err); }
    }
    async saveSettings() {
        try { this.state.settings = await platformApi("settings_save", { ...this.state.settings }); notify("Réglages enregistrés.", "ok"); }
        catch (err) { notifyError(err); }
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
