# -*- coding: utf-8 -*-
"""Facture normalisée : calcul serveur, numérotation sans trou, transmission e-MCF, immuabilité, avoirs."""
import hashlib
import json
import logging
import secrets
import threading
from decimal import Decimal

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

from ..lib import fiscal

_logger = logging.getLogger(__name__)

INVOICE_TYPES = [
    ('FV', "Facture de vente"),
    ('FT', "Facture d'acompte"),
    ('FA', "Facture d'avoir"),
    ('EV', "Facture de vente à l'exportation"),
    ('ET', "Facture d'acompte à l'exportation"),
    ('EA', "Facture d'avoir à l'exportation"),
]
EXPORT_TYPES = ('EV', 'ET', 'EA')
CREDIT_TYPES = {'FA': ('FV', 'FT'), 'EA': ('EV', 'ET')}
REFERENCE_TYPES = [
    ('COR', "Correction"),
    ('RAN', "Annulation"),
    ('RAM', "Avoir suite à reprise de marchandises"),
    ('RRR', "Rabais, remise, ristourne"),
]
PAYMENT_METHODS = [
    ('ESPECES', 'Espèces'),
    ('MOBILEMONEY', 'Mobile Money'),
    ('CARTEBANCAIRE', 'Carte bancaire'),
    ('VIREMENT', 'Virement'),
    ('CHEQUES', 'Chèque'),
    ('CREDIT', 'À crédit'),
    ('AUTRE', 'Autre'),
]
STATES = [
    ('draft', 'Brouillon'),
    ('failed', 'En attente de normalisation'),
    ('uncertain', 'Confirmation à vérifier'),
    ('normalized', 'Normalisée'),
    ('cancelled', 'Abandonnée'),
]


