# -*- coding: utf-8 -*-
"""Envoi des codes d'accès aux candidats par SMS ou WhatsApp.

Les codes restent hachés en base : le clair n'existe qu'au moment de la génération, dans la
console du personnel. Celle-ci le renvoie ici pour l'envoi ; le serveur vérifie qu'il correspond
bien au candidat (aucun texte arbitraire ne peut être expédié), l'envoie, puis l'oublie : seuls la
date et le canal de l'envoi sont conservés, jamais le code.

Fournisseurs (paramètres système, jamais dans le code) :
    selecta.msg.provider       none | africastalking | twilio
    selecta.msg.username       Africa's Talking : nom d'utilisateur de l'application
    selecta.msg.account_sid    Twilio : identifiant du compte
    selecta.msg.api_key        clé (Africa's Talking) ou jeton d'authentification (Twilio)
    selecta.msg.sms_from       expéditeur SMS (identifiant alphanumérique ou numéro)
    selecta.msg.whatsapp_from  Twilio : numéro WhatsApp Business (ex. +14155238886)
"""
import logging
import re

import requests

from odoo import _, api, fields, models

_logger = logging.getLogger(__name__)
TIMEOUT = 10
DAILY_LIMIT = 300  # messages envoyés par structure sur 24 h (paramètre selecta.msg.daily_limit)
URL_RE = re.compile(r'(https?://|www\.)\S*', re.I)
PARAMS = ('provider', 'username', 'account_sid', 'api_key', 'sms_from', 'whatsapp_from')


def normalize_phone(phone, country=None):
    """Numéro au format international (+243…) ; un numéro local reçoit l'indicatif du pays."""
    raw = (phone or '').strip()
    digits = re.sub(r'\D', '', raw)
    if raw.startswith('+'):
        number = digits
    elif digits.startswith('00'):
        number = digits[2:]
    elif country and country.phone_code:
        number = '%s%s' % (country.phone_code, digits[1:] if digits.startswith('0') else digits)
    else:
        number = digits
    return '+%s' % number if 8 <= len(number) <= 15 else ''


def clean_text(text, limit):
    """Texte saisi par une structure, repris dans un SMS : sans lien ni retour à la ligne, longueur bornée.

    Le compte d'envoi est celui de la plateforme : il ne doit pas pouvoir relayer un lien d'hameçonnage.
    """
    text = URL_RE.sub('', text or '')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:limit].rstrip()


class SelectaMessaging(models.AbstractModel):
    _name = 'selecta.messaging'
    _description = 'Envoi SMS / WhatsApp SELECTA'

    @api.model
    def _config(self):
        icp = self.env['ir.config_parameter'].sudo()
        return {k: (icp.get_param('selecta.msg.%s' % k) or '').strip() for k in PARAMS}

    @api.model
    def channels(self):
        """Canaux d'envoi automatique disponibles : 'sms', 'whatsapp'."""
        cfg = self._config()
        out = []
        if cfg['provider'] == 'africastalking' and cfg['username'] and cfg['api_key']:
            out.append('sms')
        elif cfg['provider'] == 'twilio' and cfg['account_sid'] and cfg['api_key']:
            if cfg['sms_from']:
                out.append('sms')
            if cfg['whatsapp_from']:
                out.append('whatsapp')
        return out

    @api.model
    def send(self, channel, phone, text):
        """Envoie ``text`` au numéro international ``phone``. Retourne (succès, message d'erreur)."""
        cfg = self._config()
        if channel not in self.channels():
            return False, _("Canal %s non configuré.", channel)
        try:
            if cfg['provider'] == 'africastalking':
                data = {'username': cfg['username'], 'to': phone, 'message': text}
                if cfg['sms_from']:
                    data['from'] = cfg['sms_from']
                host = 'api.sandbox.africastalking.com' if cfg['username'] == 'sandbox' else 'api.africastalking.com'
                resp = requests.post('https://%s/version1/messaging' % host, data=data, timeout=TIMEOUT,
                                     headers={'apiKey': cfg['api_key'], 'Accept': 'application/json'})
                try:
                    recipients = ((resp.json().get('SMSMessageData') or {}).get('Recipients') or []) if resp.ok else []
                except ValueError:
                    recipients = []
                if recipients and recipients[0].get('status') in ('Success', 'Sent', 'Queued'):
                    return True, ''
                return False, (recipients[0].get('status') if recipients else resp.text[:120]) or _("refusé")
            sender = cfg['whatsapp_from'] if channel == 'whatsapp' else cfg['sms_from']
            prefix = 'whatsapp:' if channel == 'whatsapp' else ''
            resp = requests.post(
                'https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json' % cfg['account_sid'],
                data={'To': prefix + phone, 'From': prefix + sender, 'Body': text},
                auth=(cfg['account_sid'], cfg['api_key']), timeout=TIMEOUT)
            if resp.status_code in (200, 201):
                return True, ''
            try:
                return False, str(resp.json().get('message') or resp.status_code)[:160]
            except ValueError:
                return False, str(resp.status_code)
        except requests.RequestException as exc:
            _logger.warning("SELECTA : envoi %s impossible : %s", channel, exc)
            return False, _("Service d'envoi injoignable.")

    @api.model
    def code_message(self, candidate, code):
        """Texte envoyé au candidat : structure, concours, code, lieu (présentiel) ou adresse (à distance)."""
        c = candidate.concours_id.sudo()
        parts = ["%s - %s." % (clean_text(c.company_id.name, 60), clean_text(c.name, 60)),
                 _("Votre code d'accès SELECTA : %s", code)]
        if c.date_start:
            start = fields.Datetime.context_timestamp(self.with_context(tz=self.env.user.tz or 'Africa/Kinshasa'),
                                                      c.date_start)
            parts.append(_("Épreuve le %s.", start.strftime('%d/%m/%Y à %H:%M')))
        if c.exam_mode == 'remote':
            base = self.env['ir.config_parameter'].sudo().get_param('web.base.url', '').rstrip('/')
            parts.append(_("À distance, webcam obligatoire : %s/selecta/exam", base))
        else:
            parts.append(_("En présentiel : %s. Présentez une pièce d'identité.",
                           clean_text(c.exam_venue, 90) or _("salle d'examen")))
        parts.append(_("Code personnel, valable une seule fois : ne le communiquez à personne."))
        return " ".join(parts)
