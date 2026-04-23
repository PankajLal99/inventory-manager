from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from backend.catalog.models import Barcode
from backend.locations.models import Store
from backend.pos.models import Invoice, InvoiceItem
from backend.tenants.models import Retailer


class PublicSelfCheckoutFlowTests(APITestCase):
    def setUp(self):
        self.retailer = Retailer.objects.create(code='demo', name='Demo Retailer', is_active=True)
        self.store = Store.objects.create(
            retailer=self.retailer,
            name='Main Store',
            code='MAIN',
            is_active=True,
        )

    def _create_pending_invoice_with_barcode(self, created_at=None):
        barcode = Barcode.objects.create(
            retailer=self.retailer,
            barcode=f'BC-{timezone.now().timestamp()}',
            tag='in-cart',
            current_store=self.store,
        )
        invoice = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-{timezone.now().timestamp()}',
            store=self.store,
            invoice_type='pending',
            status='draft',
            created_at=created_at or timezone.now(),
        )
        InvoiceItem.objects.create(
            invoice=invoice,
            barcode=barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('0.00'),
            line_total=Decimal('100.00'),
        )
        return invoice, barcode

    def test_public_stores_requires_retailer(self):
        response = self.client.get('/api/v1/public/self-checkout/stores/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)

    def test_discard_pending_success_voids_invoice_and_resets_barcode(self):
        invoice, barcode = self._create_pending_invoice_with_barcode()

        response = self.client.post(
            '/api/v1/public/self-checkout/discard-pending/',
            {'retailer': self.retailer.code, 'invoice_id': invoice.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invoice.refresh_from_db()
        barcode.refresh_from_db()
        self.assertEqual(invoice.status, 'void')
        self.assertEqual(barcode.tag, 'new')
        self.assertIsNone(barcode.current_store_id)
        self.assertIsNone(barcode.current_warehouse_id)

    def test_discard_pending_does_not_void_paid_invoice(self):
        invoice = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-PAID-{timezone.now().timestamp()}',
            store=self.store,
            invoice_type='pending',
            status='paid',
        )

        response = self.client.post(
            '/api/v1/public/self-checkout/discard-pending/',
            {'retailer': self.retailer.code, 'invoice_id': invoice.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')

    def test_stale_pending_invoice_is_auto_cleaned_on_public_request(self):
        stale_created_at = timezone.now() - timedelta(minutes=6)
        invoice, barcode = self._create_pending_invoice_with_barcode(created_at=stale_created_at)

        response = self.client.get('/api/v1/public/self-checkout/stores/', {'retailer': self.retailer.code})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invoice.refresh_from_db()
        barcode.refresh_from_db()
        self.assertEqual(invoice.status, 'void')
        self.assertEqual(barcode.tag, 'new')

    def test_recent_pending_invoice_is_not_auto_cleaned(self):
        recent_created_at = timezone.now() - timedelta(minutes=2)
        invoice, barcode = self._create_pending_invoice_with_barcode(created_at=recent_created_at)

        response = self.client.get('/api/v1/public/self-checkout/stores/', {'retailer': self.retailer.code})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invoice.refresh_from_db()
        barcode.refresh_from_db()
        self.assertEqual(invoice.status, 'draft')
        self.assertEqual(barcode.tag, 'in-cart')
