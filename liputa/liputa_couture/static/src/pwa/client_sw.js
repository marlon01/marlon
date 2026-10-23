/* Liputa client app service worker (scope /c): offline directory shell and push
 * notifications. A push wakes this worker even when the app is closed and the
 * phone locked; the notification opens the order or page it is about. */
const CACHE = "liputa-client-v1";
const SHELL = ["/c", "/liputa_couture/static/description/icon.svg",
               "/liputa_couture/static/src/app/img/icon-512.png",
               "/liputa_couture/static/src/client/client.js"];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith("liputa-client") && k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin) {
        return;
    }
    if (url.pathname.startsWith("/c")) {
        // Pages : le réseau d'abord (données à jour), la copie en cache si le réseau tombe.
        event.respondWith(fetch(event.request).then((res) => {
            if (res.ok && url.pathname === "/c") {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put("/c", copy));
            }
            return res;
        }).catch(() => caches.match(event.request).then((hit) => hit || caches.match("/c"))));
    } else if (url.pathname.startsWith("/liputa_couture/static/") || url.pathname.startsWith("/web/assets/")) {
        event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
        })));
    }
});

self.addEventListener("push", (event) => {
    let msg = { title: "Liputa", options: {} };
    try {
        msg = event.data.json();
    } catch {
        msg.options.body = event.data ? event.data.text() : "";
    }
    event.waitUntil(self.registration.showNotification(msg.title || "Liputa", msg.options || {}));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = new URL((event.notification.data && event.notification.data.url) || "/c", self.location.origin).href;
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
        const open = wins.find((w) => w.url === target) || wins[0];
        if (open) {
            return open.navigate(target).then((w) => (w || open).focus());
        }
        return self.clients.openWindow(target);
    }));
});
