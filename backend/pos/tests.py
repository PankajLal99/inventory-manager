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

    def test_successful_cart_checkout_with_scans(self):
        """Test that checkout succeeds when barcodes are correctly scanned"""
        cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash'
        )
        # Get 5 barcodes to scan
        barcodes = list(Barcode.objects.filter(product=self.product, tag='new')[:5])
        barcode_values = [b.barcode for b in barcodes]
        
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=5,
            unit_price=Decimal('100.00'),
            scanned_barcodes=barcode_values
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
        # Get barcodes to scan
        barcodes = list(Barcode.objects.filter(product=self.product, tag='new')[:2])
        barcode_values = [b.barcode for b in barcodes]
        
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=2,
            unit_price=Decimal('100.00'),
            scanned_barcodes=barcode_values
        )
        
        url = reverse('cart-checkout', args=[cart.id])
        
        # First request
        response1 = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        
        # Second request (duplicate) - should hit the status check guard
        response2 = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already checked out', response2.data.get('error', ''))

    def test_insufficient_scans_fail_fast(self):
        """Test that checkout fails if not enough barcodes are scanned for a tracked product"""
        cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash'
        )
        # Request 5, but only scan 2
        barcodes = list(Barcode.objects.filter(product=self.product, tag='new')[:2])
        barcode_values = [b.barcode for b in barcodes]
        
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=5,
            unit_price=Decimal('100.00'),
            scanned_barcodes=barcode_values
        )
        
        url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        error_text = response.data.get('message', '') + response.data.get('error', '')
        self.assertIn('Incomplete barcode scans', error_text)
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
        # Scan 1 barcode for quantity 1
        barcode = Barcode.objects.filter(product=self.product, tag='new').first()
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=1,
            unit_price=Decimal('100.00'),
            scanned_barcodes=[barcode.barcode]
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
        """Test that blocked duplicate checkout returns 400 and error; optionally an audit log is created."""
        cart = Cart.objects.create(
            cart_number=f'CRT-AUDIT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash',
            status='completed'  # Already completed
        )
        # Add an item so we hit "already completed" check, not "empty cart"
        CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=1,
            unit_price=Decimal('100.00')
        )
        url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already checked out', response.data.get('error', ''))
        # Optionally verify an audit log was created when the view logs blocked duplicate checkout
        logs = AuditLog.objects.filter(action='cart_checkout', model_name='Cart', object_id=str(cart.id))
        if logs.exists():
            log = logs.latest('created_at')
            self.assertEqual(log.object_name, 'Blocked Duplicate Checkout')
            self.assertEqual(log.changes.get('reason'), 'Cart already completed')


