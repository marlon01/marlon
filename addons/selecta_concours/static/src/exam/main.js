/** @odoo-module */
import { Component, mount, onWillStart, onWillUnmount, useState, whenReady, xml } from "@odoo/owl";
import { UiHost, notify } from "@selecta_concours/common/ui";
import { readConfig } from "@selecta_concours/common/utils";
import { RpcError } from "@selecta_concours/common/rpc";
import { ExamSession } from "@selecta_concours/exam/session";
import { Proctor } from "@selecta_concours/exam/proctor";
import { BriefingScreen, CameraCheck, DisqualifiedScreen, LoginScreen, PendingScreen, ResultScreen } from "@selecta_concours/exam/components";
import { ExamScreen } from "@selecta_concours/exam/exam_screen";

// Politique locale miroir de celle du serveur (appliquée seulement hors ligne, en attente de confirmation).
const CRITICAL = new Set(["multiple_faces", "identity_mismatch", "camera_lost", "devtools"]);
const WARNING = new Set(["face_absent", "look_away", "tab_hidden", "fullscreen_exit", "window_blur", "copy_paste", "shortcut"]);

class ExamApp extends Component {
    static components = { LoginScreen, BriefingScreen, CameraCheck, ExamScreen, ResultScreen, DisqualifiedScreen, PendingScreen, UiHost };
    static template = xml`
        <div class="ex-root">
            <t t-if="state.screen == 'boot'"><div class="sl-boot"><div class="sl-boot-logo">S</div><div>Reprise de session…</div></div></t>
            <LoginScreen t-elif="state.screen == 'login'" company="config.company" version="config.version"
                         error="state.error" loading="state.loading" online="session.online" onLogin.bind="login"/>
            <BriefingScreen t-elif="state.screen == 'briefing'" info="session.info" onContinue.bind="afterBriefing" onCancel.bind="logout"/>
            <CameraCheck t-elif="state.screen == 'camera'" proctor="proctor" resume="state.resume"
                         duration="session.info.concours.duration_minutes" onIdentity.bind="identity" onStart.bind="startExam"/>
            <ExamScreen t-elif="state.screen == 'exam'" session="sessionObj" info="session.info" proctor="proctor"
                        warning="state.warning" onFinished.bind="finished" onError.bind="showError"/>
            <PendingScreen t-elif="state.screen == 'pending'" pending="session.pending"/>
            <ResultScreen t-elif="state.screen == 'result'" result="session.status.result" state="session.status.state" onDone.bind="logout"/>
            <DisqualifiedScreen t-elif="state.screen == 'disqualified'" reason="state.disqReason" pending="state.disqPending" onDone.bind="logout"/>
            <UiHost/>
        </div>`;
    static props = {};

    setup() {
        this.config = readConfig();
        this.sessionObj = new ExamSession();
        this.session = useState(this.sessionObj.state);
        this.state = useState({ screen: "boot", error: "", loading: false, resume: false, warning: null, disqReason: "", disqPending: false });
        this.proctor = null;
        this.sessionObj.onStatus((st) => this.onStatus(st));
        onWillStart(async () => {
            const res = await this.sessionObj.restore();
            if (res) {
                this.route(res);
            } else {
                this.state.screen = "login";
            }
        });
        onWillUnmount(() => {
            clearInterval(this.hb);
            this.proctor?.stop();
            this.sessionObj.destroy();
        });
        this.registerServiceWorker();
    }

    registerServiceWorker() {
        if ("serviceWorker" in navigator && window.isSecureContext) {
            navigator.serviceWorker.register("/selecta/sw.js", { scope: "/selecta/" }).catch(() => {});
        }
    }

    makeProctor() {
        if (!this.proctor) {
            this.proctor = new Proctor({
                facelib: this.config.facelib,
                models: this.config.models,
                config: this.session.info?.proctoring || {},
                onEvent: (type, details, snap) => this.proctorEvent(type, details, snap),
            });
        } else {
            this.proctor.config = this.session.info?.proctoring || {};
        }
        return this.proctor;
    }

    route(info) {
        const st = info.status || {};
        if (st.state === "disqualified") {
            this.state.disqReason = st.disqualified_reason;
            this.state.screen = "disqualified";
        } else if (info.finished || ["submitted", "expired", "absent"].includes(st.state)) {
            this.state.screen = st.result ? "result" : "login";
        } else if (st.state === "in_progress") {
            this.state.resume = true;
            if (info.proctoring?.enabled) {
                this.makeProctor();
                this.state.screen = "camera";
            } else {
                this.enterExam();
            }
        } else {
            this.state.screen = "briefing";
        }
    }

