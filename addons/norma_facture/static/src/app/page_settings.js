/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";
import { BusyButton, Dialog, Icon, notify, notifyError, openDialog } from "@norma_facture/common/ui";
import { dateTime, money } from "@norma_facture/common/format";
import { can, loadSession, session } from "@norma_facture/app/store";
import { PageHead } from "@norma_facture/app/components";

const MODES = { simulation: "Simulation", test: "Test DGI (homologation)", production: "Production DGI" };

class SiteForm extends Component {
    static template = xml`
        <Dialog title="state.f.id ? 'Établissement ' + state.f.code : 'Nouvel établissement'" size="'lg'" onClose="() => props.close(null)">
            <div class="nm-grid-2">
                <label class="nm-field"><span>Nom</span><input class="nm-input" t-model="state.f.name" maxlength="80"/></label>
                <label class="nm-field"><span>Code établissement</span><input class="nm-input" t-model="state.f.code" maxlength="24" style="text-transform:uppercase"/><small>Imprimé sur les factures, transmis à la DGI. Figé après la première facture.</small></label>
                <label class="nm-field nm-span-2"><span>Adresse</span><input class="nm-input" t-model="state.f.address" maxlength="160"/></label>
                <label class="nm-field"><span>Ville</span><input class="nm-input" t-model="state.f.city" maxlength="60"/></label>
                <label class="nm-field"><span>Province</span><input class="nm-input" t-model="state.f.province" maxlength="60"/></label>
                <label class="nm-field"><span>Téléphone</span><input class="nm-input" t-model="state.f.phone" maxlength="40"/></label>
                <label class="nm-check" style="align-self:end"><input type="checkbox" t-model="state.f.active"/><span>Établissement actif</span></label>
            </div>
            <h3 style="margin:22px 0 10px;font-size:16px">Dispositif électronique fiscal (e-MCF)</h3>
            <div class="nm-grid-2">
                <label class="nm-field nm-span-2"><span>Mode</span>
                    <div class="nm-seg">
                        <button t-foreach="modes" t-as="m" t-key="m" type="button" t-att-class="{'is-on': state.f.emcf_mode === m}" t-on-click="() => this.state.f.emcf_mode = m" t-esc="modes[m]"/>
                    </div></label>
                <div t-if="!verified" class="nm-note nm-note-warn nm-span-2">Votre entreprise n'est pas encore vérifiée par l'administration NORMA. Le lien avec l'e-MCF de la DGI s'ouvre après contrôle de vos pièces (RCCM, NIF, mandat). Contactez le support.</div>
                <t t-if="state.f.emcf_mode !== 'simulation'">
                    <label class="nm-field nm-span-2"><span>Adresse de l'API e-MCF</span><input class="nm-input nm-mono" t-model="state.f.emcf_url" placeholder="https://developper.dgirdc.cd/edef"/>
                        <small>Test : https://developper.dgirdc.cd/edef · Production : https://edef.dgirdc.cd (à confirmer sur le portail développeur de la DGI).</small></label>
                    <label class="nm-field"><span>ISF</span><input class="nm-input nm-mono" t-model="state.f.emcf_isf" maxlength="10" placeholder="AAA-BBB-NN" style="text-transform:uppercase"/><small>Fourni par la DGI avec l'homologation.</small></label>
                    <label class="nm-field"><span>Jeton d'accès (JWT)</span><input class="nm-input nm-mono" type="password" autocomplete="off" t-model="state.f.emcf_token" t-att-placeholder="state.f.has_token ? 'Enregistré — laisser vide pour le conserver' : 'Coller le jeton du portail e-MCF'"/></label>
                </t>
                <div t-else="" class="nm-note nm-span-2">En simulation, NORMA reproduit l'e-MCF (mêmes calculs, même circuit). Les factures portent la mention « sans valeur fiscale ».</div>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" onClick.bind="save">Enregistrer l'établissement</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() {
        this.modes = MODES;
        this.verified = session.company.verified;
        this.state = useState({ f: Object.assign({ name: "", code: "", address: "", city: "Kinshasa", province: "Kinshasa", phone: "", active: true,
            emcf_mode: "simulation", emcf_url: "", emcf_isf: "", emcf_token: "", has_token: false }, this.props.site || {}, { emcf_token: "" }) });
    }
    async save() {
        const f = { ...this.state.f };
        if (!f.emcf_token) delete f.emcf_token;
        delete f.has_token;
        const res = await api("site_save", f);
        notify("Établissement enregistré.", "ok");
        this.props.close(res);
    }
}

class UserForm extends Component {
    static template = xml`
        <Dialog title="state.f.id ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'" onClose="() => props.close(null)">
            <div class="nm-grid-2">
                <label class="nm-field"><span>Nom</span><input class="nm-input" t-model="state.f.name" maxlength="80"/></label>
                <label class="nm-field"><span>E-mail (identifiant)</span><input class="nm-input" type="email" t-model="state.f.login" maxlength="120"/></label>
                <label class="nm-field nm-span-2"><span>Rôle</span>
                    <select class="nm-select" t-model="state.f.role">
                        <option value="cashier">Caissier / réception — encaisse et émet les factures</option>
                        <option value="manager">Gestionnaire — catalogue, avoirs, rapports</option>
                        <option value="admin">Administrateur — établissements, DGI, utilisateurs</option>
                    </select></label>
                <div class="nm-field nm-span-2"><span>Établissements autorisés</span>
                    <div class="nm-row nm-wrap">
                        <label t-foreach="props.sites" t-as="s" t-key="s.id" class="nm-check"><input type="checkbox" t-att-checked="state.f.site_ids.includes(s.id)" t-on-change="() => this.toggle(s.id)"/><span><t t-esc="s.code"/> — <t t-esc="s.name"/></span></label>
                    </div><small>Aucune case cochée : tous les établissements.</small></div>
                <label class="nm-field nm-span-2"><span t-esc="state.f.id ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe'"/><input class="nm-input" type="password" autocomplete="new-password" t-model="state.f.password"/><small>10 caractères au moins.</small></label>
                <label t-if="state.f.id" class="nm-check nm-span-2"><input type="checkbox" t-model="state.f.active"/><span>Compte actif</span></label>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(null)">Annuler</button>
                <BusyButton class="'nm-btn-primary'" onClick.bind="save">Enregistrer</BusyButton>
            </t>
        </Dialog>`;
    static components = { Dialog, BusyButton };
    static props = ["*"];
    setup() {
        this.state = useState({ f: Object.assign({ name: "", login: "", role: "cashier", site_ids: [], password: "", active: true }, this.props.user || {}, { password: "" }) });
    }
    toggle(id) {
        const ids = this.state.f.site_ids;
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1); else ids.push(id);
    }
    async save() { this.props.close(await api("user_save", { ...this.state.f, id: this.state.f.id || null })); }
}

export class SettingsPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Paramètres'">
                <div class="nm-seg">
                    <button t-foreach="tabs" t-as="t" t-key="t[0]" t-att-class="{'is-on': state.tab === t[0]}" t-on-click="() => this.setTab(t[0])" t-esc="t[1]"/>
                </div>
            </PageHead>

            <div t-if="state.tab === 'rate'" class="nm-panel nm-panel-body nm-stack" style="max-width:520px">
                <h2 style="font-size:17px">Taux du jour</h2>
                <p class="nm-muted" style="margin:0">Utilisé pour convertir en CDF les factures en dollars (les montants transmis à la DGI sont en CDF). Il est enregistré sur chaque facture.</p>
                <label class="nm-field"><span>CDF pour 1 USD</span><input class="nm-input nm-num" type="number" min="1" step="0.01" t-model.number="state.rate"/></label>
                <BusyButton class="'nm-btn-primary'" onClick.bind="saveRate">Enregistrer le taux</BusyButton>
            </div>

            <div t-if="state.tab === 'company' and state.c" class="nm-panel nm-panel-body" style="max-width:860px">
                <div class="nm-grid-2">
                    <label class="nm-field nm-span-2"><span>Raison sociale</span><input class="nm-input" t-model="state.c.name"/></label>
                    <label class="nm-field"><span>NIF</span><input class="nm-input nm-mono" t-model="state.c.nif" style="text-transform:uppercase"/><small>Figé après la première facture normalisée.</small></label>
                    <label class="nm-field"><span>RCCM</span><input class="nm-input" t-model="state.c.rccm"/></label>
                    <label class="nm-field"><span>Identification nationale</span><input class="nm-input" t-model="state.c.idnat"/></label>
                    <label class="nm-field"><span>Centre des impôts</span><input class="nm-input" t-model="state.c.tax_center" placeholder="DGE, CIS Gombe…"/></label>
                    <label class="nm-field"><span>Régime</span><select class="nm-select" t-model="state.c.regime"><option value="reel">Assujetti à la TVA</option><option value="ipr">Non assujetti</option></select></label>
                    <label class="nm-field"><span>Devise des prix</span><select class="nm-select" t-model="state.c.currency"><option value="CDF">CDF</option><option value="USD">USD</option></select></label>
                    <label class="nm-field nm-span-2"><span>Adresse</span><input class="nm-input" t-model="state.c.address"/></label>
                    <label class="nm-field"><span>Ville</span><input class="nm-input" t-model="state.c.city"/></label>
                    <label class="nm-field"><span>Téléphone</span><input class="nm-input" t-model="state.c.phone"/></label>
                    <label class="nm-field"><span>E-mail</span><input class="nm-input" t-model="state.c.email"/></label>
                    <label class="nm-field"><span>Remise maximale du caissier (%)</span><input class="nm-input nm-num" type="number" min="0" max="100" t-model.number="state.c.max_discount"/></label>
                    <label class="nm-field nm-span-2"><span>Mention de pied de facture</span><input class="nm-input" t-model="state.c.footer" maxlength="200" placeholder="Merci de votre visite · Les marchandises vendues…"/></label>
                    <label class="nm-field"><span>Couleur de l'entreprise</span><input type="color" t-model="state.c.color" style="height:40px;width:80px"/></label>
                    <label class="nm-field"><span>Logo (PNG ou JPEG, 1 Mo)</span><input class="nm-input" type="file" accept="image/png,image/jpeg" t-on-change="onLogo" style="padding-top:7px"/></label>
                </div>
                <div style="margin-top:18px"><BusyButton class="'nm-btn-primary'" onClick.bind="saveCompany">Enregistrer le profil</BusyButton></div>
            </div>

            <t t-if="state.tab === 'sites'">
                <div class="nm-filters"><span class="nm-muted">Chaque établissement est relié à son propre e-MCF (jeton, ISF, NID).</span><div class="nm-grow"/>
                    <button class="nm-btn nm-btn-primary" t-on-click="() => this.editSite()"><Icon name="'plus'"/> Nouvel établissement</button></div>
                <div class="nm-sites">
                    <article t-foreach="state.sites" t-as="s" t-key="s.id" class="nm-panel nm-site" t-att-style="s.active ? '' : 'opacity:.6'">
                        <div class="nm-row"><span class="nm-device-dot" t-att-class="'is-' + (s.emcf_mode === 'simulation' ? 'sim' : s.emcf_status)"/><h3 class="nm-grow" t-esc="s.name"/><span class="nm-tag nm-tag-plain" t-esc="s.code"/></div>
                        <dl class="nm-dl">
                            <dt>Mode</dt><dd t-esc="modes[s.emcf_mode]"/>
                            <dt>NID</dt><dd class="nm-mono" t-esc="s.emcf_nim or '—'"/>
                            <dt>ISF</dt><dd class="nm-mono" t-esc="s.emcf_isf or '—'"/>
                            <dt>Jeton</dt><dd t-esc="s.has_token ? 'Enregistré' : 'Aucun'"/>
                            <dt>Dernière vérification</dt><dd><t t-esc="s.emcf_checked_at ? dateTime(s.emcf_checked_at) : 'Jamais'"/><div t-if="s.emcf_status_message" class="nm-muted" t-esc="s.emcf_status_message"/></dd>
                        </dl>
                        <div class="nm-row">
                            <button class="nm-btn nm-btn-sm" t-on-click="() => this.editSite(s)"><Icon name="'edit'" size="15"/> Modifier</button>
                            <BusyButton class="'nm-btn-sm'" icon="'wifi'" onClick="() => this.check(s)">Tester la connexion</BusyButton>
                        </div>
                    </article>
                </div>
            </t>

            <t t-if="state.tab === 'users'">
                <div class="nm-filters"><div class="nm-grow"/><button class="nm-btn nm-btn-primary" t-on-click="() => this.editUser()"><Icon name="'plus'"/> Nouvel utilisateur</button></div>
                <div class="nm-panel nm-table-wrap">
                    <table class="nm-table">
                        <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Établissements</th><th>Dernière connexion</th><th>État</th></tr></thead>
                        <tbody><tr t-foreach="state.users" t-as="u" t-key="u.id" class="is-click" t-on-click="() => this.editUser(u)">
                            <td><b t-esc="u.name"/><span t-if="u.is_owner" class="nm-tag nm-tag-plain nm-tag-gold" style="margin-left:6px">Principal</span></td>
                            <td t-esc="u.login"/><td t-esc="roles[u.role]"/>
                            <td t-esc="u.site_ids.length ? siteCodes(u.site_ids) : 'Tous'"/>
                            <td t-esc="u.last_login ? dateTime(u.last_login) : '—'"/>
                            <td><span class="nm-tag" t-att-class="u.active ? 'nm-tag-ok' : ''" t-esc="u.active ? 'Actif' : 'Désactivé'"/></td>
                        </tr></tbody>
                    </table>
                </div>
            </t>
        </div>`;
    static components = { PageHead, Icon, BusyButton };
    static props = ["*"];
    setup() {
        this.modes = MODES;
        this.dateTime = dateTime;
        this.roles = { cashier: "Caissier / réception", manager: "Gestionnaire", admin: "Administrateur" };
        this.tabs = [["rate", "Taux du jour"]].concat(can("admin") ? [["company", "Entreprise"], ["sites", "Établissements et DGI"], ["users", "Utilisateurs"]] : []);
        const wanted = this.props.params.tab;
        this.state = useState({ tab: this.tabs.some((t) => t[0] === wanted) ? wanted : (can("admin") ? "company" : "rate"),
            rate: session.company.usd_rate, c: null, sites: [], users: [], logo: null });
        onWillStart(() => this.setTab(this.state.tab));
    }
    async setTab(tab) {
        this.state.tab = tab;
        try {
            if (tab === "company") this.state.c = { ...session.company };
            if (tab === "sites") this.state.sites = await api("sites_admin");
            if (tab === "users") { this.state.users = await api("users"); if (!this.state.sites.length) this.state.sites = await api("sites_admin"); }
        } catch (err) { notifyError(err); }
    }
    siteCodes(ids) { return this.state.sites.filter((s) => ids.includes(s.id)).map((s) => s.code).join(", "); }
    async saveRate() {
        const rate = await api("set_rate", { usd_rate: this.state.rate });
        session.company.usd_rate = rate;
        notify(`Taux enregistré : ${money(rate)} CDF pour 1 USD.`, "ok");
    }
    onLogo(ev) {
        const file = ev.target.files[0];
        if (!file) return;
        if (file.size > 1024 * 1024) { notify("Logo trop lourd (1 Mo maximum).", "bad"); return; }
        const reader = new FileReader();
        reader.onload = () => (this.state.logo = reader.result);
        reader.readAsDataURL(file);
    }
    async saveCompany() {
        await api("company_save", { ...this.state.c, logo: this.state.logo || undefined });
        await loadSession();
        this.state.c = { ...session.company };
        notify("Profil de l'entreprise enregistré.", "ok");
    }
    async editSite(s) {
        const res = await openDialog(SiteForm, { site: s ? { ...s } : null });
        if (res) { this.state.sites = res; await loadSession(); }
    }
    async check(s) {
        this.state.sites = await api("site_check", { id: s.id });
        const now = this.state.sites.find((x) => x.id === s.id);
        notify(now.emcf_status === "ok" ? "Dispositif fiscal joignable." : (now.emcf_status_message || "Échec de la connexion."), now.emcf_status === "ok" ? "ok" : "bad");
    }
    async editUser(u) {
        const res = await openDialog(UserForm, { user: u ? { ...u, site_ids: [...u.site_ids] } : null, sites: this.state.sites });
        if (res) this.state.users = res;
    }
}

