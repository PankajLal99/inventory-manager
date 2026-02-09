from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.utils import timezone
from decimal import Decimal
import uuid
from backend.catalog.models import Product, Barcode, Category
from backend.locations.models import Warehouse, Store
from backend.purchasing.models import Purchase, PurchaseItem
from backend.parties.models import Supplier
from backend.inventory.models import Stock
from django.contrib.auth import get_user_model

User = get_user_model()

class WarehouseReceiptTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(username=f'admin_{uuid.uuid4().hex[:6]}', email='admin@example.com', password='password')
        self.client.force_authenticate(user=self.user)
        self.warehouse = Warehouse.objects.create(name='Main Warehouse', is_active=True)
        self.supplier = Supplier.objects.create(name='Test Supplier', code='SUP001')
        self.category = Category.objects.create(name='Electronics')
        self.product = Product.objects.create(
            name='Warehouse Product',
            category=self.category,
            product_type='simple',
            track_inventory=True
        )

    def test_finalize_purchase_to_warehouse(self):
        """Test that finalizing a purchase with a warehouse location correctly updates warehouse stock"""
        # 1. Create a draft purchase for the warehouse via API
        url_create = reverse('purchase-list-create')
        data_create = {
            'purchase_number': f'PUR-WH-{uuid.uuid4().hex[:8].upper()}',
            'warehouse': self.warehouse.id,
            'supplier': self.supplier.id,
            'status': 'draft',
            'purchase_date': timezone.now().date().isoformat(),
            'items': [
                {
                    'product': self.product.id,
                    'quantity': 50,
                    'unit_price': 100
                }
            ]
        }
        res_create = self.client.post(url_create, data_create, format='json')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        purchase_id = res_create.data['id']
        purchase_number = res_create.data['purchase_number']
        
        # Verify barcodes were generated for the draft
        self.assertEqual(Barcode.objects.filter(product=self.product, purchase_id=purchase_id).count(), 50)
        
        # 2. Finalize the purchase
        url_finalize = reverse('purchase-finalize', args=[purchase_id])
        # We don't necessarily need to pass items here if they haven't changed
        response = self.client.post(url_finalize, {}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 3. Verify stock in warehouse
        stock = Stock.objects.get(product=self.product, warehouse=self.warehouse)
        self.assertEqual(stock.quantity, Decimal('50.000'))
        
        # 4. Verify barcodes are created and tagged 'new'
        barcodes_count = Barcode.objects.filter(product=self.product, purchase_id=purchase_id, tag='new').count()
        self.assertEqual(barcodes_count, 50)
        
        # 5. Verify purchase status is finalized
        purchase = Purchase.objects.get(id=purchase_id)
        self.assertEqual(purchase.status, 'finalized')

    def test_purchase_creation_to_warehouse(self):
        """Test creating a finalized purchase directly to warehouse through the list endpoint"""
        url = reverse('purchase-list-create')
        data = {
            'warehouse': self.warehouse.id,
            'supplier': self.supplier.id,
            'purchase_date': timezone.now().date().isoformat(),
            'status': 'finalized',
            'items': [
                {
                    'product': self.product.id,
                    'quantity': 25,
                    'unit_price': 120
                }
            ]
        }
        
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Verify stock
        stock = Stock.objects.get(product=self.product, warehouse=self.warehouse)
        self.assertEqual(stock.quantity, Decimal('25.000'))
        
        # Verify barcodes
        self.assertEqual(Barcode.objects.filter(product=self.product, purchase_id=response.data['id'], tag='new').count(), 25)

    def test_mixed_store_and_warehouse_stock(self):
        """Test that stock is isolated between store and warehouse"""
        store = Store.objects.create(name='Retail Store', is_active=True)
        
        # 1. Add 10 to warehouse
        Stock.objects.create(product=self.product, warehouse=self.warehouse, quantity=Decimal('10.000'))
        
        # 2. Add 5 to store via purchase API
        url = reverse('purchase-list-create')
        data = {
            'store': store.id,
            'supplier': self.supplier.id,
            'purchase_date': timezone.now().date().isoformat(),
            'status': 'finalized',
            'items': [
                {
                    'product': self.product.id,
                    'quantity': 5,
                    'unit_price': 100
                }
            ]
        }
        self.client.post(url, data, format='json')
        
        # Check stock isolation
        wh_stock = Stock.objects.get(product=self.product, warehouse=self.warehouse)
        st_stock = Stock.objects.get(product=self.product, store=store)
        
        self.assertEqual(wh_stock.quantity, Decimal('10.000'))
        self.assertEqual(st_stock.quantity, Decimal('5.000'))
        
        # Check stock isolation
        wh_stock = Stock.objects.get(product=self.product, warehouse=self.warehouse)
        st_stock = Stock.objects.get(product=self.product, store=store)
        
        self.assertEqual(wh_stock.quantity, Decimal('10.000'))
        self.assertEqual(st_stock.quantity, Decimal('5.000'))
