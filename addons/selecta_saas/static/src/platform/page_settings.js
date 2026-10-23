/** @odoo-module */
import { Component, onMounted, onWillStart, onWillUnmount, useRef, useState, xml } from "@odoo/owl";
import { Icon, notify } from "@selecta_concours/common/ui";
import { fmtNum } from "@selecta_concours/common/utils";
import { copyText, errMessage, fmtDateTime, formDialog, MAIL_STATES, papi } from "@selecta_saas/platform/papi";

const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$/;
// « Nom <adresse> » ou adresse seule.
const FROM_RE = /^(?:[^<>]+<\s*([^<>\s]+)\s*>|([^<>\s]+))$/;
const STRIPE_RE = /^(sk_live_|sk_test_|rk_live_|rk_test_)[A-Za-z0-9_]{8,}$/;

/** Informations renvoyées par settings_get qui ne sont pas des paramètres modifiables. */
const INFO_KEYS = ["providers", "notify_urls", "mail_stats", "legal_updated", "smtp_password_set", "cinetpay_api_key_set", "stripe_secret_key_set", "flexpay_token_set"];
/** Secrets en écriture seule : jamais préremplis, envoyés uniquement s'ils sont saisis. */
const SECRET_KEYS = ["smtp_password", "cinetpay_api_key", "stripe_secret_key", "flexpay_token"];
const TRIM_KEYS = ["payment_link", "support_email", "support_phone", "issuer_name", "mail_from", "platform_notify_email",
    "smtp_host", "smtp_user", "cinetpay_site_id"];

const SECTIONS = [
    { id: "essai", label: "Essai et inscriptions", keys: ["signup_enabled", "trial_days", "grace_days", "trial_max_candidates"] },
    { id: "messagerie", label: "Messagerie", keys: ["mail_enabled", "mail_from", "platform_notify_email", "smtp_host", "smtp_port", "smtp_user", "smtp_encryption", "smtp_password"] },
    { id: "en-ligne", label: "Paiement en ligne", keys: ["flexpay_enabled", "flexpay_merchant", "flexpay_token", "flexpay_environment", "cinetpay_enabled", "cinetpay_site_id", "cinetpay_api_key", "stripe_enabled", "stripe_secret_key"] },
    { id: "hors-ligne", label: "Paiement hors ligne", keys: ["payment_instructions", "payment_link"] },
    { id: "support", label: "Support et facturation", keys: ["support_email", "support_phone", "issuer_name", "issuer_details"] },
    { id: "donnees", label: "Données personnelles", keys: ["biometric_retention_days"] },
    { id: "juridique", label: "Documents juridiques", keys: ["terms_text", "privacy_text"] },
];
const ENCRYPTION_PORTS = { none: 25, starttls: 587, ssl: 465 };

