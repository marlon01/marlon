# -*- coding: utf-8 -*-
"""Parametric pattern blocks.

Every function receives a *completed* measurement dict (see measures.complete)
and returns a list of Piece objects, drafted in centimetres with the centre
front / centre back on x = 0 whenever the piece is cut on the fold.

These are algorithmic base blocks: they give a cuttable starting pattern that
the tailor validates on a toile (fitting) before cutting precious fabric.
"""
from .geometry import P, Path, offset_polyline
from .measures import armhole_depth, length_from_waist, shoulder_to_hem


class Piece:
    def __init__(self, key, name, outline, cut=1, on_fold=False, grain=None,
                 darts=None, marks=None, notches=None, seam=1.5, hem=None):
        self.key = key              # stable id ("front", "back"...)
        self.name = name            # i18n key for label
        self.outline = outline      # list[P] closed polygon (sewing line)
        self.cut = cut              # number of pieces to cut
        self.on_fold = on_fold      # True: x = 0 edge is placed on the fold
        self.grain = grain          # (P, P)
        self.darts = darts or []    # list[list[P]] polylines
        self.marks = marks or []    # list[(list[P], label)] internal lines
        self.notches = notches or []
        self.seam = seam            # seam allowance (cm)
        self.hem = hem              # hem allowance info (cm) for label


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------- bodice ----
def bodice(m, ease_bust=8.0, ease_waist=6.0, ease_hip=6.0, below_waist=0.0,
           darts=True, bust_dart=True, front_opening=0.0, back_on_fold=False):
    """Back + front bodice block.

    below_waist: extension under the waist (tops, shirts, jackets).
    front_opening: button / lapel extension (cm). >0 means front not on fold.
    """
    B = m["bust"] + ease_bust
    W = m["waist"] + ease_waist
    Hc = m["hip"] + ease_hip
    N, SW, BWL = m["neck"], m["shoulder_width"], m["back_waist_length"]
    qB, qW, qH = B / 4.0, W / 4.0, Hc / 4.0
    AD = armhole_depth(m)
    nw = N / 6.0 + 0.7
    nape_y = 2.0
    ua_y = nape_y + AD
    waist_y = nape_y + BWL
    diff = max(qB - qW, 0.0)
    side = min(diff * 0.5, 3.0) if darts else min(diff * 0.4, 2.0)
    dart_w = max(diff - side, 0.0) if darts else 0.0
    hip_y = waist_y + below_waist
    hip_x = max(qH, qB - side) if below_waist else None

    pieces = []
    # BACK -----------------------------------------------------------------
    hnp = P(nw, 0)
    sp = P(SW / 2.0 + 0.5, 4.5)
    bw = SW / 2.0 - 1.0
    mid = P(bw, nape_y + AD * 0.55)
    ua = P(qB, ua_y)
    cb_x_waist = 0.0 if back_on_fold or not darts else 1.0
    path = Path(P(0, nape_y)).cubic(P(nw * 0.55, nape_y), P(nw * 0.95, 1.0), hnp)
    path.line(sp)
    path.cubic(P(bw + 0.4, sp.y + (mid.y - sp.y) * 0.5), P(bw, mid.y - 2.0), mid)
    path.cubic(P(bw, mid.y + 4.0), P(bw + (qB - bw) * 0.3, ua_y - 0.4), ua)
    path.line(P(qB - side, waist_y))
    if below_waist:
        path.cubic(P(qB - side, waist_y + below_waist * 0.4),
                   P(hip_x, hip_y - below_waist * 0.4), P(hip_x, hip_y))
        path.line(P(0, hip_y))
    else:
        path.line(P(cb_x_waist, waist_y))
    back_darts = []
    if dart_w > 0.2:
        cx = (qB - side) / 2.0
        top = P(cx, ua_y + 2.0)
        if below_waist:
            back_darts.append([P(cx - dart_w / 2, waist_y), top, P(cx + dart_w / 2, waist_y),
                               P(cx, waist_y + min(12.0, below_waist - 2)),
                               P(cx - dart_w / 2, waist_y)])
        else:
            back_darts.append([P(cx - dart_w / 2, waist_y), top, P(cx + dart_w / 2, waist_y)])
    pieces.append(Piece(
        "back", "back_bodice", path.points, cut=1 if back_on_fold else 2,
        on_fold=back_on_fold, grain=(P(qB * 0.35, ua_y - 6), P(qB * 0.35, waist_y - 4)),
        darts=back_darts, notches=[mid],
        marks=[([P(0, waist_y), P(qB - side, waist_y)], "waist")] if below_waist else []))

    # FRONT ----------------------------------------------------------------
    ds = _clamp((m["bust"] - 84.0) / 8.0 + 2.5, 2.0, 7.0) if (darts and bust_dart) else 0.0
    nd = N / 6.0 + 2.0
    ext = front_opening
    fw = bw - 1.0
    sp_f = P(SW / 2.0, 5.0)
    mid_f = P(fw, nape_y + AD * 0.6)
    ua_f = P(qB, ua_y)
    fwaist_y = waist_y + ds
    fhip_y = fwaist_y + below_waist
    cf_x = -ext
    path = Path(P(cf_x, nd))
    if ext:
        path.line(P(0, nd))
    path.cubic(P(nw * 0.45, nd), P(nw, nd * 0.6), P(nw, 0))
    path.line(sp_f)
    path.cubic(P(fw + 0.3, sp_f.y + (mid_f.y - sp_f.y) * 0.5), P(fw, mid_f.y - 2.0), mid_f)
    path.cubic(P(fw, mid_f.y + 3.5), P(fw + (qB - fw) * 0.35, ua_y - 0.3), ua_f)
    front_darts = []
    bp = P(min(m["bust"] / 10.0 + 0.5, qB - 6.0), ua_y + 3.0)
    if ds:
        y1 = ua_y + 5.0
        y2 = y1 + ds
        path.line(P(qB, y1))
        path.line(P(qB, y2))
        front_darts.append([P(qB, y1), bp + P(2.0, 0), P(qB, y2)])
    path.line(P(qB - side, fwaist_y))
    if below_waist:
        path.cubic(P(qB - side, fwaist_y + below_waist * 0.4),
                   P(hip_x, fhip_y - below_waist * 0.4), P(hip_x, fhip_y))
        path.line(P(cf_x, fhip_y + 0.5))
    else:
        path.line(P(cf_x, fwaist_y + 0.5))
    if dart_w > 0.2:
        top = P(bp.x, bp.y + 2.0)
        if below_waist:
            front_darts.append([P(bp.x - dart_w / 2, fwaist_y), top, P(bp.x + dart_w / 2, fwaist_y),
                                P(bp.x, fwaist_y + min(10.0, below_waist - 2)),
                                P(bp.x - dart_w / 2, fwaist_y)])
        else:
            front_darts.append([P(bp.x - dart_w / 2, fwaist_y), top, P(bp.x + dart_w / 2, fwaist_y)])
    marks = []
    if ext:
        bottom = fhip_y if below_waist else fwaist_y
        marks.append(([P(0, nd), P(0, bottom)], "center_front"))
    pieces.append(Piece(
        "front", "front_bodice", path.points, cut=2 if ext else 1, on_fold=not ext,
        grain=(P(qB * 0.55, ua_y - 4), P(qB * 0.55, fwaist_y - 3)),
        darts=front_darts, notches=[mid_f], marks=marks))
    return pieces


