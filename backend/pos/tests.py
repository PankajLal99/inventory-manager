from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.utils import timezone
from decimal import Decimal
import uuid
from backend.catalog.models import Product, Barcode, Category
from backend.locations.models import Store
from backend.pos.models import Cart, CartItem, Invoice
from backend.core.models import AuditLog
from django.contrib.auth import get_user_model

User = get_user_model()

class CheckoutTests(APITestCase):
    def setUp(self):
        # Use a unique username for each test or rely on setUp running before each
        self.user = User.objects.create_user(username=f'testuser_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Test Store', shop_type='retail')
        self.category = Category.objects.create(name='Test Category')
        self.product = Product.objects.create(
            name='Test Product',
            category=self.category,
            product_type='simple'
        )
        # Create 10 barcodes
        for i in range(10):
            Barcode.objects.create(
                product=self.product,
                barcode=f'BC-{uuid.uuid4().hex[:8]}',
                tag='new'
            )

    def test_successful_cart_checkout_auto_assign(self):
        """Test that checkout auto-assigns barcodes when none are scanned"""
        cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash'
        )
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=5,
            unit_price=Decimal('100.00')
        )
        
        url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice = Invoice.objects.get(id=response.data['id'])
        self.assertEqual(invoice.items.count(), 5)
        # Check that barcodes are marked as sold
        sold_barcodes_count = Barcode.objects.filter(tag='sold', invoice_items__invoice=invoice).count()
        self.assertEqual(sold_barcodes_count, 5)

    def test_duplicate_checkout_prevention(self):
        """Test that a consecutive second checkout request for the same cart is blocked"""
        cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash'
        )
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=2,
            unit_price=Decimal('100.00')
        )
        
        url = reverse('cart-checkout', args=[cart.id])
        
        # First request
        response1 = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        
        # Second request (duplicate) - should hit the status check guard
        response2 = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already checked out', response2.data.get('error', ''))

    def test_insufficient_stock_fail_fast(self):
        """Test that checkout fails if not enough barcodes are available for a tracked product"""
        cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash'
        )
        # Request 15, but only 10 available in DB
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=15,
            unit_price=Decimal('100.00')
        )
        
        url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Insufficient stock', response.data.get('error', ''))
        # Ensure no invoice was created for this cart
        self.assertFalse(Invoice.objects.filter(cart=cart).exists())

    def test_invoice_checkout_duplicate_prevention(self):
        """Test that a pending invoice cannot be checked out twice"""
        cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='pending'
        )
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=1,
            unit_price=Decimal('100.00')
        )
        
        # Create initial pending invoice via cart checkout
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice_id = response.data['id']
        
        # Now checkout the pending invoice
        invoice_url = reverse('invoice-checkout', args=[invoice_id])
        resp1 = self.client.post(invoice_url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(resp1.status_code, status.HTTP_200_OK)
        
        # Try checking it out again
        resp2 = self.client.post(invoice_url, {'invoice_type': 'cash'}, format='json')
        # In our implementation, we return 200 with a message if already paid
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertIn('already checked out', resp2.data.get('message', ''))

    def test_duplicate_checkout_records_audit_log(self):
        """Test that blocked duplicate checkout attempts create an audit log entry"""
        cart = Cart.objects.create(
            cart_number=f'CRT-AUDIT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash',
            status='completed' # Already completed!
        )
        
        url = reverse('cart-checkout', args=[cart.id])
        
        # Initial count of audit logs for this action/object
        initial_count = AuditLog.objects.filter(action='cart_checkout', model_name='Cart', object_id=str(cart.id)).count()
        
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        
        # Should have created one audit log
        final_count = AuditLog.objects.filter(action='cart_checkout', model_name='Cart', object_id=str(cart.id)).count()
        self.assertEqual(final_count, initial_count + 1)
        
        # Verify specific content
        log = AuditLog.objects.filter(action='cart_checkout', model_name='Cart', object_id=str(cart.id)).latest('created_at')
        self.assertEqual(log.object_name, "Blocked Duplicate Checkout")
        self.assertEqual(log.changes.get('reason'), 'Cart already completed')
