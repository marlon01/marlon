/** @odoo-module **/
import { reactive } from "@odoo/owl";
import { t } from "./i18n";

let seq = 0;

export class ApiError extends Error {}

/** JSON-RPC call to a Liputa API route. Server messages are shown as-is (already user-facing). */
export async function call(route, params = {}) {
    if (!navigator.onLine) {
        throw new ApiError(t("You are offline. Changes will be possible when the connection is back."));
    }
    let res;
    try {
        res = await fetch(route, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++seq, params }),
        });
    } catch {
        throw new ApiError(t("Something went wrong. Check your connection and try again."));
    }
    if (res.status === 401 || res.redirected) {
        window.location.assign("/app/login");
        return new Promise(() => {});
    }
    const data = await res.json().catch(() => ({}));
    if (data.error) {
        const name = data.error.data?.name || "";
        if (name.includes("SessionExpired")) {
            window.location.assign("/app/login");
            return new Promise(() => {});
        }
        const userFacing = /UserError|ValidationError|AccessError|MissingError/.test(name);
        throw new ApiError(userFacing ? data.error.data.message : t("Something went wrong. Check your connection and try again."));
    }
    return data.result;
}

export const api = {
    me: () => call("/liputa/api/me"),
    dashboard: () => call("/liputa/api/dashboard"),
    orders: (p) => call("/liputa/api/orders", p),
    order: (id) => call("/liputa/api/order", { order_id: id }),
    action: (id, action, extra = {}) => call("/liputa/api/order/action", { order_id: id, action, ...extra }),
    create: (vals) => call("/liputa/api/order/create", { vals }),
    estimate: (p) => call("/liputa/api/order/estimate_preview", p),
    clients: (search) => call("/liputa/api/clients", { search }),
    catalogue: (p) => call("/liputa/api/catalogue", p),
    suggest: (p) => call("/liputa/api/suggest", p),
    pattern: (id) => call("/liputa/api/pattern", { order_id: id }),
    mannequin: (id) => call("/liputa/api/mannequin", { order_id: id }),
    render: (id) => call("/liputa/api/render", { order_id: id }),
    planning: (p) => call("/liputa/api/planning", p),
    events: () => call("/liputa/api/events"),
    pay: (method, phone) => call("/liputa/api/subscription/pay", { method, phone }),
    setLang: (lang) => call("/liputa/api/lang", { lang }),
};

/** Global app state: user, route, toast. */
export const store = reactive({
    me: null,
    route: { name: "home", params: {}, query: {} },
    toast: null,
});

let toastTimer;
export function toast(message, kind = "ok") {
    store.toast = { message, kind };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (store.toast = null), 2800);
}

export function imageUrl(model, id, field = "image_512", unique = "") {
    return `/web/image/${model}/${id}/${field}${unique ? `?unique=${encodeURIComponent(unique)}` : ""}`;
}