class NormaInvoice(models.Model):
    _name = 'norma.invoice'
    _description = 'Facture normalisée'
    _order = 'id desc'
    _rec_name = 'number'

    company_id = fields.Many2one('res.company', required=True, index=True, readonly=True)
    site_id = fields.Many2one('norma.site', required=True, index=True, readonly=True, ondelete='restrict')
    invoice_type = fields.Selection(INVOICE_TYPES, required=True, default='FV', readonly=True)
    number = fields.Char("Numéro", readonly=True, copy=False, index=True)
    state = fields.Selection(STATES, default='draft', required=True, readonly=True, index=True)
    origin = fields.Char("Origine", readonly=True, help="Séjour, table, devis à l'origine de la facture.")
    operator_id = fields.Many2one('res.users', readonly=True, string="Opérateur")
    date = fields.Datetime(readonly=True, default=fields.Datetime.now)

    # ---------------------------------------------------------------- client (copie figée à l'émission)
    customer_id = fields.Many2one('norma.customer', readonly=True, ondelete='restrict')
    client_type = fields.Char(readonly=True)
    client_name = fields.Char(readonly=True)
    client_nif = fields.Char(readonly=True)
    client_address = fields.Char(readonly=True)
    client_contact = fields.Char(readonly=True)
    client_exemption = fields.Char(readonly=True)

    # ---------------------------------------------------------------- montants (toujours en CDF)
    currency = fields.Char("Devise d'affichage", readonly=True, default='CDF')
    currency_rate = fields.Float(readonly=True, digits=(16, 4), default=1.0,
                                 help="CDF pour 1 unité de la devise d'affichage, utilisé pour cette facture.")
    line_ids = fields.One2many('norma.invoice.line', 'invoice_id', readonly=True)
    payment_ids = fields.One2many('norma.invoice.payment', 'invoice_id', readonly=True)
    group_ids = fields.One2many('norma.invoice.group', 'invoice_id', readonly=True)
    total_ht = fields.Float(readonly=True, digits=(16, 2))
    total_tax = fields.Float(readonly=True, digits=(16, 2))
    total_specific = fields.Float(readonly=True, digits=(16, 2))
    total = fields.Float(readonly=True, digits=(16, 2))
    total_currency = fields.Float("Total en devise", readonly=True, digits=(16, 2))
    note = fields.Char(readonly=True)

    # ---------------------------------------------------------------- avoir
    reversed_id = fields.Many2one('norma.invoice', string="Facture d'origine", readonly=True, index=True)
    reference_type = fields.Selection(REFERENCE_TYPES, string="Nature de l'avoir", readonly=True)
    reversal_reason = fields.Char(readonly=True)
    credit_note_ids = fields.One2many('norma.invoice', 'reversed_id', readonly=True)

    # ---------------------------------------------------------------- données de la DGI (e-MCF)
    emcf_uid = fields.Char(readonly=True, copy=False, index=True)
    emcf_code = fields.Char("Code DEF/DGI", readonly=True, copy=False, index=True)
    emcf_nim = fields.Char("NIM / NID du DEF", readonly=True, copy=False)
    emcf_counters = fields.Char("Compteurs DEF", readonly=True, copy=False)
    emcf_datetime = fields.Char("Heure DEF", readonly=True, copy=False)
    emcf_qr = fields.Char("Contenu du QR code", readonly=True, copy=False)
    emcf_mode = fields.Char(readonly=True, copy=False)
    emcf_error = fields.Char(readonly=True, copy=False)
    emcf_blocked = fields.Boolean(readonly=True, copy=False,
                                  help="Écart de calcul ou refus de la DGI : pas de nouvelle tentative automatique.")
    emcf_attempts = fields.Integer(readonly=True, copy=False)
    normalized_at = fields.Datetime(readonly=True, copy=False)

    # ---------------------------------------------------------------- intégrité
    verify_token = fields.Char(readonly=True, copy=False, index=True)
    request_key = fields.Char(readonly=True, copy=False, index=True,
                              help="Clé d'idempotence fournie par le poste : une requête rejouée ne crée pas de seconde facture.")
    chain_prev = fields.Char(readonly=True, copy=False)
    chain_hash = fields.Char(readonly=True, copy=False)
    print_count = fields.Integer(readonly=True, copy=False)

    _sql_constraints = [
        ('number_unique', 'unique(company_id, number)', "Numéro de facture déjà attribué."),
        ('verify_token_unique', 'unique(verify_token)', "Jeton déjà utilisé."),
        ('request_key_unique', 'unique(company_id, request_key)', "Requête déjà traitée."),
    ]

    # ================================================================ garde-fous
    def write(self, vals):
        if not self.env.context.get('norma_engine'):
            raise AccessError(_("Les factures ne se modifient que par les opérations prévues."))
        if any(inv.state == 'normalized' for inv in self) and set(vals) - {'print_count'}:
            raise UserError(_("Une facture normalisée est définitive : émettez une facture d'avoir."))
        return super().write(vals)

    def unlink(self):
        if any(inv.state != 'draft' for inv in self):
            raise UserError(_("Seul un brouillon peut être supprimé ; une facture numérotée est conservée."))
        return super().unlink()

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.context.get('norma_engine'):
            raise AccessError(_("Les factures se créent par la caisse ou l'éditeur de factures."))
        return super().create(vals_list)

    @api.model
    def _engine(self):
        return self.sudo().with_context(norma_engine=True)

    def _commit(self):
        # Les tests tournent dans une transaction annulée à la fin : pas de validation intermédiaire.
        if not (self.env.registry.in_test_mode() or getattr(threading.current_thread(), 'testing', False)):
            self.env.cr.commit()

    # ================================================================ construction
    @api.model
    def _build(self, site, data, user):
        """Crée une facture brouillon à partir d'une saisie dont l'appelant a vérifié les droits.

        ``data`` : invoice_type, customer (enregistrement ou None), lines [{product, quantity, discount_pct,
        price?, name?, origin_line?}], payments [{method, amount}] (montants dans la devise d'affichage),
        note, origin, reversed (enregistrement), reference_type, reason.
        """
        company = site.company_id
        if company.norma_state != 'active':
            raise UserError(_("Le compte de l'entreprise est suspendu."))
        if not site.active:
            raise UserError(_("Cet établissement est désactivé."))
        itype = data.get('invoice_type') or 'FV'
        if itype not in dict(INVOICE_TYPES):
            raise UserError(_("Type de facture inconnu."))
        is_credit = itype in CREDIT_TYPES
        orig = data.get('reversed') if is_credit else None
        customer = data.get('customer')
        if is_credit:
            if not orig:
                raise UserError(_("Une facture d'avoir doit désigner la facture d'origine."))
            customer = orig.customer_id or None
            currency, rate = orig.currency, orig.currency_rate
        else:
            currency = company.norma_currency or 'CDF'
            rate = company.norma_usd_rate if currency == 'USD' else 1.0
            if currency == 'USD' and not rate:
                raise UserError(_("Renseignez le taux du jour (CDF pour 1 USD) avant de facturer en dollars."))
        if customer:
            if customer.company_id != company:
                raise AccessError(_("Client d'une autre entreprise."))
            customer._check_for_invoice()
        if itype in EXPORT_TYPES and not customer:
            raise UserError(_("Une facture à l'exportation exige l'identification du client."))
        groups = self.env['norma.tax.group']._rates()
        export_groups = [c for c, g in groups.items() if g['kind'] == 'export']
        rate_d = Decimal(str(rate or 1))
        lines_in = []
        for l in data.get('lines') or []:
            product = l['product']
            if product.company_id != company:
                raise AccessError(_("Article d'une autre entreprise."))
            group = l.get('tax_group') or product.tax_group_id.code
            if itype in EXPORT_TYPES and groups.get(group, {}).get('kind') != 'export':
                if not export_groups:
                    raise UserError(_("Aucun groupe de taxation « exportation » n'est défini."))
                group = export_groups[0]
            if company.norma_tax_regime != 'reel' and groups.get(group, {}).get('rate'):
                raise UserError(_("Une entreprise non assujettie ne facture pas de TVA : groupe %s refusé.") % group)
            price_cur = Decimal(str(l['price'] if l.get('price') is not None else product.price))
            lines_in.append({
                'product': product, 'name': (l.get('name') or product.name or '')[:120],
                'price_cur': fiscal.r2(price_cur), 'price': fiscal.r2(price_cur * rate_d),
                'quantity': l['quantity'], 'discount_pct': l.get('discount_pct') or 0,
                'specific_tax': fiscal.r2(Decimal(str(product.specific_tax or 0)) * rate_d),
                'tax_group': group, 'item_type': product.item_type, 'origin_line': l.get('origin_line'),
            })
        try:
            result = fiscal.compute_invoice(lines_in, groups)
        except fiscal.FiscalError as exc:
            raise UserError(str(exc))
        total_cur = fiscal.r2(result['total'] / rate_d) if currency != 'CDF' else result['total']
        payments = data.get('payments') or []
        if not payments:
            method = (data.get('refund_method') or 'ESPECES') if is_credit else 'CREDIT'
            payments = [{'method': method, 'amount': total_cur}]
        for p in payments:
            if p.get('method') not in dict(PAYMENT_METHODS):
                raise UserError(_("Mode de paiement inconnu."))
        try:
            fiscal.check_payments(payments, total_cur)
        except fiscal.FiscalError as exc:
            raise UserError(str(exc))
        vals = {
            'request_key': data.get('request_key') or False,
            'company_id': company.id, 'site_id': site.id, 'invoice_type': itype, 'operator_id': user.id,
            'origin': (data.get('origin') or '')[:80] or False, 'note': (data.get('note') or '')[:200] or False,
            'currency': currency, 'currency_rate': float(rate_d),
            'total_ht': float(result['total_ht']), 'total_tax': float(result['total_tax']),
            'total_specific': float(result['total_specific']), 'total': float(result['total']),
            'total_currency': float(total_cur),
            'line_ids': [(0, 0, {
                'product_id': src['product'].id, 'name': src['name'], 'item_type': src['item_type'],
                'tax_group': c['tax_group'], 'unit_price': float(c['unit_price']), 'net_price': float(c['net_price']),
                'price_currency': float(src['price_cur']), 'quantity': float(c['quantity']),
                'discount_pct': float(c['discount_pct']), 'specific_tax': float(c['specific']),
                'amount': float(c['amount']), 'total': float(c['total']),
                'origin_line_id': src['origin_line'].id if src.get('origin_line') else False,
            }) for src, c in zip(lines_in, result['lines'])],
            'group_ids': [(0, 0, {'code': g['code'], 'rate': float(g['rate']), 'base': float(g['base']),
                                  'tax': float(g['tax']), 'ttc': float(g['ttc']), 'specific': float(g['specific'])})
                          for g in result['groups']],
            'payment_ids': [(0, 0, p) for p in self._payments_cdf(payments, rate_d, result['total'])],
        }
        if customer:
            vals.update(customer_id=customer.id, client_type=customer.client_type, client_name=customer.name,
                        client_nif=customer.nif or False, client_address=customer.address or False,
                        client_contact=customer.phone or customer.email or False,
                        client_exemption=customer.exemption_ref or False)
        if is_credit:
            vals.update(self._credit_note_vals(orig, data, lines_in, result, company))
        return self._engine().create(vals)

    @api.model
    def _payments_cdf(self, payments, rate, total_cdf):
        """Paiements convertis en CDF ; l'écart d'arrondi de conversion va au dernier paiement."""
        out = [{'method': p['method'], 'amount': float(fiscal.r2(p['amount'])),
                'amount_cdf': fiscal.r2(Decimal(str(p['amount'])) * rate)} for p in payments]
        out[-1]['amount_cdf'] += total_cdf - sum(o['amount_cdf'] for o in out)
        for o in out:
            o['amount_cdf'] = float(o['amount_cdf'])
        return out

    def _credit_note_vals(self, orig, data, lines_in, result, company):
        itype = data['invoice_type']
        if orig.company_id != company:
            raise UserError(_("Facture d'origine introuvable."))
        if orig.state != 'normalized' or orig.invoice_type not in CREDIT_TYPES[itype]:
            raise UserError(_("La facture d'origine doit être une facture normalisée du type correspondant."))
        # Deux avoirs simultanés sur la même facture : le second attend le premier, puis voit ses quantités.
        self.env.cr.execute('SELECT id FROM norma_invoice WHERE id = %s FOR UPDATE', (orig.id,))
        orig.invalidate_recordset()
        ref_type = data.get('reference_type') or 'COR'
        if ref_type not in dict(REFERENCE_TYPES):
            raise UserError(_("Nature d'avoir inconnue."))
        reason = (data.get('reason') or '').strip()
        if len(reason) < 3:
            raise UserError(_("Indiquez le motif de l'avoir."))
        previous = orig.credit_note_ids.filtered(lambda c: c.state in ('failed', 'uncertain', 'normalized'))
        remaining = []
        for line in orig.line_ids:
            used = sum(previous.line_ids.filtered(lambda l: l.origin_line_id == line).mapped('quantity'))
            remaining.append({'key': line.id, 'quantity': Decimal(str(line.quantity)) - Decimal(str(used)),
                              'net_price': Decimal(str(line.net_price))})
        credit = []
        for src, c in zip(lines_in, result['lines']):
            if not src.get('origin_line') or src['origin_line'].invoice_id != orig:
                raise UserError(_("Chaque ligne de l'avoir doit reprendre une ligne de la facture d'origine."))
            if src['tax_group'] != src['origin_line'].tax_group:
                raise UserError(_("Une ligne d'avoir garde le groupe de taxation de la facture d'origine."))
            credit.append({'key': src['origin_line'].id, 'quantity': c['quantity'], 'net_price': c['net_price']})
        try:
            fiscal.check_credit_note(remaining, credit)
        except fiscal.FiscalError as exc:
            raise UserError(str(exc))
        return {'reversed_id': orig.id, 'reference_type': ref_type, 'reversal_reason': reason[:200]}

    # ================================================================ émission
    def _sequence(self):
        self.ensure_one()
        Seq = self.env['ir.sequence'].sudo()
        code = 'norma.invoice.%s.%s' % (self.site_id.id, self.invoice_type)
        seq = Seq.search([('code', '=', code), ('company_id', '=', self.company_id.id)], limit=1)
        if not seq:
            seq = Seq.create({
                'name': 'NORMA %s %s' % (self.site_id.code, self.invoice_type), 'code': code,
                'prefix': '%s-%s-%%(year)s-' % (self.site_id.code, self.invoice_type),
                'padding': 6, 'implementation': 'no_gap', 'company_id': self.company_id.id,
            })
        return seq.next_by_id()

    def _issue(self):
        """Numérote, transmet à l'e-MCF et normalise.

        La facture est enregistrée (numéro réservé) avant tout appel réseau, puis chaque réponse de la DGI est
        enregistrée immédiatement : une coupure ne fait jamais perdre une facture déjà connue de la DGI.
        """
        self.ensure_one()
        inv = self.with_context(norma_engine=True).sudo()
        if inv.state != 'draft':
            raise UserError(_("Cette facture a déjà été émise."))
        inv.write({'number': inv._sequence(), 'state': 'failed', 'date': fields.Datetime.now(),
                   'verify_token': secrets.token_urlsafe(18), 'emcf_mode': inv.site_id.emcf_mode})
        self.env['norma.audit']._log(inv.company_id, 'invoice.issue',
                                     _("Émission de %s (%s)") % (inv.number, inv.invoice_type),
                                     {'total': inv.total}, invoice=inv)
        self._commit()
        inv._transmit()
        return inv

    def _transmit(self, manual=False):
        """Transmission, ou reprise, d'une facture non encore normalisée."""
        self.ensure_one()
        inv = self.with_context(norma_engine=True).sudo()
        # Une seule transmission à la fois par facture (tâche planifiée et reprise manuelle simultanées).
        try:
            with self.env.cr.savepoint(flush=False):
                self.env.cr.execute('SELECT id FROM norma_invoice WHERE id = %s FOR UPDATE NOWAIT', (inv.id,))
        except Exception:
            raise UserError(_("Cette facture est déjà en cours de transmission. Réessayez dans un instant."))
        inv.invalidate_recordset()
        if inv.state not in ('failed', 'uncertain'):
            return inv
        if inv.emcf_blocked and not manual:
            return inv
        Emcf = self.env['norma.emcf']
        inv.write({'emcf_attempts': inv.emcf_attempts + 1})
        self._commit()
        try:
            result = Emcf._normalize(inv)
        except Emcf.Uncertain as exc:
            inv.write({'state': 'uncertain', 'emcf_error': str(exc)[:240]})
            self._commit()
            return inv
        except Emcf.EmcfError as exc:
            if inv.state == 'uncertain' and not exc.code:
                inv.write({'emcf_error': str(exc)[:240]})
                self._commit()
                return inv
            inv.write({'state': 'failed', 'emcf_error': str(exc)[:240], 'emcf_blocked': exc.blocking})
            self._commit()
            _logger.warning("NORMA : facture %s non normalisée : %s", inv.number, exc)
            return inv
        prev = inv._chain_last()
        inv.write(dict(result, state='normalized', emcf_error=False, emcf_blocked=False,
                       normalized_at=fields.Datetime.now(), chain_prev=prev))
        inv.env.cr.execute('UPDATE norma_invoice SET chain_hash = %s WHERE id = %s', (inv._chain_compute(prev), inv.id))
        inv.invalidate_recordset(['chain_hash'])
        self.env['norma.audit']._log(inv.company_id, 'invoice.normalized',
                                     _("%s normalisée — code DEF/DGI %s") % (inv.number, inv.emcf_code),
                                     {'code': inv.emcf_code, 'counters': inv.emcf_counters}, invoice=inv)
        self._commit()
        return inv

    @api.model
    def _cron_retry(self):
        """Reprise des factures en attente (coupure réseau, e-MCF indisponible). Jamais les cas bloquants."""
        for inv in self.sudo().search([('state', '=', 'failed'), ('emcf_blocked', '=', False)], order='id', limit=100):
            try:
                inv._transmit()
            except Exception:
                self.env.cr.rollback()
                _logger.exception("NORMA : nouvelle tentative impossible pour %s", inv.number)

    def _abandon(self, reason):
        """Abandon d'une facture que la DGI n'a pas normalisée. Le numéro reste tracé (aucun trou)."""
        self.ensure_one()
        inv = self.with_context(norma_engine=True).sudo()
        if inv.state not in ('draft', 'failed'):
            raise UserError(_("Seule une facture non transmise ou refusée peut être abandonnée."))
        if inv.emcf_uid:
            self.env['norma.emcf']._cancel_pending(inv)
        inv.write({'state': 'cancelled', 'emcf_error': (reason or '')[:240]})
        self.env['norma.audit']._log(inv.company_id, 'invoice.abandon',
                                     _("Abandon de %s : %s") % (inv.number or _('brouillon'), reason or ''),
                                     {}, invoice=inv)

    def _release_uncertain(self, registered_code=None):
        """Résolution d'une confirmation incertaine après vérification sur le portail DGI."""
        self.ensure_one()
        inv = self.with_context(norma_engine=True).sudo()
        if inv.state != 'uncertain':
            raise UserError(_("Cette facture n'est pas en confirmation incertaine."))
        self.env['norma.audit']._log(inv.company_id, 'invoice.uncertain_released',
                                     _("Confirmation incertaine levée pour %s (non enregistrée à la DGI)") % inv.number,
                                     {'uid': inv.emcf_uid}, invoice=inv)
        inv.write({'state': 'failed', 'emcf_uid': False, 'emcf_error': False, 'emcf_blocked': False})
        return inv._transmit(manual=True)

    # ================================================================ chaînage
    def _canonical(self):
        self.ensure_one()
        return json.dumps({
            'company': self.company_id.id, 'site': self.site_id.code, 'type': self.invoice_type,
            'number': self.number, 'date': fields.Datetime.to_string(self.date), 'client_nif': self.client_nif or '',
            'total': '%.2f' % self.total, 'tax': '%.2f' % self.total_tax, 'code': self.emcf_code or '',
            'lines': [[l.name, '%.3f' % l.quantity, '%.2f' % l.net_price, l.tax_group] for l in self.line_ids],
        }, sort_keys=True, separators=(',', ':'))

    def _chain_last(self):
        self.env.cr.execute('SELECT pg_advisory_xact_lock(%s, %s)', (7071, self.company_id.id))
        self.env.cr.execute("""SELECT chain_hash FROM norma_invoice WHERE company_id = %s AND chain_hash IS NOT NULL
                               ORDER BY normalized_at DESC, id DESC LIMIT 1""", (self.company_id.id,))
        row = self.env.cr.fetchone()
        return row[0] if row else '0' * 64

    def _chain_compute(self, prev):
        return hashlib.sha256((prev + self._canonical()).encode()).hexdigest()

    @api.model
    def _chain_verify(self, company):
        """Recalcule la chaîne des factures normalisées de l'entreprise."""
        invs = self.sudo().search([('company_id', '=', company.id), ('state', '=', 'normalized')],
                                  order='normalized_at, id')
        prev, broken = '0' * 64, []
        for inv in invs:
            if inv.chain_prev != prev or inv._chain_compute(prev) != inv.chain_hash:
                broken.append(inv.number)
            prev = inv.chain_hash
        return {'count': len(invs), 'ok': not broken, 'broken': broken[:20]}

    # ================================================================ sérialisation
    def _public_dict(self, full=False):
        res = []
        for inv in self:
            d = {
                'id': inv.id, 'number': inv.number or '', 'type': inv.invoice_type, 'state': inv.state,
                'date': fields.Datetime.to_string(inv.date) if inv.date else '', 'site': inv.site_id.name,
                'site_id': inv.site_id.id, 'site_code': inv.site_id.code, 'client_name': inv.client_name or '',
                'client_nif': inv.client_nif or '', 'total': inv.total, 'total_tax': inv.total_tax,
                'currency': inv.currency, 'total_currency': inv.total_currency,
                'emcf_code': inv.emcf_code or '', 'emcf_error': inv.emcf_error or '', 'origin': inv.origin or '',
                'emcf_blocked': inv.emcf_blocked, 'operator': inv.operator_id.name or '',
                'reversed_number': inv.reversed_id.number or '', 'emcf_mode': inv.emcf_mode or '',
            }
            if full:
                d.update({
                    'client_type': inv.client_type or '', 'client_address': inv.client_address or '',
                    'client_contact': inv.client_contact or '', 'total_ht': inv.total_ht,
                    'total_specific': inv.total_specific, 'currency_rate': inv.currency_rate,
                    'note': inv.note or '', 'reversal_reason': inv.reversal_reason or '',
                    'reference_type': inv.reference_type or '', 'reversed_id': inv.reversed_id.id or False,
                    'reversed_code': inv.reversed_id.emcf_code or '',
                    'emcf_nim': inv.emcf_nim or '', 'emcf_counters': inv.emcf_counters or '',
                    'emcf_datetime': inv.emcf_datetime or '', 'emcf_qr': inv.emcf_qr or '',
                    'emcf_uid': inv.emcf_uid or '', 'verify_token': inv.verify_token or '',
                    'chain_hash': inv.chain_hash or '', 'print_count': inv.print_count,
                    'lines': [{'id': l.id, 'name': l.name, 'quantity': l.quantity, 'unit_price': l.unit_price,
                               'net_price': l.net_price, 'price_currency': l.price_currency,
                               'discount_pct': l.discount_pct, 'tax_group': l.tax_group, 'total': l.total,
                               'specific_tax': l.specific_tax, 'product_id': l.product_id.id,
                               'item_type': l.item_type, 'refundable': l._refundable()} for l in inv.line_ids],
                    'groups': [{'code': g.code, 'rate': g.rate, 'base': g.base, 'tax': g.tax, 'ttc': g.ttc,
                                'specific': g.specific} for g in inv.group_ids],
                    'payments': [{'method': p.method, 'label': dict(PAYMENT_METHODS)[p.method], 'amount': p.amount,
                                  'amount_cdf': p.amount_cdf} for p in inv.payment_ids],
                    'credit_notes': [{'id': c.id, 'number': c.number or '', 'state': c.state, 'total': c.total}
                                     for c in inv.credit_note_ids],
                })
            res.append(d)
        return res


