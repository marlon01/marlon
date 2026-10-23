# -*- coding: utf-8 -*-
"""SVG rendering (scale 1:1, millimetre units) and fabric consumption."""
import math
from xml.sax.saxutils import escape

from .geometry import P, bbox, offset_polygon, dedupe

MM = 10.0  # cm -> mm

LABELS = {
    "en": {
        "back_bodice": "Back bodice", "front_bodice": "Front bodice", "sleeve": "Sleeve",
        "skirt_front": "Skirt front", "skirt_back": "Skirt back", "waistband": "Waistband",
        "trouser_front": "Trouser front", "trouser_back": "Trouser back",
        "front_panel": "Front panel", "back_panel": "Back panel", "neck_facing": "Neck facing",
        "wrap_panel": "Wrap panel", "tie_band": "Tie band", "collar": "Collar",
        "collar_stand": "Collar stand", "cuff": "Cuff", "pocket": "Pocket", "lapel_facing": "Lapel facing",
        "cut": "CUT", "on_fold": "PLACE ON FOLD", "grain": "GRAIN", "seam": "Seam allowance",
        "included": "included", "scale": "Scale 1:1 - check: this square must measure 10 x 10 cm",
        "fabric": "Fabric", "width": "width", "approx": "approx.", "yards": "yards",
        "waist": "waist", "hip_line": "hip line", "biceps_line": "biceps line",
        "center_front": "centre front", "fold_line": "fold line", "crotch_line": "crotch line",
        "knee_line": "knee line", "side_stitching": "side stitching", "pocket_opening": "pocket",
        "embroidery_zone": "embroidery zone", "overlap_line": "overlap", "hem": "Hem",
        "disclaimer": "Algorithmic base pattern - validate with a toile fitting before cutting.",
    },
    "fr": {
        "back_bodice": "Dos corsage", "front_bodice": "Devant corsage", "sleeve": "Manche",
        "skirt_front": "Devant jupe", "skirt_back": "Dos jupe", "waistband": "Ceinture",
        "trouser_front": "Devant pantalon", "trouser_back": "Dos pantalon",
        "front_panel": "Panneau devant", "back_panel": "Panneau dos", "neck_facing": "Parementure encolure",
        "wrap_panel": "Panneau portefeuille", "tie_band": "Lien", "collar": "Col",
        "collar_stand": "Pied de col", "cuff": "Poignet", "pocket": "Poche", "lapel_facing": "Parementure revers",
        "cut": "COUPER", "on_fold": "SUR LA PLIURE", "grain": "DROIT FIL", "seam": "Valeur de couture",
        "included": "incluse", "scale": "Echelle 1:1 - controle : ce carre doit mesurer 10 x 10 cm",
        "fabric": "Tissu", "width": "laize", "approx": "env.", "yards": "yards",
        "waist": "taille", "hip_line": "ligne de hanches", "biceps_line": "ligne de carrure bras",
        "center_front": "milieu devant", "fold_line": "ligne de pliure", "crotch_line": "ligne d'enfourchure",
        "knee_line": "ligne du genou", "side_stitching": "couture cote", "pocket_opening": "poche",
        "embroidery_zone": "zone de broderie", "overlap_line": "croisure", "hem": "Ourlet",
        "disclaimer": "Patron de base algorithmique - valider par un essayage toile avant la coupe.",
    },
}

PALETTE = ["#F6E7C8", "#E3EED9", "#F4DCD3", "#DCE6F2", "#EFE0F0", "#E8E8D0"]


def t(lang, key):
    base = (lang or "en").split("_")[0]
    return LABELS.get(base, LABELS["en"]).get(key, LABELS["en"].get(key, key))


def _cut_outline(piece):
    out = offset_polygon(piece.outline, piece.seam)
    if piece.on_fold:  # no seam allowance on the fold edge (x = min x)
        minx = min(p.x for p in piece.outline)
        out = [P(max(p.x, minx), p.y) for p in out]
    return out


