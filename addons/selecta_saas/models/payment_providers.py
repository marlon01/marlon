# -*- coding: utf-8 -*-
"""Prestataires de paiement en ligne.

Principe de sécurité : une notification ou un retour navigateur ne valide jamais un paiement
à lui seul. Le serveur interroge toujours le prestataire (appel authentifié par la clé secrète)
et vérifie statut, montant et devise avant d'activer l'abonnement.

* CinetPay — Mobile Money (M-Pesa, Airtel Money, Orange Money…) et cartes, Afrique francophone (RDC incluse).
  API « checkout v2 » : https://docs.cinetpay.com
* Stripe — cartes bancaires internationales. API Checkout Sessions : https://docs.stripe.com/api/checkout/sessions
* FlexPay — Mobile Money en RDC (M-Pesa, Orange Money, Airtel Money, Afrimoney) : demande envoyée sur le
  téléphone du payeur, validée par son code PIN, sans redirection. Adresses et champs d'après le SDK
  communautaire ngandu-dev/flexpay-php (documentation officielle non publique).

Choix automatique par pays (``enabled_providers``) : FlexPay pour la RDC, CinetPay ailleurs, Stripe partout.
"""
import re
import logging
import math

import requests

from odoo import _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)
TIMEOUT = 20
UNREACHABLE = "Confirmation de l'opérateur en attente : nouvelle vérification automatique dans quelques minutes."


class ProviderError(UserError):
    pass


class BaseProvider:
    code = None
    label = None
    method = None  # moyen de paiement enregistré sur la facture
    flow = 'redirect'  # 'redirect' : page du prestataire ; 'push' : demande envoyée sur le téléphone

    def __init__(self, env):
        self.env = env
        self.icp = env['ir.config_parameter'].sudo()

    def param(self, key):
        return (self.icp.get_param('selecta_saas.%s_%s' % (self.code, key)) or '').strip()

    def enabled(self):
        return self.param('enabled') in ('True', 'true', '1') and self.configured()

    def configured(self):
        raise NotImplementedError

    # Points d'appel réseau isolés pour les tests.
    def _post(self, url, **kw):
        return requests.post(url, timeout=TIMEOUT, **kw)

    def _get(self, url, **kw):
        return requests.get(url, timeout=TIMEOUT, **kw)

    def start(self, invoice, reference, return_url, notify_url, phone=None):
        """Crée la transaction ; retourne l'URL de paiement (parcours « redirect ») ou None (« push »)."""
        raise NotImplementedError

    def check(self, invoice):
        """Interroge le prestataire. Retourne ('paid' | 'pending' | 'failed', référence prestataire, détail)."""
        raise NotImplementedError


class CinetPay(BaseProvider):
    code = 'cinetpay'
    label = "Mobile Money ou carte (CinetPay)"
    method = 'mobile_money'
    API = 'https://api-checkout.cinetpay.com/v2'

    def configured(self):
        return bool(self.param('site_id') and self.param('api_key'))

    @staticmethod
    def amount(invoice):
        # CinetPay n'accepte que des montants entiers.
        return int(math.ceil(invoice.amount))

    def start(self, invoice, reference, return_url, notify_url, phone=None):
        tenant = invoice.tenant_id
        payload = {
            'apikey': self.param('api_key'), 'site_id': self.param('site_id'),
            'transaction_id': reference, 'amount': self.amount(invoice), 'currency': invoice.currency_id.name,
            'description': ("SELECTA %s %s" % (invoice.name, invoice.plan_id.name))[:100].replace('#', ''),
            'return_url': return_url, 'notify_url': notify_url, 'channels': 'ALL', 'lang': 'FR',
            'metadata': invoice.name,
            'customer_name': (tenant.contact_name or tenant.company_id.name or '')[:60],
            'customer_surname': (tenant.company_id.name or '')[:60],
            'customer_email': tenant.email or '', 'customer_phone_number': tenant.phone or '',
            'customer_address': tenant.company_id.street or tenant.company_id.city or '-',
            'customer_city': tenant.company_id.city or '-',
            'customer_country': tenant.country_id.code or 'CD', 'customer_state': tenant.country_id.code or 'CD',
            'customer_zip_code': tenant.company_id.zip or '00000',
        }
        try:
            data = self._post(self.API + '/payment', json=payload).json()
        except (requests.RequestException, ValueError) as exc:
            _logger.warning("CinetPay injoignable : %s", exc)
            raise ProviderError(_("Le service de paiement est momentanément injoignable. Réessayez dans quelques minutes."))
        url = (data.get('data') or {}).get('payment_url')
        if str(data.get('code')) != '201' or not url:
            _logger.warning("CinetPay a refusé la transaction %s : %s", reference, data)
            raise ProviderError(_("Le service de paiement a refusé la demande : %s", data.get('description') or data.get('message') or '?'))
        return url

    def check(self, invoice):
        payload = {'apikey': self.param('api_key'), 'site_id': self.param('site_id'),
                   'transaction_id': invoice.online_reference}
        try:
            data = self._post(self.API + '/payment/check', json=payload).json()
        except (requests.RequestException, ValueError) as exc:
            _logger.warning("CinetPay : vérification de %s impossible : %s", invoice.online_reference, exc)
            return 'pending', False, UNREACHABLE
        info = data.get('data') or {}
        status = (info.get('status') or '').upper()
        if str(data.get('code')) == '00' and status == 'ACCEPTED':
            paid_amount = float(info.get('amount') or 0)
            if paid_amount + 1e-6 < self.amount(invoice) or (info.get('currency') or '').upper() != invoice.currency_id.name:
                return 'failed', False, _("Montant ou devise non conforme (%(a)s %(c)s).", a=info.get('amount'), c=info.get('currency'))
            return 'paid', info.get('operator_id') or invoice.online_reference, info.get('payment_method') or ''
        if status in ('REFUSED', 'CANCELED', 'CANCELLED') or str(data.get('code')) in ('600', '627'):
            return 'failed', False, data.get('message') or status
        return 'pending', False, "Paiement en attente de confirmation par l'opérateur."