class NormaInvoiceLine(models.Model):
    _name = 'norma.invoice.line'
    _description = 'Ligne de facture normalisée'
    _order = 'id'

    invoice_id = fields.Many2one('norma.invoice', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='invoice_id.company_id', store=True, index=True)
    product_id = fields.Many2one('norma.product', ondelete='restrict')
    origin_line_id = fields.Many2one('norma.invoice.line', ondelete='restrict', index=True)
    name = fields.Char(required=True)
    item_type = fields.Char(default='BIE')
    tax_group = fields.Char(required=True)
    unit_price = fields.Float("Prix TTC (CDF)", digits=(16, 2))
    net_price = fields.Float("Prix net TTC (CDF)", digits=(16, 2))
    price_currency = fields.Float("Prix en devise", digits=(16, 2))
    quantity = fields.Float(digits=(16, 3))
    discount_pct = fields.Float(digits=(5, 2))
    specific_tax = fields.Float("Taxe spécifique (CDF)", digits=(16, 2))
    amount = fields.Float(digits=(16, 2))
    total = fields.Float(digits=(16, 2))

    def write(self, vals):
        raise AccessError(_("Une ligne de facture ne se modifie pas."))

    def _refundable(self):
        self.ensure_one()
        used = sum(self.search([('origin_line_id', '=', self.id),
                                ('invoice_id.state', 'in', ('failed', 'uncertain', 'normalized'))]).mapped('quantity'))
        return round(self.quantity - used, 3)


class NormaInvoiceGroup(models.Model):
    _name = 'norma.invoice.group'
    _description = 'Ventilation par groupe de taxation'
    _order = 'code'

    invoice_id = fields.Many2one('norma.invoice', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='invoice_id.company_id', store=True, index=True)
    code = fields.Char(required=True)
    rate = fields.Float(digits=(5, 2))
    base = fields.Float(digits=(16, 2))
    tax = fields.Float(digits=(16, 2))
    ttc = fields.Float(digits=(16, 2))
    specific = fields.Float(digits=(16, 2))

    def write(self, vals):
        raise AccessError(_("La ventilation fiscale ne se modifie pas."))


class NormaInvoicePayment(models.Model):
    _name = 'norma.invoice.payment'
    _description = 'Paiement de la facture'

    invoice_id = fields.Many2one('norma.invoice', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='invoice_id.company_id', store=True, index=True)
    method = fields.Selection(PAYMENT_METHODS, required=True)
    amount = fields.Float("Montant (devise d'affichage)", digits=(16, 2))
    amount_cdf = fields.Float("Montant (CDF)", digits=(16, 2))

    def write(self, vals):
        raise AccessError(_("Un paiement enregistré ne se modifie pas."))
