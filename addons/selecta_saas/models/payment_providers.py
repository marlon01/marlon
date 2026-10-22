# -*- coding: utf-8 -*-
"""Prestataires de paiement en ligne.

Principe de sécurité : une notification ou un retour navigateur ne valide jamais un paiement
à lui seul. Le serveur interroge toujours le prestataire (appel authentifié par la clé secrète)
et vérifie statut, montant et devise avant d'activer l'abonnement.

* CinetPay — Mobile Money (M-Pesa, Airtel Money, Orange Money…) et cartes, Afrique francophone (RDC incluse).
  API « checkout v2 » : https://docs.cinetpay.com
* Stripe — cartes bancaires internationales. API Checkout Sessions : https://docs.stripe.com/api/checkout/sessions
"""
import logging
import math

import requests

from odoo import _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)
TIMEOUT = 20


class ProviderError(UserError):
    pass


class BaseProvider:
    code = None
    label = None
    method = None  # moyen de paiement enregistré sur la facture

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

    def start(self, invoice, reference, return_url, notify_url):
        """Crée la transaction ; retourne l'URL de paiement vers laquelle rediriger le client."""
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

    def start(self, invoice, reference, return_url, notify_url):
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
            return 'pending', False, str(exc)[:200]
        info = data.get('data') or {}
        status = (info.get('status') or '').upper()
        if str(data.get('code')) == '00' and status == 'ACCEPTED':
            paid_amount = float(info.get('amount') or 0)
            if paid_amount + 1e-6 < self.amount(invoice) or (info.get('currency') or '').upper() != invoice.currency_id.name:
                return 'failed', False, _("Montant ou devise non conforme (%(a)s %(c)s).", a=info.get('amount'), c=info.get('currency'))
            return 'paid', info.get('operator_id') or invoice.online_reference, info.get('payment_method') or ''
        if status in ('REFUSED', 'CANCELED', 'CANCELLED') or str(data.get('code')) in ('600', '627'):
            return 'failed', False, data.get('message') or status
        return 'pending', False, data.get('message') or status


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

    def start(self, invoice, reference, return_url, notify_url):
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
            return 'pending', False, str(exc)[:200]
        if resp.status_code >= 400:
            return 'pending', False, (data.get('error') or {}).get('message') or ''
        if data.get('client_reference_id') != invoice.online_reference:
            return 'failed', False, _("Session de paiement étrangère à cette facture.")
        if data.get('payment_status') == 'paid':
            if int(data.get('amount_total') or 0) < self.cents(invoice) or \
                    (data.get('currency') or '').upper() != invoice.currency_id.name:
                return 'failed', False, _("Montant ou devise non conforme.")
            return 'paid', data.get('payment_intent') or data.get('id'), 'card'
        if data.get('status') == 'expired':
            return 'failed', False, _("Session de paiement expirée.")
        return 'pending', False, data.get('payment_status') or ''


PROVIDERS = {p.code: p for p in (CinetPay, Stripe)}


def get_provider(env, code):
    cls = PROVIDERS.get(code)
    return cls(env) if cls else None


def enabled_providers(env):
    return [p(env) for p in PROVIDERS.values() if p(env).enabled()]
