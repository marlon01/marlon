# -*- coding: utf-8 -*-
"""Liputa parametric pattern engine.

    from odoo.addons.liputa_couture.lib.pattern import draft
    result = draft("dress", {"bust": 96, "waist": 78, ...}, {"flare": 0.4})
    result["svg"], result["fabric"], result["pieces"]
"""
from . import blocks
from .blocks import rect
from .measures import FIELDS, complete, length_from_waist, shoulder_to_hem
from .render import fabric_estimate, render_svg, t as label

TEMPLATES = [
    ("dress", "Dress (bodice + skirt)"),
    ("kaba", "Kaba / long loose dress"),
    ("top", "Fitted top / blouse"),
    ("shirt", "Shirt (collar & cuffs)"),
    ("skirt", "Skirt"),
    ("wrap_skirt", "Wrap skirt (liputa / pagne)"),
    ("trousers", "Trousers"),
    ("boubou", "Grand boubou / agbada (T-cut)"),
    ("kaftan", "Kaftan / djellaba (T-cut, closed sides)"),
    ("tunic", "Tunic / dashiki"),
    ("ensemble", "Ensemble: tunic + trousers"),
    ("suit", "Suit / abacost (jacket + trousers)"),
]

SLEEVE_RATIOS = {"none": 0.0, "cap": 0.18, "short": 0.35, "three_quarter": 0.7, "long": 1.0}


def _opt(o, k, default):
    v = o.get(k)
    return default if v in (None, False, "") else v


def build_pieces(template, m, o):
    sleeve_ratio = SLEEVE_RATIOS.get(_opt(o, "sleeve_type", "short"), 0.35)
    eb, ew, eh = _opt(o, "ease_bust", None), _opt(o, "ease_waist", None), _opt(o, "ease_hip", None)
    flare = float(_opt(o, "flare", 0.0))
    length_type = _opt(o, "length_type", None)
    pieces = []
    if template in ("dress", "kaba"):
        loose = template == "kaba"
        pieces += blocks.bodice(m, ease_bust=eb or (14 if loose else 7), ease_waist=ew or (14 if loose else 5),
                                darts=not loose)
        pieces += blocks.skirt(m, length_from_waist(m, length_type or ("floor" if loose else "knee")),
                               ease_waist=ew or (14 if loose else 3), ease_hip=eh or (16 if loose else 4),
                               flare=flare or (0.6 if loose else 0.0), darts=not loose)
        pieces = [p for p in pieces if p.key != "waistband"]
        pieces += blocks.sleeve(m, sleeve_ratio, ease=8 if loose else 5, cap=0.55 if loose else 0.7)
    elif template == "top":
        pieces += blocks.bodice(m, ease_bust=eb or 8, ease_waist=ew or 8, ease_hip=eh or 8,
                                below_waist=m["hip_depth"])
        pieces += blocks.sleeve(m, sleeve_ratio)
    elif template == "shirt":
        pieces += blocks.bodice(m, ease_bust=eb or 12, ease_waist=ew or 16, ease_hip=eh or 10,
                                below_waist=m["hip_depth"] + 8, darts=False, front_opening=2.0,
                                back_on_fold=True)
        pieces += blocks.sleeve(m, SLEEVE_RATIOS.get(_opt(o, "sleeve_type", "long"), 1.0), ease=8, cap=0.5)
        pieces.append(rect("collar_stand", "collar_stand", m["neck"] + 4, 4.0, cut=2, fold_mark=False))
        pieces.append(rect("collar", "collar", m["neck"] + 4, 7.0, cut=2, fold_mark=False))
        if sleeve_ratio >= 0.9 or _opt(o, "sleeve_type", "long") == "long":
            pieces.append(rect("cuff", "cuff", m["wrist"] + 6, 12.0, cut=2))
    elif template == "skirt":
        pieces += blocks.skirt(m, length_from_waist(m, length_type or "knee"), flare=flare)
    elif template == "wrap_skirt":
        pieces += blocks.wrap_skirt(m, length_from_waist(m, length_type or "ankle"))
    elif template == "trousers":
        pieces += blocks.trousers(m, leg=_opt(o, "leg", "straight"))
    elif template in ("boubou", "kaftan", "tunic"):
        if template == "boubou":
            pieces += blocks.t_cut(m, shoulder_to_hem(m, length_type or "ankle"), reach=1.05,
                                   body_ease=eb or 40, neck=_opt(o, "neck", "round"),
                                   sleeve_open=m["bust"] / 10 + 30, side_open_from=m["bust"] / 10 + 34)
        elif template == "kaftan":
            pieces += blocks.t_cut(m, shoulder_to_hem(m, length_type or "ankle"), reach=0.9,
                                   body_ease=eb or 22, neck=_opt(o, "neck", "v"), flare=flare or 0.15)
        else:
            pieces += blocks.t_cut(m, m["back_waist_length"] + length_from_waist(m, length_type or "hip") + 8,
                                   reach=max(sleeve_ratio, 0.3) * 0.9, body_ease=eb or 18,
                                   neck=_opt(o, "neck", "v"), sleeve_open=m["bust"] / 10 + 8,
                                   embroidery=True)
    elif template == "ensemble":
        pieces += blocks.t_cut(m, m["back_waist_length"] + m["hip_depth"] + 14,
                               reach=max(sleeve_ratio, 0.3) * 0.9, body_ease=eb or 18,
                               neck=_opt(o, "neck", "round"), sleeve_open=m["bust"] / 10 + 8)
        pieces += blocks.trousers(m, leg=_opt(o, "leg", "straight"))
    elif template == "suit":
        pieces += blocks.bodice(m, ease_bust=eb or 10, ease_waist=ew or 10, ease_hip=eh or 8,
                                below_waist=m["hip_depth"] + 6, darts=True, bust_dart=False,
                                front_opening=7.0)
        pieces += blocks.sleeve(m, 1.0, ease=7, cap=0.72)
        pieces.append(rect("collar", "collar", m["neck"] / 2 + 6, 9.0, cut=2, fold_mark=False))
        pieces.append(rect("pocket", "pocket", 16.0, 18.0, cut=2, fold_mark=False))
        pieces += blocks.trousers(m, leg=_opt(o, "leg", "straight"))
    else:
        raise ValueError("Unknown pattern template: %s" % template)
    return pieces


def draft(template, measurements, options=None):
    o = options or {}
    m = complete(measurements, _opt(o, "gender", "women"))
    pieces = build_pieces(template, m, o)
    fabric = fabric_estimate(pieces, float(_opt(o, "fabric_width", 115.0)))
    meta = dict(_opt(o, "meta", {}) or {})
    meta.setdefault("fabric", fabric)
    svg = render_svg(pieces, meta=meta, lang=_opt(o, "lang", "en"))
    return {
        "svg": svg,
        "fabric": fabric,
        "measurements": m,
        "pieces": [{"key": p.key, "name": p.name, "label": label(_opt(o, "lang", "en"), p.name),
                    "cut": p.cut, "on_fold": p.on_fold} for p in pieces],
    }