def _d(pts, close=True, ox=0.0, oy=0.0):
    pts = dedupe(pts) if close else pts
    s = "M" + " L".join("%.1f,%.1f" % ((p.x + ox) * MM, (p.y + oy) * MM) for p in pts)
    return s + (" Z" if close else "")


def fabric_estimate(pieces, fabric_width=115.0, waste=1.10):
    """Shelf-packing estimate of fabric length (cm) for a given width."""
    rects = []
    for pc in pieces:
        x0, y0, x1, y1 = bbox(_cut_outline(pc))
        w, h = x1 - x0, y1 - y0
        if pc.on_fold:
            w *= 2.0
        for _ in range(pc.cut):
            if w > fabric_width and h <= fabric_width:
                w, h = h, w
            rects.append((w, h))
    rects.sort(key=lambda r: r[1], reverse=True)
    total, row_w, row_h = 0.0, 0.0, 0.0
    for w, h in rects:
        if row_w + w > fabric_width and row_w > 0:
            total += row_h
            row_w, row_h = 0.0, 0.0
        row_w += w
        row_h = max(row_h, h)
    total += row_h
    metres = total * waste / 100.0
    return {
        "fabric_width_cm": fabric_width,
        "metres": round(metres, 2),
        "yards": round(metres / 0.9144, 1),
        # wax-print is sold by 6-yard "complet" / 3-yard "demi-piece"
        "wax_pieces_6y": round(metres / 0.9144 / 6.0, 2),
    }


