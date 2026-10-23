/** @odoo-module **/
import { store } from "./api";

/** Hash routes: #/orders, #/order/42, #/order/42/fitting, #/new?model=3 ... */
const ROUTES = [
    [/^\/?$/, "home"],
    [/^\/home$/, "home"],
    [/^\/orders$/, "orders"],
    [/^\/order\/(\d+)$/, "order"],
    [/^\/order\/(\d+)\/fitting$/, "fitting"],
    [/^\/order\/(\d+)\/pattern$/, "pattern"],
    [/^\/order\/(\d+)\/measures$/, "measures"],
    [/^\/new$/, "new"],
    [/^\/catalogue$/, "catalogue"],
    [/^\/planning$/, "planning"],
    [/^\/account$/, "account"],
];

export const TOP_LEVEL = ["home", "orders", "planning", "catalogue"];

function parse() {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const [path, qs] = raw.split("?");
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    for (const [re, name] of ROUTES) {
        const m = path.match(re);
        if (m) {
            return { name, params: { id: m[1] ? Number(m[1]) : null }, query };
        }
    }
    return { name: "home", params: {}, query: {} };
}

export function startRouter() {
    store.route = parse();
    window.addEventListener("hashchange", () => {
        store.route = parse();
        window.scrollTo({ top: 0 });
    });
}

let depth = 0; // in-app navigation depth, so "back" never leaves the app

export function go(path) {
    if (window.location.hash !== `#${path}`) {
        depth++;
        window.location.hash = path;
    }
}

export function back(fallback = "/home") {
    if (depth > 0) {
        depth--;
        window.history.back();
    } else {
        window.location.replace(`#${fallback}`);
    }
}
