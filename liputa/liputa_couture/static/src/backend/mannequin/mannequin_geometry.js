/** @odoo-module **/
/**
 * Pure geometry of the Liputa virtual mannequin (no Odoo dependency, unit-testable).
 * Input: completed measurements in cm. Output: SVG path strings in a 360 x 640 viewBox.
 */

export const SKIN_TONES = {
    1: "#F1D3BC", 2: "#E2B48F", 3: "#C68A5E", 4: "#A0663E", 5: "#7A4A2A", 6: "#4B2C1A",
};

const LENGTH_RATIOS = { hip: null, knee: 0.355, midi: 0.45, ankle: 0.58, floor: 0.62 };
const SLEEVE_RATIOS = { none: 0, cap: 0.18, short: 0.35, three_quarter: 0.7, long: 1 };

/** Catmull-Rom spline through points -> cubic Bezier path segment string (without M). */
function spline(points, tension = 0.5) {
    let d = "";
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;
        const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2, p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2];
        const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2, p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
}

/** Closed symmetric shape: right-side points listed top -> bottom, mirrored on x = cx. */
function symmetric(right, cx, closeBottom = true) {
    const left = right.map(([x, y]) => [2 * cx - x, y]).reverse();
    const top = right[0];
    let d = `M${(2 * cx - top[0]).toFixed(1)},${top[1].toFixed(1)} L${top[0].toFixed(1)},${top[1].toFixed(1)}`;
    d += spline(right);
    d += closeBottom ? ` L${left[0][0].toFixed(1)},${left[0][1].toFixed(1)}` : "";
    d += spline(left) + " Z";
    return d;
}

function polyline(points) {
    return "M" + points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
}

