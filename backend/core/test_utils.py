"""
Test utilities and factories for creating test data
"""
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from backend.core.models import Setting, AuditLog
from backend.tenants.models import Retailer
from backend.locations.models import Store, Warehouse
from backend.catalog.models import Category, Brand, Product, ProductVariant, Barcode, TaxRate
from backend.parties.models import Customer, Supplier, CustomerGroup
from backend.pos.models import Cart, Invoice, InvoiceItem, POSSession
from backend.purchasing.models import Purchase, PurchaseItem
from backend.inventory.models import Stock, StockAdjustment
from decimal import Decimal
from django.utils import timezone
import random
import string
import uuid

User = get_user_model()


class TestDataFactory:
    """Factory class for creating test data"""

    @staticmethod
    def get_or_create_default_retailer():
        r, _ = Retailer.objects.get_or_create(
            code='TST',
            defaults={'name': 'Test Retailer', 'is_active': True},
        )
        return r

    @staticmethod
    def random_string(length=10):
        """Generate a random string"""
        return ''.join(random.choices(string.ascii_letters + string.digits, k=length))
    
    @staticmethod
    def create_user(username=None, email=None, password='testpass123', is_staff=False, is_superuser=False):
        """Create a test user"""
        if not username:
            username = f'testuser_{TestDataFactory.random_string(6)}'
        if not email:
            email = f'{username}@test.com'
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            is_staff=is_staff,
            is_superuser=is_superuser
        )
        if not is_superuser:
            user.retailer = TestDataFactory.get_or_create_default_retailer()
            user.save(update_fields=['retailer_id'])
        return user
    
    
    @staticmethod
    def create_store(name=None, address=None, code=None):
        """Create a test store"""
        if not name:
            name = f'Store_{TestDataFactory.random_string(6)}'
        if not code:
            code = f'STORE_{TestDataFactory.random_string(6).upper()}'
        r = TestDataFactory.get_or_create_default_retailer()
        return Store.objects.create(
            retailer=r,
            name=name,
            code=code,
            address=address or f'Test Address {name}',
            phone='1234567890'
        )
    
    @staticmethod
    def create_warehouse(name=None, address=None, code=None):
        """Create a test warehouse"""
        if not name:
            name = f'Warehouse_{TestDataFactory.random_string(6)}'
        if not code:
            code = f'WH_{TestDataFactory.random_string(6).upper()}'
        r = TestDataFactory.get_or_create_default_retailer()
        return Warehouse.objects.create(
            retailer=r,
            name=name,
            code=code,
            address=address or f'Test Address {name}',
            phone='1234567890'
        )
    
    @staticmethod
    def create_category(name=None, description=None):
        """Create a test category"""
        if not name:
            name = f'Category_{TestDataFactory.random_string(6)}'
        r = TestDataFactory.get_or_create_default_retailer()
        return Category.objects.create(
            retailer=r,
            name=name,
            description=description or f'Test category {name}'
        )
    
    @staticmethod
    def create_brand(name=None, description=None):
        """Create a test brand"""
        if not name:
            name = f'Brand_{TestDataFactory.random_string(6)}'
        r = TestDataFactory.get_or_create_default_retailer()
        return Brand.objects.create(
            retailer=r,
            name=name,
            description=description or f'Test brand {name}'
        )
    
    @staticmethod
    def create_tax_rate(name=None, rate=None):
        """Create a test tax rate"""
        if not name:
            name = f'Tax_{TestDataFactory.random_string(6)}'
        if rate is None:
            rate = Decimal('10.00')
        r = TestDataFactory.get_or_create_default_retailer()
        return TaxRate.objects.create(
            retailer=r,
            name=name,
            rate=rate
        )
    
    @staticmethod
    def create_product(name=None, sku=None, category=None, brand=None, track_inventory=True):
        """Create a test product"""
        if not name:
            name = f'Product_{TestDataFactory.random_string(6)}'
        if not sku:
            sku = f'SKU_{TestDataFactory.random_string(8)}'
        if not category:
            category = TestDataFactory.create_category()
        if not brand:
            brand = TestDataFactory.create_brand()
        
        rid = category.retailer_id
        return Product.objects.create(
            retailer_id=rid,
            name=name,
            sku=sku,
            category=category,
            brand=brand,
            track_inventory=track_inventory,
            low_stock_threshold=10
        )
    
    @staticmethod
    def create_barcode(product, barcode=None, tag='new', variant=None, purchase_item=None):
        """Create a test barcode"""
        if not barcode:
            barcode = f'BC_{TestDataFactory.random_string(10)}'
        return Barcode.objects.create(
            retailer_id=product.retailer_id,
            product=product,
            variant=variant,
            barcode=barcode,
            tag=tag,
            purchase_item=purchase_item
        )
    
    @staticmethod
    def create_customer(name=None, phone=None, email=None):
        """Create a test customer"""
        if not name:
            name = f'Customer_{TestDataFactory.random_string(6)}'
        if not phone:
            phone = f'9{random.randint(100000000, 999999999)}'
        if not email:
            email = f'{name.lower()}@test.com'
        r = TestDataFactory.get_or_create_default_retailer()
        return Customer.objects.create(
            retailer=r,
            name=name,
            phone=phone,
            email=email
        )
    
    @staticmethod
    def create_supplier(name=None, phone=None, email=None):
        """Create a test supplier"""
        if not name:
            name = f'Supplier_{TestDataFactory.random_string(6)}'
        if not phone:
            phone = f'9{random.randint(100000000, 999999999)}'
        if not email:
            email = f'{name.lower()}@test.com'
        r = TestDataFactory.get_or_create_default_retailer()
        return Supplier.objects.create(
            retailer=r,
            name=name,
            phone=phone,
            email=email
        )
    
    @staticmethod
    def create_cart(user, store=None, status='active', invoice_type='cash'):
        """Create a test cart"""
        if not store:
            store = TestDataFactory.create_store()
        # Generate unique cart_number
        cart_number = f"CART-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        rid = store.retailer_id
        while Cart.objects.filter(cart_number=cart_number, retailer_id=rid).exists():
            cart_number = f"CART-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        return Cart.objects.create(
            retailer_id=rid,
            cart_number=cart_number,
            created_by=user,
            store=store,
            status=status,
            invoice_type=invoice_type
        )
    
    @staticmethod
    def create_invoice(user, customer=None, store=None, invoice_type='cash', status='paid'):
        """Create a test invoice"""
        if not store:
            store = TestDataFactory.create_store()
        # Generate unique invoice_number
        invoice_number = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        rid = store.retailer_id
        while Invoice.objects.filter(invoice_number=invoice_number, retailer_id=rid).exists():
            invoice_number = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        return Invoice.objects.create(
            retailer_id=rid,
            invoice_number=invoice_number,
            created_by=user,
            customer=customer,
            store=store,
            invoice_type=invoice_type,
            status=status
        )
    
    @staticmethod
    def create_purchase(user, supplier=None, store=None, warehouse=None, purchase_date=None, status='draft'):
        """Create a test purchase (default status='draft'; use status='finalized' for stock to count)."""
        if not supplier:
            supplier = TestDataFactory.create_supplier()
        if not store:
            store = TestDataFactory.create_store()
        if not purchase_date:
            purchase_date = timezone.now().date()
        rid = store.retailer_id if store else supplier.retailer_id
        return Purchase.objects.create(
            retailer_id=rid,
            created_by=user,
            supplier=supplier,
            store=store,
            warehouse=warehouse,
            purchase_date=purchase_date,
            status=status
        )
    
    @staticmethod
    def create_purchase_item(purchase, product, quantity=None, unit_price=None, variant=None, shop_quantity=None, warehouse_quantity=None):
        """Create a test purchase item. If shop_quantity/warehouse_quantity omitted, default to quantity split 0/quantity."""
        if quantity is None:
            quantity = Decimal('10.00')
        if unit_price is None:
            unit_price = Decimal('100.00')
        if shop_quantity is None and warehouse_quantity is None:
            shop_quantity = quantity
            warehouse_quantity = Decimal('0.000')
        elif shop_quantity is None:
            shop_quantity = quantity - (warehouse_quantity or Decimal('0'))
        elif warehouse_quantity is None:
            warehouse_quantity = quantity - (shop_quantity or Decimal('0'))
        return PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            variant=variant,
            quantity=quantity,
            unit_price=unit_price,
            shop_quantity=shop_quantity,
            warehouse_quantity=warehouse_quantity
        )
    
    @staticmethod
    def create_barcode_with_purchase(user, product, barcode=None, tag='new', variant=None):
        """Create a barcode linked to a purchase (for tracked products)"""
        # Create purchase
        purchase = TestDataFactory.create_purchase(user=user)
        # Create purchase item
        purchase_item = TestDataFactory.create_purchase_item(
            purchase=purchase,
            product=product,
            variant=variant
        )
        # Create barcode linked to purchase_item
        return TestDataFactory.create_barcode(
            product=product,
            barcode=barcode,
            tag=tag,
            variant=variant,
            purchase_item=purchase_item
        )


class AuthenticatedAPIClient(APIClient):
    """APIClient with authentication helper"""
    
    def authenticate_user(self, user):
        """Authenticate the client with a user"""
        refresh = RefreshToken.for_user(user)
        self.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        return self
    
    def logout(self):
        """Remove authentication"""
        self.credentials()
