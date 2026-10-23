/* NORMA — service worker : l'application de caisse s'ouvre même sans connexion.
   Les ventes faites hors ligne sont gardées par l'application (IndexedDB) et envoyées au retour du réseau. */
const CACHE = "norma-shell-v1";
const SHELL = "/norma/app";

self.addEventListener("install", (ev) => {
    ev.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(SHELL, { credentials: "same-origin" })).catch(() => {})));
    self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
    ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

function isStatic(url) {
    return url.pathname.startsWith("/web/assets/") || url.pathname.startsWith("/norma_facture/static/") || url.pathname.startsWith("/norma/logo/");
}

self.addEventListener("fetch", (ev) => {
    const req = ev.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname === SHELL) {
        // Réseau d'abord (session, version à jour), copie locale en cas de coupure.
        ev.respondWith(fetch(req).then((res) => {
            if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(SHELL, res.clone()));
            return res;
        }).catch(() => caches.match(SHELL).then((r) => r || new Response("Hors ligne : ouvrez NORMA une première fois avec la connexion.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
        return;
    }
    if (isStatic(url)) {
        ev.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
            return res;
        })));
    }
});
