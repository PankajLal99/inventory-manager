from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.utils import timezone
from decimal import Decimal
import uuid
from backend.catalog.models import Product, Barcode, Category
from backend.locations.models import Store
from backend.parties.models import Supplier, Customer
from backend.purchasing.models import Purchase, PurchaseItem
from backend.pos.models import Cart, CartItem, Invoice, InvoiceItem
from backend.core.models import AuditLog
from backend.inventory.models import Stock
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group

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
        self.assertIn('Inventory Mismatch', error_text)
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

    def test_increment_tracked_product_fails(self):
        """Test that manually incrementing a tracked product returns 400 (scanning required)"""
        # Create a cart item first via scanning (valid state)
        item = CartItem.objects.create(
            cart=self.cart,
            product=self.product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcode.barcode]
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        response = self.client.patch(url, {'action': 'increment'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('requires active scanning', response.data.get('message', ''))

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
        self.assertIn('Inventory Mismatch', error_text)

    def test_increment_untracked_product_succeeds(self):
        """Test that manually incrementing a non-tracked product succeeds"""
        untracked_product = Product.objects.create(
            name='Untracked Product',
            category=self.category,
            track_inventory=False
        )
        Stock.objects.create(product=untracked_product, store=self.store, quantity=Decimal('10.000'))
        
        item = CartItem.objects.create(
            cart=self.cart,
            product=untracked_product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            scanned_barcodes=[]
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        response = self.client.patch(url, {'action': 'increment'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertEqual(item.quantity, Decimal('2.000'))

    def test_untracked_product_checkout_succeeds(self):
        """Test that checkout succeeds for non-tracked products without barcodes"""
        untracked_product = Product.objects.create(
            name='Service Item',
            category=self.category,
            track_inventory=False
        )
        Barcode.objects.create(product=untracked_product, barcode='SERV-001', tag='new') # Need at least one barcode for price fallback logic
        
        CartItem.objects.create(
            cart=self.cart,
            product=untracked_product,
            quantity=Decimal('5.000'),
            unit_price=Decimal('500.00'),
            scanned_barcodes=[]
        )
        url = reverse('cart-checkout', kwargs={'pk': self.cart.id})
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice = Invoice.objects.get(id=response.data['id'])
        self.assertEqual(invoice.items.count(), 1)
        self.assertEqual(invoice.items.first().quantity, Decimal('5.000'))
        self.assertIsNone(invoice.items.first().barcode)

    def test_mixed_checkout_integrity(self):
        """Test that checkout correctly handles both tracked and non-tracked items in one cart"""
        # 1. Tracked product (scanned)
        CartItem.objects.create(
            cart=self.cart,
            product=self.product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            scanned_barcodes=[self.barcode.barcode]
        )
        # 2. Non-tracked product (no barcode)
        untracked = Product.objects.create(name='Untracked', track_inventory=False)
        Barcode.objects.create(product=untracked, barcode='UNTR-001', tag='new')
        CartItem.objects.create(
            cart=self.cart,
            product=untracked,
            quantity=Decimal('10.000'),
            unit_price=Decimal('5.00'),
            scanned_barcodes=[]
        )
        
        url = reverse('cart-checkout', kwargs={'pk': self.cart.id})
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice = Invoice.objects.get(id=response.data['id'])
        
        # Tracked item should create 1 InvoiceItem with barcode
        # Non-tracked item should create 1 InvoiceItem with qty 10
        self.assertEqual(invoice.items.count(), 2)
        
        tracked_ii = invoice.items.get(product=self.product)
        self.assertEqual(tracked_ii.barcode, self.barcode)
        self.assertEqual(tracked_ii.barcode.tag, 'sold')
        
        untracked_ii = invoice.items.get(product=untracked)
        self.assertEqual(untracked_ii.quantity, Decimal('10.000'))
        self.assertIsNone(untracked_ii.barcode)

class RaceConditionTests(APITestCase):
    """Tests for concurrent requests and integrity"""
    def setUp(self):
        self.user = User.objects.create_user(username=f'raceuser_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Race Store', shop_type='retail')
        self.category = Category.objects.create(name='Race Category')
        self.product = Product.objects.create(
            name='Race Product',
            category=self.category,
            track_inventory=True
        )
        self.barcode = Barcode.objects.create(product=self.product, barcode='RACE-001', tag='new')
        self.cart = Cart.objects.create(
            cart_number='RACE-CART',
            store=self.store,
            created_by=self.user,
            status='active'
        )
        CartItem.objects.create(
            cart=self.cart, product=self.product, quantity=1,
            unit_price=100, scanned_barcodes=['RACE-001']
        )

    def test_simulated_dual_checkout_integrity(self):
        """
        Since we can't easily multithread APITestCase in real-time without complex infra,
        we verify that the 'status' guard and transaction logic works if status is updated.
        """
        url = reverse('cart-checkout', kwargs={'pk': self.cart.id})
        
        # 1. First checkout succeeds
        response1 = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        
        # 2. Second checkout immediately after should fail with 400 (guarded by status check + lock)
        response2 = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already checked out', response2.data.get('error', ''))
class WholesaleCartTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='wholesale_user', password='password')
        self.wholesale_group, _ = Group.objects.get_or_create(name='Wholesale')
        self.user.groups.add(self.wholesale_group)
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Wholesale Store', shop_type='retail')

    def test_wholesale_cart_default_invoice_type(self):
        """Test that carts created by wholesale users default to 'pending' invoice type"""
        url = reverse('cart-list-create')
        data = {'store': self.store.id}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['invoice_type'], 'pending')

    def test_wholesale_cart_explicit_override(self):
        """Test that explicit invoice type in request is respected even for wholesale users"""
        url = reverse('cart-list-create')
        data = {'store': self.store.id, 'invoice_type': 'cash'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['invoice_type'], 'cash')


class CartBarcodeConsistencyTests(APITestCase):
    """Ensure the barcode scanned and the barcode stored in cart are consistent (concrete logic)."""

    def setUp(self):
        self.user = User.objects.create_user(username=f'barcodeuser_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Barcode Store', shop_type='retail')
        self.category = Category.objects.create(name='Barcode Category')
        self.supplier = Supplier.objects.create(name='Test Supplier', code='SUP1')
        self.product = Product.objects.create(
            name='Barcode Test Product',
            category=self.category,
            product_type='simple',
            track_inventory=True,
        )
        # Create a finalized purchase and purchase item so barcode can be added to cart
        self.purchase = Purchase.objects.create(
            purchase_number=f'PUR-{uuid.uuid4().hex[:8]}',
            supplier=self.supplier,
            purchase_date=timezone.now().date(),
            store=self.store,
            status='finalized',
            created_by=self.user,
        )
        self.purchase_item = PurchaseItem.objects.create(
            purchase=self.purchase,
            product=self.product,
            quantity=Decimal('5.000'),
            unit_price=Decimal('100.00'),
            shop_quantity=Decimal('5.000'),
            warehouse_quantity=Decimal('0.000'),
        )
        # Full barcode (canonical) - uppercase so it matches API's standardized .upper() lookup
        self.full_barcode = f'BC-FULL-{uuid.uuid4().hex[:8]}'.upper()
        self.barcode = Barcode.objects.create(
            product=self.product,
            barcode=self.full_barcode,
            short_code=None,
            tag='new',
            purchase_item=self.purchase_item,
        )
        self.cart = Cart.objects.create(
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            status='active',
            invoice_type='cash',
        )

    def test_add_by_full_barcode_stores_same_barcode_in_cart(self):
        """When adding by full barcode, cart item scanned_barcodes must contain exactly that barcode."""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': Decimal('100.00'),
            'barcode': self.full_barcode,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertIn('scanned_barcodes', response.data)
        stored = response.data['scanned_barcodes']
        self.assertIsInstance(stored, list)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0], self.full_barcode, 'Cart must store the same barcode that was sent (scanned).')

        # Verify in DB
        cart_item = CartItem.objects.get(cart=self.cart, product=self.product)
        self.assertEqual(cart_item.scanned_barcodes, [self.full_barcode])

    def test_add_by_short_code_stores_canonical_barcode_in_cart(self):
        """When adding by short_code, cart item scanned_barcodes must contain canonical (full) barcode, not short_code."""
        short_code = f'SC-{uuid.uuid4().hex[:6]}'.upper()
        self.barcode.short_code = short_code
        self.barcode.save(update_fields=['short_code'])

        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': Decimal('100.00'),
            'barcode': short_code,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertIn('scanned_barcodes', response.data)
        stored = response.data['scanned_barcodes']
        self.assertIsInstance(stored, list)
        self.assertEqual(len(stored), 1)
        self.assertEqual(
            stored[0],
            self.full_barcode,
            'Cart must store canonical (full) barcode when user scans short_code, so scan and stored are consistent.',
        )
        self.assertNotEqual(
            stored[0],
            short_code,
            'Cart must not store short_code; it must store the canonical barcode.',
        )

        cart_item = CartItem.objects.get(cart=self.cart, product=self.product)
        self.assertEqual(cart_item.scanned_barcodes, [self.full_barcode])

    def test_cart_item_serializer_includes_scanned_barcodes_display(self):
        """Cart item API includes scanned_barcodes_display (short_code or barcode) for UI."""
        self.barcode.short_code = 'SC-DISPLAY'
        self.barcode.save(update_fields=['short_code'])
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': Decimal('100.00'),
            'barcode': self.full_barcode,
        }
        self.client.post(url, data, format='json')
        cart_url = reverse('cart-detail', kwargs={'pk': self.cart.id})
        resp = self.client.get(cart_url)
        self.assertEqual(resp.status_code, 200)
        items = resp.data.get('items', [])
        self.assertGreater(len(items), 0)
        item = items[0]
        self.assertIn('scanned_barcodes', item)
        self.assertIn('scanned_barcodes_display', item)
        self.assertEqual(item['scanned_barcodes'], [self.full_barcode])
        self.assertEqual(item['scanned_barcodes_display'], ['SC-DISPLAY'])

    def test_invoice_item_barcode_value_prefers_short_code_for_display(self):
        """Invoice item API barcode_value returns short_code when available (for UI display)."""
        self.barcode.short_code = 'SC-INV'
        self.barcode.save(update_fields=['short_code'])
        customer = Customer.objects.create(name='Cust Display', phone='9999999999')
        inv = Invoice.objects.create(
            invoice_number='INV-DISP',
            store=self.store,
            customer=customer,
            status='paid',
            invoice_type='cash',
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            paid_amount=Decimal('100.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=inv,
            product=self.product,
            barcode=self.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('100.00'),
        )
        inv_url = reverse('invoice-detail', kwargs={'pk': inv.id})
        resp = self.client.get(inv_url)
        self.assertEqual(resp.status_code, 200)
        items = resp.data.get('items', [])
        self.assertGreater(len(items), 0)
        self.assertEqual(items[0]['barcode_value'], 'SC-INV')


class BulkBarcodesCheckTests(APITestCase):
    """Tests for bulk barcodes check (replacement credit note): all barcode types and skip cases."""

    def setUp(self):
        self.user = User.objects.create_user(username=f'bulkuser_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Bulk Store', shop_type='retail')
        self.category = Category.objects.create(name='Bulk Category')
        self.product = Product.objects.create(
            name='Bulk Product',
            category=self.category,
            product_type='simple',
            track_inventory=True,
        )
        self.customer_a = Customer.objects.create(name='Customer A', phone='1111111111')
        self.customer_b = Customer.objects.create(name='Customer B', phone='2222222222')

        # Helper to create a completed invoice (paid, cash) with one item for a barcode (uppercase for .upper() lookup)
        def make_invoice(inv_number, customer, barcode, barcode_tag='sold'):
            b = Barcode.objects.create(
                product=self.product,
                barcode=f'BC-{inv_number}-{uuid.uuid4().hex[:6]}'.upper(),
                short_code=f'SC-{inv_number}'.upper() if inv_number else None,
                tag=barcode_tag,
            )
            inv = Invoice.objects.create(
                invoice_number=inv_number or f'INV-{uuid.uuid4().hex[:8]}',
                store=self.store,
                customer=customer,
                status='paid',
                invoice_type='cash',
                subtotal=Decimal('100.00'),
                total=Decimal('100.00'),
                paid_amount=Decimal('100.00'),
                due_amount=Decimal('0.00'),
                created_by=self.user,
            )
            InvoiceItem.objects.create(
                invoice=inv,
                product=self.product,
                barcode=b,
                quantity=Decimal('1.000'),
                unit_price=Decimal('100.00'),
                line_total=Decimal('100.00'),
            )
            return b

        # Sold to customer A (processable)
        self.sold_a1 = make_invoice('INV-BULK-A1', self.customer_a, None, 'sold')
        self.sold_a2 = make_invoice('INV-BULK-A2', self.customer_a, None, 'sold')
        # Sold to customer B (different_customer when mixed with A)
        self.sold_b1 = make_invoice('INV-BULK-B1', self.customer_b, None, 'sold')
        # Not sold: on completed invoice but tag new/returned/defective/unknown/in-cart
        self.barcode_new = make_invoice('INV-BULK-NEW', self.customer_a, None, 'new')
        self.barcode_returned = make_invoice('INV-BULK-RET', self.customer_a, None, 'returned')
        self.barcode_defective = make_invoice('INV-BULK-DEF', self.customer_a, None, 'defective')
        self.barcode_unknown = make_invoice('INV-BULK-UNK', self.customer_a, None, 'unknown')
        self.barcode_incart = make_invoice('INV-BULK-CART', self.customer_a, None, 'in-cart')

        # One with short_code for lookup test
        self.barcode_sold_short = Barcode.objects.create(
            product=self.product,
            barcode='LONG-BARCODE-WITH-SHORT',
            short_code='SHORT-001',
            tag='sold',
        )
        inv_short = Invoice.objects.create(
            invoice_number='INV-BULK-SHORT',
            store=self.store,
            customer=self.customer_a,
            status='paid',
            invoice_type='cash',
            subtotal=Decimal('50.00'),
            total=Decimal('50.00'),
            paid_amount=Decimal('50.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=inv_short,
            product=self.product,
            barcode=self.barcode_sold_short,
            quantity=Decimal('1.000'),
            unit_price=Decimal('50.00'),
            line_total=Decimal('50.00'),
        )

    def _url(self):
        return reverse('bulk-barcodes-check')

    def test_barcodes_required(self):
        """Missing barcodes key returns 400."""
        response = self.client.post(self._url(), {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('barcodes', response.data.get('error', ''))

    def test_empty_barcodes_list(self):
        """Empty list returns valid=False, error no_barcodes."""
        response = self.client.post(self._url(), {'barcodes': []}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['valid'])
        self.assertEqual(response.data.get('error'), 'no_barcodes')

    def test_barcodes_string_input(self):
        """Accept string input: split by newlines and spaces."""
        response = self.client.post(
            self._url(),
            {'barcodes': f'{self.sold_a1.barcode}\n{self.sold_a2.barcode}  {self.sold_a1.barcode}'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        # Dedupe: sold_a1 twice + sold_a2 -> 2 processable
        self.assertEqual(len(response.data['processable']), 2)
        self.assertEqual(len(response.data['skipped']), 0)

    def test_not_found_skipped(self):
        """Barcode that does not exist on any invoice item is skipped as not_found."""
        response = self.client.post(
            self._url(),
            {'barcodes': [self.sold_a1.barcode, 'DOES-NOT-EXIST-ANYWHERE', self.sold_a2.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 2)
        self.assertEqual(len(response.data['skipped']), 1)
        skip = response.data['skipped'][0]
        self.assertEqual(skip['barcode'], 'DOES-NOT-EXIST-ANYWHERE')
        self.assertEqual(skip['reason'], 'not_found')

    def test_not_sold_tags_skipped(self):
        """Barcodes with tag new, returned, defective, unknown, in-cart are skipped as not_sold."""
        barcodes = [
            self.barcode_new.barcode,
            self.barcode_returned.barcode,
            self.barcode_defective.barcode,
            self.barcode_unknown.barcode,
            self.barcode_incart.barcode,
        ]
        response = self.client.post(self._url(), {'barcodes': barcodes}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 0)
        self.assertEqual(len(response.data['skipped']), 5)
        reasons = {s['reason'] for s in response.data['skipped']}
        self.assertEqual(reasons, {'not_sold'})

    def test_all_sold_single_customer_processable(self):
        """All barcodes sold and same customer -> valid, all processable, none skipped."""
        response = self.client.post(
            self._url(),
            {'barcodes': [self.sold_a1.barcode, self.sold_a2.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 2)
        self.assertEqual(len(response.data['skipped']), 0)
        self.assertEqual(len(response.data['customers']), 1)
        self.assertEqual(response.data['customers'][0]['name'], 'Customer A')

    def test_sold_two_customers_largest_group_processable(self):
        """Sold barcodes from two customers -> largest group processable, rest skipped as different_customer."""
        # A has 2, B has 1 -> A is chosen
        response = self.client.post(
            self._url(),
            {'barcodes': [self.sold_a1.barcode, self.sold_a2.barcode, self.sold_b1.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 2)
        processable_barcodes = {p['barcode'] for p in response.data['processable']}
        self.assertEqual(processable_barcodes, {self.sold_a1.barcode, self.sold_a2.barcode})
        self.assertEqual(len(response.data['skipped']), 1)
        self.assertEqual(response.data['skipped'][0]['barcode'], self.sold_b1.barcode)
        self.assertEqual(response.data['skipped'][0]['reason'], 'different_customer')

    def test_sold_two_customers_tie_picks_one_group(self):
        """When two customers have same count, one group is chosen (deterministic by id)."""
        sold_b2 = Barcode.objects.create(
            product=self.product,
            barcode=f'BC-B2-{uuid.uuid4().hex[:6]}',
            tag='sold',
        )
        inv_b2 = Invoice.objects.create(
            invoice_number=f'INV-B2-{uuid.uuid4().hex[:6]}',
            store=self.store,
            customer=self.customer_b,
            status='paid',
            invoice_type='cash',
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            paid_amount=Decimal('100.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=inv_b2,
            product=self.product,
            barcode=sold_b2,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('100.00'),
        )
        response = self.client.post(
            self._url(),
            {'barcodes': [self.sold_a1.barcode, self.sold_b1.barcode, sold_b2.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 2)  # one customer has 2
        self.assertEqual(len(response.data['skipped']), 1)

    def test_mixed_not_found_not_sold_sold_same_customer(self):
        """Mix: not_found, not_sold, and sold same customer -> processable = sold, skipped = rest."""
        response = self.client.post(
            self._url(),
            {
                'barcodes': [
                    'NOT-FOUND',
                    self.barcode_new.barcode,
                    self.sold_a1.barcode,
                    self.sold_a2.barcode,
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 2)
        self.assertEqual(len(response.data['skipped']), 2)
        reasons = {s['reason'] for s in response.data['skipped']}
        self.assertIn('not_found', reasons)
        self.assertIn('not_sold', reasons)

    def test_lookup_by_short_code(self):
        """Barcode can be resolved by short_code when provided in input."""
        response = self.client.post(
            self._url(),
            {'barcodes': ['SHORT-001']},  # short_code of barcode_sold_short
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 1)
        self.assertEqual(response.data['processable'][0]['barcode'], 'SHORT-001')
        self.assertEqual(response.data['processable'][0]['invoice_number'], 'INV-BULK-SHORT')

    def test_draft_invoice_excluded(self):
        """Barcodes on draft or pending invoice are not found (excluded from qs)."""
        b_draft = Barcode.objects.create(
            product=self.product,
            barcode=f'BC-DRAFT-{uuid.uuid4().hex[:6]}',
            tag='sold',
        )
        inv_draft = Invoice.objects.create(
            invoice_number=f'INV-DRAFT-{uuid.uuid4().hex[:6]}',
            store=self.store,
            customer=self.customer_a,
            status='draft',
            invoice_type='cash',
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            paid_amount=Decimal('0.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=inv_draft,
            product=self.product,
            barcode=b_draft,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('100.00'),
        )
        response = self.client.post(
            self._url(),
            {'barcodes': [b_draft.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 0)
        self.assertEqual(len(response.data['skipped']), 1)
        self.assertEqual(response.data['skipped'][0]['reason'], 'not_found')

    def test_void_invoice_excluded(self):
        """Barcodes on void invoice are not found."""
        b_void = Barcode.objects.create(
            product=self.product,
            barcode=f'BC-VOID-{uuid.uuid4().hex[:6]}',
            tag='sold',
        )
        inv_void = Invoice.objects.create(
            invoice_number=f'INV-VOID-{uuid.uuid4().hex[:6]}',
            store=self.store,
            customer=self.customer_a,
            status='void',
            invoice_type='cash',
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            paid_amount=Decimal('100.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=inv_void,
            product=self.product,
            barcode=b_void,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('100.00'),
        )
        response = self.client.post(
            self._url(),
            {'barcodes': [b_void.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['valid'])
        self.assertEqual(len(response.data['skipped']), 1)
        self.assertEqual(response.data['skipped'][0]['reason'], 'not_found')


class CustomProductAndPurchasePriceTests(APITestCase):
    """Tests for custom/other product, CartItem/InvoiceItem purchase_price, and manual_unit_price vs purchase_price validation (can_go_below_purchase_price)."""

    def setUp(self):
        self.user = User.objects.create_user(username=f'custom_{uuid.uuid4().hex[:6]}', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Custom Test Store', shop_type='retail')
        self.category = Category.objects.create(name='Custom Category')
        self.cart = Cart.objects.create(
            cart_number=f'CRT-CUST-{uuid.uuid4().hex[:8]}',
            store=self.store,
            created_by=self.user,
            invoice_type='cash',
            status='active',
        )

    def test_add_custom_product_without_purchase_price_succeeds(self):
        """Adding custom product without purchase_price is allowed; user can set it inline later."""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'custom_product_name': 'Misc Item',
            'quantity': 1,
            'unit_price': 0,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        item = CartItem.objects.get(cart=self.cart, product__name='Other - Misc Item')
        self.assertIsNone(item.purchase_price)
        self.assertEqual(item.unit_price, Decimal('0.00'))

    def test_add_custom_product_with_purchase_price_succeeds(self):
        """Adding custom product with purchase_price stores it and sets unit_price to cost."""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'custom_product_name': 'Widget X',
            'quantity': 1,
            'unit_price': 0,
            'purchase_price': 50.99,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        item = CartItem.objects.get(cart=self.cart, product__name='Other - Widget X')
        self.assertEqual(item.purchase_price, Decimal('50.99'))
        self.assertEqual(item.unit_price, Decimal('50.99'))
        self.assertEqual(response.data.get('product_purchase_price'), 50.99)

    def test_add_custom_product_negative_purchase_price_rejected(self):
        """Purchase price cannot be negative."""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'custom_product_name': 'Bad',
            'quantity': 1,
            'purchase_price': -10,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('negative', response.data.get('error', '').lower())

    def test_add_custom_product_invalid_purchase_price_rejected(self):
        """Non-numeric purchase_price is rejected when provided."""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        data = {
            'custom_product_name': 'Bad',
            'quantity': 1,
            'purchase_price': 'not a number',
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_cart_item_purchase_price_succeeds(self):
        """Updating cart item purchase_price via PATCH (e.g. inline cost entry) succeeds."""
        prod = Product.objects.create(
            name='Other - Inline Cost',
            sku=f'SKU-{uuid.uuid4().hex[:8]}',
            category=self.category,
            track_inventory=False,
            can_go_below_purchase_price=True,
        )
        item = CartItem.objects.create(
            cart=self.cart,
            product=prod,
            quantity=Decimal('1.000'),
            unit_price=Decimal('0.00'),
            purchase_price=None,
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        response = self.client.patch(url, {'purchase_price': 25.50}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertEqual(item.purchase_price, Decimal('25.50'))

    def test_manual_unit_price_below_purchase_price_rejected_when_can_go_below_false(self):
        """When can_go_below_purchase_price is False, manual_unit_price cannot be less than purchase_price."""
        prod = Product.objects.create(
            name='Other - Strict Product',
            sku=f'SKU-{uuid.uuid4().hex[:8]}',
            category=self.category,
            track_inventory=False,
            can_go_below_purchase_price=False,
        )
        item = CartItem.objects.create(
            cart=self.cart,
            product=prod,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            purchase_price=Decimal('100.00'),
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        response = self.client.patch(url, {'manual_unit_price': 80}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('cannot be less than', response.data.get('error', ''))

    def test_manual_unit_price_below_purchase_price_allowed_when_can_go_below_true(self):
        """When can_go_below_purchase_price is True, manual_unit_price can be less than purchase_price."""
        prod = Product.objects.create(
            name='Other - Flexible',
            sku=f'SKU-{uuid.uuid4().hex[:8]}',
            category=self.category,
            track_inventory=False,
            can_go_below_purchase_price=True,
        )
        item = CartItem.objects.create(
            cart=self.cart,
            product=prod,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            purchase_price=Decimal('100.00'),
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        response = self.client.patch(url, {'manual_unit_price': 80}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item.refresh_from_db()
        self.assertEqual(item.manual_unit_price, Decimal('80.00'))

    def test_custom_product_purchase_price_used_in_validation(self):
        """For custom product (Other - X), cart item purchase_price is used when validating manual_unit_price."""
        prod = Product.objects.create(
            name='Other - Custom Cost',
            sku=f'SKU-{uuid.uuid4().hex[:8]}',
            category=self.category,
            track_inventory=False,
            can_go_below_purchase_price=False,
        )
        item = CartItem.objects.create(
            cart=self.cart,
            product=prod,
            quantity=Decimal('1.000'),
            unit_price=Decimal('40.00'),
            purchase_price=Decimal('40.00'),
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        # 50 >= 40: allowed
        response = self.client.patch(url, {'manual_unit_price': 50}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # 30 < 40: rejected
        response2 = self.client.patch(url, {'manual_unit_price': 30}, format='json')
        self.assertEqual(response2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_checkout_copies_purchase_price_to_invoice_item_for_custom(self):
        """Checkout copies CartItem.purchase_price to InvoiceItem for custom/non-tracked items."""
        prod = Product.objects.create(
            name='Other - For Invoice',
            sku=f'SKU-{uuid.uuid4().hex[:8]}',
            category=self.category,
            track_inventory=False,
            can_go_below_purchase_price=True,
        )
        CartItem.objects.create(
            cart=self.cart,
            product=prod,
            quantity=Decimal('2.000'),
            unit_price=Decimal('25.00'),
            manual_unit_price=Decimal('35.00'),
            purchase_price=Decimal('25.00'),
        )
        url = reverse('cart-checkout', kwargs={'pk': self.cart.id})
        response = self.client.post(url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice = Invoice.objects.get(id=response.data['id'])
        inv_item = invoice.items.get(product=prod)
        self.assertEqual(inv_item.purchase_price, Decimal('25.00'))
        self.assertEqual(inv_item.manual_unit_price, Decimal('35.00'))
        self.assertEqual(inv_item.line_total, Decimal('70.00'))  # 2 * 35

    def test_add_custom_product_same_name_increments_quantity(self):
        """Adding same custom product name again increments quantity, does not create duplicate line."""
        url = reverse('cart-items', kwargs={'pk': self.cart.id})
        for _ in range(2):
            response = self.client.post(url, {
                'custom_product_name': 'Same Item',
                'quantity': 1,
                'unit_price': 0,
            }, format='json')
            self.assertEqual(response.status_code, status.HTTP_200_OK if _ == 1 else status.HTTP_201_CREATED)
        self.assertEqual(CartItem.objects.filter(cart=self.cart, product__name='Other - Same Item').count(), 1)
        item = CartItem.objects.get(cart=self.cart, product__name='Other - Same Item')
        self.assertEqual(item.quantity, Decimal('2.000'))

    def test_pending_invoice_accepts_manual_price_below_purchase(self):
        """For pending invoice type, price validation (below purchase) is not applied."""
        self.cart.invoice_type = 'pending'
        self.cart.save()
        prod = Product.objects.create(
            name='Other - Pending',
            sku=f'SKU-{uuid.uuid4().hex[:8]}',
            category=self.category,
            track_inventory=False,
            can_go_below_purchase_price=False,
        )
        item = CartItem.objects.create(
            cart=self.cart,
            product=prod,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            purchase_price=Decimal('100.00'),
        )
        url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item.id})
        response = self.client.patch(url, {'manual_unit_price': 50}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
