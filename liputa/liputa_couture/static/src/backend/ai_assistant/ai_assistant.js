/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardWidgetProps } from "@web/views/widgets/standard_widget_props";
import { _t } from "@web/core/l10n/translation";

function m2oId(value) {
    // Odoo 18 relational values: [id, name] or {id, display_name}
    if (!value) {
        return false;
    }
    return Array.isArray(value) ? value[0] : value.id;
}

/**
 * AI stylist: suggests models from the shared library + the workshop catalogue
 * for the selected event, gender and budget, with cultural styling advice.
 */
export class LiputaAIAssistant extends Component {
    static template = "liputa_couture.AIAssistant";
    static props = { ...standardWidgetProps };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({ notes: "", budget: 0, loading: false, result: null });
    }

    get record() {
        return this.props.record;
    }
    get eventName() {
        const ev = this.record.data.event_type_id;
        return ev ? (Array.isArray(ev) ? ev[1] : ev.display_name) : "";
    }
    get sourceLabel() {
        return this.state.result?.source === "ai"
            ? _t("AI stylist")
            : _t("Catalogue rules (AI not configured)");
    }
    get selectedModelId() {
        return m2oId(this.record.data.garment_model_id);
    }

    async suggest() {
        this.state.loading = true;
        try {
            this.state.result = await this.orm.call("liputa.ai.service", "suggest_models", [], {
                event_type_id: m2oId(this.record.data.event_type_id) || false,
                gender: this.record.data.gender || false,
                budget: Number(this.state.budget) || 0,
                notes: this.state.notes,
            });
            if (!this.state.result.suggestions.length) {
                this.notification.add(_t("No model matches yet. Enrich your catalogue!"), { type: "info" });
            }
        } finally {
            this.state.loading = false;
        }
    }

    async choose(item) {
        const rec = this.record;
        if (rec.isDirty || !rec.resId) {
            const ok = await rec.save();
            if (!ok && !rec.resId) {
                this.notification.add(_t("Fill in the client first, then choose the model."), { type: "warning" });
                return;
            }
        }
        await this.orm.write("liputa.order", [rec.resId], { garment_model_id: item.id });
        await rec.load();
        this.notification.add(_t("Model selected: %s", item.name), { type: "success" });
    }

    image(item) {
        return item.has_image ? `/web/image/liputa.garment.model/${item.id}/image_256` : "/web/static/img/placeholder.png";
    }
}

registry.category("view_widgets").add("liputa_ai_assistant", {
    component: LiputaAIAssistant,
    fieldDependencies: [
        { name: "event_type_id", type: "many2one", relation: "liputa.event.type" },
        { name: "garment_model_id", type: "many2one", relation: "liputa.garment.model" },
        { name: "gender", type: "selection" },
    ],
});
