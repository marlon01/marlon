#!/usr/bin/env python3
"""Voix off française hors ligne pour les films (sherpa-onnx + voix Piper).

Les voix sont téléchargées une fois depuis les publications GitHub du dépôt k2-fsa/sherpa-onnx
(Hugging Face n'est pas nécessaire) et rangées dans ~/.cache/marlon-voix.

Le texte est lu phrase par phrase : une ligne du fichier = une phrase, une ligne vide = une pause
longue. Le script écrit le WAV et, à côté, un JSON des temps de chaque phrase (début et fin en
secondes), qui sert d'horloge au montage.

Installation (une fois) :
    python3 -m venv .venv-voix && .venv-voix/bin/pip install sherpa-onnx soundfile numpy

Usage :
    .venv-voix/bin/python tools/voix_off.py texte.txt -o voix.wav --voix siwis --vitesse 0.88 \
        --prises 4 --verifier --phrases assets/audio/phrases

Les voix Piper varient d'un tirage à l'autre. Avec --prises N et --verifier, chaque phrase est
générée N fois puis retranscrite par Whisper (small, multilingue, publié sur le même dépôt GitHub) ;
la prise la plus proche du texte est gardée. --phrases écrit aussi chaque phrase dans son propre
fichier (01.wav, 02.wav…) pour la poser librement sur la ligne de temps du film.

Prononciation : le LEXIQUE ci-dessous réécrit les mots que la voix lit mal (« Kinshasa » était lu
« kɛ̃ʃaza ») avant la synthèse ; les textes gardent l'orthographe normale et la vérification compare
à cette orthographe. Pour contrôler un mot : phonemizer + espeak-ng (voir CLAUDE.md).

Dialogues : une ligne qui commence par [upmc-jessica], [upmc-pierre] ou [siwis] est lue par cette
voix ; les autres par --voix.

Voix et licences (à créditer au générique quand la licence le demande) :
    siwis          voix de femme, jeu de données SIWIS, CC-BY 4.0
    upmc-jessica   voix de femme, jeu de données UPMC, CC-BY-SA 4.0
    upmc-pierre    voix d'homme,  jeu de données UPMC, CC-BY-SA 4.0
"""
import argparse
import difflib
import json
import pathlib
import re
import tarfile
import urllib.request

import numpy as np
import sherpa_onnx
import soundfile as sf

RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"
CACHE = pathlib.Path.home() / ".cache" / "marlon-voix"
LEXIQUE = {  # orthographe → graphie que la voix prononce juste (vérifiée en phonèmes espeak-ng)
    "Kinshasa": "Kinnchassa",  # kinʃasa (et non kɛ̃ʃaza)
    "Liputa": "Lipouta",       # liputa
    "LIPUTA": "Lipouta",
    "SELECTA": "Sélecta",      # selɛkta
    "Selecta": "Sélecta",
    "QR": "Q R",
}


def prononcer(text):
    for word, spoken in LEXIQUE.items():
        text = re.sub(rf"(?<!\w){re.escape(word)}(?!\w)", spoken, text)
    return text


VOICES = {
    "siwis": ("fr_FR-siwis-medium", 0),
    "upmc-jessica": ("fr_FR-upmc-medium", 0),
    "upmc-pierre": ("fr_FR-upmc-medium", 1),
}


def model_dir(name):
    folder = CACHE / f"vits-piper-{name}"
    if not (folder / f"{name}.onnx").exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        archive = CACHE / f"vits-piper-{name}.tar.bz2"
        print("Téléchargement de la voix", name, "…")
        urllib.request.urlretrieve(RELEASE + archive.name, archive)
        with tarfile.open(archive) as tar:
            tar.extractall(CACHE, filter="data")
        archive.unlink()
    return folder


WHISPER = "sherpa-onnx-whisper-small"


def asr_model():
    folder = CACHE / WHISPER
    if not (folder / "small-encoder.int8.onnx").exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        archive = CACHE / f"{WHISPER}.tar.bz2"
        print("Téléchargement de Whisper small (vérification) …")
        urllib.request.urlretrieve(
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + archive.name, archive)
        with tarfile.open(archive) as tar:
            tar.extractall(CACHE, filter="data")
        archive.unlink()
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(folder / "small-encoder.int8.onnx"), decoder=str(folder / "small-decoder.int8.onnx"),
        tokens=str(folder / "small-tokens.txt"), language="fr", task="transcribe", num_threads=4)


