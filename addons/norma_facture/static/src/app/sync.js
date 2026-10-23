/** @odoo-module */
/* Synchronisation automatique : ventes hors ligne du poste → serveur, et suivi des factures en attente de la DGI. */
import { api } from "@norma_facture/common/rpc";
import { outbox } from "@norma_facture/common/outbox";
import { notify } from "@norma_facture/common/ui";
import { session } from "@norma_facture/app/store";

let timer = null;
let running = false;

export async function refreshCounts() {
    try {
        session.outbox = (await outbox.all()).filter((s) => s.company_id === session.company.id && !s.error).length;
        session.outboxErrors = (await outbox.all()).filter((s) => s.company_id === session.company.id && s.error).length;
    } catch { /* IndexedDB indisponible */ }
}

/** Envoie les ventes du poste. Une erreur réseau arrête le passage ; une erreur métier met la vente de côté. */
export async function flush() {
    if (running) return;
    running = true;
    session.syncing = true;
    let sent = 0;
    try {
        const sales = (await outbox.all()).filter((s) => s.company_id === session.company.id && !s.error)
            .sort((a, b) => a.offline_at.localeCompare(b.offline_at));
        for (const sale of sales) {
            try {
                const inv = await api("checkout", sale.payload);
                await outbox.remove(sale.request_key);
                sent++;
                if (inv.state !== "normalized") session.dgiPending++;
            } catch (err) {
                if (err.network) { session.offline = true; break; }
                sale.error = err.message;
                await outbox.put(JSON.parse(JSON.stringify(sale)));
            }
        }
        if (sales.length) session.offline = false;
        const st = await api("sync_status");
        session.offline = false;
        session.dgiPending = st.pending;
        session.subscription = st.subscription;
    } catch (err) {
        if (err.network) session.offline = true;
    } finally {
        running = false;
        session.syncing = false;
        await refreshCounts();
    }
    if (sent) notify(`${sent} vente(s) hors ligne transmise(s) au serveur.`, "ok");
}

export async function queueSale(sale) {
    // Copie en données simples : IndexedDB ne sait pas cloner les objets réactifs de l'interface.
    await outbox.put(JSON.parse(JSON.stringify(sale)));
    await refreshCounts();
}

export function startSync() {
    if (timer) return;
    refreshCounts();
    flush();
    timer = setInterval(flush, 20000);
    window.addEventListener("online", () => flush());
    window.addEventListener("offline", () => (session.offline = true));
}