export class SettingsPage extends Component {
    static components = { Icon };
    static template = xml`
        <div class="ad-page pf-settings-page">
            <header class="ad-head">
                <div>
                    <p class="pf-eyebrow">Administration centrale</p>
                    <h1>Paramètres de la plateforme</h1>
                    <p class="sl-muted">Règles d'essai, courriels, paiement, données personnelles et documents juridiques communiqués aux structures.</p>
                </div>
            </header>
            <div t-if="state.error" class="sl-alert sl-alert-danger ad-mb" role="alert"><t t-esc="state.error"/></div>
            <div t-if="!state.form and !state.error" class="ad-loading"><span class="sl-spinner"/></div>
            <div t-if="state.form" class="pf-settings-layout">
                <nav class="pf-index" aria-label="Sections de la page" t-ref="index">
                    <p class="pf-index-title">Sur cette page</p>
                    <ul>
                        <li t-foreach="sections" t-as="sec" t-key="sec.id">
                            <a t-att-href="'#/settings'" class="pf-index-link" t-att-class="{'is-active': state.active == sec.id}"
                               t-att-aria-current="state.active == sec.id ? 'location' : false" t-att-data-sec="sec.id"
                               t-on-click.prevent="() => this.goTo(sec.id)">
                                <span t-esc="sec.label"/>
                                <span t-if="sectionErrors(sec)" class="pf-index-dot is-error" title="À corriger" aria-label="à corriger"/>
                                <span t-elif="sectionDirty(sec)" class="pf-index-dot" title="Modifié" aria-label="modifié"/>
                            </a>
                        </li>
                    </ul>
                </nav>

            <form class="pf-settings" t-on-submit.prevent="save" novalidate="novalidate">
                <t t-set="f" t-value="state.form"/>
                <t t-set="info" t-value="state.info"/>

                <!-- ============================================================ essai -->
                <section class="ad-panel pf-section" id="pf-sec-essai" aria-labelledby="pf-sec-essai-h">
                    <div class="ad-panel-head"><h2 id="pf-sec-essai-h" tabindex="-1">Essai gratuit et inscriptions</h2></div>
                    <div class="ad-form">
                        <label class="ad-toggle ad-span-2">
                            <span class="sl-switch"><input type="checkbox" t-model="f.signup_enabled"/><span/></span>
                            <span><strong>Inscriptions ouvertes</strong><small class="sl-muted">Désactivées, la page publique n'accepte plus de nouvelles structures ; les comptes existants ne sont pas affectés.</small></span>
                        </label>
                        <div class="sl-field">
                            <label for="pf-s-trial">Durée de l'essai gratuit (jours)</label>
                            <input id="pf-s-trial" class="sl-input" type="number" min="1" max="90" t-model.number="f.trial_days" t-att-aria-invalid="errors.trial_days ? 'true' : 'false'"/>
                            <span t-if="errors.trial_days" class="pf-field-error" t-esc="errors.trial_days"/>
                            <span t-else="" class="sl-help">De 1 à 90 jours. S'applique aux nouvelles inscriptions.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-grace">Délai de grâce après échéance (jours)</label>
                            <input id="pf-s-grace" class="sl-input" type="number" min="0" t-model.number="f.grace_days" t-att-aria-invalid="errors.grace_days ? 'true' : 'false'"/>
                            <span t-if="errors.grace_days" class="pf-field-error" t-esc="errors.grace_days"/>
                            <span t-else="" class="sl-help">Accès complet maintenu (statut « Paiement en retard ») avant le passage en consultation seule.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-cap">Plafond de candidats pendant l'essai</label>
                            <input id="pf-s-cap" class="sl-input" type="number" min="0" t-model.number="f.trial_max_candidates" t-att-aria-invalid="errors.trial_max_candidates ? 'true' : 'false'"/>
                            <span t-if="errors.trial_max_candidates" class="pf-field-error" t-esc="errors.trial_max_candidates"/>
                            <span t-else="" class="sl-help">Nombre total de candidats qu'une structure peut inscrire avant de souscrire. 0 = pas de plafond.</span>
                        </div>
                    </div>
                </section>

                <!-- ============================================================ messagerie -->
                <section class="ad-panel pf-section" id="pf-sec-messagerie" aria-labelledby="pf-sec-messagerie-h">
                    <div class="ad-panel-head"><h2 id="pf-sec-messagerie-h" tabindex="-1">Messagerie</h2><span class="sl-muted ad-small">Courriels d'inscription, de rappel d'échéance, de facturation et d'alerte</span></div>
                    <div class="pf-mailstats" role="group" aria-label="État de la file d'envoi">
                        <div><span class="pf-mailstats-label">En file</span><b class="sl-figures" t-esc="num(info.mail_stats.queued)"/></div>
                        <div><span class="pf-mailstats-label">Envoyés</span><b class="sl-figures" t-esc="num(info.mail_stats.sent)"/></div>
                        <div t-att-class="{'is-failed': info.mail_stats.failed}">
                            <span class="pf-mailstats-label">En échec</span><b class="sl-figures" t-esc="num(info.mail_stats.failed)"/>
                            <button t-if="info.mail_stats.failed" type="button" class="pf-linkbtn" t-on-click="toggleFailed" t-att-aria-expanded="state.failedOpen ? 'true' : 'false'" aria-controls="pf-failed">
                                <t t-esc="state.failedOpen ? 'Masquer' : 'Voir et réessayer'"/>
                            </button>
                        </div>
                    </div>
                    <div t-if="state.failedOpen" id="pf-failed" class="pf-failed">
                        <div t-if="state.failedLoading" class="ad-loading"><span class="sl-spinner"/></div>
                        <p t-elif="!state.failed.length" class="sl-muted ad-small pf-pad">Aucun message en échec.</p>
                        <table t-else="" class="ad-table pf-cards pf-mails">
                            <thead><tr><th>Destinataire</th><th>Message</th><th>Erreur</th><th class="num"><span class="sl-sr">Actions</span></th></tr></thead>
                            <tbody>
                                <tr t-foreach="state.failed" t-as="m" t-key="m.id">
                                    <td data-label="Destinataire"><span class="pf-break" t-esc="m.email_to"/><div class="sl-muted ad-small" t-esc="dt(m.date)"/></td>
                                    <td data-label="Message"><t t-esc="m.label"/><div class="sl-muted ad-small" t-esc="m.subject"/></td>
                                    <td data-label="Erreur" class="ad-small">
                                        <span t-attf-class="sl-badge {{mstates[m.state].badge}}" t-esc="mstates[m.state].label"/>
                                        <div class="pf-mail-error" t-esc="m.last_error or '—'"/>
                                    </td>
                                    <td class="num">
                                        <button t-if="m.state == 'failed'" type="button" class="sl-btn sl-btn-sm" t-on-click="() => this.retry(m)" t-att-disabled="state.retrying == m.id">
                                            <t t-if="state.retrying == m.id"><span class="sl-spinner"/> Envoi…</t><t t-else=""><Icon name="'refresh'" size="14"/>Réessayer</t>
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="ad-form">
                        <label class="ad-toggle ad-span-2">
                            <span class="sl-switch"><input type="checkbox" t-model="f.mail_enabled"/><span/></span>
                            <span><strong>Envoi des courriels activé</strong><small class="sl-muted">Les messages sont mis en file puis envoyés toutes les 5 minutes. Désactivé, rien n'est envoyé mais les messages sont conservés dans la file (ceux de plus de 7 jours sont abandonnés).</small></span>
                        </label>
                        <div t-if="!f.mail_enabled and info.mail_stats.queued" class="sl-alert sl-alert-info ad-span-2 pf-alert-tight" role="status">
                            <t t-esc="num(info.mail_stats.queued)"/> message(s) en attente : ils partiront au premier passage suivant l'activation de l'envoi.
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-from">Expéditeur</label>
                            <input id="pf-s-from" class="sl-input" t-model="f.mail_from" placeholder="SELECTA &lt;noreply@exemple.com&gt;" autocomplete="off" t-att-aria-invalid="errors.mail_from ? 'true' : 'false'"/>
                            <span t-if="errors.mail_from" class="pf-field-error" t-esc="errors.mail_from"/>
                            <span t-else="" class="sl-help">Nom et adresse affichés aux destinataires. L'adresse doit être autorisée par votre serveur SMTP.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-notify">E-mail de la plateforme pour les alertes</label>
                            <input id="pf-s-notify" class="sl-input" type="email" t-model="f.platform_notify_email" placeholder="operations@exemple.com" t-att-aria-invalid="errors.platform_notify_email ? 'true' : 'false'"/>
                            <span t-if="errors.platform_notify_email" class="pf-field-error" t-esc="errors.platform_notify_email"/>
                            <span t-else="" class="sl-help">Reçoit les nouvelles inscriptions et les paiements à valider. À défaut, l'e-mail du support est utilisé.</span>
                        </div>

                        <h3 class="ad-form-title ad-span-2">Serveur SMTP</h3>
                        <div class="sl-field">
                            <label for="pf-s-host">Hôte</label>
                            <input id="pf-s-host" class="sl-input sl-mono" t-model="f.smtp_host" placeholder="smtp.exemple.com" autocomplete="off" spellcheck="false" t-att-aria-invalid="errors.smtp_host ? 'true' : 'false'"/>
                            <span t-if="errors.smtp_host" class="pf-field-error" t-esc="errors.smtp_host"/>
                            <span t-else="" class="sl-help">Laissez vide pour utiliser le serveur d'envoi défini dans la configuration d'Odoo.</span>
                        </div>
                        <div class="pf-field-pair">
                            <div class="sl-field">
                                <label for="pf-s-port">Port</label>
                                <input id="pf-s-port" class="sl-input" type="number" min="1" max="65535" t-model.number="f.smtp_port" t-att-aria-invalid="errors.smtp_port ? 'true' : 'false'"/>
                                <span t-if="errors.smtp_port" class="pf-field-error" t-esc="errors.smtp_port"/>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-enc">Chiffrement</label>
                                <select id="pf-s-enc" class="sl-select" t-att-value="f.smtp_encryption" t-on-change="onEncryption">
                                    <option value="starttls" t-att-selected="f.smtp_encryption == 'starttls'">STARTTLS (port 587)</option>
                                    <option value="ssl" t-att-selected="f.smtp_encryption == 'ssl'">SSL/TLS (port 465)</option>
                                    <option value="none" t-att-selected="f.smtp_encryption == 'none'">Aucun (déconseillé)</option>
                                </select>
                            </div>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-user">Identifiant</label>
                            <input id="pf-s-user" class="sl-input" t-model="f.smtp_user" autocomplete="off" spellcheck="false" placeholder="Souvent l'adresse d'envoi"/>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-pass" class="pf-label-row">Mot de passe <span t-if="info.smtp_password_set" class="sl-badge sl-badge-ok pf-badge-sm">enregistré</span></label>
                            <input id="pf-s-pass" class="sl-input" type="password" autocomplete="new-password" spellcheck="false" t-model="f.smtp_password"
                                   t-att-placeholder="info.smtp_password_set ? '•••••••• — saisir pour remplacer' : ''"/>
                            <span class="sl-help">Jamais réaffiché. Laissez vide pour conserver le mot de passe enregistré.</span>
                        </div>
                    </div>
                    <div class="pf-test">
                        <div class="pf-test-row">
                            <button type="button" class="sl-btn sl-btn-sm" t-on-click="sendTest" t-att-disabled="state.testing">
                                <t t-if="state.testing"><span class="sl-spinner"/> Envoi en cours…</t><t t-else=""><Icon name="'send'" size="16"/>Envoyer un e-mail de test</t>
                            </button>
                            <span class="sl-muted ad-small">Envoi immédiat avec les paramètres enregistrés, même si l'envoi automatique est désactivé.</span>
                        </div>
                        <div t-if="state.test" t-attf-class="sl-alert {{state.test.ok ? 'sl-alert-ok' : 'sl-alert-danger'}} pf-alert-tight" role="status" aria-live="polite">
                            <t t-if="state.test.ok"><strong>Message de test envoyé à <t t-esc="state.test.to"/>.</strong> Vérifiez la boîte de réception, y compris le dossier des indésirables.</t>
                            <t t-else=""><strong>L'envoi à <t t-esc="state.test.to"/> a échoué.</strong><div class="pf-mail-error" t-esc="state.test.message"/></t>
                        </div>
                    </div>
                </section>

                <!-- ============================================================ paiement en ligne -->
                <section class="ad-panel pf-section" id="pf-sec-en-ligne" aria-labelledby="pf-sec-en-ligne-h">
                    <div class="ad-panel-head"><h2 id="pf-sec-en-ligne-h" tabindex="-1">Paiement en ligne</h2></div>
                    <p class="sl-muted pf-section-intro">La structure paie depuis sa page « Abonnement ». Le paiement est toujours vérifié auprès du prestataire avant de prolonger l'abonnement : aucune validation manuelle n'est nécessaire.</p>
                    <p class="sl-muted pf-section-intro"><strong>Choix automatique selon le pays de la structure</strong> : Mobile Money par FlexPay en RDC, par CinetPay dans les autres pays (et en RDC si FlexPay n'est pas activé) ; carte bancaire par Stripe partout.</p>
                    <div class="pf-providers">
                        <article class="pf-provider" aria-labelledby="pf-fp-h">
                            <header class="pf-provider-head">
                                <div><h3 id="pf-fp-h">FlexPay</h3><span class="sl-muted ad-small">Mobile Money en RDC</span></div>
                                <t t-set="st" t-value="providerStatus('flexpay')"/>
                                <span t-attf-class="sl-badge {{st.badge}}" t-esc="st.label"/>
                            </header>
                            <label class="ad-toggle">
                                <span class="sl-switch"><input type="checkbox" t-model="f.flexpay_enabled"/><span/></span>
                                <span><strong>Proposer FlexPay aux structures de RDC</strong></span>
                            </label>
                            <p class="pf-provider-help">M-Pesa, Orange Money, Airtel Money, Afrimoney : la demande arrive sur le téléphone du payeur, qui la valide avec son code PIN, sans quitter SELECTA. Montants en CDF ou USD.</p>
                            <span t-if="errors.flexpay_enabled" class="pf-field-error" t-esc="errors.flexpay_enabled"/>
                            <div class="sl-field">
                                <label for="pf-s-fpmerchant">Code marchand</label>
                                <input id="pf-s-fpmerchant" class="sl-input sl-mono" t-model="f.flexpay_merchant" autocomplete="off" spellcheck="false"/>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-fptoken" class="pf-label-row">Jeton d'accès <span t-if="info.flexpay_token_set" class="sl-badge sl-badge-ok pf-badge-sm">enregistré</span></label>
                                <input id="pf-s-fptoken" class="sl-input sl-mono" type="password" autocomplete="new-password" spellcheck="false" t-model="f.flexpay_token"
                                       t-att-placeholder="info.flexpay_token_set ? '•••••••• — saisir pour remplacer' : ''"/>
                                <span class="sl-help">Fourni par FlexPay. Jamais réaffiché.</span>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-fpenv">Environnement</label>
                                <select id="pf-s-fpenv" class="sl-select" t-model="f.flexpay_environment">
                                    <option value="prod">Production</option>
                                    <option value="dev">Test (bac à sable)</option>
                                </select>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-fpurl">URL de rappel</label>
                                <div class="pf-copy">
                                    <input id="pf-s-fpurl" class="sl-input sl-mono" readonly="readonly" t-att-value="info.notify_urls.flexpay" t-on-focus="(ev) => ev.target.select()"/>
                                    <button type="button" class="sl-btn" t-on-click="() => this.copy(info.notify_urls.flexpay)"><Icon name="'copy'" size="16"/>Copier</button>
                                </div>
                                <span class="sl-help">Envoyée automatiquement à chaque demande ; le statut est toujours revérifié auprès de FlexPay.</span>
                            </div>
                        </article>

                        <article class="pf-provider" aria-labelledby="pf-cp-h">
                            <header class="pf-provider-head">
                                <div><h3 id="pf-cp-h">CinetPay</h3><span class="sl-muted ad-small">Mobile Money et cartes</span></div>
                                <t t-set="st" t-value="providerStatus('cinetpay')"/>
                                <span t-attf-class="sl-badge {{st.badge}}" t-esc="st.label"/>
                            </header>
                            <label class="ad-toggle">
                                <span class="sl-switch"><input type="checkbox" t-model="f.cinetpay_enabled"/><span/></span>
                                <span><strong>Proposer CinetPay aux structures</strong></span>
                            </label>
                            <p class="pf-provider-help">Mobile Money (M-Pesa, Airtel Money, Orange Money) et cartes ; votre compte CinetPay doit accepter les paiements en USD.</p>
                            <span t-if="errors.cinetpay_enabled" class="pf-field-error" t-esc="errors.cinetpay_enabled"/>
                            <div class="sl-field">
                                <label for="pf-s-cpsite">Site ID</label>
                                <input id="pf-s-cpsite" class="sl-input sl-mono" t-model="f.cinetpay_site_id" autocomplete="off" spellcheck="false" inputmode="numeric"/>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-cpkey" class="pf-label-row">Clé API <span t-if="info.cinetpay_api_key_set" class="sl-badge sl-badge-ok pf-badge-sm">enregistrée</span></label>
                                <input id="pf-s-cpkey" class="sl-input sl-mono" type="password" autocomplete="new-password" spellcheck="false" t-model="f.cinetpay_api_key"
                                       t-att-placeholder="info.cinetpay_api_key_set ? '•••••••• — saisir pour remplacer' : ''"/>
                                <span class="sl-help">Back-office CinetPay › Intégrations. Jamais réaffichée.</span>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-cpurl">URL de notification</label>
                                <div class="pf-copy">
                                    <input id="pf-s-cpurl" class="sl-input sl-mono" readonly="readonly" t-att-value="info.notify_urls.cinetpay" t-on-focus="(ev) => ev.target.select()"/>
                                    <button type="button" class="sl-btn" t-on-click="() => this.copy(info.notify_urls.cinetpay)"><Icon name="'copy'" size="16"/>Copier</button>
                                </div>
                                <span class="sl-help">À coller dans le back-office CinetPay (URL de notification du site).</span>
                            </div>
                        </article>

                        <article class="pf-provider" aria-labelledby="pf-st-h">
                            <header class="pf-provider-head">
                                <div><h3 id="pf-st-h">Stripe</h3><span class="sl-muted ad-small">Cartes bancaires internationales</span></div>
                                <t t-set="st" t-value="providerStatus('stripe')"/>
                                <span t-attf-class="sl-badge {{st.badge}}" t-esc="st.label"/>
                            </header>
                            <label class="ad-toggle">
                                <span class="sl-switch"><input type="checkbox" t-model="f.stripe_enabled"/><span/></span>
                                <span><strong>Proposer Stripe aux structures</strong></span>
                            </label>
                            <p class="pf-provider-help">Paiement par carte sur une page Stripe Checkout, en dollars américains.</p>
                            <span t-if="errors.stripe_enabled" class="pf-field-error" t-esc="errors.stripe_enabled"/>
                            <div class="sl-field">
                                <label for="pf-s-stkey" class="pf-label-row">Clé secrète <span t-if="info.stripe_secret_key_set" class="sl-badge sl-badge-ok pf-badge-sm">enregistrée</span></label>
                                <input id="pf-s-stkey" class="sl-input sl-mono" type="password" autocomplete="new-password" spellcheck="false" t-model="f.stripe_secret_key"
                                       t-att-placeholder="info.stripe_secret_key_set ? '•••••••• — saisir pour remplacer' : 'sk_live_…'" t-att-aria-invalid="errors.stripe_secret_key ? 'true' : 'false'"/>
                                <span t-if="errors.stripe_secret_key" class="pf-field-error" t-esc="errors.stripe_secret_key"/>
                                <span t-elif="stripeTestKey" class="sl-help pf-warn-text">Clé de test : aucun paiement réel ne sera encaissé.</span>
                                <span t-else="" class="sl-help">Commence par sk_live_, sk_test_ ou rk_… (clé restreinte). Jamais réaffichée.</span>
                            </div>
                            <div class="sl-field">
                                <label for="pf-s-sturl">URL de webhook <span class="sl-muted">(facultatif)</span></label>
                                <div class="pf-copy">
                                    <input id="pf-s-sturl" class="sl-input sl-mono" readonly="readonly" t-att-value="info.notify_urls.stripe" t-on-focus="(ev) => ev.target.select()"/>
                                    <button type="button" class="sl-btn" t-on-click="() => this.copy(info.notify_urls.stripe)"><Icon name="'copy'" size="16"/>Copier</button>
                                </div>
                                <span class="sl-help">L'événement <code>checkout.session.completed</code> peut y être envoyé pour accélérer l'activation. Sans webhook, les paiements sont de toute façon vérifiés au retour de la structure puis toutes les 15 minutes.</span>
                            </div>
                        </article>
                    </div>
                    <p t-if="localUrls" class="sl-alert sl-alert-warn pf-alert-tight pf-mt" role="note">
                        Les adresses ci-dessus ne sont pas joignables depuis Internet (<span class="sl-mono" t-esc="baseHost"/>). Renseignez l'adresse publique en https de la plateforme (paramètre système <span class="sl-mono">web.base.url</span>) avant de les communiquer aux prestataires.
                    </p>
                </section>

                <!-- ============================================================ paiement hors ligne -->
                <section class="ad-panel pf-section" id="pf-sec-hors-ligne" aria-labelledby="pf-sec-hors-ligne-h">
                    <div class="ad-panel-head"><h2 id="pf-sec-hors-ligne-h" tabindex="-1">Paiement hors ligne et lien externe</h2><span class="sl-muted ad-small">Affiché aux structures sur leur page « Abonnement »</span></div>
                    <div class="ad-form">
                        <div class="sl-field ad-span-2">
                            <label for="pf-s-instr">Instructions de paiement</label>
                            <textarea id="pf-s-instr" class="sl-textarea" rows="6" t-model="f.payment_instructions"
                                      placeholder="Ex. : M-Pesa, numéro marchand 123456 (Naxoris SARL). Virement : Rawbank, compte n° … Indiquez le numéro de facture en référence."/>
                            <span class="sl-help">Numéros Mobile Money, coordonnées bancaires, mentions à reporter. La structure déclare ensuite son paiement, que vous validez dans « Paiements ». Le texte est affiché tel quel, retours à la ligne compris.</span>
                        </div>
                        <div class="sl-field ad-span-2">
                            <label for="pf-s-link">Lien de paiement externe</label>
                            <input id="pf-s-link" class="sl-input" type="url" inputmode="url" t-model="f.payment_link" placeholder="https://" t-att-aria-invalid="errors.payment_link ? 'true' : 'false'"/>
                            <span t-if="errors.payment_link" class="pf-field-error" t-esc="errors.payment_link"/>
                            <span t-else="" class="sl-help">Facultatif. Page de paiement d'un autre prestataire ; doit commencer par https://. Ces paiements restent à déclarer puis à valider manuellement.</span>
                        </div>
                    </div>
                </section>

                <!-- ============================================================ support -->
                <section class="ad-panel pf-section" id="pf-sec-support" aria-labelledby="pf-sec-support-h">
                    <div class="ad-panel-head"><h2 id="pf-sec-support-h" tabindex="-1">Support et facturation</h2></div>
                    <div class="ad-form">
                        <div class="sl-field">
                            <label for="pf-s-mail">E-mail du support</label>
                            <input id="pf-s-mail" class="sl-input" type="email" t-model="f.support_email" placeholder="support@exemple.com" t-att-aria-invalid="errors.support_email ? 'true' : 'false'"/>
                            <span t-if="errors.support_email" class="pf-field-error" t-esc="errors.support_email"/>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-phone">Téléphone du support</label>
                            <input id="pf-s-phone" class="sl-input" type="tel" t-model="f.support_phone" placeholder="+243 …"/>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-issuer">Émetteur des factures</label>
                            <input id="pf-s-issuer" class="sl-input" t-model="f.issuer_name" placeholder="Raison sociale"/>
                            <span class="sl-help">Nom figurant en tête des factures d'abonnement et des courriels.</span>
                        </div>
                        <div class="sl-field">
                            <label for="pf-s-details">Coordonnées de l'émetteur</label>
                            <textarea id="pf-s-details" class="sl-textarea" rows="4" t-model="f.issuer_details" placeholder="Adresse&#10;RCCM, Id. Nat., N° impôt&#10;Téléphone, e-mail"/>
                        </div>
                    </div>
                </section>

                <!-- ============================================================ données personnelles -->
                <section class="ad-panel pf-section" id="pf-sec-donnees" aria-labelledby="pf-sec-donnees-h">
                    <div class="ad-panel-head"><h2 id="pf-sec-donnees-h" tabindex="-1">Données personnelles</h2></div>
                    <div class="pf-retention">
                        <div class="sl-field">
                            <label for="pf-s-ret">Conservation des données biométriques</label>
                            <div class="pf-suffix">
                                <input id="pf-s-ret" class="sl-input" type="number" min="0" max="3650" t-model.number="f.biometric_retention_days" t-att-aria-invalid="errors.biometric_retention_days ? 'true' : 'false'" aria-describedby="pf-s-ret-help"/>
                                <span aria-hidden="true">jours</span>
                            </div>
                            <span t-if="errors.biometric_retention_days" class="pf-field-error" t-esc="errors.biometric_retention_days"/>
                            <span t-else="" class="sl-help">De 0 à 3 650 jours. 0 = conservation illimitée.</span>
                        </div>
                        <div class="pf-retention-text" id="pf-s-ret-help">
                            <p><strong t-esc="retentionSentence"/></p>
                            <p class="sl-muted">Sont concernés les photos d'identité, les gabarits faciaux et les clichés probatoires de surveillance. Les résultats, copies et procès-verbaux sont conservés. Cette durée est indiquée aux candidats dans la politique de confidentialité.</p>
                        </div>
                    </div>
                </section>

                <!-- ============================================================ documents juridiques -->
                <section class="ad-panel pf-section" id="pf-sec-juridique" aria-labelledby="pf-sec-juridique-h">
                    <div class="ad-panel-head">
                        <h2 id="pf-sec-juridique-h" tabindex="-1">Documents juridiques</h2>
                        <span class="sl-muted ad-small">Dernière mise à jour : <t t-esc="legalDate"/></span>
                    </div>
                    <div class="sl-alert sl-alert-info pf-alert-tight ad-mb" role="note">
                        Les textes proposés par défaut sont des modèles. Faites-les relire par un juriste, au regard du droit applicable à votre activité, avant la mise en production.
                    </div>
                    <div class="pf-legal">
                        <div class="pf-legal-fields">
                            <div class="sl-field">
                                <div class="pf-label-row pf-label-split">
                                    <label for="pf-s-terms" class="sl-label">Conditions d'utilisation</label>
                                    <a href="/selecta/conditions" target="_blank" rel="noopener" class="ad-link ad-small pf-inline">Aperçu <Icon name="'external'" size="13"/><span class="sl-sr">(nouvel onglet)</span></a>
                                </div>
                                <textarea id="pf-s-terms" class="sl-textarea pf-legal-text" rows="12" t-model="f.terms_text" placeholder="Laisser vide pour utiliser le texte par défaut." spellcheck="true"/>
                                <span class="sl-help"><t t-if="f.terms_text"><t t-esc="num(f.terms_text.length)"/> caractères.</t><t t-else="">Vide : le texte par défaut est publié.</t></span>
                            </div>
                            <div class="sl-field">
                                <div class="pf-label-row pf-label-split">
                                    <label for="pf-s-privacy" class="sl-label">Politique de confidentialité</label>
                                    <a href="/selecta/confidentialite" target="_blank" rel="noopener" class="ad-link ad-small pf-inline">Aperçu <Icon name="'external'" size="13"/><span class="sl-sr">(nouvel onglet)</span></a>
                                </div>
                                <textarea id="pf-s-privacy" class="sl-textarea pf-legal-text" rows="12" t-model="f.privacy_text" placeholder="Laisser vide pour utiliser le texte par défaut." spellcheck="true"/>
                                <span class="sl-help"><t t-if="f.privacy_text"><t t-esc="num(f.privacy_text.length)"/> caractères.</t><t t-else="">Vide : le texte par défaut est publié.</t></span>
                            </div>
                        </div>
                        <aside class="pf-syntax" aria-label="Mise en forme">
                            <h3>Mise en forme</h3>
                            <dl>
                                <div><dt><code># Titre</code></dt><dd>titre du document</dd></div>
                                <div><dt><code>## Section</code></dt><dd>intertitre</dd></div>
                                <div><dt><code>- élément</code></dt><dd>élément de liste</dd></div>
                                <div><dt>ligne vide</dt><dd>nouveau paragraphe</dd></div>
                            </dl>
                            <p>Tout autre balisage est affiché tel quel. L'aperçu montre la version enregistrée.</p>
                            <p>À l'enregistrement, la date de mise à jour devient la version acceptée par les nouvelles structures.</p>
                        </aside>
                    </div>
                </section>

                <div class="pf-savebar" t-att-class="{'is-dirty': dirty}">
                    <span class="sl-muted ad-small" aria-live="polite">
                        <t t-if="dirty and hasErrors">Modifications non enregistrées · <span class="ad-danger-text">à corriger : <t t-esc="errorSections"/></span></t>
                        <t t-elif="dirty">Modifications non enregistrées</t>
                        <t t-else="">Paramètres à jour</t>
                    </span>
                    <button type="button" class="sl-btn" t-att-disabled="!dirty or state.saving" t-on-click="revert">Annuler les modifications</button>
                    <button type="submit" class="sl-btn sl-btn-primary" t-att-disabled="!dirty or state.saving or hasErrors">
                        <t t-if="state.saving"><span class="sl-spinner"/> Enregistrement…</t><t t-else="">Enregistrer</t>
                    </button>
                </div>
            </form>
            </div>
        </div>`;
    static props = {};
    setup() {
        this.state = useState({
            form: null, saved: null, info: null, saving: false, error: "", active: SECTIONS[0].id,
            testing: false, test: null, failedOpen: false, failedLoading: false, failed: [], retrying: 0,
        });
        this.sections = SECTIONS;
        this.mstates = MAIL_STATES;
        this.indexRef = useRef("index");
        onWillStart(async () => {
            try {
                this.setData(await papi("settings_get"));
            } catch (e) {
                this.state.error = errMessage(e);
            }
        });
        this.onScroll = () => {
            if (this.raf) {
                return;
            }
            this.raf = requestAnimationFrame(() => {
                this.raf = 0;
                this.trackActive();
            });
        };
        onMounted(() => {
            window.addEventListener("scroll", this.onScroll, { passive: true });
            this.trackActive();
        });
        onWillUnmount(() => {
            window.removeEventListener("scroll", this.onScroll);
            if (this.raf) {
                cancelAnimationFrame(this.raf);
            }
        });
    }

