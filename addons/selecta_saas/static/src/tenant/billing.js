/** @odoo-module */
/* Page « Abonnement » de la console d'une structure : catégorie, consommation, offres, paiement, factures. */
import { locale } from "@selecta_concours/common/i18n";
import { Component, onMounted, onWillStart, onWillUnmount, onWillUpdateProps, useRef, useState, xml } from "@odoo/owl";
import { extensions, store } from "@selecta_concours/admin/store";
import { api } from "@selecta_concours/common/rpc";
import { confirmDialog, Icon, notify } from "@selecta_concours/common/ui";
import { fmtDateTime, fmtNum, readFileAsDataURL } from "@selecta_concours/common/utils";
import { SubscriptionBanner } from "@selecta_saas/tenant/banner";
import { CheckoutDialog } from "@selecta_saas/tenant/checkout_dialog";
import {
    CYCLE_LABELS, FEATURE_LABELS, INVOICE_BADGE, LEGAL_LINKS, TENANT_BADGE, daysLabel, fmtDate, fmtMoney, paidOnline, providerName, quoted,
    saasBus,
} from "@selecta_saas/tenant/common";
import { printInvoice } from "@selecta_saas/tenant/invoice_print";

const PROOF_MAX = 5 * 1024 * 1024;
const PROOF_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const PAYMENT_RESULTS = ["paid", "pending", "failed", "none"];

