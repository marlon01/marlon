/** @odoo-module */
/* Bandeau d'échéance affiché en tête de toutes les pages de la console d'une structure abonnée. */
import { Component, onWillUnmount, useState, xml } from "@odoo/owl";
import { hasRole } from "@selecta_concours/admin/store";
import { api } from "@selecta_concours/common/rpc";
import { Icon } from "@selecta_concours/common/ui";
import { currentSummary, daysLabel, fmtDate, saasBus } from "@selecta_saas/tenant/common";

const DISMISS_KEY = "selecta.saas.banner.dismissed";

function readDismissed() {
    try {
        return sessionStorage.getItem(DISMISS_KEY) || "";
    } catch {
        return "";
    }
}

export class SubscriptionBanner extends Component {
    static components = { Icon };
    static template = xml`
        <t t-set="b" t-value="banner"/>
        <div t-if="b" t-attf-class="ss-banner is-{{b.tone}}" t-att-role="b.critical ? 'alert' : 'status'">
            <span class="ss-banner-icon"><Icon name="b.icon" size="18"/></span>
            <p class="ss-banner-text">
                <strong t-esc="b.title"/>
                <span t-if="b.detail" class="ss-banner-detail" t-esc="b.detail"/>
            </p>
            <div class="ss-banner-actions">
                <a t-if="b.cta and !onSubscriptionPage" href="#/subscription" class="sl-btn sl-btn-sm" t-att-class="b.critical ? 'sl-btn-ink' : ''" t-esc="b.cta"/>
                <button t-if="!b.critical" type="button" class="sl-btn sl-btn-ghost sl-btn-icon ss-banner-close"
                        title="Masquer jusqu'à la prochaine connexion" aria-label="Masquer ce bandeau" t-on-click="dismiss">
                    <Icon name="'x'" size="16"/>
                </button>
            </div>
        </div>`;
    static props = {};

    setup() {
        this.bus = useState(saasBus);
        this.state = useState({ dismissed: readDismissed(), hash: location.hash });
        this.onHash = () => (this.state.hash = location.hash);
        window.addEventListener("hashchange", this.onHash);
        onWillUnmount(() => window.removeEventListener("hashchange", this.onHash));
        const s = currentSummary();
        if (s && s.state === "suspended" && hasRole("admin") && !saasBus.support) {
            // Les coordonnées du support ne figurent que dans billing_info (réservé aux administrateurs).
            api("billing_info")
                .then((info) => (saasBus.support = { email: info.support_email, phone: info.support_phone }))
                .catch(() => {});
        }
    }

    get onSubscriptionPage() {
        return /^#\/subscription\b/.test(this.state.hash || "");
    }

    /** Clé de masquage : un changement d'état ou d'échéance fait réapparaître le bandeau. */
    get dismissKey() {
        const s = currentSummary();
        return s ? `${s.state}:${s.days_left}` : "";
    }

    get banner() {
        const s = this.bus.summary || currentSummary();
        if (!s) {
            return null; // structure hôte : jamais de bandeau
        }
        const admin = hasRole("admin");
        let b = null;
        if (s.state === "trial") {
            b = {
                tone: s.days_left <= 3 ? "warn" : "info",
                icon: "clock",
                title: `Essai gratuit — ${daysLabel(s.days_left)}`,
                detail: s.trial_end ? `jusqu'au ${fmtDate(s.trial_end)}` : "",
                cta: admin ? "Choisir un abonnement" : "",
            };
        } else if (s.state === "active") {
            if (s.days_left > 7) {
                return null;
            }
            b = {
                tone: "info",
                icon: "clock",
                title: `Abonnement « ${s.plan.name} » : ${daysLabel(s.days_left)}`,
                detail: s.period_end ? `échéance le ${fmtDate(s.period_end)}` : "",
                cta: admin ? "Renouveler" : "",
            };
        } else if (s.state === "past_due") {
            b = {
                tone: "warn",
                critical: true,
                icon: "alert",
                title: `Échéance dépassée : régularisez avant le ${fmtDate(s.grace_end)}`,
                detail: "pour conserver l'accès complet à la console.",
                cta: admin ? "Régulariser" : "",
            };
        } else if (s.state === "expired") {
            const what = s.period_end ? "Votre abonnement est terminé" : "Votre essai est terminé";
            b = {
                tone: "danger",
                critical: true,
                icon: "lock",
                title: `${what} : console en consultation seule`,
                detail: admin
                    ? "Vos concours et résultats restent consultables ; souscrivez pour reprendre la création et les inscriptions."
                    : "Vos concours et résultats restent consultables. Votre administrateur peut souscrire un abonnement.",
                cta: admin ? "Souscrire un abonnement" : "",
            };
        } else if (s.state === "suspended") {
            const sup = this.bus.support;
            const contact = sup && (sup.email || sup.phone)
                ? `Contactez le support SELECTA : ${[sup.email, sup.phone].filter(Boolean).join(" · ")}.`
                : admin
                ? "Contactez le support SELECTA pour rétablir l'accès."
                : "Contactez l'administrateur de votre structure ou le support SELECTA.";
            b = { tone: "blocked", critical: true, icon: "lock", title: "Compte suspendu", detail: contact, cta: admin ? "Voir l'abonnement" : "" };
        }
        if (!b) {
            return null;
        }
        if (!b.critical && this.state.dismissed === this.dismissKey) {
            return null;
        }
        if (s.access === "readonly" && s.state !== "expired") {
            b.detail = `${b.detail} Console en consultation seule.`.trim();
        }
        return b;
    }

    dismiss() {
        const key = this.dismissKey;
        this.state.dismissed = key;
        try {
            sessionStorage.setItem(DISMISS_KEY, key);
        } catch {
            // stockage indisponible (navigation privée) : masquage pour cette page seulement
        }
    }
}
