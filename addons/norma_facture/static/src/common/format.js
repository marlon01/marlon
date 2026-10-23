/** @odoo-module */
/* Formats à la congolaise / française : 1 250 000,50 ; dates jj/mm/aaaa. */

const nf = (d) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const F2 = nf(2), F0 = nf(0);

export function money(value, currency = "") {
    const v = Number(value || 0);
    const txt = (Number.isInteger(Math.round(v * 100) / 100) ? F0 : F2).format(v).replace(/ /g, " ");
    return currency ? `${txt} ${currency}` : txt;
}

export function money2(value) {
    return F2.format(Number(value || 0)).replace(/ /g, " ");
}

export function qty(value) {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(Number(value || 0));
}

/** Date serveur (UTC « AAAA-MM-JJ HH:MM:SS ») → heure locale. */
export function parseServer(dt) {
    if (!dt) return null;
    return new Date(dt.replace(" ", "T") + (dt.length > 10 ? "Z" : ""));
}

export function dateTime(dt) {
    const d = parseServer(dt);
    return d ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

export function date(dt) {
    const d = parseServer(dt);
    return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

export function time(dt) {
    const d = parseServer(dt);
    return d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
}

export function isoDay(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const STATE_LABELS = {
    draft: ["Brouillon", ""],
    failed: ["En attente DGI", "warn"],
    uncertain: ["À vérifier", "bad"],
    normalized: ["Normalisée", "ok"],
    cancelled: ["Abandonnée", ""],
};

export const TYPE_SHORT = { FV: "Vente", FT: "Acompte", FA: "Avoir", EV: "Export", ET: "Acompte export", EA: "Avoir export" };

export function initials(name) {
    return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
