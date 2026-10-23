/** @odoo-module */
import { locale } from "@selecta_concours/common/i18n";

export function readConfig() {
    const el = document.getElementById("selecta-config");
    try {
        return el ? JSON.parse(el.textContent || "{}") : {};
    } catch {
        return {};
    }
}

/** Les dates Odoo arrivent en UTC « AAAA-MM-JJ HH:MM:SS ». */
export function parseUTC(value) {
    if (!value) {
        return null;
    }
    return new Date(value.replace(" ", "T") + "Z");
}

export function fmtDateTime(value) {
    const d = typeof value === "string" ? parseUTC(value) : value;
    if (!d || isNaN(d)) {
        return "—";
    }
    return d.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

export function fmtTime(value) {
    const d = typeof value === "string" ? parseUTC(value) : value;
    if (!d || isNaN(d)) {
        return "—";
    }
    return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Convertit une date UTC Odoo vers la valeur d'un <input type="datetime-local"> (heure locale). */
export function toLocalInput(value) {
    const d = parseUTC(value);
    if (!d) {
        return "";
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
    if (!value) {
        return false;
    }
    const d = new Date(value);
    return d.toISOString().slice(0, 19).replace("T", " ");
}

export function fmtDuration(seconds) {
    if (seconds === null || seconds === undefined) {
        return "—";
    }
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function fmtPct(v, digits = 1) {
    if (v === null || v === undefined) {
        return "—";
    }
    return `${Number(v).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

export function fmtNum(v, digits = 2) {
    if (v === null || v === undefined) {
        return "—";
    }
    return Number(v).toLocaleString(locale(), { maximumFractionDigits: digits });
}

/** Analyse CSV robuste (séparateur ; ou , détecté, guillemets gérés). */
export function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/)[0] || "";
    const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === sep) {
            row.push(field);
            field = "";
        } else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") {
                i++;
            }
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += c;
        }
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file, "utf-8");
    });
}

export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function debounce(fn, delay = 250) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
    };
}

export const STATE_LABELS = {
    draft: "Préparation",
    ready: "Prêt",
    open: "En cours",
    closed: "Clôturé",
    published: "Résultats publiés",
};
export const STATE_BADGE = {
    draft: "",
    ready: "sl-badge-info",
    open: "sl-badge-live",
    closed: "sl-badge-warn",
    published: "sl-badge-ok",
};
export const ATTEMPT_LABELS = {
    ready: "Contrôles d'accès",
    in_progress: "En composition",
    submitted: "Terminé",
    expired: "Temps écoulé",
    disqualified: "Disqualifié",
    absent: "Absent",
};
export const ATTEMPT_BADGE = {
    ready: "sl-badge-info",
    in_progress: "sl-badge-live",
    submitted: "sl-badge-ok",
    expired: "sl-badge-warn",
    disqualified: "sl-badge-danger",
    absent: "",
};
export const CANDIDATE_LABELS = {
    registered: "Inscrit",
    in_progress: "En composition",
    passed: "Réussi",
    failed: "Échoué",
    disqualified: "Disqualifié",
    absent: "Absent",
};
export const CANDIDATE_BADGE = {
    registered: "",
    in_progress: "sl-badge-live",
    passed: "sl-badge-ok",
    failed: "sl-badge-warn",
    disqualified: "sl-badge-danger",
    absent: "",
};
