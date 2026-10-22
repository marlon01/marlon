/** @odoo-module */
import { Component, onWillStart, useState, xml } from "@odoo/owl";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { debounce, fmtNum, STATE_BADGE, STATE_LABELS } from "@selecta_concours/common/utils";
import {
    copyText, CYCLE_LABELS, daysLabel, dueDate, errMessage, fmtDate, fmtDateTime, formDialog, INVOICE_BADGE,
    invoiceFlags, limitLabel, MAIL_STATES, money, papi, refreshPending, TENANT_BADGE, TENANT_STATES,
} from "@selecta_saas/platform/papi";

// ======================================================================= liste des structures
export class TenantsListPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <header class="ad-head">
                <div>
                    <p class="pf-eyebrow">Administration centrale</p>
                    <h1>Structures</h1>
                    <p class="sl-muted">Organisations inscrites, état de leur essai ou abonnement et prochaine échéance.</p>
                </div>
            </header>
            <div class="ad-toolbar">
                <div class="ad-search">
                    <Icon name="'search'" size="16"/>
                    <label class="sl-sr" for="pf-tenant-search">Rechercher une structure</label>
                    <input id="pf-tenant-search" class="sl-input" type="search" placeholder="Nom, contact ou e-mail" t-att-value="state.search" t-on-input="onSearch"/>
                </div>
                <label class="sl-sr" for="pf-tenant-plan">Catégorie</label>
                <select id="pf-tenant-plan" class="sl-select ad-w-auto" t-on-change="onPlan">
                    <option value="" t-att-selected="!state.planId">Toutes les catégories</option>
                    <option t-foreach="state.plans" t-as="p" t-key="p.id" t-att-value="p.id" t-att-selected="state.planId == p.id" t-esc="p.name"/>
                </select>
                <div class="sl-grow"/>
                <span class="sl-muted ad-small" aria-live="polite"><t t-esc="rows.length"/> structure(s)</span>
            </div>
            <div class="ad-filters" role="group" aria-label="Filtrer par statut">
                <button t-foreach="chips" t-as="c" t-key="c.key" class="ad-chip" t-att-class="{'is-active': state.filter == c.key}"
                        t-att-aria-pressed="state.filter == c.key ? 'true' : 'false'" t-on-click="() => this.setFilter(c.key)">
                    <t t-esc="c.label"/> <span class="sl-muted" t-esc="count(c.key)"/>
                </button>
            </div>
            <div t-if="state.error" class="sl-alert sl-alert-danger ad-mb" role="alert"><t t-esc="state.error"/></div>
            <section class="ad-panel ad-panel-flush">
                <div t-if="state.loading and !state.all.length" class="ad-loading"><span class="sl-spinner"/></div>
                <table t-elif="rows.length" class="ad-table pf-tenants pf-cards">
                    <thead><tr>
                        <th scope="col">Structure</th><th scope="col">Catégorie</th><th scope="col">Statut</th>
                        <th scope="col" class="num">Jours restants</th><th scope="col">Échéance</th><th scope="col">Pays</th><th scope="col">Créée le</th>
                    </tr></thead>
                    <tbody>
                        <tr t-foreach="rows" t-as="t" t-key="t.id" class="is-link" t-on-click="() => this.open(t)">
                            <td data-label="Structure">
                                <a t-att-href="'#/tenants/' + t.id" class="pf-cell-title" t-esc="t.name"/>
                                <div class="sl-muted ad-small"><t t-esc="t.contact_name"/><t t-if="t.contact_name and t.email"> · </t><t t-esc="t.email"/></div>
                            </td>
                            <td data-label="Catégorie"><t t-esc="t.plan_name"/><div t-if="t.state == 'active' or t.state == 'past_due'" class="sl-muted ad-small" t-esc="cycle[t.billing_cycle]"/></td>
                            <td data-label="Statut"><span t-attf-class="sl-badge {{badge[t.state]}}" t-esc="t.state_label"/></td>
                            <td data-label="Jours restants" class="num sl-figures" t-att-class="{'ad-danger-text': t.state == 'trial' and t.days_left lte 3}" t-esc="days(t)"/>
                            <td data-label="Échéance" t-esc="date(due(t))"/>
                            <td data-label="Pays" t-esc="t.country or '—'"/>
                            <td data-label="Créée le" t-esc="date(t.created)"/>
                        </tr>
                    </tbody>
                </table>
                <div t-else="" class="ad-empty">
                    <p t-if="state.all.length">Aucune structure ne correspond à ces critères.</p>
                    <p t-else="">Aucune structure n'est encore inscrite. Les organisations s'inscrivent depuis la page publique de SELECTA.</p>
                    <button t-if="state.search or state.planId or state.filter" class="sl-btn sl-btn-sm" t-on-click="reset">Effacer les filtres</button>
                </div>
            </section>
        </div>`;
    static props = { route: Object };
    setup() {
        const params = this.props.route.params || {};
        this.state = useState({ all: [], plans: [], search: params.search || "", planId: params.plan || "", filter: params.state || "", loading: true, error: "" });
        this.badge = TENANT_BADGE;
        this.cycle = CYCLE_LABELS;
        this.chips = [{ key: "", label: "Toutes" }, ...TENANT_STATES];
        this.onSearch = debounce((ev) => {
            this.state.search = ev.target.value;
            this.load();
        }, 300);
        onWillStart(async () => {
            const [plans] = await Promise.all([papi("plans_list").catch(() => []), this.load()]);
            this.state.plans = plans;
        });
    }
    async load() {
        this.state.loading = true;
        this.state.error = "";
        try {
            this.state.all = await papi("tenants_list", [this.state.search, "", this.state.planId ? parseInt(this.state.planId) : false]);
        } catch (e) {
            this.state.error = errMessage(e);
        } finally {
            this.state.loading = false;
        }
    }
    get rows() {
        return this.state.filter ? this.state.all.filter((t) => t.state === this.state.filter) : this.state.all;
    }
    count(key) {
        return key ? this.state.all.filter((t) => t.state === key).length : this.state.all.length;
    }
    setFilter(key) {
        this.state.filter = key;
    }
    onPlan(ev) {
        this.state.planId = ev.target.value;
        this.load();
    }
    reset() {
        this.state.search = "";
        this.state.planId = "";
        this.state.filter = "";
        this.load();
    }
    open(t) {
        location.hash = `#/tenants/${t.id}`;
    }
    days(t) {
        return daysLabel(t);
    }
    due(t) {
        return dueDate(t);
    }
    date(v) {
        return fmtDate(v);
    }
}

