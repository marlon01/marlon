/** @odoo-module */
import { Component, markup, onMounted, onWillUnmount, reactive, status, useRef, useState, xml } from "@odoo/owl";

const P = (d) => `<path d="${d}"/>`;
export const ICONS = {
    home: P("M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"),
    cart: P("M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"),
    bed: P("M3 18V6M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6M7 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"),
    utensils: P("M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 2-2 6 0 8v10"),
    briefcase: P("M3 8h18v12H3zM8 8V5h8v3M3 13h18"),
    file: P("M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h4"),
    receipt: P("M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6"),
    box: P("M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"),
    users: P("M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8"),
    user: P("M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"),
    chart: P("M4 20V10M10 20V4M16 20v-7M22 20H2"),
    shield: P("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4"),
    settings: P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
    building: P("M4 21V5l8-3v19M12 21h8V9l-8-3M8 8v.01M8 12v.01M8 16v.01M16 12v.01M16 16v.01M2 21h20"),
    plus: P("M12 5v14M5 12h14"),
    minus: P("M5 12h14"),
    x: P("M18 6L6 18M6 6l12 12"),
    check: P("M20 6L9 17l-5-5"),
    search: P("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3"),
    barcode: P("M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"),
    print: P("M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"),
    refresh: P("M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"),
    undo: P("M3 7v6h6M3 13a9 9 0 1 0 2.6-6.4L3 9"),
    trash: P("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"),
    edit: P("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"),
    logout: P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"),
    menu: P("M3 12h18M3 6h18M3 18h18"),
    alert: P("M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"),
    clock: P("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2"),
    wifi: P("M5 12.6a11 11 0 0 1 14 0M1.4 9a16 16 0 0 1 21.2 0M8.5 16.1a6 6 0 0 1 7 0M12 20h.01"),
    link: P("M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"),
    download: P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"),
    send: P("M22 2L11 13M22 2l-7 20-4-9-9-4z"),
    move: P("M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"),
    sparkle: P("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"),
    key: P("M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"),
    store: P("M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6"),
    globe: P("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"),
    broom: P("M19 3l-7 7M14 12l-6 6-5-1-1-5 6-6zM9 17l-2-2"),
    tool: P("M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8z"),
};

export class Icon extends Component {
    static template = xml`<t t-out="svg"/>`;
    static props = { name: String, size: { type: Number, optional: true } };
    get svg() {
        const s = this.props.size || 18;
        return markup(`<svg class="nm-icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[this.props.name] || ICONS.alert}</svg>`);
    }
}

// ---------------------------------------------------------------- notifications et dialogues
export const ui = reactive({ toasts: [], dialogs: [] });
let toastId = 0;

export function notify(message, type = "info", ms = 4200) {
    const id = ++toastId;
    ui.toasts.push({ id, message, type });
    setTimeout(() => {
        const i = ui.toasts.findIndex((t) => t.id === id);
        if (i >= 0) ui.toasts.splice(i, 1);
    }, ms);
}

export function notifyError(err) {
    notify(err && err.message ? err.message : String(err), "bad", 6500);
}

/** Ouvre un composant en boîte de dialogue ; résout avec la valeur passée à close(). */
export function openDialog(Comp, props = {}) {
    return new Promise((resolve) => {
        const entry = { id: ++toastId, Comp, props: null };
        entry.props = { ...props, close: (value) => {
            const i = ui.dialogs.findIndex((d) => d.id === entry.id);
            if (i >= 0) ui.dialogs.splice(i, 1);
            resolve(value);
        } };
        ui.dialogs.push(entry);
    });
}

