/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";
import { BusyButton, Dialog, Icon, notify, notifyError, openDialog } from "@norma_facture/common/ui";
import { dateTime, money, STATE_LABELS, TYPE_SHORT } from "@norma_facture/common/format";
import { printerSettings, printTicket } from "@norma_facture/common/printer";
import { session } from "@norma_facture/app/store";

/** Données d'impression d'un ticket à partir d'une facture renvoyée par le serveur. */
export function ticketFromInvoice(inv, change = 0) {
    const site = session.sites.find((x) => x.id === inv.site_id) || { name: inv.site, code: inv.site_code };
    return {
        company: session.company, site, type: inv.type, number: inv.number, date: dateTime(inv.date), operator: inv.operator,
        client_name: inv.client_name, client_nif: inv.client_nif,
        lines: inv.lines.map((l) => ({ name: l.name, tax_group: l.tax_group, quantity: l.quantity, price: l.net_price,
            discount_pct: l.discount_pct, total: l.total })),
        groups: inv.groups, total_ht: inv.total_ht, total_tax: inv.total_tax, total: inv.total, currency: "CDF",
        payments: inv.payments.map((p) => ({ label: p.label, amount: p.amount_cdf })), change,
        emcf_code: inv.state === "normalized" ? inv.emcf_code : "", emcf_qr: inv.emcf_qr, emcf_nim: inv.emcf_nim,
        emcf_counters: inv.emcf_counters, emcf_datetime: inv.emcf_datetime, simulation: inv.emcf_mode !== "production",
        verify_url: `${location.origin}/norma/v/${inv.verify_token}`,
    };
}

/** Impression directe du ticket d'une facture selon le réglage du poste (sans ouvrir d'onglet). */
export async function autoPrint(inv, change = 0) {
    if (!printerSettings().auto) return;
    try {
        await printTicket(ticketFromInvoice(inv, change), { serverUrl: `/norma/print/${inv.id}?format=ticket` });
        api("invoice_printed", { id: inv.id }).catch(() => {});
    } catch (err) {
        notifyError(err);
    }
}

export function printInvoice(id, format = "a4", auto = true) {
    window.open(`/norma/print/${id}?format=${format}${auto ? "&auto=1" : ""}`, "_blank", "noopener");
    api("invoice_printed", { id }).catch(() => {});
}

export class StateTag extends Component {
    static template = xml`<span class="nm-tag" t-att-class="cls" t-esc="label"/>`;
    static props = { state: String };
    get label() { return (STATE_LABELS[this.props.state] || [this.props.state])[0]; }
    get cls() { const c = (STATE_LABELS[this.props.state] || [])[1]; return c ? "nm-tag-" + c : ""; }
}

export class TypeTag extends Component {
    static template = xml`<span class="nm-tag nm-tag-plain" t-att-class="isCredit ? 'nm-tag-gold' : 'nm-tag-info'"><b t-esc="props.type"/> <t t-esc="label"/></span>`;
    static props = { type: String };
    get isCredit() { return ["FA", "EA"].includes(this.props.type); }
    get label() { return TYPE_SHORT[this.props.type] || ""; }
}

