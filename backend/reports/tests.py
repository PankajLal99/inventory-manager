"""
Comprehensive test suite for Reports module
Tests: Sales Summary, Top Products, Inventory Summary, Revenue, Customers, Stock Ordering
"""
from django.test import TestCase
from rest_framework import status
from datetime import timedelta
from django.utils import timezone
from decimal import Decimal
from django.core.cache import cache
from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient
from backend.pos.models import Expenses, Payment, InvoiceItem
from backend.catalog.models import DefectiveProductMoveOut


class ReportsTests(TestCase):
    """Test report endpoints"""
    
    def setUp(self):
        cache.clear()
        self.user = TestDataFactory.create_user()
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.store = TestDataFactory.create_store()
        self.customer = TestDataFactory.create_customer()
    
    def test_sales_summary(self):
        """Test sales summary report"""
        response = self.client.get('/api/v1/reports/sales-summary/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, dict)
    
    def test_sales_summary_with_date_range(self):
        """Test sales summary with date range"""
        response = self.client.get('/api/v1/reports/sales-summary/?date_from=2024-01-01&date_to=2024-12-31')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_top_products(self):
        """Test top products report"""
        response = self.client.get('/api/v1/reports/top-products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, (list, dict))
    
    def test_inventory_summary(self):
        """Test inventory summary report"""
        response = self.client.get('/api/v1/reports/inventory-summary/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, dict)
    
    def test_revenue_report(self):
        """Test revenue report"""
        response = self.client.get('/api/v1/reports/revenue/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, dict)
    
    def test_customer_summary(self):
        """Test customer summary report"""
        response = self.client.get('/api/v1/reports/customers/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, (list, dict))
    
    def test_stock_ordering_report(self):
        """Test stock ordering report"""
        response = self.client.get('/api/v1/reports/stock-ordering/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, (list, dict))

    def test_dashboard_kpis_invoice_totals_cash_upi_expenses_inhand(self):
        """Dashboard sums Invoice.total for cash/upi types, expenses, and inhand = cash - expenses."""
        cash_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='paid',
        )
        cash_inv.total = Decimal('100.00')
        cash_inv.save(update_fields=['total'])

        upi_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='upi',
            status='paid',
        )
        upi_inv.total = Decimal('40.00')
        upi_inv.save(update_fields=['total'])

        Expenses.objects.create(
            expense_date=timezone.now().date(),
            expense_type='rent',
            payment_choices_type='CASH',
            expense_amount=20.0,
            created_by=self.user,
            last_updated_by=self.user,
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']

        self.assertEqual(kpis['total_cash'], 100.0)
        self.assertEqual(kpis['total_upi'], 40.0)
        self.assertEqual(kpis['total_credit'], 0.0)
        self.assertEqual(kpis['cash_from_mixed'], 0.0)
        self.assertEqual(kpis['upi_from_mixed'], 0.0)
        self.assertEqual(kpis['total_expenses'], 20.0)
        self.assertEqual(kpis['total_inhand'], 80.0)
        self.assertEqual(kpis['total_payments'], 0.0)
        self.assertEqual(response.data['payments_by_method'], [])
        self.assertEqual(kpis['pending_invoice_purchase_total'], 0.0)
        self.assertEqual(response.data['pending_purchase_by_store'], [])
        self.assertIn('counter_profit', kpis)
        self.assertIn('repair_profit', kpis)
        self.assertIn('overall_profit', kpis)
        self.assertEqual(kpis['counter_profit'], kpis['overall_profit'] - kpis['repair_profit'])
        self.assertIn('stock_value', kpis)
        self.assertIn('defective_move_out_net_loss', kpis)
        self.assertIn('defective_move_out_net_period', kpis)

        self.assertIsInstance(response.data.get('counter_profit_by_store'), list)
        self.assertIsInstance(response.data.get('counter_profit_by_invoice_type'), list)
        cp = float(kpis['counter_profit'])
        sum_by_store = sum(float(r['amount']) for r in response.data['counter_profit_by_store'])
        sum_by_type = sum(float(r['profit']) for r in response.data['counter_profit_by_invoice_type'])
        self.assertAlmostEqual(sum_by_store, cp, places=5)
        self.assertAlmostEqual(sum_by_type, cp, places=5)

        self.assertEqual(len(response.data['cash_by_store']), 1)
        self.assertEqual(response.data['cash_by_store'][0]['amount'], 100.0)
        self.assertEqual(response.data['cash_by_store'][0]['from_invoice_cash'], 100.0)
        self.assertEqual(response.data['cash_by_store'][0]['from_mixed_cash'], 0.0)
        self.assertEqual(len(response.data['upi_by_store']), 1)
        self.assertEqual(response.data['upi_by_store'][0]['amount'], 40.0)
        self.assertEqual(response.data['upi_by_store'][0]['from_invoice_upi'], 40.0)
        self.assertEqual(response.data['upi_by_store'][0]['from_mixed_upi'], 0.0)
        self.assertEqual(response.data['credit_by_store'], [])

    def test_dashboard_kpis_excludes_void_and_draft_invoices(self):
        """Void and draft invoices are excluded from cash/upi totals."""
        paid = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='paid',
        )
        paid.total = Decimal('50.00')
        paid.save(update_fields=['total'])

        void_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='void',
        )
        void_inv.total = Decimal('999.00')
        void_inv.save(update_fields=['total'])

        draft_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='draft',
        )
        draft_inv.total = Decimal('888.00')
        draft_inv.save(update_fields=['total'])

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['total_cash'], 50.0)

    def test_dashboard_kpis_mixed_invoice_splits_via_payments(self):
        """Mixed invoices contribute cash/UPI totals from Payment rows, not Invoice.total alone."""
        mixed = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='mixed',
            status='paid',
        )
        mixed.total = Decimal('100.00')
        mixed.save(update_fields=['total'])
        Payment.objects.create(
            invoice=mixed, payment_method='cash', amount=Decimal('65.00'), created_by=self.user
        )
        Payment.objects.create(
            invoice=mixed, payment_method='upi', amount=Decimal('35.00'), created_by=self.user
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']
        self.assertEqual(kpis['total_cash'], 65.0)
        self.assertEqual(kpis['total_upi'], 35.0)
        self.assertEqual(kpis['cash_from_mixed'], 65.0)
        self.assertEqual(kpis['upi_from_mixed'], 35.0)
        self.assertEqual(kpis['cash_from_invoice_type_cash'], 0.0)
        self.assertEqual(kpis['upi_from_invoice_type_upi'], 0.0)

        row = response.data['cash_by_store'][0]
        self.assertEqual(row['from_mixed_cash'], 65.0)
        self.assertEqual(row['from_invoice_cash'], 0.0)
        row_u = response.data['upi_by_store'][0]
        self.assertEqual(row_u['from_mixed_upi'], 35.0)
        self.assertEqual(row_u['from_invoice_upi'], 0.0)

        self.assertEqual(kpis['total_payments'], 100.0)
        pm = {r['payment_method']: r['amount'] for r in response.data['payments_by_method']}
        self.assertEqual(pm.get('cash'), 65.0)
        self.assertEqual(pm.get('upi'), 35.0)

    def test_dashboard_kpis_payments_exclude_void_invoice(self):
        """POS Payment rows on void invoices do not count toward dashboard payment totals."""
        void_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='void',
        )
        void_inv.total = Decimal('999.00')
        void_inv.save(update_fields=['total'])
        Payment.objects.create(
            invoice=void_inv, payment_method='cash', amount=Decimal('999.00'), created_by=self.user
        )

        paid_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='paid',
        )
        paid_inv.total = Decimal('10.00')
        paid_inv.save(update_fields=['total'])
        Payment.objects.create(
            invoice=paid_inv, payment_method='cash', amount=Decimal('10.00'), created_by=self.user
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['total_payments'], 10.0)
        self.assertEqual(len(response.data['payments_by_method']), 1)
        self.assertEqual(response.data['payments_by_method'][0]['payment_method'], 'cash')
        self.assertEqual(response.data['payments_by_method'][0]['amount'], 10.0)

    def test_dashboard_kpis_credit_by_store(self):
        """Credit invoice type sums Invoice.total by store."""
        cred = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='credit',
            status='credit',
        )
        cred.total = Decimal('250.00')
        cred.save(update_fields=['total'])

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['total_credit'], 250.0)
        self.assertEqual(len(response.data['credit_by_store']), 1)
        self.assertEqual(response.data['credit_by_store'][0]['amount'], 250.0)

    def test_dashboard_kpis_pending_invoice_purchase_cost_by_store(self):
        """Pending invoices: Σ purchase cost on lines (purchase_item unit_price × qty or purchase_price × qty)."""
        product = TestDataFactory.create_product()
        pending_inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='pending',
            status='pending',
        )
        InvoiceItem.objects.create(
            invoice=pending_inv,
            product=product,
            quantity=Decimal('2'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('200.00'),
            purchase_price=Decimal('35.50'),
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['pending_invoice_purchase_total'], 71.0)
        self.assertEqual(len(response.data['pending_purchase_by_store']), 1)
        row = response.data['pending_purchase_by_store'][0]
        self.assertEqual(row['amount'], 71.0)
        self.assertEqual(row['store_id'], self.store.id)

    def test_dashboard_kpis_stock_value_excludes_draft_purchase_barcodes(self):
        """Stock value sums unit_price per new/returned barcode; draft purchase lines excluded."""
        product = TestDataFactory.create_product()
        purchase_ok = TestDataFactory.create_purchase(user=self.user, status='finalized')
        pi = TestDataFactory.create_purchase_item(
            purchase=purchase_ok,
            product=product,
            unit_price=Decimal('100.00'),
        )
        TestDataFactory.create_barcode(product=product, tag='new', purchase_item=pi)
        TestDataFactory.create_barcode(product=product, tag='returned', purchase_item=pi)

        purchase_draft = TestDataFactory.create_purchase(user=self.user, status='draft')
        pi_draft = TestDataFactory.create_purchase_item(
            purchase=purchase_draft,
            product=product,
            unit_price=Decimal('999.00'),
        )
        TestDataFactory.create_barcode(product=product, tag='new', purchase_item=pi_draft)

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['kpis']['stock_value'], 200.0)

    def test_dashboard_kpis_defective_and_move_out_net(self):
        """Defective counts/value and move-out net (all-time vs period) match catalog models."""
        product = TestDataFactory.create_product()
        purchase = TestDataFactory.create_purchase(user=self.user, status='finalized')
        pi = TestDataFactory.create_purchase_item(
            purchase=purchase,
            product=product,
            unit_price=Decimal('40.00'),
        )
        TestDataFactory.create_barcode(product=product, tag='defective', purchase_item=pi)
        TestDataFactory.create_barcode(product=product, tag='defective', purchase_item=pi)

        DefectiveProductMoveOut.objects.create(
            move_out_number='DEF-DASH-TEST-001',
            store=self.store,
            total_loss=Decimal('100.00'),
            total_adjustment=Decimal('30.00'),
            total_items=2,
        )

        today = timezone.now().date().isoformat()
        response = self.client.get(
            f'/api/v1/reports/dashboard-kpis/?date_from={today}&date_to={today}'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']
        self.assertEqual(kpis['defective_product_count'], 1)
        self.assertEqual(kpis['defective_barcode_count'], 2)
        self.assertEqual(kpis['defective_purchase_value'], 80.0)
        self.assertEqual(kpis['defective_move_out_net_loss'], 70.0)
        self.assertEqual(kpis['defective_move_out_net_period'], 70.0)

        yesterday = (timezone.now().date() - timedelta(days=1)).isoformat()
        response2 = self.client.get(
            f'/api/v1/reports/dashboard-kpis/?date_from={yesterday}&date_to={yesterday}'
        )
        self.assertEqual(response2.data['kpis']['defective_move_out_net_period'], 0.0)
        self.assertEqual(response2.data['kpis']['defective_move_out_net_loss'], 70.0)
