/* Liputa service worker: keeps the app shell, fonts and model images available
 * on weak or intermittent mobile networks. API calls always go to the network. */
const CACHE = "liputa-v1";
const SHELL = ["/app", "/liputa_couture/static/description/icon.svg",
               "/liputa_couture/static/src/app/fonts/BricolageGrotesque.ttf"];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.pathname.startsWith("/liputa/api")) {
        return;
    }
    const isAsset = url.pathname.startsWith("/web/assets/") || url.pathname.startsWith("/liputa_couture/static/")
        || url.pathname.startsWith("/web/image/liputa.garment.model/");
    if (isAsset) {
        // stale-while-revalidate
        event.respondWith(caches.open(CACHE).then(async (cache) => {
            const cached = await cache.match(event.request);
            const network = fetch(event.request).then((res) => {
                if (res.ok) {
                    cache.put(event.request, res.clone());
                }
                return res;
            }).catch(() => cached);
            return cached || network;
        }));
    } else if (url.pathname === "/app") {
        // network first, offline fallback to the cached shell
        event.respondWith(fetch(event.request).catch(() => caches.match("/app")));
    }
});
