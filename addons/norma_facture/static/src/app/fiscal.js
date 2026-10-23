/** @odoo-module */
/* Estimation affichée pendant la saisie (mêmes règles SFE que le serveur).
   Le serveur recalcule tout : ces chiffres ne sont jamais transmis comme montants. */
import { groupRate } from "@norma_facture/app/store";

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ceil2 = (v) => Math.ceil(Math.round(Number(v) * 1e6) / 1e4) / 100;

export function estimate(lines, rate = 1) {
    const groups = {};
    for (const l of lines) {
        const price = r2(Number(l.price) * rate);
        const net = r2(price * (100 - Number(l.discount_pct || 0)) / 100);
        const amount = r2(net * Number(l.quantity));
        const g = groups[l.tax_group] || (groups[l.tax_group] = { code: l.tax_group, rate: groupRate(l.tax_group), amount: 0, ts: 0 });
        g.amount = r2(g.amount + amount);
        g.ts = r2(g.ts + r2(Number(l.specific_tax || 0) * rate * Number(l.quantity)));
    }
    let total = 0, tax = 0;
    const list = Object.values(groups).sort((a, b) => a.code.localeCompare(b.code)).map((g) => {
        const factor = g.code === "N" || !g.rate ? 1 : 1 + g.rate / 100;
        const ttc = r2(g.amount + r2(g.ts * factor));
        const vat = g.code === "N" ? ttc : (g.rate ? ceil2(ttc * g.rate / (100 + g.rate)) : 0);
        total = r2(total + ttc);
        tax = r2(tax + vat);
        return { code: g.code, rate: g.rate, ttc, tax: vat, base: r2(ttc - vat) };
    });
    return { groups: list, total, tax, ht: r2(total - tax) };
}

export function lineTotal(l) {
    const net = r2(Number(l.price) * (100 - Number(l.discount_pct || 0)) / 100);
    return r2(net * Number(l.quantity));
}
