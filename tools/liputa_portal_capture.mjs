// Captures du portail client Liputa (/c) pour le film et la revue visuelle.
// Usage : PLAYWRIGHT=<playwright/index.mjs> CHROME=<chrome headless> node tools/liputa_portal_capture.mjs
// Base préparée par tools/liputa_film_seed.py puis tools/liputa_portal_seed.py.
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const OUT = process.env.OUT || new URL("../film/liputa/assets/screens", import.meta.url).pathname;
const B = process.env.ODOO_URL || "http://localhost:8069";
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: "Africa/Kinshasa" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (path, name, full = true) => {
  await page.goto(`${B}${path}`); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("ok", name, page.url());
};
await shot("/c", "20_annuaire");
const nadege = await page.locator(".lp-ws-main").first().getAttribute("href");
await shot(nadege, "21_fiche_atelier");
await page.goto(`${B}/c/connexion?redirect=/c/commandes`);
await page.fill('input[name="login"]', "chantal@demo.cd");
await page.fill('input[name="password"]', "Liputa-demo-2026");
await Promise.all([page.waitForNavigation(), page.locator('form button[type="submit"]').click()]);
await shot("/c/commandes", "22_mes_commandes");
const first = await page.locator(".lp-list a.lp-row").first().getAttribute("href");
await shot(first, "23_commande_suivie");
await shot(nadege + "#avis", "24_fiche_connectee");
console.log("errors", JSON.stringify(errors));
await browser.close();