export function buildMannequin(data) {
    const m = data.measurements;
    const H = m.height;
    const W = 360;
    const s = 600 / H; // px per cm
    const cx = W / 2;
    const top = 20;
    const X = (cm) => cx + cm * s; // horizontal offset from centre (cm) -> px
    const Y = (cm) => top + cm * s; // vertical from head top (cm) -> px

    // landmarks (cm from head top)
    const headH = 0.13 * H;
    const ySh = 0.18 * H;
    const yNeck = headH + 1;
    const yWaist = 0.165 * H + m.back_waist_length;
    const yBust = ySh + (yWaist - ySh) * 0.38;
    const yArmpit = ySh + (yWaist - ySh) * 0.22;
    const yHip = yWaist + m.hip_depth;
    const yCrotch = Math.max(H - m.inseam, yHip + 3);
    const yAnkle = H - 7;
    const yKnee = yCrotch + (yAnkle - yCrotch) * 0.48;

    // half widths (front view), circumference / ~6.3
    const hw = {
        neck: m.neck / 6.4, sh: m.shoulder_width / 2 + 1.2, bust: m.bust / 6.3,
        waist: m.waist / 6.3, hip: m.hip / 6.1, thigh: m.thigh / 6.4, knee: m.knee / 6.6,
    };
    const legCx = hw.hip * 0.48;

    const body = symmetric([
        [X(hw.neck), Y(yNeck)],
        [X(hw.neck), Y(ySh - 2.5)],
        [X(hw.sh), Y(ySh + 1.2)],
        [X(hw.bust * 0.98), Y(yArmpit)],
        [X(hw.bust), Y(yBust)],
        [X(hw.waist), Y(yWaist)],
        [X(hw.hip), Y(yHip)],
        [X(legCx + hw.thigh), Y(yCrotch + 2)],
        [X(legCx + hw.knee), Y(yKnee)],
        [X(legCx + hw.knee * 0.75), Y(yKnee + (yAnkle - yKnee) * 0.35)],
        [X(legCx + 3.2), Y(yAnkle)],
        [X(legCx + 4.5), Y(H - 0.5)],
        [X(legCx - 4.5), Y(H - 0.5)],
        [X(legCx - 2.8), Y(yAnkle)],
        [X(legCx - hw.knee * 0.8), Y(yKnee)],
        [X(legCx - hw.thigh * 0.65), Y(yCrotch + 3)],
        [X(0.3), Y(yCrotch)],
    ], cx, false);

    // arms as thick strokes, slightly away from the body
    const armW = (m.biceps / 3.2) * s;
    const armLen = m.arm_length;
    const shoulder = [hw.sh - 1.5, ySh + 3];
    const elbow = [hw.bust + 3.5, ySh + armLen * 0.47];
    const wrist = [hw.hip + 3.5, ySh + armLen];
    const armPts = (sign) => [shoulder, elbow, wrist].map(([x, y]) => [X(sign * x), Y(y)]);
    const arm = (sign) => {
        const p = armPts(sign);
        return `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}` + spline(p);
    };
    const hands = [1, -1].map((sg) => ({ cx: X(sg * (hw.hip + 3.8)), cy: Y(ySh + armLen + 4), r: 4.2 * s }));

    const head = { cx, cy: Y(headH * 0.48), rx: 7.6 * s, ry: headH * 0.5 * s };

    // ------------------------------------------------------------ garment
    const g = { main: "", second: "", details: [], sleeves: [], sleeveWidth: armW + 4 * s, headwrap: "" };
    const e = 1.6; // visual ease (cm)
    const lengthFrom = (type) => (type === "hip" || !LENGTH_RATIOS[type] ? m.hip_depth + 3 : H * LENGTH_RATIOS[type]);
    const yHem = Math.min(yWaist + lengthFrom(data.length_type), H - 1.5);
    const flare = data.flare || 0;
    const bodice = (yEnd, endHalf) => [
        [X(hw.neck + 1.2), Y(ySh - 2.2)],
        [X(hw.sh + 0.6), Y(ySh + 1)],
        [X(hw.bust + e * 0.6), Y(yArmpit)],
        [X(hw.bust + e), Y(yBust)],
        [X(hw.waist + e), Y(yWaist)],
        ...(yEnd > yWaist ? [[X(hw.hip + e), Y(Math.min(yHip, yEnd))]] : []),
        ...(yEnd > yHip ? [[X(endHalf), Y(yEnd)]] : []),
    ];
    const trousers = () => {
        const pts = [
            [X(hw.waist + e), Y(yWaist)], [X(hw.hip + e), Y(yHip)],
            [X(legCx + hw.thigh + e), Y(yCrotch + 3)], [X(legCx + hw.knee + 2.5), Y(yKnee)],
            [X(legCx + 6), Y(H - 2)], [X(legCx - 6), Y(H - 2)],
            [X(legCx - hw.knee - 1.2), Y(yKnee)], [X(0.4), Y(yCrotch + 1)],
        ];
        return symmetric(pts, cx, false);
    };
    const sleeve = (ratio) => {
        if (!ratio) {
            return;
        }
        for (const sign of [1, -1]) {
            const p = armPts(sign);
            const pts = [p[0]];
            const total = armLen * ratio;
            const upper = armLen * 0.47;
            if (total <= upper) {
                const t = total / upper;
                pts.push([p[0][0] + (p[1][0] - p[0][0]) * t, p[0][1] + (p[1][1] - p[0][1]) * t]);
            } else {
                const t = (total - upper) / (armLen - upper);
                pts.push(p[1], [p[1][0] + (p[2][0] - p[1][0]) * t, p[1][1] + (p[2][1] - p[1][1]) * t]);
            }
            g.sleeves.push(`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}` + spline(pts));
        }
    };
    const sleeveRatio = SLEEVE_RATIOS[data.sleeve_type] ?? 0.35;

    switch (data.silhouette) {
        case "boubou": {
            const reach = hw.sh + armLen * 0.95;
            const pts = [
                [X(hw.neck + 1.2), Y(ySh - 2.2)],
                [X(hw.sh + 2), Y(ySh)],
                [X(reach), Y(ySh + armLen * 0.85)],
                [X(reach - 3), Y(ySh + armLen * 0.85 + 22)],
                [X(hw.hip + 12), Y(yHip + 12)],
                [X(hw.hip + 14 + flare * 10), Y(Math.max(yHem, H - 4))],
            ];
            g.main = symmetric(pts, cx);
            g.details.push(polyline([[X(-hw.neck - 7), Y(ySh - 1)], [X(-hw.neck - 7), Y(ySh + 24)],
                [X(hw.neck + 7), Y(ySh + 24)], [X(hw.neck + 7), Y(ySh - 1)]]));
            g.hideArms = true;
            break;
        }
        case "tunic_trousers": {
            g.second = trousers();
            const yEnd = yHip + 14;
            g.main = symmetric(bodice(yEnd, hw.hip + e + 3), cx);
            g.details.push(polyline([[X(-hw.neck - 1), Y(ySh - 2)], [X(0), Y(ySh + 12)], [X(hw.neck + 1), Y(ySh - 2)]]));
            sleeve(sleeveRatio || 0.35);
            break;
        }
        case "shirt_trousers": {
            g.second = trousers();
            g.main = symmetric(bodice(yHip + 6, hw.hip + e + 1), cx);
            g.details.push(polyline([[X(0), Y(ySh)], [X(0), Y(yHip + 6)]]));
            for (let i = 0; i < 6; i++) {
                g.details.push(`M${cx - 1},${Y(ySh + 4 + i * 9)} a1.2,1.2 0 1,0 2.4,0 a1.2,1.2 0 1,0 -2.4,0`);
            }
            sleeve(sleeveRatio || 1);
            break;
        }
        case "suit": {
            g.second = trousers();
            g.main = symmetric(bodice(yHip + 5, hw.hip + e + 1.5), cx);
            g.details.push(polyline([[X(-hw.neck - 1.5), Y(ySh - 2)], [X(-2), Y(yWaist - 4)], [X(0), Y(yHip + 5)]]));
            g.details.push(polyline([[X(hw.neck + 1.5), Y(ySh - 2)], [X(2), Y(yWaist - 4)]]));
            sleeve(1);
            break;
        }
        case "wrap":
        case "top_skirt":
        case "dress":
        default: {
            const hemHalf = hw.hip + e + flare * (yHem - yHip) * 0.45;
            const pts = bodice(yHem, hemHalf);
            if (yHem <= yHip) {
                pts.push([X(hw.hip + e), Y(yHem)]);
            }
            g.main = symmetric(pts, cx);
            if (data.silhouette === "wrap") {
                g.details.push(polyline([[X(-hw.waist - e), Y(yWaist)], [X(hw.hip * 0.4), Y(yHem)]]));
                const hy = Y(headH * 0.25);
                g.headwrap = `M${X(-9)},${Y(headH * 0.55)} Q${X(-13)},${Y(-6)} ${cx},${Y(-5)} Q${X(14)},${Y(-6)} ${X(9.5)},${Y(headH * 0.5)} ` +
                    `Q${X(4)},${hy} ${X(-9)},${Y(headH * 0.55)} Z`;
            }
            if (data.silhouette !== "dress") {
                g.details.push(polyline([[X(-hw.waist - e), Y(yWaist)], [X(hw.waist + e), Y(yWaist)]]));
            }
            sleeve(sleeveRatio);
        }
    }

    const dims = [
        { label: `${m.bust} cm`, y: Y(yBust), x1: X(-hw.bust - 3), x2: X(hw.bust + 3) },
        { label: `${m.waist} cm`, y: Y(yWaist), x1: X(-hw.waist - 3), x2: X(hw.waist + 3) },
        { label: `${m.hip} cm`, y: Y(yHip), x1: X(-hw.hip - 3), x2: X(hw.hip + 3) },
    ];

    return {
        viewBox: `0 0 ${W} ${Math.ceil(Y(H) + 20)}`,
        body, head, hands, arms: [arm(1), arm(-1)], armWidth: armW,
        neck: { x: X(-hw.neck * 0.9), y: Y(headH * 0.8), w: hw.neck * 1.8 * s, h: (ySh - headH * 0.8) * s },
        garment: g,
        dims,
        height: { y1: Y(0), y2: Y(H), x: X(-hw.hip - 16), label: `${m.height} cm` },
        shadow: { cx, cy: Y(H) + 2, rx: (hw.hip + 10) * s, ry: 5 },
    };
}
