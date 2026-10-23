/** @odoo-module **/
/**
 * Web push for the workshop app: alerts (late orders, new reviews, payments)
 * arrive on the phone even when Liputa is closed and the screen locked.
 */
import { call } from "./api";

function b64ToBytes(base64) {
    const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function registration() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return null;
    }
    return navigator.serviceWorker.getRegistration("/app");
}

/** "on" | "off" | "denied" | "unsupported" */
export async function pushState() {
    const reg = await registration();
    if (!reg) {
        return "unsupported";
    }
    if (Notification.permission === "denied") {
        return "denied";
    }
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
}

export async function enablePush() {
    const reg = await registration();
    if (!reg || (await Notification.requestPermission()) !== "granted") {
        return false;
    }
    const { key } = await call("/liputa/push/key");
    const sub = (await reg.pushManager.getSubscription())
        || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
    await call("/liputa/push/subscribe", { subscription: sub.toJSON(), vapid_public_key: key });
    return true;
}

export async function disablePush() {
    const reg = await registration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
        await call("/liputa/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
    }
}