export class SubscriptionPage extends Component {
    static components = { Icon, CheckoutDialog };
    static template = xml`
        <div class="ad-page ss-page">
            <header class="ad-head">
                <div>
                    <h1>Abonnement</h1>
                    <p class="sl-muted">Catégorie, consommation, paiements et factures de votre structure.</p>
                </div>
                <div t-if="state.info" class="ad-head-actions">
                    <button class="sl-btn sl-btn-ghost sl-btn-sm" t-on-click="() => this.load()" t-att-disabled="state.loading"><Icon name="'refresh'" size="16"/>Actualiser</button>
                </div>
            </header>

            <section t-if="state.payResult and state.info" t-attf-class="ss-result is-{{payTone}}" t-att-role="state.payResult.status == 'failed' ? 'alert' : 'status'"
                     aria-labelledby="ss-result-title" tabindex="-1" id="ss-result">
                <span class="ss-result-icon"><Icon name="payIcon" size="22"/></span>
                <div class="ss-result-text">
                    <t t-if="state.payResult.status == 'paid'">
                        <h2 id="ss-result-title" t-esc="state.payResult.credit ? 'Changement de catégorie effectué' : 'Paiement confirmé'"/>
                        <p t-if="state.payResult.credit">Le montant a été entièrement couvert par l'avoir de votre abonnement précédent : aucun paiement n'est nécessaire.
                            <t t-if="state.info.tenant.period_end">Abonnement <t t-esc="quoted(state.info.tenant.plan.name)"/> actif jusqu'au <strong t-esc="date(state.info.tenant.period_end)"/>.</t></p>
                        <p t-elif="state.info.tenant.period_end">Abonnement <t t-esc="quoted(state.info.tenant.plan.name)"/> actif jusqu'au <strong t-esc="date(state.info.tenant.period_end)"/>. Un reçu vous a été envoyé par e-mail ; la facture est disponible ci-dessous.</p>
                        <p t-else="">Votre abonnement est actif. La facture acquittée est disponible ci-dessous.</p>
                        <p t-if="lastPaid and lastPaid.deferred_plan and !lastPaid.plan_applied" class="ad-small">La catégorie <t t-esc="quoted(lastPaid.plan)"/> s'appliquera le <t t-esc="date(lastPaid.period_start)"/>.</p>
                    </t>
                    <t t-elif="state.payResult.status == 'pending'">
                        <h2 id="ss-result-title">Paiement en cours de confirmation par l'opérateur…</h2>
                        <p>Certaines transactions Mobile Money sont confirmées après quelques minutes. Votre abonnement sera activé automatiquement ;
                            vous pouvez aussi vérifier maintenant. Ne payez pas une seconde fois.</p>
                        <p t-if="onlineInvoice and onlineInvoice.online_message" class="ad-small">Réponse de l'opérateur : <t t-esc="quoted(onlineInvoice.online_message)"/></p>
                    </t>
                    <t t-elif="state.payResult.status == 'failed'">
                        <h2 id="ss-result-title">Le paiement n'a pas abouti</h2>
                        <p>L'opérateur n'a pas confirmé la transaction<t t-if="onlineInvoice and onlineInvoice.online_message"> : <t t-esc="quoted(onlineInvoice.online_message)"/></t>.
                            Votre facture reste à régler : vous pouvez réessayer, choisir un autre moyen de paiement ou régler hors ligne.</p>
                    </t>
                    <t t-else="">
                        <h2 id="ss-result-title">Aucun paiement en ligne constaté</h2>
                        <p>La transaction a peut-être été abandonnée avant sa validation. Si vous avez été débité, contactez le support SELECTA<t t-if="supportLine"> : <t t-esc="supportLine"/></t>.</p>
                    </t>
                </div>
                <div class="ss-result-actions">
                    <button t-if="state.payResult.status == 'pending' and onlineInvoice" class="sl-btn sl-btn-sm sl-btn-primary" t-att-disabled="state.checking" t-on-click="checkOnline">
                        <span t-if="state.checking" class="sl-spinner"/><Icon t-else="" name="'refresh'" size="16"/>Vérifier maintenant
                    </button>
                    <button t-if="['failed', 'none'].includes(state.payResult.status) and current and current.state != 'pending'" class="sl-btn sl-btn-sm sl-btn-primary" t-on-click="retryPayment">Réessayer le paiement</button>
                    <button type="button" class="sl-btn sl-btn-ghost sl-btn-icon" aria-label="Masquer ce message" t-on-click="() => this.state.payResult = null"><Icon name="'x'" size="16"/></button>
                </div>
            </section>

            <div t-if="state.loading and !state.info" class="ad-loading"><span class="sl-spinner"/> Chargement de l'abonnement…</div>
            <div t-elif="state.error" class="ad-panel ss-error" role="alert">
                <Icon name="'alert'" size="22"/>
                <div class="sl-grow"><strong>Impossible d'afficher l'abonnement.</strong><div t-esc="state.error"/></div>
                <button class="sl-btn" t-on-click="() => this.load()">Réessayer</button>
            </div>
            <t t-elif="state.info">
                <t t-set="t" t-value="state.info.tenant"/>
                <!-- Situation -->
                <section class="ss-status" aria-labelledby="ss-status-title">
                    <div class="ss-status-main">
                        <div class="ss-eyebrow">Catégorie actuelle</div>
                        <h2 id="ss-status-title" class="ss-plan-name" t-esc="t.plan.name"/>
                        <div class="ss-status-line">
                            <span t-attf-class="sl-badge {{tenantBadge(t.state)}}" t-esc="t.state_label"/>
                            <span class="sl-muted" t-if="t.period_end" t-esc="t.billing_cycle == 'yearly' ? 'Facturation annuelle' : 'Facturation mensuelle'"/>
                            <span class="sl-muted" t-if="t.plan.audience" t-esc="t.plan.audience"/>
                        </div>
                    </div>
                    <dl class="ss-dates">
                        <div t-if="t.trial_end and !t.period_end"><dt>Fin de l'essai</dt><dd t-esc="date(t.trial_end)"/></div>
                        <div t-if="t.period_end"><dt>Payé jusqu'au</dt><dd t-esc="date(t.period_end)"/></div>
                        <div t-if="t.state == 'past_due'"><dt>Fin du délai de grâce</dt><dd class="ad-danger-text" t-esc="date(t.grace_end)"/></div>
                    </dl>
                    <div t-attf-class="ss-days is-{{daysTone}}">
                        <t t-if="['trial', 'active', 'past_due'].includes(t.state)">
                            <span class="sl-figures" t-esc="t.days_left"/>
                            <small t-esc="t.days_left == 1 ? 'jour restant' : 'jours restants'"/>
                        </t>
                        <t t-else="">
                            <span class="ss-days-icon"><Icon name="'lock'" size="26"/></span>
                            <small t-esc="t.state == 'suspended' ? 'Accès bloqué' : 'Consultation seule'"/>
                        </t>
                    </div>
                </section>

                <div t-if="t.state == 'expired'" class="sl-alert sl-alert-danger ad-mb">
                    <strong>La console est en consultation seule.</strong> Vos concours, candidats et résultats restent consultables
                    et exportables. Choisissez une catégorie ci-dessous et réglez la facture pour reprendre la création de concours
                    et l'inscription de candidats.
                </div>
                <div t-elif="t.state == 'suspended'" class="sl-alert sl-alert-danger ad-mb">
                    <strong>Compte suspendu.</strong> Contactez le support SELECTA pour rétablir l'accès<t t-if="supportLine"> : <t t-esc="supportLine"/></t>.
                </div>
                <div t-elif="t.state == 'past_due'" class="sl-alert sl-alert-warn ad-mb">
                    <strong>Échéance dépassée.</strong> Réglez votre abonnement avant le <t t-esc="date(t.grace_end)"/> : passé ce délai,
                    la console passera en consultation seule.
                </div>

                <!-- Paiement en attente -->
                <section t-if="current" class="ad-panel ss-pay" t-att-class="'is-' + current.state" id="ss-payment" aria-labelledby="ss-pay-title">
                    <div class="ad-panel-head">
                        <h2 id="ss-pay-title" t-esc="current.state == 'pending' ? 'Paiement en cours de validation' : 'Facture à régler'"/>
                        <span t-attf-class="sl-badge {{invoiceBadge(current.state)}}" t-esc="current.state_label"/>
                    </div>
                    <div class="ss-pay-summary">
                        <div><div class="ss-eyebrow">Montant</div><div class="ss-amount sl-figures" t-esc="money(current.amount, current.symbol)"/></div>
                        <div><div class="ss-eyebrow">Facture</div><div class="sl-mono" t-esc="current.name"/></div>
                        <div><div class="ss-eyebrow">Objet</div><div>Catégorie <t t-esc="quoted(current.plan)"/>, <t t-esc="cycleLabel(current.billing_cycle).toLowerCase()"/></div></div>
                        <div class="ss-pay-print"><button class="sl-btn sl-btn-sm" t-on-click="() => this.print(current)"><Icon name="'print'" size="16"/>Facture</button></div>
                    </div>
                    <div t-if="current.credit_amount > 0 or current.deferred_plan or current.prorated" class="ss-pay-detail">
                        <p t-if="current.credit_amount > 0" class="ss-calc">
                            <span>Prix de la période <strong class="sl-figures" t-esc="money(current.gross_amount, current.symbol)"/></span>
                            <span><span class="ss-calc-op" aria-hidden="true">−</span><span class="sl-sr">moins l'</span>avoir sur votre abonnement en cours <strong class="sl-figures" t-esc="money(current.credit_amount, current.symbol)"/></span>
                            <span><span class="ss-calc-op" aria-hidden="true">=</span><span class="sl-sr">soit </span><strong class="sl-figures" t-esc="money(current.amount, current.symbol)"/> à régler</span>
                        </p>
                        <p t-if="current.prorated" class="sl-muted ad-small">Changement vers une catégorie supérieure : nouvelle période <t t-esc="current.billing_cycle == 'yearly' ? 'de 12 mois' : 'd’un mois'"/> à compter du paiement.</p>
                        <p t-if="current.deferred_plan" class="sl-muted ad-small">La catégorie <t t-esc="quoted(current.plan)"/> s'appliquera à l'échéance<t t-if="t.period_end"> du <t t-esc="date(t.period_end)"/></t> ; jusque-là vous conservez votre catégorie actuelle (<t t-esc="quoted(t.plan.name)"/>).</p>
                    </div>

                    <t t-if="current.state == 'pending'">
                        <div class="ss-pending">
                            <span class="ss-pending-icon"><Icon name="'clock'" size="22"/></span>
                            <div class="sl-grow">
                                <p>Votre déclaration du <strong t-esc="dt(current.declared_date)"/> est en cours de vérification par l'équipe SELECTA.
                                L'abonnement sera activé dès la validation ; aucune action n'est requise de votre part.</p>
                                <dl class="ss-facts">
                                    <div><dt>Moyen</dt><dd t-esc="current.payment_method_label or '—'"/></div>
                                    <div><dt>Référence</dt><dd class="sl-mono" t-esc="current.payment_reference or '—'"/></div>
                                    <div t-if="current.payer_phone"><dt>Téléphone payeur</dt><dd t-esc="current.payer_phone"/></div>
                                    <div><dt>Justificatif</dt><dd t-esc="current.has_proof ? (current.proof_filename or 'Joint') : 'Aucun'"/></div>
                                </dl>
                            </div>
                        </div>
                        <div class="ss-pay-foot">
                            <span class="sl-muted ad-small">Erreur dans la déclaration ? Annulez la facture puis choisissez à nouveau votre catégorie.</span>
                            <button class="sl-btn sl-btn-sm" t-att-disabled="state.busy" t-on-click="cancelInvoice">Annuler la déclaration</button>
                        </div>
                    </t>
                    <t t-else="">
                        <div t-if="current.state == 'rejected'" class="sl-alert sl-alert-danger ad-mb" role="alert">
                            <strong>Paiement refusé par l'équipe SELECTA.</strong>
                            <t t-if="current.reject_reason"> Motif : <t t-esc="quoted(current.reject_reason)"/>.</t>
                            Vérifiez la référence ou le montant, puis déclarez à nouveau votre paiement.
                        </div>
                        <div t-if="providers.length" class="ss-online" id="ss-online">
                            <div class="ss-online-head">
                                <h3>Payer en ligne</h3>
                                <p class="sl-muted">Paiement sécurisé sur la page de l'opérateur. L'abonnement est activé dès la confirmation, sans déclaration à faire.</p>
                            </div>
                            <div class="ss-online-btns">
                                <button t-foreach="providers" t-as="pv" t-key="pv.code" type="button" class="ss-online-btn" t-att-class="{'is-first': pv_first}"
                                        t-att-disabled="state.busy or state.redirecting" t-att-aria-busy="state.redirecting == pv.code ? 'true' : 'false'" t-on-click="() => this.payOnline(pv)">
                                    <span class="ss-online-ico"><span t-if="state.redirecting == pv.code" class="sl-spinner"/><Icon t-else="" name="providerIcon(pv.code)" size="20"/></span>
                                    <span class="ss-online-label">
                                        <strong t-esc="state.redirecting == pv.code ? 'Redirection vers ' + providerSplit(pv).name + '…' : providerSplit(pv).title"/>
                                        <small t-esc="providerSplit(pv).hint"/>
                                    </span>
                                    <span class="ss-online-amt sl-figures" t-esc="money(current.amount, current.symbol)"/>
                                </button>
                            </div>
                            <form t-if="state.push and state.push.step == 'form'" class="ss-push" t-on-submit.prevent="sendPush">
                                <label for="ss-push-phone">Numéro Mobile Money (M-Pesa, Orange Money, Airtel Money, Afrimoney)</label>
                                <div class="ss-push-row">
                                    <input id="ss-push-phone" class="sl-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="+243 81 234 5678"
                                           t-model="state.push.phone" required="required"/>
                                    <button type="submit" class="sl-btn sl-btn-primary" t-att-disabled="pushDigits.length &lt; 9">Envoyer la demande</button>
                                </div>
                                <small class="sl-muted">Vous recevrez une demande de paiement sur ce téléphone : validez-la avec votre code PIN.</small>
                            </form>
                            <div t-if="state.push and state.push.step != 'form'" class="ss-push ss-push-wait" role="status" aria-live="polite">
                                <span class="sl-spinner"/>
                                <div>
                                    <strong t-esc="state.push.step == 'sending' ? 'Envoi de la demande…' : 'Validez le paiement sur votre téléphone'"/>
                                    <small class="sl-muted" t-if="state.push.step == 'wait'">Saisissez votre code PIN dans la fenêtre de l'opérateur. Cette page se met à jour dès la confirmation.</small>
                                </div>
                                <button type="button" class="sl-btn sl-btn-sm" t-on-click="cancelPush">Fermer</button>
                            </div>
                            <p t-if="current.online_message" class="ss-online-msg" role="status"><Icon name="'alert'" size="15"/>Dernière tentative (<t t-esc="providerLabel(current.online_provider)"/>) : <t t-esc="quoted(current.online_message)"/></p>
                        </div>
                        <h3 t-if="providers.length" class="ss-offline-title"><span>Autre moyen : paiement hors ligne</span></h3>
                        <ol class="ss-steps">
                            <li>
                                <h3><span>1</span>Réglez <t t-esc="money(current.amount, current.symbol)"/></h3>
                                <div t-if="state.info.payment_instructions" class="ss-instructions" t-esc="state.info.payment_instructions"/>
                                <p t-else="" class="sl-muted">Les modalités de paiement vous seront communiquées par le support SELECTA.</p>
                                <p class="ad-small sl-muted">Indiquez le numéro <strong class="sl-mono" t-esc="current.name"/> en motif de paiement.</p>
                                <a t-if="state.info.payment_link" class="sl-btn" t-att-class="providers.length ? '' : 'sl-btn-primary'" t-att-href="state.info.payment_link" target="_blank" rel="noopener noreferrer">
                                    <t t-esc="providers.length ? 'Ouvrir le lien de paiement' : 'Payer en ligne'"/><Icon name="'external'" size="16"/>
                                </a>
                            </li>
                            <li>
                                <h3><span>2</span>Déclarez votre paiement</h3>
                                <form class="ss-declare" t-on-submit.prevent="declare" novalidate="">
                                    <div class="sl-field">
                                        <label for="ss-method">Moyen de paiement</label>
                                        <select id="ss-method" class="sl-select" t-model="form.method">
                                            <option t-foreach="state.info.methods" t-as="m" t-key="m.key" t-att-value="m.key" t-esc="m.label"/>
                                        </select>
                                    </div>
                                    <div class="sl-field">
                                        <label for="ss-ref">Référence de la transaction <span class="ss-req" aria-hidden="true">*</span></label>
                                        <input id="ss-ref" class="sl-input" t-model="form.reference" t-on-input="() => this.form.errors.reference = ''" required="" maxlength="120" autocomplete="off"
                                               placeholder="Ex. : MP241022.1530.A12345" t-att-aria-invalid="form.errors.reference ? 'true' : 'false'"
                                               aria-describedby="ss-ref-help"/>
                                        <span id="ss-ref-help" t-attf-class="sl-help {{form.errors.reference ? 'ad-danger-text' : ''}}"
                                              t-esc="form.errors.reference or 'Fournie par SMS par votre opérateur, ou sur l’avis de virement.'"/>
                                    </div>
                                    <div class="sl-field">
                                        <label for="ss-phone">Téléphone du payeur <span class="sl-muted">(facultatif)</span></label>
                                        <input id="ss-phone" class="sl-input" type="tel" t-model="form.phone" maxlength="40" autocomplete="tel" placeholder="+243 …"/>
                                    </div>
                                    <div class="sl-field">
                                        <label for="ss-proof">Justificatif <span class="sl-muted">(facultatif)</span></label>
                                        <div class="ss-file">
                                            <input id="ss-proof" type="file" class="ss-file-input" accept="application/pdf,image/png,image/jpeg,image/webp"
                                                   t-ref="proof" t-on-change="onProof" aria-describedby="ss-proof-help"/>
                                            <label for="ss-proof" class="sl-btn sl-btn-sm"><Icon name="'upload'" size="16"/>Choisir un fichier</label>
                                            <span class="ss-file-name" t-if="form.proofName"><t t-esc="form.proofName"/>
                                                <button type="button" class="sl-btn sl-btn-ghost sl-btn-icon" aria-label="Retirer le justificatif" t-on-click="clearProof"><Icon name="'x'" size="14"/></button>
                                            </span>
                                        </div>
                                        <span id="ss-proof-help" t-attf-class="sl-help {{form.errors.proof ? 'ad-danger-text' : ''}}"
                                              t-esc="form.errors.proof or 'Capture du SMS ou reçu : PDF, PNG, JPEG ou WebP, 5 Mo maximum.'"/>
                                    </div>
                                    <div class="ss-declare-foot">
                                        <button type="submit" class="sl-btn sl-btn-primary" t-att-disabled="state.busy">
                                            <span t-if="state.busy" class="sl-spinner"/><Icon t-else="" name="'check'" size="16"/>Déclarer mon paiement
                                        </button>
                                        <button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" t-att-disabled="state.busy" t-on-click="cancelInvoice">Annuler la facture</button>
                                    </div>
                                </form>
                            </li>
                        </ol>
                    </t>
                </section>

                <!-- Consommation -->
                <section class="ad-panel" aria-labelledby="ss-usage-title">
                    <div class="ad-panel-head">
                        <h2 id="ss-usage-title">Consommation</h2>
                        <span class="sl-muted ad-small">Mois en cours, depuis le <t t-esc="monthStart"/></span>
                    </div>
                    <div class="ss-meters">
                        <div t-foreach="meters" t-as="m" t-key="m.key" t-attf-class="ss-meter is-{{m.tone}}">
                            <div class="ss-meter-head">
                                <span class="ss-meter-label" t-att-id="'ss-m-' + m.key" t-esc="m.label"/>
                                <span class="ss-meter-value">
                                    <strong class="sl-figures" t-esc="num(m.used)"/>
                                    <span class="sl-muted"> / <t t-esc="m.limit ? num(m.limit) : 'Illimité'"/></span>
                                </span>
                            </div>
                            <div class="ss-meter-track" role="meter" t-att-aria-labelledby="'ss-m-' + m.key"
                                 aria-valuemin="0" t-att-aria-valuemax="m.limit or m.used" t-att-aria-valuenow="m.used"
                                 t-att-aria-valuetext="m.limit ? (num(m.used) + ' sur ' + num(m.limit)) : (num(m.used) + ', illimité')">
                                <div t-att-style="'width:' + m.pct + '%'"/>
                            </div>
                            <div class="ss-meter-note" t-esc="m.note"/>
                        </div>
                    </div>
                </section>

                <!-- Offres -->
                <section class="ss-plans-section" aria-labelledby="ss-plans-title">
                    <div class="ss-plans-head">
                        <div>
                            <h2 id="ss-plans-title">Catégories et tarifs</h2>
                            <p class="sl-muted">Vers une catégorie supérieure, la part non consommée de votre période est déduite et une nouvelle période démarre au paiement.
                                Vers une catégorie inférieure, le changement s'applique à l'échéance en cours. Les jours d'essai restants sont conservés.</p>
                        </div>
                        <div class="ss-cycle" role="radiogroup" aria-label="Cycle de facturation">
                            <button type="button" role="radio" t-att-aria-checked="state.cycle == 'monthly' ? 'true' : 'false'"
                                    t-att-class="{'is-active': state.cycle == 'monthly'}" t-on-click="() => this.state.cycle = 'monthly'">Mensuel</button>
                            <button type="button" role="radio" t-att-aria-checked="state.cycle == 'yearly' ? 'true' : 'false'"
                                    t-att-class="{'is-active': state.cycle == 'yearly'}" t-on-click="() => this.state.cycle = 'yearly'">
                                Annuel<small t-if="freeMonths"> · <t t-esc="freeMonths"/> mois offerts</small>
                            </button>
                        </div>
                    </div>
                    <div t-if="current and current.state == 'pending'" class="sl-alert sl-alert-info ad-mb">Un paiement est en cours de validation : vous pourrez changer de catégorie après son traitement.</div>
                    <div class="ss-plans">
                        <article t-foreach="state.info.plans" t-as="p" t-key="p.id" class="ss-plan"
                                 t-att-class="{'is-current': p.id == t.plan.id, 'is-highlight': p.highlight}" t-att-aria-label="'Catégorie ' + p.name">
                            <div class="ss-plan-tags">
                                <span t-if="p.id == t.plan.id" class="ss-tag is-current">Catégorie actuelle</span>
                                <span t-elif="p.highlight" class="ss-tag">Recommandée</span>
                            </div>
                            <h3 t-esc="p.name"/>
                            <p class="ss-plan-audience" t-esc="p.audience"/>
                            <div class="ss-price">
                                <span class="sl-figures" t-esc="money(price(p), p.symbol)"/>
                                <small t-esc="state.cycle == 'yearly' ? '/ an' : '/ mois'"/>
                            </div>
                            <div class="ss-price-note" t-esc="priceNote(p)"/>
                            <ul class="ss-features">
                                <li><Icon name="'trophy'" size="15"/><t t-esc="limitLabel(p.max_active_concours, 'concours actif simultané', 'concours actifs simultanés', 'Concours actifs illimités')"/></li>
                                <li><Icon name="'users'" size="15"/><t t-esc="limitLabel(p.max_candidates_month, 'candidat par mois', 'candidats par mois', 'Candidats illimités')"/></li>
                                <li><Icon name="'user'" size="15"/><t t-esc="limitLabel(p.max_staff, 'compte du personnel', 'comptes du personnel', 'Comptes du personnel illimités')"/></li>
                                <li t-foreach="featureKeys" t-as="f" t-key="f" t-att-class="{'is-off': !p.features[f]}">
                                    <Icon name="p.features[f] ? 'check' : 'x'" size="15"/>
                                    <span t-esc="featureLabels[f]"/><span t-if="!p.features[f]" class="sl-sr"> (non incluse)</span>
                                </li>
                                <li t-if="p.support"><Icon name="'phone'" size="15"/>Support : <t t-esc="p.support"/></li>
                            </ul>
                            <button class="sl-btn ss-plan-btn" t-att-class="(p.id == t.plan.id or p.highlight) ? 'sl-btn-primary' : ''"
                                    t-att-disabled="!canChoose or state.quoting" t-att-title="chooseHint" t-on-click="(ev) => this.choose(p, ev)"
                                    t-att-aria-busy="state.quoting == p.id ? 'true' : 'false'">
                                <span t-if="state.quoting == p.id" class="sl-spinner"/><t t-esc="chooseLabel(p)"/>
                            </button>
                        </article>
                    </div>
                </section>

                <!-- Factures -->
                <section class="ad-panel ad-panel-flush ss-invoices" aria-labelledby="ss-inv-title">
                    <div class="ad-panel-head ss-inv-head"><h2 id="ss-inv-title">Historique des factures</h2></div>
                    <div t-if="!state.info.invoices.length" class="ad-empty">
                        <Icon name="'receipt'" size="26"/>
                        <strong>Aucune facture pour l'instant.</strong>
                        <span>Votre première facture sera émise lorsque vous choisirez une catégorie.</span>
                    </div>
                    <div t-else="" class="ss-table-wrap">
                        <table class="ad-table">
                            <thead><tr><th scope="col">Numéro</th><th scope="col">Date</th><th scope="col">Catégorie</th><th scope="col">Cycle</th><th scope="col" class="num">Montant</th><th scope="col">Statut</th><th scope="col">Période</th><th scope="col"><span class="sl-sr">Actions</span></th></tr></thead>
                            <tbody>
                                <tr t-foreach="state.info.invoices" t-as="inv" t-key="inv.id" t-att-class="{'is-muted': inv.state == 'cancelled'}">
                                    <td class="sl-mono" t-esc="inv.name"/>
                                    <td t-esc="date(inv.date, 'medium')"/>
                                    <td>
                                        <t t-esc="inv.plan"/>
                                        <small t-if="planNote(inv)" class="ss-cell-note" t-esc="planNote(inv)"/>
                                    </td>
                                    <td t-esc="cycleLabel(inv.billing_cycle)"/>
                                    <td class="num">
                                        <span class="sl-figures" t-esc="money(inv.amount, inv.symbol)"/>
                                        <small t-if="inv.credit_amount > 0" class="ss-cell-note">
                                            <t t-esc="money(inv.gross_amount, inv.symbol)"/> − avoir <t t-esc="money(inv.credit_amount, inv.symbol)"/>
                                        </small>
                                    </td>
                                    <td>
                                        <span t-attf-class="sl-badge {{invoiceBadge(inv.state)}}" t-esc="inv.state_label"/>
                                        <small t-if="paidNote(inv)" class="ss-cell-note" t-esc="paidNote(inv)"/>
                                    </td>
                                    <td class="ad-small" t-esc="periodLabel(inv)"/>
                                    <td class="num"><button class="sl-btn sl-btn-ghost sl-btn-sm" t-on-click="() => this.print(inv)" t-att-aria-label="'Imprimer la facture ' + inv.name"><Icon name="'print'" size="16"/>Facture</button></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <footer class="ss-support">
                    <div><strong>Une question sur votre abonnement ?</strong> L'équipe SELECTA vous répond.</div>
                    <div class="ss-support-links">
                        <a t-if="state.info.support_email" t-att-href="'mailto:' + state.info.support_email"><Icon name="'mail'" size="16"/><t t-esc="state.info.support_email"/></a>
                        <span t-if="state.info.support_phone"><Icon name="'phone'" size="16"/><t t-esc="state.info.support_phone"/></span>
                    </div>
                    <nav class="ss-legal" aria-label="Informations légales">
                        <a t-att-href="legal.terms" target="_blank" rel="noopener">Conditions d'utilisation<span class="sl-sr"> (nouvel onglet)</span></a>
                        <a t-att-href="legal.privacy" target="_blank" rel="noopener">Politique de confidentialité<span class="sl-sr"> (nouvel onglet)</span></a>
                    </nav>
                </footer>
                <CheckoutDialog t-if="state.checkout" plan="state.checkout.plan" cycle="state.checkout.cycle" quote="state.checkout.quote"
                                tenant="state.info.tenant" replaces="state.checkout.replaces" busy="state.busy"
                                onConfirm.bind="confirmCheckout" onClose.bind="closeCheckout" onSwitchCycle.bind="switchCheckoutCycle"/>
            </t>
        </div>`;
    static props = { route: { type: Object, optional: true } };

