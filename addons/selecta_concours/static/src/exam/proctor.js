/** @odoo-module */
import { locale } from "@selecta_concours/common/i18n";
/*
 * Surveillant IA — vision par ordinateur 100 % locale (aucune image ne quitte le poste,
 * sauf les clichés probatoires joints aux incidents).
 *   - détection de visage (TinyFaceDetector) et 68 points faciaux ;
 *   - estimation de l'orientation de la tête (lacet / tangage) ;
 *   - comptage des personnes présentes ;
 *   - empreinte biométrique 128D pour le contrôle continu d'identité ;
 *   - détection de caméra masquée / coupée ;
 *   - verrouillage de l'environnement : onglets, focus, plein écran, raccourcis, presse-papiers.
 */

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (window.faceapi) {
            resolve();
            return;
        }
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Moteur de vision introuvable"));
        document.head.appendChild(s);
    });
}

export function euclid(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
    }
    return Math.sqrt(s);
}

export class Proctor {
    constructor({ facelib, models, config, onEvent, onFrame }) {
        this.facelib = facelib;
        this.models = models;
        this.config = config || {};
        this.onEvent = onEvent || (() => {});
        this.onFrame = onFrame || (() => {});
        this.video = null;
        this.stream = null;
        this.running = false;
        this.loaded = false;
        this.reference = null;
        this.lastDescriptor = null;
        this.metrics = { faces: 0, yaw: 0, pitch: 0, brightness: 0, status: "init" };
        this._absentSince = null;
        this._absentReported = 0;
        this._awaySince = null;
        this._awayReported = false;
        this._multiCount = 0;
        this._darkSince = null;
        this._darkReported = false;
        this._mismatch = 0;
        this._lastIdentity = 0;
        this._cooldown = {};
        this._listeners = [];
        this.canvas = document.createElement("canvas");
        this.tiny = document.createElement("canvas");
        this.tiny.width = 32;
        this.tiny.height = 24;
    }

