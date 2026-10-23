# -*- coding: utf-8 -*-
"""Connecteur du Dispositif Électronique Fiscal en ligne (e-MCF de la DGI, API v1.3).

Flux d'une facture (spécification e-MCF, workflow p. 5) :
  1. ``POST /api/invoice``                → demande en attente, ``uid`` et totaux recalculés par la DGI ;
  2. comparaison avec notre calcul         → au moindre écart : ``cancel`` et blocage (pas de facture fausse) ;
  3. ``PUT /api/invoice/{uid}/confirm``    → éléments de sécurité : codeDEFDGI, counters, nim, dateTime, qrCode.

Robustesse :
* l'``uid`` est enregistré dès sa réception ; une reprise repart de la demande en attente au lieu d'en créer une autre ;
* avant tout nouvel envoi, les demandes en attente sont relues et rapprochées par ``rn`` (notre numéro) ;
* une confirmation sans réponse est « incertaine » : jamais renvoyée à l'aveugle, résolue après vérification ;
* chaque échange est journalisé (sans le jeton), en ajout seul.

Mode « simulation » : un e-MCF local qui applique les mêmes règles, pour la démonstration et la formation.
Ses codes commencent par « SIMU » et les factures portent la mention « SANS VALEUR FISCALE ».
"""
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime
from decimal import Decimal

import requests

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

from ..lib import fiscal

_logger = logging.getLogger(__name__)

CONNECT_TIMEOUT = 5
READ_TIMEOUT = 25
ERROR_MESSAGES = {
    '1': "Trop de demandes en attente sur le DEF (10 au maximum).",
    '12': "Le montant de l'avoir dépasse celui de la facture d'origine.",
    '20': "La demande n'existe pas ou a déjà été finalisée / annulée.",
    '41': "Nom du client obligatoire pour ce type de client.",
    '42': "NIF du client obligatoire pour ce type de client.",
    '50': "Le total TTC déclaré ne correspond pas au calcul de la DGI.",
    '51': "Le total TVA déclaré ne correspond pas au calcul de la DGI.",
    '60': "Facture d'origine introuvable auprès de la DGI.",
    '63': "Une demande est déjà en attente pour cette facture.",
}
# Erreurs pour lesquelles une nouvelle tentative automatique ne changerait rien.
NON_BLOCKING = {'1', '63'}


class EmcfError(Exception):
    def __init__(self, message, blocking=False, code=None):
        super().__init__(message)
        self.blocking = blocking
        self.code = code


class Uncertain(EmcfError):
    pass


class NormaEmcfLog(models.Model):
    _name = 'norma.emcf.log'
    _description = "Échange avec l'e-MCF"
    _order = 'id desc'

    company_id = fields.Many2one('res.company', index=True, readonly=True)
    site_id = fields.Many2one('norma.site', index=True, readonly=True, ondelete='set null')
    invoice_id = fields.Many2one('norma.invoice', index=True, readonly=True, ondelete='set null')
    mode = fields.Char(readonly=True)
    method = fields.Char(readonly=True)
    path = fields.Char(readonly=True)
    http_status = fields.Integer(readonly=True)
    duration_ms = fields.Integer(readonly=True)
    request = fields.Text(readonly=True)
    response = fields.Text(readonly=True)
    error = fields.Char(readonly=True)
    digest = fields.Char(readonly=True)

    def write(self, vals):
        raise AccessError(_("Le journal des échanges est en ajout seul."))

    def unlink(self):
        raise AccessError(_("Le journal des échanges est conservé (10 ans)."))


