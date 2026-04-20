from decimal import Decimal
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from backend.catalog.models import Product, Barcode, Category
from backend.core.access import merge_store_role_permissions, permissions_from_django_groups
from backend.core.models import AccessPermission, RetailerDashboardViewConfig, Role, UserStoreRole
from backend.locations.models import Store
from backend.locations.models import Warehouse
from backend.parties.models import Supplier, Customer, LedgerEntry
from backend.parties.models import Customer
from backend.pos.models import Invoice, InvoiceItem, Cart, CartItem, Payment
from backend.pos.models import CreditNote, Return
from backend.tenants.models import Retailer
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


class BarcodeAuditDisplayLabelTests(TestCase):
    """Barcode.audit_display_label() prefers short_code, then derived form, then full barcode."""

    def setUp(self):
        self.category = Category.objects.create(name='Audit Cat')
        self.product = Product.objects.create(
            name='Audit Product',
            category=self.category,
            product_type='simple',
            sku='SKU-AUDIT-1',
        )

    def test_prefers_short_code_when_set(self):
        bc = Barcode.objects.create(
            product=self.product,
            barcode='OLED-20260311-0002',
            short_code='OLED-0002',
            tag='new',
        )
        self.assertEqual(bc.audit_display_label(), 'OLED-0002')

    def test_falls_back_to_generated_short_form(self):
        bc = Barcode.objects.create(
            product=self.product,
            barcode='BASE-20260101-XYZ',
            short_code=None,
            tag='new',
        )
        self.assertEqual(bc.audit_display_label(), 'BASE-XYZ')

    def test_falls_back_to_raw_barcode(self):
        bc = Barcode.objects.create(
            product=self.product,
            barcode='SIMPLE',
            short_code=None,
            tag='new',
        )
        self.assertEqual(bc.audit_display_label(), 'SIMPLE')


