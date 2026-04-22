from decimal import Decimal
import logging

from django.test import TestCase

from backend.catalog.views import build_barcode_response
from backend.core.gst_utils import calculate_gst_bifurcation
from backend.core.test_utils import TestDataFactory
from backend.pos.models import CartItem, InvoiceItem
from backend.pos.serializers import CartItemSerializer, CartSerializer, InvoiceSerializer


class GSTSalesPayloadTests(TestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()
        self.product = TestDataFactory.create_product(track_inventory=True)

    def _create_purchase_linked_barcode(self, gst_percent, gst_inclusive):
        purchase = TestDataFactory.create_purchase(
            user=self.user,
            supplier=self.supplier,
            store=self.store,
            status='finalized',
        )
        purchase_item = TestDataFactory.create_purchase_item(
            purchase=purchase,
            product=self.product,
            quantity=Decimal('1.00'),
            unit_price=Decimal('100.00'),
        )
        purchase_item.gst_percent = Decimal(str(gst_percent))
        purchase_item.gst_inclusive = bool(gst_inclusive)
        purchase_item.save(update_fields=['gst_percent', 'gst_inclusive'])

        barcode = TestDataFactory.create_barcode(
            self.product,
            barcode=f'GST-BC-{gst_percent}-{int(gst_inclusive)}',
            tag='new',
            purchase_item=purchase_item,
        )
        return barcode

    def test_build_barcode_response_prefers_purchase_item_gst(self):
        barcode = self._create_purchase_linked_barcode(gst_percent='18.00', gst_inclusive=True)

        payload = build_barcode_response(
            barcode,
            self.product,
            logging.getLogger('test.gst'),
        )

        self.assertEqual(payload['gst_percent'], 18.0)
        self.assertTrue(payload['gst_inclusive'])

    def test_cart_item_serializer_uses_purchase_item_gst_from_scanned_barcode(self):
        barcode = self._create_purchase_linked_barcode(gst_percent='5.00', gst_inclusive=True)
        cart = TestDataFactory.create_cart(user=self.user, store=self.store)

        cart_item = CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('4.76'),
            scanned_barcodes=[barcode.barcode],
        )

        data = CartItemSerializer(cart_item).data
        self.assertEqual(data['tax_percent'], 5.0)
        self.assertTrue(data['tax_is_inclusive'])

    def test_cart_item_serializer_falls_back_to_product_tax_rate(self):
        tax_rate = TestDataFactory.create_tax_rate(rate=Decimal('12.00'))
        self.product.tax_rate = tax_rate
        self.product.save(update_fields=['tax_rate'])

        barcode = TestDataFactory.create_barcode(
            self.product,
            barcode='GST-BC-FALLBACK-12',
            tag='new',
            purchase_item=None,
        )
        cart = TestDataFactory.create_cart(user=self.user, store=self.store)

        cart_item = CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('200.00'),
            tax_amount=Decimal('24.00'),
            scanned_barcodes=[barcode.barcode],
        )

        data = CartItemSerializer(cart_item).data
        self.assertEqual(data['tax_percent'], 12.0)
        self.assertFalse(data['tax_is_inclusive'])


# ---------------------------------------------------------------------------
# calculate_gst_bifurcation unit tests
# ---------------------------------------------------------------------------

class CalculateGSTBifurcationExclusiveTests(TestCase):
    """Tests for GST-exclusive price formula: GST = base * rate/100, Total = base + GST."""

    def test_5_percent_exclusive_single_unit(self):
        # Base = 100, rate = 5%, exclusive
        # GST = 100 * 5/100 = 5.00, Total = 105.00
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 5.00, places=2)
        self.assertAlmostEqual(result['cgst'], 2.50, places=2)
        self.assertAlmostEqual(result['sgst'], 2.50, places=2)
        self.assertAlmostEqual(result['igst'], 0.00, places=2)
        self.assertAlmostEqual(result['total'], 105.00, places=2)

    def test_18_percent_exclusive_single_unit(self):
        # Base = 100, rate = 18%
        # GST = 18.00, Total = 118.00
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=18, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['cgst'], 9.00, places=2)
        self.assertAlmostEqual(result['sgst'], 9.00, places=2)
        self.assertAlmostEqual(result['total'], 118.00, places=2)

    def test_12_percent_exclusive_multiple_units(self):
        # Base = 50/unit * 3 = 150, rate = 12%
        # GST = 150 * 0.12 = 18.00, Total = 168.00
        result = calculate_gst_bifurcation(unit_price=50, quantity=3, tax_rate=12, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 150.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['cgst'], 9.00, places=2)
        self.assertAlmostEqual(result['sgst'], 9.00, places=2)
        self.assertAlmostEqual(result['total'], 168.00, places=2)

    def test_cgst_and_sgst_sum_equals_total_tax(self):
        result = calculate_gst_bifurcation(unit_price=99, quantity=1, tax_rate=28, is_inclusive=False)
        self.assertAlmostEqual(result['cgst'] + result['sgst'], result['total_tax'], places=2)

    def test_zero_tax_rate_exclusive(self):
        result = calculate_gst_bifurcation(unit_price=200, quantity=2, tax_rate=0, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 400.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 0.00, places=2)
        self.assertAlmostEqual(result['total'], 400.00, places=2)


