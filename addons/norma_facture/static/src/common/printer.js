/** @odoo-module */
/* Impression directe des tickets à la caisse.

   Deux modes, réglés par poste (mémorisés dans le navigateur) :
   * « usb » : imprimante thermique ESC/POS reliée en USB ou en série. Chrome lui envoie le ticket
     directement (WebUSB ou Web Serial), sans aucune fenêtre ; le QR code est dessiné par l'imprimante.
   * « system » : imprimante du système. Le ticket est imprimé depuis une page cachée, sans ouvrir d'onglet.
     Pour supprimer aussi la fenêtre de confirmation du navigateur, lancer Chrome avec --kiosk-printing.
   * « off » : pas d'impression automatique (bouton « Ticket » à la demande). */

const KEY = "norma.printer";
const DEFAULTS = { mode: "system", width: 80, copies: 1, auto: true };

export function printerSettings() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
        return { ...DEFAULTS };
    }
}

export function savePrinterSettings(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}

export const capabilities = { usb: !!navigator.usb, serial: !!navigator.serial };

// ---------------------------------------------------------------- transport ESC/POS
let device = null;   // USBDevice
let port = null;     // SerialPort
let endpoint = null;

async function openUsb(dev) {
    await dev.open();
    if (dev.configuration === null) await dev.selectConfiguration(1);
    for (const iface of dev.configuration.interfaces) {
        for (const alt of iface.alternates) {
            const out = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
            if (out) {
                await dev.claimInterface(iface.interfaceNumber);
                endpoint = out.endpointNumber;
                device = dev;
                return true;
            }
        }
    }
    throw new Error("Aucune sortie d'impression trouvée sur ce périphérique USB.");
}

/** Choix de l'imprimante (geste de l'utilisateur obligatoire, une seule fois par poste). */
export async function pairPrinter(kind) {
    if (kind === "serial") {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        return "Imprimante série reliée.";
    }
    const dev = await navigator.usb.requestDevice({ filters: [] });
    await openUsb(dev);
    return `Imprimante reliée : ${dev.productName || "USB"}.`;
}

async function reconnect() {
    if (device || port) return true;
    if (navigator.usb) {
        const [dev] = await navigator.usb.getDevices();
        if (dev) { await openUsb(dev); return true; }
    }
    if (navigator.serial) {
        const [p] = await navigator.serial.getPorts();
        if (p) { port = p; await port.open({ baudRate: 9600 }).catch(() => {}); return true; }
    }
    return false;
}

async function send(bytes) {
    if (!(await reconnect())) throw new Error("Aucune imprimante thermique reliée à ce poste (Paramètres › Impression).");
    if (device) {
        for (let i = 0; i < bytes.length; i += 4096) await device.transferOut(endpoint, bytes.slice(i, i + 4096));
    } else {
        const w = port.writable.getWriter();
        await w.write(bytes);
        w.releaseLock();
    }
}

// ---------------------------------------------------------------- composition ESC/POS
const enc = (t) => {
    // Page de codes CP858 (accents français) : les caractères absents deviennent leur forme sans accent.
    const map = { "é": 0x82, "è": 0x8a, "ê": 0x88, "ë": 0x89, "à": 0x85, "â": 0x83, "ç": 0x87, "ô": 0x93, "û": 0x96, "ù": 0x97,
        "î": 0x8c, "ï": 0x8b, "É": 0x90, "€": 0xd5, "°": 0xf8, "×": 0x9e };
    const out = [];
    for (const ch of String(t ?? "")) {
        const c = ch.charCodeAt(0);
        if (map[ch]) out.push(map[ch]);
        else if (c < 32 || c === 127) out.push(32); // aucune commande d'imprimante ne passe par un texte
        else if (c < 128) out.push(c);
        else out.push(...Array.from(ch.normalize("NFD").replace(/[̀-ͯ]/g, "")).map((x) => (x.charCodeAt(0) < 128 ? x.charCodeAt(0) : 63)));
    }
    return out;
};

class Esc {
    constructor(width) { this.b = [0x1b, 0x40, 0x1b, 0x74, 19]; this.cols = width >= 80 ? 48 : 32; }
    raw(...x) { this.b.push(...x); return this; }
    align(a) { return this.raw(0x1b, 0x61, { left: 0, center: 1, right: 2 }[a]); }
    bold(on) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
    size(n) { return this.raw(0x1d, 0x21, n === 2 ? 0x11 : 0); }
    text(t) { this.b.push(...enc(t), 0x0a); return this; }
    line(ch = "-") { return this.text(ch.repeat(this.cols)); }
    pair(l, r, cols = this.cols) {
        const left = String(l), right = String(r), space = cols - left.length - right.length;
        return space >= 1 ? this.text(left + " ".repeat(space) + right) : this.text(left).align("right").text(right).align("left");
    }
    qr(data) {
        const d = enc(data), len = d.length + 3;
        return this.align("center")
            .raw(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0)          // modèle 2
            .raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6)                // taille du module
            .raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)             // correction M
            .raw(0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...d)
            .raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30).raw(0x0a).align("left");
    }
    cut() { return this.raw(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0); }
    bytes() { return new Uint8Array(this.b); }
}

