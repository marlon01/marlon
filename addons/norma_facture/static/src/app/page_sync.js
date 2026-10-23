/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { BusyButton, confirm, Icon, notify, notifyError, useInterval } from "@norma_facture/common/ui";
import { money } from "@norma_facture/common/format";
import { outbox } from "@norma_facture/common/outbox";
import { capabilities, pairPrinter, printerSettings, printTicket, savePrinterSettings, testPrint } from "@norma_facture/common/printer";
import { qrSvg } from "@norma_facture/common/qr";
import { can, session } from "@norma_facture/app/store";
import { flush, refreshCounts } from "@norma_facture/app/sync";
import { PageHead } from "@norma_facture/app/components";

/* État de la synchronisation : ventes gardées sur ce poste, factures en attente de la DGI. */
export class SyncPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Synchronisation'" subtitle="'Ventes faites hors ligne sur ce poste et factures en attente de la DGI.'">
                <BusyButton class="'nm-btn-primary'" icon="'refresh'" onClick.bind="syncNow">Synchroniser maintenant</BusyButton>
            </PageHead>
            <div class="nm-kpis">
                <div class="nm-kpi" t-att-class="session.offline ? '' : 'is-main'"><span>Connexion au serveur</span><b t-esc="session.offline ? 'Coupée' : 'Rétablie'"/><small t-esc="session.offline ? 'La caisse continue en mode hors ligne.' : 'Envoi automatique toutes les 20 secondes.'"/></div>
                <div class="nm-kpi"><span>Ventes à envoyer (ce poste)</span><b class="nm-num" t-esc="session.outbox"/><small>gardées sur ce poste</small></div>
                <div class="nm-kpi"><span>Factures en attente DGI</span><b class="nm-num" t-esc="session.dgiPending"/><small>normalisées automatiquement</small></div>
                <div class="nm-kpi"><span>Ventes refusées</span><b class="nm-num" t-esc="errors.length"/><small>à traiter par un gestionnaire</small></div>
            </div>
            <div class="nm-panel" t-if="state.sales.length">
                <div class="nm-panel-head"><h2>Ventes gardées sur ce poste</h2></div>
                <div class="nm-table-wrap"><table class="nm-table">
                    <thead><tr><th>Heure de la vente</th><th>Articles</th><th>État</th><th class="nm-right">Total</th><th/></tr></thead>
                    <tbody><tr t-foreach="state.sales" t-as="s" t-key="s.request_key">
                        <td t-esc="new Date(s.offline_at).toLocaleString('fr-FR')"/>
                        <td t-esc="s.ticket.lines.length + ' ligne(s)'"/>
                        <td><span t-if="s.uid !== session.user.id" class="nm-tag">Envoi à la connexion de son auteur</span>
                            <span t-elif="s.error" class="nm-tag nm-tag-bad" t-att-title="s.error">Refusée</span><span t-else="" class="nm-tag nm-tag-warn">À envoyer</span>
                            <div t-if="s.error" class="nm-muted" style="font-size:12px;max-width:420px" t-esc="s.error"/></td>
                        <td class="nm-right nm-num" t-esc="money(s.ticket.total, s.ticket.currency)"/>
                        <td class="nm-row" style="justify-content:flex-end">
                            <button class="nm-btn nm-btn-sm" t-on-click="() => this.reprint(s)"><Icon name="'receipt'" size="15"/></button>
                            <button t-if="s.error and s.uid === session.user.id" class="nm-btn nm-btn-sm" t-on-click="() => this.retry(s)">Réessayer</button>
                            <button t-if="s.error and can('manager') and s.uid === session.user.id" class="nm-btn nm-btn-sm nm-btn-danger" t-on-click="() => this.drop(s)">Retirer</button>
                        </td>
                    </tr></tbody>
                </table></div>
            </div>
            <div t-else="" class="nm-panel nm-empty"><h3>Aucune vente en attente sur ce poste</h3><p>Pendant une coupure, les ventes de la caisse sont gardées ici puis envoyées automatiquement.</p></div>
            <p t-if="session.dgiPending" style="margin-top:14px"><a href="#/invoices?state=attention">Voir les factures en attente de la DGI</a></p>
        </div>`;
    static components = { PageHead, BusyButton, Icon };
    static props = ["*"];
    setup() {
        this.money = money;
        this.can = can;
        this.session = useState(session);
        this.state = useState({ sales: [] });
        onWillStart(() => this.load());
        useInterval(() => this.load(), 5000);
    }
    get errors() { return this.state.sales.filter((s) => s.error); }
    async load() {
        this.state.sales = (await outbox.all()).filter((s) => s.company_id === session.company.id)
            .sort((a, b) => a.offline_at.localeCompare(b.offline_at));
    }
    async syncNow() { await flush(); await this.load(); }
    async retry(s) { await outbox.put({ ...JSON.parse(JSON.stringify(s)), error: "" }); await this.syncNow(); }
    async drop(s) {
        if (await confirm("Retirer la vente", "Elle ne sera jamais facturée. À utiliser seulement si elle a été saisie à nouveau.", { danger: true, confirm: "Retirer" })) {
            await outbox.remove(s.request_key);
            await refreshCounts();
            await this.load();
        }
    }
    reprint(s) { printTicket(s.ticket, { qrSvgMarkup: qrSvg(s.ticket.verify_url, 3) }).catch(notifyError); }
}

/* Réglage de l'impression, propre à chaque poste. */
export class PrinterSettings extends Component {
    static template = xml`
        <div class="nm-panel nm-panel-body nm-stack" style="max-width:720px">
            <h2 style="font-size:17px">Impression sur ce poste</h2>
            <p class="nm-muted" style="margin:0">Réglage enregistré dans ce navigateur : chaque caisse a le sien.</p>
            <div class="nm-field"><span>Mode d'impression</span>
                <div class="nm-seg nm-wrap">
                    <button t-att-class="{'is-on': state.s.mode === 'usb'}" t-on-click="() => this.set('mode', 'usb')">Imprimante thermique USB / série</button>
                    <button t-att-class="{'is-on': state.s.mode === 'system'}" t-on-click="() => this.set('mode', 'system')">Imprimante du système</button>
                    <button t-att-class="{'is-on': state.s.mode === 'off'}" t-on-click="() => this.set('mode', 'off')">Pas d'impression automatique</button>
                </div>
            </div>
            <div t-if="state.s.mode === 'usb'" class="nm-note">
                Impression directe, sans fenêtre : NORMA envoie le ticket à l'imprimante (ESC/POS) et l'imprimante dessine le QR code.
                Fonctionne avec Chrome ou Edge.
                <t t-if="!caps.usb and !caps.serial"> Ce navigateur ne le permet pas : utilisez Chrome.</t>
                <div class="nm-row" style="margin-top:10px">
                    <button class="nm-btn nm-btn-sm" t-if="caps.usb" t-on-click="() => this.pair('usb')"><Icon name="'link'" size="15"/> Choisir l'imprimante USB</button>
                    <button class="nm-btn nm-btn-sm" t-if="caps.serial" t-on-click="() => this.pair('serial')"><Icon name="'link'" size="15"/> Imprimante série / Bluetooth</button>
                </div>
            </div>
            <div t-if="state.s.mode === 'system'" class="nm-note">
                Le ticket part à l'imprimante par défaut du poste, sans ouvrir d'onglet. Pour supprimer aussi la fenêtre de confirmation du navigateur, lancez NORMA avec ce raccourci :
                <pre class="nm-pre" style="margin-top:8px" t-esc="kiosk"/>
            </div>
            <div class="nm-grid-3">
                <label class="nm-field"><span>Largeur du papier</span>
                    <select class="nm-select" t-on-change="setWidth">
                        <option value="80" t-att-selected="state.s.width === 80">80 mm</option>
                        <option value="58" t-att-selected="state.s.width === 58">58 mm</option>
                    </select></label>
                <label class="nm-field"><span>Exemplaires</span><input class="nm-input" type="number" min="1" max="3" t-att-value="state.s.copies" t-on-change="setCopies"/></label>
                <label class="nm-check" style="align-self:end"><input type="checkbox" t-att-checked="state.s.auto" t-on-change="(ev) => this.set('auto', ev.target.checked)"/><span>Imprimer à chaque vente</span></label>
            </div>
            <div><button class="nm-btn" t-on-click="test"><Icon name="'print'"/> Imprimer un ticket de test</button></div>
        </div>`;
    static components = { Icon };
    static props = ["*"];
    setup() {
        this.caps = capabilities;
        this.kiosk = `chrome.exe --kiosk-printing --app=${location.origin}/norma/app`;
        this.state = useState({ s: printerSettings() });
    }
    set(k, v) { this.state.s[k] = v; savePrinterSettings({ ...this.state.s }); }
    setWidth(ev) { this.set("width", parseInt(ev.target.value) || 80); }
    setCopies(ev) { this.set("copies", Math.min(3, Math.max(1, parseInt(ev.target.value) || 1))); }
    async pair(kind) { try { notify(await pairPrinter(kind), "ok"); } catch (err) { notifyError(err); } }
    async test() { try { await testPrint(session.company); } catch (err) { notifyError(err); } }
}
