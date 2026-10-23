/** @odoo-module */
/* File des ventes faites hors ligne, conservée sur le poste (IndexedDB) jusqu'à leur envoi au serveur.
   Chaque vente porte sa clé d'idempotence : la renvoyer après une coupure ne crée jamais de double facture. */

const DB = "norma-outbox", STORE = "sales";
let dbp = null;

function db() {
    if (!dbp) {
        dbp = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "request_key" });
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbp;
}

async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("Enregistrement local impossible."));
    });
}

export const outbox = {
    put: (sale) => tx("readwrite", (s) => s.put(sale)),
    remove: (key) => tx("readwrite", (s) => s.delete(key)),
    all: () => tx("readonly", (s) => s.getAll()),
    async count(uid) {
        return (await this.all()).filter((s) => !uid || s.uid === uid).length;
    },
};
