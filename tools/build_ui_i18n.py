#!/usr/bin/env python3
"""Génère les dictionnaires de l'interface bilingue de SELECTA.

Source : addons/<module>/i18n_ui/en.json (texte français affiché → traduction anglaise).
Sorties :
  * selecta_concours/static/src/common/i18n_dict.js  — module OWL (console, espace candidat, connexion)
  * selecta_saas/static/src/i18n/i18n_dict_saas.js    — module OWL (inscription, abonnement, plateforme)
  * selecta_saas/static/src/public/selecta_i18n.js    — script autonome des pages rendues par le serveur
    (présentation, documents juridiques) : moteur + les deux dictionnaires.
  * selecta_concours/static/src/public/selecta_i18n_core.js — idem pour la page de vérification.

Usage : python3 tools/build_ui_i18n.py   (à relancer après toute modification d'un en.json)
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent / "addons"
HEADER = "/** @odoo-module */\n// Fichier généré par tools/build_ui_i18n.py depuis %s : ne pas modifier à la main.\n"


def load(module):
    return json.loads((ROOT / module / "i18n_ui" / "en.json").read_text(encoding="utf-8"))


def dump(data):
    return json.dumps(data, ensure_ascii=False, indent=0, sort_keys=True)


core, saas = load("selecta_concours"), load("selecta_saas")
(ROOT / "selecta_concours/static/src/common/i18n_dict.js").write_text(
    HEADER % "selecta_concours/i18n_ui/en.json"
    + 'import { register } from "@selecta_concours/common/i18n";\n\nregister(%s);\n' % dump(core), encoding="utf-8")
(ROOT / "selecta_saas/static/src/i18n/i18n_dict_saas.js").write_text(
    HEADER % "selecta_saas/i18n_ui/en.json"
    + 'import { register } from "@selecta_concours/common/i18n";\n\nregister(%s);\n' % dump(saas), encoding="utf-8")

engine = (ROOT / "selecta_concours/static/src/common/i18n.js").read_text(encoding="utf-8")
engine = engine.replace("/** @odoo-module */\n", "")
engine = re.sub(r"^export ", "", engine, flags=re.M)
public = ("// Fichier généré par tools/build_ui_i18n.py : ne pas modifier à la main.\n"
          "// Interface bilingue des pages SELECTA rendues par le serveur (moteur + dictionnaires).\n"
          "(function () {\n%s\nregister(%s);\nregister(%s);\n})();\n") % (engine, dump(core), dump(saas))
out = ROOT / "selecta_saas/static/src/public/selecta_i18n.js"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(public, encoding="utf-8")
# Page publique de vérification du module principal (sans dépendre du module SaaS).
core_public = ("// Fichier généré par tools/build_ui_i18n.py : ne pas modifier à la main.\n"
               "(function () {\n%s\nregister(%s);\n})();\n") % (engine, dump(core))
out = ROOT / "selecta_concours/static/src/public/selecta_i18n_core.js"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(core_public, encoding="utf-8")
print("Dictionnaires générés :", len(core), "+", len(saas), "entrées")