const n2 = (v) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)).replace(/\s/g, " ");
const n3 = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(Number(v || 0)).replace(/\s/g, " ");
const TITLES = { FV: "FACTURE DE VENTE", FT: "FACTURE D'ACOMPTE", FA: "FACTURE D'AVOIR", EV: "FACTURE DE VENTE - EXPORT",
    ET: "FACTURE D'ACOMPTE - EXPORT", EA: "FACTURE D'AVOIR - EXPORT" };

/** Ticket ESC/POS d'une facture (normalisée, en attente DGI ou provisoire hors ligne). */
export function escposTicket(t, width) {
    const e = new Esc(width);
    e.align("center").bold(true).size(2).text(t.company.name).size(1).bold(false);
    e.text(`${t.site.name} (${t.site.code})`);
    if (t.site.address || t.company.address) e.text(t.site.address || t.company.address);
    if (t.company.phone) e.text(`Tel. ${t.company.phone}`);
    e.text(`NIF ${t.company.nif || "-"}  RCCM ${t.company.rccm || "-"}`);
    if (t.company.idnat) e.text(`Id. Nat. ${t.company.idnat}`);
    e.line().bold(true).text(t.provisional ? "TICKET PROVISOIRE" : TITLES[t.type] || "FACTURE").bold(false);
    e.text(t.number || "Numero attribue a la synchronisation").text(`${t.date} - ${t.operator || ""}`).align("left");
    if (t.client_name) e.line().text(`Client : ${t.client_name}${t.client_nif ? " - NIF " + t.client_nif : ""}`);
    e.line();
    for (const l of t.lines) {
        e.text(`${l.name} [${l.tax_group}]`);
        e.pair(`  ${n3(l.quantity)} x ${n2(l.price)}${l.discount_pct ? ` (-${l.discount_pct}%)` : ""}`, n2(l.total));
    }
    e.line();
    for (const g of t.groups) e.pair(`Gr.${g.code} ${g.rate}% HT ${n2(g.base)}`, `TVA ${n2(g.tax)}`);
    e.pair("Total HT", n2(t.total_ht)).pair("Total TVA", n2(t.total_tax));
    // Double largeur : deux fois moins de caractères par ligne.
    e.bold(true).size(2).pair("TOTAL", n2(t.total), Math.floor(e.cols / 2)).size(1).bold(false).align("right").text(t.currency || "CDF").align("left");
    for (const p of t.payments) e.pair(p.label, n2(p.amount));
    if (t.change) e.pair("Rendu", n2(t.change));
    e.line();
    if (t.emcf_code) {
        e.qr(t.emcf_qr || t.verify_url);
        e.pair("Code DEF/DGI", t.emcf_code).pair("DEF NID", t.emcf_nim || "").pair("DEF Compteurs", t.emcf_counters || "")
            .pair("DEF Heure", t.emcf_datetime || "");
        if (t.simulation) e.align("center").bold(true).text("SIMULATION - SANS VALEUR FISCALE").bold(false).align("left");
    } else {
        e.align("center").bold(true).text("EN ATTENTE DE NORMALISATION").text("NE VAUT PAS FACTURE").bold(false);
        e.text("Scannez ce code pour obtenir").text("la facture normalisee :");
        e.qr(t.verify_url).align("left");
    }
    e.line().align("center");
    if (t.company.footer) e.text(t.company.footer);
    e.text("NORMA - Naxoris").cut();
    return e.bytes();
}

// ---------------------------------------------------------------- impression navigateur (page cachée)
function printHtml(html) {
    return new Promise((resolve) => {
        const frame = document.createElement("iframe");
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
        document.body.appendChild(frame);
        const done = () => { setTimeout(() => { frame.remove(); resolve(); }, 1000); };
        frame.onload = () => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.onafterprint = done;
                frame.contentWindow.print();
            } finally {
                setTimeout(done, 60000);
            }
        };
        frame.srcdoc = html;
    });
}

