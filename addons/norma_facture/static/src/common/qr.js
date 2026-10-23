/** @odoo-module */
/* Encodeur QR minimal (mode octets, correction M, versions 1 à 10), pour les tickets provisoires imprimés
   hors ligne. Algorithme de la norme ISO/IEC 18004 (structure inspirée de la bibliothèque de Project Nayuki). */

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const n = Math.floor(ver / 7) + 2;
        r -= (25 * n - 10) * n - 55;
        if (ver >= 7) r -= 36;
    }
    return r;
}
const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_M[ver] * BLOCKS_M[ver];

function rsMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
}
function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < r.length; j++) {
            r[j] = rsMul(r[j], root);
            if (j + 1 < r.length) r[j] ^= r[j + 1];
        }
        root = rsMul(root, 0x02);
    }
    return r;
}
function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
        const f = b ^ r.shift();
        r.push(0);
        div.forEach((c, i) => (r[i] ^= rsMul(c, f)));
    }
    return r;
}

function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const out = [6];
    for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
}

/** Retourne la matrice (tableau de lignes de booléens) du QR code de ``text``. */
export function qrMatrix(text, forceMask = null) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 10; ver++) {
        const cap = dataCodewords(ver) * 8;
        if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap) break;
    }
    if (ver > 10) throw new Error("Texte trop long pour le QR code.");
    // Flux de bits : mode octets, longueur, données, terminaison, bourrage.
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    const capBits = dataCodewords(ver) * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    // Blocs et correction d'erreurs, puis entrelacement.
    const nBlocks = BLOCKS_M[ver], ecLen = ECC_M[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks);
    const div = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
        const dat = data.slice(k, k + shortLen - ecLen + (i < nShort ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, div);
        if (i < nShort) dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= nShort) all.push(b[i]); });
    }
    // Matrice : motifs fixes.
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
            if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPositions(ver);
    al.forEach((a, i) => al.forEach((b, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = (mask) => {
        const d = (0 << 3) | mask; // niveau M = 0b00
        let rem = d;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const b = ((d << 10) | rem) ^ 0x5412;
        const bit = (i) => ((b >>> i) & 1) !== 0;
        for (let i = 0; i <= 5; i++) set(8, i, bit(i));
        set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
        for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
        set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const b = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const v = ((b >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3);
            set(a, c, v); set(c, a, v);
        }
    }
    // Placement en zigzag.
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
            const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
            if (!fn[y][x] && i < all.length * 8) {
                m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
                i++;
            }
        }
    }
    // Masque : on garde celui de pénalité minimale.
    const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
        (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const apply = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[k](x, y)) m[y][x] = !m[y][x]; };
    let best = 0, bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
        apply(k); drawFormat(k);
        const s = penalty(m, size);
        if (s < bestScore) { best = k; bestScore = s; }
        apply(k);
    }
    if (forceMask !== null) best = forceMask;
    apply(best); drawFormat(best);
    return m;
}

function penalty(m, size) {
    let p = 0;
    const line = (get) => {
        for (let a = 0; a < size; a++) {
            let run = 1;
            for (let b = 1; b <= size; b++) {
                if (b < size && get(a, b) === get(a, b - 1)) run++;
                else { if (run >= 5) p += run - 2; run = 1; }
            }
            for (let b = 0; b + 10 < size + 1; b++) {
                const seq = Array.from({ length: 11 }, (_, k) => (b + k < size ? get(a, b + k) : false));
                const pat = [true, false, true, true, true, false, true];
                const is = (off) => pat.every((v, k) => seq[off + k] === v);
                if ((is(0) && !seq[7] && !seq[8] && !seq[9] && !seq[10]) || (is(4) && !seq[0] && !seq[1] && !seq[2] && !seq[3])) p += 40;
            }
        }
    };
    line((a, b) => m[a][b]);
    line((a, b) => m[b][a]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    const dark = m.reduce((s, r) => s + r.filter(Boolean).length, 0);
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
}

/** QR code en SVG (chaîne) : pour l'impression navigateur. */
export function qrSvg(text, px = 4, border = 2) {
    const m = qrMatrix(text), n = m.length + border * 2;
    let d = "";
    m.forEach((row, y) => row.forEach((v, x) => { if (v) d += `M${x + border},${y + border}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