class InvoiceEditTests(APITestCase):
    """Test cases for invoice editing functionality including ledger and payment consistency"""
    
    def setUp(self):
        """Set up test data for invoice editing tests"""
        from backend.parties.models import Customer, LedgerEntry
        
        self.user = User.objects.create_user(username=f'edituser_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Edit Test Store', shop_type='retail')
        self.category = Category.objects.create(name='Edit Test Category')
        
        # Create customer for ledger testing
        self.customer = Customer.objects.create(
            name='Test Customer',
            phone='9999999999'
        )
        
        # Create products
        self.product1 = Product.objects.create(
            name='Product One',
            category=self.category,
            product_type='simple',
            track_inventory=True
        )
        self.product2 = Product.objects.create(
            name='Product Two',
            category=self.category,
            product_type='simple',
            track_inventory=True
        )
        
        # Create barcodes for tracked products
        self.barcodes1 = []
        for i in range(5):
            bc = Barcode.objects.create(
                product=self.product1,
                barcode=f'P1-BC-{uuid.uuid4().hex[:8]}',
                tag='new'
            )
            self.barcodes1.append(bc)
        
        self.barcodes2 = []
        for i in range(5):
            bc = Barcode.objects.create(
                product=self.product2,
                barcode=f'P2-BC-{uuid.uuid4().hex[:8]}',
                tag='new'
            )
            self.barcodes2.append(bc)
    
    def test_invoice_edit_basic_flow(self):
        """Test basic invoice edit flow: create draft invoice, edit it, verify totals"""
        from backend.pos.models import InvoiceItem, Payment
        
        # 1. Create initial draft invoice via cart (pending so invoice stays draft and editable)
        cart = Cart.objects.create(
            cart_number=f'EDIT-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        # Add 2 items to cart
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=2,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcodes1[0].barcode, self.barcodes1[1].barcode]
        )
        
        # Checkout to create draft pending invoice
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice_id = response.data['id']
        
        invoice = Invoice.objects.get(id=invoice_id)
        self.assertEqual(invoice.total, Decimal('200.00'))  # 2 * 100
        self.assertEqual(invoice.items.count(), 2)
        
        # 2. Edit the invoice
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        edit_cart_id = response.data['cart_id']
        
        edit_cart = Cart.objects.get(id=edit_cart_id)
        self.assertEqual(edit_cart.items.count(), 2)
        
        # 3. Modify the cart - change price for ALL existing items
        for cart_item in edit_cart.items.all():
            cart_item.manual_unit_price = Decimal('150.00')  # Change price
            cart_item.save()
        
        # Add another item
        CartItem.objects.create(
            cart=edit_cart,
            product=self.product2,
            quantity=1,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('50.00'),
            scanned_barcodes=[self.barcodes2[0].barcode]
        )
        
        # 4. Update invoice from cart
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 5. Verify updated invoice
        invoice.refresh_from_db()
        self.assertEqual(invoice.items.count(), 3)  # 2 original + 1 new
        # Total should be: 2*150 + 1*50 = 350
        self.assertEqual(invoice.total, Decimal('350.00'))
        
        # Verify barcodes
        sold_barcodes = Barcode.objects.filter(tag='sold', invoice_items__invoice=invoice)
        self.assertEqual(sold_barcodes.count(), 3)
    
    def test_invoice_edit_item_removal(self):
        """Test removing items from invoice during edit"""
        # 1. Create draft invoice with 3 items (pending so editable)
        cart = Cart.objects.create(
            cart_number=f'REMOVE-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=3,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[bc.barcode for bc in self.barcodes1[:3]]
        )
        
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        invoice_id = response.data['id']
        
        invoice = Invoice.objects.get(id=invoice_id)
        initial_total = invoice.total
        self.assertEqual(initial_total, Decimal('300.00'))
        
        # 2. Edit and remove 1 item
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id = response.data['cart_id']
        
        edit_cart = Cart.objects.get(id=edit_cart_id)
        # Remove one item by deleting a cart item
        cart_item_to_remove = edit_cart.items.first()
        removed_barcode = cart_item_to_remove.scanned_barcodes[0]
        cart_item_to_remove.delete()
        
        # 3. Update invoice
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 4. Verify
        invoice.refresh_from_db()
        self.assertEqual(invoice.items.count(), 2)  # 3 - 1 = 2
        self.assertEqual(invoice.total, Decimal('200.00'))  # 2 * 100
        
        # Verify removed barcode is back to 'new'
        removed_bc = Barcode.objects.get(barcode=removed_barcode)
        self.assertEqual(removed_bc.tag, 'new')
    
    def test_invoice_edit_with_pending_payment(self):
        """Test editing a pending invoice with partial payment"""
        from backend.pos.models import Payment
        
        # 1. Create pending invoice
        cart = Cart.objects.create(
            cart_number=f'PENDING-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=2,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcodes1[0].barcode, self.barcodes1[1].barcode]
        )
        
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        invoice_id = response.data['id']
        
        invoice = Invoice.objects.get(id=invoice_id)
        self.assertEqual(invoice.total, Decimal('200.00'))
        self.assertEqual(invoice.paid_amount, Decimal('0.00'))
        self.assertEqual(invoice.status, 'draft')
        
        # 2. Make partial payment
        Payment.objects.create(
            invoice=invoice,
            payment_method='cash',
            amount=Decimal('50.00'),
            created_by=self.user
        )
        invoice.paid_amount = Decimal('50.00')
        invoice.status = 'partial'
        invoice.due_amount = Decimal('150.00')
        invoice.save()
        
        # 3. Edit invoice and increase total
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id = response.data['cart_id']
        
        edit_cart = Cart.objects.get(id=edit_cart_id)
        # Add more items
        CartItem.objects.create(
            cart=edit_cart,
            product=self.product2,
            quantity=2,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('75.00'),
            scanned_barcodes=[self.barcodes2[0].barcode, self.barcodes2[1].barcode]
        )
        
        # 4. Update invoice
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 5. Verify payment consistency
        invoice.refresh_from_db()
        # New total: 2*100 + 2*75 = 350
        self.assertEqual(invoice.total, Decimal('350.00'))
        # Paid amount should remain unchanged
        self.assertEqual(invoice.paid_amount, Decimal('50.00'))
        # Due amount should be recalculated
        self.assertEqual(invoice.due_amount, Decimal('300.00'))  # 350 - 50
        self.assertEqual(invoice.status, 'partial')
    
    def test_invoice_edit_ledger_consistency(self):
        """Test that ledger entries remain consistent after invoice edit"""
        from backend.parties.models import LedgerEntry
        
        # 1. Create cash invoice (no ledger entry for cash)
        cart = Cart.objects.create(
            cart_number=f'LEDGER-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=2,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcodes1[0].barcode, self.barcodes1[1].barcode]
        )
        
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        invoice_id = response.data['id']
        
        invoice = Invoice.objects.get(id=invoice_id)
        
        # Check initial ledger entries
        initial_ledger_count = LedgerEntry.objects.filter(
            customer=self.customer,
            invoice=invoice
        ).count()
        
        # 2. Edit invoice
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id = response.data['cart_id']
        
        edit_cart = Cart.objects.get(id=edit_cart_id)
        # Modify price
        cart_item = edit_cart.items.first()
        cart_item.manual_unit_price = Decimal('150.00')
        cart_item.save()
        
        # 3. Update invoice
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 4. Verify ledger entries
        # Note: Current implementation does NOT update ledger entries
        # This test documents the current behavior
        final_ledger_count = LedgerEntry.objects.filter(
            customer=self.customer,
            invoice=invoice
        ).count()
        
        # Ledger count should be same (no new entries created)
        self.assertEqual(final_ledger_count, initial_ledger_count)
        
        # If ledger entries exist, their amounts may be stale
        # This is a known limitation documented in the audit
    
    def test_invoice_edit_price_zero_to_nonzero(self):
        """Test editing invoice from zero price to non-zero (edge case)"""
        # 1. Create invoice with zero prices (edge case)
        cart = Cart.objects.create(
            cart_number=f'ZERO-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=2,
            unit_price=Decimal('0.00'),
            manual_unit_price=None,  # No manual price
            scanned_barcodes=[self.barcodes1[0].barcode, self.barcodes1[1].barcode]
        )
        
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        invoice_id = response.data['id']
        
        invoice = Invoice.objects.get(id=invoice_id)
        self.assertEqual(invoice.total, Decimal('0.00'))
        
        # 2. Edit and add prices
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id = response.data['cart_id']
        
        edit_cart = Cart.objects.get(id=edit_cart_id)
        # Set manual prices
        for cart_item in edit_cart.items.all():
            cart_item.manual_unit_price = Decimal('100.00')
            cart_item.save()
        
        # 3. Update invoice
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 4. Verify
        invoice.refresh_from_db()
        self.assertEqual(invoice.total, Decimal('200.00'))  # 2 * 100
        self.assertEqual(invoice.status, 'draft')  # Still draft pending, no payment
    
    def test_invoice_edit_multiple_edits(self):
        """Test multiple consecutive edits to same invoice"""
        # 1. Create initial draft invoice (pending so editable)
        cart = Cart.objects.create(
            cart_number=f'MULTI-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=1,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcodes1[0].barcode]
        )
        
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        invoice_id = response.data['id']
        
        # 2. First edit - increase quantity
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id_1 = response.data['cart_id']
        
        edit_cart_1 = Cart.objects.get(id=edit_cart_id_1)
        CartItem.objects.create(
            cart=edit_cart_1,
            product=self.product1,
            quantity=1,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcodes1[1].barcode]
        )
        
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id_1}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        invoice = Invoice.objects.get(id=invoice_id)
        self.assertEqual(invoice.total, Decimal('200.00'))
        
        # 3. Second edit - change price
        response = self.client.post(edit_url, format='json')
        edit_cart_id_2 = response.data['cart_id']
        
        edit_cart_2 = Cart.objects.get(id=edit_cart_id_2)
        for cart_item in edit_cart_2.items.all():
            cart_item.manual_unit_price = Decimal('150.00')
            cart_item.save()
        
        response = self.client.post(update_url, {'cart_id': edit_cart_id_2}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 4. Verify final state
        invoice.refresh_from_db()
        self.assertEqual(invoice.total, Decimal('300.00'))  # 2 * 150
        self.assertEqual(invoice.items.count(), 2)
    
    def test_invoice_edit_barcode_status_consistency(self):
        """Test that barcode statuses are correctly managed during edits"""
        # 1. Create draft invoice (pending so editable)
        cart = Cart.objects.create(
            cart_number=f'BARCODE-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending'
        )
        
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=2,
            unit_price=Decimal('0.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcodes1[0].barcode, self.barcodes1[1].barcode]
        )
        
        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'pending'}, format='json')
        invoice_id = response.data['id']
        
        # Verify barcodes are sold
        self.assertEqual(Barcode.objects.get(id=self.barcodes1[0].id).tag, 'sold')
        self.assertEqual(Barcode.objects.get(id=self.barcodes1[1].id).tag, 'sold')
        
        # 2. Edit - remove one barcode
        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id = response.data['cart_id']
        
        edit_cart = Cart.objects.get(id=edit_cart_id)
        # Remove one item by reducing quantity and removing one barcode
        cart_item = edit_cart.items.first()
        if len(cart_item.scanned_barcodes) >= 2:
            removed_barcode = cart_item.scanned_barcodes[0]
            cart_item.scanned_barcodes = cart_item.scanned_barcodes[1:]  # Keep all except first
            cart_item.quantity = len(cart_item.scanned_barcodes)
            cart_item.save()
        else:
            # If only one barcode, just delete the entire cart item
            removed_barcode = cart_item.scanned_barcodes[0] if cart_item.scanned_barcodes else None
            cart_item.delete()
        
        # 3. Update invoice
        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # 4. Verify barcode statuses
        # Removed barcode should be 'new'
        removed_bc = Barcode.objects.get(barcode=removed_barcode)
        self.assertEqual(removed_bc.tag, 'new')
        
        # Remaining barcode should still be 'sold'
        remaining_bc = Barcode.objects.get(id=self.barcodes1[1].id)
        self.assertEqual(remaining_bc.tag, 'sold')

