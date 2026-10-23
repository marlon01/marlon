/** @odoo-module */
import { reactive } from "@odoo/owl";
import { api } from "@norma_facture/common/rpc";

/* Session de l'utilisateur : entreprise, rôle, établissements, référentiels fiscaux. */
export const session = reactive({ ready: false, user: {}, company: {}, category: {}, sites: [], tax_groups: [],
    payment_methods: [], invoice_types: [], reference_types: [], client_types: [], item_types: [], max_discount: 0,
    siteId: null, catalog: { products: [], categories: [] } });

const RANK = { cashier: 1, manager: 2, admin: 3 };
export function can(role) {
    return (RANK[session.user.role] || 0) >= RANK[role];
}

export async function loadSession() {
    const data = await api("bootstrap");
    Object.assign(session, data);
    let saved = null;
    try { saved = parseInt(localStorage.getItem("norma.site") || ""); } catch { /* stockage indisponible */ }
    session.siteId = session.sites.find((s) => s.id === saved) ? saved : (session.sites[0] && session.sites[0].id);
    session.ready = true;
    return session;
}

export function setSite(id) {
    session.siteId = id;
    try { localStorage.setItem("norma.site", String(id)); } catch { /* stockage indisponible */ }
}

export function currentSite() {
    return session.sites.find((s) => s.id === session.siteId) || null;
}

export async function loadCatalog() {
    session.catalog = await api("catalog");
    return session.catalog;
}

export function payLabel(code) {
    const m = session.payment_methods.find((p) => p.code === code);
    return m ? m.label : code;
}

export function groupRate(code) {
    const g = session.tax_groups.find((t) => t.code === code);
    return g ? g.rate : 0;
}

/* Routeur par fragment : #/page/id?param=valeur */
export const route = reactive({ name: "home", id: null, params: {} });
function parse() {
    const h = (location.hash || "#/").replace(/^#\/?/, "");
    const [path, query] = h.split("?");
    const parts = path.split("/").filter(Boolean);
    Object.assign(route, { name: parts[0] || "home", id: parts[1] ? parseInt(parts[1]) || parts[1] : null,
        params: Object.fromEntries(new URLSearchParams(query || "")) });
}
window.addEventListener("hashchange", parse);
parse();
export function go(path) {
    location.hash = "#/" + path;
}
