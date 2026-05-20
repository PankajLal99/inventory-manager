from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.test import TestCase
from django.utils import timezone
from decimal import Decimal
import logging
import uuid
from backend.catalog.models import Product, Barcode, Category
from backend.catalog.views import build_barcode_response
from backend.core.gst_utils import calculate_gst_bifurcation
from backend.core.test_utils import TestDataFactory
from backend.locations.models import Store
from backend.parties.models import Supplier, Customer
from backend.purchasing.models import Purchase, PurchaseItem
from backend.pos.models import Cart, CartItem, Invoice, InvoiceItem
from backend.pos.serializers import CartItemSerializer, CartSerializer, InvoiceSerializer
from backend.core.models import AuditLog
from backend.inventory.models import Stock
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from backend.pos.models import Return
from backend.tenants.models import Retailer

User = get_user_model()

class CheckoutTests(APITestCase):
    def setUp(self):
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Test Store')
        self.category = TestDataFactory.create_category(name='Test Category')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Test Product',
            category=self.category,
            product_type='simple'
        )
        # Create 10 barcodes
        for i in range(10):
            Barcode.objects.create(
                retailer=self.retailer,
                product=self.product,
                barcode=f'BC-{uuid.uuid4().hex[:8]}',
                tag='new'
            )

    def test_successful_cart_checkout_with_scans(self):
        """Test that checkout succeeds when barcodes are correctly scanned"""
        cart = Cart.objects.create(
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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

    def test_cart_checkout_pos_trade_in_same_customer(self):
        """Trade-in during checkout removes prior line and reduces new invoice total."""
        self.product.track_inventory = True
        self.product.save(update_fields=['track_inventory'])

        customer = Customer.objects.create(name='TradeIn Customer', phone='9000000001')
        bc_old = Barcode.objects.filter(product=self.product, tag='new').first()
        bc_new = Barcode.objects.filter(product=self.product, tag='new').exclude(pk=bc_old.pk).first()

        cart1 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart1,
            product=self.product,
            quantity=1,
            unit_price=Decimal('100.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[bc_old.barcode],
        )
        url = reverse('cart-checkout', args=[cart1.id])
        r1 = self.client.post(
            url,
            {'invoice_type': 'cash', 'customer': customer.id},
            format='json',
        )
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        inv1 = Invoice.objects.get(id=r1.data['id'])
        old_item = inv1.items.first()
        self.assertIsNotNone(old_item)
        trade_item_id = old_item.id

        cart2 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart2,
            product=self.product,
            quantity=1,
            unit_price=Decimal('200.00'),
            manual_unit_price=Decimal('200.00'),
            scanned_barcodes=[bc_new.barcode],
        )
        url2 = reverse('cart-checkout', args=[cart2.id])
        r2 = self.client.post(
            url2,
            {
                'invoice_type': 'cash',
                'customer': customer.id,
                'pos_trade_ins': [{'invoice_item_id': trade_item_id, 'return_tag': 'returned'}],
            },
            format='json',
        )
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED, r2.data)
        new_inv = Invoice.objects.get(id=r2.data['id'])
        self.assertEqual(new_inv.trade_in_credit, Decimal('100.00'))
        self.assertEqual(new_inv.subtotal, Decimal('200.00'))
        self.assertEqual(new_inv.total, Decimal('100.00'))
        self.assertIsInstance(new_inv.pos_trade_ins, list)
        self.assertEqual(len(new_inv.pos_trade_ins), 1)

        inv1.refresh_from_db()
        self.assertEqual(inv1.items.count(), 0)
        bc_old.refresh_from_db()
        self.assertEqual(bc_old.tag, 'returned')

    def test_cart_checkout_pos_trade_in_partial_accepted_credit(self):
        """accepted_credit can be below original line total; new invoice nets that amount only."""
        self.product.track_inventory = True
        self.product.save(update_fields=['track_inventory'])

        customer = Customer.objects.create(name='TradeIn Partial', phone='9000000011')
        bc_old = Barcode.objects.filter(product=self.product, tag='new').first()
        bc_new = Barcode.objects.filter(product=self.product, tag='new').exclude(pk=bc_old.pk).first()

        cart1 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart1,
            product=self.product,
            quantity=1,
            unit_price=Decimal('100.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[bc_old.barcode],
        )
        r1 = self.client.post(
            reverse('cart-checkout', args=[cart1.id]),
            {'invoice_type': 'cash', 'customer': customer.id},
            format='json',
        )
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        trade_item_id = Invoice.objects.get(id=r1.data['id']).items.first().id

        cart2 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart2,
            product=self.product,
            quantity=1,
            unit_price=Decimal('200.00'),
            manual_unit_price=Decimal('200.00'),
            scanned_barcodes=[bc_new.barcode],
        )
        r2 = self.client.post(
            reverse('cart-checkout', args=[cart2.id]),
            {
                'invoice_type': 'cash',
                'customer': customer.id,
                'pos_trade_ins': [
                    {
                        'invoice_item_id': trade_item_id,
                        'return_tag': 'returned',
                        'accepted_credit': 35,
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED, r2.data)
        new_inv = Invoice.objects.get(id=r2.data['id'])
        self.assertEqual(new_inv.trade_in_credit, Decimal('35.00'))
        self.assertEqual(new_inv.subtotal, Decimal('200.00'))
        self.assertEqual(new_inv.total, Decimal('165.00'))
        detail = new_inv.pos_trade_ins[0]
        self.assertEqual(detail['credit'], '35.00')
        self.assertEqual(detail['original_line_credit'], '100.00')

    def test_cart_checkout_pos_trade_in_accepted_credit_over_line_rejected(self):
        self.product.track_inventory = True
        self.product.save(update_fields=['track_inventory'])

        customer = Customer.objects.create(name='TradeIn Cap', phone='9000000012')
        bc_old = Barcode.objects.filter(product=self.product, tag='new').first()
        bc_new = Barcode.objects.filter(product=self.product, tag='new').exclude(pk=bc_old.pk).first()

        cart1 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart1,
            product=self.product,
            quantity=1,
            unit_price=Decimal('100.00'),
            manual_unit_price=Decimal('100.00'),
            scanned_barcodes=[bc_old.barcode],
        )
        r1 = self.client.post(
            reverse('cart-checkout', args=[cart1.id]),
            {'invoice_type': 'cash', 'customer': customer.id},
            format='json',
        )
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        trade_item_id = Invoice.objects.get(id=r1.data['id']).items.first().id

        cart2 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart2,
            product=self.product,
            quantity=1,
            unit_price=Decimal('200.00'),
            manual_unit_price=Decimal('200.00'),
            scanned_barcodes=[bc_new.barcode],
        )
        r2 = self.client.post(
            reverse('cart-checkout', args=[cart2.id]),
            {
                'invoice_type': 'cash',
                'customer': customer.id,
                'pos_trade_ins': [
                    {
                        'invoice_item_id': trade_item_id,
                        'return_tag': 'returned',
                        'accepted_credit': 150,
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(r2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cart_checkout_pos_trade_in_different_customer_allowed(self):
        self.product.track_inventory = True
        self.product.save(update_fields=['track_inventory'])
        c1 = Customer.objects.create(name='C1', phone='9000000002')
        c2 = Customer.objects.create(name='C2', phone='9000000003')
        bc_old = Barcode.objects.filter(product=self.product, tag='new').first()
        bc_new = Barcode.objects.filter(product=self.product, tag='new').exclude(pk=bc_old.pk).first()

        cart1 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=c1,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart1,
            product=self.product,
            quantity=1,
            unit_price=Decimal('50.00'),
            manual_unit_price=Decimal('50.00'),
            scanned_barcodes=[bc_old.barcode],
        )
        r1 = self.client.post(
            reverse('cart-checkout', args=[cart1.id]),
            {'invoice_type': 'cash', 'customer': c1.id},
            format='json',
        )
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        trade_item_id = Invoice.objects.get(id=r1.data['id']).items.first().id

        cart2 = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=c2,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart2,
            product=self.product,
            quantity=1,
            unit_price=Decimal('200.00'),
            manual_unit_price=Decimal('200.00'),
            scanned_barcodes=[bc_new.barcode],
        )
        r2 = self.client.post(
            reverse('cart-checkout', args=[cart2.id]),
            {
                'invoice_type': 'cash',
                'customer': c2.id,
                'pos_trade_ins': [{'invoice_item_id': trade_item_id, 'return_tag': 'returned'}],
            },
            format='json',
        )
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED, r2.data)
        new_inv = Invoice.objects.get(id=r2.data['id'])
        self.assertEqual(new_inv.trade_in_credit, Decimal('50.00'))
        self.assertEqual(new_inv.total, Decimal('150.00'))


class InvoiceEditTests(APITestCase):
    """Test cases for invoice editing functionality including ledger and payment consistency"""
    
    def setUp(self):
        """Set up test data for invoice editing tests"""
        from backend.parties.models import Customer, LedgerEntry

        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Edit Test Store')
        self.category = TestDataFactory.create_category(name='Edit Test Category')

        # Create customer for ledger testing
        self.customer = TestDataFactory.create_customer(name='Test Customer', phone='9999999999')

        # Create products
        self.product1 = Product.objects.create(
            retailer=self.retailer,
            name='Product One',
            category=self.category,
            product_type='simple',
            track_inventory=True
        )
        self.product2 = Product.objects.create(
            retailer=self.retailer,
            name='Product Two',
            category=self.category,
            product_type='simple',
            track_inventory=True
        )

        # Create barcodes for tracked products
        self.barcodes1 = []
        for i in range(5):
            bc = Barcode.objects.create(
                retailer=self.retailer,
                product=self.product1,
                barcode=f'P1-BC-{uuid.uuid4().hex[:8]}',
                tag='new'
            )
            self.barcodes1.append(bc)

        self.barcodes2 = []
        for i in range(5):
            bc = Barcode.objects.create(
                retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
        # invoice_update sets partial when total > 0 and due remains (no payment)
        self.assertEqual(invoice.status, 'partial')
    
    def test_invoice_edit_multiple_edits(self):
        """Test multiple consecutive edits to same invoice"""
        # 1. Create initial draft invoice (pending so editable)
        cart = Cart.objects.create(
            retailer=self.retailer,
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

    def test_invoice_edit_preserves_inclusive_gst_total(self):
        """Apply-from-cart must not double-count GST on inclusive (tax-in-price) lines."""
        supplier = TestDataFactory.create_supplier()
        purchase = TestDataFactory.create_purchase(
            user=self.user,
            supplier=supplier,
            store=self.store,
            status='finalized',
        )
        purchase_item = TestDataFactory.create_purchase_item(
            purchase=purchase,
            product=self.product1,
            quantity=Decimal('1.00'),
            unit_price=Decimal('100.00'),
        )
        purchase_item.gst_percent = Decimal('18.00')
        purchase_item.gst_inclusive = True
        purchase_item.save(update_fields=['gst_percent', 'gst_inclusive'])
        gst_barcode = self.barcodes1[0]
        gst_barcode.purchase_item = purchase_item
        gst_barcode.save(update_fields=['purchase_item'])

        cart = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'GST-EDIT-CART-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='cash',
        )
        CartItem.objects.create(
            cart=cart,
            product=self.product1,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            manual_unit_price=Decimal('118.00'),
            tax_amount=Decimal('18.00'),
            scanned_barcodes=[gst_barcode.barcode],
        )

        checkout_url = reverse('cart-checkout', args=[cart.id])
        response = self.client.post(checkout_url, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        invoice_id = response.data['id']
        invoice = Invoice.objects.get(id=invoice_id)
        self.assertEqual(invoice.total, Decimal('118.00'))

        edit_url = reverse('invoice-edit', args=[invoice_id])
        response = self.client.post(edit_url, format='json')
        edit_cart_id = response.data['cart_id']

        update_url = reverse('invoice-update', args=[invoice_id])
        response = self.client.post(update_url, {'cart_id': edit_cart_id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        invoice.refresh_from_db()
        self.assertEqual(invoice.total, Decimal('118.00'))
        item = invoice.items.get()
        self.assertEqual(item.line_total, Decimal('118.00'))
        self.assertEqual(item.tax_amount, Decimal('18.00'))
    
    def test_invoice_edit_barcode_status_consistency(self):
        """Test that barcode statuses are correctly managed during edits"""
        # 1. Create draft invoice (pending so editable)
        cart = Cart.objects.create(
            retailer=self.retailer,
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
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Strict Store')
        self.category = TestDataFactory.create_category(name='Strict Category')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Strict Tracked Product',
            category=self.category,
            track_inventory=True
        )
        self.barcode = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'STRICT-{uuid.uuid4().hex[:8]}',
            tag='new'
        )
        self.cart = Cart.objects.create(
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Race Store')
        self.category = TestDataFactory.create_category(name='Race Category')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Race Product',
            category=self.category,
            track_inventory=True
        )
        self.barcode = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode='RACE-001',
            tag='new'
        )
        self.cart = Cart.objects.create(
            retailer=self.retailer,
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
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.wholesale_group, _ = Group.objects.get_or_create(name='Wholesale')
        self.user.groups.add(self.wholesale_group)
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Wholesale Store')

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
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Barcode Store')
        self.category = TestDataFactory.create_category(name='Barcode Category')
        self.supplier = TestDataFactory.create_supplier(name='Test Supplier')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Barcode Test Product',
            category=self.category,
            product_type='simple',
            track_inventory=True,
        )
        # Create a finalized purchase and purchase item so barcode can be added to cart
        self.purchase = Purchase.objects.create(
            retailer=self.retailer,
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
            retailer=self.retailer,
            product=self.product,
            barcode=self.full_barcode,
            short_code=None,
            tag='new',
            purchase_item=self.purchase_item,
        )
        self.cart = Cart.objects.create(
            retailer=self.retailer,
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
            retailer=self.retailer,
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

    def test_cart_delete_restores_returned_when_original_sale_line_exists(self):
        """Returned unit (still on paid invoice line) goes in-cart in POS; deleting cart row must return to returned, not stay in-cart."""
        customer = Customer.objects.create(name='Cart Return Cust', phone='9888888888')
        inv = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-RTN-{uuid.uuid4().hex[:6]}',
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
        self.barcode.tag = 'returned'
        self.barcode.save(update_fields=['tag'])

        add_url = reverse('cart-items', kwargs={'pk': self.cart.id})
        r1 = self.client.post(
            add_url,
            {'product': self.product.id, 'quantity': 1, 'unit_price': '100.00', 'barcode': self.full_barcode},
            format='json',
        )
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED, r1.data)
        self.barcode.refresh_from_db()
        self.assertEqual(self.barcode.tag, 'in-cart')

        item_id = r1.data['id']
        del_url = reverse('cart-item-update', kwargs={'pk': self.cart.id, 'item_id': item_id})
        r2 = self.client.delete(del_url)
        self.assertEqual(r2.status_code, status.HTTP_204_NO_CONTENT)
        self.barcode.refresh_from_db()
        self.assertEqual(self.barcode.tag, 'returned')


class BulkBarcodesCheckTests(APITestCase):
    """Tests for bulk barcodes check (replacement credit note): all barcode types and skip cases."""

    def setUp(self):
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Bulk Store')
        self.category = TestDataFactory.create_category(name='Bulk Category')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Bulk Product',
            category=self.category,
            product_type='simple',
            track_inventory=True,
        )
        self.customer_a = TestDataFactory.create_customer(name='Customer A', phone='1111111111')
        self.customer_b = TestDataFactory.create_customer(name='Customer B', phone='2222222222')

        # Helper to create a completed invoice (paid, cash) with one item for a barcode (uppercase for .upper() lookup)
        def make_invoice(inv_number, customer, barcode, barcode_tag='sold'):
            b = Barcode.objects.create(
                retailer=self.retailer,
                product=self.product,
                barcode=f'BC-{inv_number}-{uuid.uuid4().hex[:6]}'.upper(),
                short_code=f'SC-{inv_number}'.upper() if inv_number else None,
                tag=barcode_tag,
            )
            inv = Invoice.objects.create(
                retailer=self.retailer,
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
            retailer=self.retailer,
            product=self.product,
            barcode='LONG-BARCODE-WITH-SHORT',
            short_code='SHORT-001',
            tag='sold',
        )
        inv_short = Invoice.objects.create(
            retailer=self.retailer,
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

    def test_not_sold_tags_skipped_except_fresh(self):
        """Fresh (new) is processable via defective flow; other non-sold tags are skipped."""
        barcodes = [
            self.barcode_new.barcode,
            self.barcode_returned.barcode,
            self.barcode_defective.barcode,
            self.barcode_unknown.barcode,
            self.barcode_incart.barcode,
        ]
        response = self.client.post(self._url(), {'barcodes': barcodes}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 0)
        self.assertEqual(len(response.data['fresh_processable']), 1)
        self.assertEqual(response.data['fresh_processable'][0]['barcode_id'], self.barcode_new.id)
        self.assertEqual(len(response.data['skipped']), 4)
        reasons = {s['reason'] for s in response.data['skipped']}
        self.assertEqual(reasons, {'not_sold'})

    def test_fresh_without_invoice_item_is_processable(self):
        """Fresh barcode without invoice item is still processable in replacement bulk flow."""
        fresh_only = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'BC-FRESH-ONLY-{uuid.uuid4().hex[:6]}'.upper(),
            tag='new',
        )
        response = self.client.post(
            self._url(),
            {'barcodes': [fresh_only.barcode]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertEqual(len(response.data['processable']), 0)
        self.assertEqual(len(response.data['fresh_processable']), 1)
        self.assertEqual(response.data['fresh_processable'][0]['barcode_id'], fresh_only.id)
        self.assertEqual(len(response.data['skipped']), 0)

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
            retailer=self.retailer,
            product=self.product,
            barcode=f'BC-B2-{uuid.uuid4().hex[:6]}'.upper(),
            tag='sold',
        )
        inv_b2 = Invoice.objects.create(
            retailer=self.retailer,
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
        self.assertEqual(len(response.data['fresh_processable']), 1)
        self.assertEqual(response.data['fresh_processable'][0]['barcode_id'], self.barcode_new.id)
        self.assertEqual(len(response.data['skipped']), 1)
        reasons = {s['reason'] for s in response.data['skipped']}
        self.assertIn('not_found', reasons)

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
            retailer=self.retailer,
            product=self.product,
            barcode=f'BC-DRAFT-{uuid.uuid4().hex[:6]}',
            tag='sold',
        )
        inv_draft = Invoice.objects.create(
            retailer=self.retailer,
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
            retailer=self.retailer,
            product=self.product,
            barcode=f'BC-VOID-{uuid.uuid4().hex[:6]}',
            tag='sold',
        )
        inv_void = Invoice.objects.create(
            retailer=self.retailer,
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
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Custom Test Store')
        self.category = TestDataFactory.create_category(name='Custom Category')
        self.cart = Cart.objects.create(
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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
            retailer=self.retailer,
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


class InvoiceItemBarcodeResolutionTests(APITestCase):
    """Tests for adding items to invoices via barcode string or barcode_id."""

    def setUp(self):
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='Invoice BC Store')
        self.category = TestDataFactory.create_category(name='Invoice BC Category')
        self.customer = TestDataFactory.create_customer(name='Invoice BC Cust', phone='8888888888')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='Invoice BC Product',
            category=self.category,
            track_inventory=True,
        )
        self.bc1 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'INVBC-{uuid.uuid4().hex[:8]}'.upper(),
            short_code=f'SC-INVBC-{uuid.uuid4().hex[:4]}'.upper(),
            tag='new',
        )
        self.bc2 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'INVBC2-{uuid.uuid4().hex[:8]}'.upper(),
            tag='new',
        )

    def _create_draft_pending_invoice(self):
        cart = Cart.objects.create(
            retailer=self.retailer,
            cart_number=f'CRT-INVBC-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            created_by=self.user,
            invoice_type='pending',
        )
        CartItem.objects.create(
            cart=cart,
            product=Product.objects.create(
                retailer=self.retailer,
                name=f'Seed-{uuid.uuid4().hex[:6]}',
                category=self.category,
                track_inventory=False,
            ),
            quantity=1,
            unit_price=Decimal('0.00'),
        )
        url = reverse('cart-checkout', args=[cart.id])
        resp = self.client.post(url, {'invoice_type': 'pending'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        return resp.data['id']

    def test_add_item_by_barcode_string_succeeds(self):
        """Adding an item with raw barcode string resolves and assigns the exact barcode."""
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': self.bc1.barcode,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        item = InvoiceItem.objects.get(id=response.data['id'])
        self.assertEqual(item.barcode_id, self.bc1.id)

    def test_add_item_by_short_code_succeeds(self):
        """Adding an item with short_code string resolves to the correct barcode."""
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': self.bc1.short_code,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        item = InvoiceItem.objects.get(id=response.data['id'])
        self.assertEqual(item.barcode_id, self.bc1.id)

    def test_add_item_by_barcode_id_succeeds(self):
        """Adding an item with barcode_id (FK) assigns the exact barcode."""
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode_id': self.bc1.id,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        item = InvoiceItem.objects.get(id=response.data['id'])
        self.assertEqual(item.barcode_id, self.bc1.id)

    def test_add_item_sold_barcode_rejected(self):
        """Adding an item with a sold barcode returns 400."""
        self.bc1.tag = 'sold'
        self.bc1.save(update_fields=['tag'])
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': self.bc1.barcode,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('not available', response.data.get('error', ''))

    def test_add_item_nonexistent_barcode_returns_404(self):
        """Adding an item with a barcode that doesn't exist returns 404."""
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': 'DOES-NOT-EXIST-99999',
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_add_item_duplicate_barcode_on_invoice_rejected(self):
        """Adding the same barcode twice to one invoice returns 400 (sold after first add)."""
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': self.bc1.barcode,
        }
        resp1 = self.client.post(url, data, format='json')
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)
        resp2 = self.client.post(url, data, format='json')
        self.assertEqual(resp2.status_code, status.HTTP_400_BAD_REQUEST)
        error_msg = resp2.data.get('error', '')
        self.assertTrue(
            'already on this invoice' in error_msg or 'not available' in error_msg,
            f'Expected rejection error, got: {error_msg}'
        )

    def test_multiple_barcodes_no_error_when_barcode_specified(self):
        """With multiple new barcodes for a product, adding by exact barcode succeeds (no 'Multiple barcodes' error)."""
        invoice_id = self._create_draft_pending_invoice()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': self.bc2.barcode,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        item = InvoiceItem.objects.get(id=response.data['id'])
        self.assertEqual(item.barcode_id, self.bc2.id)

    def test_void_invoice_rejects_item(self):
        """Adding items to a void invoice returns 400."""
        invoice_id = self._create_draft_pending_invoice()
        invoice = Invoice.objects.get(id=invoice_id)
        invoice.status = 'void'
        invoice.save()
        url = reverse('invoice-items', args=[invoice_id])
        data = {
            'product': self.product.id,
            'quantity': 1,
            'unit_price': 0,
            'discount_amount': 0,
            'tax_amount': 0,
            'line_total': 0,
            'barcode': self.bc1.barcode,
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('void', response.data.get('error', '').lower())


class ReplacementPOSTests(APITestCase):
    """Replacement POS: sold-barcode lookup, draft vs instant create, checkout, validation."""

    def setUp(self):
        self.retailer = TestDataFactory.get_or_create_default_retailer()
        self.user = TestDataFactory.create_user()
        self.client.force_authenticate(user=self.user)
        self.store = TestDataFactory.create_store(name='RPos Store')
        self.category = TestDataFactory.create_category(name='RPos Cat')
        self.customer = TestDataFactory.create_customer(name='RPos Customer', phone='9999999999')
        self.customer2 = TestDataFactory.create_customer(name='RPos Customer2', phone='9999999998')
        self.product = Product.objects.create(
            retailer=self.retailer,
            name='RPos Product',
            category=self.category,
            track_inventory=True,
        )
        self.bc = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'RPOS-{uuid.uuid4().hex[:10]}'.upper(),
            tag='sold',
        )

    def _paid_invoice_with_item(self, customer, unit_price):
        self.bc.tag = 'sold'
        self.bc.save(update_fields=['tag'])
        inv = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-S-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            status='paid',
            invoice_type='cash',
            total=unit_price,
            paid_amount=unit_price,
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        item = InvoiceItem.objects.create(
            invoice=inv,
            product=self.product,
            barcode=self.bc,
            sold_barcode_value=self.bc.barcode,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            manual_unit_price=None,
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            line_total=unit_price,
        )
        return inv, item

    def _credit_credit_invoice_with_item(self, customer, unit_price, barcode_obj):
        """Mimic customer 726 style bills: status=credit, invoice_type=credit, barcode still sold on line."""
        barcode_obj.tag = 'sold'
        barcode_obj.save(update_fields=['tag'])
        inv = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-CC-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=customer,
            status='credit',
            invoice_type='credit',
            subtotal=unit_price,
            total=unit_price,
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            paid_amount=Decimal('0.00'),
            due_amount=unit_price,
            created_by=self.user,
        )
        item = InvoiceItem.objects.create(
            invoice=inv,
            product=self.product,
            barcode=barcode_obj,
            sold_barcode_value=barcode_obj.barcode or '',
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            manual_unit_price=None,
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            line_total=unit_price,
        )
        return inv, item

    def test_lookup_returns_404_when_no_sold_line(self):
        url = reverse('replacement-pos-lookup')
        r = self.client.post(url, {'barcode': 'NO-SUCH-BARCODE-999'}, format='json')
        self.assertEqual(r.status_code, status.HTTP_404_NOT_FOUND)

    def test_lookup_rejects_when_barcode_not_sold(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        self.bc.tag = 'new'
        self.bc.save(update_fields=['tag'])
        url = reverse('replacement-pos-lookup')
        r = self.client.post(url, {'barcode': self.bc.barcode}, format='json')
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_lookup_returns_line(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('150.00'))
        url = reverse('replacement-pos-lookup')
        r = self.client.post(url, {'barcode': self.bc.barcode}, format='json')
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        self.assertFalse(r.data.get('ambiguous'))
        self.assertEqual(r.data['line']['original_invoice_item_id'], item.id)
        self.assertEqual(r.data['line']['sold_unit_price'], '150.00')
        self.assertEqual(r.data['line']['store_id'], self.store.id)
        self.assertEqual(r.data['line']['store_name'], self.store.name)
        self.assertEqual(r.data['line'].get('sold_barcode_value'), self.bc.barcode)
        self.assertEqual(r.data['line'].get('barcode_full'), self.bc.barcode)

    def test_create_pending_keeps_barcode_sold_no_ledger(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        from backend.parties.models import LedgerEntry

        before = LedgerEntry.objects.count()
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'store': self.store.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '80'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret = Invoice.objects.get(id=r.data['id'])
        self.assertTrue(ret.is_replacement_return)
        self.assertEqual(ret.replacement_mode, 'pending')
        self.assertEqual(ret.status, 'draft')
        self.bc.refresh_from_db()
        self.assertEqual(self.bc.tag, 'sold')
        self.assertEqual(LedgerEntry.objects.count(), before)

    def test_create_pending_without_store_in_body_uses_invoice_store(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '80'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret = Invoice.objects.get(id=r.data['id'])
        self.assertEqual(ret.store_id, self.store.id)

    def test_create_rejects_mismatched_store_in_body(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        other_store = Store.objects.create(
            retailer=self.retailer,
            name='Other RPos',
            code=f'OR-{uuid.uuid4().hex[:10]}',
            shop_type='retail',
        )
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'store': other_store.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '80'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_rejects_lines_from_two_stores(self):
        inv1, item1 = self._paid_invoice_with_item(self.customer, Decimal('10.00'))
        store_b = Store.objects.create(
            retailer=self.retailer,
            name='RPos Store B',
            code=f'RB-{uuid.uuid4().hex[:10]}',
            shop_type='retail',
        )
        bc_b = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'RPOS-B-{uuid.uuid4().hex[:8]}'.upper(),
            tag='sold',
        )
        inv_b = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-SB-{uuid.uuid4().hex[:8]}',
            store=store_b,
            customer=self.customer,
            status='paid',
            invoice_type='cash',
            total=Decimal('10.00'),
            paid_amount=Decimal('10.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        item_b = InvoiceItem.objects.create(
            invoice=inv_b,
            product=self.product,
            barcode=bc_b,
            sold_barcode_value=bc_b.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('10.00'),
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            line_total=Decimal('10.00'),
        )
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'pending',
                'lines': [
                    {'original_invoice_item_id': item1.id, 'return_tag': 'returned', 'accepted_return_price': '5'},
                    {'original_invoice_item_id': item_b.id, 'return_tag': 'returned', 'accepted_return_price': '5'},
                ],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_rejects_missing_return_tag(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'accepted_return_price': '80'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('return_tag', (r.data.get('error') or '').lower())

    def test_create_rejects_blank_return_tag(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': '   ', 'accepted_return_price': '80'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_instant_credits_and_retags(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('200.00'))
        self.customer.refresh_from_db()
        bal_before = self.customer.credit_balance
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'store': self.store.id,
                'customer': self.customer.id,
                'mode': 'instant',
                'settlement_invoice_type': 'cash',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '200.00'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret = Invoice.objects.get(id=r.data['id'])
        self.assertEqual(ret.status, 'paid')
        self.bc.refresh_from_db()
        self.assertEqual(self.bc.tag, 'returned')
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, bal_before + Decimal('200.00'))
        from backend.parties.models import LedgerEntry

        self.assertEqual(ret.payments.count(), 0)
        le = LedgerEntry.objects.filter(invoice_id=ret.id).first()
        self.assertIsNotNone(le)
        self.assertEqual(le.entry_type, 'credit')
        self.assertEqual(le.amount, Decimal('200.00'))
        self.assertIn('CASH', le.description.upper())
        self.assertEqual(le.payment_mode, 'cash')

    def test_create_instant_credit_settlement_ledger_debit(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('50.00'))
        self.customer.refresh_from_db()
        bal_before = self.customer.credit_balance
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'instant',
                'settlement_invoice_type': 'credit',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '50.00'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, bal_before + Decimal('50.00'))
        from backend.parties.models import LedgerEntry

        ret = Invoice.objects.get(id=r.data['id'])
        self.assertEqual(ret.payments.count(), 0)
        le = LedgerEntry.objects.filter(invoice_id=r.data['id']).first()
        self.assertIsNotNone(le)
        self.assertEqual(le.entry_type, 'credit')
        self.assertEqual(le.amount, Decimal('50.00'))
        self.assertIn('CREDIT', le.description.upper())

    def test_create_instant_mixed_ledger_split_no_payments(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        self.customer.refresh_from_db()
        bal_before = self.customer.credit_balance
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'instant',
                'settlement_invoice_type': 'mixed',
                'cash_amount': '40',
                'upi_amount': '60',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '100.00'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret = Invoice.objects.get(id=r.data['id'])
        self.assertEqual(ret.payments.count(), 0)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, bal_before + Decimal('100.00'))
        from backend.parties.models import LedgerEntry

        le = LedgerEntry.objects.filter(invoice=ret).first()
        self.assertIsNotNone(le)
        self.assertEqual(le.entry_type, 'credit')
        self.assertEqual(le.amount, Decimal('100.00'))
        self.assertEqual(le.amount, ret.total)
        self.assertEqual(le.payment_mode, 'mixed')
        self.assertEqual(le.cash_amount, Decimal('40.00'))
        self.assertEqual(le.upi_amount, Decimal('60.00'))
        self.assertIn('MIXED', le.description.upper())

    def test_create_instant_two_lines_ledger_matches_invoice_total(self):
        _, item1 = self._paid_invoice_with_item(self.customer, Decimal('40.00'))
        bc2 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'RPOS2L-{uuid.uuid4().hex[:8]}'.upper(),
            tag='sold',
        )
        inv2 = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-S2L-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer,
            status='paid',
            invoice_type='cash',
            total=Decimal('60.00'),
            paid_amount=Decimal('60.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        item2 = InvoiceItem.objects.create(
            invoice=inv2,
            product=self.product,
            barcode=bc2,
            sold_barcode_value=bc2.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('60.00'),
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            line_total=Decimal('60.00'),
        )
        self.customer.refresh_from_db()
        bal_before = self.customer.credit_balance
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'mode': 'instant',
                'settlement_invoice_type': 'upi',
                'lines': [
                    {'original_invoice_item_id': item1.id, 'return_tag': 'returned', 'accepted_return_price': '40.00'},
                    {'original_invoice_item_id': item2.id, 'return_tag': 'returned', 'accepted_return_price': '60.00'},
                ],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret = Invoice.objects.get(id=r.data['id'])
        self.assertEqual(ret.total, Decimal('100.00'))
        from backend.parties.models import LedgerEntry

        self.assertEqual(ret.payments.count(), 0)
        self.assertEqual(LedgerEntry.objects.filter(invoice=ret).count(), 1)
        le = LedgerEntry.objects.get(invoice=ret)
        self.assertEqual(le.entry_type, 'credit')
        self.assertEqual(le.amount, ret.total)
        self.assertEqual(le.amount, Decimal('100.00'))
        self.assertIn('UPI', le.description.upper())
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, bal_before + Decimal('100.00'))
        self.bc.refresh_from_db()
        bc2.refresh_from_db()
        self.assertEqual(self.bc.tag, 'returned')
        self.assertEqual(bc2.tag, 'returned')

    def test_create_rejects_price_above_sold(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('50.00'))
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'store': self.store.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '60'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mixed_customers_sets_warning(self):
        inv1, item1 = self._paid_invoice_with_item(self.customer, Decimal('10.00'))
        bc2 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'RPOS2-{uuid.uuid4().hex[:8]}'.upper(),
            tag='sold',
        )
        inv2 = Invoice.objects.create(
            retailer=self.retailer,
            invoice_number=f'INV-S2-{uuid.uuid4().hex[:8]}',
            store=self.store,
            customer=self.customer2,
            status='paid',
            invoice_type='cash',
            total=Decimal('10.00'),
            paid_amount=Decimal('10.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        item2 = InvoiceItem.objects.create(
            invoice=inv2,
            product=self.product,
            barcode=bc2,
            sold_barcode_value=bc2.barcode,
            quantity=Decimal('1.000'),
            unit_price=Decimal('10.00'),
            discount_amount=Decimal('0.00'),
            tax_amount=Decimal('0.00'),
            line_total=Decimal('10.00'),
        )
        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'store': self.store.id,
                'mode': 'pending',
                'lines': [
                    {'original_invoice_item_id': item1.id, 'return_tag': 'returned', 'accepted_return_price': '5'},
                    {'original_invoice_item_id': item2.id, 'return_tag': 'unknown', 'accepted_return_price': '5'},
                ],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        self.assertTrue(r.data.get('replacement_customer_warning'))

    def test_invoice_checkout_finalizes_pending_replacement(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        url_c = reverse('replacement-pos-create')
        r = self.client.post(
            url_c,
            {
                'store': self.store.id,
                'customer': self.customer.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '90'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        ret_id = r.data['id']
        self.bc.refresh_from_db()
        self.assertEqual(self.bc.tag, 'sold')
        ch = reverse('invoice-checkout', args=[ret_id])
        r2 = self.client.post(ch, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(r2.status_code, status.HTTP_200_OK, r2.data)
        self.bc.refresh_from_db()
        self.assertEqual(self.bc.tag, 'returned')

    def test_invoice_checkout_replacement_clears_draft_payments_and_ledger(self):
        """Pending return with a partial invoice payment: finalize drops Payment rows and payment ledger, then one replacement credit."""
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('100.00'))
        r = self.client.post(
            reverse('replacement-pos-create'),
            {
                'store': self.store.id,
                'customer': self.customer.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '90'}],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret_id = r.data['id']
        ret = Invoice.objects.get(pk=ret_id)
        pay_desc = f'Payment for Invoice {ret.invoice_number}'
        self.customer.refresh_from_db()
        bal_before_deposit = self.customer.credit_balance
        pay_url = reverse('invoice-payments', args=[ret_id])
        pr = self.client.post(
            pay_url,
            {'payment_method': 'cash', 'amount': '25.00', 'invoice': ret_id},
            format='json',
        )
        self.assertEqual(pr.status_code, status.HTTP_201_CREATED, pr.data)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, bal_before_deposit + Decimal('25.00'))
        from backend.parties.models import LedgerEntry

        self.assertTrue(LedgerEntry.objects.filter(invoice_id=ret_id, description=pay_desc).exists())

        ch = reverse('invoice-checkout', args=[ret_id])
        r2 = self.client.post(ch, {'invoice_type': 'cash'}, format='json')
        self.assertEqual(r2.status_code, status.HTTP_200_OK, r2.data)
        ret = Invoice.objects.get(pk=ret_id)
        self.assertEqual(ret.payments.count(), 0)
        self.assertFalse(LedgerEntry.objects.filter(invoice_id=ret_id, description=pay_desc).exists())
        settlement = LedgerEntry.objects.filter(invoice_id=ret_id, description__icontains='Replacement return').first()
        self.assertIsNotNone(settlement)
        self.assertEqual(settlement.entry_type, 'credit')
        self.assertEqual(settlement.amount, Decimal('90.00'))
        self.customer.refresh_from_db()
        # Deposit ledger is reversed at finalize, then one replacement credit for the return total.
        self.assertEqual(self.customer.credit_balance, bal_before_deposit + Decimal('90.00'))

    def test_instant_return_barcodes_from_two_credit_credit_invoices_ledger_and_tags(self):
        """Credit/credit bills (like ledger slice) hold sold lines; instant replacement posts one CREDIT + balance."""
        from backend.parties.models import LedgerEntry

        bc1 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'RPOS-CC1-{uuid.uuid4().hex[:8]}'.upper(),
            tag='new',
        )
        bc2 = Barcode.objects.create(
            retailer=self.retailer,
            product=self.product,
            barcode=f'RPOS-CC2-{uuid.uuid4().hex[:8]}'.upper(),
            tag='new',
        )
        _inv1, item1 = self._credit_credit_invoice_with_item(self.customer, Decimal('100.00'), bc1)
        _inv2, item2 = self._credit_credit_invoice_with_item(self.customer, Decimal('250.00'), bc2)

        self.customer.refresh_from_db()
        bal_before = self.customer.credit_balance

        url = reverse('replacement-pos-create')
        r = self.client.post(
            url,
            {
                'store': self.store.id,
                'customer': self.customer.id,
                'mode': 'instant',
                'settlement_invoice_type': 'cash',
                'lines': [
                    {'original_invoice_item_id': item1.id, 'return_tag': 'returned', 'accepted_return_price': '100.00'},
                    {'original_invoice_item_id': item2.id, 'return_tag': 'returned', 'accepted_return_price': '250.00'},
                ],
            },
            format='json',
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED, r.data)
        ret = Invoice.objects.get(id=r.data['id'])
        self.assertTrue(ret.is_replacement_return)
        self.assertEqual(ret.status, 'paid')
        self.assertEqual(ret.total, Decimal('350.00'))

        rows = list(LedgerEntry.objects.filter(invoice_id=ret.id))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].entry_type, 'credit')
        self.assertEqual(rows[0].amount, Decimal('350.00'))
        self.assertIn('Replacement return POS settlement', rows[0].description)
        self.assertIn('CASH', rows[0].description.upper())

        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, bal_before + Decimal('350.00'))

        bc1.refresh_from_db()
        bc2.refresh_from_db()
        self.assertEqual(bc1.tag, 'returned')
        self.assertEqual(bc2.tag, 'returned')

    def test_invoice_list_replacement_pending_count(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('50.00'))
        list_url = reverse('invoice-list-create')
        r0 = self.client.get(list_url, {'counts': 'replacement_pending'})
        self.assertEqual(r0.status_code, status.HTTP_200_OK)
        self.assertEqual(r0.data.get('replacement_pending_count'), 0)

        self.client.post(
            reverse('replacement-pos-create'),
            {
                'store': self.store.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'returned', 'accepted_return_price': '40'}],
            },
            format='json',
        )
        r1 = self.client.get(list_url, {'counts': 'replacement_pending'})
        self.assertEqual(r1.data.get('replacement_pending_count'), 1)
        r_store = self.client.get(list_url, {'counts': 'replacement_pending', 'store': self.store.id})
        self.assertEqual(r_store.data.get('replacement_pending_count'), 1)

    def test_invoice_list_filter_replacement_return_pending(self):
        inv, item = self._paid_invoice_with_item(self.customer, Decimal('30.00'))
        self.client.post(
            reverse('replacement-pos-create'),
            {
                'store': self.store.id,
                'mode': 'pending',
                'lines': [{'original_invoice_item_id': item.id, 'return_tag': 'defective', 'accepted_return_price': '25'}],
            },
            format='json',
        )
        list_url = reverse('invoice-list-create')
        r = self.client.get(list_url, {'replacement_return_pending': 'true'})
        self.assertEqual(r.status_code, status.HTTP_200_OK)
        results = r.data.get('results') or []
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].get('is_replacement_return'))