# ---------------------------------------------------------------- sleeve ----
def sleeve(m, length_ratio=1.0, ease=5.0, cap=0.70, wide=1.0):
    if length_ratio <= 0:
        return []
    AD = armhole_depth(m)
    CH = AD * cap
    bw = (m["biceps"] + ease) * wide
    L = m["arm_length"] * length_ratio
    wrist_w = m["wrist"] + 8.0
    ww = bw - (bw - wrist_w) * _clamp(length_ratio, 0, 1) if wide <= 1.05 else bw * 0.95
    top = P(bw / 2.0, 0)
    path = Path(P(0, CH))
    path.cubic(P(bw * 0.16, CH * 0.92), P(bw * 0.28, 0), top)
    path.cubic(P(bw * 0.72, 0), P(bw * 0.86, CH * 0.85), P(bw, CH))
    path.line(P(bw / 2.0 + ww / 2.0, L))
    path.line(P(bw / 2.0 - ww / 2.0, L))
    return [Piece("sleeve", "sleeve", path.points, cut=2,
                  grain=(P(bw / 2, CH + 3), P(bw / 2, L - 5)),
                  marks=[([P(0, CH), P(bw, CH)], "biceps_line")],
                  notches=[top])]


# ----------------------------------------------------------------- skirt ----
def skirt(m, length, ease_waist=2.0, ease_hip=4.0, flare=0.0, darts=True, back_zip=True):
    W = m["waist"] + ease_waist
    Hh = m["hip"] + ease_hip
    HD = m["hip_depth"]
    pieces = []
    for key, name, dip, dart_len in (("skirt_front", "skirt_front", 0.5, 9.0),
                                     ("skirt_back", "skirt_back", 1.2, 12.0)):
        qW, qH = W / 4.0, Hh / 4.0
        diff = max(qH - qW, 0.0)
        dart = max(0.0, diff - 2.5) if darts else 0.0
        if flare > 0.25:            # flared / A-line: dart rotated into hem
            dart = 0.0
        side_w = P(qH - (diff - dart), -0.8)
        hip_side = P(qH, HD)
        hem_side = P(qH + flare * length * 0.40, length)
        hem_mid_y = length + (flare * 2.0)
        path = Path(P(0, dip))
        path.quad(P(side_w.x * 0.6, dip), side_w, 8)
        path.cubic(P(side_w.x + (qH - side_w.x) * 0.9, HD * 0.35), P(qH, HD * 0.75), hip_side)
        path.line(hem_side)
        path.quad(P(hem_side.x * 0.5, hem_mid_y), P(0, length), 10)
        ds = []
        if dart > 0.2:
            cx = qW / 2.0 + 1.0
            ds.append([P(cx - dart / 2, dip * 0.6), P(cx, dart_len), P(cx + dart / 2, dip * 0.6)])
        fold = not (key == "skirt_back" and back_zip)
        pieces.append(Piece(key, name, path.points, cut=1 if fold else 2, on_fold=fold,
                            grain=(P(qH * 0.5, HD + 4), P(qH * 0.5, length - 8)),
                            darts=ds, marks=[([P(0, HD), P(qH, HD)], "hip_line")],
                            hem=3.0))
    # waistband
    wb_len = W + 4.0
    pieces.append(Piece("waistband", "waistband",
                        [P(0, 0), P(wb_len, 0), P(wb_len, 8), P(0, 8)], cut=1,
                        grain=(P(5, 4), P(wb_len - 5, 4)),
                        marks=[([P(0, 4), P(wb_len, 4)], "fold_line")]))
    return pieces