    // ------------------------------------------------------------------ données
    splitData(data) {
        const info = {};
        const form = {};
        for (const [k, v] of Object.entries(data)) {
            (INFO_KEYS.includes(k) ? info : form)[k] = v;
        }
        info.providers = info.providers || {};
        info.notify_urls = info.notify_urls || {};
        info.mail_stats = info.mail_stats || { queued: 0, sent: 0, failed: 0 };
        return { info, form };
    }
    setData(data) {
        const { info, form } = this.splitData(data);
        for (const k of SECRET_KEYS) {
            form[k] = "";
        }
        this.state.info = info;
        this.state.saved = JSON.stringify(form);
        this.state.form = form;
    }
    /** Met à jour les indicateurs (file d'envoi, prestataires) sans toucher au formulaire en cours. */
    async refreshInfo() {
        try {
            this.state.info = this.splitData(await papi("settings_get")).info;
        } catch {
            // indicatif
        }
    }
    get savedForm() {
        return JSON.parse(this.state.saved);
    }
    changed(key) {
        const f = this.state.form;
        if (SECRET_KEYS.includes(key)) {
            return !!String(f[key] || "").trim();
        }
        return JSON.stringify(f[key]) !== JSON.stringify(this.savedForm[key]);
    }
    get dirty() {
        return JSON.stringify(this.state.form) !== this.state.saved;
    }
    sectionDirty(sec) {
        return sec.keys.some((k) => this.changed(k));
    }
    sectionErrors(sec) {
        const e = this.errors;
        return sec.keys.some((k) => e[k]);
    }
    get errorSections() {
        return SECTIONS.filter((s) => this.sectionErrors(s)).map((s) => s.label).join(", ");
    }

