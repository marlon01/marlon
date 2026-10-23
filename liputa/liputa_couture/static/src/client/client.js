/* Liputa client portal (/c): installable app and push notifications.
 * Plain script (no Odoo assets on public pages). Everything degrades gracefully:
 * without service worker or push support, the banners simply stay hidden. */
(function () {
    "use strict";

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const $ = (id) => document.getElementById(id);

    async function rpc(url, params) {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: params || {} }),
        });
        const data = await res.json();
        if (data.error) {
            throw new Error(data.error.data?.message || data.error.message);
        }
        return data.result;
    }

    function b64ToBytes(base64) {
        const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
        return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    }

    // ------------------------------------------------------------ installation
    let deferredPrompt = null;
    function showInstall(text) {
        const banner = $("lp-install");
        if (!banner || isStandalone) {
            return;
        }
        if (text) {
            $("lp-install-text").textContent = text;
        }
        banner.hidden = false;
    }
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredPrompt = event;
        showInstall();
    });
    window.addEventListener("appinstalled", () => {
        $("lp-install")?.setAttribute("hidden", "1");
    });

    // ------------------------------------------------------------ notifications
    async function pushState(reg) {
        if (!reg || !("PushManager" in window) || !("Notification" in window)) {
            return "unsupported";
        }
        if (Notification.permission === "denied") {
            return "denied";
        }
        const sub = await reg.pushManager.getSubscription();
        return sub && Notification.permission === "granted" ? "on" : "off";
    }

    async function enablePush(reg) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
            return false;
        }
        const { key } = await rpc("/liputa/push/key");
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
        }
        await rpc("/liputa/push/subscribe", { subscription: sub.toJSON(), vapid_public_key: key });
        return true;
    }

    async function boot() {
        let reg = null;
        if ("serviceWorker" in navigator && window.isSecureContext) {
            reg = await navigator.serviceWorker.register("/c/sw.js", { scope: "/c" }).catch(() => null);
            if (reg) {
                reg = await navigator.serviceWorker.ready;
            }
        }
        // iOS : pas d'invite d'installation, on explique le geste (Partager > Sur l'écran d'accueil).
        if (isIOS && !isStandalone) {
            showInstall("Touchez Partager puis « Sur l'écran d'accueil ».");
            $("lp-install-btn")?.setAttribute("hidden", "1");
        }
        $("lp-install-btn")?.addEventListener("click", async () => {
            if (!deferredPrompt) {
                return;
            }
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            $("lp-install").hidden = true;
        });

        const pushBanner = $("lp-push");
        if (pushBanner && (await pushState(reg)) === "off") {
            // Sur iPhone, les notifications n'existent que dans l'application installée.
            pushBanner.hidden = isIOS && !isStandalone;
            $("lp-push-btn").addEventListener("click", async () => {
                const btn = $("lp-push-btn");
                btn.disabled = true;
                try {
                    if (await enablePush(reg)) {
                        pushBanner.querySelector(".lp-small").textContent = "Notifications activées sur ce téléphone.";
                        btn.hidden = true;
                    } else {
                        btn.disabled = false;
                    }
                } catch {
                    btn.disabled = false;
                }
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