# -------------------------------------------------------------- trousers ----
def trousers(m, ease_hip=6.0, ease_waist=2.0, length=None, leg="straight"):
    Hh = m["hip"] + ease_hip
    W = m["waist"] + ease_waist
    CD = max(m["outseam"] - m["inseam"], m["height"] * 0.15)
    HD = CD * 0.7
    L = length or m["outseam"]
    knee_y = CD + (L - CD) / 2.0 - 5.0
    hem_c = m["hem_width"] * (0.85 if leg == "slim" else (1.2 if leg == "wide" else 1.0))
    knee_c = max(m["knee"] + 8.0, hem_c + 2.0)
    pieces = []
    for key, name, width_adj, ext_ratio, wadj in (
            ("trouser_front", "trouser_front", -1.0, 1 / 16.0, -1.0),
            ("trouser_back", "trouser_back", 1.0, 1 / 8.5, 1.0)):
        ext = Hh * ext_ratio
        qH = Hh / 4.0 + width_adj
        qW = W / 4.0 + wadj
        side_x = ext + qH
        crease = side_x / 2.0
        kw = knee_c / 4.0 + (0.8 if key.endswith("back") else -0.8)
        hw = hem_c / 4.0 + (0.8 if key.endswith("back") else -0.8)
        dart = max(0.0, (qH - qW) - 1.5)
        if key.endswith("front"):
            cf_waist = P(ext + 1.0, 0)
            cf_hip = P(ext, HD)
        else:
            cf_waist = P(ext + 3.0, -2.5)
            cf_hip = P(ext + 0.5, HD)
        side_waist = P(cf_waist.x + qW + dart, 0 if key.endswith("front") else -0.5)
        path = Path(cf_waist).line(side_waist)
        path.cubic(P(side_x + 0.3, HD * 0.3), P(side_x, HD * 0.7), P(side_x, HD))
        path.line(P(side_x, CD))
        path.quad(P(crease + kw + 0.6, (CD + knee_y) / 2), P(crease + kw, knee_y), 8)
        path.line(P(crease + hw, L))
        path.line(P(crease - hw, L))
        path.line(P(crease - kw, knee_y))
        path.quad(P(crease - kw - 1.0, (CD + knee_y) / 2), P(0, CD), 8)
        path.cubic(P(ext * 0.55, CD + 0.3), P(ext, CD - 1.5), cf_hip)
        ds = []
        if dart > 0.3:
            cx = cf_waist.x + qW * 0.55
            ds.append([P(cx - dart / 2, side_waist.y * 0.5), P(cx, 9.0 if key.endswith("front") else 12.0),
                       P(cx + dart / 2, side_waist.y * 0.5)])
        pieces.append(Piece(key, name, path.points, cut=2,
                            grain=(P(crease, CD + 4), P(crease, L - 8)),
                            darts=ds, notches=[P(crease - kw, knee_y), P(crease + kw, knee_y)],
                            marks=[([P(0, CD), P(side_x, CD)], "crotch_line"),
                                   ([P(crease - kw, knee_y), P(crease + kw, knee_y)], "knee_line")],
                            hem=4.0))
    wb_len = W + 6.0
    pieces.append(Piece("waistband", "waistband",
                        [P(0, 0), P(wb_len, 0), P(wb_len, 9), P(0, 9)], cut=1,
                        grain=(P(5, 4.5), P(wb_len - 5, 4.5)),
                        marks=[([P(0, 4.5), P(wb_len, 4.5)], "fold_line")]))
    return pieces


