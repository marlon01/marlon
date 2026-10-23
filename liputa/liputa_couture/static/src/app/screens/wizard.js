/** @odoo-module **/
import { onWillStart, useState, xml } from "@odoo/owl";
import { api, store, toast } from "../core/api";
import { Base, Icon, readImage, Tape, TopBar } from "../core/ui";
import { go } from "../core/router";
import { longDate, money, num } from "../core/format";
import { GROUPS } from "./order";

const STEPS = ["Client", "Measurements", "Model", "Fabric & delivery"];

/** New order in four steps, designed for one-handed use at the counter. */
export class WizardScreen extends Base {
    static template = xml`
    <div class="lp-screen lp-no-tabbar">
        <TopBar title="t('New order')" fallback="'/home'"/>
        <div class="lp-wiz-progress" aria-hidden="true"><i t-foreach="steps" t-as="s" t-key="s_index" t-att-class="s_index &lt;= state.step ? 'lp-on' : ''"/></div>
        <p class="lp-kicker" t-esc="t('Step %s of %s', state.step + 1, steps.length)"/>
        <h1 class="lp-title" style="font-size: 30px; margin-bottom: 18px" t-esc="t(steps[state.step])"/>

        <!-- 1. CLIENT -->
        <t t-if="state.step === 0">
            <div class="lp-search">
                <Icon name="'search'" size="20"/>
                <input class="lp-input" type="search" t-att-placeholder="t('Search an existing client')" t-on-input="onClientSearch"/>
            </div>
            <div class="lp-sheet" t-if="state.clients.length">
                <ul class="lp-list">
                    <li t-foreach="state.clients" t-as="c" t-key="c.id">
                        <button class="lp-row" t-on-click="() => this.pickClient(c)">
                            <span class="lp-avatar" style="width: 40px; height: 40px; font-size: 15px" t-esc="initials(c.name)"/>
                            <div class="lp-row-main">
                                <div class="lp-row-title" t-esc="c.name"/>
                                <div class="lp-row-sub"><t t-esc="c.phone"/><t t-if="c.orders"> · <t t-esc="c.orders"/> <t t-esc="t('orders')"/></t></div>
                            </div>
                            <span t-if="v.partner_id === c.id" class="lp-check lp-done"><Icon name="'check'" size="18" stroke="2.4"/></span>
                        </button>
                    </li>
                </ul>
            </div>
            <h2 class="lp-h2" t-esc="t('Or a new client')"/>
            <label class="lp-field"><span class="lp-label" t-esc="t('Full name')"/>
                <input class="lp-input" autocomplete="name" t-model="v.client_name" t-on-input="() => v.partner_id = false"/></label>
            <label class="lp-field"><span class="lp-label" t-esc="t('Phone / WhatsApp')"/>
                <input class="lp-input" type="tel" inputmode="tel" autocomplete="tel" t-model="v.client_phone"/></label>
            <div class="lp-seg" role="tablist">
                <button t-foreach="genders" t-as="gd" t-key="gd[0]" t-att-class="v.gender === gd[0] ? 'lp-on' : ''" t-on-click="() => v.gender = gd[0]" t-esc="t(gd[1])"/>
            </div>
            <label class="lp-photo-pick">
                <img t-if="v.client_photo" t-att-src="v.client_photo" alt=""/>
                <span t-else="" class="lp-photo-empty"><Icon name="'camera'" size="26"/></span>
                <span><b class="lp-strong" t-esc="t('Client photo')"/><br/><span class="lp-small lp-muted" t-esc="t('Helps the fitting and the AI render')"/></span>
                <input type="file" accept="image/*" capture="environment" hidden="1" t-on-change="(ev) => this.pickImage(ev, 'client_photo')"/>
            </label>
            <div class="lp-toggle-row" t-if="v.client_photo">
                <span class="lp-small" t-esc="t('The client agrees to the use of this photo')"/>
                <button t-attf-class="lp-switch #{v.photo_consent ? 'lp-on' : ''}" role="switch" t-att-aria-checked="v.photo_consent" t-on-click="() => v.photo_consent = !v.photo_consent"/>
            </div>
        </t>

        <!-- 2. MEASUREMENTS -->
        <t t-if="state.step === 1">
            <div t-if="state.profileDate" class="lp-banner"><Icon name="'check'" size="20"/><span t-esc="t('Measurements from %s loaded', longDate(state.profileDate))"/></div>
            <t t-foreach="groups" t-as="g" t-key="g[0]">
                <h2 class="lp-h2" t-esc="t(g[0])"/>
                <div class="lp-measure-grid">
                    <label t-foreach="g[1]" t-as="f" t-key="f[0]" t-attf-class="lp-measure #{v.m[f[0]] ? 'lp-filled' : ''}">
                        <span class="lp-label" style="font-size: 13px; margin: 0" t-esc="t(f[1])"/>
                        <div><input type="number" inputmode="decimal" step="0.5" min="0" max="300" t-att-value="v.m[f[0]] || ''"
                                    t-on-input="(ev) => v.m[f[0]] = parseFloat(ev.target.value) || 0" placeholder="-"/><span>cm</span></div>
                    </label>
                </div>
            </t>
            <div class="lp-toggle-row" style="margin-top: 10px">
                <span class="lp-small" t-esc="saveProfileLabel"/>
                <button t-attf-class="lp-switch #{v.save_profile ? 'lp-on' : ''}" role="switch" t-att-aria-checked="v.save_profile" t-on-click="() => v.save_profile = !v.save_profile"/>
            </div>
        </t>

        <!-- 3. MODEL -->
        <t t-if="state.step === 2">
            <span class="lp-label" t-esc="t('Event')"/>
            <div class="lp-chips">
                <button t-foreach="state.events" t-as="e" t-key="e.id" t-attf-class="lp-chip #{v.event_type_id === e.id ? 'lp-on' : ''}"
                        t-on-click="() => this.pickEvent(e.id)" t-esc="e.name"/>
            </div>
            <label class="lp-field"><span class="lp-label" t-esc="t('Wishes (optional)')"/>
                <textarea class="lp-textarea" rows="2" maxlength="600" t-att-placeholder="t('e.g. matching the family, wax, fitted cut')" t-model="v.notes"/></label>
            <button class="lp-btn lp-btn-tape lp-btn-block" t-att-disabled="state.suggesting" t-on-click="suggest">
                <Icon name="'sparkle'"/><t t-esc="t('Ask the AI stylist')"/>
            </button>
            <p class="lp-small lp-muted lp-center" style="margin: 6px 0 16px" t-esc="t('Based on the event and the wishes')"/>
            <div t-if="state.advice" class="lp-advice"><Icon name="'sparkle'" size="20"/><span t-esc="state.advice"/></div>
            <div class="lp-model-grid">
                <button t-foreach="state.models" t-as="m" t-key="m.id" t-attf-class="lp-model #{v.garment_model_id === m.id ? 'lp-on' : ''}"
                        t-on-click="() => this.pickModel(m)" t-att-aria-pressed="v.garment_model_id === m.id">
                    <div class="lp-model-top">
                        <img t-att-src="'/web/image/liputa.garment.model/' + m.id + '/image_512'" alt="" loading="lazy"/>
                        <span t-if="m.score" class="lp-score" t-esc="m.score"/>
                        <span t-if="v.garment_model_id === m.id" class="lp-pill lp-tape"><Icon name="'check'" size="14" stroke="2.6"/></span>
                    </div>
                    <div class="lp-model-body">
                        <span class="lp-model-name" t-esc="m.name"/>
                        <span class="lp-model-meta" t-esc="m.category"/>
                        <span t-if="m.reason" class="lp-model-reason" t-esc="m.reason"/>
                    </div>
                </button>
            </div>
        </t>

        <!-- 4. FABRIC & DELIVERY -->
        <t t-if="state.step === 3">
            <span class="lp-label" t-esc="t('Fabric brought by')"/>
            <div class="lp-seg">
                <button t-att-class="v.fabric_supplied_by === 'client' ? 'lp-on' : ''" t-on-click="() => v.fabric_supplied_by = 'client'" t-esc="t('The client')"/>
                <button t-att-class="v.fabric_supplied_by === 'atelier' ? 'lp-on' : ''" t-on-click="() => v.fabric_supplied_by = 'atelier'" t-esc="t('The workshop')"/>
            </div>
            <label class="lp-photo-pick" style="margin-bottom: 14px">
                <img t-if="v.fabric_image" t-att-src="v.fabric_image" alt=""/>
                <span t-else="" class="lp-photo-empty"><Icon name="'camera'" size="26"/></span>
                <span><b class="lp-strong" t-esc="t('Fabric photo')"/><br/><span class="lp-small lp-muted" t-esc="t('Dresses the virtual mannequin')"/></span>
                <input type="file" accept="image/*" capture="environment" hidden="1" t-on-change="(ev) => this.pickImage(ev, 'fabric_image')"/>
            </label>
            <label class="lp-field"><span class="lp-label" t-esc="t('Fabric description')"/>
                <input class="lp-input" t-att-placeholder="t('e.g. Dutch wax, 6 yards')" t-model="v.fabric_description"/></label>
            <div class="lp-sheet">
                <div class="lp-toggle-row">
                    <span><b class="lp-strong" t-esc="t('Express order')"/><br/><span class="lp-small lp-muted" t-esc="t('Surcharge applied, served first')"/></span>
                    <button t-attf-class="lp-switch #{v.is_urgent ? 'lp-on' : ''}" role="switch" t-att-aria-checked="v.is_urgent" t-on-click="toggleUrgent"/>
                </div>
            </div>
            <section class="lp-estimate" style="margin-top: 14px" t-if="state.estimate">
                <div class="lp-small lp-muted" t-esc="t('Estimated delivery')"/>
                <div class="lp-deliv-date" style="margin: 2px 0 12px" t-esc="capital(longDate(state.estimate.date))"/>
                <Tape value="state.estimate.days" max="21"/>
                <div class="lp-tape-labels" style="color: rgba(255,255,255,.6)"><span t-esc="t('today')"/><span>21 j</span></div>
                <p class="lp-small lp-muted" style="margin: 10px 0 0">
                    <t t-esc="t('Confidence: %s', t(state.estimate.confidence))"/> · <t t-esc="num(state.estimate.hours)"/> h
                </p>
            </section>
        </t>

        <div class="lp-actionbar">
            <button t-if="state.step > 0" class="lp-btn lp-btn-ghost" t-on-click="prev" t-att-aria-label="t('Back')"><Icon name="'back'"/></button>
            <button t-if="state.step &lt; steps.length - 1" class="lp-btn lp-btn-primary" t-on-click="next" t-esc="t('Continue')"/>
            <button t-else="" class="lp-btn lp-btn-tape" t-att-disabled="state.saving" t-on-click="save">
                <Icon name="'check'"/><t t-esc="t('Create and confirm')"/>
            </button>
        </div>
    </div>`;
    static components = { TopBar, Icon, Tape };
    static props = {};