    setup() {
        this.proofRef = useRef("proof");
        this.featureKeys = Object.keys(FEATURE_LABELS);
        this.featureLabels = FEATURE_LABELS;
        this.legal = LEGAL_LINKS;
        this.state = useState({
            info: null, loading: true, error: "", busy: false, cycle: "monthly",
            quoting: null, checkout: null, redirecting: null, checking: false, payResult: null,
            push: null, // Mobile Money par demande sur le téléphone : { code, phone, step: form|sending|wait, polls }
        });
        onWillUnmount(() => clearTimeout(this.pushTimer));
        this.form = useState(this.emptyForm());
        // Retour du prestataire de paiement : /selecta/admin#/subscription?payment=paid|pending|failed|none
        const payment = this.props.route?.params?.payment;
        if (PAYMENT_RESULTS.includes(payment)) {
            this.state.payResult = { status: payment };
        }
        onWillStart(() => this.load(true));
        // Même document (lien interne vers #/subscription?payment=…) : la page n'est pas recréée.
        onWillUpdateProps((next) => {
            const status = next.route?.params?.payment;
            if (status !== undefined && next.route !== this.props.route) {
                this.state.payResult = PAYMENT_RESULTS.includes(status) ? { status } : this.state.payResult;
                this.cleanPaymentParam();
                this.load();
            }
        });
        // Retour arrière depuis la page du prestataire (cache du navigateur) : réactiver les boutons.
        const onPageShow = (ev) => {
            if (ev.persisted && this.state.redirecting) {
                this.state.redirecting = null;
                this.load();
            }
        };
        window.addEventListener("pageshow", onPageShow);
        onWillUnmount(() => window.removeEventListener("pageshow", onPageShow));
        onMounted(() => {
            if (payment !== undefined) {
                this.cleanPaymentParam();
            }
            if (this.state.payResult) {
                document.getElementById("ss-result")?.focus({ preventScroll: true });
            }
        });
    }

