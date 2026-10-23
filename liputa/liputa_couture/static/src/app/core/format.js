/** @odoo-module **/
import { getLang, t } from "./i18n";
import { store } from "./api";

const LOCALES = { fr: "fr-FR", en: "en-GB", pt: "pt-PT", sw: "sw-KE" };
const locale = () => LOCALES[getLang()] || "fr-FR";

export function money(value) {
    const cur = store.me?.currency || { symbol: "FC", position: "after", digits: 0 };
    const n = Number(value || 0).toLocaleString(locale(), {
        minimumFractionDigits: 0, maximumFractionDigits: cur.digits ?? 0,
    });
    return cur.position === "before" ? `${cur.symbol} ${n}` : `${n} ${cur.symbol}`;
}

export function num(value, digits = 1) {
    return Number(value || 0).toLocaleString(locale(), { maximumFractionDigits: digits });
}

export function parseDate(str) {
    if (!str) {
        return null;
    }
    const [y, m, d] = str.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function today() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function daysFromToday(str) {
    const d = parseDate(str);
    return d ? Math.round((d - today()) / 86400000) : null;
}

/** "today", "tomorrow", "in 5 d", "2 d late" */
export function relative(str) {
    const n = daysFromToday(str);
    if (n === null) {
        return "";
    }
    if (n === 0) {
        return t("today");
    }
    if (n === 1) {
        return t("tomorrow");
    }
    if (n === -1) {
        return t("%s d late", 1);
    }
    return n > 0 ? t("in %s d", n) : t("%s d late", -n);
}

export function longDate(str) {
    const d = parseDate(str);
    return d ? d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }) : "";
}

export function shortDate(str) {
    const d = parseDate(str);
    return d ? d.toLocaleDateString(locale(), { day: "numeric", month: "short" }) : "";
}

export function initials(name) {
    return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

export function healthLabel(h) {
    return { on_track: t("On time"), at_risk: t("At risk"), late: t("Late") }[h] || "";
}
