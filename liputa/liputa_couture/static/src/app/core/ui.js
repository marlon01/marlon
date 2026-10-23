/** @odoo-module **/
import { Component, markup, xml } from "@odoo/owl";
import { t } from "./i18n";
import { back } from "./router";

const P = {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7V20a.8.8 0 0 1-.8.8H15v-6.3H9v6.3H4.3a.8.8 0 0 1-.8-.8z"/>',
    orders: '<rect x="5" y="4" width="14" height="17" rx="2.2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    hanger: '<path d="M12 7.2a2.1 2.1 0 1 1 2.1-2.1c0 1.1-1 1.6-2.1 2.4V9l8.4 6.1c.9.7.4 2.1-.7 2.1H4.3c-1.1 0-1.6-1.4-.7-2.1L12 9"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    phone: '<path d="M5.2 4h3.6l1.9 4.8-2.4 1.5a11 11 0 0 0 5.4 5.4l1.5-2.4 4.8 1.9v3.6a1.2 1.2 0 0 1-1.2 1.2A16 16 0 0 1 4 5.2 1.2 1.2 0 0 1 5.2 4z"/>',
    chat: '<path d="M4.5 19.5 5.6 16A7.9 7.9 0 1 1 8.4 18.6z"/><path d="M9.2 9.3c.3 2 1.8 3.7 3.8 4.3l1-1.1 1.8.8-.4 1.6c-3.7 0-6.8-3-6.8-6.8l1.6-.4.8 1.8z"/>',
    scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6 20 18M8.2 16.4 20 6"/>',
    ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.6"/><path d="M6.5 8v3M10.5 8v4.2M14.5 8v3M18.5 8v4.2"/>',
    sparkle: '<path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17v.2"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/>',
    camera: '<path d="M4 8h3.2l2-3h5.6l2 3H20v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    figure: '<circle cx="12" cy="4.6" r="2.1"/><path d="M8 8.3h8l-1.1 6H9.1zM9.3 14.3 8 21M14.7 14.3 16 21"/>',
    pattern: '<path d="M5 3.5h8.5l5.5 5.5v11.5H5z"/><path d="M13.5 3.5V9H19"/><path d="M8.5 13h7M8.5 16.5h4.5" stroke-dasharray="2 2.2"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2.2"/><path d="M3 10h18M15.5 15h2.5"/>',
    logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    share: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/>',
    minus: '<path d="M5 12h14"/>',
    star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
    tape: '<path d="M3 15.5V9a5 5 0 0 1 10 0v6.5"/><circle cx="8" cy="9" r="2"/><path d="M13 15.5h8v-4h-8M16 11.5v1.8M18.6 11.5v1.8"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
};

export class Icon extends Component {
    // The whole <svg> is injected at once so the browser creates it in the SVG namespace.
    static template = xml`<span class="lp-ico" t-out="svg"/>`;
    static props = { name: String, size: { type: Number, optional: true }, stroke: { type: Number, optional: true } };
    get svg() {
        const s = this.props.size || 24;
        return markup(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
            `stroke-width="${this.props.stroke || 1.9}" stroke-linecap="round" stroke-linejoin="round" ` +
            `aria-hidden="true" focusable="false">${P[this.props.name] || ""}</svg>`);
    }
}

/** Base class: gives every screen the t() helper in templates. */
export class Base extends Component {
    t(...args) {
        return t(...args);
    }
}

/** Signature tape-measure gauge. value/max in any unit, optional health colour. */
export class Tape extends Component {
    static template = xml`
        <div t-attf-class="lp-tape #{props.small ? 'lp-tape-sm' : ''}" role="progressbar"
             t-att-aria-valuenow="Math.round(pct)" aria-valuemin="0" aria-valuemax="100">
            <div t-attf-class="lp-tape-fill lp-#{props.health or ''}" t-attf-style="width: #{pct}%"/>
            <div t-if="!props.small" class="lp-tape-cursor" t-attf-style="left: #{pct}%"/>
        </div>`;
    static props = { value: Number, max: { type: Number, optional: true }, health: { type: String, optional: true },
                     small: { type: Boolean, optional: true } };
    get pct() {
        const max = this.props.max || 100;
        return Math.max(0, Math.min(100, (100 * (this.props.value || 0)) / max));
    }
}

export class TopBar extends Base {
    static template = xml`
        <div class="lp-topbar">
            <button class="lp-iconbtn" t-on-click="onBack" t-att-aria-label="t('Back')"><Icon name="'back'"/></button>
            <div class="lp-topbar-title" t-esc="props.title"/>
            <t t-slot="right"><span class="lp-iconbtn" aria-hidden="true"/></t>
        </div>`;
    static components = { Icon };
    static props = { title: { type: String, optional: true }, fallback: { type: String, optional: true }, slots: { optional: true } };
    onBack() {
        back(this.props.fallback || "/home");
    }
}

export class Empty extends Base {
    static template = xml`
        <div class="lp-empty">
            <div class="lp-empty-icon"><Icon name="props.icon or 'orders'" size="30"/></div>
            <h3 t-esc="props.title"/>
            <p t-if="props.text" t-esc="props.text"/>
            <t t-slot="default"/>
        </div>`;
    static components = { Icon };
    static props = { title: String, text: { type: String, optional: true }, icon: { type: String, optional: true }, slots: { optional: true } };
}

export class Skeleton extends Component {
    static template = xml`<div>
        <div t-foreach="rows" t-as="r" t-key="r" class="lp-skel" t-attf-style="height: #{props.height or 64}px; margin-bottom: 10px;"/>
    </div>`;
    static props = { count: { type: Number, optional: true }, height: { type: Number, optional: true } };
    get rows() {
        return [...Array(this.props.count || 4).keys()];
    }
}

export class BottomSheet extends Component {
    static template = xml`
        <div class="lp-backdrop" t-on-click="props.onClose"/>
        <div class="lp-bsheet" role="dialog" aria-modal="true">
            <div class="lp-grabber"/>
            <t t-slot="default"/>
        </div>`;
    static props = { onClose: Function, slots: { optional: true } };
}

/** Read a picked image file, downscale it (phones take 12 MP photos) and return a JPEG data URL. */
export async function readImage(file, max = 1280) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.85);
    } finally {
        URL.revokeObjectURL(url);
    }
}
