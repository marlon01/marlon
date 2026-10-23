/** @odoo-module */
import { Component, mount, onMounted, useRef, useState, whenReady, xml } from "@odoo/owl";
import { jsonrpc } from "@selecta_concours/common/rpc";
import { Icon } from "@selecta_concours/common/ui";
import { readConfig } from "@selecta_concours/common/utils";

class StaffLogin extends Component {
    static components = { Icon };
    static template = xml`
        <div class="lg-wrap">
            <form class="lg-card" t-on-submit.prevent="submit" autocomplete="on">
                <div class="sl-lang-switch lg-lang" role="group" aria-label="Langue / Language" data-no-i18n=""><button type="button" data-selecta-lang="fr" lang="fr">FR</button><button type="button" data-selecta-lang="en" lang="en">EN</button></div>
                <div class="lg-brand">
                    <img t-att-src="config.company.logo" alt="" t-on-error="(ev) => ev.target.style.display='none'"/>
                    <div>
                        <div class="lg-org" t-esc="config.company.name"/>
                        <div class="sl-muted">Console des concours</div>
                    </div>
                </div>
                <h1>Connexion du personnel</h1>
                <div t-if="state.error" class="sl-alert sl-alert-danger" role="alert" t-esc="state.error"/>
                <div class="sl-field">
                    <label for="lg-login">Identifiant</label>
                    <input id="lg-login" t-ref="login" class="sl-input" t-model="state.login" autocomplete="username" required="required"/>
                </div>
                <div class="sl-field">
                    <label for="lg-pass">Mot de passe</label>
                    <div class="lg-pass">
                        <input id="lg-pass" class="sl-input" t-att-type="state.show ? 'text' : 'password'" t-model="state.password" autocomplete="current-password" required="required"/>
                        <button type="button" class="sl-btn sl-btn-ghost sl-btn-icon" t-on-click="() => this.state.show = !this.state.show" t-att-aria-label="state.show ? 'Masquer' : 'Afficher'"><Icon name="'eye'" size="16"/></button>
                    </div>
                </div>
                <button class="sl-btn sl-btn-primary sl-btn-lg" type="submit" t-att-disabled="state.loading or !state.login or !state.password">
                    <t t-if="state.loading"><span class="sl-spinner"/> Connexion…</t><t t-else="">Se connecter</t>
                </button>
                <p class="lg-foot sl-muted">Accès réservé aux administrateurs, concepteurs, membres du jury et surveillants. Toutes les connexions sont journalisées.</p>
                <p class="lg-foot sl-muted">SELECTA by Naxoris. Démonstration : +243 828 317 540, +243 831 509 420, contact@naxoris.com</p>
                <a class="lg-cand" href="/selecta/exam"><Icon name="'key'" size="16"/>Vous êtes candidat ? Accédez à l'espace candidat</a>
            </form>
            <div class="lg-side" aria-hidden="true">
                <div class="lg-seal"><Icon name="'shield'" size="64"/></div>
                <p>SELECTA, la culture de l'excellence.</p>
                <p class="lg-side-small">Chaque opération est horodatée et scellée dans un journal infalsifiable.</p>
            </div>
        </div>`;
    static props = {};
    setup() {
        this.config = readConfig();
        this.state = useState({ login: "", password: "", error: this.config.error === "access" ? "Ce compte n'a pas accès à SELECTA." : "", loading: false, show: false });
        this.loginRef = useRef("login");
        onMounted(() => this.loginRef.el?.focus());
    }
    async submit() {
        this.state.loading = true;
        this.state.error = "";
        try {
            const res = await jsonrpc("/selecta/auth/login", { login: this.state.login, password: this.state.password });
            if (res.ok) {
                window.location.href = res.redirect || "/selecta/admin";
                return;
            }
            this.state.error = res.error;
            if (res.redirect) {
                setTimeout(() => (window.location.href = res.redirect), 2500);
            }
        } catch (e) {
            this.state.error = e.message || "Serveur injoignable.";
        } finally {
            this.state.loading = false;
        }
    }
}

whenReady(() => {
    const root = document.getElementById("selecta-root");
    root.innerHTML = "";
    mount(StaffLogin, root, { dev: false, name: "SELECTA Connexion" });
});
