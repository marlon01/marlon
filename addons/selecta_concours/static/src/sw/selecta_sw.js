/* SELECTA — service worker de l'espace candidat (mode résilience).
 * - l'application et le moteur de vision restent disponibles si le réseau tombe ;
 * - les appels API ne sont JAMAIS mis en cache (le serveur reste l'autorité). */
const VERSION = "selecta-__SELECTA_VERSION__";
const SHELL = ["/selecta/exam"];
const PRECACHE = [
    "/selecta_concours/static/lib/face-api/face-api.js",
    "/selecta_concours/static/lib/face-api/model/tiny_face_detector_model-weights_manifest.json",
    "/selecta_concours/static/lib/face-api/model/tiny_face_detector_model.bin",
    "/selecta_concours/static/lib/face-api/model/face_landmark_68_tiny_model-weights_manifest.json",
    "/selecta_concours/static/lib/face-api/model/face_landmark_68_tiny_model.bin",
    "/selecta_concours/static/lib/face-api/model/face_recognition_model-weights_manifest.json",
    "/selecta_concours/static/lib/face-api/model/face_recognition_model.bin",
    "/selecta_concours/static/description/icon.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(VERSION).then((cache) => cache.addAll([...SHELL, ...PRECACHE]).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") {
        return;
    }
    const url = new URL(req.url);
    if (url.origin !== location.origin || url.pathname.startsWith("/selecta/api") || url.pathname === "/selecta/ping") {
        return;
    }
    const isStatic = url.pathname.startsWith("/web/assets/") || url.pathname.startsWith("/selecta_concours/static/") || url.pathname.startsWith("/web/binary/company_logo");
    if (isStatic) {
        event.respondWith(
            caches.match(req).then(
                (hit) =>
                    hit ||
                    fetch(req).then((res) => {
                        if (res.ok) {
                            const copy = res.clone();
                            caches.open(VERSION).then((c) => c.put(req, copy));
                        }
                        return res;
                    })
            )
        );
        return;
    }
    if (url.pathname === "/selecta/exam") {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(VERSION).then((c) => c.put("/selecta/exam", copy));
                    return res;
                })
                .catch(() => caches.match("/selecta/exam"))
        );
    }
});
