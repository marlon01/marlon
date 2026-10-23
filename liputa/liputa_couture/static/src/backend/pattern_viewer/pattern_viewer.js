/** @odoo-module **/
import { Component, markup, onWillStart, onWillUpdateProps, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";
import { _t } from "@web/core/l10n/translation";

/**
 * Cutting pattern viewer: shows the 1:1 SVG drafted server-side from the
 * client's measurements, with zoom, fabric estimate and download / print.
 */
export class LiputaPatternViewer extends Component {
    static template = "liputa_couture.PatternViewer";
    static props = { ...standardWidgetProps };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({ loading: false, svg: null, fabric: null, pieces: [], zoom: 1, error: null });
        this.lastKey = null;
        onWillStart(() => this.load());
        onWillUpdateProps((next) => this.load(next));
    }

    _key(record) {
        return `${record.resId}-${record.data.write_date || ""}`;
    }

    async load(props = this.props, force = false) {
        const record = props.record;
        if (!record.resId) {
            this.state.svg = null;
            return;
        }
        const key = this._key(record);
        if (!force && key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        this.state.loading = true;
        this.state.error = null;
        try {
            const res = await this.orm.call("liputa.order", "get_pattern_data", [[record.resId]]);
            this.state.svg = markup(res.svg); // server-generated, every label is XML-escaped
            this.state.fabric = res.fabric;
            this.state.pieces = res.pieces;
        } catch (e) {
            this.state.error = _t("Unable to draft the pattern for this model and these measurements.");
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

    zoom(delta) {
        this.state.zoom = Math.min(4, Math.max(0.25, +(this.state.zoom + delta).toFixed(2)));
    }

    get downloadUrl() {
        return `/liputa/order/${this.props.record.resId}/pattern.svg`;
    }

    print() {
        const win = window.open("", "_blank");
        if (!win) {
            this.notification.add(_t("Allow pop-ups to print the pattern."), { type: "warning" });
            return;
        }
        win.document.write(
            `<html><head><title>${this.props.record.data.name}</title>` +
            `<style>@page{margin:0}body{margin:0}svg{display:block}</style></head><body>` +
            `${this.state.svg}</body></html>`
        );
        win.document.close();
        win.focus();
        win.print();
    }
}

registry.category("view_widgets").add("liputa_pattern_viewer", {
    component: LiputaPatternViewer,
    fieldDependencies: [
        { name: "write_date", type: "datetime" },
        { name: "name", type: "char" },
    ],
});
