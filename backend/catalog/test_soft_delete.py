"""
Soft-delete consistency: Product, Barcode, Purchase APIs and POS invoice barcode resolution.

Edge cases: default managers hide rows; historical invoices must still resolve barcodes via all_objects.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework import status

from backend.catalog.models import Barcode, Product
from backend.core.test_utils import AuthenticatedAPIClient, TestDataFactory
from backend.pos.models import InvoiceItem
from backend.pos.views import resolve_invoice_item_barcode
from backend.purchasing.models import Purchase


class SoftDeleteProductAPITests(TestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.product = TestDataFactory.create_product(name='SoftDel Product', sku='SD-SKU-001')

    def test_delete_product_is_soft_delete(self):
        pk = self.product.id
        resp = self.client.delete(f'/api/v1/products/{pk}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Product.objects.filter(pk=pk).exists())
        archived = Product.all_objects.get(pk=pk)
        self.assertIsNotNone(archived.deleted_at)
        self.assertFalse(archived.is_active)

    def test_deleted_product_hidden_from_list(self):
        self.client.delete(f'/api/v1/products/{self.product.id}/')
        resp = self.client.get('/api/v1/products/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        results = resp.data.get('results', resp.data if isinstance(resp.data, list) else [])
        ids = [p['id'] for p in results] if results else []
        self.assertNotIn(self.product.id, ids)


class SoftDeleteBarcodeAPITests(TestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.product = TestDataFactory.create_product(track_inventory=True)
        self.barcode = TestDataFactory.create_barcode(
            self.product, barcode='SD-BC-UNIQ-001', tag='new'
        )

    def test_delete_barcode_is_soft_delete(self):
        pk = self.barcode.id
        resp = self.client.delete(f'/api/v1/barcodes/{pk}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Barcode.objects.filter(pk=pk).exists())
        archived = Barcode.all_objects.get(pk=pk)
        self.assertIsNotNone(archived.deleted_at)


class SoftDeletePurchaseAPITests(TestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.supplier = TestDataFactory.create_supplier()
        self.store = TestDataFactory.create_store()
        self.product = TestDataFactory.create_product(track_inventory=True)

    def test_delete_purchase_soft_deletes_purchase_and_new_barcodes_not_sold(self):
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        TestDataFactory.create_purchase_item(purchase=purchase, product=self.product)

        b_new = TestDataFactory.create_barcode(
            self.product, barcode='SD-PUR-NEW-01', tag='new'
        )
        b_new.purchase = purchase
        b_new.save(update_fields=['purchase'])

        b_sold = TestDataFactory.create_barcode(
            self.product, barcode='SD-PUR-SOLD-01', tag='sold'
        )
        b_sold.purchase = purchase
        b_sold.save(update_fields=['purchase'])

        resp = self.client.delete(f'/api/v1/purchases/{purchase.id}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        self.assertFalse(Purchase.objects.filter(id=purchase.id).exists())
        self.assertIsNotNone(Purchase.all_objects.get(id=purchase.id).deleted_at)

        self.assertIsNotNone(Barcode.all_objects.get(pk=b_new.pk).deleted_at)
        self.assertIsNone(Barcode.all_objects.get(pk=b_sold.pk).deleted_at)


class ResolveInvoiceBarcodeSoftDeleteTests(TestCase):
    """POS resolve must see soft-deleted Barcode rows when FK or snapshot still points at them."""

    def setUp(self):
        self.user = TestDataFactory.create_user(is_staff=True)
        self.product = TestDataFactory.create_product(track_inventory=True)
        self.invoice = TestDataFactory.create_invoice(self.user, status='paid')

    def test_resolve_by_fk_when_barcode_soft_deleted(self):
        barcode = TestDataFactory.create_barcode(
            self.product, barcode='SD-INV-FK-01', tag='sold'
        )
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=barcode,
            sold_barcode_value=barcode.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('10.00'),
            line_total=Decimal('10.00'),
        )
        barcode.delete()  # soft
        line.refresh_from_db()
        self.assertTrue(line.barcode_id)
        self.assertFalse(Barcode.objects.filter(pk=barcode.pk).exists())

        resolved = resolve_invoice_item_barcode(line, relink=False)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, barcode.pk)
        self.assertIsNotNone(Barcode.all_objects.get(pk=barcode.pk).deleted_at)

    def test_resolve_by_snapshot_when_fk_null_and_barcode_soft_deleted(self):
        barcode = TestDataFactory.create_barcode(
            self.product, barcode='SD-INV-SNAP-01', tag='sold'
        )
        snap = barcode.barcode
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=None,
            sold_barcode_value=snap,
            quantity=Decimal('1.000'),
            unit_price=Decimal('10.00'),
            line_total=Decimal('10.00'),
        )
        barcode.delete()  # soft

        resolved = resolve_invoice_item_barcode(line, relink=False)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, barcode.pk)


class ProductQuerySetSoftDeleteTests(TestCase):
    """ProductQuerySet.delete() from git-diff catalog/models (bulk soft-delete)."""

    def test_product_queryset_delete_soft_deletes_rows(self):
        p = TestDataFactory.create_product(name='Bulk Del Product', sku='BULK-DEL-1')
        pk = p.pk
        deleted_count, _ = Product.objects.filter(pk=pk).delete()
        self.assertGreaterEqual(deleted_count, 1)
        self.assertFalse(Product.objects.filter(pk=pk).exists())
        archived = Product.all_objects.get(pk=pk)
        self.assertIsNotNone(archived.deleted_at)
        self.assertFalse(archived.is_active)