    setup() {
        this.steps = STEPS;
        this.groups = GROUPS;
        this.genders = [["women", "Woman"], ["men", "Man"], ["child", "Child"]];
        Object.assign(this, { longDate, num, money });
        this.v = useState({
            partner_id: false, client_name: "", client_phone: "", gender: "women", client_photo: "", photo_consent: false,
            m: {}, save_profile: true, event_type_id: false, notes: "", garment_model_id: Number(store.route.query.model) || false,
            fabric_supplied_by: "client", fabric_image: "", fabric_description: "", is_urgent: false,
        });
        this.state = useState({ step: 0, clients: [], events: [], models: [], advice: "", suggesting: false,
                                estimate: null, saving: false, profileDate: null });
        onWillStart(async () => {
            const [clients, events, cat] = await Promise.all([api.clients(""), api.events(), api.catalogue({})]);
            this.state.clients = clients.slice(0, 5);
            this.state.events = events;
            this.state.models = cat.models.slice(0, 12);
        });
    }
    get saveProfileLabel() {
        return this.t("Save these measurements in the client's file");
    }
    initials(name) {
        return (name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    }
    capital(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    }
    onClientSearch(ev) {
        clearTimeout(this._t);
        this._t = setTimeout(async () => (this.state.clients = await api.clients(ev.target.value)), 250);
    }
    pickClient(c) {
        Object.assign(this.v, { partner_id: c.id, client_name: c.name, client_phone: c.phone, gender: c.gender || "women" });
        if (c.measurements) {
            this.v.m = Object.fromEntries(Object.entries(c.measurements).filter(([, x]) => x));
            this.state.profileDate = c.profile_date;
        }
    }
    async pickImage(ev, field) {
        const file = ev.target.files?.[0];
        if (file) {
            this.v[field] = await readImage(file);
        }
    }
    pickEvent(id) {
        this.v.event_type_id = this.v.event_type_id === id ? false : id;
    }
    pickModel(m) {
        this.v.garment_model_id = m.id;
    }
    async suggest() {
        this.state.suggesting = true;
        try {
            const res = await api.suggest({ event_type_id: this.v.event_type_id, gender: this.v.gender, notes: this.v.notes });
            this.state.advice = res.advice;
            this.state.models = res.suggestions.map((s) => ({ ...s }));
        } catch (e) {
            toast(e.message, "error");
        } finally {
            this.state.suggesting = false;
        }
    }
    async toggleUrgent() {
        this.v.is_urgent = !this.v.is_urgent;
        await this.loadEstimate();
    }
    async loadEstimate() {
        if (!this.v.garment_model_id) {
            return;
        }
        const est = await api.estimate({ garment_model_id: this.v.garment_model_id, is_urgent: this.v.is_urgent });
        const days = Math.max(0, Math.round((new Date(est.date) - new Date()) / 86400000));
        this.state.estimate = { ...est, days };
    }
    validate() {
        const s = this.state.step;
        if (s === 0 && !this.v.partner_id && !this.v.client_name.trim()) {
            return this.t("Choose a client to continue");
        }
        if (s === 1 && !this.v.m.bust && !this.v.m.height) {
            return this.t("Enter at least the bust or the height");
        }
        if (s === 2 && !this.v.garment_model_id) {
            return this.t("Choose a model to continue");
        }
        return null;
    }
    async next() {
        const error = this.validate();
        if (error) {
            toast(error, "error");
            return;
        }
        this.state.step++;
        window.scrollTo({ top: 0 });
        if (this.state.step === 3) {
            await this.loadEstimate();
        }
    }
    prev() {
        this.state.step--;
        window.scrollTo({ top: 0 });
    }
    async save() {
        this.state.saving = true;
        try {
            const { m, ...rest } = this.v;
            const res = await api.create({ ...rest, ...m, confirm: true });
            toast(this.t("Order created"));
            go(`/order/${res.id}`);
        } catch (e) {
            toast(e.message, "error");
        } finally {
            this.state.saving = false;
        }
    }
}
