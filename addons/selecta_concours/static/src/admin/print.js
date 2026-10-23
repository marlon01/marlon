/** @odoo-module */
/* Documents imprimables (convocations, procès-verbal) générés côté navigateur : aucune
 * dépendance à wkhtmltopdf, impression ou export PDF depuis la boîte de dialogue du système. */
import { getLang, t, translateTree } from "@selecta_concours/common/i18n";
import { escapeHTML as e, fmtDateTime, fmtPct } from "@selecta_concours/common/utils";

const PRINT_CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: #14213D; font-size: 11pt; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4px; }
h2 { font-size: 13pt; margin: 18px 0 8px; }
.muted { color: #5B6785; }
.head { display: flex; align-items: center; gap: 14px; border-bottom: 2.5pt solid #14213D; padding-bottom: 10px; margin-bottom: 14px; }
.head img { width: 54px; height: 54px; object-fit: contain; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 0.6pt solid #AEB8CE; padding: 6px 8px; text-align: left; font-size: 10pt; }
th { background: #EEF1F7; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.card { border: 1pt dashed #6B7896; border-radius: 8px; padding: 14px 16px; page-break-inside: avoid; margin-bottom: 10mm; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.cards .card { margin: 0; }
.code { font: 700 19pt "Bahnschrift", "Consolas", monospace; letter-spacing: 2px; border: 1.2pt solid #14213D; border-radius: 6px; padding: 8px; text-align: center; margin: 10px 0; }
.small { font-size: 8.5pt; }
.seal { display: flex; gap: 16px; align-items: center; border: 1pt solid #14213D; border-radius: 10px; padding: 12px 14px; margin-top: 18px; page-break-inside: avoid; }
.seal img { width: 110px; height: 110px; }
.hash { font-family: Consolas, monospace; font-size: 8.5pt; word-break: break-all; }
.sign { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-top: 26px; }
.sign div { border-top: 0.8pt solid #14213D; padding-top: 6px; min-height: 60px; font-size: 9.5pt; }
.stamp { display:inline-block; padding: 3px 10px; border: 1.5pt solid; border-radius: 4px; font-weight: 700; }
.official { color: #0E8A5F; } .provisional { color: #A86A12; }
`;

export function printHTML(title, body) {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html lang="${getLang()}"><head><meta charset="utf-8"><title>${e(t(title))}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`);
    doc.close();
    translateTree(doc.body);
    const go = () => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => iframe.remove(), 1500);
    };
    const imgs = [...doc.images];
    if (!imgs.length) {
        setTimeout(go, 150);
    } else {
        Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => ((i.onload = r), (i.onerror = r)))))).then(go);
    }
}

function header(company, title, subtitle) {
    return `<div class="head"><img src="${e(company.logo)}" alt=""><div><div class="muted">${e(company.name)}</div><h1>${e(title)}</h1><div class="muted">${e(subtitle || "")}</div></div></div>`;
}

export function printConvocations(company, payload, examUrl) {
    const c = payload.concours;
    const cards = payload.codes
        .map(
            (x) => `<div class="card">
            <div class="muted small">${e(company.name)}</div>
            <strong>${e(c.name)}</strong>
            <div class="small muted">${e(c.reference)}${c.date_start ? ", ouverture le " + e(fmtDateTime(c.date_start)) : ""}, durée ${e(c.duration)} min</div>
            <div style="margin-top:8px">Candidat : <strong>${e(x.name)}</strong></div>
            <div class="small">N° d'inscription : ${e(x.reference)}${x.room ? ", " + e(x.room) : ""}</div>
            <div class="code">${e(x.code)}</div>
            ${c.exam_mode === "remote"
                ? `<div class="small">Épreuve <strong>à distance</strong>, depuis l'endroit de votre choix : ${e(examUrl)}</div>
            <div class="small muted">Webcam obligatoire. Code strictement personnel, valable une seule fois. Ne le communiquez à personne.</div>`
                : `<div class="small">Épreuve <strong>en présentiel</strong>${c.exam_venue ? " : " + e(c.exam_venue) : ""}</div>
            <div class="small muted">Présentez-vous avec une pièce d'identité. Code strictement personnel, valable une seule fois, à saisir sur un poste de la salle.</div>`}
        </div>`
        )
        .join("");
    printHTML(`Convocations ${c.reference}`, `${header(company, "Codes d'accès des candidats", c.name)}<div class="cards">${cards}</div>`);
}

export function printMinutes(data) {
    const c = data.concours;
    const rows = data.admitted
        .map(
            (r) => `<tr><td class="num">${r.rank}</td><td>${e(r.reference)}</td><td>${e(r.candidate)}</td><td>${e(r.room)}</td><td class="num">${fmtPct(r.percentage, 2)}</td></tr>`
        )
        .join("");
    const stats = data.rows.filter((r) => ["submitted", "expired"].includes(r.state));
    const disq = data.rows.filter((r) => r.state === "disqualified").length;
    const status = data.official
        ? `<span class="stamp official">PROCÈS-VERBAL OFFICIEL</span>`
        : `<span class="stamp provisional">DOCUMENT PROVISOIRE — NON PUBLIÉ</span>`;
    const seal = data.official
        ? `<div class="seal">${data.qr ? `<img src="${data.qr}" alt="QR">` : ""}<div>
             <strong>Sceau d'authenticité SELECTA</strong>
             <div class="small">Publié le ${e(fmtDateTime(data.published_date))} par ${e(data.published_by)}. Scannez le code ou ouvrez l'adresse ci-dessous pour vérifier que cette liste n'a pas été modifiée.</div>
             <div class="hash" style="margin-top:6px">${e(data.verify_url)}</div>
             <div class="hash">SHA-256 : ${e(data.results_hash)}</div></div></div>`
        : "";
    const body = `${header(data.company, "Liste des candidats admis", c.name)}
        <p>${status}</p>
        <p>Concours <strong>${e(c.reference)}</strong>. Seuil de réussite : <strong>${e(c.pass_threshold)} %</strong>${c.places ? `, nombre de places : <strong>${e(c.places)}</strong>` : ""}.
        Copies corrigées : <strong>${stats.length}</strong>, candidats disqualifiés : <strong>${disq}</strong>, admis : <strong>${data.admitted.length}</strong>.</p>
        <p class="small muted">Correction automatique par SELECTA : aucune intervention humaine sur les notes. Les copies sont scellées individuellement (empreinte SHA-256) et l'ensemble des opérations est consigné dans un journal d'audit chaîné.</p>
        <h2>Candidats admis par ordre de mérite</h2>
        <table><thead><tr><th>Rang</th><th>N° d'inscription</th><th>Nom et prénoms</th><th>Salle</th><th>Résultat</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Aucun candidat admis.</td></tr>`}</tbody></table>
        ${seal}
        <div class="sign"><div>Le président du jury</div><div>Le secrétaire</div><div>Le représentant de l'organisme</div></div>`;
    printHTML(`PV ${c.reference}`, body);
}
