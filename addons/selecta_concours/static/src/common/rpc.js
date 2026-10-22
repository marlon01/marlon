/** @odoo-module */
/* Client JSON-RPC minimaliste, sans dépendance au client web Odoo. */

export class RpcError extends Error {
    constructor(message, data = {}) {
        super(message);
        this.name = "RpcError";
        this.data = data;
    }
}

export class NetworkError extends Error {
    constructor(message = "Connexion au serveur d'examen interrompue.") {
        super(message);
        this.name = "NetworkError";
    }
}

let seq = 0;

export async function jsonrpc(route, params = {}, { timeout = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
        response = await fetch(route, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++seq, params }),
            signal: controller.signal,
            cache: "no-store",
        });
    } catch {
        throw new NetworkError();
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        if (response.status >= 500 || response.status === 0) {
            throw new NetworkError(`Serveur indisponible (${response.status}).`);
        }
        throw new RpcError(`Erreur HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
        const err = payload.error;
        const message = err.data?.message || err.message || "Erreur serveur";
        if (err.data?.name === "odoo.http.SessionExpiredException") {
            window.location.href = "/selecta/login";
        }
        throw new RpcError(message, err.data || {});
    }
    return payload.result;
}

/** Appel d'une méthode de la façade back-office. */
export function api(method, args = [], kwargs = {}) {
    return jsonrpc(`/web/dataset/call_kw/selecta.backoffice/${method}`, {
        model: "selecta.backoffice",
        method,
        args,
        kwargs,
    });
}
