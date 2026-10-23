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
    .venv-voix/bin/python tools/voix_off.py texte.txt -o voix.wav --voix upmc-jessica --vitesse 0.9

Voix et licences (à créditer au générique quand la licence le demande) :
    siwis          voix de femme, jeu de données SIWIS, CC-BY 4.0
    upmc-jessica   voix de femme, jeu de données UPMC, CC-BY-SA 4.0
    upmc-pierre    voix d'homme,  jeu de données UPMC, CC-BY-SA 4.0
"""
import argparse
import json
import pathlib
import tarfile
import urllib.request

import numpy as np
import sherpa_onnx
import soundfile as sf

RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"
CACHE = pathlib.Path.home() / ".cache" / "marlon-voix"
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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("texte", help="fichier texte : une phrase par ligne, ligne vide = pause longue")
    parser.add_argument("-o", "--sortie", required=True, help="fichier WAV produit")
    parser.add_argument("--voix", choices=sorted(VOICES), default="upmc-jessica")
    parser.add_argument("--vitesse", type=float, default=0.9, help="1 = vitesse du modèle, < 1 = plus lent")
    parser.add_argument("--pause", type=float, default=0.35, help="silence entre deux phrases (s)")
    parser.add_argument("--pause-longue", type=float, default=0.8, help="silence d'une ligne vide (s)")
    args = parser.parse_args()

    name, speaker = VOICES[args.voix]
    folder = model_dir(name)
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(folder / f"{name}.onnx"), tokens=str(folder / "tokens.txt"),
                data_dir=str(folder / "espeak-ng-data")),
            num_threads=4),
    ))

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
        audio = tts.generate(line, sid=speaker, speed=args.vitesse)  # sherpa-onnx : > 1 accélère
        samples = np.asarray(audio.samples, dtype=np.float32)
        chunks.append(samples)
        duration = len(samples) / rate
        timings.append({"texte": line, "debut": round(t, 3), "fin": round(t + duration, 3)})
        t += duration

    out = pathlib.Path(args.sortie)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, np.concatenate(chunks), rate)
    meta = {"voix": args.voix, "modele": name, "vitesse": args.vitesse, "duree": round(t, 3),
            "phrases": timings}
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    words = sum(len(x["texte"].split()) for x in timings)
    print(f"{out} : {t:.1f} s, {words} mots, {words / t * 60:.0f} mots/min")


if __name__ == "__main__":
    main()