export class AuditPage extends Component {
    static template = xml`
        <div class="nm-page">
            <PageHead title="'Intégrité et journaux'" subtitle="'Chaque facture normalisée et chaque action sont scellées dans une chaîne d’empreintes SHA-256.'">
                <div class="nm-seg">
                    <button t-att-class="{'is-on': state.tab === 'audit'}" t-on-click="() => this.setTab('audit')">Journal d'audit</button>
                    <button t-if="can('admin')" t-att-class="{'is-on': state.tab === 'emcf'}" t-on-click="() => this.setTab('emcf')">Échanges avec la DGI</button>
                </div>
            </PageHead>
            <div class="nm-grid-2" style="margin-bottom:16px" t-if="state.integrity">
                <div class="nm-panel nm-panel-body nm-integrity" t-att-class="state.integrity.invoices.ok ? 'is-ok' : 'is-bad'">
                    <Icon name="state.integrity.invoices.ok ? 'shield' : 'alert'" size="28"/>
                    <div><b t-esc="state.integrity.invoices.ok ? 'Chaîne des factures intacte' : 'Chaîne des factures rompue'"/>
                        <div class="nm-muted"><t t-esc="state.integrity.invoices.count"/> facture(s) normalisée(s) vérifiée(s)<t t-if="!state.integrity.invoices.ok"> · anomalie : <t t-esc="state.integrity.invoices.broken.join(', ')"/></t></div></div>
                </div>
                <div class="nm-panel nm-panel-body nm-integrity" t-att-class="state.integrity.audit.ok ? 'is-ok' : 'is-bad'">
                    <Icon name="state.integrity.audit.ok ? 'shield' : 'alert'" size="28"/>
                    <div><b t-esc="state.integrity.audit.ok ? 'Journal d’audit intact' : 'Journal d’audit altéré'"/>
                        <div class="nm-muted"><t t-esc="state.integrity.audit.count"/> entrée(s)<t t-if="!state.integrity.audit.ok"> · rupture à l'entrée <t t-esc="state.integrity.audit.broken_at"/></t></div></div>
                </div>
            </div>
            <div class="nm-panel nm-table-wrap" t-if="state.tab === 'audit'">
                <table class="nm-table">
                    <thead><tr><th>N°</th><th>Date</th><th>Événement</th><th>Utilisateur</th><th>Adresse IP</th><th>Empreinte</th></tr></thead>
                    <tbody><tr t-foreach="state.items" t-as="a" t-key="a.sequence">
                        <td class="nm-num" t-esc="a.sequence"/><td t-esc="dateTime(a.date)"/><td><t t-esc="a.message"/><div class="nm-muted nm-mono" style="font-size:11px" t-esc="a.event"/></td>
                        <td t-esc="a.user"/><td class="nm-mono" t-esc="a.ip"/><td class="nm-mono" style="font-size:11px" t-esc="a.hash.slice(0, 16) + '…'"/>
                    </tr></tbody>
                </table>
            </div>
            <div class="nm-panel nm-table-wrap" t-if="state.tab === 'emcf'">
                <table class="nm-table">
                    <thead><tr><th>Date</th><th>Établissement</th><th>Facture</th><th>Requête</th><th>HTTP</th><th>Durée</th><th/></tr></thead>
                    <tbody><t t-foreach="state.items" t-as="l" t-key="l.id">
                        <tr class="is-click" t-on-click="() => this.state.open = this.state.open === l.id ? null : l.id">
                            <td t-esc="dateTime(l.date)"/><td t-esc="l.site"/><td class="nm-mono" t-esc="l.invoice"/>
                            <td class="nm-mono"><t t-esc="l.method"/> <t t-esc="l.path"/></td>
                            <td><span class="nm-tag" t-att-class="l.error or l.status >= 400 ? 'nm-tag-bad' : 'nm-tag-ok'" t-esc="l.error or l.status"/></td>
                            <td class="nm-num"><t t-esc="l.duration"/> ms</td><td t-esc="l.mode === 'simulation' ? 'Simulation' : ''"/>
                        </tr>
                        <tr t-if="state.open === l.id"><td colspan="7"><div class="nm-grid-2"><pre class="nm-pre" t-esc="pretty(l.request)"/><pre class="nm-pre" t-esc="pretty(l.response)"/></div></td></tr>
                    </t></tbody>
                </table>
            </div>
            <div class="nm-row" style="margin-top:12px" t-if="state.total > 50">
                <button class="nm-btn nm-btn-sm" t-att-disabled="!state.offset" t-on-click="() => this.page(-1)">Précédent</button>
                <span class="nm-muted"><t t-esc="state.offset + 1"/>–<t t-esc="state.offset + state.items.length"/> sur <t t-esc="state.total"/></span>
                <button class="nm-btn nm-btn-sm" t-att-disabled="state.offset + 50 >= state.total" t-on-click="() => this.page(1)">Suivant</button>
            </div>
        </div>`;
    static components = { PageHead, Icon };
    static props = ["*"];
    setup() {
        this.dateTime = dateTime;
        this.can = can;
        this.state = useState({ tab: "audit", items: [], total: 0, offset: 0, integrity: null, open: null });
        onWillStart(async () => {
            this.state.integrity = await api("integrity");
            await this.load();
        });
    }
    pretty(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s || ""; } }
    async setTab(t) { this.state.tab = t; this.state.offset = 0; await this.load(); }
    async page(d) { this.state.offset = Math.max(0, this.state.offset + d * 50); await this.load(); }
    async load() {
        try {
            const res = await api(this.state.tab === "audit" ? "audit" : "emcf_logs", { offset: this.state.offset, limit: 50 });
            this.state.items = res.items;
            this.state.total = res.total;
        } catch (err) { notifyError(err); }
    }
}