    /** Retire « ?payment=… » de l'adresse : un rechargement ne réaffiche pas le message. */
    cleanPaymentParam() {
        try {
            const [path, query] = location.hash.split("?");
            const params = new URLSearchParams(query || "");
            params.delete("payment");
            const rest = params.toString();
            history.replaceState(history.state, "", `${location.pathname}${location.search}${path}${rest ? "?" + rest : ""}`);
        } catch {
            // Adresse non modifiable (iframe sandboxée…) : sans incidence.
        }
    }

    emptyForm(method = "") {
        return { method, reference: "", phone: "", proofData: null, proofName: "", errors: {} };
    }

    async load(initial = false) {
        this.state.loading = true;
        this.state.error = "";
        try {
            this.apply(await api("billing_info"));
            if (initial) {
                this.state.cycle = this.state.info.tenant.billing_cycle === "yearly" ? "yearly" : "monthly";
            }
        } catch (e) {
            this.state.error = e.message || "Erreur inattendue.";
        } finally {
            this.state.loading = false;
        }
    }

    apply(info) {
        this.state.info = info;
        saasBus.summary = info.tenant;
        saasBus.support = { email: info.support_email, phone: info.support_phone };
        if (store.session) {
            store.session.saas = info.tenant;
        }
        if (!this.form.method || !info.methods.some((m) => m.key === this.form.method)) {
            this.form.method = info.methods[0]?.key || "";
        }
    }