# --------------------------------------------- T-cut (boubou / tunic) -------
def t_cut(m, length, reach=1.0, body_ease=24.0, neck="round", flare=0.0,
          sleeve_open=None, embroidery=True, side_open_from=None):
    """Kimono / T-cut garment used by grand boubou, kaftan, dashiki, agbada.

    reach: fraction of the arm covered by the sleeve (1.0 = wrist).
    side_open_from: for wide boubous, side seam is only sewn from this
    distance below the shoulder down to the hem (None = sewn from underarm).
    """
    SW, arm = m["shoulder_width"], m["arm_length"]
    half_span = min(SW / 2.0 + arm * reach, 80.0)
    AD = armhole_depth(m)
    so = sleeve_open or AD * 1.0
    body_half = (m["bust"] + body_ease) / 4.0
    hip_half = max((m["hip"] + body_ease) / 4.0, body_half)
    nw = m["neck"] / 6.0 + 1.5
    pieces = []
    for key, name, depth in (("tunic_front", "front_panel", None), ("tunic_back", "back_panel", 2.5)):
        if depth is None:
            depth = 14.0 if neck == "v" else m["neck"] / 6.0 + 3.0
        path = Path(P(0, depth))
        if neck == "v":
            path.line(P(nw, 0))
        else:
            path.cubic(P(nw * 0.5, depth), P(nw, depth * 0.55), P(nw, 0))
        path.line(P(half_span, 0))
        path.line(P(half_span, so))
        if side_open_from is None:
            ux = body_half
            path.line(P(ux + 6.0, so))
            path.quad(P(ux, so), P(ux, so + 8.0), 8)
            hem_x = hip_half + flare * length * 0.30
            path.line(P(hip_half, so + 8.0 + max(0.0, (length - so) * 0.45)))
            path.line(P(hem_x, length))
        else:
            path.line(P(half_span, length))
        path.line(P(0, length))
        marks = []
        if side_open_from is not None:
            marks.append(([P(body_half + 10.0, side_open_from), P(body_half + 10.0, length - 6.0)],
                          "side_stitching"))
            marks.append(([P(body_half + 10.0, side_open_from + 6), P(body_half + 10.0, side_open_from + 24)],
                          "pocket_opening"))
        if embroidery and key == "tunic_front":
            zone = Path(P(0, depth + 26.0)).line(P(nw + 9.0, depth + 26.0)).line(P(nw + 9.0, 0)).points
            marks.append((zone, "embroidery_zone"))
        pieces.append(Piece(key, name, path.points, cut=1, on_fold=True,
                            grain=(P(nw + 4, depth + 30), P(nw + 4, length - 10)),
                            marks=marks, notches=[P(half_span, so)], hem=3.0))
    # neck facing (front)
    depth = 14.0 if neck == "v" else m["neck"] / 6.0 + 3.0
    inner = Path(P(0, depth))
    if neck == "v":
        inner.line(P(nw, 0))
    else:
        inner.cubic(P(nw * 0.5, depth), P(nw, depth * 0.55), P(nw, 0))
    pts = inner.points
    outer = offset_polyline(pts, -6.0)
    outer[0] = P(0, outer[0].y)
    facing = pts + [P(outer[-1].x, 0)] + list(reversed(outer))[:-1] + [P(0, outer[0].y)]
    pieces.append(Piece("facing", "neck_facing", facing, cut=1, on_fold=True,
                        grain=(P(2.0, depth + 1.5), P(2.0, depth + 5.0))))
    return pieces


