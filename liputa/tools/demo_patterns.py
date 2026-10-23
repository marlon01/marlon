#!/usr/bin/env python3
"""Standalone demo / regression test of the Liputa pattern engine.

Runs without Odoo:  python3 tools/demo_patterns.py [output_dir]
Generates one 1:1 SVG per template for a sample client.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "liputa_couture", "lib", "pattern")

spec = importlib.util.spec_from_file_location("pattern", os.path.join(PKG, "__init__.py"),
                                              submodule_search_locations=[PKG])
pattern = importlib.util.module_from_spec(spec)
sys.modules["pattern"] = pattern
spec.loader.exec_module(pattern)

CLIENT_F = {"height": 168, "bust": 98, "waist": 80, "hip": 108, "neck": 36,
            "shoulder_width": 40, "back_waist_length": 41, "arm_length": 59}
CLIENT_M = {"height": 180, "bust": 102, "waist": 88, "hip": 100, "neck": 40,
            "shoulder_width": 46, "back_waist_length": 45, "arm_length": 63,
            "inseam": 81, "outseam": 108}

CASES = [
    ("dress", CLIENT_F, {"gender": "women", "flare": 0.35, "sleeve_type": "short"}),
    ("kaba", CLIENT_F, {"gender": "women", "sleeve_type": "three_quarter"}),
    ("top", CLIENT_F, {"gender": "women", "sleeve_type": "cap"}),
    ("shirt", CLIENT_M, {"gender": "men"}),
    ("skirt", CLIENT_F, {"gender": "women", "length_type": "midi"}),
    ("wrap_skirt", CLIENT_F, {"gender": "women"}),
    ("trousers", CLIENT_M, {"gender": "men"}),
    ("boubou", CLIENT_M, {"gender": "men"}),
    ("kaftan", CLIENT_F, {"gender": "women"}),
    ("tunic", CLIENT_M, {"gender": "men", "sleeve_type": "short"}),
    ("ensemble", CLIENT_M, {"gender": "men", "sleeve_type": "long"}),
    ("suit", CLIENT_M, {"gender": "men"}),
]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "demo_out")
    os.makedirs(out_dir, exist_ok=True)
    for template, m, opts in CASES:
        opts = dict(opts, lang="fr", meta={"title": "Modele : %s" % template,
                                           "subtitle": "Cliente demo - CMD/2026/0001",
                                           "reference": "CMD/2026/0001"})
        res = pattern.draft(template, m, opts)
        path = os.path.join(out_dir, "%s.svg" % template)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(res["svg"])
        f = res["fabric"]
        print("%-11s pieces=%-2d fabric=%.2fm (%.1f yd, %.2f complet wax)  -> %s"
              % (template, len(res["pieces"]), f["metres"], f["yards"], f["wax_pieces_6y"], path))


if __name__ == "__main__":
    main()
