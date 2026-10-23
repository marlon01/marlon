# -*- coding: utf-8 -*-
"""Body measurements: canonical keys, completion of missing values and
garment length helpers. Units: centimetres.

Proportions are anthropometric averages used ONLY to fill gaps; any value
taken by the tailor always wins.
"""

FIELDS = [
    "height", "neck", "shoulder_width", "bust", "under_bust", "waist", "hip",
    "back_waist_length", "front_waist_length", "arm_length", "biceps",
    "wrist", "hip_depth", "thigh", "knee", "hem_width", "inseam", "outseam",
    "skirt_length", "dress_length",
]

LENGTH_RATIOS = {          # waist -> hem, as a fraction of total height
    "hip": None,           # uses hip_depth + 3
    "knee": 0.355,
    "midi": 0.45,
    "ankle": 0.58,
    "floor": 0.62,
}


def complete(m, gender="women"):
    """Return a full measurement dict, filling missing keys from height/bust."""
    m = {k: float(v) for k, v in (m or {}).items() if v not in (None, False, 0, "")}
    men = gender == "men"
    child = gender == "child"
    H = m.get("height") or (176.0 if men else (120.0 if child else 164.0))
    m["height"] = H
    bust = m.get("bust") or H * (0.56 if not child else 0.52)
    m["bust"] = bust
    m.setdefault("waist", bust * (0.88 if men else (0.92 if child else 0.78)))
    m.setdefault("hip", bust * (0.98 if men else (1.0 if child else 1.06)))
    m.setdefault("under_bust", bust * 0.86)
    m.setdefault("neck", bust * (0.40 if men else 0.38))
    m.setdefault("shoulder_width", H * (0.25 if men else 0.24))
    m.setdefault("back_waist_length", H * 0.25)
    m.setdefault("front_waist_length", m["back_waist_length"] + 2.0)
    m.setdefault("arm_length", H * 0.355)
    m.setdefault("biceps", bust * 0.30)
    m.setdefault("wrist", H * 0.095)
    m.setdefault("hip_depth", H * 0.125)
    m.setdefault("thigh", m["hip"] * 0.58)
    m.setdefault("knee", m["hip"] * 0.38)
    m.setdefault("hem_width", 44.0 if men else 40.0)
    m.setdefault("inseam", H * (0.46 if men else 0.45))
    m.setdefault("outseam", m["inseam"] + H * 0.165)
    return m


def length_from_waist(m, length_type="knee"):
    """Garment length measured from natural waist to hem."""
    if length_type == "hip":
        return m["hip_depth"] + 3.0
    if m.get("skirt_length") and length_type in ("knee", "midi"):
        return m["skirt_length"]
    if m.get("dress_length") and length_type in ("ankle", "floor"):
        return m["dress_length"] - m["back_waist_length"]
    return m["height"] * LENGTH_RATIOS.get(length_type, 0.355)


def shoulder_to_hem(m, length_type="ankle"):
    """Length from shoulder/neck point to hem (used by T-cut garments)."""
    if m.get("dress_length"):
        return m["dress_length"]
    return m["back_waist_length"] + length_from_waist(m, length_type)


def armhole_depth(m):
    """Nape to underarm line."""
    return m["bust"] / 10.0 + 11.0
