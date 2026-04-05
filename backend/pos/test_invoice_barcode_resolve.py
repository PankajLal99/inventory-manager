"""Tests for invoice line barcode resolution and restore-barcode API (pos.views)."""

from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from backend.core.test_utils import AuthenticatedAPIClient, TestDataFactory
from backend.pos.models import InvoiceItem
from backend.pos.views import _lookup_barcode_for_invoice_line, resolve_invoice_item_barcode


class LookupBarcodeForInvoiceLineTests(TestCase):
    def setUp(self):
        self.p1 = TestDataFactory.create_product(name='Line P1', track_inventory=True)
        self.p2 = TestDataFactory.create_product(name='Line P2', track_inventory=True)
        self.b1 = TestDataFactory.create_barcode(self.p1, barcode='LKP-P1-01', tag='sold')

    def test_empty_raw_returns_none(self):
        self.assertIsNone(_lookup_barcode_for_invoice_line('', self.p1, None))
        self.assertIsNone(_lookup_barcode_for_invoice_line('  ', self.p1, None))

    def test_rejects_barcode_attached_to_other_product(self):
        self.assertIsNone(_lookup_barcode_for_invoice_line('LKP-P1-01', self.p2, None))

    def test_accepts_when_product_matches(self):
        got = _lookup_barcode_for_invoice_line('lkp-p1-01', self.p1, None)
        self.assertIsNotNone(got)
        self.assertEqual(got.pk, self.b1.pk)


class ResolveInvoiceItemBarcodeRelinkTests(TestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user(is_staff=True)
        self.product = TestDataFactory.create_product(track_inventory=True)
        self.invoice = TestDataFactory.create_invoice(self.user, status='paid')
        self.barcode = TestDataFactory.create_barcode(
            self.product, barcode='RELINK-SNAP-99', tag='sold'
        )

    def test_relink_sets_fk_from_sold_barcode_value(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=None,
            sold_barcode_value=self.barcode.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('10.00'),
            line_total=Decimal('10.00'),
        )
        resolved = resolve_invoice_item_barcode(line, relink=True)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, self.barcode.pk)
        line.refresh_from_db()
        self.assertEqual(line.barcode_id, self.barcode.pk)

    def test_scanned_override_used_before_snapshot(self):
        other = TestDataFactory.create_barcode(
            self.product, barcode='RELINK-OVERRIDE-88', tag='sold'
        )
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=None,
            sold_barcode_value=self.barcode.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('10.00'),
            line_total=Decimal('10.00'),
        )
        resolved = resolve_invoice_item_barcode(line, scanned_override=other.barcode, relink=True)
        self.assertEqual(resolved.pk, other.pk)
        line.refresh_from_db()
        self.assertEqual(line.barcode_id, other.pk)


class InvoiceItemRestoreBarcodeAPITests(APITestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.product = TestDataFactory.create_product(track_inventory=True)
        self.invoice = TestDataFactory.create_invoice(self.user, status='paid')
        self.barcode = TestDataFactory.create_barcode(
            self.product, barcode='REST-API-STICKER-01', tag='sold'
        )

    def test_missing_scanned_barcode_400(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=None,
            sold_barcode_value='',
            quantity=Decimal('1.000'),
            unit_price=Decimal('1.00'),
            line_total=Decimal('1.00'),
        )
        url = reverse('invoice-item-restore-barcode', args=[self.invoice.id, line.id])
        r = self.client.post(url, {}, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_no_match_404(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=None,
            sold_barcode_value='',
            quantity=Decimal('1.000'),
            unit_price=Decimal('1.00'),
            line_total=Decimal('1.00'),
        )
        url = reverse('invoice-item-restore-barcode', args=[self.invoice.id, line.id])
        r = self.client.post(url, {'scanned_barcode': 'NO-SUCH-STOCKER'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_success_links_line(self):
        line = InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=None,
            sold_barcode_value='',
            quantity=Decimal('1.000'),
            unit_price=Decimal('1.00'),
            line_total=Decimal('1.00'),
        )
        url = reverse('invoice-item-restore-barcode', args=[self.invoice.id, line.id])
        r = self.client.post(url, {'scanned_barcode': self.barcode.barcode}, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        line.refresh_from_db()
        self.assertEqual(line.barcode_id, self.barcode.pk)
