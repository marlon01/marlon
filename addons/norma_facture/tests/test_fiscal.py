# -*- coding: utf-8 -*-
from decimal import Decimal

from odoo.tests import BaseCase, tagged

from ..lib import fiscal

GROUPS = {'A': {'rate': 0}, 'B': {'rate': 16}, 'C': {'rate': 5}, 'N': {'rate': 0}, 'Q': {'rate': 8}}


@tagged('post_install', '-at_install', 'norma')
class TestFiscal(BaseCase):

    def test_vat_rounded_up_and_balanced(self):
        r = fiscal.compute_invoice([{'price': 999.99, 'quantity': 1, 'tax_group': 'B'}], GROUPS)
        g = r['groups'][0]
        self.assertEqual(g['tax'], Decimal('137.93'))
        self.assertEqual(g['base'] + g['tax'], g['ttc'])
        self.assertEqual(r['total'], Decimal('999.99'))
        # 100 × 16 / 116 = 13,793… : l'arrondi au plus proche donnerait 13,79, la règle SFE impose 13,80.
        g = fiscal.compute_invoice([{'price': 100, 'quantity': 1, 'tax_group': 'B'}], GROUPS)['groups'][0]
        self.assertEqual((g['tax'], g['base']), (Decimal('13.80'), Decimal('86.20')))

    def test_group_totals_not_line_totals(self):
        lines = [{'price': 0.07, 'quantity': 1, 'tax_group': 'B'} for _ in range(10)]
        r = fiscal.compute_invoice(lines, GROUPS)
        self.assertEqual(r['groups'][0]['ttc'], Decimal('0.70'))
        self.assertEqual(r['groups'][0]['tax'], Decimal('0.10'))  # 0,70 × 16/116 = 0,0966 → 0,10

    def test_specific_tax_in_vat_base(self):
        r = fiscal.compute_invoice([{'price': 1000, 'quantity': 2, 'tax_group': 'B', 'specific_tax': 100}], GROUPS)
        g = r['groups'][0]
        self.assertEqual(g['ttc'], Decimal('2232.00'))  # 2000 + 200 × 1,16
        self.assertEqual(g['specific'], Decimal('200.00'))

    def test_group_n_is_entirely_vat(self):
        r = fiscal.compute_invoice([{'price': 500, 'quantity': 1, 'tax_group': 'N'}], GROUPS)
        self.assertEqual(r['groups'][0]['tax'], Decimal('500.00'))
        self.assertEqual(r['groups'][0]['base'], Decimal('0'))

    def test_exempt_group(self):
        r = fiscal.compute_invoice([{'price': 500, 'quantity': 3, 'tax_group': 'A'}], GROUPS)
        self.assertEqual(r['total_tax'], Decimal('0'))
        self.assertEqual(r['total'], Decimal('1500.00'))

    def test_quantity_three_decimals_and_discount(self):
        r = fiscal.compute_invoice([{'price': 1999.99, 'quantity': 1.2345, 'tax_group': 'Q', 'discount_pct': 12.5}], GROUPS)
        line = r['lines'][0]
        self.assertEqual(line['quantity'], Decimal('1.235'))
        self.assertEqual(line['net_price'], Decimal('1749.99'))
        self.assertEqual(line['amount'], Decimal('2161.24'))

    def test_rejects_invalid(self):
        for bad in ({'price': 0, 'quantity': 1, 'tax_group': 'B'}, {'price': 10, 'quantity': 0, 'tax_group': 'B'},
                    {'price': -5, 'quantity': 1, 'tax_group': 'B'}, {'price': 10, 'quantity': 1, 'tax_group': 'Z'},
                    {'price': 10, 'quantity': 1, 'tax_group': 'B', 'discount_pct': 100}):
            with self.assertRaises(fiscal.FiscalError):
                fiscal.compute_invoice([bad], GROUPS)
        with self.assertRaises(fiscal.FiscalError):
            fiscal.compute_invoice([], GROUPS)

    def test_payments_must_match(self):
        fiscal.check_payments([{'amount': 600}, {'amount': 400.5}], Decimal('1000.50'))
        with self.assertRaises(fiscal.FiscalError):
            fiscal.check_payments([{'amount': 1000}], Decimal('1000.50'))
        with self.assertRaises(fiscal.FiscalError):
            fiscal.check_payments([{'amount': 1100}, {'amount': -99.5}], Decimal('1000.50'))

    def test_credit_note_limits(self):
        remaining = [{'key': 1, 'quantity': 2, 'net_price': 100}]
        fiscal.check_credit_note(remaining, [{'key': 1, 'quantity': 2, 'net_price': 100}])
        with self.assertRaises(fiscal.FiscalError):
            fiscal.check_credit_note(remaining, [{'key': 1, 'quantity': 1, 'net_price': 100},
                                                 {'key': 1, 'quantity': 1.5, 'net_price': 100}])
        with self.assertRaises(fiscal.FiscalError):
            fiscal.check_credit_note(remaining, [{'key': 1, 'quantity': 1, 'net_price': 101}])
        with self.assertRaises(fiscal.FiscalError):
            fiscal.check_credit_note(remaining, [{'key': 2, 'quantity': 1, 'net_price': 1}])

    def test_compare_with_emcf(self):
        ours = fiscal.compute_invoice([{'price': 1160, 'quantity': 1, 'tax_group': 'B'}], GROUPS)
        self.assertEqual(fiscal.compare_with_emcf(ours, {'total': 1160, 'vtotal': 160, 'tab': 1160, 'vab': 160}), [])
        self.assertTrue(fiscal.compare_with_emcf(ours, {'total': 1160, 'vtotal': 159.99}))

    def test_amount_in_words(self):
        self.assertEqual(fiscal.amount_in_words(1), "Un franc congolais")
        self.assertEqual(fiscal.amount_in_words(80), "Quatre-vingts francs congolais")
        self.assertEqual(fiscal.amount_in_words(71), "Soixante et onze francs congolais")
        self.assertEqual(fiscal.amount_in_words(1000000), "Un million de francs congolais")
        self.assertEqual(fiscal.amount_in_words(2350.5),
                         "Deux mille trois cent cinquante francs congolais et cinquante centimes")
