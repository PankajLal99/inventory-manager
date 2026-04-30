from decimal import Decimal
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model

from backend.catalog.models import Product, Barcode, Category
from backend.locations.models import Store
from backend.pos.models import Invoice, InvoiceItem
from backend.parties.models import Supplier
from backend.purchasing.models import Purchase, PurchaseItem

User = get_user_model()


class GlobalSearchBarcodeTests(APITestCase):
    """Tests for global search barcode and barcode_status: exact match and status/invoice in response."""

    def setUp(self):
        self.user = User.objects.create_user(username='searchuser', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Search Test Store', shop_type='retail')
        self.category = Category.objects.create(name='Search Category')
        self.product = Product.objects.create(
            name='Search Test Product',
            category=self.category,
            product_type='simple',
            is_active=True,
        )
        # Barcode 1: exact match candidate (new), with short_code
        self.barcode_new = Barcode.objects.create(
            product=self.product,
            barcode='EXACT-BARCODE-001',
            short_code='EXACT-SC-001',
            tag='new',
        )
        # Barcode 2: defective
        self.barcode_defective = Barcode.objects.create(
            product=self.product,
            barcode='EXACT-BARCODE-002',
            short_code='EXACT-SC-002',
            tag='defective',
        )
        # Barcode 3: sold (will link to invoice)
        self.barcode_sold = Barcode.objects.create(
            product=self.product,
            barcode='SOLD-BARCODE-003',
            short_code='SOLD-SC-003',
            tag='sold',
        )
        self.invoice = Invoice.objects.create(
            invoice_number='INV-SEARCH-001',
            store=self.store,
            status='completed',
            invoice_type='cash',
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            paid_amount=Decimal('100.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=self.barcode_sold,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('100.00'),
        )
        # Another barcode that shares a prefix but must not match partial search
        Barcode.objects.create(
            product=self.product,
            barcode='EXACT-BARCODE-001-X',
            short_code='EXACT-SC-001-X',
            tag='new',
        )

    def test_barcode_search_exact_match_returns_barcode(self):
        """Search with exact barcode value returns that barcode only."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-001', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')
        self.assertEqual(barcodes[0]['tag'], 'new')
        self.assertIn('tag_display', barcodes[0])

    def test_barcode_search_partial_does_not_match(self):
        """Partial barcode (prefix) does not return results; backend uses exact match only."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BAR', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 0)

    def test_barcode_search_short_code_exact_match(self):
        """Search by exact short_code returns the matching barcode."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-SC-001', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['short_code'], 'EXACT-SC-001')
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')

    def test_barcode_status_search_by_tag_defective(self):
        """Barcode status search with q=defective returns only defective barcodes."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'defective', 'type': 'barcode_status'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'defective')
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-002')

    def test_barcode_status_search_by_tag_sold(self):
        """Barcode status search with q=sold returns only sold barcodes."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'sold', 'type': 'barcode_status'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'sold')
        self.assertEqual(barcodes[0]['barcode'], 'SOLD-BARCODE-003')

    def test_barcode_status_search_by_tag_new(self):
        """Barcode status search with q=new returns barcodes with tag new."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'new', 'type': 'barcode_status'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertGreaterEqual(len(barcodes), 1)
        barcode_values = [b['barcode'] for b in barcodes]
        self.assertIn('EXACT-BARCODE-001', barcode_values)

    def test_barcode_search_response_includes_status(self):
        """Each barcode in search response includes tag and tag_display (current status)."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-002', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'defective')
        self.assertTrue(barcodes[0].get('tag_display'))
        self.assertIn('Defective', barcodes[0]['tag_display'])

    def test_barcode_search_sold_includes_invoice_detail(self):
        """Sold barcode in response includes invoice_id, invoice_number, and related fields."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'SOLD-BARCODE-003', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        b = barcodes[0]
        self.assertEqual(b['tag'], 'sold')
        self.assertEqual(b['invoice_number'], 'INV-SEARCH-001')
        self.assertEqual(b['invoice_id'], self.invoice.id)
        self.assertIsNotNone(b.get('invoice_date'))
        self.assertIsNotNone(b.get('sold_price'))

    def test_barcode_search_trimmed_query(self):
        """Query with leading/trailing spaces is trimmed and still exact-matches."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': '  EXACT-BARCODE-001  ', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')

    def test_barcode_search_in_all_type_exact_only(self):
        """With type=all, barcode results still use exact match (no partial)."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-002', 'type': 'all'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-002')
        # Partial should not appear in barcodes
        response2 = self.client.get(url, {'q': 'EXACT-BAR', 'type': 'all'})
        self.assertEqual(len(response2.data.get('barcodes', [])), 0)

    def test_barcode_search_normalizes_case(self):
        """Global search uppercases barcode query so scanner input matches stored barcodes (case-insensitive)."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'exact-barcode-001', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1, 'Backend normalizes query to upper; lowercase search should find EXACT-BARCODE-001')
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')


class GlobalSearchProductPriceFallbackTests(APITestCase):
    """Regression tests for product price fields in global search payload."""

    def setUp(self):
        self.user = User.objects.create_user(username='searchpriceuser', password='password')
        self.client.force_authenticate(user=self.user)
        self.category = Category.objects.create(name='Folder')
        self.supplier = Supplier.objects.create(name='BLUEHORSE', code='BLUEHORSE')

    def test_product_search_fills_price_from_supplier_breakdown_when_barcode_price_unavailable(self):
        """
        Product search should return top-level purchase/selling prices using supplier rows
        when direct barcode-derived values are unavailable.
        """
        product = Product.objects.create(
            name='FOLDER IPHONE XR TFT GX NON PESTING',
            category=self.category,
            track_inventory=True,
            is_active=True,
        )
        purchase = Purchase.objects.create(
            supplier=self.supplier,
            purchase_number='PUR-SEARCH-PRICE-001',
            status='finalized',
            created_by=self.user,
        )
        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            quantity=Decimal('10'),
            shop_quantity=Decimal('10'),
            warehouse_quantity=Decimal('0'),
            unit_price=Decimal('665'),
            selling_price=Decimal('0'),
        )

        url = reverse('global-search')
        response = self.client.get(url, {'q': 'FOLDER IPHONE XR TFT GX', 'type': 'product'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        products = response.data.get('products', [])
        target = next((p for p in products if p.get('id') == product.id), None)
        self.assertIsNotNone(target)

        # Fallback behavior from supplier_breakdown should populate top-level fields.
        self.assertEqual(target.get('purchase_price'), 665.0)
        self.assertEqual(target.get('selling_price'), 665.0)