class CalculateGSTBifurcationInclusiveTests(TestCase):
    """Tests for GST-inclusive price formula: Base = Inclusive*100/(100+Rate), GST = Inclusive - Base."""

    def test_5_percent_inclusive_single_unit(self):
        # Inclusive price = 105, rate = 5%
        # Base = 105 * 100/105 = 100.00, GST = 5.00
        result = calculate_gst_bifurcation(unit_price=105, quantity=1, tax_rate=5, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 5.00, places=2)
        self.assertAlmostEqual(result['cgst'], 2.50, places=2)
        self.assertAlmostEqual(result['sgst'], 2.50, places=2)
        self.assertAlmostEqual(result['total'], 105.00, places=2)

    def test_18_percent_inclusive_single_unit(self):
        # Inclusive price = 118, rate = 18%
        # Base = 118 * 100/118 = 100.00, GST = 18.00
        result = calculate_gst_bifurcation(unit_price=118, quantity=1, tax_rate=18, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['cgst'], 9.00, places=2)
        self.assertAlmostEqual(result['sgst'], 9.00, places=2)
        self.assertAlmostEqual(result['total'], 118.00, places=2)

    def test_5_percent_inclusive_100_rupees(self):
        # Inclusive price = 100, rate = 5%
        # Base = 100 * 100/105 = 95.24, GST = 4.76
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 95.24, places=2)
        self.assertAlmostEqual(result['total_tax'], 4.76, places=2)
        self.assertAlmostEqual(result['cgst'], 2.38, places=2)
        self.assertAlmostEqual(result['sgst'], 2.38, places=2)
        self.assertAlmostEqual(result['total'], 100.00, places=2)

    def test_12_percent_inclusive_multiple_units(self):
        # Inclusive price = 56/unit * 3 = 168 total, rate = 12%
        # Base = 168 * 100/112 = 150.00, GST = 18.00
        result = calculate_gst_bifurcation(unit_price=56, quantity=3, tax_rate=12, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 150.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['total'], 168.00, places=2)

    def test_inclusive_total_equals_base_plus_tax(self):
        result = calculate_gst_bifurcation(unit_price=200, quantity=2, tax_rate=18, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'] + result['total_tax'], result['total'], places=2)

    def test_cgst_and_sgst_sum_equals_total_tax_inclusive(self):
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=28, is_inclusive=True)
        self.assertAlmostEqual(result['cgst'] + result['sgst'], result['total_tax'], places=2)

    def test_igst_is_always_zero(self):
        """IGST is always 0 — only intra-state (CGST + SGST) is computed."""
        for rate in [5, 12, 18, 28]:
            with self.subTest(rate=rate):
                r = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=rate, is_inclusive=True)
                self.assertEqual(r['igst'], 0.00)

    def test_same_rate_inclusive_vs_exclusive_give_different_bases(self):
        """5% inclusive on 100 gives different base than 5% exclusive on 100."""
        incl = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=True)
        excl = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=False)
        # Inclusive: base = 95.24, tax = 4.76
        # Exclusive: base = 100,   tax = 5.00
        self.assertLess(incl['base_amount'], excl['base_amount'])
        self.assertLess(incl['total_tax'], excl['total_tax'])
        self.assertAlmostEqual(incl['total'], 100.00, places=2)
        self.assertAlmostEqual(excl['total'], 105.00, places=2)


# ---------------------------------------------------------------------------
# CartItemSerializer.get_tax_bifurcation — is_inclusive flag
# ---------------------------------------------------------------------------

