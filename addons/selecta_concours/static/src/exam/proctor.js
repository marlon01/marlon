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

// Images normales consécutives qui closent un épisode : une détection isolée ne remet pas le chronomètre à zéro.
const CLOSE_FRAMES = { absent: 2, away: 3 };

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
        // Orientation « face à l'écran » propre au poste (caméra décalée, au-dessus ou sous l'écran),
        // apprise pendant le contrôle caméra ; valeurs théoriques en attendant.
        this.pose = { yaw: 0, pitch: 0.45 };
        this._poseSamples = [];
        this._episodes = {};
        this._lastTime = -1;
        this._lastTimeAt = 0;
        this._failSince = null;
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
        // Entrée plus fine avec la carte graphique : visages petits ou de trois quarts mieux suivis.
        this.options = new fa.TinyFaceDetectorOptions({ inputSize: this.backend === "webgl" ? 320 : 224, scoreThreshold: 0.45 });
        this.loaded = true;
        progress("Moteur de surveillance prêt", 100);
    }

    /**
     * Ouvre la caméra. L'analyse lit une vidéo propre au surveillant, jamais celle d'un écran :
     * un écran démonté retire sa vidéo de la page, le navigateur la met en pause et l'IA
     * analyserait indéfiniment la dernière image (visage présent, regard sur l'écran).
     * ``preview`` reçoit seulement le même flux pour l'affichage.
     */
    async attach(preview) {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Ce poste n'autorise pas l'accès caméra (contexte non sécurisé). Utilisez le lanceur « Poste candidat » fourni."
            );
        }
        if (!this.stream?.active) {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
                audio: false,
            });
            for (const track of this.stream.getVideoTracks()) {
                track.addEventListener("ended", () => this.emit("camera_lost", "Flux caméra interrompu", true));
            }
        }
        if (!this.video) {
            const v = document.createElement("video");
            v.muted = true;
            v.playsInline = true;
            v.setAttribute("aria-hidden", "true");
            // Dans la page mais invisible : une vidéo hors page peut être suspendue par le navigateur.
            v.style.cssText = "position:fixed;left:0;top:0;width:160px;height:120px;opacity:0;pointer-events:none;z-index:-1";
            this.video = v;
        }
        if (!this.video.isConnected) {
            document.body.appendChild(this.video);
        }
        this.video.srcObject = this.stream;
        await this.video.play();
        if (preview) {
            this.preview(preview);
        }
    }

    preview(el) {
        el.srcObject = this.stream;
        el.muted = true;
        el.playsInline = true;
        el.play().catch(() => {});
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
        // Le candidat : un visage net et assez grand. Un visage minuscule (affiche, personne au fond)
        // ne prouve pas sa présence devant l'écran.
        const minWidth = (v.videoWidth || 640) * 0.08;
        const present = dets.filter((d) => d.detection.score > 0.5 && d.detection.box.width >= minWidth);
        let yaw = null;
        let pitch = null;
        let box = null;
        if (present.length) {
            const main = present.reduce((a, b) => (a.detection.box.area > b.detection.box.area ? a : b));
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
        const m = { faces: dets.length, present: present.length, strongFaces: strong.length, yaw, pitch, brightness, box };
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

    /** Visage à peu près de face : seuil large du contrôle caméra, avant tout apprentissage. */
    isFrontal(m) {
        return m.yaw !== null && Math.abs(m.yaw) < 0.2 && m.pitch > 0.24 && m.pitch < 0.72;
    }

    /** Regard sur l'écran pendant l'épreuve, par rapport à l'orientation apprise du poste. */
    isLooking(m) {
        return this.gaze(m) === null;
    }

    /** Direction du regard détourné, ou null si le candidat regarde l'écran. */
    gaze(m) {
        if (m.yaw === null) {
            return null;
        }
        const dy = m.yaw - this.pose.yaw;
        const dp = m.pitch - this.pose.pitch;
        if (Math.abs(dy) > 0.13) {
            return dy > 0 ? "vers la droite" : "vers la gauche";
        }
        if (dp > 0.17) {
            return "vers le bas";
        }
        if (dp < -0.15) {
            return "vers le haut";
        }
        return null;
    }

    /** Échantillon de pose « face à l'écran » pris pendant le contrôle caméra (médiane des 15 derniers). */
    learnPose(m) {
        if (!this.isFrontal(m)) {
            return;
        }
        this._poseSamples.push([m.yaw, m.pitch]);
        this._poseSamples = this._poseSamples.slice(-15);
        const median = (k) => {
            const xs = this._poseSamples.map((x) => x[k]).sort((a, b) => a - b);
            return xs[Math.floor(xs.length / 2)];
        };
        if (this._poseSamples.length >= 3) {
            this.pose = { yaw: median(0), pitch: median(1) };
        }
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
                const m = this.videoAlive() ? await this.analyze() : null;
                if (m) {
                    this._failSince = null;
                    this.evaluate(m, cfg);
                    this.onFrame(m);
                } else {
                    this.noImage(cfg);
                }
                if (m && cfg.identity_check && this.reference && Date.now() - this._lastIdentity > 8000) {
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
                this.noImage(cfg);
            }
            const wait = Math.max(120, 450 - (performance.now() - t0));
            await new Promise((r) => setTimeout(r, wait));
        }
    }

    /** La vidéo analysée avance-t-elle ? Relance une vidéo mise en pause ; une image figée n'est pas analysée. */
    videoAlive() {
        const v = this.video;
        if (!v || v.readyState < 2) {
            return false;
        }
        if (v.paused) {
            v.play().catch(() => {});
        }
        const now = Date.now();
        if (v.currentTime !== this._lastTime) {
            this._lastTime = v.currentTime;
            this._lastTimeAt = now;
            return true;
        }
        return now - this._lastTimeAt < 1500;
    }

    /** Aucune image exploitable : la surveillance ne doit jamais se taire en silence. */
    noImage(cfg) {
        if (document.visibilityState === "hidden") {
            return; // onglet masqué : déjà signalé (tab_hidden), le navigateur y ralentit la vidéo
        }
        const now = Date.now();
        this._failSince ??= now;
        this.metrics.status = "frozen";
        const limit = Math.max(8000, (cfg.face_absent_seconds || 5) * 1000);
        if (now - this._failSince > limit) {
            this._failSince = now;
            this.emit("heartbeat_missing", "Image caméra figée ou illisible : surveillance impossible");
        }
    }

    /**
     * Suivi d'un épisode (absence, regard détourné). Il commence à la première image concernée et ne
     * se clôt qu'après CLOSE_FRAMES images normales consécutives : une détection isolée (fausse
     * détection, points faciaux bruités) ne remet plus le chronomètre à zéro. Renvoie l'épisode, ou null.
     */
    episode(key, active, now) {
        const e = (this._episodes[key] ??= { since: null, clear: 0, reported: 0 });
        if (active) {
            e.since ??= now;
            e.clear = 0;
        } else if (e.since !== null && ++e.clear >= CLOSE_FRAMES[key]) {
            Object.assign(e, { since: null, clear: 0, reported: 0 });
        }
        return e.since === null ? null : e;
    }

    /** Signale un épisode qui dépasse ``limit``, puis de nouveau tous les trois ``limit`` s'il dure. */
    overdue(e, limit, now) {
        if (!e) {
            return false;
        }
        const dur = now - e.since;
        const due = dur > limit && e.reported <= Math.floor(dur / (limit * 3));
        if (due) {
            e.reported = Math.floor(dur / (limit * 3)) + 1;
        }
        return due;
    }

    evaluate(m, cfg, now = Date.now()) {
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
        const present = (m.present ?? m.faces) > 0;
        const dir = present ? this.gaze(m) : null;
        const absent = this.episode("absent", !present, now);
        // Une tête trop tournée n'est plus détectée : l'image sans visage prolonge le regard détourné
        // en cours au lieu de le remettre à zéro, sans en ouvrir un. Il est signalé au retour du
        // visage ; si le visage ne revient pas, c'est l'absence qui est signalée.
        const prev = this._episodes.away;
        const away = this.episode("away", present ? dir !== null : !!prev?.since, now);
        if (dir) {
            this._awayDir = dir;
        }
        if (!present) {
            if (this.overdue(absent, absentLimit, now)) {
                this.emit("face_absent", `Aucun visage détecté depuis ${Math.round((now - absent.since) / 1000)} s`);
                if (away) {
                    away.reported = Math.max(away.reported, 1); // un seul avertissement pour le même épisode
                }
            }
            this.metrics.status = "absent";
            return;
        }
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
        if (this.overdue(away, awayLimit, now)) {
            this.emit("look_away", `Tête tournée ${this._awayDir || "hors de l'écran"} pendant plus de ${Math.round(awayLimit / 1000)} s`);
        }
        this.metrics.status = dir ? "away" : "ok";
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
        this.video?.remove();
        this._episodes = {};
        this._failSince = null;
    }
}
