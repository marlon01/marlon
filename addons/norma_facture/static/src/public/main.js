/** @odoo-module */
import { Component, mount, useState, whenReady, xml } from "@odoo/owl";
import { post, readConfig } from "@norma_facture/common/rpc";
import { Icon } from "@norma_facture/common/ui";

const CONFIG = readConfig();
const CAT_ICONS = { cart: "cart", bag: "store", pill: "plus", fuel: "tool", bed: "bed", utensils: "utensils", briefcase: "briefcase", factory: "building" };

/* Panneau gauche commun : un ticket normalisé, l'objet que produit NORMA. */
class AuthSide extends Component {
    static template = xml`
        <aside class="nm-auth-side">
            <a class="nm-logo" href="/norma"><img src="/norma_facture/static/description/icon.png" alt=""/><b>NORMA</b></a>
            <h1>Vos factures normalisées, validées par la DGI à chaque vente.</h1>
            <p>Caisse de supermarché, réception d'hôtel, additions du restaurant ou factures aux entreprises : chaque document part au dispositif fiscal de la DGI et revient avec son code et son QR code.</p>
            <div class="nm-seal" aria-hidden="true">
                <div style="text-align:center;font-weight:700">FACTURE DE VENTE</div>
                <div style="text-align:center">KIN-01-FV-2026-000184</div>
                <hr/>
                <div class="nm-seal-row"><span>Riz parfumé 5 kg  [C]</span><span>32 000</span></div>
                <div class="nm-seal-row"><span>Eau minérale 1,5 L ×4  [B]</span><span>6 000</span></div>
                <div class="nm-seal-row"><span>Jus de fruits 1 L  [B]</span><span>6 500</span></div>
                <hr/>
                <div class="nm-seal-row" style="font-weight:700;font-size:14px"><span>TOTAL TTC CDF</span><span>44 500</span></div>
                <div class="nm-seal-stamp">
                    <svg width="44" height="44" viewBox="0 0 7 7"><path fill="currentColor" d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM1 1v1h1V1zM5 1v1h1V1zM1 5v1h1V5zM4 4h1v1H4zM6 4h1v1H6zM5 5h1v1H5zM4 6h1v1H4zM6 6h1v1H6z"/></svg>
                    <div><b>Normalisée DGI</b><br/>Code DEF : 7KQ2-MB4C-HT9X-31PZ<br/>Compteurs 184/184 FV</div>
                </div>
            </div>
            <div class="nm-auth-foot">NORMA by Naxoris · <a href="tel:+243828317540">+243 828 317 540</a> · <a href="tel:+243831509420">+243 831 509 420</a></div>
        </aside>`;
    static props = {};
}

class LoginApp extends Component {
    static template = xml`
        <div class="nm-auth">
            <AuthSide/>
            <main class="nm-auth-main">
                <form class="nm-auth-card" t-on-submit.prevent="submit">
                    <h2>Connexion</h2>
                    <p>Accédez à l'espace de votre entreprise.</p>
                    <div t-if="state.error" class="nm-error" role="alert" t-esc="state.error"/>
                    <div class="nm-stack">
                        <label class="nm-field"><span>Adresse e-mail</span>
                            <input class="nm-input" type="email" autocomplete="username" required="1" t-model="state.login" autofocus="1"/></label>
                        <label class="nm-field"><span>Mot de passe</span>
                            <input class="nm-input" type="password" autocomplete="current-password" required="1" t-model="state.password"/></label>
                        <button class="nm-btn nm-btn-primary nm-btn-lg nm-btn-block" type="submit" t-att-disabled="state.busy">
                            <span t-if="state.busy" class="nm-spinner" style="border-top-color:#fff"/> Se connecter
                        </button>
                    </div>
                    <p style="margin-top:22px;color:var(--muted)">Votre entreprise n'a pas encore de compte ? <a href="/norma/signup">Créer un compte</a></p>
                </form>
            </main>
        </div>`;
    static components = { AuthSide };
    static props = {};
    setup() {
        this.state = useState({ login: "", password: "", busy: false,
            error: CONFIG.error === "access" ? "Ce compte n'a pas accès à cet espace." : "" });
    }
    async submit() {
        this.state.busy = true;
        this.state.error = "";
        try {
            const res = await post("/norma/auth/login", { login: this.state.login, password: this.state.password });
            if (res.ok || res.redirect) {
                window.location.href = res.redirect;
                return;
            }
            this.state.error = res.error;
        } catch (err) {
            this.state.error = err.message;
        }
        this.state.busy = false;
    }
}

