/** @odoo-module */
import { Component, markup, reactive, useState, xml } from "@odoo/owl";

const P = (d) => `<path d="${d}"/>`;
export const ICONS = {
    dashboard: P("M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"),
    trophy: P("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"),
    book: P("M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"),
    users: P("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"),
    eye: P("M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"),
    chart: P("M18 20V10M12 20V4M6 20v-6"),
    brain: P("M9.5 2a2.5 2.5 0 0 0-2.45 3A3 3 0 0 0 5 8a3 3 0 0 0 .4 4.5A3 3 0 0 0 7 18a2.5 2.5 0 0 0 5 .5V4.5A2.5 2.5 0 0 0 9.5 2zM14.5 2A2.5 2.5 0 0 1 17 4.5a3 3 0 0 1 2 3.5 3 3 0 0 1-.4 4.5A3 3 0 0 1 17 18a2.5 2.5 0 0 1-5 .5"),
    shield: P("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4"),
    key: P("M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"),
    settings: P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"),
    logout: P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"),
    plus: P("M12 5v14M5 12h14"),
    edit: P("M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"),
    trash: P("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"),
    copy: P("M9 9h11v11H9zM5 15H4V4h11v1"),
    check: P("M20 6L9 17l-5-5"),
    x: P("M18 6L6 18M6 6l12 12"),
    upload: P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"),
    download: P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"),
    print: P("M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"),
    play: P("M5 3l14 9-14 9z"),
    stop: P("M6 6h12v12H6z"),
    lock: P("M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4"),
    unlock: P("M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1"),
    search: P("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35"),
    camera: P("M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"),
    wifi: P("M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"),
    wifiOff: P("M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"),
    alert: P("M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"),
    clock: P("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2"),
    refresh: P("M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"),
    file: P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"),
    link: P("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"),
    user: P("M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"),
    flag: P("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"),
    menu: P("M3 12h18M3 6h18M3 18h18"),
    image: P("M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21"),
    chevronRight: P("M9 18l6-6-6-6"),
    chevronLeft: P("M15 18l-6-6 6-6"),
    fullscreen: P("M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"),
};

export class Icon extends Component {
    static template = xml`<t t-out="svg"/>`;
    static props = { name: String, size: { type: Number, optional: true }, class: { type: String, optional: true } };
    get svg() {
        const s = this.props.size || 18;
        const body = ICONS[this.props.name] || ICONS.alert;
        return markup(
            `<svg class="sl-icon ${this.props.class || ""}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
        );
    }
}

// ------------------------------------------------------------------ notifications & dialogues
export const uiBus = reactive({ toasts: [], dialog: null });
let toastId = 0;

export function notify(message, type = "info", duration = 4500) {
    const id = ++toastId;
    uiBus.toasts.push({ id, message, type });
    setTimeout(() => {
        const idx = uiBus.toasts.findIndex((t) => t.id === id);
        if (idx >= 0) {
            uiBus.toasts.splice(idx, 1);
        }
    }, duration);
}

/**
 * Boîte de confirmation. options : {title, body, confirmLabel, cancelLabel, danger, input:{label, placeholder, minLength}}
 * Résout true / false (ou la saisie si input).
 */
export function confirmDialog(options) {
    return new Promise((resolve) => {
        uiBus.dialog = { ...options, value: "", resolve };
    });
}

export class UiHost extends Component {
    static template = xml`
        <div class="sl-toasts" aria-live="polite">
            <t t-foreach="bus.toasts" t-as="t" t-key="t.id">
                <div t-attf-class="sl-toast sl-toast-{{t.type}}" role="status"><t t-esc="t.message"/></div>
            </t>
        </div>
        <t t-if="bus.dialog">
            <div class="sl-overlay" t-on-click.self="() => this.close(false)">
                <div class="sl-dialog" role="dialog" aria-modal="true">
                    <div class="sl-dialog-head"><h3 t-esc="bus.dialog.title"/></div>
                    <div class="sl-dialog-body">
                        <p t-if="bus.dialog.body" style="white-space:pre-line" t-esc="bus.dialog.body"/>
                        <div t-if="bus.dialog.input" class="sl-field">
                            <label t-esc="bus.dialog.input.label"/>
                            <textarea class="sl-textarea" t-model="bus.dialog.value" t-att-placeholder="bus.dialog.input.placeholder"/>
                        </div>
                    </div>
                    <div class="sl-dialog-foot">
                        <button class="sl-btn" t-on-click="() => this.close(false)" t-esc="bus.dialog.cancelLabel or 'Annuler'"/>
                        <button t-attf-class="sl-btn {{bus.dialog.danger ? 'sl-btn-danger' : 'sl-btn-primary'}}"
                                t-att-disabled="!canConfirm"
                                t-on-click="() => this.close(true)" t-esc="bus.dialog.confirmLabel or 'Confirmer'"/>
                    </div>
                </div>
            </div>
        </t>`;
    static props = {};
    setup() {
        this.bus = useState(uiBus);
    }
    get canConfirm() {
        const d = this.bus.dialog;
        if (!d?.input) {
            return true;
        }
        return (d.value || "").trim().length >= (d.input.minLength || 1);
    }
    close(ok) {
        const d = this.bus.dialog;
        this.bus.dialog = null;
        if (d) {
            d.resolve(ok ? (d.input ? d.value.trim() : true) : false);
        }
    }
}
