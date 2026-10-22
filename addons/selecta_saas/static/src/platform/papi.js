/** @odoo-module */
/* Administration centrale : appel de l'API, état partagé, formats et boîte de saisie structurée. */
import { Component, reactive, useEffect, useState, xml } from "@odoo/owl";
import { jsonrpc } from "@selecta_concours/common/rpc";
import { ICONS } from "@selecta_concours/common/ui";
import { fmtDateTime, fmtNum, parseUTC } from "@selecta_concours/common/utils";

const P = (d) => `<path d="${d}"/>`;
// Pictogrammes propres à la plateforme (ajoutés au jeu commun s'ils n'existent pas encore).
for (const [k, v] of Object.entries({
    building: P("M3 21h18M5 21V5l7-3 7 3v16M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4"),
    wallet: P("M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01"),
    tag: P("M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"),
    home: P("M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"),
    arrowLeft: P("M19 12H5M12 19l-7-7 7-7"),
    external: P("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"),
    pause: P("M6 4h4v16H6zM14 4h4v16h-4z"),
    mail: P("M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6"),
    send: P("M22 2L11 13M22 2l-7 20-4-9-9-4z"),
    card: P("M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4"),
})) {
    ICONS[k] = ICONS[k] || v;
}

/** Appel d'une méthode de l'API centrale (modèle selecta.saas.platform). */
export function papi(method, args = [], kwargs = {}) {
    return jsonrpc(`/web/dataset/call_kw/selecta.saas.platform/${method}`, {
        model: "selecta.saas.platform",
        method,
        args,
        kwargs,
    });
}

/** État partagé : session de l'administrateur et compteur des paiements à valider (menu). */
export const pstore = reactive({ session: null, pending: 0 });

export async function refreshPending() {
    try {
        const rows = await papi("invoices_list", ["pending"]);
        pstore.pending = rows.length;
    } catch {
        // compteur indicatif : une erreur réseau ne doit pas bloquer la page
    }
}

export const TENANT_STATES = [
    { key: "trial", label: "Essai gratuit", badge: "sl-badge-info" },
    { key: "active", label: "Abonné", badge: "sl-badge-ok" },
    { key: "past_due", label: "Paiement en retard", badge: "sl-badge-warn" },
    { key: "expired", label: "Expiré", badge: "" },
    { key: "suspended", label: "Suspendu", badge: "sl-badge-danger" },
];
export const TENANT_BADGE = Object.fromEntries(TENANT_STATES.map((s) => [s.key, s.badge]));
export const INVOICE_BADGE = { open: "", pending: "sl-badge-warn", paid: "sl-badge-ok", rejected: "sl-badge-danger", cancelled: "" };
export const MAIL_STATES = {
    queued: { label: "En file", badge: "sl-badge-info" },
    sent: { label: "Envoyé", badge: "sl-badge-ok" },
    failed: { label: "Échec", badge: "sl-badge-danger" },
    cancelled: { label: "Annulé", badge: "" },
};
export const PROVIDER_NAMES = { cinetpay: "CinetPay", stripe: "Stripe" };

/**
 * Mentions complémentaires d'une facture : avoir, prorata, catégorie différée, paiement en ligne.
 * Retourne [{label, cls, title}] ; cls : "" | "is-ok" | "is-warn".
 */
export function invoiceFlags(i) {
    const out = [];
    if (i.prorated) {
        out.push({ label: "prorata", cls: "", title: "Passage à une catégorie supérieure : la nouvelle période commence à la validation." });
    }
    if (i.deferred_plan) {
        const waiting = i.state === "paid" && !i.plan_applied;
        out.push({
            label: waiting ? "catégorie appliquée à l'échéance (en attente)" : "catégorie appliquée à l'échéance",
            cls: waiting ? "is-warn" : "",
            title: "Catégorie inférieure : ses limites s'appliquent au début de la période facturée.",
        });
    }
    const provider = PROVIDER_NAMES[i.online_provider] || i.online_provider;
    if (provider) {
        if (i.state === "paid") {
            out.push({ label: `payée en ligne via ${provider}`, cls: "is-ok", title: "" });
        } else if (i.state === "open" || i.state === "rejected") {
            out.push({
                label: i.online_message ? `paiement en ligne via ${provider} non abouti` : `paiement en ligne commencé via ${provider}`,
                cls: i.online_message ? "is-warn" : "",
                title: i.online_message || "",
            });
        }
    }
    return out;
}

export const CYCLE_LABELS = { monthly: "Mensuel", yearly: "Annuel" };

export function money(value, symbol = "$") {
    if (value === null || value === undefined || value === false) {
        return "—";
    }
    return `${fmtNum(value, 2)} ${symbol || "$"}`;
}

export function fmtDate(value) {
    const d = typeof value === "string" ? parseUTC(value) : value;
    if (!d || isNaN(d)) {
        return "—";
    }
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export { fmtDateTime };

/** Échéance pertinente selon l'état : fin d'essai, fin de période payée ou fin du délai de grâce. */
export function dueDate(t) {
    return { trial: t.trial_end, active: t.period_end, past_due: t.grace_end }[t.state] || t.period_end || t.trial_end || false;
}

export function daysLabel(t) {
    if (!["trial", "active", "past_due"].includes(t.state)) {
        return "—";
    }
    return t.days_left <= 1 ? `${t.days_left} jour` : `${t.days_left} jours`;
}

export function limitLabel(v) {
    return v ? fmtNum(v, 0) : "Illimité";
}

export function errMessage(e) {
    return (e && e.message) || "Opération impossible.";
}

/** Copie dans le presse-papiers, avec repli pour les contextes non sécurisés (http). */
export async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // repli ci-dessous
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch {
        ok = false;
    }
    ta.remove();
    return ok;
}