class CartItemTaxBifurcationTests(TestCase):
    """CartItem serializer must include is_inclusive in tax_bifurcation."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()

    def _make_cart_item(self, gst_percent, gst_inclusive, unit_price, tax_amount, barcode_suffix=''):
        product = TestDataFactory.create_product(track_inventory=True)
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        pi = TestDataFactory.create_purchase_item(purchase=purchase, product=product,
                                                   quantity=Decimal('1.00'), unit_price=unit_price)
        pi.gst_percent = Decimal(str(gst_percent))
        pi.gst_inclusive = bool(gst_inclusive)
        pi.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            product, barcode=f'BIFT-{gst_percent}-{int(gst_inclusive)}-{barcode_suffix}',
            tag='new', purchase_item=pi,
        )
        cart = TestDataFactory.create_cart(user=self.user, store=self.store)
        item = CartItem.objects.create(
            cart=cart, product=product,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            tax_amount=tax_amount,
            scanned_barcodes=[barcode.barcode],
        )
        return item

    def test_exclusive_item_bifurcation_is_not_inclusive(self):
        # 5% exclusive: unit_price=100, tax=5
        item = self._make_cart_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'EX')
        data = CartItemSerializer(item).data
        bif = data['tax_bifurcation']
        self.assertIsNotNone(bif)
        self.assertFalse(bif['is_inclusive'])
        self.assertAlmostEqual(bif['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(bif['total_tax'], 5.00, places=2)
        self.assertAlmostEqual(bif['cgst'], 2.50, places=2)
        self.assertAlmostEqual(bif['sgst'], 2.50, places=2)

    def test_inclusive_item_bifurcation_is_inclusive(self):
        # 5% inclusive: unit_price=95.24 (base stored), tax=4.76
        item = self._make_cart_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'IN')
        data = CartItemSerializer(item).data
        bif = data['tax_bifurcation']
        self.assertIsNotNone(bif)
        self.assertTrue(bif['is_inclusive'])
        self.assertAlmostEqual(bif['base_amount'], 95.24, places=2)
        self.assertAlmostEqual(bif['total_tax'], 4.76, places=2)

    def test_zero_tax_returns_none(self):
        item = self._make_cart_item('5.00', False, Decimal('100.00'), Decimal('0.00'), 'ZT')
        data = CartItemSerializer(item).data
        self.assertIsNone(data['tax_bifurcation'])

    def test_rate_field_reflects_actual_rate(self):
        # 18% exclusive: unit_price=100, tax=18
        item = self._make_cart_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'RT18')
        data = CartItemSerializer(item).data
        bif = data['tax_bifurcation']
        self.assertAlmostEqual(bif['rate'], 18.00, places=1)


# ---------------------------------------------------------------------------
# CartSerializer.get_tax_bifurcation — bifurcates by (rate, is_inclusive)
# ---------------------------------------------------------------------------

class CartTaxBifurcationSlabTests(TestCase):
    """Cart-level tax_bifurcation must separate same-rate inclusive vs exclusive items."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()
        self.cart = TestDataFactory.create_cart(user=self.user, store=self.store)

    def _add_item(self, gst_percent, gst_inclusive, unit_price, tax_amount, suffix=''):
        product = TestDataFactory.create_product(track_inventory=True)
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        pi = TestDataFactory.create_purchase_item(purchase=purchase, product=product,
                                                   quantity=Decimal('1.00'), unit_price=unit_price)
        pi.gst_percent = Decimal(str(gst_percent))
        pi.gst_inclusive = bool(gst_inclusive)
        pi.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            product, barcode=f'CART-BIFT-{gst_percent}-{int(gst_inclusive)}-{suffix}',
            tag='new', purchase_item=pi,
        )
        CartItem.objects.create(
            cart=self.cart, product=product,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            tax_amount=tax_amount,
            scanned_barcodes=[barcode.barcode],
        )

    def test_single_exclusive_item_produces_one_slab(self):
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'S1')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertAlmostEqual(slabs[0]['rate'], 5.0, places=1)
        self.assertFalse(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(slabs[0]['total_tax'], 5.00, places=2)

    def test_single_inclusive_item_produces_one_slab_marked_inclusive(self):
        # 5% inclusive — unit_price stored as base = 95.24, tax = 4.76
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'S2')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertTrue(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['total_tax'], 4.76, places=2)

    def test_same_rate_inclusive_and_exclusive_produce_two_separate_slabs(self):
        """Core bug fix: 5% inclusive and 5% exclusive must appear as TWO rows."""
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'EX')
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'IN')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 2, 'Same rate inclusive+exclusive must produce two slabs')
        rates = [s['rate'] for s in slabs]
        inclusives = [s['is_inclusive'] for s in slabs]
        self.assertIn(5.0, rates)
        self.assertIn(False, inclusives)
        self.assertIn(True, inclusives)

    def test_different_rates_produce_separate_slabs(self):
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'R1')
        self._add_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'R2')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 2)
        slab_rates = sorted(s['rate'] for s in slabs)
        self.assertAlmostEqual(slab_rates[0], 5.0, places=1)
        self.assertAlmostEqual(slab_rates[1], 18.0, places=1)

    def test_totals_are_aggregated_within_same_slab(self):
        """Two exclusive 5% items must be summed into one slab."""
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'AGG1')
        self._add_item('5.00', False, Decimal('200.00'), Decimal('10.00'), 'AGG2')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertAlmostEqual(slabs[0]['base_amount'], 300.00, places=2)
        self.assertAlmostEqual(slabs[0]['total_tax'], 15.00, places=2)
        self.assertAlmostEqual(slabs[0]['cgst'], 7.50, places=2)
        self.assertAlmostEqual(slabs[0]['sgst'], 7.50, places=2)

    def test_no_tax_items_returns_none(self):
        product = TestDataFactory.create_product(track_inventory=True)
        CartItem.objects.create(
            cart=self.cart, product=product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('0.00'),
            scanned_barcodes=[],
        )
        data = CartSerializer(self.cart).data
        self.assertIsNone(data['tax_bifurcation'])

    def test_mixed_three_slabs(self):
        """5% excl + 5% incl + 18% excl must produce three slabs."""
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'M1')
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'M2')
        self._add_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'M3')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 3)

    def test_slabs_sorted_by_rate_then_inclusive_flag(self):
        """Slabs must be sorted: lower rate first, exclusive (False) before inclusive (True)."""
        self._add_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'ORD1')
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'ORD2')
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'ORD3')
        data = CartSerializer(self.cart).data
        slabs = data['tax_bifurcation']
        self.assertEqual(len(slabs), 3)
        self.assertAlmostEqual(slabs[0]['rate'], 5.0, places=1)
        self.assertFalse(slabs[0]['is_inclusive'])   # 5% excl first
        self.assertAlmostEqual(slabs[1]['rate'], 5.0, places=1)
        self.assertTrue(slabs[1]['is_inclusive'])    # 5% incl second
        self.assertAlmostEqual(slabs[2]['rate'], 18.0, places=1)


