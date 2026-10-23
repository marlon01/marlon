/** @odoo-module **/
import { Component, onWillStart, onWillUpdateProps, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";
import { _t } from "@web/core/l10n/translation";
import { buildMannequin, SKIN_TONES } from "./mannequin_geometry";

/**
 * Virtual fitting: a mannequin built from the client's own measurements,
 * dressed with the chosen model and the real fabric photo. The client's face
 * (photo, with consent) can be placed on the mannequin. A photoreal AI render
 * can be requested and compared side by side.
 */
export class LiputaMannequin extends Component {
    static template = "liputa_couture.Mannequin";
    static props = { ...standardWidgetProps };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            data: null, geo: null, loading: false, rendering: false,
            showDims: true, showFace: true, faceZoom: 1.6, faceX: 0, faceY: 10,
        });
        this.lastKey = null;
        this.uid = `lpt${Math.random().toString(36).slice(2, 8)}`;
        onWillStart(() => this.load());
        onWillUpdateProps((next) => this.load(next));
    }

    async load(props = this.props, force = false) {
        const rec = props.record;
        if (!rec.resId) {
            return;
        }
        const key = `${rec.resId}-${rec.data.write_date || ""}`;
        if (!force && key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        this.state.loading = true;
        try {
            const data = await this.orm.call("liputa.order", "get_mannequin_data", [[rec.resId]]);
            this.state.data = data;
            this.state.geo = buildMannequin(data);
        } finally {
            this.state.loading = false;
        }
    }

    async refresh() {
        if (this.props.record.isDirty) {
            await this.props.record.save();
        }
        await this.load(this.props, true);
    }

    async aiRender() {
        if (this.props.record.isDirty) {
            await this.props.record.save();
        }
        this.state.rendering = true;
        try {
            await this.orm.call("liputa.order", "action_ai_render", [[this.props.record.resId]]);
            await this.props.record.load();
            await this.load(this.props, true);
            this.notification.add(_t("AI render ready."), { type: "success" });
        } finally {
            this.state.rendering = false;
        }
    }

    _img(field) {
        const d = this.state.data;
        const unique = encodeURIComponent(d?.write_date || "");
        return `/web/image/liputa.order/${this.props.record.resId}/${field}?unique=${unique}`;
    }

    get renderTitle() {
        return this.state.data?.has_photo ? "" : _t("A client photo with consent is required");
    }
    get skin() {
        return SKIN_TONES[this.state.data?.skin_tone || 5];
    }
    get fabricUrl() {
        return this._img("fabric_image");
    }
    get photoUrl() {
        return this._img("client_photo");
    }
    get renderUrl() {
        return this._img("ai_render_image");
    }
    get garmentFill() {
        return this.state.data?.has_fabric ? `url(#${this.uid}_fab)` : this.state.data?.color || "#C4502A";
    }
    get secondFill() {
        return this.state.data?.has_fabric ? `url(#${this.uid}_fab)` : this.state.data?.color || "#22303F";
    }
    get face() {
        const h = this.state.geo.head;
        const w = h.rx * 2 * this.state.faceZoom;
        return {
            x: h.cx - w / 2 + this.state.faceX,
            y: h.cy - h.ry * this.state.faceZoom + this.state.faceY,
            w,
            h: w * 1.4,
        };
    }

    downloadSvg(ev) {
        const svg = ev.target.closest(".o_liputa_mannequin").querySelector("svg.o_liputa_figure");
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${this.props.record.data.name || "mannequin"}.svg`;
        a.click();
        URL.revokeObjectURL(a.href);
    }
}

registry.category("view_widgets").add("liputa_mannequin", {
    component: LiputaMannequin,
    fieldDependencies: [
        { name: "write_date", type: "datetime" },
        { name: "name", type: "char" },
    ],
});
