// Tests du surveillant IA hors navigateur : node --test addons/selecta_concours/static/tests/
// Les images de la caméra sont simulées par leurs mesures (visages, orientation, luminosité).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.document = { createElement: () => ({ getContext: () => null }) };
const src = readFileSync(new URL("../src/exam/proctor.js", import.meta.url), "utf8").replace(
    /^import .*i18n";$/m,
    'const locale = () => "fr-FR";'
);
const file = join(mkdtempSync(join(tmpdir(), "proctor-")), "proctor.mjs");
writeFileSync(file, src);
const { Proctor } = await import(file);

const CFG = { face_absent_seconds: 5, look_away_seconds: 4 };
const FRONT = { faces: 1, present: 1, strongFaces: 1, yaw: 0, pitch: 0.45, brightness: 120 };
const NONE = { faces: 0, present: 0, strongFaces: 0, yaw: null, pitch: null, brightness: 120 };
const TURNED = { ...FRONT, yaw: 0.16 };

function run(frames, setup) {
    const events = [];
    const p = new Proctor({ config: CFG, onEvent: (type, details) => events.push([type, details]) });
    p.snapshot = () => null;
    setup?.(p);
    let t = 1_000_000;
    for (const m of frames) {
        p._cooldown = {}; // l'anti-rafale de 4 s est testé à part : on observe ici la logique seule
        p.evaluate({ ...m }, CFG, t);
        t += 450; // cadence réelle de la boucle
    }
    return events.map((e) => e[0]);
}
const repeat = (m, seconds) => Array(Math.round((seconds * 1000) / 450)).fill(m);

test("absence de visage détectée malgré une fausse détection isolée", () => {
    const frames = [...repeat(FRONT, 2), ...repeat(NONE, 3), FRONT, ...repeat(NONE, 3)];
    assert.deepEqual(run(frames), ["face_absent"]);
});

test("tête tournée dont le visage disparaît par moments : un regard détourné, pas une absence", () => {
    const frames = [...repeat(FRONT, 2)];
    for (let i = 0; i < 6; i++) {
        frames.push(TURNED, TURNED, NONE);
    }
    assert.deepEqual(run(frames), ["look_away"]);
});

test("rotation modérée (0,16) signalée : l'ancien seuil absolu de 0,2 la laissait passer", () => {
    assert.deepEqual(run([...repeat(FRONT, 1), ...repeat(TURNED, 5)]), ["look_away"]);
});

test("regard vers le bas prolongé (lecture sur les genoux)", () => {
    assert.deepEqual(run([...repeat(FRONT, 1), ...repeat({ ...FRONT, pitch: 0.66 }, 5)]), ["look_away"]);
});

test("caméra décalée : la pose apprise sert de référence", () => {
    const offset = { ...FRONT, yaw: 0.15 };
    const learn = (p) => {
        for (let i = 0; i < 5; i++) p.learnPose(offset);
    };
    assert.deepEqual(run(repeat(offset, 8), learn), [], "regarder l'écran depuis une caméra décalée est normal");
    assert.deepEqual(run(repeat(FRONT, 8), learn), ["look_away"], "écart de 0,15 par rapport à la pose apprise");
});

test("candidat attentif, mesures bruitées : aucun incident", () => {
    const noisy = Array.from({ length: 60 }, (_, i) => ({ ...FRONT, yaw: (i % 5) * 0.02 - 0.04, pitch: 0.45 + (i % 3) * 0.03 }));
    assert.deepEqual(run(noisy), []);
});

test("brefs coups d'œil (< 4 s) tolérés", () => {
    const frames = [];
    for (let i = 0; i < 5; i++) frames.push(...repeat(TURNED, 2), ...repeat(FRONT, 2));
    assert.deepEqual(run(frames), []);
});

test("départ du poste : une seule absence, pas de regard détourné en plus", () => {
    const frames = [...repeat(FRONT, 1), ...repeat(TURNED, 2), ...repeat(NONE, 7)];
    assert.deepEqual(run(frames), ["face_absent"]);
});

test("absence qui dure : rappel tous les trois délais", () => {
    assert.deepEqual(run(repeat(NONE, 31)), ["face_absent", "face_absent", "face_absent"]);
});

test("visage minuscule à l'arrière-plan : ne prouve pas la présence", () => {
    const poster = { faces: 1, present: 0, strongFaces: 1, yaw: null, pitch: null, brightness: 120 };
    assert.deepEqual(run(repeat(poster, 6)), ["face_absent"]);
});

test("vidéo figée : plus analysée au-delà de 1,5 s", () => {
    const p = new Proctor({ config: CFG });
    p.video = { readyState: 4, paused: false, currentTime: 3.2 };
    assert.equal(p.videoAlive(), true);
    p._lastTimeAt -= 2000;
    assert.equal(p.videoAlive(), false);
    p.video.currentTime = 3.6;
    assert.equal(p.videoAlive(), true);
});