# ------------------------------------------------- wrap skirt (liputa) ------
def wrap_skirt(m, length):
    width = (m["hip"] + 6.0) * 1.55
    panel = [P(0, 0), P(width, 0), P(width + 2.0, length), P(-2.0, length)]
    tie = m["waist"] * 0.8 + 60.0
    return [
        Piece("wrap_panel", "wrap_panel", panel, cut=1,
              grain=(P(width / 2, 10), P(width / 2, length - 10)),
              marks=[([P(width * 0.62, 0), P(width * 0.62, length)], "overlap_line")], hem=3.0),
        Piece("tie_band", "tie_band", [P(0, 0), P(tie, 0), P(tie, 9), P(0, 9)], cut=2,
              grain=(P(5, 4.5), P(tie - 5, 4.5)),
              marks=[([P(0, 4.5), P(tie, 4.5)], "fold_line")]),
    ]


def rect(key, name, w, h, cut=2, fold_mark=True):
    marks = [([P(0, h / 2.0), P(w, h / 2.0)], "fold_line")] if fold_mark else []
    return Piece(key, name, [P(0, 0), P(w, 0), P(w, h), P(0, h)], cut=cut,
                 grain=(P(3, h / 2.0 - 1), P(w - 3, h / 2.0 - 1)), marks=marks)