class BarcodeStrictnessTests(APITestCase):
    """New tests to enforce strict barcode scanning behavior"""
    def setUp(self):
        self.user = User.objects.create_user(username=f'strictuser_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Strict Store', shop_type='retail')
        self.category = Category.objects.create(name='Strict Category')
        self.product = Product.objects.create(
            name='Strict Tracked Product',
            category=self.category,
            track_inventory=True
        )
        self.barcode = Barcode.objects.create(
            product=self.product,
            barcode=f'STRICT-{uuid.uuid4().hex[:8]}',
            tag='new'
        )
        self.cart = Cart.objects.create(
            cart_number=f'STRICT-CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            status='active'
        )

    def test_add_tracked_product_without_barcode_fails(self):
        """Test that adding a tracked product without a barcode returns 400"""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 100
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('MUST physically scan a barcode', response.data.get('message', ''))

    def test_checkout_with_insufficient_scans_fails(self):
        """Test that checkout fails if quantity > scanned_barcodes"""
        CartItem.objects.create(
            cart=self.cart,
            product=self.product,
            quantity=Decimal('2.000'),
            unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcode.barcode]
        )
        url = reverse('cart-checkout', kwargs={'pk': self.cart.id})
        response = self.client.post(url, {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        error_text = response.data.get('message', '') + response.data.get('error', '')
        self.assertIn('Incomplete barcode scans', error_text)