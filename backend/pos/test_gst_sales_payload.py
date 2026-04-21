from decimal import Decimal
import logging

from django.test import TestCase

from backend.catalog.views import build_barcode_response
from backend.core.test_utils import TestDataFactory
from backend.pos.models import CartItem
from backend.pos.serializers import CartItemSerializer


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
