/** @odoo-module */
/*
 * Session d'épreuve côté poste candidat.
 *  - horloge synchronisée sur le serveur, avancée par une horloge monotone (insensible
 *    au changement de l'heure système du poste) ;
 *  - file d'attente persistante : en cas de coupure réseau, réponses et événements sont
 *    conservés localement puis rejoués dans l'ordre (/selecta/api/sync) ;
 *  - le serveur reste l'unique autorité : correction, temps, page courante, sanctions.
 */
import { reactive } from "@odoo/owl";
import { jsonrpc, NetworkError } from "@selecta_concours/common/rpc";

const STORE_KEY = "selecta.exam.v1";
const PING_URL = "/selecta/ping";

function load() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch {
        return null;
    }
}

export class ExamSession {
    constructor() {
        this.state = reactive({
            online: navigator.onLine,
            syncing: false,
            pending: 0,
            token: null,
            info: null, // candidat / concours / surveillance
            status: null, // état serveur
            pages: {}, // questionnaire préchargé (sans corrigé)
            localPage: 0,
            localFinished: false,
            localDisqualified: null,
            warnings: 0,
            lastWarning: null,
        });
        this.outbox = [];
        this.clock = { server: Date.now(), perf: performance.now() };
        this.opSeq = 0;
        this.listeners = new Set();
        const saved = load();
        if (saved?.token) {
            this.state.token = saved.token;
            this.outbox = saved.outbox || [];
            this.state.pages = saved.pages || {};
            this.state.localPage = saved.localPage || 0;
            this.opSeq = saved.opSeq || 0;
            this.state.pending = this.outbox.length;
        }
        window.addEventListener("online", () => this.checkConnection());
        window.addEventListener("offline", () => this.setOnline(false));
        this.pingTimer = setInterval(() => {
            if (!this.state.online || this.outbox.length) {
                this.checkConnection();
            }
        }, 3000);
    }

    // ------------------------------------------------------------------ persistance
    persist() {
        if (!this.state.token) {
            localStorage.removeItem(STORE_KEY);
            return;
        }
        try {
            localStorage.setItem(
                STORE_KEY,
                JSON.stringify({
                    token: this.state.token,
                    outbox: this.outbox,
                    pages: this.state.pages,
                    localPage: this.state.localPage,
                    opSeq: this.opSeq,
                })
            );
        } catch {
            /* stockage plein : la file reste en mémoire */
        }
    }

    clear() {
        this.state.token = null;
        this.state.pages = {};
        this.outbox = [];
        this.state.pending = 0;
        localStorage.removeItem(STORE_KEY);
    }

    // ------------------------------------------------------------------ horloge
    syncClock(status) {
        if (status?.server_now) {
            this.clock = { server: status.server_now, perf: performance.now() };
        }
    }
    now() {
        return this.clock.server + (performance.now() - this.clock.perf);
    }
    remainingMs() {
        const st = this.state.status;
        if (!st?.deadline) {
            return (st?.duration_seconds || 0) * 1000;
        }
        return Math.max(0, st.deadline - this.now());
    }
    elapsedMs() {
        const st = this.state.status;
        if (!st?.deadline) {
            return 0;
        }
        return this.now() - (st.deadline - st.duration_seconds * 1000);
    }

    // ------------------------------------------------------------------ réseau
    setOnline(value) {
        this.state.online = value;
    }

    async checkConnection() {
        try {
            const r = await fetch(PING_URL, { cache: "no-store" });
            this.setOnline(r.ok);
            if (r.ok && this.outbox.length) {
                await this.flush();
            }
        } catch {
            this.setOnline(false);
        }
    }

    async call(route, params = {}) {
        try {
            const res = await jsonrpc(route, { token: this.state.token, ...params });
            this.setOnline(true);
            return res;
        } catch (e) {
            if (e instanceof NetworkError) {
                this.setOnline(false);
            }
            throw e;
        }
    }

    applyStatus(status) {
        if (!status) {
            return;
        }
        this.syncClock(status);
        this.state.status = status;
        this.state.warnings = status.warnings ?? this.state.warnings;
        if (!this.outbox.length && status.state === "in_progress") {
            this.state.localPage = status.current_page;
        }
        this.persist();
        for (const fn of this.listeners) {
            fn(status);
        }
    }

