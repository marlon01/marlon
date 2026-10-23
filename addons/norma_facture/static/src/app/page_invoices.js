/** @odoo-module */
import { Component, onWillStart, onWillUpdateProps, useState, xml } from "@odoo/owl";
import { api, newKey } from "@norma_facture/common/rpc";
import { BusyButton, confirm, Dialog, Icon, notify, notifyError, openDialog } from "@norma_facture/common/ui";
import { dateTime, money, qty } from "@norma_facture/common/format";
import { can, payLabel, session } from "@norma_facture/app/store";
import { IssuedDialog, PageHead, printInvoice, StateTag, TypeTag } from "@norma_facture/app/components";

class CreditNoteDialog extends Component {
    static template = xml`
        <Dialog title="'Facture d’avoir sur ' + props.invoice.number" size="'lg'" onClose="() => props.close(null)">
            <div class="nm-grid-2" style="margin-bottom:14px">
                <label class="nm-field"><span>Nature de l'avoir</span>
                    <select class="nm-select" t-model="state.reference_type">
                        <option t-foreach="types" t-as="t" t-key="t.code" t-att-value="t.code"><t t-esc="t.code"/> — <t t-esc="t.label"/></option>
                    </select></label>
                <label class="nm-field"><span>Remboursement</span>
                    <select class="nm-select" t-model="state.method">
                        <option t-foreach="methods" t-as="m" t-key="m.code" t-att-value="m.code" t-esc="m.label"/>
                    </select></label>
                <label class="nm-field nm-span-2"><span>Motif (imprimé et transmis à la DGI)</span><input class="nm-input" t-model="state.reason" maxlength="200" placeholder="Retour de marchandise, erreur de prix…"/></label>
            </div>
            <table class="nm-table">
                <thead><tr><th>Article</th><th class="nm-right">Facturé</th><th class="nm-right">Remboursable</th><th class="nm-right">À rembourser</th><th class="nm-right">Montant</th></tr></thead>
                <tbody>
                    <tr t-foreach="props.invoice.lines" t-as="l" t-key="l.id">
                        <td><t t-esc="l.name"/> <span class="nm-group" t-esc="l.tax_group"/></td>
                        <td class="nm-right nm-num" t-esc="qty(l.quantity)"/>
                        <td class="nm-right nm-num" t-esc="qty(l.refundable)"/>
                        <td class="nm-right"><input class="nm-input nm-num nm-right" type="number" min="0" t-att-max="l.refundable" step="any" style="width:100px"
                                                    t-att-disabled="l.refundable &lt;= 0" t-model.number="state.qty[l.id]"/></td>
                        <td class="nm-right nm-num" t-esc="money((state.qty[l.id] || 0) * l.net_price)"/>
                    </tr>
                </tbody>
            </table>
            <div class="nm-row" style="justify-content:space-between;margin-top:12px">
                <button class="nm-btn nm-btn-sm" t-on-click="all">Tout rembourser</button>
                <b class="nm-num">Total de l'avoir : <t t-esc="money(total)"/> CDF</b>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-gold'" disabled="!total or state.reason.trim().length &lt; 3" onClick.bind="save">Émettre l'avoir normalisé</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() {
        this.money = money;
        this.qty = qty;
        this.types = session.reference_types;
        this.methods = session.payment_methods.filter((m) => m.code !== "CREDIT");
        this.state = useState({ reference_type: "RAM", method: "ESPECES", reason: "", qty: {} });
    }
    get total() {
        return Math.round(this.props.invoice.lines.reduce((s, l) => s + (Number(this.state.qty[l.id]) || 0) * l.net_price, 0) * 100) / 100;
    }
    all() {
        for (const l of this.props.invoice.lines) this.state.qty[l.id] = l.refundable;
        if (!this.state.reason) this.state.reason = "Annulation de la facture";
        this.state.reference_type = "RAN";
    }
    async save() {
        const lines = this.props.invoice.lines.filter((l) => Number(this.state.qty[l.id]) > 0)
            .map((l) => ({ line_id: l.id, quantity: Number(this.state.qty[l.id]) }));
        this.key = this.key || newKey();
        const credit = await api("credit_note", { request_key: this.key, id: this.props.invoice.id, lines, reference_type: this.state.reference_type,
            reason: this.state.reason, payment_method: this.state.method });
        this.props.close(credit);
    }
}

export class InvoiceDetail extends Component {
    static template = xml`
        <div class="nm-page" t-if="state.inv">
            <t t-set="inv" t-value="state.inv"/>
            <PageHead title="inv.number" subtitle="(inv.client_name or 'Client comptant') + ' · ' + dateTime(inv.date)">
                <a class="nm-btn" href="#/invoices"><Icon name="'undo'"/> Registre</a>
                <button class="nm-btn" t-on-click="() => this.print('a4')"><Icon name="'print'"/> A4</button>
                <button class="nm-btn" t-on-click="() => this.print('ticket')"><Icon name="'receipt'"/> Ticket</button>
                <button t-if="canCredit" class="nm-btn nm-btn-gold" t-on-click="credit"><Icon name="'undo'"/> Facture d'avoir</button>
            </PageHead>
            <div class="nm-detail">
                <div class="nm-stack">
                    <div t-if="inv.state === 'failed'" class="nm-note" t-att-class="inv.emcf_blocked ? 'nm-note-bad' : 'nm-note-warn'">
                        <b t-esc="inv.emcf_blocked ? 'Refusée par la DGI ou écart de calcul' : 'En attente de normalisation'"/>
                        <div t-esc="inv.emcf_error"/>
                        <div class="nm-row" style="margin-top:10px">
                            <BusyButton class="'nm-btn-sm'" icon="'refresh'" onClick.bind="retry">Réessayer maintenant</BusyButton>
                            <BusyButton t-if="can('manager')" class="'nm-btn-sm nm-btn-danger'" onClick.bind="abandon">Abandonner</BusyButton>
                        </div>
                    </div>
                    <div t-if="inv.state === 'uncertain'" class="nm-note nm-note-bad">
                        <b>Confirmation à vérifier</b>
                        <div>La confirmation a été envoyée à la DGI sans réponse. Ne refacturez pas : vérifiez d'abord sur le portail de la DGI.</div>
                        <div t-esc="inv.emcf_error" style="margin-top:4px"/>
                        <div class="nm-row" style="margin-top:10px" t-if="can('manager')">
                            <BusyButton class="'nm-btn-sm'" icon="'refresh'" onClick.bind="checkUncertain">Interroger la DGI</BusyButton>
                            <BusyButton class="'nm-btn-sm nm-btn-danger'" onClick.bind="release">Absente du portail DGI : renvoyer</BusyButton>
                        </div>
                    </div>
                    <div class="nm-panel">
                        <div class="nm-table-wrap">
                            <table class="nm-table">
                                <thead><tr><th>Désignation</th><th>Gr.</th><th class="nm-right">Qté</th><th class="nm-right">P.U. TTC (CDF)</th><th class="nm-right">Remise</th><th class="nm-right">Montant (CDF)</th></tr></thead>
                                <tbody>
                                    <tr t-foreach="inv.lines" t-as="l" t-key="l.id">
                                        <td t-esc="l.name"/><td><span class="nm-group" t-esc="l.tax_group"/></td>
                                        <td class="nm-right nm-num" t-esc="qty(l.quantity)"/><td class="nm-right nm-num" t-esc="money(l.unit_price)"/>
                                        <td class="nm-right" t-esc="l.discount_pct ? l.discount_pct + ' %' : ''"/><td class="nm-right nm-num" t-esc="money(l.total)"/>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="nm-grid-2">
                        <div class="nm-panel">
                            <table class="nm-table">
                                <thead><tr><th>Groupe</th><th class="nm-right">Base HT</th><th class="nm-right">TVA</th><th class="nm-right">TTC</th></tr></thead>
                                <tbody><tr t-foreach="inv.groups" t-as="g" t-key="g.code"><td><span class="nm-group" t-esc="g.code"/> <t t-esc="g.rate"/> %</td><td class="nm-right nm-num" t-esc="money(g.base)"/><td class="nm-right nm-num" t-esc="money(g.tax)"/><td class="nm-right nm-num" t-esc="money(g.ttc)"/></tr></tbody>
                            </table>
                        </div>
                        <div class="nm-panel">
                            <table class="nm-table">
                                <thead><tr><th>Paiement</th><th class="nm-right">Montant</th></tr></thead>
                                <tbody><tr t-foreach="inv.payments" t-as="p" t-key="p_index"><td t-esc="p.label"/><td class="nm-right nm-num" t-esc="money(p.amount, inv.currency)"/></tr></tbody>
                            </table>
                        </div>
                    </div>
                    <div t-if="inv.credit_notes.length" class="nm-panel">
                        <div class="nm-panel-head"><h2>Avoirs liés</h2></div>
                        <table class="nm-table"><tbody>
                            <tr t-foreach="inv.credit_notes" t-as="c" t-key="c.id" class="is-click" t-on-click="() => this.open(c.id)"><td class="nm-mono" t-esc="c.number"/><td><StateTag state="c.state"/></td><td class="nm-right nm-num" t-esc="money(c.total)"/></tr>
                        </tbody></table>
                    </div>
                </div>
                <aside class="nm-stack">
                    <div class="nm-panel nm-panel-body nm-detail-total">
                        <div class="nm-row"><TypeTag type="inv.type"/><StateTag state="inv.state"/></div>
                        <b class="nm-num" t-esc="money(inv.total, 'CDF')"/>
                        <span t-if="inv.currency !== 'CDF'" class="nm-muted nm-num">soit <t t-esc="money(inv.total_currency, inv.currency)"/> au taux de <t t-esc="money(inv.currency_rate)"/></span>
                        <span class="nm-muted">dont TVA <t t-esc="money(inv.total_tax)"/> CDF</span>
                    </div>
                    <div class="nm-panel nm-panel-body nm-dgi" t-att-class="{'is-ok': inv.state === 'normalized'}">
                        <h3>Dispositif électronique fiscal</h3>
                        <dl>
                            <dt>Code DEF/DGI</dt><dd class="nm-mono" t-esc="inv.emcf_code or '—'"/>
                            <dt>NID</dt><dd class="nm-mono" t-esc="inv.emcf_nim or '—'"/>
                            <dt>Compteurs</dt><dd class="nm-mono" t-esc="inv.emcf_counters or '—'"/>
                            <dt>Heure DEF</dt><dd class="nm-mono" t-esc="inv.emcf_datetime or '—'"/>
                            <dt>Mode</dt><dd t-esc="{'simulation': 'Simulation (sans valeur fiscale)', 'test': 'Test DGI', 'production': 'Production DGI'}[inv.emcf_mode] or '—'"/>
                        </dl>
                        <a t-if="inv.verify_token" t-att-href="'/norma/v/' + inv.verify_token" target="_blank" rel="noopener" class="nm-btn nm-btn-sm"><Icon name="'link'"/> Page de vérification</a>
                    </div>
                    <div class="nm-panel nm-panel-body">
                        <dl class="nm-dl">
                            <dt>Établissement</dt><dd><t t-esc="inv.site_code"/> — <t t-esc="inv.site"/></dd>
                            <dt>Opérateur</dt><dd t-esc="inv.operator"/>
                            <dt>Client</dt><dd><t t-esc="inv.client_name or 'Client comptant'"/><t t-if="inv.client_nif"> · NIF <t t-esc="inv.client_nif"/></t></dd>
                            <dt t-if="inv.origin">Référence</dt><dd t-if="inv.origin" t-esc="inv.origin"/>
                            <dt t-if="inv.reversed_number">Facture d'origine</dt><dd t-if="inv.reversed_number"><a t-att-href="'#/invoices/' + inv.reversed_id" t-esc="inv.reversed_number"/> (<t t-esc="inv.reference_type"/>) — <t t-esc="inv.reversal_reason"/></dd>
                            <dt>Impressions</dt><dd t-esc="inv.print_count"/>
                            <dt>Empreinte</dt><dd class="nm-mono" style="word-break:break-all;font-size:11px" t-esc="inv.chain_hash or '—'"/>
                        </dl>
                    </div>
                </aside>
            </div>
        </div>`;
    static components = { PageHead, Icon, StateTag, TypeTag, BusyButton };
    static props = ["*"];
    setup() {
        this.money = money;
        this.qty = qty;
        this.dateTime = dateTime;
        this.can = can;
        this.state = useState({ inv: null });
        onWillStart(() => this.load(this.props.id));
        onWillUpdateProps((np) => this.load(np.id));
    }
    async load(id) { this.state.inv = await api("invoice_get", { id }); }
    get canCredit() {
        const inv = this.state.inv;
        return can("manager") && inv.state === "normalized" && !["FA", "EA"].includes(inv.type) && inv.lines.some((l) => l.refundable > 0);
    }
    open(id) { location.hash = `#/invoices/${id}`; }
    print(format) { printInvoice(this.state.inv.id, format); }
    async retry() {
        this.state.inv = await api("invoice_retry", { id: this.state.inv.id });
        notify(this.state.inv.state === "normalized" ? "Facture normalisée." : "La DGI n'a pas encore confirmé.", this.state.inv.state === "normalized" ? "ok" : "bad");
    }
    async abandon() {
        const reason = await confirm("Abandonner la facture", "Le numéro reste dans le registre avec le motif. À utiliser si la vente n'a pas eu lieu.", { input: "Motif", danger: true, confirm: "Abandonner" });
        if (reason) this.state.inv = await api("invoice_abandon", { id: this.state.inv.id, reason });
    }
    async checkUncertain() {
        this.state.inv = await api("invoice_check_uncertain", { id: this.state.inv.id });
    }
    async release() {
        const typed = await confirm("Renvoyer à la DGI", `Vous avez vérifié sur le portail de la DGI que la facture ${this.state.inv.number} n'y figure pas. Recopiez son numéro pour confirmer.`, { input: "Numéro de la facture", danger: true, confirm: "Renvoyer" });
        if (typed) this.state.inv = await api("invoice_release_uncertain", { id: this.state.inv.id, confirm_text: typed });
    }
    async credit() {
        const credit = await openDialog(CreditNoteDialog, { invoice: this.state.inv });
        if (credit) {
            await openDialog(IssuedDialog, { invoice: credit, nextLabel: "Fermer" });
            await this.load(this.state.inv.id);
        }
    }
}