    // ------------------------------------------------------------------ dérivés
    get current() {
        const invoices = this.state.info?.invoices || [];
        return invoices.find((i) => i.state === "pending") || invoices.find((i) => ["open", "rejected"].includes(i.state)) || null;
    }
    get providers() {
        return this.state.info?.online_providers || [];
    }
    /** Facture sur laquelle une transaction en ligne a été ouverte (pour « Vérifier maintenant »). */
    get onlineInvoice() {
        const invoices = this.state.info?.invoices || [];
        return invoices.find((i) => ["open", "rejected"].includes(i.state) && i.online_provider) || null;
    }
    get lastPaid() {
        return (this.state.info?.invoices || []).find((i) => i.state === "paid") || null;
    }
    get payTone() {
        return { paid: "ok", pending: "warn", failed: "danger" }[this.state.payResult?.status] || "info";
    }
    get payIcon() {
        return { paid: "check", pending: "clock", failed: "alert" }[this.state.payResult?.status] || "receipt";
    }
    get canChoose() {
        const t = this.state.info.tenant;
        return !this.state.busy && t.access !== "blocked" && !(this.current && this.current.state === "pending");
    }
    get chooseHint() {
        if (this.state.info.tenant.access === "blocked") {
            return "Compte suspendu : contactez le support SELECTA.";
        }
        if (this.current && this.current.state === "pending") {
            return "Un paiement est en cours de validation.";
        }
        return "";
    }
    get supportLine() {
        const i = this.state.info;
        return [i.support_email, i.support_phone].filter(Boolean).join(" · ");
    }
    get daysTone() {
        const t = this.state.info.tenant;
        if (["expired", "suspended"].includes(t.state)) {
            return "danger";
        }
        if (t.state === "past_due" || t.days_left <= 3) {
            return "warn";
        }
        return "ok";
    }
    get monthStart() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString(locale(), { day: "numeric", month: "long" });
    }
    get freeMonths() {
        const months = (this.state.info.plans || [])
            .filter((p) => p.price_monthly > 0)
            .map((p) => Math.round(p.yearly_saving / p.price_monthly));
        const best = Math.max(0, ...months);
        return best >= 1 && months.every((m) => m === best) ? best : 0;
    }
    get meters() {
        const { usage, limits } = this.state.info;
        const make = (key, label, used, limit, unit) => {
            const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
            const ratio = limit ? used / limit : 0;
            const tone = !limit ? "unlimited" : ratio >= 1 ? "danger" : ratio >= 0.8 ? "warn" : "ok";
            let note;
            if (!limit) {
                note = "Aucune limite dans votre catégorie.";
            } else if (ratio >= 1) {
                note = `Limite atteinte : passez à une catégorie supérieure pour ${unit}.`;
            } else {
                note = `${fmtNum(limit - used, 0)} disponible(s) — ${Math.round(ratio * 100)} % utilisés.`;
            }
            return { key, label, used, limit, pct: limit ? pct : 100, tone, note };
        };
        const list = [
            make("concours", "Concours actifs", usage.active_concours, limits.active_concours, "ouvrir d'autres concours"),
            make("candidates", "Candidats inscrits ce mois", usage.candidates_month, limits.candidates_month, "inscrire davantage de candidats"),
            make("staff", "Comptes du personnel", usage.staff, limits.staff, "créer d'autres comptes"),
        ];
        if (limits.trial_candidates) {
            list.splice(2, 0, make("trial", "Candidats pendant l'essai", usage.candidates_total, limits.trial_candidates, "inscrire davantage de candidats (abonnement requis)"));
        }
        return list;
    }

    // ------------------------------------------------------------------ présentation
    tenantBadge(state) {
        return TENANT_BADGE[state] || "";
    }
    invoiceBadge(state) {
        return INVOICE_BADGE[state] || "";
    }
    cycleLabel(c) {
        return CYCLE_LABELS[c] || c || "";
    }
    quoted(text) {
        return quoted(text);
    }
    money(v, s) {
        return fmtMoney(v, s);
    }
    num(v) {
        return fmtNum(v, 0);
    }
    date(v, style = "long") {
        return fmtDate(v, style);
    }
    dt(v) {
        return fmtDateTime(v);
    }
    days(n) {
        return daysLabel(n);
    }
    price(p) {
        return this.state.cycle === "yearly" ? p.price_yearly : p.price_monthly;
    }
    priceNote(p) {
        if (this.state.cycle === "yearly") {
            const perMonth = fmtMoney(Math.round((p.price_yearly / 12) * 100) / 100, p.symbol);
            return p.yearly_saving > 0 ? `soit ${perMonth} / mois · économie de ${fmtMoney(p.yearly_saving, p.symbol)}` : `soit ${perMonth} / mois`;
        }
        return p.yearly_saving > 0
            ? `ou ${fmtMoney(p.price_yearly, p.symbol)} / an (économie de ${fmtMoney(p.yearly_saving, p.symbol)})`
            : `ou ${fmtMoney(p.price_yearly, p.symbol)} / an`;
    }
    limitLabel(n, one, many, unlimited) {
        if (!n) {
            return unlimited;
        }
        return `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
    }
    chooseLabel(p) {
        const t = this.state.info.tenant;
        if (p.id === t.plan.id) {
            return t.period_end ? "Renouveler" : "Souscrire à cette catégorie";
        }
        return "Choisir";
    }
    providerIcon(code) {
        return code === "cinetpay" || code === "flexpay" ? "mobile" : "card";
    }
    providerLabel(code) {
        return providerName(code);
    }
    /** « Mobile Money ou carte (CinetPay) » → titre « Mobile Money ou carte », mention « via CinetPay ». */
    providerSplit(pv) {
        const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(pv.label || "");
        const name = m ? m[2] : providerName(pv.code);
        return { title: m ? m[1] : pv.label, name, hint: `via ${name}` };
    }
    planNote(inv) {
        if (inv.deferred_plan) {
            if (inv.state === "paid") {
                return inv.plan_applied ? "Catégorie inférieure, appliquée à l'échéance" : `Appliquée le ${fmtDate(inv.period_start, "medium")}`;
            }
            return "Appliquée à l'échéance en cours";
        }
        if (inv.prorated) {
            return "Changement de catégorie, avoir déduit";
        }
        return "";
    }
    paidNote(inv) {
        if (inv.state !== "paid") {
            return inv.state === "open" && inv.online_message ? "Tentative en ligne non aboutie" : "";
        }
        if (paidOnline(inv)) {
            return `Payée en ligne via ${providerName(inv.online_provider)}`;
        }
        if (inv.amount <= 0 && inv.credit_amount > 0) {
            return "Réglée par l'avoir";
        }
        return "";
    }
    periodLabel(inv) {
        if (inv.period_start && inv.period_end) {
            return `${fmtDate(inv.period_start, "medium")} → ${fmtDate(inv.period_end, "medium")}`;
        }
        return "—";
    }

    // ------------------------------------------------------------------ actions
    async choose(p, ev) {
        this.returnFocus = ev?.currentTarget || null;
        this.state.quoting = p.id;
        try {
            await this.openCheckout(p, this.state.cycle);
        } finally {
            this.state.quoting = null;
        }
    }

    async openCheckout(plan, cycle) {
        try {
            const quote = await api("billing_quote", [plan.id, cycle]);
            const cur = this.current;
            this.state.checkout = {
                plan, cycle, quote, replaces: cur && ["open", "rejected"].includes(cur.state) ? cur.name : undefined,
            };
        } catch (e) {
            notify(e.message, "danger");
        }
    }

    async switchCheckoutCycle(cycle) {
        const { plan } = this.state.checkout;
        this.state.cycle = cycle;
        this.state.busy = true;
        try {
            await this.openCheckout(plan, cycle);
        } finally {
            this.state.busy = false;
        }
    }

    closeCheckout() {
        if (this.state.busy) {
            return;
        }
        this.state.checkout = null;
        const el = this.returnFocus;
        this.returnFocus = null;
        if (el && document.contains(el)) {
            el.focus();
        }
    }

    async confirmCheckout() {
        const { plan, cycle } = this.state.checkout;
        this.state.busy = true;
        try {
            const inv = await api("billing_checkout", [plan.id, cycle]);
            this.state.checkout = null;
            this.returnFocus = null;
            await this.load();
            if (inv.state === "paid") {
                this.state.payResult = { status: "paid", credit: true };
                const end = this.state.info.tenant.period_end;
                // Pas de gabarits imbriqués : le minificateur d'Odoo en altère les espaces.
                const until = end ? " : abonnement actif jusqu'au " + fmtDate(end) : "";
                notify(`Catégorie ${quoted(inv.plan)} activée sans paiement, couverte par votre avoir${until}.`, "ok", 6000);
                requestAnimationFrame(() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    document.getElementById("ss-result")?.focus({ preventScroll: true });
                });
            } else {
                notify(`Facture ${inv.name} émise : ${fmtMoney(inv.amount, inv.symbol)} à régler.`, "ok");
                this.scrollToPayment();
            }
        } catch (e) {
            notify(e.message, "danger", 8000);
        } finally {
            this.state.busy = false;
        }
    }

    async payOnline(pv) {
        const inv = this.current;
        if (!inv || this.state.redirecting) {
            return;
        }
        if (pv.flow === "push") {
            // Pas de page externe : le numéro est saisi ici, la demande part sur le téléphone.
            this.state.push = { code: pv.code, phone: this.state.push?.phone || "", step: "form", polls: 0 };
            return;
        }
        this.state.redirecting = pv.code;
        try {
            const res = await api("billing_pay_online", [inv.id, pv.code]);
            if (!res || !res.url) {
                throw new Error("Le prestataire n'a pas renvoyé de page de paiement.");
            }
            window.location.assign(res.url);
            // La page reste « en redirection » jusqu'au départ du navigateur.
        } catch (e) {
            this.state.redirecting = null;
            notify(e.message || "Paiement en ligne indisponible pour le moment.", "danger", 8000);
            this.load();
        }
    }

    get pushDigits() {
        return (this.state.push?.phone || "").replace(/\D/g, "");
    }

    async sendPush() {
        const push = this.state.push;
        const inv = this.current;
        if (!push || !inv) {
            return;
        }
        push.step = "sending";
        try {
            await api("billing_pay_online", [inv.id, push.code, push.phone]);
            Object.assign(push, { step: "wait", polls: 0 });
            this.pollPush();
        } catch (e) {
            push.step = "form";
            notify(e.message || "Paiement Mobile Money indisponible pour le moment.", "danger", 8000);
        }
    }

    /** Suit le paiement toutes les 5 s pendant 3 minutes, le temps de saisir le code PIN. */
    pollPush() {
        clearTimeout(this.pushTimer);
        const push = this.state.push;
        if (!push || push.step !== "wait") {
            return;
        }
        if (push.polls >= 36) {
            this.state.push = null;
            this.state.payResult = { status: "pending" };
            return;
        }
        this.pushTimer = setTimeout(async () => {
            push.polls += 1;
            const inv = this.current;
            try {
                const res = await api("billing_check_online", [inv.id]);
                if (res.status === "paid" || res.status === "failed") {
                    this.state.push = null;
                    this.apply(res.info);
                    this.state.payResult = { status: res.status };
                    if (res.status === "paid") {
                        notify("Paiement confirmé : votre abonnement est actif.", "ok");
                    }
                    return;
                }
            } catch {
                // Réseau instable : nouvel essai au prochain tour.
            }
            this.pollPush();
        }, 5000);
    }

    cancelPush() {
        clearTimeout(this.pushTimer);
        this.state.push = null;
        this.load();
    }

    async checkOnline() {
        const inv = this.onlineInvoice;
        if (!inv) {
            return;
        }
        this.state.checking = true;
        try {
            const res = await api("billing_check_online", [inv.id]);
            this.apply(res.info);
            if (res.status === "paid") {
                this.state.payResult = { status: "paid" };
                notify("Paiement confirmé : votre abonnement est actif.", "ok");
            } else if (res.status === "failed") {
                this.state.payResult = { status: "failed" };
            } else if (res.status === "pending") {
                notify("Toujours en attente de confirmation par l'opérateur. Réessayez dans quelques minutes.", "info", 6000);
            } else {
                this.state.payResult = { status: "none" };
            }
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.checking = false;
        }
    }

    retryPayment() {
        this.state.payResult = null;
        this.scrollToPayment();
    }

    scrollToPayment() {
        requestAnimationFrame(() => {
            const el = document.getElementById("ss-payment");
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                (el.querySelector(".ss-online-btn:not([disabled])") || el.querySelector("#ss-ref"))?.focus({ preventScroll: true });
            }
        });
    }

    async onProof(ev) {
        const file = ev.target.files && ev.target.files[0];
        this.form.errors.proof = "";
        if (!file) {
            return;
        }
        if (!PROOF_TYPES.includes(file.type)) {
            this.form.errors.proof = "Format non accepté : choisissez un PDF, PNG, JPEG ou WebP.";
            ev.target.value = "";
            return;
        }
        if (file.size > PROOF_MAX) {
            this.form.errors.proof = `Fichier trop volumineux (${fmtNum(file.size / 1048576, 1)} Mo) : 5 Mo maximum.`;
            ev.target.value = "";
            return;
        }
        try {
            this.form.proofData = await readFileAsDataURL(file);
            this.form.proofName = file.name;
        } catch {
            this.form.errors.proof = "Lecture du fichier impossible.";
        }
    }

    clearProof() {
        this.form.proofData = null;
        this.form.proofName = "";
        if (this.proofRef.el) {
            this.proofRef.el.value = "";
        }
    }

    async declare() {
        const f = this.form;
        f.errors = {};
        if (!f.reference.trim()) {
            f.errors.reference = "Indiquez la référence de la transaction.";
            document.getElementById("ss-ref")?.focus();
            return;
        }
        const inv = this.current;
        this.state.busy = true;
        try {
            const info = await api("billing_declare", [inv.id, f.method, f.reference.trim(), f.phone.trim(), f.proofData || false, f.proofName || ""]);
            Object.assign(this.form, this.emptyForm(f.method));
            this.apply(info);
            notify("Paiement déclaré : l'équipe SELECTA va le vérifier.", "ok");
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.busy = false;
        }
    }

    async cancelInvoice() {
        const inv = this.current;
        const pending = inv.state === "pending";
        const ok = await confirmDialog({
            title: pending ? "Annuler la déclaration ?" : "Annuler la facture ?",
            body: pending
                ? `La déclaration et la facture ${inv.name} seront annulées. Si vous avez déjà payé, ne l'annulez pas : l'équipe SELECTA est en train de vérifier votre paiement.`
                : `La facture ${inv.name} sera annulée. Vous pourrez choisir une autre catégorie ou un autre cycle.`,
            confirmLabel: pending ? "Annuler la déclaration" : "Annuler la facture",
            cancelLabel: "Conserver",
            danger: true,
        });
        if (!ok) {
            return;
        }
        this.state.busy = true;
        try {
            this.apply(await api("billing_cancel", [inv.id]));
            notify(`Facture ${inv.name} annulée.`, "ok");
        } catch (e) {
            notify(e.message, "danger");
        } finally {
            this.state.busy = false;
        }
    }

    print(inv) {
        printInvoice(inv, this.state.info);
    }
}

// ------------------------------------------------------------------ enregistrement dans la console
extensions.nav.push(
    { key: "subscription", label: "Abonnement", icon: "receipt", roles: ["admin"], sequence: 85, visible: (s) => !!s.saas },
    { key: "platform", label: "Administration centrale", icon: "building", href: "/selecta/platform", roles: ["admin"], sequence: 95, visible: (s) => !!s.is_platform }
);
extensions.pages.subscription = SubscriptionPage;
extensions.banners.push(SubscriptionBanner);
