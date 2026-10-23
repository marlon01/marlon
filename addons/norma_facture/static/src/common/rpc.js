/** @odoo-module */
/* Appels JSON vers le serveur NORMA, sans dépendance au client web générique. */

export class ApiError extends Error {}

let seq = 0;

export async function post(route, params = {}, { timeout = 60000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
        res = await fetch(route, {
            method: "POST", credentials: "same-origin", cache: "no-store", signal: ctrl.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++seq, params }),
        });
    } catch {
        throw new ApiError("Connexion au serveur impossible. Vérifiez le réseau puis réessayez.");
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        throw new ApiError(res.status >= 500 ? `Serveur indisponible (${res.status}).` : `Requête refusée (${res.status}).`);
    }
    const payload = await res.json();
    if (payload.error) {
        const data = payload.error.data || {};
        if (data.name === "odoo.http.SessionExpiredException") {
            window.location.href = "/norma/login";
        }
        throw new ApiError(data.message || payload.error.message || "Erreur du serveur.");
    }
    return payload.result;
}

/** Méthode de la façade NORMA : renvoie le résultat ou lève ApiError avec le message du serveur. */
export async function api(method, params = {}) {
    const out = await post(`/norma/api/${method}`, params);
    if (out && out.error) {
        throw new ApiError(out.error);
    }
    return out ? out.result : out;
}

export async function platformApi(method, params = {}) {
    const out = await post(`/norma/platform/api/${method}`, params);
    if (out && out.error) {
        throw new ApiError(out.error);
    }
    return out ? out.result : out;
}

export function readConfig() {
    const el = document.getElementById("norma-config");
    try {
        return JSON.parse(el ? el.textContent : "{}");
    } catch {
        return {};
    }
}

/** Identifiant aléatoire (clé d'idempotence), y compris sur un réseau local en HTTP. */
export function newKey() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
