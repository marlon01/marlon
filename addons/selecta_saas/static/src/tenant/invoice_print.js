/** @odoo-module */
/* Facture imprimable (ou enregistrable en PDF depuis la boîte d'impression du navigateur). */
import { printHTML } from "@selecta_concours/admin/print";
import { escapeHTML as e, fmtDateTime } from "@selecta_concours/common/utils";
import { CYCLE_LABELS, fmtDate, fmtMoney, providerName } from "@selecta_saas/tenant/common";

const INVOICE_CSS = `
.inv-top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2.5pt solid #14213D; padding-bottom: 12px; margin-bottom: 18px; }
.inv-issuer strong { font-size: 15pt; display: block; }
.inv-pre { white-space: pre-line; }
.inv-title { text-align: right; }
.inv-title h1 { font-size: 20pt; letter-spacing: .04em; }
.inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
.inv-parties > div { border: 0.6pt solid #AEB8CE; border-radius: 6px; padding: 10px 12px; }
.inv-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #5B6785; margin-bottom: 4px; }
.inv-meta { width: auto; margin-left: auto; }
.inv-meta td { border: 0; padding: 2px 0 2px 16px; }
.inv-total td { font-weight: 700; font-size: 12pt; border-top: 1.4pt solid #14213D; }
.inv-note { margin-top: 18px; border-left: 3pt solid #14213D; padding: 6px 12px; font-size: 9.5pt; }
.inv-foot { margin-top: 28px; font-size: 8.5pt; color: #5B6785; border-top: 0.6pt solid #AEB8CE; padding-top: 8px; }
.inv-credit td { color: #0E8A5F; }
.inv-sub td { border-bottom: 0; padding-top: 2px; padding-bottom: 2px; }
.stamp.paid { color: #0E8A5F; } .stamp.due { color: #A86A12; } .stamp.void { color: #C2352B; }
`;

const STAMP = {
    paid: ["paid", "PAYÉE"],
    open: ["due", "À PAYER"],
    pending: ["due", "PAIEMENT EN COURS DE VALIDATION"],
    rejected: ["void", "PAIEMENT REFUSÉ"],
    cancelled: ["void", "ANNULÉE"],
};

export function printInvoice(inv, info) {
    const issuer = info.issuer || {};
    const c = info.customer || {};
    const [stampCls, stampLabel] = STAMP[inv.state] || ["due", inv.state_label];
    const unit = inv.billing_cycle === "yearly" ? "an" : "mois";
    let period;
    if (inv.period_start && inv.period_end) {
        period = `Période du ${e(fmtDate(inv.period_start))} au ${e(fmtDate(inv.period_end))}`;
    } else if (inv.prorated) {
        period = `Nouvelle période d'un ${unit} à compter du paiement (changement vers une catégorie supérieure)`;
    } else if (inv.deferred_plan) {
        period = `Période d'un ${unit} ajoutée à la suite de l'abonnement en cours`;
    } else {
        period = `Période d'un ${unit} à compter de la validation du paiement`;
    }
    const notes = [];
    if (inv.deferred_plan) {
        notes.push(inv.state === "paid" && inv.period_start
            ? `Catégorie appliquée à compter du ${e(fmtDate(inv.period_start))}, à l'échéance de l'abonnement précédent.`
            : "Catégorie inférieure : elle s'applique à l'échéance de l'abonnement en cours.");
    }
    const credit = Number(inv.credit_amount) || 0;
    const gross = Number(inv.gross_amount) || Number(inv.amount) || 0;
    const amount = e(fmtMoney(inv.amount, inv.symbol));
    let creditRow = "";
    if (credit > 0) {
        creditRow = `<tr class="inv-credit"><td>Avoir sur la période en cours<div class="small muted">Part non consommée de l'abonnement précédent, déduite au prorata</div></td>
            <td></td><td class="num">−&#160;${e(fmtMoney(credit, inv.symbol))}</td></tr>`;
    }
    let note = "";
    if (inv.state === "paid") {
        const parts = [];
        if (inv.validated_date) {
            parts.push("le " + e(fmtDateTime(inv.validated_date)));
        }
        if (inv.online_provider) {
            parts.push("— payée en ligne via " + e(providerName(inv.online_provider)));
        } else if (Number(inv.amount) <= 0 && credit > 0) {
            parts.push("— réglée intégralement par l'avoir sur la période en cours");
        } else if (inv.payment_method_label) {
            parts.push("— " + e(inv.payment_method_label));
        }
        if (inv.payment_reference) {
            parts.push("(référence " + e(inv.payment_reference) + ")");
        }
        note = '<div class="inv-note"><strong>Paiement reçu</strong> ' + parts.join(" ") + ".</div>";
    } else if (["open", "rejected"].includes(inv.state) && info.payment_instructions) {
        note = `<div class="inv-note"><strong>Modalités de paiement</strong><div class="inv-pre">${e(info.payment_instructions)}</div>Rappelez le numéro <strong>${e(inv.name)}</strong> en motif de paiement.</div>`;
    }
    const contact = [info.support_email, info.support_phone].filter(Boolean).map(e).join(" · ");
    const customerLines = [c.contact, c.email, c.phone, c.country].filter(Boolean).map(e).join("<br>");
    const body = `
        <div class="inv-top">
            <div class="inv-issuer"><strong>${e(issuer.name || "Naxoris")}</strong><div class="inv-pre small muted">${e(issuer.details || "")}</div></div>
            <div class="inv-title"><h1>FACTURE</h1><div><strong>N° ${e(inv.name)}</strong></div><div class="muted">Émise le ${e(fmtDate(inv.date))}</div>
                <p style="margin:8px 0 0"><span class="stamp ${stampCls}">${e(stampLabel)}</span></p></div>
        </div>
        <div class="inv-parties">
            <div><div class="inv-label">Émetteur</div><strong>${e(issuer.name || "Naxoris")}</strong><div class="small muted">Éditeur de la plateforme SELECTA</div></div>
            <div><div class="inv-label">Facturé à</div><strong>${e(c.name || inv.tenant)}</strong><div class="small">${customerLines}</div></div>
        </div>
        <table>
            <thead><tr><th>Désignation</th><th>Cycle</th><th class="num">Montant</th></tr></thead>
            <tbody>
                <tr><td><strong>Abonnement SELECTA — catégorie « ${e(inv.plan)} »</strong><div class="small muted">${period}</div>
                    ${notes.map((n) => `<div class="small muted">${n}</div>`).join("")}</td>
                    <td>${e(CYCLE_LABELS[inv.billing_cycle] || inv.billing_cycle)}</td><td class="num">${e(fmtMoney(gross, inv.symbol))}</td></tr>
                ${creditRow}
            </tbody>
        </table>
        <table class="inv-meta" style="margin-top:10px">
            ${credit > 0 ? `<tr class="inv-sub"><td>Prix de la période</td><td class="num">${e(fmtMoney(gross, inv.symbol))}</td></tr>
            <tr class="inv-sub inv-credit"><td>Avoir sur la période en cours</td><td class="num">−&#160;${e(fmtMoney(credit, inv.symbol))}</td></tr>` : ""}
            <tr class="inv-total"><td>${inv.state === "paid" ? "Total réglé" : "Total à régler"} (${e(inv.currency || "USD")})</td><td class="num">${amount}</td></tr>
        </table>
        ${note}
        <div class="inv-foot">Document généré par SELECTA by Naxoris le ${e(fmtDateTime(new Date()))}.${contact ? " Contact : " + contact : ""}</div>`;
    printHTML(`Facture ${inv.name}`, `<style>${INVOICE_CSS}</style>${body}`);
}