def render_svg(pieces, meta=None, lang="en", max_row=140.0, gap=6.0, margin=3.0):
    """Return an SVG document (1:1) with every piece laid out in rows."""
    meta = meta or {}
    title_h = 22.0
    placements = []
    x, y, row_h = margin, margin + title_h, 0.0
    for pc in pieces:
        cut = _cut_outline(pc)
        x0, y0, x1, y1 = bbox(cut)
        w, h = x1 - x0, y1 - y0
        if x + w > max_row + margin and x > margin:
            x = margin
            y += row_h + gap
            row_h = 0.0
        placements.append((pc, cut, x - x0, y - y0, (x, y, w, h)))
        x += w + gap
        row_h = max(row_h, h)
    width = max(max_row + 2 * margin, max(p[4][0] + p[4][2] for p in placements) + margin)
    height = y + row_h + margin

    out = []
    out.append('<svg xmlns="http://www.w3.org/2000/svg" width="%.0fmm" height="%.0fmm" '
               'viewBox="0 0 %.0f %.0f" font-family="Helvetica, Arial, sans-serif">'
               % (width * MM, height * MM, width * MM, height * MM))
    out.append('<defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" '
               'markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" '
               'fill="#1b1b1b"/></marker></defs>')
    out.append('<rect width="100%" height="100%" fill="#ffffff"/>')

    # title block + calibration square
    tx, ty = margin * MM, margin * MM
    out.append('<rect x="%.0f" y="%.0f" width="100" height="100" fill="none" stroke="#C4502A" '
               'stroke-width="1.2"/>' % (tx, ty))
    out.append('<text x="%.0f" y="%.0f" font-size="8" fill="#C4502A">10 cm</text>' % (tx + 32, ty + 55))
    lines = [
        ("LIPUTA", 22, "#1F2A44", "bold"),
        (meta.get("title", ""), 14, "#1b1b1b", "bold"),
        (meta.get("subtitle", ""), 9, "#333", "normal"),
        (t(lang, "scale"), 8, "#C4502A", "normal"),
        (t(lang, "disclaimer"), 8, "#555", "normal"),
    ]
    ly = ty + 22
    for text, size, color, weight in lines:
        if text:
            out.append('<text x="%.0f" y="%.0f" font-size="%d" fill="%s" font-weight="%s">%s</text>'
                       % (tx + 120, ly, size, color, weight, escape(str(text))))
            ly += size + 8
    fab = meta.get("fabric")
    if fab:
        out.append('<text x="%.0f" y="%.0f" font-size="9" fill="#1F7A4D">%s : %s %.2f m (%s %.0f cm) '
                   '&#8776; %.1f %s</text>' % (
                       tx + 120, ly, t(lang, "fabric"), t(lang, "approx"), fab["metres"],
                       t(lang, "width"), fab["fabric_width_cm"], fab["yards"], t(lang, "yards")))

    for i, (pc, cut, ox, oy, _box) in enumerate(placements):
        fill = PALETTE[i % len(PALETTE)]
        out.append('<g class="piece" data-key="%s">' % escape(pc.key))
        out.append('<path d="%s" fill="%s" stroke="#111" stroke-width="2.2"/>' % (_d(cut, True, ox, oy), fill))
        out.append('<path d="%s" fill="none" stroke="#555" stroke-width="1" stroke-dasharray="8 5"/>'
                   % _d(pc.outline, True, ox, oy))
        for dart in pc.darts:
            out.append('<path d="%s" fill="none" stroke="#C4502A" stroke-width="1.6"/>'
                       % _d(dart, False, ox, oy))
        for pts, key in pc.marks:
            out.append('<path d="%s" fill="none" stroke="#3B6EA8" stroke-width="1" stroke-dasharray="3 4"/>'
                       % _d(pts, False, ox, oy))
            a, b = pts[0], pts[-1]
            out.append('<text x="%.0f" y="%.0f" font-size="7" fill="#3B6EA8">%s</text>'
                       % ((a.x + b.x) / 2 * MM + ox * MM + 3, (a.y + b.y) / 2 * MM + oy * MM - 3,
                          escape(t(lang, key))))
        for n in pc.notches:
            out.append('<circle cx="%.1f" cy="%.1f" r="3" fill="#111"/>' % ((n.x + ox) * MM, (n.y + oy) * MM))
        if pc.grain:
            a, b = pc.grain
            out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#1b1b1b" stroke-width="1.4" '
                       'marker-start="url(#arr)" marker-end="url(#arr)"/>'
                       % ((a.x + ox) * MM, (a.y + oy) * MM, (b.x + ox) * MM, (b.y + oy) * MM))
        if pc.on_fold:
            ys = [p.y for p in pc.outline if abs(p.x - min(q.x for q in pc.outline)) < 0.01]
            fx = (min(q.x for q in pc.outline) + ox) * MM
            y0f, y1f = (min(ys) + oy) * MM, (max(ys) + oy) * MM
            out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#7A4B1F" stroke-width="4"/>'
                       % (fx, y0f, fx, y1f))
            out.append('<text transform="translate(%.1f %.1f) rotate(-90)" font-size="9" fill="#7A4B1F" '
                       'font-weight="bold" text-anchor="middle">%s</text>'
                       % (fx + 14, (y0f + y1f) / 2, escape(t(lang, "on_fold"))))
        # label at centroid
        xs = [p.x for p in pc.outline]
        ys = [p.y for p in pc.outline]
        cx = (sum(xs) / len(xs) + ox) * MM
        cy = (sum(ys) / len(ys) + oy) * MM
        label = [
            (t(lang, pc.name).upper(), 12, "bold"),
            ("%s x%d" % (t(lang, "cut"), pc.cut), 10, "bold"),
            ("%s %.1f cm %s" % (t(lang, "seam"), pc.seam, t(lang, "included")), 7, "normal"),
        ]
        if pc.hem:
            label.append(("%s +%.0f cm" % (t(lang, "hem"), pc.hem), 7, "normal"))
        if meta.get("reference"):
            label.append((meta["reference"], 7, "normal"))
        for j, (txt, size, weight) in enumerate(label):
            out.append('<text x="%.1f" y="%.1f" font-size="%d" font-weight="%s" text-anchor="middle" '
                       'fill="#1b1b1b" stroke="#fff" stroke-width="3" paint-order="stroke">%s</text>' % (cx, cy + j * (size + 5), size, weight, escape(txt)))
        out.append('</g>')
    out.append('</svg>')
    return "\n".join(out)