class TenantIsolationRegressionTests(APITestCase):
    """
    Regression tests to enforce strict tenant scoping on list/search APIs.
    These tests intentionally create same-domain data in two retailers and
    assert only active retailer data is visible.
    """

    def setUp(self):
        self.retailer_a = Retailer.objects.create(code='RTA', name='Retailer A', is_active=True)
        self.retailer_b = Retailer.objects.create(code='RTB', name='Retailer B', is_active=True)

        self.user_a = User.objects.create_user(
            username='tenant_user_a',
            password='testpass123',
            retailer=self.retailer_a,
            is_staff=True,
        )
        self.client.force_authenticate(user=self.user_a)

        self.store_a = Store.objects.create(
            retailer=self.retailer_a,
            name='Store A',
            code='STA',
            shop_type='retail',
        )
        self.store_b = Store.objects.create(
            retailer=self.retailer_b,
            name='Store B',
            code='STB',
            shop_type='retail',
        )

        self.customer_a = Customer.objects.create(
            retailer=self.retailer_a,
            name='Customer A',
            phone='9000000001',
        )
        self.customer_b = Customer.objects.create(
            retailer=self.retailer_b,
            name='Customer B',
            phone='9000000002',
        )

        self.invoice_a = Invoice.objects.create(
            retailer=self.retailer_a,
            invoice_number='INV-A-1',
            store=self.store_a,
            customer=self.customer_a,
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            created_by=self.user_a,
        )
        self.invoice_b = Invoice.objects.create(
            retailer=self.retailer_b,
            invoice_number='INV-B-1',
            store=self.store_b,
            customer=self.customer_b,
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            created_by=self.user_a,
        )

        return_a = Return.objects.create(
            retailer=self.retailer_a,
            return_number='RET-A-1',
            invoice=self.invoice_a,
            reason='Damaged',
            created_by=self.user_a,
        )
        return_b = Return.objects.create(
            retailer=self.retailer_b,
            return_number='RET-B-1',
            invoice=self.invoice_b,
            reason='Damaged',
            created_by=self.user_a,
        )

        self.credit_note_a = CreditNote.objects.create(
            retailer=self.retailer_a,
            credit_note_number='CN-A-1',
            return_obj=return_a,
            amount=Decimal('10.00'),
            created_by=self.user_a,
        )
        self.credit_note_b = CreditNote.objects.create(
            retailer=self.retailer_b,
            credit_note_number='CN-B-1',
            return_obj=return_b,
            amount=Decimal('10.00'),
            created_by=self.user_a,
        )

        Product.objects.create(retailer=self.retailer_a, name='Alpha Product', sku='A-SKU')
        Product.objects.create(retailer=self.retailer_b, name='Beta Product', sku='B-SKU')

    def test_customer_list_is_scoped_to_active_retailer(self):
        response = self.client.get(reverse('customer-list-create'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertIn(self.customer_a.id, ids)
        self.assertNotIn(self.customer_b.id, ids)

    def test_credit_note_list_is_scoped_to_active_retailer(self):
        response = self.client.get(reverse('credit-note-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        numbers = {row['credit_note_number'] for row in response.data}
        self.assertIn('CN-A-1', numbers)
        self.assertNotIn('CN-B-1', numbers)

    def test_credit_note_detail_blocks_other_retailer_record(self):
        response = self.client.get(reverse('credit-note-detail', args=[self.credit_note_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_store_list_is_scoped_to_active_retailer(self):
        response = self.client.get(reverse('store-list-create'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertIn(self.store_a.id, ids)
        self.assertNotIn(self.store_b.id, ids)

    def test_customer_detail_blocks_other_retailer_record(self):
        response = self.client.get(reverse('customer-detail', args=[self.customer_b.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_global_search_is_scoped_to_active_retailer(self):
        response = self.client.get(reverse('global-search'), {'q': 'Product', 'type': 'product'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {row['name'] for row in response.data['products']}
        self.assertIn('Alpha Product', names)
        self.assertNotIn('Beta Product', names)


class MultiTenantRetailFlowE2ETests(APITestCase):
    """End-to-end tenant flow: setup -> purchase -> isolation -> POS sell -> KPIs."""

    def setUp(self):
        self.retailer_a = Retailer.objects.create(code='E2EA', name='E2E Retailer A', is_active=True)
        self.retailer_b = Retailer.objects.create(code='E2EB', name='E2E Retailer B', is_active=True)

        self.store_a = Store.objects.create(
            retailer=self.retailer_a,
            name='E2E Store A',
            code='E2ESA',
            shop_type='retail',
        )
        self.store_b = Store.objects.create(
            retailer=self.retailer_b,
            name='E2E Store B',
            code='E2ESB',
            shop_type='retail',
        )
        self.warehouse_a = Warehouse.objects.create(
            retailer=self.retailer_a,
            name='E2E Warehouse A',
            code='E2EWA',
        )

        self.retailer_a.primary_store = self.store_a
        self.retailer_a.save(update_fields=['primary_store'])
        self.retailer_b.primary_store = self.store_b
        self.retailer_b.save(update_fields=['primary_store'])

        self.user_a = User.objects.create_user(
            username='e2e_user_a',
            password='testpass123',
            retailer=self.retailer_a,
            default_store=self.store_a,
            is_staff=True,
        )
        self.user_b = User.objects.create_user(
            username='e2e_user_b',
            password='testpass123',
            retailer=self.retailer_b,
            default_store=self.store_b,
            is_staff=True,
        )
        self.user_a.assigned_stores.add(self.store_a)
        self.user_b.assigned_stores.add(self.store_b)

        self.category_a = Category.objects.create(retailer=self.retailer_a, name='E2E Cat A')
        self.product_a = Product.objects.create(
            retailer=self.retailer_a,
            name='E2E Product A',
            sku='E2E-SKU-A',
            category=self.category_a,
            product_type='simple',
            track_inventory=False,
        )
        self.supplier_a = Supplier.objects.create(
            retailer=self.retailer_a,
            name='E2E Supplier A',
            phone='9000000301',
        )
        self.customer_a = Customer.objects.create(
            retailer=self.retailer_a,
            name='E2E Customer A',
            phone='9000000302',
        )

    def test_multitenant_purchase_pos_and_kpis(self):
        self.client.force_authenticate(user=self.user_a)

        # 1) Purchase for retailer A.
        purchase_resp = self.client.post(
            reverse('purchase-list-create'),
            {
                'supplier': self.supplier_a.id,
                'purchase_date': '2026-04-20',
                'store': self.store_a.id,
                'items': [
                    {
                        'product': self.product_a.id,
                        'quantity': '5.00',
                        'unit_price': '100.00',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(purchase_resp.status_code, status.HTTP_201_CREATED, purchase_resp.data)
        purchase_id = purchase_resp.data['id']

        # 2) Other retailer cannot access this purchase.
        self.client.force_authenticate(user=self.user_b)
        denied_purchase = self.client.get(reverse('purchase-detail', args=[purchase_id]))
        self.assertEqual(denied_purchase.status_code, status.HTTP_404_NOT_FOUND)

        # 3) Build POS cart for owner retailer and sell.
        self.client.force_authenticate(user=self.user_a)
        cart = Cart.objects.create(
            retailer=self.retailer_a,
            cart_number='E2E-CART-A',
            store=self.store_a,
            customer=self.customer_a,
            created_by=self.user_a,
            invoice_type='credit',
            status='active',
        )
        CartItem.objects.create(
            cart=cart,
            product=self.product_a,
            quantity=Decimal('2.000'),
            unit_price=Decimal('150.00'),
        )
        checkout_resp = self.client.post(
            reverse('cart-checkout', args=[cart.id]),
            {'invoice_type': 'credit', 'customer': self.customer_a.id},
            format='json',
        )
        self.assertEqual(checkout_resp.status_code, status.HTTP_201_CREATED, checkout_resp.data)
        invoice_id = checkout_resp.data['id']
        invoice = Invoice.objects.get(pk=invoice_id)
        self.assertEqual(invoice.retailer_id, self.retailer_a.id)
        self.assertEqual(invoice.total, Decimal('300.00'))
        self.assertEqual(invoice.invoice_type, 'credit')

        # 4) Other retailer cannot access this cart/invoice.
        self.client.force_authenticate(user=self.user_b)
        denied_cart = self.client.get(reverse('cart-detail', args=[cart.id]))
        denied_invoice = self.client.get(reverse('invoice-detail', args=[invoice_id]))
        self.assertEqual(denied_cart.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(denied_invoice.status_code, status.HTTP_404_NOT_FOUND)

        # 5) Owner retailer can read ledger summaries and dashboard KPIs.
        self.client.force_authenticate(user=self.user_a)
        ledger_summary_resp = self.client.get(reverse('ledger-summary'))
        self.assertEqual(ledger_summary_resp.status_code, status.HTTP_200_OK, ledger_summary_resp.data)
        self.assertIn('total_credit', ledger_summary_resp.data)
        self.assertIn('total_debit', ledger_summary_resp.data)
        self.assertIn('num_accounts', ledger_summary_resp.data)

        kpi_resp = self.client.get(reverse('dashboard-kpis'))
        self.assertEqual(kpi_resp.status_code, status.HTTP_200_OK, kpi_resp.data)
        self.assertIsInstance(kpi_resp.data, dict)
        self.assertGreaterEqual(len(kpi_resp.data.keys()), 1)

        # 6) Validate accounting artifacts exist for owner retailer only.
        self.assertTrue(
            LedgerEntry.objects.filter(invoice_id=invoice_id, customer=self.customer_a).exists()
        )
        self.assertFalse(
            Payment.objects.filter(invoice_id=invoice_id, invoice__retailer_id=self.retailer_b.id).exists()
        )

    def test_mixed_and_cash_payments_reflect_in_kpis(self):
        self.client.force_authenticate(user=self.user_a)

        # Mixed payment invoice.
        cart_mixed = Cart.objects.create(
            retailer=self.retailer_a,
            cart_number='E2E-CART-MIXED',
            store=self.store_a,
            customer=self.customer_a,
            created_by=self.user_a,
            invoice_type='mixed',
            status='active',
        )
        CartItem.objects.create(
            cart=cart_mixed,
            product=self.product_a,
            quantity=Decimal('2.000'),
            unit_price=Decimal('150.00'),
        )
        mixed_resp = self.client.post(
            reverse('cart-checkout', args=[cart_mixed.id]),
            {
                'invoice_type': 'mixed',
                'customer': self.customer_a.id,
                'cash_amount': '120.00',
                'upi_amount': '180.00',
            },
            format='json',
        )
        self.assertEqual(mixed_resp.status_code, status.HTTP_201_CREATED, mixed_resp.data)
        mixed_invoice_id = mixed_resp.data['id']
        mixed_invoice = Invoice.objects.get(pk=mixed_invoice_id)
        self.assertEqual(mixed_invoice.total, Decimal('300.00'))

        mixed_payments = Payment.objects.filter(invoice_id=mixed_invoice_id).order_by('payment_method')
        self.assertEqual(mixed_payments.count(), 2)
        by_method = {p.payment_method: p.amount for p in mixed_payments}
        self.assertEqual(by_method.get('cash'), Decimal('120.00'))
        self.assertEqual(by_method.get('upi'), Decimal('180.00'))

        # Cash-only invoice.
        cart_cash = Cart.objects.create(
            retailer=self.retailer_a,
            cart_number='E2E-CART-CASH',
            store=self.store_a,
            customer=self.customer_a,
            created_by=self.user_a,
            invoice_type='cash',
            status='active',
        )
        CartItem.objects.create(
            cart=cart_cash,
            product=self.product_a,
            quantity=Decimal('1.000'),
            unit_price=Decimal('200.00'),
        )
        cash_resp = self.client.post(
            reverse('cart-checkout', args=[cart_cash.id]),
            {'invoice_type': 'cash', 'customer': self.customer_a.id},
            format='json',
        )
        self.assertEqual(cash_resp.status_code, status.HTTP_201_CREATED, cash_resp.data)
        cash_invoice_id = cash_resp.data['id']
        cash_payments = Payment.objects.filter(invoice_id=cash_invoice_id)
        self.assertEqual(cash_payments.count(), 1)
        self.assertEqual(cash_payments.first().payment_method, 'cash')
        self.assertEqual(cash_payments.first().amount, Decimal('200.00'))

        # Dashboard KPI should include payment aggregates with cash and upi methods.
        kpi_resp = self.client.get(reverse('dashboard-kpis'))
        self.assertEqual(kpi_resp.status_code, status.HTTP_200_OK, kpi_resp.data)
        self.assertIn('kpis', kpi_resp.data)
        self.assertIn('payments_by_method', kpi_resp.data)
        self.assertIn('total_payments', kpi_resp.data['kpis'])
        self.assertGreaterEqual(Decimal(str(kpi_resp.data['kpis']['total_payments'])), Decimal('500.00'))

        methods = {row.get('payment_method') for row in (kpi_resp.data.get('payments_by_method') or [])}
        self.assertIn('cash', methods)
        self.assertIn('upi', methods)


class DashboardBlocksInUserMeTests(APITestCase):
    def setUp(self):
        self.retailer = Retailer.objects.create(code='DBCFG', name='Dashboard Config Retailer', is_active=True)
        self.user = User.objects.create_user(
            username='dashboard_cfg_user',
            password='testpass123',
            retailer=self.retailer,
            is_staff=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_user_me_returns_retailer_dashboard_blocks(self):
        RetailerDashboardViewConfig.objects.create(
            retailer=self.retailer,
            block_visibility={
                'profits': False,
                'stockAndDefective': True,
                'wholesalePendingCleared': False,
            },
        )
        resp = self.client.get(reverse('user-me'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIn('dashboard_blocks', resp.data)
        self.assertEqual(resp.data['dashboard_blocks'].get('profits'), False)
        self.assertEqual(resp.data['dashboard_blocks'].get('stockAndDefective'), True)
        self.assertEqual(resp.data['dashboard_blocks'].get('wholesalePendingCleared'), False)

    def test_user_me_applies_limited_defaults_for_non_manish_retailer(self):
        resp = self.client.get(reverse('user-me'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        blocks = resp.data.get('dashboard_blocks') or {}
        self.assertEqual(blocks.get('profits'), False)
        self.assertEqual(blocks.get('kpi.totalPending'), False)
        self.assertEqual(blocks.get('kpi.totalCredit'), False)
        self.assertEqual(blocks.get('kpi.overallProfit'), True)

    def test_user_me_keeps_full_defaults_for_manish_traders(self):
        manish = Retailer.objects.create(code='MANISH_TRADERS', name='Manish Traders', is_active=True)
        manish_user = User.objects.create_user(
            username='manish_dashboard_user',
            password='testpass123',
            retailer=manish,
            is_staff=True,
        )
        self.client.force_authenticate(user=manish_user)
        resp = self.client.get(reverse('user-me'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data.get('dashboard_blocks'), {})