export class Dialog extends Component {
    static template = xml`
        <div class="nm-overlay" t-on-mousedown.self="() => props.onClose and props.onClose()" t-on-keydown="onKey">
            <div t-ref="box" class="nm-dialog" t-att-class="props.size === 'lg' ? 'nm-dialog-lg' : ''" role="dialog" aria-modal="true" t-att-aria-label="props.title" tabindex="-1">
                <div class="nm-dialog-head">
                    <h2 t-esc="props.title"/>
                    <button t-if="props.onClose" class="nm-btn nm-btn-ghost nm-btn-icon nm-btn-sm" aria-label="Fermer" t-on-click="() => props.onClose()"><Icon name="'x'"/></button>
                </div>
                <div class="nm-dialog-body"><t t-slot="default"/></div>
                <div class="nm-dialog-foot" t-if="props.slots and props.slots.footer"><t t-slot="footer"/></div>
            </div>
        </div>`;
    static components = { Icon };
    static props = { title: String, onClose: { type: Function, optional: true }, size: { type: String, optional: true }, slots: { optional: true } };
    setup() {
        this.box = useRef("box");
        onMounted(() => {
            const first = this.box.el.querySelector("[data-autofocus]") || this.box.el.querySelector("input:not([type=hidden]), select, textarea");
            (first || this.box.el).focus();
        });
    }
    onKey(ev) {
        if (ev.key === "Escape" && this.props.onClose) this.props.onClose();
    }
}

export class ConfirmDialog extends Component {
    static template = xml`
        <Dialog title="props.title" onClose="() => props.close(false)">
            <p style="margin:0" t-esc="props.message"/>
            <div t-if="props.input" class="nm-field" style="margin-top:14px">
                <span t-esc="props.input"/>
                <input class="nm-input" t-model="state.value" t-att-placeholder="props.placeholder or ''" t-on-keydown="(ev) => ev.key === 'Enter' and this.ok()"/>
            </div>
            <t t-set-slot="footer">
                <button class="nm-btn" t-on-click="() => props.close(false)">Annuler</button>
                <button class="nm-btn" t-att-class="props.danger ? 'nm-btn-danger' : 'nm-btn-primary'" t-on-click="ok" t-esc="props.confirm or 'Confirmer'"/>
            </t>
        </Dialog>`;
    static components = { Dialog };
    static props = ["*"];
    setup() {
        this.state = useState({ value: "" });
    }
    ok() {
        this.props.close(this.props.input ? (this.state.value.trim() || false) : true);
    }
}

export function confirm(title, message, opts = {}) {
    return openDialog(ConfirmDialog, { title, message, ...opts });
}

export class UiHost extends Component {
    static template = xml`
        <div class="nm-toasts" aria-live="polite">
            <div t-foreach="ui.toasts" t-as="t" t-key="t.id" class="nm-toast" t-att-class="t.type === 'bad' ? 'nm-toast-bad' : (t.type === 'ok' ? 'nm-toast-ok' : '')">
                <Icon name="t.type === 'bad' ? 'alert' : (t.type === 'ok' ? 'check' : 'sparkle')"/>
                <div t-esc="t.message"/>
            </div>
        </div>
        <t t-foreach="ui.dialogs" t-as="d" t-key="d.id"><t t-component="d.Comp" t-props="d.props"/></t>`;
    static components = { Icon };
    static props = {};
    setup() {
        this.ui = useState(ui);
    }
}

/** Bouton qui affiche un indicateur pendant l'appel et empêche le double clic (double facture). */
export class BusyButton extends Component {
    static template = xml`
        <button t-att-type="props.type or 'button'" t-att-class="'nm-btn ' + (props.class or '')" t-att-disabled="state.busy or props.disabled" t-on-click="run" t-att-title="props.title or ''">
            <span t-if="state.busy" class="nm-spinner" style="border-top-color:currentColor"/>
            <Icon t-elif="props.icon" name="props.icon"/>
            <t t-slot="default"/>
        </button>`;
    static components = { Icon };
    static props = ["*"];
    setup() {
        this.state = useState({ busy: false });
    }
    async run(ev) {
        if (this.state.busy || !this.props.onClick) return;
        this.state.busy = true;
        try {
            await this.props.onClick(ev);
        } catch (err) {
            notifyError(err);
        } finally {
            if (status(this) !== "destroyed") this.state.busy = false;
        }
    }
}

export function useInterval(fn, ms) {
    let id;
    onMounted(() => (id = setInterval(fn, ms)));
    onWillUnmount(() => clearInterval(id));
}