// ---------------------------------------------------------------- clients
export class CustomerForm extends Component {
    static template = xml`
        <Dialog title="state.f.id ? 'Modifier le client' : 'Nouveau client'" onClose="() => props.close(null)">
            <form class="nm-grid-2" t-on-submit.prevent="save">
                <label class="nm-field nm-span-2"><span>Nom ou raison sociale</span><input class="nm-input" t-model="state.f.name" maxlength="120"/></label>
                <label class="nm-field"><span>Type de client (DGI)</span>
                    <select class="nm-select" t-model="state.f.client_type">
                        <option t-foreach="types" t-as="t" t-key="t.code" t-att-value="t.code"><t t-esc="t.code"/> — <t t-esc="t.label"/></option>
                    </select></label>
                <label class="nm-field"><span>NIF<t t-if="needNif"> (obligatoire)</t></span><input class="nm-input" t-model="state.f.nif" maxlength="32" style="text-transform:uppercase"/></label>
                <label t-if="state.f.client_type === 'AO'" class="nm-field nm-span-2"><span>Référence d'exonération (obligatoire)</span><input class="nm-input" t-model="state.f.exemption_ref" maxlength="60"/></label>
                <label class="nm-field"><span>Téléphone</span><input class="nm-input" t-model="state.f.phone" maxlength="32"/></label>
                <label class="nm-field"><span>E-mail</span><input class="nm-input" type="email" t-model="state.f.email" maxlength="120"/></label>
                <label class="nm-field nm-span-2"><span>Adresse</span><input class="nm-input" t-model="state.f.address" maxlength="160"/></label>
                <t t-if="props.guest">
                    <label class="nm-field"><span>Pièce d'identité</span><input class="nm-input" t-model="state.f.id_document" maxlength="60"/></label>
                    <label class="nm-field"><span>Nationalité</span><input class="nm-input" t-model="state.f.nationality" maxlength="40"/></label>
                </t>
                <button type="submit" class="nm-hide"/>
            </form>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" onClick.bind="save">Enregistrer le client</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() {
        this.types = session.client_types;
        this.state = useState({ f: Object.assign({ name: "", client_type: "PP", nif: "", phone: "", email: "", address: "",
            exemption_ref: "", id_document: "", nationality: "" }, this.props.customer || {}) });
    }
    get needNif() { return ["PM", "PC", "PL"].includes(this.state.f.client_type); }
    async save() {
        const res = await api("customer_save", { ...this.state.f });
        notify("Client enregistré.", "ok");
        this.props.close(res);
    }
}

export class CustomerPicker extends Component {
    static template = xml`
        <Dialog title="'Choisir le client'" onClose="() => props.close(undefined)">
            <div class="nm-row" style="margin-bottom:12px">
                <input class="nm-input" placeholder="Nom, NIF, téléphone…" t-model="state.q" t-on-input="search"/>
                <button class="nm-btn nm-btn-primary" t-on-click="create"><Icon name="'plus'"/> Nouveau</button>
            </div>
            <div style="max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-m)">
                <button t-if="props.allowNone" class="nm-pick" t-on-click="() => props.close(null)">
                    <b>Client comptant</b><small>Personne physique non identifiée</small>
                </button>
                <button t-foreach="state.items" t-as="c" t-key="c.id" class="nm-pick" t-on-click="() => props.close(c)">
                    <b t-esc="c.name"/>
                    <small><t t-esc="c.client_type"/><t t-if="c.nif"> · NIF <t t-esc="c.nif"/></t><t t-if="c.phone"> · <t t-esc="c.phone"/></t></small>
                </button>
                <div t-if="!state.items.length and !state.loading" class="nm-empty" style="padding:22px">Aucun client trouvé. Créez-le avec « Nouveau ».</div>
            </div>
        </Dialog>`;
    static components = { Dialog, Icon };
    static props = ["*"];
    setup() {
        this.state = useState({ q: "", items: [], loading: true });
        onWillStart(() => this.load());
    }
    async load() {
        this.state.loading = true;
        this.state.items = await api("customers", { search: this.state.q });
        this.state.loading = false;
    }
    search() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.load().catch(notifyError), 250);
    }
    async create() {
        const c = await openDialog(CustomerForm, { guest: this.props.guest, customer: { name: this.state.q } });
        if (c) this.props.close(c);
    }
}

// ---------------------------------------------------------------- encaissement
export class PaymentDialog extends Component {
    static template = xml`
        <Dialog title="'Encaissement'" onClose="() => props.close(null)">
            <div class="nm-pay-total">
                <span>Total à payer</span>
                <b class="nm-num" t-esc="money(props.total, props.currency)"/>
            </div>
            <div class="nm-pay-methods">
                <button t-foreach="methods" t-as="m" t-key="m.code" class="nm-pay-m" t-att-class="{'is-on': isUsed(m.code)}" t-on-click="() => this.add(m.code)">
                    <t t-esc="m.label"/>
                </button>
            </div>
            <div class="nm-stack" style="margin-top:14px">
                <div t-foreach="state.lines" t-as="l" t-key="l_index" class="nm-row">
                    <span style="width:140px;font-weight:600" t-esc="label(l.method)"/>
                    <input class="nm-input nm-num" type="number" min="0" step="0.01" t-model.number="l.amount" style="text-align:right"/>
                    <button class="nm-btn nm-btn-ghost nm-btn-icon" t-on-click="() => this.state.lines.splice(l_index, 1)" aria-label="Retirer"><Icon name="'x'"/></button>
                </div>
            </div>
            <div t-if="cashLine" class="nm-row" style="margin-top:14px">
                <label class="nm-field nm-grow"><span>Montant reçu en espèces</span>
                    <input class="nm-input nm-num" type="number" min="0" step="0.01" t-model.number="state.given"/></label>
                <div class="nm-change"><span>À rendre</span><b class="nm-num" t-esc="money(change, props.currency)"/></div>
            </div>
            <div t-if="Math.abs(remaining) >= 0.005" class="nm-note nm-note-warn" style="margin-top:14px">
                <t t-if="remaining > 0">Reste à répartir : </t><t t-else="">Trop perçu : </t>
                <b class="nm-num" t-esc="money(Math.abs(remaining), props.currency)"/>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Retour</button>
                <button class="nm-btn nm-btn-gold nm-btn-lg" t-att-disabled="Math.abs(remaining) >= 0.005 or !state.lines.length" t-on-click="confirm">
                    <Icon name="'check'"/> Valider et normaliser
                </button>
            </t>
        </Dialog>`;
    static components = { Dialog, Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.methods = session.payment_methods.filter((m) => this.props.allowCredit || m.code !== "CREDIT");
        this.state = useState({ lines: [{ method: this.props.defaultMethod || "ESPECES", amount: this.round(this.props.total) }],
            given: this.round(this.props.total) });
    }
    round(v) { return Math.round(Number(v || 0) * 100) / 100; }
    label(code) { return (session.payment_methods.find((m) => m.code === code) || {}).label || code; }
    isUsed(code) { return this.state.lines.some((l) => l.method === code); }
    get paid() { return this.round(this.state.lines.reduce((s, l) => s + Number(l.amount || 0), 0)); }
    get remaining() { return this.round(this.props.total - this.paid); }
    get cashLine() { return this.state.lines.find((l) => l.method === "ESPECES"); }
    get change() { return Math.max(0, this.round(Number(this.state.given || 0) - Number(this.cashLine.amount || 0))); }
    add(code) {
        if (this.isUsed(code)) return;
        const rest = Math.max(0, this.remaining);
        if (this.state.lines.length === 1 && rest === 0) {
            this.state.lines[0] = { method: code, amount: this.state.lines[0].amount };
            return;
        }
        this.state.lines.push({ method: code, amount: rest });
    }
    confirm() {
        const out = this.state.lines.filter((l) => Number(l.amount) > 0).map((l) => ({ method: l.method, amount: this.round(l.amount) }));
        out.change = this.cashLine ? this.change : 0;
        this.props.close(out);
    }
}

// ---------------------------------------------------------------- facture émise : le sceau
export class IssuedDialog extends Component {
    static template = xml`
        <Dialog title="title" onClose="() => props.close(null)">
            <div class="nm-issued" t-att-class="'is-' + inv.state">
                <div class="nm-issued-stamp" aria-hidden="true">
                    <t t-if="ok"><Icon name="'check'" size="34"/><span t-esc="inv.emcf_mode === 'simulation' ? 'Simulation' : 'Normalisée DGI'"/></t>
                    <t t-else=""><Icon name="'clock'" size="34"/><span>En attente DGI</span></t>
                </div>
                <div class="nm-issued-body">
                    <div class="nm-num nm-issued-total" t-esc="money(inv.currency === 'CDF' ? inv.total : inv.total_currency, inv.currency)"/>
                    <div class="nm-mono" t-esc="inv.number"/>
                    <dl t-if="ok">
                        <dt>Code DEF/DGI</dt><dd class="nm-mono" t-esc="inv.emcf_code"/>
                        <dt>Compteurs</dt><dd class="nm-mono" t-esc="inv.emcf_counters"/>
                        <dt>Heure DEF</dt><dd class="nm-mono" t-esc="inv.emcf_datetime"/>
                    </dl>
                    <div t-else="" class="nm-note nm-note-warn" style="margin-top:10px">
                        <t t-esc="inv.emcf_error or 'La DGI n’a pas encore confirmé cette facture.'"/>
                        <div t-if="inv.state === 'failed' and !inv.emcf_blocked" style="margin-top:4px">Nouvelle tentative automatique toutes les 5 minutes. Le document imprimé porte la mention « ne vaut pas facture » jusqu'à la normalisation.</div>
                    </div>
                    <div t-if="inv.emcf_mode === 'simulation' and ok" class="nm-note" style="margin-top:10px">Mode simulation : document de démonstration sans valeur fiscale. Reliez l'établissement à l'e-MCF dans Paramètres.</div>
                </div>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => this.print('a4')"><Icon name="'print'"/> A4</button>
                <button class="nm-btn" t-on-click="() => this.print('ticket')"><Icon name="'receipt'"/> Ticket</button>
                <button t-if="!ok and inv.state === 'failed'" class="nm-btn" t-on-click="retry"><Icon name="'refresh'"/> Réessayer</button>
                <button class="nm-btn nm-btn-primary" data-autofocus="1" t-on-click="() => props.close('next')" t-esc="props.nextLabel or 'Vente suivante'"/>
            </t>
        </Dialog>`;
    static components = { Dialog, Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.state = useState({ inv: this.props.invoice });

    }
    get inv() { return this.state.inv; }
    get ok() { return this.inv.state === "normalized"; }
    get title() { return this.ok ? "Facture normalisée" : "Facture enregistrée"; }
    print(format) { printInvoice(this.inv.id, format); }
    async retry() {
        try {
            this.state.inv = await api("invoice_retry", { id: this.inv.id });
            notify(this.ok ? "Facture normalisée." : "La DGI ne répond toujours pas.", this.ok ? "ok" : "bad");
        } catch (err) {
            notifyError(err);
        }
    }
}

export class PageHead extends Component {
    static template = xml`
        <header class="nm-page-head">
            <div class="nm-grow">
                <h1 t-esc="props.title"/>
                <p t-if="props.subtitle" t-esc="props.subtitle"/>
            </div>
            <div class="nm-row nm-wrap"><t t-slot="default"/></div>
        </header>`;
    static props = ["*"];
}