// ======================================================================= détail d'une structure
export class TenantDetailPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page ad-page-wide">
            <a href="#/tenants" class="ad-back"><Icon name="'chevronLeft'" size="14"/>Structures</a>
            <div t-if="state.error" class="sl-alert sl-alert-danger" role="alert"><t t-esc="state.error"/></div>
            <div t-elif="!state.t" class="ad-loading"><span class="sl-spinner"/></div>
            <t t-else="">
                <t t-set="t" t-value="state.t"/>
                <header class="ad-head pf-tenant-head">
                    <div>
                        <div class="sl-row sl-wrap">
                            <h1 t-esc="t.name"/>
                            <span t-attf-class="sl-badge {{badge[t.state]}}" t-esc="t.state_label"/>
                        </div>
                        <p class="sl-muted">
                            Catégorie <strong class="pf-ink" t-esc="t.plan_name"/>
                            <t t-if="t.state == 'active' or t.state == 'past_due'"> · <t t-esc="cycle[t.billing_cycle]"/></t>
                            <t t-if="days(t) != '—'"> · <t t-esc="days(t)"/> restant(s), échéance le <t t-esc="date(due(t))"/></t>
                        </p>
                    </div>
                    <div class="ad-head-actions">
                        <button class="sl-btn sl-btn-sm" t-on-click="extendTrial" t-att-disabled="state.busy"><Icon name="'clock'" size="16"/>Prolonger l'essai</button>
                        <button class="sl-btn sl-btn-sm" t-on-click="activate" t-att-disabled="state.busy or t.state == 'suspended'"><Icon name="'check'" size="16"/>Activer manuellement</button>
                        <button class="sl-btn sl-btn-sm" t-on-click="changePlan" t-att-disabled="state.busy"><Icon name="'tag'" size="16"/>Changer de catégorie</button>
                        <button t-if="t.state == 'suspended'" class="sl-btn sl-btn-sm sl-btn-ink" t-on-click="reactivate" t-att-disabled="state.busy"><Icon name="'unlock'" size="16"/>Réactiver</button>
                        <button t-else="" class="sl-btn sl-btn-sm pf-btn-danger-ghost" t-on-click="suspend" t-att-disabled="state.busy"><Icon name="'lock'" size="16"/>Suspendre</button>
                    </div>
                </header>
                <div t-if="t.state == 'suspended'" class="sl-alert sl-alert-danger ad-mb" role="status">
                    <strong>Compte suspendu.</strong> L'accès à la console de cette structure est bloqué.
                    <t t-if="t.suspended_reason"> Motif : <t t-esc="t.suspended_reason"/></t>
                </div>
                <div t-elif="t.state == 'expired'" class="sl-alert sl-alert-warn ad-mb" role="status">
                    Essai ou abonnement échu : la console de la structure est en consultation seule jusqu'au prochain paiement.
                </div>

                <div class="pf-detail-grid">
                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Dossier</h2></div>
                        <dl class="pf-facts">
                            <div><dt>Contact</dt><dd t-esc="t.contact_name or '—'"/></div>
                            <div><dt>E-mail</dt><dd><a t-if="t.email" t-att-href="'mailto:' + t.email" t-esc="t.email"/><t t-else="">—</t></dd></div>
                            <div><dt>Téléphone</dt><dd><a t-if="t.phone" t-att-href="'tel:' + t.phone" t-esc="t.phone"/><t t-else="">—</t></dd></div>
                            <div><dt>Pays</dt><dd t-esc="t.country or '—'"/></div>
                            <div><dt>Administrateur principal</dt><dd class="sl-mono" t-esc="t.owner or '—'"/></div>
                            <div><dt>Inscrite le</dt><dd t-esc="dt(t.created)"/></div>
                            <div><dt>Adresse IP d'inscription</dt><dd class="sl-mono" t-esc="t.signup_ip or '—'"/></div>
                            <div><dt>Essai</dt><dd><t t-esc="date(t.trial_start)"/> → <t t-esc="date(t.trial_end)"/></dd></div>
                            <div><dt>Abonnement payé jusqu'au</dt><dd t-esc="t.period_end ? date(t.period_end) : 'Jamais souscrit'"/></div>
                        </dl>
                        <div class="pf-examlink">
                            <label class="sl-label" for="pf-exam-url">Lien de l'espace candidat</label>
                            <div class="pf-copy">
                                <input id="pf-exam-url" class="sl-input sl-mono" readonly="readonly" t-att-value="examUrl" t-on-focus="(ev) => ev.target.select()"/>
                                <button class="sl-btn" t-on-click="copyExam"><Icon name="'copy'" size="16"/>Copier</button>
                            </div>
                        </div>
                    </section>

                    <section class="ad-panel">
                        <div class="ad-panel-head"><h2>Consommation</h2><span class="sl-muted ad-small">par rapport aux limites de la catégorie</span></div>
                        <div class="pf-meters">
                            <div t-foreach="meters" t-as="m" t-key="m.key" class="pf-meter" t-att-class="m.cls">
                                <div class="pf-meter-head">
                                    <span t-esc="m.label"/>
                                    <span class="sl-figures"><b t-esc="m.used"/> / <t t-esc="m.limitText"/></span>
                                </div>
                                <div class="pf-meter-track" role="meter" t-att-aria-label="m.label" aria-valuemin="0" t-att-aria-valuemax="m.limit or m.used or 1" t-att-aria-valuenow="m.used">
                                    <div t-attf-style="width: {{m.pct}}%"/>
                                </div>
                                <div t-if="m.note" class="sl-muted ad-small" t-esc="m.note"/>
                            </div>
                        </div>
                        <dl class="pf-facts pf-facts-inline">
                            <div><dt>Concours au total</dt><dd class="sl-figures" t-esc="t.usage.concours_total"/></div>
                            <div><dt>Candidats au total</dt><dd class="sl-figures" t-esc="t.usage.candidates_total"/></div>
                        </dl>
                    </section>
                </div>

                <section class="ad-panel">
                    <div class="ad-panel-head">
                        <h2><label for="pf-notes">Notes internes</label></h2>
                        <span class="sl-muted ad-small">Visibles uniquement par l'administration centrale</span>
                    </div>
                    <textarea id="pf-notes" class="sl-textarea" rows="4" t-model="state.notes" placeholder="Historique commercial, échanges avec le client, engagements particuliers…"/>
                    <div class="pf-actions-row">
                        <span t-if="notesDirty" class="sl-muted ad-small">Modifications non enregistrées</span>
                        <button class="sl-btn sl-btn-sm sl-btn-ink" t-on-click="saveNotes" t-att-disabled="!notesDirty or state.busy">Enregistrer les notes</button>
                    </div>
                </section>

                <div class="ad-tabs" role="tablist" aria-label="Dossier de la structure">
                    <button t-foreach="tabs" t-as="tb" t-key="tb.key" role="tab" class="ad-tab" t-att-class="{'is-active': state.tab == tb.key}"
                            t-att-aria-selected="state.tab == tb.key ? 'true' : 'false'" t-att-id="'pf-tab-' + tb.key" t-on-click="() => this.state.tab = tb.key">
                        <t t-esc="tb.label"/><span t-if="tb.hasCount" class="ad-tab-count" t-esc="tb.count"/>
                    </button>
                </div>
                <section class="ad-panel ad-panel-flush" role="tabpanel" t-att-aria-labelledby="'pf-tab-' + state.tab">
                    <t t-if="state.tab == 'invoices'">
                        <table t-if="t.invoices.length" class="ad-table pf-cards">
                            <thead><tr><th>Facture</th><th>Catégorie</th><th class="num">Montant</th><th>Statut</th><th>Période</th><th>Paiement</th><th>Émise le</th></tr></thead>
                            <tbody>
                                <tr t-foreach="t.invoices" t-as="i" t-key="i.id">
                                    <td data-label="Facture" class="sl-mono" t-esc="i.name"/>
                                    <td data-label="Catégorie"><t t-esc="i.plan"/><div class="sl-muted ad-small" t-esc="cycle[i.billing_cycle]"/></td>
                                    <td data-label="Montant" class="num">
                                        <span class="sl-figures pf-nowrap" t-esc="money(i.amount, i.symbol)"/>
                                        <div t-if="i.credit_amount" class="sl-muted ad-small pf-nowrap" t-att-title="'Prix de la période : ' + money(i.gross_amount, i.symbol)">
                                            avoir −<t t-esc="money(i.credit_amount, i.symbol)"/>
                                        </div>
                                    </td>
                                    <td data-label="Statut">
                                        <span t-attf-class="sl-badge {{ibadge[i.state]}}" t-esc="i.state_label"/>
                                        <div t-if="i.reject_reason" class="ad-small ad-danger-text" t-esc="i.reject_reason"/>
                                        <a t-if="i.state == 'pending'" href="#/payments" class="ad-link ad-small">Traiter</a>
                                        <div t-if="flags(i).length" class="pf-flags">
                                            <span t-foreach="flags(i)" t-as="fl" t-key="fl_index" t-attf-class="pf-flag {{fl.cls}}" t-att-title="fl.title or false" t-esc="fl.label"/>
                                        </div>
                                        <div t-if="i.online_message and i.state != 'paid'" class="ad-small pf-warn-text" t-esc="i.online_message"/>
                                    </td>
                                    <td data-label="Période" class="ad-small"><t t-if="i.period_start"><t t-esc="date(i.period_start)"/> → <t t-esc="date(i.period_end)"/></t><t t-else="">—</t></td>
                                    <td data-label="Paiement" class="ad-small"><t t-esc="i.payment_method_label or '—'"/><div t-if="i.payment_reference" class="sl-mono" t-esc="i.payment_reference"/></td>
                                    <td data-label="Émise le" class="ad-small" t-esc="date(i.date)"/>
                                </tr>
                            </tbody>
                        </table>
                        <div t-else="" class="ad-empty"><p>Aucune facture : la structure n'a pas encore choisi d'abonnement.</p></div>
                    </t>
                    <t t-elif="state.tab == 'mails'">
                        <table t-if="t.mails.length" class="ad-table pf-cards pf-mails">
                            <thead><tr><th>Date</th><th>Modèle</th><th>Destinataire</th><th>Objet</th><th>Statut</th><th>Tentatives et erreur</th><th class="num"><span class="sl-sr">Actions</span></th></tr></thead>
                            <tbody>
                                <tr t-foreach="t.mails" t-as="m" t-key="m.id">
                                    <td data-label="Date" class="ad-small pf-nowrap" t-esc="dt(m.date)"/>
                                    <td data-label="Modèle" t-esc="m.label"/>
                                    <td data-label="Destinataire" class="ad-small"><span class="pf-break" t-esc="m.email_to"/></td>
                                    <td data-label="Objet" class="ad-small" t-esc="m.subject"/>
                                    <td data-label="Statut">
                                        <span t-attf-class="sl-badge {{mstates[m.state].badge}}" t-esc="mstates[m.state].label"/>
                                        <div t-if="m.sent_date" class="sl-muted ad-small pf-nowrap">le <t t-esc="dt(m.sent_date)"/></div>
                                    </td>
                                    <td data-label="Tentatives" class="ad-small">
                                        <span class="sl-figures" t-esc="m.attempts"/><t t-if="m.attempts"> tentative(s)</t>
                                        <div t-if="m.last_error" class="pf-mail-error" t-esc="m.last_error"/>
                                    </td>
                                    <td class="num">
                                        <button t-if="m.state == 'failed'" class="sl-btn sl-btn-sm" t-on-click="() => this.retryMail(m)" t-att-disabled="state.retrying == m.id">
                                            <t t-if="state.retrying == m.id"><span class="sl-spinner"/> Envoi…</t><t t-else=""><Icon name="'refresh'" size="14"/>Réessayer</t>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div t-else="" class="ad-empty"><Icon name="'mail'" size="28"/><p>Aucun courriel adressé à cette structure.</p></div>
                        <p t-if="t.mails.length" class="sl-muted ad-small pf-pad">
                            Les 30 messages les plus récents. Les messages « En file » partent toutes les 5 minutes lorsque l'envoi est activé (<a href="#/settings" class="ad-link">Paramètres › Messagerie</a>).
                        </p>
                    </t>
                    <t t-elif="state.tab == 'staff'">
                        <table t-if="t.staff.length" class="ad-table pf-cards">
                            <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Dernière connexion</th><th>Statut</th></tr></thead>
                            <tbody>
                                <tr t-foreach="t.staff" t-as="u" t-key="u.id" t-att-class="{'is-muted': !u.active}">
                                    <td data-label="Nom"><strong t-esc="u.name"/></td>
                                    <td data-label="Identifiant" class="sl-mono" t-esc="u.login"/>
                                    <td data-label="Rôle" t-esc="u.role or '—'"/>
                                    <td data-label="Dernière connexion" t-esc="u.login_date ? dt(u.login_date) : 'Jamais'"/>
                                    <td data-label="Statut"><span t-attf-class="sl-badge {{u.active ? 'sl-badge-ok' : ''}}" t-esc="u.active ? 'Actif' : 'Désactivé'"/></td>
                                </tr>
                            </tbody>
                        </table>
                        <div t-else="" class="ad-empty"><p>Aucun compte du personnel.</p></div>
                    </t>
                    <t t-elif="state.tab == 'concours'">
                        <table t-if="t.concours.length" class="ad-table pf-cards">
                            <thead><tr><th>Concours</th><th>État</th><th>Ouverture</th><th class="num">Candidats</th></tr></thead>
                            <tbody>
                                <tr t-foreach="t.concours" t-as="c" t-key="c.id">
                                    <td data-label="Concours"><strong t-esc="c.name"/><div class="sl-muted sl-mono ad-small" t-esc="c.reference"/></td>
                                    <td data-label="État"><span t-attf-class="sl-badge {{cbadge[c.state] or ''}}" t-esc="clabels[c.state] or c.state"/></td>
                                    <td data-label="Ouverture" t-esc="dt(c.date_start)"/>
                                    <td data-label="Candidats" class="num sl-figures" t-esc="c.candidates"/>
                                </tr>
                            </tbody>
                        </table>
                        <div t-else="" class="ad-empty"><p>Aucun concours créé par cette structure.</p></div>
                        <p t-if="t.concours.length gte 20" class="sl-muted ad-small pf-pad">Les 20 concours les plus récents sont affichés.</p>
                    </t>
                    <t t-elif="state.tab == 'audit'">
                        <div class="pf-pad">
                            <div class="ad-check" t-att-class="t.audit.ok ? 'is-ok' : 'is-ko'">
                                <Icon name="t.audit.ok ? 'shield' : 'alert'" size="28"/>
                                <div>
                                    <strong t-if="t.audit.ok">Journal d'audit intègre : <t t-esc="num(t.audit.count)"/> entrée(s) vérifiée(s).</strong>
                                    <strong t-else="">Anomalie détectée à l'entrée n° <t t-esc="t.audit.broken_at"/> sur <t t-esc="num(t.audit.count)"/> vérifiée(s).</strong>
                                    <div t-if="t.audit.ok and t.audit.head" class="sl-mono ad-small pf-hash">Empreinte de tête <t t-esc="t.audit.head"/></div>
                                    <div t-if="!t.audit.ok" t-esc="t.audit.reason"/>
                                </div>
                            </div>
                            <p class="sl-muted ad-small">Chaque opération de la structure est chaînée à la précédente par une empreinte SHA-256 ; toute modification directe en base rompt la chaîne. Vérification effectuée à l'ouverture de cette fiche.</p>
                        </div>
                    </t>
                </section>
            </t>
        </div>`;
    static props = { tenantId: Number };
    setup() {
        this.state = useState({ t: null, plans: [], notes: "", tab: "invoices", busy: false, error: "", retrying: 0 });
        this.mstates = MAIL_STATES;
        this.badge = TENANT_BADGE;
        this.ibadge = INVOICE_BADGE;
        this.cycle = CYCLE_LABELS;
        this.clabels = STATE_LABELS;
        this.cbadge = STATE_BADGE;
        onWillStart(() => this.load());
    }
    async load() {
        try {
            this.setData(await papi("tenant_get", [this.props.tenantId]));
        } catch (e) {
            this.state.error = errMessage(e);
        }
    }
    setData(t) {
        t.mails = t.mails || [];
        this.state.t = t;
        this.state.notes = t.notes || "";
    }
    get notesDirty() {
        return (this.state.notes || "") !== (this.state.t.notes || "");
    }
    get tabs() {
        const t = this.state.t;
        return [
            { key: "invoices", label: "Factures", count: t.invoices.length, hasCount: true },
            { key: "mails", label: "Courriels", count: t.mails.length, hasCount: true },
            { key: "staff", label: "Personnel", count: t.staff.length, hasCount: true },
            { key: "concours", label: "Concours", count: t.concours.length, hasCount: true },
            { key: "audit", label: "Intégrité du journal d'audit" },
        ];
    }
    get examUrl() {
        return window.location.origin + this.state.t.exam_url;
    }
    get meters() {
        const t = this.state.t;
        const u = t.usage;
        const l = t.limits;
        const mk = (key, label, used, limit, note) => {
            const pct = limit ? Math.min(100, Math.round((100 * used) / limit)) : 0;
            return { key, label, used: fmtNum(used, 0), limit, limitText: limitLabel(limit), pct: limit ? pct : 0, note, cls: !limit ? "is-unlimited" : pct >= 100 ? "is-full" : pct >= 80 ? "is-high" : "" };
        };
        const out = [
            mk("concours", "Concours actifs simultanés", u.active_concours, l.active_concours),
            mk("candidates", "Candidats inscrits ce mois-ci", u.candidates_month, l.candidates_month),
            mk("staff", "Comptes du personnel", u.staff, l.staff),
        ];
        if (l.trial_candidates) {
            out.push(mk("trial", "Plafond de candidats pendant l'essai", u.candidates_total, l.trial_candidates, "Plafond levé dès la souscription d'un abonnement."));
        }
        return out;
    }
    async run(action, params, okMessage) {
        this.state.busy = true;
        try {
            this.setData(await papi("tenant_action", [this.state.t.id, action, params || {}]));
            notify(okMessage, "ok");
            return true;
        } catch (e) {
            notify(errMessage(e), "danger", 7000);
            return false;
        } finally {
            this.state.busy = false;
        }
    }
    async extendTrial() {
        const t = this.state.t;
        const paid = t.state === "active" || t.state === "past_due";
        const res = await formDialog({
            title: "Prolonger l'essai gratuit",
            body: paid
                ? `${t.name} a déjà un abonnement payé : la prolongation repousse la date de fin d'essai mais ne modifie pas l'abonnement en cours.`
                : `La date de fin d'essai de ${t.name} sera repoussée à partir de ${t.state === "trial" ? "l'échéance actuelle (" + this.date(t.trial_end) + ")" : "aujourd'hui"}. La structure retrouve un accès complet.`,
            confirmLabel: "Prolonger",
            fields: [{ name: "days", label: "Nombre de jours", type: "number", value: 7, min: 1, max: 90, help: "De 1 à 90 jours." }],
        });
        if (res) {
            await this.run("extend_trial", { days: res.days }, `Essai prolongé de ${res.days} jour(s).`);
        }
    }
    async activate() {
        const t = this.state.t;
        const p = t.plan;
        const res = await formDialog({
            title: "Activer l'abonnement manuellement",
            body: `Pour un encaissement réalisé hors plateforme (contrat, bon de commande, paiement au guichet). Une facture « Payée » est créée immédiatement pour la catégorie « ${t.plan_name} » et l'abonnement est prolongé d'un cycle à partir de l'échéance en cours. Cette opération est inscrite au journal d'audit de la structure.`,
            confirmLabel: "Créer la facture et activer",
            fields: [
                {
                    name: "cycle", label: "Cycle de facturation", type: "select", value: "monthly",
                    options: [
                        { value: "monthly", label: `Mensuel : ${money(p.price_monthly, p.symbol)}` },
                        { value: "yearly", label: `Annuel : ${money(p.price_yearly, p.symbol)}` },
                    ],
                },
                { name: "reference", label: "Référence de l'encaissement", type: "text", placeholder: "N° de contrat, de bon de commande ou de reçu", help: "Facultatif, reporté sur la facture." },
            ],
        });
        if (res) {
            await this.run("activate", res, "Abonnement activé, facture soldée créée.");
            refreshPending();
        }
    }
    async changePlan() {
        if (!this.state.plans.length) {
            try {
                this.state.plans = await papi("plans_list");
            } catch (e) {
                notify(errMessage(e), "danger");
                return;
            }
        }
        const t = this.state.t;
        const res = await formDialog({
            title: "Changer de catégorie",
            body: "Les nouvelles limites s'appliquent immédiatement. Le tarif de la nouvelle catégorie sera utilisé pour les prochaines factures ; l'échéance en cours n'est pas modifiée.",
            confirmLabel: "Changer de catégorie",
            fields: [{
                name: "plan_id", label: "Nouvelle catégorie", type: "select", value: String(t.plan_id),
                options: this.state.plans.map((p) => ({ value: String(p.id), label: `${p.name} (${money(p.price_monthly, p.symbol)} / mois)${p.active ? "" : " · inactive"}` })),
            }],
        });
        if (res && parseInt(res.plan_id) !== t.plan_id) {
            await this.run("change_plan", { plan_id: parseInt(res.plan_id) }, "Catégorie modifiée.");
        }
    }
    async suspend() {
        const t = this.state.t;
        const res = await formDialog({
            title: `Suspendre ${t.name}`,
            body: "Plus aucun membre de la structure ne pourra utiliser la console et les épreuves en cours seront inaccessibles. Les données sont conservées. Le motif est communiqué à la structure.",
            confirmLabel: "Suspendre le compte",
            danger: true,
            fields: [{ name: "reason", label: "Motif de la suspension", type: "textarea", minLength: 5, placeholder: "Ex. : impayé après relances, usage contraire aux conditions…" }],
        });
        if (res) {
            await this.run("suspend", { reason: res.reason }, "Compte suspendu.");
        }
    }
    async reactivate() {
        const ok = await confirmDialog({
            title: `Réactiver ${this.state.t.name}`,
            body: "La structure retrouve l'accès correspondant à ses dates d'essai ou d'abonnement (accès complet, ou consultation seule si l'échéance est dépassée).",
            confirmLabel: "Réactiver",
        });
        if (ok) {
            await this.run("reactivate", {}, "Compte réactivé.");
        }
    }
    flags(i) {
        return invoiceFlags(i);
    }
    async retryMail(m) {
        this.state.retrying = m.id;
        try {
            const res = await papi("mail_retry", [m.id]);
            if (res) {
                Object.assign(m, res);
                if (res.state === "sent") {
                    notify(`Message envoyé à ${res.email_to}.`, "ok");
                } else {
                    notify(`Nouvel échec : ${res.last_error || "erreur inconnue"}. Le message reste en file pour un prochain essai.`, "warn", 8000);
                }
            }
        } catch (e) {
            notify(errMessage(e), "danger", 7000);
        } finally {
            this.state.retrying = 0;
        }
    }
    async saveNotes() {
        await this.run("notes", { notes: this.state.notes }, "Notes enregistrées.");
    }
    async copyExam() {
        const ok = await copyText(this.examUrl);
        notify(ok ? "Lien copié dans le presse-papiers." : "Copie impossible : sélectionnez le lien manuellement.", ok ? "ok" : "warn");
    }
    days(t) {
        return daysLabel(t);
    }
    due(t) {
        return dueDate(t);
    }
    date(v) {
        return fmtDate(v);
    }
    dt(v) {
        return fmtDateTime(v);
    }
    num(v) {
        return fmtNum(v, 0);
    }
    money(v, s) {
        return money(v, s);
    }
}