class Stripe(BaseProvider):
    code = 'stripe'
    label = "Carte bancaire (Stripe)"
    method = 'card'
    API = 'https://api.stripe.com/v1'

    def configured(self):
        return self.param('secret_key').startswith(('sk_live_', 'sk_test_', 'rk_live_', 'rk_test_'))

    def _auth(self):
        return {'Authorization': 'Bearer %s' % self.param('secret_key')}

    @staticmethod
    def cents(invoice):
        return int(round(invoice.amount * 100))

    def start(self, invoice, reference, return_url, notify_url, phone=None):
        sep = '&' if '?' in return_url else '?'
        form = {
            'mode': 'payment', 'client_reference_id': reference, 'metadata[invoice]': invoice.name,
            'customer_email': invoice.tenant_id.email or '',
            'line_items[0][quantity]': 1,
            'line_items[0][price_data][currency]': invoice.currency_id.name.lower(),
            'line_items[0][price_data][unit_amount]': self.cents(invoice),
            'line_items[0][price_data][product_data][name]': "SELECTA — %s (%s)" % (
                invoice.plan_id.name, "annuel" if invoice.billing_cycle == 'yearly' else "mensuel"),
            'success_url': return_url + sep + 'session_id={CHECKOUT_SESSION_ID}',
            'cancel_url': return_url,
            'locale': 'fr',
        }
        try:
            resp = self._post(self.API + '/checkout/sessions', data=form, headers=self._auth())
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            _logger.warning("Stripe injoignable : %s", exc)
            raise ProviderError(_("Le service de paiement est momentanément injoignable. Réessayez dans quelques minutes."))
        if resp.status_code >= 400 or not data.get('url'):
            _logger.warning("Stripe a refusé la session %s : %s", reference, data)
            raise ProviderError(_("Le service de paiement a refusé la demande : %s",
                                  (data.get('error') or {}).get('message') or '?'))
        invoice.online_session = data.get('id')
        return data['url']

    def check(self, invoice):
        if not invoice.online_session:
            return 'pending', False, ''
        try:
            resp = self._get(self.API + '/checkout/sessions/%s' % invoice.online_session, headers=self._auth())
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            _logger.warning("Stripe : vérification de %s impossible : %s", invoice.online_reference, exc)
            return 'pending', False, UNREACHABLE
        if resp.status_code >= 400:
            _logger.warning("Stripe : vérification de %s refusée : %s", invoice.online_reference, data)
            return 'pending', False, UNREACHABLE
        if data.get('client_reference_id') != invoice.online_reference:
            return 'failed', False, _("Session de paiement étrangère à cette facture.")
        if data.get('payment_status') == 'paid':
            if int(data.get('amount_total') or 0) < self.cents(invoice) or \
                    (data.get('currency') or '').upper() != invoice.currency_id.name:
                return 'failed', False, _("Montant ou devise non conforme.")
            return 'paid', data.get('payment_intent') or data.get('id'), 'card'
        if data.get('status') == 'expired':
            return 'failed', False, _("Session de paiement expirée.")
        return 'pending', False, "Paiement en attente de confirmation."