class SignupApp extends Component {
    static template = xml`
        <div class="nm-auth">
            <AuthSide/>
            <main class="nm-auth-main">
                <form class="nm-auth-card is-wide" t-on-submit.prevent="next" novalidate="1">
                    <h2>Créer le compte de votre entreprise</h2>
                    <p>Vous pourrez facturer en mode démonstration dès la fin de l'inscription, puis relier vos établissements au dispositif fiscal de la DGI.</p>
                    <ol class="nm-steps">
                        <li t-foreach="steps" t-as="s" t-key="s_index" t-att-class="s_index &lt; state.step ? 'is-done' : (s_index === state.step ? 'is-on' : '')" t-esc="s"/>
                    </ol>
                    <div t-if="state.error" class="nm-error" role="alert" t-esc="state.error"/>

                    <t t-if="state.step === 0">
                        <div class="nm-cats" role="radiogroup" aria-label="Catégorie d'activité">
                            <button type="button" t-foreach="categories" t-as="c" t-key="c.code" class="nm-cat" role="radio"
                                    t-att-aria-checked="state.f.category === c.code ? 'true' : 'false'"
                                    t-att-class="{'is-on': state.f.category === c.code}" t-on-click="() => this.state.f.category = c.code">
                                <span class="nm-cat-ico"><Icon name="icon(c)" size="20"/></span>
                                <span><b t-esc="c.name"/><small t-esc="c.description"/></span>
                            </button>
                        </div>
                    </t>

                    <div t-if="state.step === 1" class="nm-grid-2">
                        <label class="nm-field nm-span-2"><span>Raison sociale</span><input class="nm-input" t-model="state.f.company" maxlength="120"/></label>
                        <label class="nm-field"><span>NIF</span><input class="nm-input" t-model="state.f.nif" maxlength="32" placeholder="A1234567B" style="text-transform:uppercase"/><small>Numéro impôt attribué par la DGI.</small></label>
                        <label class="nm-field"><span>RCCM</span><input class="nm-input" t-model="state.f.rccm" maxlength="60" placeholder="CD/KNG/RCCM/24-B-01234"/></label>
                        <label class="nm-field"><span>Identification nationale</span><input class="nm-input" t-model="state.f.idnat" maxlength="60"/></label>
                        <label class="nm-field"><span>Régime fiscal</span>
                            <select class="nm-select" t-model="state.f.regime">
                                <option value="reel">Assujetti à la TVA (régime réel)</option>
                                <option value="ipr">Non assujetti à la TVA</option>
                            </select></label>
                        <label class="nm-field nm-span-2"><span>Adresse</span><input class="nm-input" t-model="state.f.address" maxlength="160" placeholder="Numéro, avenue, quartier, commune"/></label>
                        <label class="nm-field"><span>Ville</span><input class="nm-input" t-model="state.f.city" maxlength="60"/></label>
                        <label class="nm-field"><span>Devise de vos prix</span>
                            <select class="nm-select" t-model="state.f.currency">
                                <option value="CDF">Franc congolais (CDF)</option>
                                <option value="USD">Dollar américain (USD)</option>
                            </select><small>Les montants transmis à la DGI sont toujours en CDF.</small></label>
                    </div>

                    <div t-if="state.step === 2" class="nm-grid-2">
                        <div class="nm-note nm-span-2">Un établissement est un point de vente : magasin, hôtel, agence. Chacun a son code, imprimé sur ses factures et transmis à la DGI. Vous pourrez en ajouter d'autres ensuite.</div>
                        <label class="nm-field"><span>Nom de l'établissement</span><input class="nm-input" t-model="state.f.site_name" maxlength="80" placeholder="Siège — Gombe"/></label>
                        <label class="nm-field"><span>Code établissement</span><input class="nm-input" t-model="state.f.site_code" maxlength="24" placeholder="KIN-01" style="text-transform:uppercase"/><small>Majuscules, chiffres et tirets.</small></label>
                    </div>

                    <div t-if="state.step === 3" class="nm-grid-2">
                        <label class="nm-field"><span>Votre nom</span><input class="nm-input" t-model="state.f.contact" maxlength="80" autocomplete="name"/></label>
                        <label class="nm-field"><span>Téléphone</span><input class="nm-input" t-model="state.f.phone" maxlength="40" autocomplete="tel" placeholder="+243 8…"/></label>
                        <label class="nm-field nm-span-2"><span>Adresse e-mail (identifiant)</span><input class="nm-input" type="email" t-model="state.f.email" maxlength="120" autocomplete="email"/></label>
                        <label class="nm-field nm-span-2"><span>Mot de passe</span><input class="nm-input" type="password" t-model="state.f.password" autocomplete="new-password"/><small>10 caractères au moins, avec des lettres et des chiffres.</small></label>
                        <input class="nm-honey" tabindex="-1" autocomplete="off" aria-hidden="true" t-model="state.f.website"/>
                        <label class="nm-check nm-span-2"><input type="checkbox" t-model="state.f.terms"/><span>J'accepte les conditions d'utilisation et j'atteste que les informations fiscales saisies sont exactes.</span></label>
                    </div>

                    <div class="nm-auth-actions">
                        <button type="button" class="nm-btn" t-if="state.step > 0" t-on-click="() => { this.state.step--; this.state.error = ''; }">Retour</button>
                        <a t-else="" class="nm-btn nm-btn-ghost" href="/norma/login">J'ai déjà un compte</a>
                        <button type="submit" class="nm-btn nm-btn-primary nm-btn-lg" t-att-disabled="state.busy">
                            <span t-if="state.busy" class="nm-spinner" style="border-top-color:#fff"/>
                            <t t-esc="state.step === 3 ? 'Créer le compte' : 'Continuer'"/>
                        </button>
                    </div>
                </form>
            </main>
        </div>`;
    static components = { AuthSide, Icon };
    static props = {};
    setup() {
        this.categories = CONFIG.categories || [];
        this.steps = ["Activité", "Entreprise", "Établissement", "Compte"];
        this.state = useState({ step: 0, busy: false, error: "", f: {
            category: CONFIG.category || "", company: "", nif: "", rccm: "", idnat: "", regime: "reel", address: "",
            city: "Kinshasa", currency: "CDF", site_name: "", site_code: "", contact: "", phone: "", email: "",
            password: "", terms: false, website: "",
        } });
    }
    icon(c) {
        return CAT_ICONS[c.icon] || "store";
    }
    check() {
        const f = this.state.f;
        const need = [
            [["category", "Choisissez votre catégorie d'activité."]],
            [["company", "Indiquez la raison sociale."], ["nif", "Indiquez le NIF."], ["address", "Indiquez l'adresse."]],
            [],
            [["contact", "Indiquez votre nom."], ["email", "Indiquez votre adresse e-mail."], ["password", "Choisissez un mot de passe."]],
        ][this.state.step];
        for (const [key, msg] of need) {
            if (!String(f[key] || "").trim()) return msg;
        }
        if (this.state.step === 1 && !/^[A-Za-z0-9][A-Za-z0-9\-/ ]{4,30}$/.test(f.nif.trim())) return "NIF invalide.";
        if (this.state.step === 2 && f.site_code && !/^[A-Za-z0-9][A-Za-z0-9-]{1,23}$/.test(f.site_code.trim())) return "Code établissement invalide.";
        if (this.state.step === 3) {
            if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(f.email.trim())) return "Adresse e-mail invalide.";
            if (f.password.length < 10 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) return "Mot de passe : 10 caractères au moins, avec des lettres et des chiffres.";
            if (!f.terms) return "Acceptez les conditions d'utilisation pour continuer.";
        }
        return "";
    }
    async next() {
        this.state.error = this.check();
        if (this.state.error) return;
        if (this.state.step < 3) {
            this.state.step++;
            return;
        }
        this.state.busy = true;
        try {
            const res = await post("/norma/auth/signup", { ...this.state.f });
            if (res.ok) {
                window.location.href = res.redirect;
                return;
            }
            this.state.error = res.error;
        } catch (err) {
            this.state.error = err.message;
        }
        this.state.busy = false;
    }
}

whenReady(() => {
    const root = document.getElementById("norma-root");
    root.replaceChildren();
    mount(CONFIG.app === "signup" ? SignupApp : LoginApp, root, { dev: false });
});