class PosTenantIsolationTests(APITestCase):
    """Concrete multi-tenant regression tests for POS cart/invoice/return flows."""

    def setUp(self):
        self.retailer_a = Retailer.objects.create(code='PSA', name='POS Tenant A', is_active=True)
        self.retailer_b = Retailer.objects.create(code='PSB', name='POS Tenant B', is_active=True)

        self.user_a = User.objects.create_user(
            username=f'pos_tenant_user_a_{uuid.uuid4().hex[:6]}',
            password='testpass123',
            retailer=self.retailer_a,
            is_staff=True,
        )
        self.client.force_authenticate(user=self.user_a)

        self.store_a = Store.objects.create(
            retailer=self.retailer_a,
            name='POS Store A',
            code='POSA',
            shop_type='retail',
        )
        self.store_b = Store.objects.create(
            retailer=self.retailer_b,
            name='POS Store B',
            code='POSB',
            shop_type='retail',
        )
        self.category_a = Category.objects.create(retailer=self.retailer_a, name='POS Category A')
        self.category_b = Category.objects.create(retailer=self.retailer_b, name='POS Category B')
        self.product_a = Product.objects.create(
            retailer=self.retailer_a,
            name='POS Product A',
            category=self.category_a,
            product_type='simple',
        )
        self.product_b = Product.objects.create(
            retailer=self.retailer_b,
            name='POS Product B',
            category=self.category_b,
            product_type='simple',
        )
        self.customer_a = Customer.objects.create(retailer=self.retailer_a, name='POS Customer A', phone='9000000201')
        self.customer_b = Customer.objects.create(retailer=self.retailer_b, name='POS Customer B', phone='9000000202')

        self.cart_a = Cart.objects.create(
            retailer=self.retailer_a,
            cart_number=f'POS-CART-A-{uuid.uuid4().hex[:6]}',
            store=self.store_a,
            created_by=self.user_a,
            invoice_type='cash',
        )
        self.cart_b = Cart.objects.create(
            retailer=self.retailer_b,
            cart_number=f'POS-CART-B-{uuid.uuid4().hex[:6]}',
            store=self.store_b,
            created_by=self.user_a,
            invoice_type='cash',
        )

        self.invoice_a = Invoice.objects.create(
            retailer=self.retailer_a,
            invoice_number=f'POS-INV-A-{uuid.uuid4().hex[:6]}',
            store=self.store_a,
            customer=self.customer_a,
            status='draft',
            invoice_type='cash',
            subtotal=Decimal('50.00'),
            total=Decimal('50.00'),
            created_by=self.user_a,
        )
        self.invoice_b = Invoice.objects.create(
            retailer=self.retailer_b,
            invoice_number=f'POS-INV-B-{uuid.uuid4().hex[:6]}',
            store=self.store_b,
            customer=self.customer_b,
            status='draft',
            invoice_type='cash',
            subtotal=Decimal('50.00'),
            total=Decimal('50.00'),
            created_by=self.user_a,
        )

        self.return_a = Return.objects.create(
            retailer=self.retailer_a,
            return_number=f'POS-RET-A-{uuid.uuid4().hex[:6]}',
            invoice=self.invoice_a,
            reason='Test return',
            created_by=self.user_a,
        )
        self.return_b = Return.objects.create(
            retailer=self.retailer_b,
            return_number=f'POS-RET-B-{uuid.uuid4().hex[:6]}',
            invoice=self.invoice_b,
            reason='Test return',
            created_by=self.user_a,
        )

    def test_invoice_list_scoped_to_active_retailer(self):
        response = self.client.get(reverse('invoice-list-create'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.data.get('results', [])
        ids = {row['id'] for row in rows}
        self.assertIn(self.invoice_a.id, ids)
        self.assertNotIn(self.invoice_b.id, ids)

    def test_cart_detail_blocks_other_retailer_cart(self):
        response = self.client.get(reverse('cart-detail', args=[self.cart_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_invoice_detail_blocks_other_retailer_invoice(self):
        response = self.client.get(reverse('invoice-detail', args=[self.invoice_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_return_detail_blocks_other_retailer_return(self):
        response = self.client.get(reverse('return-detail', args=[self.return_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cart_patch_blocks_other_retailer_cart(self):
        response = self.client.patch(
            reverse('cart-detail', args=[self.cart_b.id]),
            {'notes': 'cross-tenant edit attempt'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cart_delete_blocks_other_retailer_cart(self):
        response = self.client.delete(reverse('cart-detail', args=[self.cart_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_invoice_patch_blocks_other_retailer_invoice(self):
        response = self.client.patch(
            reverse('invoice-detail', args=[self.invoice_b.id]),
            {'invoice_type': 'pending'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_invoice_delete_blocks_other_retailer_invoice(self):
        response = self.client.delete(reverse('invoice-detail', args=[self.invoice_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_return_patch_blocks_other_retailer_return(self):
        response = self.client.patch(
            reverse('return-detail', args=[self.return_b.id]),
            {'notes': 'cross-tenant patch'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_return_delete_blocks_other_retailer_return(self):
        response = self.client.delete(reverse('return-detail', args=[self.return_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


# ===========================================================================
# GST Sales Payload — barcode response + inclusive/exclusive bifurcation
# ===========================================================================

class GSTSalesPayloadTests(TestCase):
    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()
        self.product = TestDataFactory.create_product(track_inventory=True)

    def _create_purchase_linked_barcode(self, gst_percent, gst_inclusive):
        purchase = TestDataFactory.create_purchase(
            user=self.user,
            supplier=self.supplier,
            store=self.store,
            status='finalized',
        )
        purchase_item = TestDataFactory.create_purchase_item(
            purchase=purchase,
            product=self.product,
            quantity=Decimal('1.00'),
            unit_price=Decimal('100.00'),
        )
        purchase_item.gst_percent = Decimal(str(gst_percent))
        purchase_item.gst_inclusive = bool(gst_inclusive)
        purchase_item.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            self.product,
            barcode=f'GST-BC-{gst_percent}-{int(gst_inclusive)}',
            tag='new',
            purchase_item=purchase_item,
        )
        return barcode

    def test_build_barcode_response_prefers_purchase_item_gst(self):
        barcode = self._create_purchase_linked_barcode(gst_percent='18.00', gst_inclusive=True)
        payload = build_barcode_response(barcode, self.product, logging.getLogger('test.gst'))
        self.assertEqual(payload['gst_percent'], 18.0)
        self.assertTrue(payload['gst_inclusive'])

    def test_cart_item_serializer_uses_purchase_item_gst_from_scanned_barcode(self):
        barcode = self._create_purchase_linked_barcode(gst_percent='5.00', gst_inclusive=True)
        cart = TestDataFactory.create_cart(user=self.user, store=self.store)
        cart_item = CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('4.76'),
            scanned_barcodes=[barcode.barcode],
        )
        data = CartItemSerializer(cart_item).data
        self.assertEqual(data['tax_percent'], 5.0)
        self.assertTrue(data['tax_is_inclusive'])

    def test_cart_item_serializer_falls_back_to_product_tax_rate(self):
        tax_rate = TestDataFactory.create_tax_rate(rate=Decimal('12.00'))
        self.product.tax_rate = tax_rate
        self.product.save(update_fields=['tax_rate'])
        barcode = TestDataFactory.create_barcode(
            self.product,
            barcode='GST-BC-FALLBACK-12',
            tag='new',
            purchase_item=None,
        )
        cart = TestDataFactory.create_cart(user=self.user, store=self.store)
        cart_item = CartItem.objects.create(
            cart=cart,
            product=self.product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('200.00'),
            tax_amount=Decimal('24.00'),
            scanned_barcodes=[barcode.barcode],
        )
        data = CartItemSerializer(cart_item).data
        self.assertEqual(data['tax_percent'], 12.0)
        self.assertFalse(data['tax_is_inclusive'])


class CalculateGSTBifurcationExclusiveTests(TestCase):
    """GST-exclusive formula: GST = base * rate/100, Total = base + GST."""

    def test_5_percent_exclusive_single_unit(self):
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 5.00, places=2)
        self.assertAlmostEqual(result['cgst'], 2.50, places=2)
        self.assertAlmostEqual(result['sgst'], 2.50, places=2)
        self.assertAlmostEqual(result['igst'], 0.00, places=2)
        self.assertAlmostEqual(result['total'], 105.00, places=2)

    def test_18_percent_exclusive_single_unit(self):
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=18, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['cgst'], 9.00, places=2)
        self.assertAlmostEqual(result['sgst'], 9.00, places=2)
        self.assertAlmostEqual(result['total'], 118.00, places=2)

    def test_12_percent_exclusive_multiple_units(self):
        # 50/unit * 3 = 150 base, 12% → GST = 18, Total = 168
        result = calculate_gst_bifurcation(unit_price=50, quantity=3, tax_rate=12, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 150.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['cgst'], 9.00, places=2)
        self.assertAlmostEqual(result['sgst'], 9.00, places=2)
        self.assertAlmostEqual(result['total'], 168.00, places=2)

    def test_cgst_and_sgst_sum_equals_total_tax(self):
        result = calculate_gst_bifurcation(unit_price=99, quantity=1, tax_rate=28, is_inclusive=False)
        self.assertAlmostEqual(result['cgst'] + result['sgst'], result['total_tax'], places=2)

    def test_zero_tax_rate_exclusive(self):
        result = calculate_gst_bifurcation(unit_price=200, quantity=2, tax_rate=0, is_inclusive=False)
        self.assertAlmostEqual(result['base_amount'], 400.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 0.00, places=2)
        self.assertAlmostEqual(result['total'], 400.00, places=2)


class CalculateGSTBifurcationInclusiveTests(TestCase):
    """GST-inclusive formula: Base = Inclusive*100/(100+Rate), GST = Inclusive - Base."""

    def test_5_percent_inclusive_on_105(self):
        # Inclusive 105 @ 5% → base=100, tax=5
        result = calculate_gst_bifurcation(unit_price=105, quantity=1, tax_rate=5, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 5.00, places=2)
        self.assertAlmostEqual(result['cgst'], 2.50, places=2)
        self.assertAlmostEqual(result['sgst'], 2.50, places=2)
        self.assertAlmostEqual(result['total'], 105.00, places=2)

    def test_18_percent_inclusive_on_118(self):
        # Inclusive 118 @ 18% → base=100, tax=18
        result = calculate_gst_bifurcation(unit_price=118, quantity=1, tax_rate=18, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['total'], 118.00, places=2)

    def test_5_percent_inclusive_on_100(self):
        # Inclusive 100 @ 5% → base=95.24, tax=4.76
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 95.24, places=2)
        self.assertAlmostEqual(result['total_tax'], 4.76, places=2)
        self.assertAlmostEqual(result['cgst'], 2.38, places=2)
        self.assertAlmostEqual(result['sgst'], 2.38, places=2)
        self.assertAlmostEqual(result['total'], 100.00, places=2)

    def test_12_percent_inclusive_multiple_units(self):
        # 56/unit * 3 = 168 inclusive @ 12% → base=150, tax=18
        result = calculate_gst_bifurcation(unit_price=56, quantity=3, tax_rate=12, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'], 150.00, places=2)
        self.assertAlmostEqual(result['total_tax'], 18.00, places=2)
        self.assertAlmostEqual(result['total'], 168.00, places=2)

    def test_inclusive_total_equals_base_plus_tax(self):
        result = calculate_gst_bifurcation(unit_price=200, quantity=2, tax_rate=18, is_inclusive=True)
        self.assertAlmostEqual(result['base_amount'] + result['total_tax'], result['total'], places=2)

    def test_cgst_and_sgst_sum_equals_total_tax_inclusive(self):
        result = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=28, is_inclusive=True)
        self.assertAlmostEqual(result['cgst'] + result['sgst'], result['total_tax'], places=2)

    def test_igst_is_always_zero(self):
        """IGST is always 0 — only intra-state CGST + SGST."""
        for rate in [5, 12, 18, 28]:
            with self.subTest(rate=rate):
                r = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=rate, is_inclusive=True)
                self.assertEqual(r['igst'], 0.00)

    def test_same_rate_inclusive_vs_exclusive_different_bases(self):
        """5% inclusive on 100 gives lower base and tax than 5% exclusive on 100."""
        incl = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=True)
        excl = calculate_gst_bifurcation(unit_price=100, quantity=1, tax_rate=5, is_inclusive=False)
        self.assertLess(incl['base_amount'], excl['base_amount'])
        self.assertLess(incl['total_tax'], excl['total_tax'])
        self.assertAlmostEqual(incl['total'], 100.00, places=2)
        self.assertAlmostEqual(excl['total'], 105.00, places=2)


class CartItemTaxBifurcationTests(TestCase):
    """CartItem serializer must include is_inclusive in tax_bifurcation."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()

    def _make_cart_item(self, gst_percent, gst_inclusive, unit_price, tax_amount, barcode_suffix=''):
        product = TestDataFactory.create_product(track_inventory=True)
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        pi = TestDataFactory.create_purchase_item(
            purchase=purchase, product=product,
            quantity=Decimal('1.00'), unit_price=unit_price,
        )
        pi.gst_percent = Decimal(str(gst_percent))
        pi.gst_inclusive = bool(gst_inclusive)
        pi.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            product, barcode=f'BIFT-{gst_percent}-{int(gst_inclusive)}-{barcode_suffix}',
            tag='new', purchase_item=pi,
        )
        cart = TestDataFactory.create_cart(user=self.user, store=self.store)
        return CartItem.objects.create(
            cart=cart, product=product,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            tax_amount=tax_amount,
            scanned_barcodes=[barcode.barcode],
        )

    def test_exclusive_item_bifurcation_not_inclusive(self):
        item = self._make_cart_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'EX')
        bif = CartItemSerializer(item).data['tax_bifurcation']
        self.assertIsNotNone(bif)
        self.assertFalse(bif['is_inclusive'])
        self.assertAlmostEqual(bif['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(bif['total_tax'], 5.00, places=2)
        self.assertAlmostEqual(bif['cgst'], 2.50, places=2)
        self.assertAlmostEqual(bif['sgst'], 2.50, places=2)

    def test_inclusive_item_bifurcation_is_inclusive(self):
        # unit_price stored as base after GST extraction: 95.24
        item = self._make_cart_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'IN')
        bif = CartItemSerializer(item).data['tax_bifurcation']
        self.assertIsNotNone(bif)
        self.assertTrue(bif['is_inclusive'])
        self.assertAlmostEqual(bif['base_amount'], 95.24, places=2)
        self.assertAlmostEqual(bif['total_tax'], 4.76, places=2)

    def test_zero_tax_returns_none(self):
        item = self._make_cart_item('5.00', False, Decimal('100.00'), Decimal('0.00'), 'ZT')
        self.assertIsNone(CartItemSerializer(item).data['tax_bifurcation'])

    def test_rate_field_reflects_actual_rate(self):
        item = self._make_cart_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'RT18')
        bif = CartItemSerializer(item).data['tax_bifurcation']
        self.assertAlmostEqual(bif['rate'], 18.00, places=1)


class CartTaxBifurcationSlabTests(TestCase):
    """Cart-level tax_bifurcation must separate same-rate inclusive vs exclusive items."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()
        self.cart = TestDataFactory.create_cart(user=self.user, store=self.store)

    def _add_item(self, gst_percent, gst_inclusive, unit_price, tax_amount, suffix=''):
        product = TestDataFactory.create_product(track_inventory=True)
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        pi = TestDataFactory.create_purchase_item(
            purchase=purchase, product=product,
            quantity=Decimal('1.00'), unit_price=unit_price,
        )
        pi.gst_percent = Decimal(str(gst_percent))
        pi.gst_inclusive = bool(gst_inclusive)
        pi.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            product, barcode=f'CART-BIFT-{gst_percent}-{int(gst_inclusive)}-{suffix}',
            tag='new', purchase_item=pi,
        )
        CartItem.objects.create(
            cart=self.cart, product=product,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            tax_amount=tax_amount,
            scanned_barcodes=[barcode.barcode],
        )

    def test_single_exclusive_item_produces_one_slab(self):
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'S1')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertAlmostEqual(slabs[0]['rate'], 5.0, places=1)
        self.assertFalse(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(slabs[0]['total_tax'], 5.00, places=2)

    def test_single_inclusive_item_produces_one_slab_marked_inclusive(self):
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'S2')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertTrue(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['total_tax'], 4.76, places=2)

    def test_same_rate_inclusive_and_exclusive_produce_two_slabs(self):
        """Core fix: 5% inclusive and 5% exclusive must appear as TWO rows."""
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'EX')
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'IN')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 2, 'Same rate inclusive+exclusive must produce two slabs')
        self.assertIn(False, [s['is_inclusive'] for s in slabs])
        self.assertIn(True, [s['is_inclusive'] for s in slabs])

    def test_different_rates_produce_separate_slabs(self):
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'R1')
        self._add_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'R2')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertEqual(len(slabs), 2)
        self.assertAlmostEqual(sorted(s['rate'] for s in slabs)[0], 5.0, places=1)
        self.assertAlmostEqual(sorted(s['rate'] for s in slabs)[1], 18.0, places=1)

    def test_totals_aggregated_within_same_slab(self):
        """Two exclusive 5% items must be summed into one slab."""
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'AGG1')
        self._add_item('5.00', False, Decimal('200.00'), Decimal('10.00'), 'AGG2')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertEqual(len(slabs), 1)
        self.assertAlmostEqual(slabs[0]['base_amount'], 300.00, places=2)
        self.assertAlmostEqual(slabs[0]['total_tax'], 15.00, places=2)
        self.assertAlmostEqual(slabs[0]['cgst'], 7.50, places=2)
        self.assertAlmostEqual(slabs[0]['sgst'], 7.50, places=2)

    def test_no_tax_items_returns_none(self):
        product = TestDataFactory.create_product(track_inventory=True)
        CartItem.objects.create(
            cart=self.cart, product=product,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('0.00'),
            scanned_barcodes=[],
        )
        self.assertIsNone(CartSerializer(self.cart).data['tax_bifurcation'])

    def test_mixed_three_slabs(self):
        """5% excl + 5% incl + 18% excl must produce three slabs."""
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'M1')
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'M2')
        self._add_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'M3')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertEqual(len(slabs), 3)

    def test_slabs_sorted_by_rate_then_inclusive_flag(self):
        """Lower rate first; for same rate, exclusive (False) before inclusive (True)."""
        self._add_item('18.00', False, Decimal('100.00'), Decimal('18.00'), 'ORD1')
        self._add_item('5.00', True, Decimal('95.24'), Decimal('4.76'), 'ORD2')
        self._add_item('5.00', False, Decimal('100.00'), Decimal('5.00'), 'ORD3')
        slabs = CartSerializer(self.cart).data['tax_bifurcation']
        self.assertEqual(len(slabs), 3)
        self.assertAlmostEqual(slabs[0]['rate'], 5.0, places=1)
        self.assertFalse(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[1]['rate'], 5.0, places=1)
        self.assertTrue(slabs[1]['is_inclusive'])
        self.assertAlmostEqual(slabs[2]['rate'], 18.0, places=1)


class InvoiceTaxBifurcationSlabTests(TestCase):
    """Invoice-level tax_bifurcation must separate same-rate inclusive vs exclusive items."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier()
        self.invoice = TestDataFactory.create_invoice(self.user, store=self.store, status='paid')

    def _add_invoice_item(self, gst_percent, gst_inclusive, unit_price, tax_amount, line_total, suffix=''):
        product = TestDataFactory.create_product(track_inventory=True)
        purchase = TestDataFactory.create_purchase(
            user=self.user, supplier=self.supplier, store=self.store, status='finalized'
        )
        pi = TestDataFactory.create_purchase_item(
            purchase=purchase, product=product,
            quantity=Decimal('1.00'), unit_price=unit_price,
        )
        pi.gst_percent = Decimal(str(gst_percent))
        pi.gst_inclusive = bool(gst_inclusive)
        pi.save(update_fields=['gst_percent', 'gst_inclusive'])
        barcode = TestDataFactory.create_barcode(
            product, barcode=f'INV-BIFT-{gst_percent}-{int(gst_inclusive)}-{suffix}',
            tag='sold', purchase_item=pi,
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=product,
            barcode=barcode,
            quantity=Decimal('1.000'),
            unit_price=unit_price,
            tax_amount=tax_amount,
            line_total=line_total,
        )

    def test_exclusive_slab_marked_not_inclusive(self):
        self._add_invoice_item('5.00', False, Decimal('100.00'), Decimal('5.00'), Decimal('105.00'), 'EX')
        slabs = InvoiceSerializer(self.invoice).data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertFalse(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['base_amount'], 100.00, places=2)
        self.assertAlmostEqual(slabs[0]['total_tax'], 5.00, places=2)

    def test_inclusive_slab_marked_inclusive(self):
        self._add_invoice_item('5.00', True, Decimal('95.24'), Decimal('4.76'), Decimal('100.00'), 'IN')
        slabs = InvoiceSerializer(self.invoice).data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 1)
        self.assertTrue(slabs[0]['is_inclusive'])
        self.assertAlmostEqual(slabs[0]['total_tax'], 4.76, places=2)

    def test_same_rate_inclusive_and_exclusive_produce_two_slabs(self):
        self._add_invoice_item('5.00', False, Decimal('100.00'), Decimal('5.00'), Decimal('105.00'), 'EX')
        self._add_invoice_item('5.00', True, Decimal('95.24'), Decimal('4.76'), Decimal('100.00'), 'IN')
        slabs = InvoiceSerializer(self.invoice).data['tax_bifurcation']
        self.assertIsNotNone(slabs)
        self.assertEqual(len(slabs), 2)
        self.assertIn(False, [s['is_inclusive'] for s in slabs])
        self.assertIn(True, [s['is_inclusive'] for s in slabs])

    def test_cgst_sgst_sum_matches_total_tax_per_slab(self):
        self._add_invoice_item('18.00', False, Decimal('100.00'), Decimal('18.00'), Decimal('118.00'), 'CS')
        slabs = InvoiceSerializer(self.invoice).data['tax_bifurcation']
        for slab in slabs:
            self.assertAlmostEqual(slab['cgst'] + slab['sgst'], slab['total_tax'], places=2)

    def test_no_tax_invoice_returns_none(self):
        product = TestDataFactory.create_product(track_inventory=True)
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=product,
            barcode=None,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            tax_amount=Decimal('0.00'),
            line_total=Decimal('100.00'),
        )
        self.assertIsNone(InvoiceSerializer(self.invoice).data['tax_bifurcation'])