    async load(progress = () => {}) {
        progress("Chargement du moteur de vision…", 10);
        await loadScript(this.facelib);
        const fa = window.faceapi;
        // Accélération graphique si disponible, sinon calcul processeur (fonctionne sur tout poste).
        for (const backend of ["webgl", "cpu"]) {
            try {
                if (await fa.tf.setBackend(backend)) {
                    break;
                }
            } catch {
                /* backend suivant */
            }
        }
        await fa.tf.ready();
        this.backend = fa.tf.getBackend();
        progress("Chargement du détecteur de visage…", 35);
        await fa.nets.tinyFaceDetector.loadFromUri(this.models);
        progress("Chargement de l'analyse faciale…", 60);
        await fa.nets.faceLandmark68TinyNet.loadFromUri(this.models);
        progress("Chargement de la reconnaissance d'identité…", 80);
        await fa.nets.faceRecognitionNet.loadFromUri(this.models);
        this.options = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });
        this.loaded = true;
        progress("Moteur de surveillance prêt", 100);
    }

    async attach(video) {
        this.video = video;
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Ce poste n'autorise pas l'accès caméra (contexte non sécurisé). Utilisez le lanceur « Poste candidat » fourni."
            );
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            audio: false,
        });
        video.srcObject = this.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        for (const track of this.stream.getVideoTracks()) {
            track.addEventListener("ended", () => this.emit("camera_lost", "Flux caméra interrompu", true));
        }
    }

    /** Analyse instantanée d'une image : nombre de visages, orientation, luminosité. */
    async analyze() {
        const fa = window.faceapi;
        const v = this.video;
        if (!v || v.readyState < 2) {
            return null;
        }
        const dets = await fa.detectAllFaces(v, this.options).withFaceLandmarks(true);
        const ctx = this.tiny.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, 32, 24);
        const px = ctx.getImageData(0, 0, 32, 24).data;
        let lum = 0;
        for (let i = 0; i < px.length; i += 4) {
            lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        }
        const brightness = lum / (px.length / 4);
        const strong = dets.filter((d) => d.detection.score > 0.55);
        let yaw = 0;
        let pitch = 0.45;
        let box = null;
        if (dets.length) {
            const main = dets.reduce((a, b) => (a.detection.box.area > b.detection.box.area ? a : b));
            const pts = main.landmarks.positions;
            const jawL = pts[0];
            const jawR = pts[16];
            const nose = pts[30];
            const chin = pts[8];
            const eyeY = (pts[36].y + pts[45].y) / 2;
            const width = jawR.x - jawL.x || 1;
            yaw = (nose.x - jawL.x) / width - 0.5; // ~0 de face, ±0,5 de profil
            pitch = (nose.y - eyeY) / (chin.y - eyeY || 1); // ~0,45 de face
            box = main.detection.box;
        }
        const m = { faces: dets.length, strongFaces: strong.length, yaw, pitch, brightness, box };
        this.metrics = m;
        return m;
    }

    async descriptor() {
        const fa = window.faceapi;
        const r = await fa.detectSingleFace(this.video, this.options).withFaceLandmarks(true).withFaceDescriptor();
        return r ? Array.from(r.descriptor) : null;
    }

    snapshot(quality = 0.6) {
        const v = this.video;
        if (!v || !v.videoWidth) {
            return null;
        }
        this.canvas.width = 320;
        this.canvas.height = Math.round((320 * v.videoHeight) / v.videoWidth);
        const ctx = this.canvas.getContext("2d");
        ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillRect(0, this.canvas.height - 18, this.canvas.width, 18);
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        ctx.fillText(new Date().toLocaleString(locale()), 6, this.canvas.height - 5);
        return this.canvas.toDataURL("image/jpeg", quality);
    }

    isLooking(m) {
        return Math.abs(m.yaw) < 0.2 && m.pitch > 0.24 && m.pitch < 0.72;
    }

    emit(type, details, withSnapshot = true) {
        const now = Date.now();
        if (this._cooldown[type] && now - this._cooldown[type] < 4000) {
            return;
        }
        this._cooldown[type] = now;
        this.onEvent(type, details, withSnapshot ? this.snapshot() : null);
    }

    // ------------------------------------------------------------------ surveillance continue
    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        this.lockEnvironment();
        this.loop();
    }

    async loop() {
        const cfg = this.config;
        while (this.running) {
            const t0 = performance.now();
            try {
                const m = await this.analyze();
                if (m) {
                    this.evaluate(m, cfg);
                    this.onFrame(m);
                }
                if (cfg.identity_check && this.reference && Date.now() - this._lastIdentity > 8000) {
                    this._lastIdentity = Date.now();
                    const d = await this.descriptor();
                    if (d) {
                        this.lastDescriptor = d;
                        const dist = euclid(d, this.reference);
                        this._mismatch = dist > 0.6 ? this._mismatch + 1 : 0;
                        if (this._mismatch >= 3) {
                            this.emit("identity_mismatch", `Écart biométrique ${dist.toFixed(2)} sur 3 contrôles successifs`);
                            this._mismatch = 0;
                        }
                    }
                }
            } catch {
                /* image indisponible : on réessaie */
            }
            const wait = Math.max(120, 450 - (performance.now() - t0));
            await new Promise((r) => setTimeout(r, wait));
        }
    }

    evaluate(m, cfg) {
        const now = Date.now();
        const absentLimit = (cfg.face_absent_seconds || 5) * 1000;
        const awayLimit = (cfg.look_away_seconds || 4) * 1000;
        // Caméra masquée
        if (m.brightness < 14) {
            this._darkSince ??= now;
            if (!this._darkReported && now - this._darkSince > 3000) {
                this._darkReported = true;
                this.emit("camera_lost", "Image noire : caméra masquée ou obstruée");
            }
            this.metrics.status = "dark";
            return;
        }
        this._darkSince = null;
        this._darkReported = false;
        // Absence
        if (m.faces === 0) {
            this._absentSince ??= now;
            const dur = now - this._absentSince;
            const episodes = Math.floor(dur / (absentLimit * 3));
            if (dur > absentLimit && this._absentReported <= episodes) {
                this._absentReported = episodes + 1;
                this.emit("face_absent", `Aucun visage détecté depuis ${Math.round(dur / 1000)} s`);
            }
            this.metrics.status = "absent";
            this._awaySince = null;
            return;
        }
        this._absentSince = null;
        this._absentReported = 0;
        // Plusieurs personnes
        if (m.strongFaces >= 2) {
            this._multiCount++;
            if (this._multiCount >= 2) {
                this.emit("multiple_faces", `${m.strongFaces} visages détectés simultanément`);
                this._multiCount = 0;
            }
            this.metrics.status = "multiple";
            return;
        }
        this._multiCount = 0;
        // Regard détourné
        if (!this.isLooking(m)) {
            this._awaySince ??= now;
            if (!this._awayReported && now - this._awaySince > awayLimit) {
                this._awayReported = true;
                const dir = Math.abs(m.yaw) >= 0.2 ? (m.yaw > 0 ? "vers la droite" : "vers la gauche") : m.pitch >= 0.72 ? "vers le bas" : "vers le haut";
                this.emit("look_away", `Tête tournée ${dir} pendant plus de ${Math.round(awayLimit / 1000)} s`);
            }
            this.metrics.status = "away";
            return;
        }
        this._awaySince = null;
        this._awayReported = false;
        this.metrics.status = "ok";
    }

    // ------------------------------------------------------------------ environnement verrouillé
    on(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        this._listeners.push([target, type, fn, opts]);
    }

    lockEnvironment() {
        const cfg = this.config;
        let blurTimer = null;
        this.on(document, "visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                this.emit("tab_hidden", "La fenêtre d'examen a été masquée", false);
            }
        });
        this.on(window, "blur", () => {
            clearTimeout(blurTimer);
            blurTimer = setTimeout(() => {
                if (!document.hasFocus()) {
                    this.emit("window_blur", "Focus perdu plus de 2 secondes", false);
                }
            }, 2000);
        });
        this.on(window, "focus", () => clearTimeout(blurTimer));
        if (cfg.require_fullscreen) {
            this.on(document, "fullscreenchange", () => {
                if (!document.fullscreenElement) {
                    this.emit("fullscreen_exit", "Sortie du mode plein écran", false);
                }
            });
        }
        const block = (e) => {
            e.preventDefault();
            this.emit("copy_paste", `Action « ${e.type} » bloquée`, false);
        };
        for (const t of ["copy", "cut", "paste"]) {
            this.on(document, t, block);
        }
        this.on(document, "contextmenu", (e) => e.preventDefault());
        this.on(document, "dragstart", (e) => e.preventDefault());
        this.on(
            window,
            "keydown",
            (e) => {
                const k = (e.key || "").toLowerCase();
                const ctrl = e.ctrlKey || e.metaKey;
                if (k === "f12" || (ctrl && e.shiftKey && ["i", "j", "c", "k"].includes(k))) {
                    e.preventDefault();
                    this.emit("devtools", `Raccourci ${e.key} (outils développeur)`, true);
                } else if (k === "printscreen" || (ctrl && ["p", "s", "u", "c", "v", "x", "a", "f", "r"].includes(k)) || k === "f5" || (e.altKey && k === "tab")) {
                    e.preventDefault();
                    this.emit("shortcut", `Raccourci interdit : ${ctrl ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.key}`, false);
                }
            },
            true
        );
    }

    stop() {
        this.running = false;
        for (const [t, type, fn, opts] of this._listeners) {
            t.removeEventListener(type, fn, opts);
        }
        this._listeners = [];
        if (this.stream) {
            for (const tr of this.stream.getTracks()) {
                tr.stop();
            }
        }
        this.stream = null;
    }
}