def words(text):
    return re.sub(r"[^\w' ]", " ", text.lower().replace("’", "'")).split()


def distance(reference, heard):
    """Nombre de mots du texte manqués ou déformés à l'écoute."""
    matcher = difflib.SequenceMatcher(a=words(reference), b=words(heard))
    return sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in matcher.get_opcodes() if op != "equal")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("texte", help="fichier texte : une phrase par ligne, ligne vide = pause longue")
    parser.add_argument("-o", "--sortie", required=True, help="fichier WAV produit")
    parser.add_argument("--voix", choices=sorted(VOICES), default="upmc-jessica")
    parser.add_argument("--vitesse", type=float, default=0.9, help="1 = vitesse du modèle, < 1 = plus lent")
    parser.add_argument("--pause", type=float, default=0.35, help="silence entre deux phrases (s)")
    parser.add_argument("--pause-longue", type=float, default=0.8, help="silence d'une ligne vide (s)")
    parser.add_argument("--prises", type=int, default=1, help="nombre de prises générées par phrase")
    parser.add_argument("--verifier", action="store_true",
                        help="retranscrire chaque prise avec Whisper et garder la mieux prononcée")
    parser.add_argument("--phrases", help="dossier où écrire aussi chaque phrase dans son fichier")
    args = parser.parse_args()

    engines = {}

    def engine(voice):
        name, speaker = VOICES[voice]
        if name not in engines:
            folder = model_dir(name)
            engines[name] = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                        model=str(folder / f"{name}.onnx"), tokens=str(folder / "tokens.txt"),
                        data_dir=str(folder / "espeak-ng-data")),
                    num_threads=4),
            ))
        return engines[name], speaker

    tts, _ = engine(args.voix)

    recognizer = asr_model() if args.verifier else None

    def take(line, voice):
        model, speaker = engine(voice)
        audio = model.generate(prononcer(line), sid=speaker, speed=args.vitesse)  # sherpa-onnx : > 1 accélère
        samples = np.asarray(audio.samples, dtype=np.float32)
        if model.sample_rate != tts.sample_rate:
            idx = np.linspace(0, len(samples) - 1, int(len(samples) * tts.sample_rate / model.sample_rate))
            samples = np.interp(idx, np.arange(len(samples)), samples).astype(np.float32)
        if not recognizer:
            return samples, None
        stream = recognizer.create_stream()
        stream.accept_waveform(tts.sample_rate, samples)
        recognizer.decode_stream(stream)
        return samples, stream.result.text.strip()

    lines = pathlib.Path(args.texte).read_text(encoding="utf-8").splitlines()
    rate = tts.sample_rate
    chunks, timings, t = [], [], 0.0
    pending_pause = 0.0
    for line in lines:
        line = line.strip()
        if not line:
            pending_pause = args.pause_longue
            continue
        if chunks:
            gap = max(pending_pause, args.pause)
            chunks.append(np.zeros(int(gap * rate), dtype=np.float32))
            t += gap
        pending_pause = 0.0
        voice = args.voix
        tag = re.match(r"\[([\w-]+)\]\s*", line)
        if tag and tag.group(1) in VOICES:
            voice, line = tag.group(1), line[tag.end():]
        takes = [take(line, voice) for _ in range(max(1, args.prises))]
        samples, heard = min(takes, key=lambda x: distance(line, x[1]) if x[1] is not None else 0)
        chunks.append(samples)
        duration = len(samples) / rate
        entry = {"texte": line, "voix": voice, "debut": round(t, 3), "fin": round(t + duration, 3)}
        if heard is not None:
            entry.update(entendu=heard, ecarts=distance(line, heard))
        if args.phrases:
            folder_out = pathlib.Path(args.phrases)
            folder_out.mkdir(parents=True, exist_ok=True)
            entry["fichier"] = str(folder_out / f"{len(timings) + 1:02d}.wav")
            sf.write(entry["fichier"], samples, rate)
        timings.append(entry)
        t += duration

    out = pathlib.Path(args.sortie)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, np.concatenate(chunks), rate)
    meta = {"voix": args.voix, "modele": VOICES[args.voix][0], "vitesse": args.vitesse, "duree": round(t, 3),
            "phrases": timings}
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    words = sum(len(x["texte"].split()) for x in timings)
    print(f"{out} : {t:.1f} s, {words} mots, {words / t * 60:.0f} mots/min")


if __name__ == "__main__":
    main()
