// Captures du film Liputa (atelier de tools/liputa_film_seed.py).
// Usage : PLAYWRIGHT=<chemin de playwright/index.mjs> CHROME=<chrome headless> node tools/liputa_film_capture.mjs
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");
const OUT = new URL("../film/liputa/assets/screens", import.meta.url).pathname;
const B = process.env.ODOO_URL || "http://localhost:8069";
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: "Africa/Kinshasa" });
const page = await ctx.newPage();
await page.goto(`${B}/app/login`);
await page.fill('input[name="login"]', "nadege@demo.cd");
await page.fill('input[name="password"]', "Liputa-demo-2026");
await Promise.all([page.waitForNavigation(), page.locator('button[type="submit"], form button').first().click()]);
const shot = async (hash, name, full = false, action) => {
  await page.goto(`${B}/app${hash}`); await page.waitForTimeout(1800);
  if (action) { await action(); await page.waitForTimeout(1000); }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("ok", name);
};
await shot("#/", "01_accueil", true);
await shot("#/orders", "02_commandes", true);
await shot("#/order/1", "03_commande_chantal", true);
await shot("#/order/4", "04_commande_en_couture", true);
await shot("#/order/1/measures", "05_mesures", true);
await shot("#/order/1/fitting", "06_essayage");
await shot("#/order/1/pattern", "07_patron", true);
await shot("#/planning", "08_planning_vendredi", true);
await shot("#/planning", "09_planning_samedi", true, () => page.getByText("sam", { exact: true }).first().click());
await shot("#/catalogue", "10_catalogue");
await shot("#/new", "11_nouvelle_commande");
const t = await browser.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2, locale: "fr-FR" });
// Lien de suivi public d'une commande prête (affiché par le script de données, propre à chaque base).
if (process.env.TRACKING_URL) { await t.goto(process.env.TRACKING_URL); await t.waitForTimeout(1500);
await t.screenshot({ path: `${OUT}/12_suivi_client.png`, fullPage: true }); console.log("ok suivi"); }
await browser.close();
