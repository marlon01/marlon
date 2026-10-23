# -*- coding: utf-8 -*-
"""Minimal 2D geometry toolkit for parametric pattern drafting.

Pure Python (no external dependency) so it runs inside any Odoo worker.
All drafting coordinates are expressed in centimetres, y axis pointing down.
"""
import math


class P:
    """2D point / vector."""

    __slots__ = ("x", "y")

    def __init__(self, x, y):
        self.x = float(x)
        self.y = float(y)

    def __add__(self, o):
        return P(self.x + o.x, self.y + o.y)

    def __sub__(self, o):
        return P(self.x - o.x, self.y - o.y)

    def __mul__(self, k):
        return P(self.x * k, self.y * k)

    __rmul__ = __mul__

    def length(self):
        return math.hypot(self.x, self.y)

    def unit(self):
        n = self.length() or 1.0
        return P(self.x / n, self.y / n)

    def lerp(self, o, t):
        return P(self.x + (o.x - self.x) * t, self.y + (o.y - self.y) * t)

    def dist(self, o):
        return (self - o).length()

    def __iter__(self):
        yield self.x
        yield self.y

    def __repr__(self):
        return "P(%.2f, %.2f)" % (self.x, self.y)


def quad(p0, c, p1, n=12):
    """Sample a quadratic Bezier (excluding p0)."""
    out = []
    for i in range(1, n + 1):
        t = i / n
        a, b, d = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        out.append(P(a * p0.x + b * c.x + d * p1.x, a * p0.y + b * c.y + d * p1.y))
    return out


def cubic(p0, c1, c2, p1, n=16):
    """Sample a cubic Bezier (excluding p0)."""
    out = []
    for i in range(1, n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append(P(a * p0.x + b * c1.x + c * c2.x + d * p1.x,
                     a * p0.y + b * c1.y + c * c2.y + d * p1.y))
    return out


class Path:
    """Fluent polyline builder: Path(a).line(b).cubic(c1, c2, d).points"""

    def __init__(self, start):
        self.points = [start]

    @property
    def last(self):
        return self.points[-1]

    def line(self, p):
        self.points.append(p)
        return self

    def quad(self, c, p, n=12):
        self.points.extend(quad(self.last, c, p, n))
        return self

    def cubic(self, c1, c2, p, n=16):
        self.points.extend(cubic(self.last, c1, c2, p, n))
        return self


def dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or out[-1].dist(p) > eps:
            out.append(p)
    if len(out) > 2 and out[0].dist(out[-1]) <= eps:
        out.pop()
    return out


def signed_area(pts):
    s = 0.0
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        s += a.x * b.y - b.x * a.y
    return s / 2.0


def polygon_area(pts):
    return abs(signed_area(pts))


def bbox(pts):
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _line_intersection(p1, d1, p2, d2):
    cross = d1.x * d2.y - d1.y * d2.x
    if abs(cross) < 1e-9:
        return None
    t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross
    return p1 + d1 * t


def offset_polygon(pts, d, miter_limit=3.0):
    """Offset a closed polygon outward by distance d (miter joins)."""
    pts = dedupe(pts)
    n = len(pts)
    if n < 3 or d == 0:
        return list(pts)
    s = 1.0 if signed_area(pts) > 0 else -1.0
    out = []
    for i in range(n):
        p_prev, p, p_next = pts[i - 1], pts[i], pts[(i + 1) % n]
        e1 = (p - p_prev).unit()
        e2 = (p_next - p).unit()
        n1 = P(e1.y, -e1.x) * s
        n2 = P(e2.y, -e2.x) * s
        a1 = p_prev + n1 * d
        a2 = p + n2 * d
        q = _line_intersection(a1, e1, a2, e2)
        if q is None:
            q = p + n1 * d
        if q.dist(p) > abs(d) * miter_limit:
            bis = (n1 + n2).unit()
            q = p + bis * (abs(d) * miter_limit) * (1 if d > 0 else -1)
        out.append(q)
    return out


def offset_polyline(pts, d):
    """Offset an open polyline by d along its left normal."""
    pts = dedupe(pts)
    out = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        t = (b - a).unit()
        out.append(p + P(-t.y, t.x) * d)
    return out


def polyline_length(pts):
    return sum(pts[i].dist(pts[i + 1]) for i in range(len(pts) - 1))