    onStatus(st) {
        if (!st) {
            return;
        }
        if (st.state === "disqualified" && this.state.screen !== "disqualified") {
            this.state.disqReason = st.disqualified_reason;
            this.state.disqPending = false;
            this.leaveExam();
            this.state.screen = "disqualified";
        } else if (["submitted", "expired"].includes(st.state) && ["exam", "pending"].includes(this.state.screen)) {
            this.leaveExam();
            this.state.screen = "result";
        }
    }

    // ------------------------------------------------------------------ actions
    async login(code) {
        this.state.loading = true;
        this.state.error = "";
        try {
            const res = await this.sessionObj.login(code);
            if (res.error) {
                this.state.error = res.error;
                return;
            }
            this.route(res);
        } catch (e) {
            this.state.error = e instanceof RpcError ? e.message : "Serveur d'examen injoignable. Vérifiez la connexion du poste.";
        } finally {
            this.state.loading = false;
        }
    }

    afterBriefing() {
        if (this.session.info.proctoring.enabled) {
            this.makeProctor();
            this.state.screen = "camera";
        } else {
            this.startExam();
        }
    }

    async identity(descriptor, photo) {
        try {
            return await this.sessionObj.sendIdentity(descriptor, photo);
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    async startExam() {
        if (this.session.info.proctoring.require_fullscreen) {
            await document.documentElement.requestFullscreen?.().catch(() => {});
        }
        if (!this.state.resume) {
            try {
                const res = await this.sessionObj.start();
                if (res.error) {
                    notify(res.error, "danger");
                    return;
                }
            } catch (e) {
                notify(e.message, "danger");
                return;
            }
        }
        this.enterExam();
    }

    async enterExam() {
        if (!this.sessionObj.pageQuestions(this.session.localPage)) {
            await this.sessionObj.restore();
        }
        this.state.screen = "exam";
        if (this.proctor && this.session.info.proctoring.enabled) {
            this.proctor.start();
        }
        clearInterval(this.hb);
        this.hb = setInterval(() => {
            this.sessionObj.heartbeat(this.proctor?.lastDescriptor || null, this.proctor?.metrics?.faces ?? null);
        }, 15000);
    }

    leaveExam() {
        clearInterval(this.hb);
        this.proctor?.stop();
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }

    async proctorEvent(type, details, snapshot) {
        if (this.state.screen !== "exam") {
            return;
        }
        const res = await this.sessionObj.sendEvent(type, details, snapshot);
        if (res?.queued) {
            // Hors ligne : application locale de la même politique
            const info = this.session.info;
            const level = info.proctoring.level;
            const max = this.session.status?.max_warnings ?? 2;
            if (CRITICAL.has(type) || (WARNING.has(type) && (level === "zero" || this.session.warnings + 1 > max))) {
                this.state.disqReason = details;
                this.state.disqPending = true;
                this.leaveExam();
                this.state.screen = "disqualified";
                return;
            }
            if (WARNING.has(type)) {
                this.session.warnings++;
                this.flashWarning(details);
            }
            return;
        }
        if (res?.action === "warning") {
            this.flashWarning(details);
        }
    }

    flashWarning(text) {
        this.state.warning = text;
        clearTimeout(this.warnTimer);
        this.warnTimer = setTimeout(() => (this.state.warning = null), 6000);
    }

    finished() {
        if (this.session.status && ["submitted", "expired"].includes(this.session.status.state)) {
            this.leaveExam();
            this.state.screen = "result";
        } else if (this.session.status?.state === "disqualified") {
            this.onStatus(this.session.status);
        } else {
            this.leaveExam();
            this.state.screen = "pending";
        }
    }

    showError(msg) {
        notify(msg, "danger", 7000);
    }

    logout() {
        this.leaveExam();
        this.proctor = null;
        this.sessionObj.clear();
        try {
            sessionStorage.clear();
        } catch {
            /* ignoré */
        }
        this.state.error = "";
        this.state.resume = false;
        this.state.screen = "login";
    }
}

whenReady(() => {
    const root = document.getElementById("selecta-root");
    root.innerHTML = "";
    mount(ExamApp, root, { dev: false, name: "SELECTA Candidat" });
});