/** Impression d'une page du serveur (ticket normalisé) dans une page cachée. */
export function printUrl(url) {
    return new Promise((resolve) => {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
        frame.setAttribute("aria-hidden", "true");
        frame.onload = () => {
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch { /* page d'erreur */ }
            setTimeout(() => { frame.remove(); resolve(); }, 60000);
        };
        frame.src = url;
        document.body.appendChild(frame);
    });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Ticket HTML local (vente hors ligne : le serveur est injoignable). */
export function htmlTicket(t, width, qrSvgMarkup) {
    width = Number(width) === 58 ? 58 : 80;
    const rows = t.lines.map((l) => `<tr><td colspan="2">${esc(l.name)} <b>[${esc(l.tax_group)}]</b></td></tr>
        <tr><td>${n3(l.quantity)} × ${n2(l.price)}${l.discount_pct ? ` (−${Number(l.discount_pct)} %)` : ""}</td><td class="r">${n2(l.total)}</td></tr>`).join("");
    const groups = t.groups.map((g) => `<tr><td>Gr. ${esc(g.code)} (${Number(g.rate)} %) HT ${n2(g.base)}</td><td class="r">TVA ${n2(g.tax)}</td></tr>`).join("");
    const pays = t.payments.map((p) => `<tr><td>${esc(p.label)}</td><td class="r">${n2(p.amount)}</td></tr>`).join("");
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ticket</title><style>
        @page{size:${width}mm auto;margin:2mm}body{margin:0;font:11px/1.4 Arial,sans-serif;color:#000;width:${width - 4}mm}
        .c{text-align:center}.r{text-align:right;white-space:nowrap}.b{font-weight:700}hr{border:0;border-top:1px dashed #000;margin:4px 0}
        table{width:100%;border-collapse:collapse}td{padding:0;vertical-align:top}svg{width:34mm;height:34mm}</style></head><body>
        <div class="c b" style="font-size:14px">${esc(t.company.name)}</div><div class="c">${esc(t.site.name)} (${esc(t.site.code)})</div>
        <div class="c">${esc(t.site.address || t.company.address || "")}</div>
        <div class="c">NIF ${esc(t.company.nif || "—")} · RCCM ${esc(t.company.rccm || "—")}</div><hr>
        <div class="c b">${t.provisional ? "TICKET PROVISOIRE" : esc(TITLES[t.type] || "FACTURE")}</div>
        <div class="c">${esc(t.number || "Numéro attribué à la synchronisation")}</div><div class="c">${esc(t.date)} · ${esc(t.operator || "")}</div><hr>
        <table>${rows}</table><hr><table>${groups}
        <tr><td>Total HT</td><td class="r">${n2(t.total_ht)}</td></tr><tr><td>Total TVA</td><td class="r">${n2(t.total_tax)}</td></tr>
        <tr class="b" style="font-size:14px"><td>TOTAL TTC ${esc(t.currency || "CDF")}</td><td class="r">${n2(t.total)}</td></tr>${pays}
        ${t.change ? `<tr><td>Rendu</td><td class="r">${n2(t.change)}</td></tr>` : ""}</table><hr>
        <div class="c b">EN ATTENTE DE NORMALISATION<br>NE VAUT PAS FACTURE</div>
        <div class="c">${qrSvgMarkup}</div><div class="c">Scannez ce code pour obtenir la facture normalisée dès la synchronisation.</div><hr>
        <div class="c">${esc(t.company.footer || "")}</div><div class="c" style="font-size:9px">NORMA · Naxoris</div></body></html>`;
}

/** Impression d'un ticket selon le réglage du poste. ``serverUrl`` : ticket HTML du serveur s'il est joignable. */
export async function printTicket(ticket, { serverUrl = null, qrSvgMarkup = "" } = {}) {
    const s = printerSettings();
    if (s.mode === "off") return false;
    for (let i = 0; i < Math.max(1, s.copies); i++) {
        if (s.mode === "usb") {
            await send(escposTicket(ticket, s.width));
        } else if (serverUrl) {
            await printUrl(serverUrl);
        } else {
            await printHtml(htmlTicket(ticket, s.width, qrSvgMarkup));
        }
    }
    return true;
}

export async function testPrint(company) {
    const t = { company, site: { name: "Test d'impression", code: "TEST" }, provisional: false, type: "FV", number: "TEST",
        date: new Date().toLocaleString("fr-FR"), lines: [{ name: "Article de test", tax_group: "B", quantity: 1, price: 1000, total: 1000 }],
        groups: [{ code: "B", rate: 16, base: 862.07, tax: 137.93 }], total_ht: 862.07, total_tax: 137.93, total: 1000,
        payments: [{ label: "Espèces", amount: 1000 }], emcf_code: "TEST-TEST-TEST-TEST", emcf_qr: "NORMA TEST", simulation: true };
    const s = printerSettings();
    if (s.mode === "usb") return send(escposTicket(t, s.width));
    return printHtml(htmlTicket({ ...t, provisional: true }, s.width, ""));
}