export class InvoicesPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Factures'" subtitle="state.total + ' document(s)'">
                <a t-if="can('manager')" class="nm-btn" t-att-href="csvUrl"><Icon name="'download'"/> Export CSV</a>
            </PageHead>
            <div class="nm-filters">
                <input class="nm-input" style="max-width:280px" placeholder="Numéro, client, NIF, code DEF…" t-model="state.search" t-on-input="debounce"/>
                <div class="nm-seg">
                    <button t-foreach="filters" t-as="f" t-key="f[0]" t-att-class="{'is-on': state.state === f[0]}" t-on-click="() => this.setState(f[0])" t-esc="f[1]"/>
                </div>
                <select class="nm-select" style="width:auto" t-model="state.type" t-on-change="reload">
                    <option value="">Tous les types</option>
                    <option t-foreach="session.invoice_types" t-as="t" t-key="t.code" t-att-value="t.code"><t t-esc="t.code"/> — <t t-esc="t.label"/></option>
                </select>
                <select t-if="session.sites.length > 1" class="nm-select" style="width:auto" t-model="state.site" t-on-change="reload">
                    <option value="">Tous les établissements</option>
                    <option t-foreach="session.sites" t-as="s" t-key="s.id" t-att-value="s.id" t-esc="s.name"/>
                </select>
                <input class="nm-input" type="date" style="width:auto" t-model="state.from" t-on-change="reload" aria-label="Du"/>
                <input class="nm-input" type="date" style="width:auto" t-model="state.to" t-on-change="reload" aria-label="Au"/>
            </div>
            <div class="nm-panel">
                <div class="nm-table-wrap">
                    <table class="nm-table">
                        <thead><tr><th>Numéro</th><th>Type</th><th>Date</th><th>Client</th><th>Établissement</th><th>Code DEF/DGI</th><th>État</th><th class="nm-right">Total TTC</th></tr></thead>
                        <tbody>
                            <tr t-foreach="state.items" t-as="i" t-key="i.id" class="is-click" t-on-click="() => this.open(i.id)">
                                <td class="nm-mono" t-esc="i.number"/>
                                <td><TypeTag type="i.type"/></td>
                                <td t-esc="dateTime(i.date)"/>
                                <td><t t-esc="i.client_name or 'Client comptant'"/><div t-if="i.client_nif" class="nm-muted" style="font-size:12px">NIF <t t-esc="i.client_nif"/></div></td>
                                <td t-esc="i.site_code"/>
                                <td class="nm-mono" style="font-size:12px" t-esc="i.emcf_code"/>
                                <td><StateTag state="i.state"/></td>
                                <td class="nm-right nm-num"><t t-if="['FA','EA'].includes(i.type)">−</t><t t-esc="money(i.total)"/></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div t-if="!state.items.length and !state.loading" class="nm-empty"><h3>Aucune facture</h3><p>Les factures émises depuis la caisse ou l'éditeur apparaissent ici.</p></div>
                <div class="nm-panel-body nm-row" t-if="state.total > state.items.length + state.offset or state.offset">
                    <button class="nm-btn nm-btn-sm" t-att-disabled="!state.offset" t-on-click="() => this.page(-1)">Précédentes</button>
                    <span class="nm-muted"><t t-esc="state.offset + 1"/>–<t t-esc="state.offset + state.items.length"/> sur <t t-esc="state.total"/></span>
                    <button class="nm-btn nm-btn-sm" t-att-disabled="state.offset + state.items.length >= state.total" t-on-click="() => this.page(1)">Suivantes</button>
                </div>
            </div>
        </div>`;
    static components = { PageHead, Icon, StateTag, TypeTag };
    static props = ["*"];
    setup() {
        this.money = money;
        this.dateTime = dateTime;
        this.can = can;
        this.session = session;
        this.filters = [["", "Toutes"], ["normalized", "Normalisées"], ["attention", "À traiter"], ["cancelled", "Abandonnées"]];
        this.state = useState({ items: [], total: 0, offset: 0, loading: true, search: "", state: this.props.params.state || "",
            type: "", site: "", from: "", to: "" });
        onWillStart(() => this.reload());
    }
    get csvUrl() {
        const today = new Date().toISOString().slice(0, 10);
        const from = this.state.from || today.slice(0, 8) + "01";
        return `/norma/export/invoices.csv?date_from=${from}&date_to=${this.state.to || today}${this.state.site ? "&site_id=" + this.state.site : ""}`;
    }
    async reload() {
        this.state.loading = true;
        try {
            const res = await api("invoices", { search: this.state.search, state: this.state.state || null, invoice_type: this.state.type || null,
                site_id: this.state.site || null, date_from: this.state.from || null, date_to: this.state.to || null,
                offset: this.state.offset, limit: 50 });
            Object.assign(this.state, { items: res.items, total: res.total });
        } catch (err) {
            notifyError(err);
        }
        this.state.loading = false;
    }
    debounce() {
        clearTimeout(this.t);
        this.t = setTimeout(() => { this.state.offset = 0; this.reload(); }, 300);
    }
    setState(s) { this.state.state = s; this.state.offset = 0; this.reload(); }
    page(d) { this.state.offset = Math.max(0, this.state.offset + d * 50); this.reload(); }
    open(id) { location.hash = `#/invoices/${id}`; }
}
