/** @odoo-module */
/* Graphiques en SVG intégré, sans bibliothèque : barres verticales avec axes, infobulles natives
   (<title>) et résumé textuel pour les technologies d'assistance. */
import { Component, markup, xml } from "@odoo/owl";
import { escapeHTML, fmtNum } from "@selecta_concours/common/utils";

function niceMax(v) {
    if (v <= 0) {
        return 1;
    }
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) {
        if (m * exp >= v) {
            return m * exp;
        }
    }
    return 10 * exp;
}

export class BarChart extends Component {
    static template = xml`
        <figure class="pf-chart">
            <t t-out="svg"/>
            <figcaption class="pf-chart-summary" t-esc="summary"/>
        </figure>`;
    static props = {
        data: Array, // [{label, value, long?}]
        title: String,
        unit: { type: String, optional: true }, // suffixe des valeurs (« $ »)
        integer: { type: Boolean, optional: true },
        tone: { type: String, optional: true }, // ink | accent
        labelFn: { type: Function, optional: true }, // libellé long d'une barre (infobulle)
    };

    fmt(v) {
        const s = fmtNum(v, this.props.integer ? 0 : 2);
        return this.props.unit ? `${s} ${this.props.unit}` : s;
    }

    get summary() {
        const d = this.props.data;
        if (!d.length) {
            return "";
        }
        const total = d.reduce((a, b) => a + b.value, 0);
        const best = d.reduce((a, b) => (b.value > a.value ? b : a), d[0]);
        const last = d[d.length - 1];
        const long = (p) => p.long || (this.props.labelFn ? this.props.labelFn(p.label) : p.label);
        if (!total) {
            return `Aucune valeur sur la période (${d.length} intervalles).`;
        }
        return `Total ${this.fmt(total)} sur ${d.length} intervalles. Maximum ${this.fmt(best.value)} (${long(best)}). Dernier intervalle : ${this.fmt(last.value)}.`;
    }

    get svg() {
        const d = this.props.data;
        const W = 560;
        const H = 210;
        const L = 46; // marge gauche (axe des valeurs)
        const R = 8;
        const T = 12;
        const B = 30; // marge basse (libellés)
        const plotW = W - L - R;
        const plotH = H - T - B;
        const max = niceMax(Math.max(0, ...d.map((p) => p.value)));
        const step = plotW / Math.max(1, d.length);
        const barW = Math.max(4, step * 0.62);
        const y = (v) => T + plotH - (v / max) * plotH;
        // Graduations entières pour les comptages : pas de demi-unité affichée arrondie.
        const ticks = this.props.integer && max % 2 ? [0, max] : [0, max / 2, max];
        let out = `<svg class="pf-chart-svg is-${this.props.tone || "ink"}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHTML(this.props.title)}" preserveAspectRatio="xMidYMid meet">`;
        for (const t of ticks) {
            const ty = y(t).toFixed(1);
            out += `<line class="pf-grid" x1="${L}" x2="${W - R}" y1="${ty}" y2="${ty}"/>`;
            const lbl = this.props.integer || t >= 1000 ? fmtNum(t, 0) : fmtNum(t, 1);
            out += `<text class="pf-axis" x="${L - 8}" y="${ty}" dy="4" text-anchor="end">${escapeHTML(lbl)}</text>`;
        }
        const every = d.length > 8 ? 2 : 1;
        d.forEach((p, i) => {
            const cx = L + step * i + step / 2;
            const h = Math.max(p.value > 0 ? 2 : 0, (p.value / max) * plotH);
            const long = p.long || (this.props.labelFn ? this.props.labelFn(p.label) : p.label);
            const isLast = i === d.length - 1;
            out += `<g class="pf-bar${isLast ? " is-last" : ""}"><title>${escapeHTML(long)} : ${escapeHTML(this.fmt(p.value))}</title>`;
            // zone de survol pleine hauteur pour faciliter l'infobulle
            out += `<rect class="pf-hit" x="${(cx - step / 2).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${plotH}"/>`;
            out += `<rect class="pf-fill" x="${(cx - barW / 2).toFixed(1)}" y="${(T + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
            out += "</g>";
            if (i % every === (d.length - 1) % every) {
                out += `<text class="pf-axis" x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle">${escapeHTML(p.label)}</text>`;
            }
        });
        out += `<line class="pf-baseline" x1="${L}" x2="${W - R}" y1="${T + plotH}" y2="${T + plotH}"/>`;
        out += "</svg>";
        return markup(out);
    }
}
