"""Stock transfer APIs scoped per retailer: create, complete, isolation."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from backend.catalog.models import Product, Barcode
from backend.core.test_utils import TestDataFactory
from backend.inventory.models import Stock
from backend.locations.models import Store, Warehouse
from backend.tenants.models import Retailer

User = get_user_model()


class StockTransferRetailerAPITests(TestCase):
    def setUp(self):
        self.rx = Retailer.objects.create(code='XFER1', name='Retailer Xfer', is_active=True)
        self.ry = Retailer.objects.create(code='XFER2', name='Other Retailer', is_active=True)

        self.s1 = Store.objects.create(
            retailer=self.rx, name='Shop 1', code='S1', shop_type='warehouse', is_active=True
        )
        self.s2 = Store.objects.create(
            retailer=self.rx, name='Shop 2', code='S2', shop_type='retail', is_active=True
        )
        self.sy = Store.objects.create(
            retailer=self.ry, name='Other Shop', code='OS', shop_type='retail', is_active=True
        )

        self.wh1 = Warehouse.objects.create(
            retailer=self.rx, name='WH1', code='WH1', is_active=True
        )

        self.cat = TestDataFactory.create_category()
        self.cat.retailer = self.rx
        self.cat.save()
        self.brand = TestDataFactory.create_brand()
        self.brand.retailer = self.rx
        self.brand.save()
        self.product = Product.objects.create(
            retailer=self.rx,
            name='Xfer Product',
            sku='XFER-SKU-1',
            category=self.cat,
            brand=self.brand,
        )

        Stock.objects.create(
            product=self.product,
            variant=None,
            store=self.s1,
            warehouse=None,
            quantity=Decimal('10.000'),
        )
        for i in range(1, 41):
            Barcode.objects.create(
                retailer=self.rx,
                product=self.product,
                barcode=f'XFER-BC-{i:04d}',
                tag='new',
                current_store=self.s1,
            )

        self.ux = User.objects.create_user(username='xfer_x', password='pw', retailer=self.rx)
        self.uy = User.objects.create_user(username='xfer_y', password='pw', retailer=self.ry)

    def _auth(self, user):
        c = APIClient()
        t = RefreshToken.for_user(user)
        c.credentials(HTTP_AUTHORIZATION=f'Bearer {t.access_token}')
        return c

    def _codes(self, start: int, count: int):
        return [f'XFER-BC-{i:04d}' for i in range(start, start + count)]

    def test_complete_store_to_store_moves_stock(self):
        client = self._auth(self.ux)
        payload = {
            'from_store': self.s1.id,
            'to_store': self.s2.id,
            'notes': 'restock shop 2',
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '3',
                    'selected_barcodes': self._codes(1, 3),
                }
            ],
        }
        r = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        tid = r.data['id']
        self.assertTrue(r.data['transfer_number'].startswith('XFER1-TR-'))

        r2 = client.post(f'/api/v1/stock-transfers/{tid}/complete/', {}, format='json')
        self.assertEqual(r2.status_code, 200, r2.data)
        self.assertEqual(r2.data['status'], 'completed')

        st1 = Stock.objects.get(product=self.product, store=self.s1, warehouse=None)
        st2 = Stock.objects.get(product=self.product, store=self.s2, warehouse=None)
        self.assertEqual(st1.quantity, Decimal('7.000'))
        self.assertEqual(st2.quantity, Decimal('3.000'))

    def test_complete_insufficient_stock_400(self):
        client = self._auth(self.ux)
        payload = {
            'from_store': self.s1.id,
            'to_store': self.s2.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '11',
                    'selected_barcodes': self._codes(1, 11),
                }
            ],
        }
        r = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(r.status_code, 201)
        tid = r.data['id']

        r2 = client.post(f'/api/v1/stock-transfers/{tid}/complete/', {}, format='json')
        self.assertEqual(r2.status_code, 400)
        st1 = Stock.objects.get(product=self.product, store=self.s1, warehouse=None)
        self.assertEqual(st1.quantity, Decimal('10.000'))

    def test_create_rejects_other_retailer_destination_store(self):
        client = self._auth(self.ux)
        payload = {
            'from_store': self.s1.id,
            'to_store': self.sy.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '1',
                    'selected_barcodes': self._codes(1, 1),
                }
            ],
        }
        r = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('to_store', r.data)

    def test_list_and_detail_isolation(self):
        client_x = self._auth(self.ux)
        payload = {
            'from_store': self.s1.id,
            'to_store': self.s2.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '1',
                    'selected_barcodes': self._codes(4, 1),
                }
            ],
        }
        r = client_x.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(r.status_code, 201)
        tid = r.data['id']

        client_y = self._auth(self.uy)
        r404 = client_y.get(f'/api/v1/stock-transfers/{tid}/')
        self.assertEqual(r404.status_code, 404)

        lst = client_y.get('/api/v1/stock-transfers/')
        self.assertEqual(lst.status_code, 200)
        ids = [row['id'] for row in lst.data]
        self.assertNotIn(tid, ids)

    def test_transfer_numbers_increment_per_retailer(self):
        client = self._auth(self.ux)
        base = {
            'from_store': self.s1.id,
            'to_store': self.s2.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '1',
                    'selected_barcodes': self._codes(5, 1),
                }
            ],
        }
        n1 = client.post('/api/v1/stock-transfers/', base, format='json')
        n2 = client.post('/api/v1/stock-transfers/', base, format='json')
        self.assertEqual(n1.status_code, 201)
        self.assertEqual(n2.status_code, 201)
        self.assertNotEqual(n1.data['transfer_number'], n2.data['transfer_number'])

    def test_warehouse_to_store_completion(self):
        Stock.objects.create(
            product=self.product,
            variant=None,
            store=None,
            warehouse=self.wh1,
            quantity=Decimal('5.000'),
        )
        client = self._auth(self.ux)
        Barcode.objects.filter(
            retailer=self.rx,
            product=self.product,
            barcode__in=self._codes(6, 2),
        ).update(current_store=None, current_warehouse=self.wh1)
        payload = {
            'from_warehouse': self.wh1.id,
            'to_store': self.s2.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '2',
                    'selected_barcodes': self._codes(6, 2),
                }
            ],
        }
        r = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        tid = r.data['id']
        r2 = client.post(f'/api/v1/stock-transfers/{tid}/complete/', {}, format='json')
        self.assertEqual(r2.status_code, 200, r2.data)
        wh_stock = Stock.objects.get(product=self.product, warehouse=self.wh1, store=None)
        s2_stock = Stock.objects.get(product=self.product, store=self.s2, warehouse=None)
        self.assertEqual(wh_stock.quantity, Decimal('3.000'))
        self.assertGreaterEqual(s2_stock.quantity, Decimal('2.000'))
        moved = Barcode.objects.filter(barcode__in=self._codes(6, 2))
        self.assertEqual(moved.filter(current_store=self.s2, current_warehouse__isnull=True).count(), 2)

    def test_patch_notes_on_pending_transfer(self):
        client = self._auth(self.ux)
        payload = {
            'from_store': self.s1.id,
            'to_store': self.s2.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '1',
                    'selected_barcodes': self._codes(8, 1),
                }
            ],
        }
        r = client.post('/api/v1/stock-transfers/', payload, format='json')
        self.assertEqual(r.status_code, 201)
        tid = r.data['id']
        r2 = client.patch(f'/api/v1/stock-transfers/{tid}/', {'notes': 'Handle with care'}, format='json')
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.data['notes'], 'Handle with care')

    def test_cancel_pending_transfer(self):
        client = self._auth(self.ux)
        payload = {
            'from_store': self.s1.id,
            'to_store': self.s2.id,
            'items': [
                {
                    'product': self.product.id,
                    'variant': None,
                    'quantity': '1',
                    'selected_barcodes': self._codes(9, 1),
                }
            ],
        }
        r = client.post('/api/v1/stock-transfers/', payload, format='json')
        tid = r.data['id']
        rc = client.post(f'/api/v1/stock-transfers/{tid}/cancel/', {}, format='json')
        self.assertEqual(rc.status_code, 200)
        self.assertEqual(rc.data['status'], 'cancelled')

        r_complete = client.post(f'/api/v1/stock-transfers/{tid}/complete/', {}, format='json')
        self.assertEqual(r_complete.status_code, 400)