    // ------------------------------------------------------------------ validation
    get errors() {
        const f = this.state.form;
        const info = this.state.info;
        const e = {};
        const int = (v) => v !== "" && v !== null && Number.isInteger(Number(v));
        const str = (v) => String(v || "").trim();
        if (!int(f.trial_days) || f.trial_days < 1 || f.trial_days > 90) {
            e.trial_days = "Entre 1 et 90 jours.";
        }
        if (!int(f.grace_days) || f.grace_days < 0) {
            e.grace_days = "Nombre entier positif ou nul.";
        }
        if (!int(f.trial_max_candidates) || f.trial_max_candidates < 0) {
            e.trial_max_candidates = "Nombre entier positif ou nul.";
        }
        if (str(f.payment_link) && !str(f.payment_link).startsWith("https://")) {
            e.payment_link = "Le lien doit commencer par https://";
        }
        if (str(f.support_email) && !EMAIL_RE.test(str(f.support_email))) {
            e.support_email = "Adresse e-mail invalide.";
        }
        if (str(f.platform_notify_email) && !EMAIL_RE.test(str(f.platform_notify_email))) {
            e.platform_notify_email = "Adresse e-mail invalide.";
        }
        if (str(f.mail_from)) {
            const m = FROM_RE.exec(str(f.mail_from));
            if (!m || !EMAIL_RE.test(m[1] || m[2])) {
                e.mail_from = "Format attendu : adresse@exemple.com ou Nom <adresse@exemple.com>.";
            }
        }
        if (/\s/.test(str(f.smtp_host))) {
            e.smtp_host = "Nom d'hôte sans espace (ex. smtp.exemple.com).";
        }
        if (!int(f.smtp_port) || f.smtp_port < 1 || f.smtp_port > 65535) {
            e.smtp_port = "Port entre 1 et 65535.";
        }
        const sk = str(f.stripe_secret_key);
        if (sk && !STRIPE_RE.test(sk)) {
            e.stripe_secret_key = sk.startsWith("pk_")
                ? "Ceci est une clé publiable (pk_…) : saisissez la clé secrète sk_… ou une clé restreinte rk_…."
                : "La clé doit commencer par sk_live_, sk_test_, rk_live_ ou rk_test_.";
        }
        if (f.cinetpay_enabled && !(str(f.cinetpay_site_id) && (info.cinetpay_api_key_set || str(f.cinetpay_api_key)))) {
            e.cinetpay_enabled = "Renseignez le Site ID et la clé API pour activer CinetPay.";
        }
        if (f.flexpay_enabled && !(str(f.flexpay_merchant) && (info.flexpay_token_set || str(f.flexpay_token)))) {
            e.flexpay_enabled = "Renseignez le code marchand et le jeton pour activer FlexPay.";
        }
        if (f.stripe_enabled && !(sk || info.stripe_secret_key_set)) {
            e.stripe_enabled = "Renseignez la clé secrète pour activer Stripe.";
        }
        if (!int(f.biometric_retention_days) || f.biometric_retention_days < 0 || f.biometric_retention_days > 3650) {
            e.biometric_retention_days = "Nombre entier de 0 à 3 650.";
        }
        return e;
    }
    get hasErrors() {
        return Object.keys(this.errors).length > 0;
    }
    get stripeTestKey() {
        const sk = String(this.state.form.stripe_secret_key || "").trim();
        return /^(sk|rk)_test_/.test(sk);
    }