    onStatus(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    mergePackage(pkg) {
        if (!pkg) {
            return;
        }
        this.state.pages = { ...this.state.pages, ...pkg.pages };
        this.applyStatus(pkg.status);
    }

    // ------------------------------------------------------------------ parcours
    async login(code) {
        const res = await jsonrpc("/selecta/api/login", { code });
        if (res.error) {
            return res;
        }
        this.clear();
        this.state.token = res.token;
        this.state.info = res;
        this.applyStatus(res.status);
        return res;
    }

    async restore() {
        if (!this.state.token) {
            return null;
        }
        try {
            const res = await this.call("/selecta/api/state");
            if (res.error) {
                this.clear();
                return null;
            }
            this.state.info = res;
            if (res.package) {
                this.state.pages = { ...this.state.pages, ...res.package.pages };
            }
            this.applyStatus(res.status);
            if (this.outbox.length) {
                await this.flush();
            }
            return res;
        } catch (e) {
            if (e instanceof NetworkError && this.state.info) {
                return this.state.info;
            }
            return null;
        }
    }

    async sendIdentity(descriptor, photo) {
        const res = await this.call("/selecta/api/identity", { descriptor, photo });
        if (res.status) {
            this.applyStatus(res.status);
        }
        return res;
    }

    async start() {
        const res = await this.call("/selecta/api/start");
        if (res.error) {
            return res;
        }
        this.mergePackage(res);
        this.state.localPage = res.status.current_page;
        this.persist();
        return res;
    }

    pageQuestions(page) {
        return this.state.pages[page] || this.state.pages[String(page)] || null;
    }

    /** Valide une page : en ligne → serveur ; hors ligne → file sécurisée et poursuite locale. */
    async submitPage(page, answers, timeUp = false) {
        const op = {
            id: ++this.opSeq,
            kind: "submit",
            page,
            answers,
            time_up: timeUp,
            elapsed_ms: Math.round(this.elapsedMs()),
        };
        const total = this.state.status?.total_pages || 1;
        if (this.state.online && !this.outbox.length) {
            try {
                const res = await this.call("/selecta/api/submit", op);
                if (res.error) {
                    return res;
                }
                if (res.package) {
                    this.state.pages = { ...this.state.pages, ...res.package.pages };
                }
                this.applyStatus(res.status);
                this.state.localPage = res.status.current_page;
                this.persist();
                return res;
            } catch (e) {
                if (!(e instanceof NetworkError)) {
                    throw e;
                }
            }
        }
        // Mode résilience
        this.outbox.push(op);
        this.state.pending = this.outbox.length;
        this.state.localPage = page + 1;
        if (timeUp || page + 1 >= total) {
            this.state.localFinished = true;
        }
        this.persist();
        return { queued: true };
    }

    async sendEvent(type, details = "", snapshot = null) {
        const op = { id: ++this.opSeq, kind: "event", type, details, snapshot, ts: new Date().toISOString() };
        if (this.state.online && !this.outbox.length) {
            try {
                const res = await this.call("/selecta/api/event", op);
                if (res.status) {
                    this.applyStatus(res.status);
                }
                return res;
            } catch (e) {
                if (!(e instanceof NetworkError)) {
                    return { error: e.message };
                }
            }
        }
        // Hors ligne : on applique localement la même politique en attendant la confirmation serveur
        if (snapshot && this.outbox.filter((o) => o.snapshot).length > 10) {
            op.snapshot = null; // limite l'espace occupé
        }
        this.outbox.push(op);
        this.state.pending = this.outbox.length;
        this.persist();
        return { queued: true };
    }

    async heartbeat(descriptor = null, faces = null) {
        if (!this.state.online || this.outbox.length) {
            return null;
        }
        try {
            const res = await this.call("/selecta/api/heartbeat", { descriptor, faces });
            if (res.status) {
                this.applyStatus(res.status);
            }
            return res;
        } catch {
            return null;
        }
    }

    async flush() {
        if (this.state.syncing || !this.outbox.length) {
            return;
        }
        this.state.syncing = true;
        try {
            while (this.outbox.length) {
                const ops = this.outbox.slice(0, 50);
                const res = await jsonrpc("/selecta/api/sync", { token: this.state.token, ops }, { timeout: 45000 });
                const done = new Set(res.results.map((r) => r.id));
                this.outbox = this.outbox.filter((o) => !done.has(o.id));
                this.state.pending = this.outbox.length;
                this.setOnline(true);
                if (res.status) {
                    this.applyStatus(res.status);
                    this.state.localPage = Math.max(this.state.localPage, res.status.current_page);
                }
                this.persist();
                if (!done.size) {
                    break;
                }
            }
        } catch (e) {
            if (e instanceof NetworkError) {
                this.setOnline(false);
            }
        } finally {
            this.state.syncing = false;
        }
    }

    destroy() {
        clearInterval(this.pingTimer);
    }
}
