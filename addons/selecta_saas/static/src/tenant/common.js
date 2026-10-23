/** @odoo-module */
/* Abonnement d'une structure : état partagé (bandeau ⇄ page) et utilitaires de présentation. */
import { reactive } from "@odoo/owl";
import { store } from "@selecta_concours/admin/store";
import { ICONS } from "@selecta_concours/common/ui";
import { fmtNum, parseUTC } from "@selecta_concours/common/utils";

// Pictogrammes propres à l'abonnement (même grammaire que ICONS : traits 2 px, viewBox 24).
ICONS.receipt = `<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4"/>`;
ICONS.building = `<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 10h.01M15 10h.01M12 10h.01"/>`;
ICONS.phone = `<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>`;
ICONS.mail = `<path d="M3 5h18v14H3zM3 6l9 7 9-7"/>`;
ICONS.external = `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>`;
ICONS.card = `<path d="M2 6a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM2 10h20M6 15h4"/>`;
ICONS.mobile = `<path d="M7 3a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1zM11 18h2"/>`;

/**
 * État partagé : la page « Abonnement » le met à jour après chaque opération, le bandeau
 * le lit (sinon il retombe sur store.session.saas, chargé au démarrage de la console).
 */
export const saasBus = reactive({ summary: null, support: null });

export function currentSummary() {
    return saasBus.summary || store.session?.saas || null;
}

export const TENANT_BADGE = {
    trial: "sl-badge-info",
    active: "sl-badge-ok",
    past_due: "sl-badge-warn",
    expired: "sl-badge-danger",
    suspended: "sl-badge-danger",
};
export const INVOICE_BADGE = {
    open: "sl-badge-info",
    pending: "sl-badge-warn",
    paid: "sl-badge-ok",
    rejected: "sl-badge-danger",
    cancelled: "",
};
export const CYCLE_LABELS = { monthly: "Mensuel", yearly: "Annuel" };
export const FEATURE_LABELS = {
    ai_analysis: "Analyse IA (psychométrie, fraude)",
    llm: "Assistant de rédaction (LLM)",
    branding: "Personnalisation (logo, couleur, slogan)",
};

/** Prestataires de paiement en ligne (code enregistré sur la facture → nom affiché). */
export const PROVIDER_NAMES = { cinetpay: "CinetPay", stripe: "Stripe", flexpay: "FlexPay" };

export function providerName(code) {
    return PROVIDER_NAMES[code] || code || "";
}

/**
 * Facture soldée par le prestataire en ligne (et non par une déclaration validée ou une activation manuelle) :
 * une tentative en ligne laisse `online_provider` renseigné même si la structure a finalement payé hors ligne.
 */
export function paidOnline(inv) {
    return inv.state === "paid" && !!inv.paid_online;
}

/** Pages légales publiques (servies par le module, hors console). */
export const LEGAL_LINKS = { terms: "/selecta/conditions", privacy: "/selecta/confidentialite" };

/** « Nom » avec espaces insécables (OWL ramène les &#160; des gabarits à des espaces ordinaires). */
export function quoted(text) {
    return `«\u00a0${text || ""}\u00a0»`;
}

export function fmtMoney(amount, symbol = "$") {
    if (amount === null || amount === undefined) {
        return "—";
    }
    const n = Number(amount);
    const digits = Number.isInteger(n) ? 0 : 2;
    return `${n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}\u00a0${symbol || "$"}`;
}

export function fmtDate(value, style = "long") {
    const d = typeof value === "string" ? parseUTC(value) : value;
    if (!d || isNaN(d)) {
        return "—";
    }
    return d.toLocaleDateString("fr-FR", { dateStyle: style });
}

export function daysLabel(n) {
    if (!n) {
        return "dernier jour";
    }
    return n === 1 ? "1 jour restant" : `${fmtNum(n, 0)} jours restants`;
}

/** Date d'échéance pertinente selon l'état (fin d'essai, fin de période, fin du délai de grâce). */
export function deadline(s) {
    if (!s) {
        return false;
    }
    return { trial: s.trial_end, active: s.period_end, past_due: s.grace_end }[s.state] || s.period_end || s.trial_end;
}
