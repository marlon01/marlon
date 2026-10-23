// Captures du film SELECTA (concours de tools/selecta_film_seed.py), en français, à 2x.
// Usage : PLAYWRIGHT=<chemin de playwright/index.mjs> CHROME=<chrome headless> PHASE=ouvert|publie \
//         node tools/selecta_film_capture.mjs
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const OUT = new URL("../film/selecta/assets/screens", import.meta.url).pathname;
const B = process.env.ODOO_URL || "http://localhost:8069";
const PHASE = process.env.PHASE || "ouvert";
const ID = process.env.CONCOURS_ID || "1";
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 2, locale: "fr-FR" });
await ctx.addInitScript(() => { try { localStorage.setItem("selecta.lang", "fr"); } catch (e) {} });
const page = await ctx.newPage();
await page.goto(`${B}/selecta/login`);
await page.fill("#lg-login", "admin");
await page.fill("#lg-pass", "admin");
await Promise.all([page.waitForURL(/selecta\/(admin|platform)/), page.locator('button[type="submit"]').click()]);
const shot = async (hash, name, full = false) => {
  await page.goto(`${B}/selecta/admin${hash}`); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("ok", name);
};
if (PHASE === "ouvert") {
  await shot(`#/monitor/${ID}`, "20_surveillance");
  await shot(`#/results/${ID}`, "21_resultats_provisoires");
  await shot(`#/dashboard`, "22_tableau_de_bord");
} else {
  await shot(`#/results/${ID}`, "30_resultats_publies");
  await shot(`#/audit`, "31_journal_audit");
  // Espace candidat : saisie du code, puis le résultat (le candidat a déjà composé).
  const cand = await browser.newContext({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 2, locale: "fr-FR" });
  await cand.addInitScript(() => { try { localStorage.setItem("selecta.lang", "fr"); } catch (e) {} });
  const cp = await cand.newPage();
  await cp.goto(`${B}/selecta/exam`); await cp.waitForTimeout(2000);
  await cp.locator(".ex-code-input").pressSequentially(process.env.CODE || "K7QPM4XR9TBA", { delay: 30 });
  await cp.waitForTimeout(600);
  await cp.screenshot({ path: `${OUT}/33_candidat_code.png` }); console.log("ok code");
  await cp.locator('form button[type="submit"]').first().click(); await cp.waitForTimeout(3000);
  await cp.screenshot({ path: `${OUT}/34_candidat_resultat.png` }); console.log("ok resultat");
  const digest = process.env.DIGEST;
  if (digest) {
    const v = await browser.newPage({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 2, locale: "fr-FR" });
    await v.goto(`${B}/selecta/verify/${digest}`); await v.waitForTimeout(1500);
    await v.screenshot({ path: `${OUT}/32_verification.png`, fullPage: true }); console.log("ok verification");
  }
}
await browser.close();