class NormaEmcf(models.AbstractModel):
    _name = 'norma.emcf'
    _description = 'Connecteur e-MCF DGI'

    EmcfError = EmcfError
    Uncertain = Uncertain

    # ================================================================ transport
    def _call(self, site, method, path, body=None, invoice=None):
        site = site.sudo()
        started = time.monotonic()
        status, data, error = 0, None, None
        try:
            if site.emcf_mode == 'simulation':
                status, data = self.env['norma.emcf.sim']._handle(site, method, path, body)
            else:
                if not site.emcf_url or not site.emcf_token:
                    raise EmcfError(_("Adresse ou jeton e-MCF non configuré pour l'établissement %s.") % site.code,
                                    blocking=True)
                if not site._emcf_url_allowed(site.emcf_url):
                    raise EmcfError(_("Adresse e-MCF non autorisée par la plateforme."), blocking=True)
                url = site.emcf_url.rstrip('/') + path
                resp = requests.request(method, url, json=body, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                                        allow_redirects=False,
                                        headers={'Authorization': 'Bearer %s' % site.emcf_token.strip(),
                                                 'Accept': 'application/json'})
                if 300 <= resp.status_code < 400:
                    raise EmcfError(_("Redirection refusée par NORMA (HTTP %s).") % resp.status_code, blocking=True)
                status = resp.status_code
                try:
                    data = resp.json() if resp.content else {}
                except ValueError:
                    data = {'raw': resp.text[:500]}
        except requests.Timeout as exc:
            error = 'timeout'
            if method == 'PUT' and path.endswith('/confirm'):
                raise Uncertain(_("Délai dépassé en attendant la confirmation de la DGI.")) from exc
            raise EmcfError(_("La DGI ne répond pas (délai dépassé). Nouvelle tentative automatique.")) from exc
        except requests.RequestException as exc:
            error = 'network'
            raise EmcfError(_("Connexion à la DGI impossible. Nouvelle tentative automatique.")) from exc
        finally:
            self._log(site, invoice, method, path, body, status, data, error, started)
        if status == 401:
            site.write({'emcf_status': 'error', 'emcf_status_message': _("Jeton e-MCF expiré ou invalide.")})
            raise EmcfError(_("Jeton e-MCF expiré ou invalide : renouvelez-le dans les paramètres de l'établissement."))
        if status >= 500 or status == 0:
            raise EmcfError(_("Service e-MCF indisponible (%s). Nouvelle tentative automatique.") % status)
        if isinstance(data, dict) and data.get('errorCode') not in (None, '', '0', 0):
            code = str(data.get('errorCode'))
            msg = ERROR_MESSAGES.get(code) or data.get('errorDesc') or _("Erreur e-MCF")
            raise EmcfError("[%s] %s" % (code, msg), blocking=code not in NON_BLOCKING, code=code)
        if status >= 400:
            raise EmcfError(_("Requête refusée par l'e-MCF (HTTP %s).") % status, blocking=True)
        return data or {}

    def _log(self, site, invoice, method, path, body, status, data, error, started):
        req = json.dumps(body, ensure_ascii=False, sort_keys=True) if body is not None else ''
        res = json.dumps(data, ensure_ascii=False, sort_keys=True) if data is not None else ''
        self.env['norma.emcf.log'].sudo().create({
            'company_id': site.company_id.id, 'site_id': site.id, 'invoice_id': invoice.id if invoice else False,
            'mode': site.emcf_mode, 'method': method, 'path': path, 'http_status': status,
            'duration_ms': int((time.monotonic() - started) * 1000), 'request': req[:20000], 'response': res[:20000],
            'error': error, 'digest': hashlib.sha256((req + '|' + res).encode()).hexdigest(),
        })

    # ================================================================ statut
    def _status(self, site):
        site = site.sudo()
        try:
            data = self._call(site, 'GET', '/api/info/status')
        except EmcfError as exc:
            site.write({'emcf_status': 'error', 'emcf_status_message': str(exc)[:200],
                        'emcf_checked_at': fields.Datetime.now()})
            return site
        ok = bool(data.get('status')) and data.get('tokenValid', True) is not False
        nif = (data.get('nif') or '').strip()
        msg = _("DEF opérationnel — version %s") % (data.get('version') or '?')
        if nif and site.company_id.norma_nif and nif != site.company_id.norma_nif:
            ok, msg = False, _("Le jeton appartient au NIF %s, différent du NIF de l'entreprise.") % nif
        if data.get('tokenValid') is False:
            msg = _("Jeton e-MCF expiré.")
        site.write({'emcf_status': 'ok' if ok else 'error', 'emcf_status_message': msg[:200],
                    'emcf_nif_mismatch': bool(nif and nif != site.company_id.norma_nif),
                    'emcf_nim': data.get('nim') or site.emcf_nim, 'emcf_checked_at': fields.Datetime.now()})
        return site

    # ================================================================ demande de normalisation
    def _payload(self, inv):
        company, site = inv.company_id, inv.site_id
        if not company.norma_nif:
            raise EmcfError(_("Le NIF de l'entreprise n'est pas renseigné."), blocking=True)
        if site.emcf_mode != 'simulation' and not site.emcf_isf:
            raise EmcfError(_("L'ISF de l'établissement %s n'est pas renseigné.") % site.code, blocking=True)
        items = []
        for l in inv.line_ids:
            item = {'code': (l.product_id.code or 'P%s' % l.product_id.id)[:50], 'name': l.name[:120],
                    'type': l.item_type or 'BIE', 'price': round(l.net_price, 2), 'quantity': round(l.quantity, 3),
                    'taxGroup': l.tax_group}
            if l.specific_tax:
                item['taxSpecificValue'] = ('%.2f' % (l.specific_tax / l.quantity)).rstrip('0').rstrip('.')
                item['taxSpecificAmount'] = round(l.specific_tax, 2)
            if l.discount_pct:
                item['originalPrice'] = round(l.unit_price, 2)
                item['priceModification'] = ('Remise %g%%' % l.discount_pct)[:20]
            items.append(item)
        dto = {
            'nif': company.norma_nif, 'rn': inv.number, 'mode': 'ttc', 'isf': site.emcf_isf or 'SIM-ULA-00',
            'type': inv.invoice_type, 'items': items,
            'operator': {'id': str(inv.operator_id.id or 1), 'name': (inv.operator_id.name or 'Caisse')[:60]},
            'payment': [], 'cmta': ('Etablissement %s - %s' % (site.code, site.name))[:60],
        }
        foreign = inv.currency and inv.currency != 'CDF'
        for p in inv.payment_ids:
            row = {'name': p.method, 'amount': round(p.amount_cdf, 2)}
            if foreign:
                row.update(currencyCode=inv.currency, currencyRate=inv.currency_rate)
            dto['payment'].append(row)
        if inv.client_name or inv.client_nif:
            client = {'nif': inv.client_nif, 'name': inv.client_name, 'contact': inv.client_contact,
                      'address': inv.client_address, 'type': inv.client_type}
            if inv.client_type == 'AO' and inv.client_exemption:
                client['typeDesc'] = inv.client_exemption[:60]
            dto['client'] = {k: v for k, v in client.items() if v}
        if inv.reversed_id:
            dto['reference'] = inv.reversed_id.emcf_code
            dto['referenceType'] = inv.reference_type or 'COR'
            dto['referenceDesc'] = (inv.reversal_reason or '')[:20]
        if foreign:
            dto['curCode'] = inv.currency
            dto['curRate'] = inv.currency_rate
            dto['curDate'] = fields.Datetime.context_timestamp(inv, inv.date).strftime('%Y-%m-%d %H:%M:%S')
        return dto

    def _ours(self, inv):
        """Notre calcul, tel qu'enregistré sur la facture, au format du comparateur."""
        return {'total': Decimal(str('%.2f' % inv.total)), 'total_tax': Decimal(str('%.2f' % inv.total_tax)),
                'groups': [{'code': g.code, 'ttc': Decimal('%.2f' % g.ttc), 'tax': Decimal('%.2f' % g.tax)}
                           for g in inv.group_ids]}

    def _find_pending(self, inv):
        """Demande déjà en attente pour cette facture (envoi précédent dont la réponse s'est perdue)."""
        if inv.emcf_uid:
            try:
                data = self._call(inv.site_id, 'GET', '/api/invoice/%s' % inv.emcf_uid, invoice=inv)
                return inv.emcf_uid, data
            except EmcfError as exc:
                if exc.code != '20':
                    raise
        listing = self._call(inv.site_id, 'GET', '/api/invoice', invoice=inv)
        for row in (listing.get('pendingRequestsList') or [])[:10]:
            req_uid = row.get('uid')
            if not req_uid:
                continue
            data = self._call(inv.site_id, 'GET', '/api/invoice/%s' % req_uid, invoice=inv)
            if (data.get('rn') or (data.get('request') or {}).get('rn')) == inv.number:
                return req_uid, data
        return None, None

    def _normalize(self, inv):
        inv = inv.with_context(norma_engine=True).sudo()
        site, company = inv.site_id, inv.company_id
        # Contrôles avant tout appel réseau.
        if site.emcf_mode != 'simulation':
            if not company.norma_verified:
                raise EmcfError(_("Entreprise non encore vérifiée par la plateforme : transmission à la DGI impossible."),
                                blocking=True)
            if site.emcf_nif_mismatch:
                raise EmcfError(_("Le jeton e-MCF appartient à un autre NIF que celui de l'entreprise."), blocking=True)
        if inv.state == 'uncertain':
            # Seule une demande encore en attente peut être confirmée à nouveau sans risque de doublon.
            if not inv.emcf_uid:
                raise Uncertain(_("Confirmation incertaine : vérifiez la facture sur le portail de la DGI."))
            try:
                totals = self._call(site, 'GET', '/api/invoice/%s' % inv.emcf_uid, invoice=inv)
            except EmcfError as exc:
                if exc.code == '20':
                    raise Uncertain(_("La DGI n'a plus de demande en attente : vérifiez sur son portail si la "
                                      "facture %s a été enregistrée.") % inv.number)
                raise Uncertain(str(exc))
            req_uid = inv.emcf_uid
        else:
            req_uid, totals = self._find_pending(inv)
            if not req_uid:
                totals = self._call(site, 'POST', '/api/invoice', self._payload(inv), invoice=inv)
                req_uid = totals.get('uid')
                if not req_uid:
                    raise EmcfError(_("Réponse de l'e-MCF sans identifiant de demande."), blocking=True)
            inv.write({'emcf_uid': req_uid})
            inv._commit()
        diffs = fiscal.compare_with_emcf(self._ours(inv), totals)
        if diffs:
            try:
                self._call(site, 'PUT', '/api/invoice/%s/cancel' % req_uid, invoice=inv)
            finally:
                inv.write({'emcf_uid': False})
            raise EmcfError(_("Écart de calcul avec la DGI, facture non confirmée : %s") % '; '.join(diffs),
                            blocking=True)
        # État « incertain » enregistré AVANT la confirmation : si le processus s'arrête pendant l'appel,
        # aucune reprise automatique ne renverra la facture (pas de doublon à la DGI).
        inv.write({'state': 'uncertain', 'emcf_error': _("Confirmation envoyée à la DGI, réponse attendue.")})
        inv._commit()
        try:
            sec = self._call(site, 'PUT', '/api/invoice/%s/confirm' % req_uid,
                             {'total': totals.get('total'), 'vtotal': totals.get('vtotal')}, invoice=inv)
        except Uncertain:
            raise
        except EmcfError as exc:
            if exc.code in (None,) and not exc.blocking:
                raise Uncertain(_("Pas de réponse à la confirmation : %s") % exc)
            raise
        code = sec.get('codeDEFDGI') if isinstance(sec, dict) else None
        if not code:
            raise Uncertain(_("Réponse de confirmation incomplète (pas de code DEF/DGI)."))
        return {'emcf_code': code, 'emcf_nim': sec.get('nim') or site.emcf_nim, 'emcf_counters': sec.get('counters'),
                'emcf_datetime': sec.get('dateTime'), 'emcf_qr': sec.get('qrCode'), 'emcf_mode': site.emcf_mode}

    def _cancel_pending(self, inv):
        if not inv.emcf_uid:
            return
        try:
            self._call(inv.site_id, 'PUT', '/api/invoice/%s/cancel' % inv.emcf_uid, invoice=inv)
        except EmcfError as exc:
            if exc.code != '20':
                raise UserError(_("Annulation de la demande en attente impossible : %s") % exc)

    # ================================================================ référentiels
    def _sync_tax_groups(self, site):
        """Met à jour les taux depuis ``/api/info/taxGroups`` (les groupes ont changé deux fois en 2026)."""
        data = self._call(site, 'GET', '/api/info/taxGroups')
        rows = data if isinstance(data, list) else (data.get('taxGroups') or data.get('list') or data.get('data') or [])
        Group = self.env['norma.tax.group'].sudo()
        updated = 0
        for row in rows:
            code = str(row.get('code') or row.get('name') or '').strip().upper()[:2]
            if not code:
                continue
            vals = {'name': (row.get('description') or row.get('desc') or row.get('label') or code)[:120]}
            for key in ('rate', 'value', 'taux'):
                if row.get(key) is not None:
                    try:
                        vals['rate'] = float(row[key])
                    except (TypeError, ValueError):
                        pass
                    break
            group = Group.with_context(active_test=False).search([('code', '=', code)], limit=1)
            if group:
                group.write(vals)
            else:
                Group.create(dict(vals, code=code, rate=vals.get('rate', 0.0)))
            updated += 1
        return updated


