# -*- coding: utf-8 -*-
"""Moteur de calcul de la facture normalisée (RDC), sans dépendance à Odoo.

Règles de calcul des Spécifications SFE (section 1.5), appliquées comme le fait l'e-MCF :
* 1.5.1 prix à 2 décimales au plus, quantités à 3 décimales ;
* 1.5.2 toute valeur décimale arrondie au plus proche, 2 décimales ;
* 1.5.6 mode TTC : la base imposable se déduit du total du groupe ;
* 1.5.7 base + taxe = total ; à l'arrondi, la TAXE est arrondie vers le haut ;
* 1.5.8 le montant d'un groupe « TVA spécifique » (N) est entièrement de la TVA ;
* 1.5.10 la taxe spécifique augmente la base de la TVA.

Toutes les sommes sont calculées côté serveur, en francs congolais (CDF) : le navigateur n'envoie que
des articles, des quantités et des remises ; il ne fixe jamais un total ni une taxe.
Avant de confirmer une facture, ces montants sont comparés à ceux que renvoie l'e-MCF.
"""
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP

ZERO = Decimal('0')
CENT = Decimal('0.01')
MILLI = Decimal('0.001')
VAT_ONLY_GROUPS = ('N',)


class FiscalError(ValueError):
    pass


def D(value):
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value or 0))


def r2(value):
    return D(value).quantize(CENT, rounding=ROUND_HALF_UP)


def r3(value):
    return D(value).quantize(MILLI, rounding=ROUND_HALF_UP)


def ceil2(value):
    v = D(value)
    up = abs(v).quantize(CENT, rounding=ROUND_CEILING)
    return -up if v < 0 else up


# Rétrocompatibilité interne
money = r2


def group_split(total, rate, code=None):
    """(total, base HT, TVA) d'un groupe en mode TTC (SFE 1.5.6, 1.5.7, 1.5.8)."""
    total, rate = r2(total), D(rate)
    if code in VAT_ONLY_GROUPS:
        return total, ZERO, total
    if not rate:
        return total, total, ZERO
    vat = ceil2(total * rate / (100 + rate))
    return total, total - vat, vat


def line_amounts(price, quantity, rate, discount_pct=0, specific_tax=0, code=None):
    """Montants d'une ligne : prix TTC unitaire (hors taxe spécifique), remise %, taxe spécifique par unité (HT)."""
    price, quantity, rate = D(price), r3(quantity), D(rate)
    discount_pct, specific_tax = D(discount_pct), D(specific_tax)
    if quantity <= 0:
        raise FiscalError("La quantité doit être positive.")
    if price <= 0:
        raise FiscalError("Le prix doit être positif.")
    if not (ZERO <= discount_pct < 100):
        raise FiscalError("La remise doit être comprise entre 0 et 100 %.")
    if specific_tax < 0:
        raise FiscalError("La taxe spécifique ne peut pas être négative.")
    gross = r2(price)
    net = r2(gross * (100 - discount_pct) / 100)
    if net <= 0:
        raise FiscalError("Le prix après remise doit être positif.")
    amount = r2(net * quantity)
    ts = r2(specific_tax * quantity)
    factor = 1 if (code in VAT_ONLY_GROUPS or not rate) else (1 + rate / 100)
    ts_ttc = r2(ts * factor)
    return {'unit_price': gross, 'net_price': net, 'quantity': quantity, 'discount_pct': discount_pct,
            'amount': amount, 'specific': ts, 'specific_ttc': ts_ttc, 'total': amount + ts_ttc}


def compute_invoice(lines, tax_groups):
    """Totaux d'une facture en mode TTC.

    ``lines`` : [{'price', 'quantity', 'tax_group', 'discount_pct', 'specific_tax'}] (montants en CDF)
    ``tax_groups`` : {'B': {'rate': 16}, ...}
    """
    if not lines:
        raise FiscalError("Une facture doit comporter au moins un article.")
    computed, acc = [], {}
    for line in lines:
        code = line.get('tax_group')
        if code not in tax_groups:
            raise FiscalError("Groupe de taxation inconnu : %s" % code)
        rate = D(tax_groups[code]['rate'])
        c = line_amounts(line.get('price'), line.get('quantity'), rate, line.get('discount_pct', 0),
                         line.get('specific_tax', 0), code)
        c['tax_group'] = code
        computed.append(c)
        g = acc.setdefault(code, {'rate': rate, 'amount': ZERO, 'specific': ZERO})
        g['amount'] += c['amount']
        g['specific'] += c['specific']
    groups = []
    for code in sorted(acc):
        g = acc[code]
        factor = 1 if (code in VAT_ONLY_GROUPS or not g['rate']) else (1 + g['rate'] / 100)
        total, base, vat = group_split(g['amount'] + r2(g['specific'] * factor), g['rate'], code)
        groups.append({'code': code, 'rate': g['rate'], 'base': base, 'tax': vat, 'ttc': total,
                       'specific': r2(g['specific'])})
    total = sum((g['ttc'] for g in groups), ZERO)
    vtotal = sum((g['tax'] for g in groups), ZERO)
    if total <= 0:
        raise FiscalError("Le total de la facture doit être positif.")
    return {'lines': computed, 'groups': groups, 'total': total, 'total_tax': vtotal,
            'total_ht': total - vtotal, 'total_specific': sum((g['specific'] for g in groups), ZERO)}