// ------------------------------------------------------------------ boîte de saisie structurée
export const formBus = reactive({ dialog: null });

/**
 * Boîte de dialogue avec champs typés.
 * options : {title, body, confirmLabel, danger, fields: [{name, label, type: number|text|textarea|select,
 *            value, min, max, minLength, required, options: [{value, label}], help, placeholder}]}
 * Résout un objet {name: valeur} ou null si l'utilisateur annule.
 */
export function formDialog(options) {
    return new Promise((resolve) => {
        const values = {};
        for (const f of options.fields || []) {
            values[f.name] = f.value ?? (f.type === "select" ? f.options?.[0]?.value ?? "" : "");
        }
        formBus.dialog = { ...options, values, resolve };
    });
}

let dialogSeq = 0;

export class FormDialogHost extends Component {
    static template = xml`
        <t t-if="bus.dialog">
            <t t-set="d" t-value="bus.dialog"/>
            <div class="sl-overlay" t-on-click.self="() => this.close(false)" t-on-keydown="onKey">
                <form class="sl-dialog" role="dialog" aria-modal="true" t-att-aria-labelledby="uid + '-t'" t-on-submit.prevent="() => this.close(true)">
                    <div class="sl-dialog-head"><h3 t-att-id="uid + '-t'" t-esc="d.title"/></div>
                    <div class="sl-dialog-body pf-dialog-body">
                        <p t-if="d.body" class="pf-dialog-text" t-esc="d.body"/>
                        <div t-foreach="d.fields or []" t-as="f" t-key="f.name" class="sl-field">
                            <label t-att-for="uid + f.name" t-esc="f.label"/>
                            <select t-if="f.type == 'select'" t-att-id="uid + f.name" class="sl-select" t-model="d.values[f.name]">
                                <option t-foreach="f.options" t-as="o" t-key="o.value" t-att-value="o.value" t-esc="o.label"/>
                            </select>
                            <textarea t-elif="f.type == 'textarea'" t-att-id="uid + f.name" class="sl-textarea" t-model="d.values[f.name]" t-att-placeholder="f.placeholder or ''"/>
                            <input t-else="" t-att-id="uid + f.name" class="sl-input" t-att-type="f.type == 'number' ? 'number' : 'text'"
                                   t-att-min="f.min" t-att-max="f.max" t-model="d.values[f.name]" t-att-placeholder="f.placeholder or ''"/>
                            <span t-if="fieldError(f)" class="pf-field-error" t-esc="fieldError(f)"/>
                            <span t-elif="f.help" class="sl-help" t-esc="f.help"/>
                        </div>
                    </div>
                    <div class="sl-dialog-foot">
                        <button type="button" class="sl-btn" t-on-click="() => this.close(false)">Annuler</button>
                        <button type="submit" t-attf-class="sl-btn {{d.danger ? 'sl-btn-danger' : 'sl-btn-primary'}}" t-att-disabled="!valid" t-esc="d.confirmLabel or 'Confirmer'"/>
                    </div>
                </form>
            </div>
        </t>`;
    static props = {};
    setup() {
        this.bus = useState(formBus);
        this.uid = `pf-dlg-${++dialogSeq}-`;
        useEffect(
            (dialog) => {
                if (dialog) {
                    this.returnFocus = document.activeElement;
                    const el = document.querySelector(".pf-dialog-body input, .pf-dialog-body select, .pf-dialog-body textarea, .sl-dialog .sl-btn-primary, .sl-dialog .sl-btn-danger");
                    el?.focus();
                }
            },
            () => [this.bus.dialog]
        );
    }
    fieldError(f) {
        const raw = this.bus.dialog.values[f.name];
        const v = typeof raw === "string" ? raw.trim() : raw;
        if (f.type === "number") {
            if (v === "" || v === null || isNaN(Number(v))) {
                return f.required === false ? "" : "Saisissez un nombre.";
            }
            const n = Number(v);
            if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
                return `Valeur attendue entre ${f.min} et ${f.max}.`;
            }
            return "";
        }
        if (f.minLength && (v || "").length < f.minLength) {
            return (v || "").length ? `${f.minLength} caractères minimum.` : "";
        }
        return "";
    }
    get valid() {
        const d = this.bus.dialog;
        return (d.fields || []).every((f) => {
            const v = d.values[f.name];
            if (f.minLength && String(v || "").trim().length < f.minLength) {
                return false;
            }
            if (f.required && !String(v ?? "").trim()) {
                return false;
            }
            return !this.fieldError(f);
        });
    }
    onKey(ev) {
        if (ev.key === "Escape") {
            this.close(false);
        }
    }
    close(ok) {
        const d = this.bus.dialog;
        if (!d || (ok && !this.valid)) {
            return;
        }
        this.bus.dialog = null;
        this.returnFocus?.focus?.();
        if (!ok) {
            d.resolve(null);
            return;
        }
        const out = {};
        for (const f of d.fields || []) {
            const v = d.values[f.name];
            out[f.name] = f.type === "number" ? Number(v) : typeof v === "string" ? v.trim() : v;
        }
        d.resolve(out);
    }
}