class NormaEmcfSim(models.Model):
    """e-MCF local de démonstration. Applique les règles SFE ; ses factures n'ont aucune valeur fiscale."""
    _name = 'norma.emcf.sim'
    _description = 'e-MCF simulé (démonstration)'

    site_id = fields.Many2one('norma.site', required=True, index=True, ondelete='cascade')
    req_uid = fields.Char(required=True, index=True)
    rn = fields.Char(index=True)
    request = fields.Text()
    totals = fields.Text()
    state = fields.Selection([('pending', 'En attente'), ('confirmed', 'Confirmée'), ('cancelled', 'Annulée')],
                             default='pending')
    code = fields.Char(index=True)
    counter = fields.Integer()

    def _nim(self, site):
        return 'SIMU%06d' % site.id

    def _handle(self, site, method, path, body):
        site = site.sudo()
        if path == '/api/info/status':
            return 200, {'status': True, 'version': '1.3-sim', 'nif': site.company_id.norma_nif, 'nim': self._nim(site),
                         'tokenValid': True, 'serverDateTime': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
                         'emcfList': [{'nim': self._nim(site), 'shopName': site.name, 'status': 'Actif'}]}
        if path == '/api/info/taxGroups':
            return 200, [{'code': g.code, 'description': g.name, 'rate': g.rate}
                         for g in self.env['norma.tax.group'].sudo().search([])]
        if path == '/api/invoice' and method == 'GET':
            pend = self.sudo().search([('site_id', '=', site.id), ('state', '=', 'pending')])
            return 200, {'pendingRequestsList': [{'uid': p.req_uid, 'date': str(p.create_date)} for p in pend]}
        if path == '/api/invoice' and method == 'POST':
            return self._post(site, body or {})
        parts = path.strip('/').split('/')
        if len(parts) >= 3 and parts[:2] == ['api', 'invoice']:
            rec = self.sudo().search([('site_id', '=', site.id), ('req_uid', '=', parts[2])], limit=1)
            if not rec or rec.state != 'pending':
                return 200, {'errorCode': '20', 'errorDesc': ERROR_MESSAGES['20']}
            if method == 'GET' and len(parts) == 3:
                return 200, dict(json.loads(rec.totals), rn=rec.rn)
            if method == 'PUT' and parts[3:] == ['cancel']:
                rec.state = 'cancelled'
                return 200, {'uid': rec.req_uid}
            if method == 'PUT' and parts[3:] == ['confirm']:
                return self._confirm(site, rec, body or {})
        return 404, {'errorCode': '99', 'errorDesc': 'Ressource inconnue'}

    def _post(self, site, req):
        Sim = self.sudo()
        if Sim.search_count([('site_id', '=', site.id), ('state', '=', 'pending')]) >= 10:
            return 200, {'errorCode': '1', 'errorDesc': ERROR_MESSAGES['1']}
        if Sim.search_count([('site_id', '=', site.id), ('rn', '=', req.get('rn')), ('state', '=', 'pending')]):
            return 200, {'errorCode': '63', 'errorDesc': ERROR_MESSAGES['63']}
        client = req.get('client') or {}
        if client.get('type') in ('PM', 'PC', 'PL', 'AO') and not client.get('name'):
            return 200, {'errorCode': '41', 'errorDesc': ERROR_MESSAGES['41']}
        if client.get('type') in ('PM', 'PC', 'PL') and not client.get('nif'):
            return 200, {'errorCode': '42', 'errorDesc': ERROR_MESSAGES['42']}
        groups = self.env['norma.tax.group']._rates()
        lines = [{'price': i['price'], 'quantity': i['quantity'], 'tax_group': i['taxGroup'],
                  'specific_tax': Decimal(str(i.get('taxSpecificAmount') or 0)) / Decimal(str(i['quantity']))}
                 for i in req.get('items') or []]
        try:
            res = fiscal.compute_invoice(lines, groups)
        except fiscal.FiscalError as exc:
            return 200, {'errorCode': '30', 'errorDesc': str(exc)}
        if req.get('type') in ('FA', 'EA'):
            orig = self.env['norma.invoice'].sudo().search([('emcf_code', '=', req.get('reference')),
                                                            ('company_id', '=', site.company_id.id)], limit=1)
            if not orig:
                return 200, {'errorCode': '60', 'errorDesc': ERROR_MESSAGES['60']}
            credited = sum(orig.credit_note_ids.filtered(lambda c: c.state == 'normalized').mapped('total'))
            if Decimal(str(credited)) + res['total'] > Decimal(str(orig.total)) + Decimal('0.01'):
                return 200, {'errorCode': '12', 'errorDesc': ERROR_MESSAGES['12']}
        totals = {'total': float(res['total']), 'vtotal': float(res['total_tax'])}
        for g in res['groups']:
            k = g['code'].lower()
            totals.update({'t' + k: float(g['rate']), 'ta' + k: float(g['ttc']), 'ha' + k: float(g['base']),
                           'va' + k: float(g['tax'])})
        req_uid = str(uuid.uuid4())
        Sim.create({'site_id': site.id, 'req_uid': req_uid, 'rn': req.get('rn'), 'request': json.dumps(req),
                    'totals': json.dumps(totals)})
        return 200, dict(totals, uid=req_uid)

    def _confirm(self, site, rec, body):
        totals = json.loads(rec.totals)
        if abs(float(body.get('total') or 0) - totals['total']) > 0.001:
            return 200, {'errorCode': '50', 'errorDesc': ERROR_MESSAGES['50']}
        if abs(float(body.get('vtotal') or 0) - totals['vtotal']) > 0.001:
            return 200, {'errorCode': '51', 'errorDesc': ERROR_MESSAGES['51']}
        self.env.cr.execute("SELECT COALESCE(MAX(counter), 0) FROM norma_emcf_sim WHERE site_id = %s", (site.id,))
        counter = self.env.cr.fetchone()[0] + 1
        req = json.loads(rec.request)
        sig = hmac.new((site.sim_secret or 'norma').encode(), ('%s|%s|%s' % (rec.req_uid, rec.rn, totals['total'])).encode(),
                       hashlib.sha256).hexdigest().upper()
        code = 'SIMU-' + '-'.join(sig[i:i + 4] for i in range(0, 16, 4))
        now = datetime.now()
        rec.write({'state': 'confirmed', 'code': code, 'counter': counter})
        return 200, {
            'codeDEFDGI': code, 'nim': self._nim(site),
            'counters': '%d/%d %s' % (counter, counter, req.get('type')),
            'dateTime': now.strftime('%d/%m/%Y %H:%M:%S'),
            'qrCode': 'RDCDEF01;%s;%s;%s;%s' % (self._nim(site), code.replace('-', ''), req.get('nif'),
                                               now.strftime('%Y%m%d%H%M%S')),
        }