def check_payments(payments, total):
    """Les paiements couvrent exactement le total (le crédit est un mode de paiement)."""
    if any(D(p.get('amount')) <= 0 for p in payments):
        raise FiscalError("Chaque paiement doit être positif.")
    paid = r2(sum((D(p.get('amount')) for p in payments), ZERO))
    if paid != r2(total):
        raise FiscalError("La somme des paiements (%s) diffère du total de la facture (%s)." % (paid, r2(total)))
    return paid


def check_credit_note(remaining_lines, credit_lines):
    """Un avoir ne rembourse jamais plus que ce qui reste de la facture d'origine, ligne par ligne.

    ``remaining_lines`` : [{'key', 'quantity' (restant), 'net_price'}] ; ``credit_lines`` : [{'key', 'quantity', 'net_price'}].
    """
    orig = {l['key']: {'quantity': D(l['quantity']), 'net_price': D(l['net_price'])} for l in remaining_lines}
    used = {}
    for l in credit_lines:
        k = l.get('key')
        if k not in orig:
            raise FiscalError("L'avoir contient un article absent de la facture d'origine.")
        if D(l['net_price']) > orig[k]['net_price']:
            raise FiscalError("Le prix remboursé dépasse le prix facturé.")
        used[k] = used.get(k, ZERO) + D(l['quantity'])
        if used[k] > orig[k]['quantity']:
            raise FiscalError("La quantité remboursée dépasse la quantité restant à rembourser.")
    return True


def compare_with_emcf(ours, response, tolerance='0.00'):
    """Écarts entre notre calcul et la réponse de l'e-MCF (champs total, vtotal, ta{x}, va{x})."""
    tol = D(tolerance)
    diffs = []
    if abs(D(response.get('total')) - ours['total']) > tol:
        diffs.append("Total TTC : NORMA=%s / e-MCF=%s" % (ours['total'], response.get('total')))
    if abs(D(response.get('vtotal')) - ours['total_tax']) > tol:
        diffs.append("Total TVA : NORMA=%s / e-MCF=%s" % (ours['total_tax'], response.get('vtotal')))
    for g in ours['groups']:
        k = g['code'].lower()
        if response.get('ta' + k) is not None and abs(D(response.get('ta' + k)) - g['ttc']) > tol:
            diffs.append("Groupe %s total : NORMA=%s / e-MCF=%s" % (g['code'], g['ttc'], response.get('ta' + k)))
        if response.get('va' + k) is not None and abs(D(response.get('va' + k)) - g['tax']) > tol:
            diffs.append("Groupe %s TVA : NORMA=%s / e-MCF=%s" % (g['code'], g['tax'], response.get('va' + k)))
    return diffs


UNITS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
         "treize", "quatorze", "quinze", "seize"]
TENS = {20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante"}


def _below_100(n):
    if n <= 16:
        return UNITS[n]
    if n < 20:
        return "dix-" + UNITS[n - 10]
    if n < 70:
        t, u = (n // 10) * 10, n % 10
        return TENS[t] + ("" if not u else (" et un" if u == 1 else "-" + UNITS[u]))
    if n < 80:
        return "soixante" + (" et onze" if n == 71 else "-" + _below_100(n - 60))
    if n == 80:
        return "quatre-vingts"
    return "quatre-vingt-" + _below_100(n - 80)


def _below_1000(n):
    h, rest = divmod(n, 100)
    words = []
    if h:
        words.append("cent" if h == 1 else UNITS[h] + (" cents" if not rest else " cent"))
    if rest:
        words.append(_below_100(rest))
    return " ".join(words)


def amount_in_words(value, currency='francs congolais'):
    """Montant en toutes lettres (orthographe traditionnelle), ex. 1 250 000,50 → « un million deux cent… »."""
    value = r2(value)
    whole = int(value)
    cents = int((value - whole) * 100)
    if whole == 0:
        words = "zéro"
    else:
        parts, n = [], whole
        for size, name in ((10 ** 9, "milliard"), (10 ** 6, "million")):
            q, n = divmod(n, size)
            if q:
                parts.append("%s %s%s" % (_below_1000(q), name, "s" if q > 1 else ""))
        q, n = divmod(n, 1000)
        if q:
            parts.append("mille" if q == 1 else _below_1000(q).replace("cents", "cent").replace("vingts", "vingt") + " mille")
        if n:
            parts.append(_below_1000(n))
        words = " ".join(parts)
    if whole <= 1 and currency == 'francs congolais':
        currency = 'franc congolais'
    joiner = " de " if words.endswith(("million", "millions", "milliard", "milliards")) else " "
    out = "%s%s%s" % (words, joiner, currency)
    if cents:
        out += " et %s centime%s" % (_below_100(cents), "s" if cents > 1 else "")
    return out[0].upper() + out[1:]
