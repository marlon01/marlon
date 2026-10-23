/** @odoo-module **/
import { mount, whenReady } from "@odoo/owl";
import { api, store } from "./core/api";
import { setLang } from "./core/i18n";
import { startRouter } from "./core/router";
import { LiputaApp } from "./app";

async function boot() {
    if (!document.querySelector(".lp-body") || window.__liputaBooted) {
        return; // only on the /app page
    }
    window.__liputaBooted = true;
    setLang((document.documentElement.lang || "fr").slice(0, 2));
    store.me = await api.me();
    setLang(store.me.lang);
    startRouter();
    document.getElementById("lp-boot")?.remove();
    await mount(LiputaApp, document.body, { dev: false });
    if ("serviceWorker" in navigator && location.protocol === "https:") {
        navigator.serviceWorker.register("/app/sw.js", { scope: "/app" }).catch(() => {});
    }
}

whenReady(() => {
    if (document.getElementById("lp-boot")) {
        boot();
    }
});