    // ------------------------------------------------------------------ affichage
    providerStatus(code) {
        const p = this.state.info.providers[code] || {};
        const enabled = !!this.savedForm[`${code}_enabled`];
        if (p.configured && enabled) {
            return { label: "Proposé aux structures", badge: "sl-badge-ok" };
        }
        if (p.configured) {
            return { label: "Configuré, désactivé", badge: "" };
        }
        return { label: "Non configuré", badge: enabled ? "sl-badge-warn" : "" };
    }
    get baseHost() {
        try {
            return new URL(this.state.info.notify_urls.cinetpay || this.state.info.notify_urls.stripe).origin;
        } catch {
            return "";
        }
    }
    get localUrls() {
        const origin = this.baseHost;
        return !origin || !origin.startsWith("https://") || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(origin);
    }
    get retentionSentence() {
        const d = Number(this.state.form.biometric_retention_days);
        if (!Number.isInteger(d) || d < 0) {
            return "";
        }
        if (d === 0) {
            return "Données biométriques conservées sans limite de durée.";
        }
        return `Données biométriques effacées ${fmtNum(d, 0)} jour${d > 1 ? "s" : ""} après la clôture du concours.`;
    }
    get legalDate() {
        const v = this.state.info.legal_updated;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || "");
        if (!m) {
            return "jamais (textes par défaut)";
        }
        return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    }
    num(v) {
        return fmtNum(v || 0, 0);
    }
    dt(v) {
        return fmtDateTime(v);
    }

    // ------------------------------------------------------------------ index des sections
    goTo(id) {
        const el = document.getElementById(`pf-sec-${id}`);
        if (!el) {
            return;
        }
        this.state.active = id;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        el.querySelector("h2")?.focus({ preventScroll: true });
    }
    trackActive() {
        const offset = window.innerWidth <= 900 ? 130 : 90;
        let active = SECTIONS[0].id;
        for (const s of SECTIONS) {
            const el = document.getElementById(`pf-sec-${s.id}`);
            if (el && el.getBoundingClientRect().top - offset <= 0) {
                active = s.id;
            }
        }
        // En bas de page, la dernière section est active même si elle est courte.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
            active = SECTIONS[SECTIONS.length - 1].id;
        }
        if (active !== this.state.active) {
            this.state.active = active;
        }
        // Barre horizontale (mobile) : garder l'entrée active visible.
        const nav = this.indexRef.el;
        const link = nav?.querySelector(`[data-sec="${active}"]`);
        const list = nav?.querySelector("ul");
        if (list && link && list.scrollWidth > list.clientWidth) {
            const l = link.offsetLeft - list.offsetLeft;
            if (l < list.scrollLeft || l + link.offsetWidth > list.scrollLeft + list.clientWidth) {
                list.scrollTo({ left: Math.max(0, l - 16) });
            }
        }
    }

    // ------------------------------------------------------------------ actions
    onEncryption(ev) {
        const f = this.state.form;
        const prev = ENCRYPTION_PORTS[f.smtp_encryption];
        f.smtp_encryption = ev.target.value;
        // Port standard du mode précédent : on propose celui du nouveau mode.
        if (!f.smtp_port || Number(f.smtp_port) === prev) {
            f.smtp_port = ENCRYPTION_PORTS[f.smtp_encryption];
        }
    }
    async copy(text) {
        const ok = await copyText(text || "");
        notify(ok ? "Adresse copiée dans le presse-papiers." : "Copie impossible : sélectionnez l'adresse manuellement.", ok ? "ok" : "warn");
    }
    revert() {
        this.state.form = JSON.parse(this.state.saved);
    }
    payload() {
        const f = this.state.form;
        const vals = {};
        for (const k of Object.keys(f)) {
            if (INFO_KEYS.includes(k) || !this.changed(k)) {
                continue;
            }
            vals[k] = TRIM_KEYS.includes(k) || SECRET_KEYS.includes(k) ? String(f[k] || "").trim() : f[k];
        }
        return vals;
    }
    async save() {
        if (this.hasErrors || !this.dirty) {
            return;
        }
        const vals = this.payload();
        this.state.saving = true;
        try {
            this.setData(await papi("settings_save", [vals]));
            notify("Paramètres enregistrés.", "ok");
        } catch (e) {
            notify(errMessage(e), "danger", 7000);
        } finally {
            this.state.saving = false;
        }
    }
    async sendTest() {
        const saved = this.savedForm;
        const res = await formDialog({
            title: "Envoyer un e-mail de test",
            body:
                "Le message part immédiatement avec les paramètres enregistrés, même si l'envoi automatique est désactivé." +
                (this.sectionDirty(SECTIONS[1]) ? "\n\nLa section Messagerie contient des modifications non enregistrées : elles ne seront pas utilisées pour ce test." : ""),
            confirmLabel: "Envoyer",
            fields: [{
                name: "email", label: "Adresse de destination", type: "text", required: true,
                value: saved.platform_notify_email || saved.support_email || "", placeholder: "vous@exemple.com",
            }],
        });
        if (!res) {
            return;
        }
        const to = res.email;
        if (!EMAIL_RE.test(to)) {
            this.state.test = { ok: false, to, message: "Adresse e-mail invalide." };
            return;
        }
        this.state.testing = true;
        this.state.test = null;
        try {
            await papi("mail_test", [to]);
            this.state.test = { ok: true, to };
        } catch (e) {
            this.state.test = { ok: false, to, message: errMessage(e) };
        } finally {
            this.state.testing = false;
            this.refreshInfo();
        }
    }
    async toggleFailed() {
        this.state.failedOpen = !this.state.failedOpen;
        if (this.state.failedOpen) {
            await this.loadFailed();
        }
    }
    async loadFailed() {
        this.state.failedLoading = true;
        try {
            this.state.failed = await papi("mails_list", ["failed"]);
        } catch (e) {
            notify(errMessage(e), "danger");
        } finally {
            this.state.failedLoading = false;
        }
    }
    async retry(m) {
        this.state.retrying = m.id;
        try {
            const res = await papi("mail_retry", [m.id]);
            if (res && res.state === "sent") {
                notify(`Message envoyé à ${res.email_to}.`, "ok");
                this.state.failed = this.state.failed.filter((x) => x.id !== m.id);
            } else if (res) {
                notify(`Nouvel échec : ${res.last_error || "erreur inconnue"}. Le message reste en file pour un prochain essai.`, "warn", 8000);
                Object.assign(m, res);
            }
        } catch (e) {
            notify(errMessage(e), "danger", 7000);
        } finally {
            this.state.retrying = 0;
            this.refreshInfo();
        }
    }
}
