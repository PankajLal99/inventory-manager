"""Barcode ownership tests for stock transfer flows across shops/warehouses."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from backend.catalog.models import Barcode, Product
from backend.core.test_utils import TestDataFactory
from backend.inventory.models import Stock
from backend.locations.models import Store, Warehouse
from backend.tenants.models import Retailer

User = get_user_model()


class StockTransferBarcodeOwnershipTests(TestCase):
    def setUp(self):
        self.retailer = Retailer.objects.create(code='XBO', name='Barcode Owner', is_active=True)
        self.store_a = Store.objects.create(
            retailer=self.retailer, name='Shop A', code='A1', shop_type='retail', is_active=True
        )
        self.store_b = Store.objects.create(
            retailer=self.retailer, name='Shop B', code='B1', shop_type='retail', is_active=True
        )
        self.warehouse = Warehouse.objects.create(
            retailer=self.retailer, name='WH', code='WH', is_active=True
        )

        cat = TestDataFactory.create_category()
        cat.retailer = self.retailer
        cat.save()
        brand = TestDataFactory.create_brand()
        brand.retailer = self.retailer
        brand.save()
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Owned Phone',
            sku='OWN-PH-1',
            category=cat,
            brand=brand,
        )

        Stock.objects.create(product=self.product, store=self.store_a, warehouse=None, quantity=Decimal('5.000'))
        Stock.objects.create(product=self.product, store=self.store_b, warehouse=None, quantity=Decimal('4.000'))
        Stock.objects.create(product=self.product, store=None, warehouse=self.warehouse, quantity=Decimal('3.000'))

        self.bc_a1 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode='OWN-A-0001',
            short_code='OWN-1',
            tag='new',
            current_store=self.store_a,
        )
        self.bc_a2 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode='OWN-A-0002',
            tag='new',
            current_store=self.store_a,
        )
        self.bc_b1 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode='OWN-B-0001',
            tag='new',
            current_store=self.store_b,
        )
        self.bc_w1 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode='OWN-W-0001',
            tag='new',
            current_store=None,
            current_warehouse=self.warehouse,
        )

        self.user = User.objects.create_user(username='own_user', password='pw', retailer=self.retailer)

    def _client(self):
        c = APIClient()
        tok = RefreshToken.for_user(self.user)
        c.credentials(HTTP_AUTHORIZATION=f'Bearer {tok.access_token}')
        return c

    def test_rejects_store_transfer_when_barcode_belongs_to_another_store(self):
        client = self._client()
        payload = {
            'from_store': self.store_a.id,
            'to_store': self.store_b.id,
            'items': [
                {
                    'product': self.product.id,
                    'quantity': '1',
                    'selected_barcodes': ['OWN-B-0001'],
                }
            ],
        }
        res = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn('source location', str(res.data).lower())

    def test_rejects_store_transfer_when_barcode_belongs_to_warehouse(self):
        client = self._client()
        payload = {
            'from_store': self.store_a.id,
            'to_store': self.store_b.id,
            'items': [
                {
                    'product': self.product.id,
                    'quantity': '1',
                    'selected_barcodes': ['OWN-W-0001'],
                }
            ],
        }
        res = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(res.status_code, 400, res.data)

    def test_accepts_short_code_and_moves_ownership_to_destination_store(self):
        client = self._client()
        payload = {
            'from_store': self.store_a.id,
            'to_store': self.store_b.id,
            'items': [
                {
                    'product': self.product.id,
                    'quantity': '1',
                    'selected_barcodes': ['OWN-1'],
                }
            ],
        }
        created = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        tid = created.data['id']
        done = client.post(f'/api/v1/stock-transfers/{tid}/complete/', {}, format='json')
        self.assertEqual(done.status_code, 200, done.data)

        self.bc_a1.refresh_from_db()
        self.assertEqual(self.bc_a1.current_store_id, self.store_b.id)
        self.assertIsNone(self.bc_a1.current_warehouse_id)

    def test_rejects_duplicate_barcodes_across_lines(self):
        client = self._client()
        payload = {
            'from_store': self.store_a.id,
            'to_store': self.store_b.id,
            'items': [
                {'product': self.product.id, 'quantity': '1', 'selected_barcodes': ['OWN-A-0002']},
                {'product': self.product.id, 'quantity': '1', 'selected_barcodes': ['OWN-A-0002']},
            ],
        }
        res = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn('repeated across lines', str(res.data))