class FlexPay(BaseProvider):
    code = 'flexpay'
    label = "Mobile Money RDC (FlexPay)"
    method = 'mobile_money'
    flow = 'push'
    URLS = {'prod': 'https://backend.flexpay.cd/api/rest/v1', 'dev': 'https://beta-backend.flexpay.cd/api/rest/v1'}

    def configured(self):
        return bool(self.param('merchant') and self.param('token'))

    def _api(self):
        return self.URLS.get(self.param('environment') or 'prod', self.URLS['prod'])

    def _auth(self):
        return {'Authorization': 'Bearer %s' % self.param('token')}

    @staticmethod
    def phone(value):
        """12 chiffres au format international sans « + » (243XXXXXXXXX)."""
        digits = re.sub(r'\D', '', value or '')
        if digits.startswith('00'):
            digits = digits[2:]
        if len(digits) == 10 and digits.startswith('0'):
            digits = '243' + digits[1:]
        elif len(digits) == 9:
            digits = '243' + digits
        return digits if len(digits) == 12 and digits.startswith('243') else False

    def start(self, invoice, reference, return_url, notify_url, phone=None):
        number = self.phone(phone)
        if not number:
            raise ProviderError(_("Saisissez votre numéro Mobile Money (ex. 243 81 234 5678)."))
        if invoice.currency_id.name not in ('CDF', 'USD'):
            raise ProviderError(_("FlexPay n'accepte que les paiements en CDF ou en USD."))
        amount = invoice.amount
        payload = {
            'merchant': self.param('merchant'), 'type': '1', 'phone': number, 'reference': reference,
            'amount': '%s' % (int(amount) if float(amount).is_integer() else round(amount, 2)),
            'currency': invoice.currency_id.name, 'callbackUrl': notify_url,
            'description': ("SELECTA %s" % invoice.name)[:100],
        }
        try:
            data = self._post(self._api() + '/paymentService', json=payload, headers=self._auth()).json()
        except (requests.RequestException, ValueError) as exc:
            _logger.warning("FlexPay injoignable : %s", exc)
            raise ProviderError(_("Le service Mobile Money est momentanément injoignable. Réessayez dans quelques minutes."))
        if str(data.get('code')) != '0' or not data.get('orderNumber'):
            _logger.warning("FlexPay a refusé la transaction %s : %s", reference, data)
            raise ProviderError(_("La demande de paiement a été refusée : %s", data.get('message') or '?'))
        invoice.online_session = str(data['orderNumber'])[:64]
        return None

    def check(self, invoice):
        if not invoice.online_session:
            return 'pending', False, ''
        try:
            data = self._get(self._api() + '/check/%s' % requests.utils.quote(invoice.online_session, safe=''),
                             headers=self._auth()).json()
        except (requests.RequestException, ValueError) as exc:
            _logger.warning("FlexPay : vérification de %s impossible : %s", invoice.online_reference, exc)
            return 'pending', False, UNREACHABLE
        tx = data.get('transaction') or {}
        status = str(tx.get('status', ''))
        if str(data.get('code')) == '0' and status == '0':
            try:
                paid = float(tx.get('amount') or 0)
            except (TypeError, ValueError):
                paid = 0.0
            if tx.get('reference') not in (None, invoice.online_reference) or paid + 1e-6 < invoice.amount or \
                    (tx.get('currency') or invoice.currency_id.name) != invoice.currency_id.name:
                return 'failed', False, _("Montant, devise ou référence non conforme.")
            return 'paid', invoice.online_session, 'mobile_money'
        if status == '1':
            return 'failed', False, data.get('message') or _("Paiement refusé par l'opérateur.")
        return 'pending', False, "Validez la demande sur votre téléphone avec votre code PIN."


PROVIDERS = {p.code: p for p in (FlexPay, CinetPay, Stripe)}


def get_provider(env, code):
    cls = PROVIDERS.get(code)
    return cls(env) if cls else None


def enabled_providers(env, country_code=None):
    """Prestataires proposés selon le pays : un seul Mobile Money (FlexPay en RDC, CinetPay ailleurs,
    FlexPay en repli sans pays connu), plus la carte bancaire (Stripe) partout."""
    enabled = {code: cls(env) for code, cls in PROVIDERS.items() if cls(env).enabled()}
    mobile = None
    if country_code == 'CD' and 'flexpay' in enabled:
        mobile = enabled['flexpay']
    elif 'cinetpay' in enabled:
        mobile = enabled['cinetpay']
    elif 'flexpay' in enabled and country_code in (None, False, 'CD'):
        mobile = enabled['flexpay']
    return [p for p in (mobile, enabled.get('stripe')) if p]