# ---------------------------------------------------------------------------
# InvoiceSerializer.get_tax_bifurcation — bifurcates by (rate, is_inclusive)
# ---------------------------------------------------------------------------

class InvoiceTaxBifurcationSlabTests(TestCase):
    """Invoice-level tax_bifurcation must separate same-rate inclusive vs exclusive items."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()
        self.invoice = TestDataFactory.create_invoice(self.user, store=self.store, status='paid')

    def _add_invoice_item(self, gst_percent, gst_inclusive, unit_price, tax_amount, line_total, suffix=''):
        product = TestDataFactory.create_product(track_inventory=True)
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        pi = TestDataFactory.create_purchase_item(purchase=purchase, product=product,
                                                   quantity=Decimal('1.00'), unit_price=unit_price)
        pi.gst_percent = Decimal(str(gst_percent))
        pi.gst_inclusive = bool(gst_inclusive)
        pi.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            product, barcode=f'INV-BIFT-{gst_percent}-{int(gst_inclusive)}-{suffix}',
            tag='sold', purchase_item=pi,
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=product,
            barcode=barcode,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            tax_amount=tax_amount,
            line_total=line_total,
        )

    def test_exclusive_item_slab_is_marked_not_inclusive(self):
        # 5% exclusive: base=100, tax=5, line_total=105
        self._add_invoice_item('5.00', False, Decimal('100.00'), Decimal('5.00'), Decimal('105.00'), 'EX')
        data = InvoiceSerializer(self.invoice).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertFalse(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(slabs[0]['total_tax'], 5.00, places=2)

    def test_inclusive_item_slab_is_marked_inclusive(self):
        # 5% inclusive: base=95.24, tax=4.76, line_total=100.00
        self._add_invoice_item('5.00', True, Decimal('95.24'), Decimal('4.76'), Decimal('100.00'), 'IN')
        data = InvoiceSerializer(self.invoice).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertTrue(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['total_tax'], 4.76, places=2)

    def test_same_rate_inclusive_and_exclusive_produce_two_slabs(self):
        self._add_invoice_item('5.00', False, Decimal('100.00'), Decimal('5.00'), Decimal('105.00'), 'EX')
        self._add_invoice_item('5.00', True, Decimal('95.24'), Decimal('4.76'), Decimal('100.00'), 'IN')
        data = InvoiceSerializer(self.invoice).data
        slabs = data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 2)
        rates = [s['rate'] for s in slabs]
        inclusives = [s['is_inclusive'] for s in slabs]
        self.assertIn(False, inclusives)
        self.assertIn(True, inclusives)
        for r in rates:
            self.assertAlmostEqual(r, 5.0, places=1)

    def test_cgst_sgst_sum_matches_total_tax_per_slab(self):
        self._add_invoice_item('18.00', False, Decimal('100.00'), Decimal('18.00'), Decimal('118.00'), 'CS')
        data = InvoiceSerializer(self.invoice).data
        slabs = data['tax_bifurcation']
        for slab in slabs:
            self.assertAlmostEqual(slab['cgst'] + slab['sgst'], slab['total_tax'], places=2)

    def test_no_tax_invoice_returns_none(self):
        product = TestDataFactory.create_product(track_inventory=True)
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=product,
            barcode=None,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('0.00'),
            line_total=Decimal('100.00'),
        )
        data = InvoiceSerializer(self.invoice).data
        self.assertIsNone(data['tax_bifurcation'])

