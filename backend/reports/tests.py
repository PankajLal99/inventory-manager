"""
Comprehensive test suite for Reports module
Tests: Sales Summary, Top Products, Inventory Summary, Revenue, Customers, Stock Ordering
"""
from django.test import TestCase
from rest_framework import status
from django.utils import timezone
from decimal import Decimal
from django.core.cache import cache
from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient
from backend.pos.models import Payment, Expenses
from backend.parties.models import LedgerEntry


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

    def test_dashboard_kpis_cash_online_expense_inhand_formula(self):
        """Dashboard should combine POS + manual ledger credits and subtract expenses from cash."""
        invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='paid'
        )
        Payment.objects.create(invoice=invoice, payment_method='cash', amount=Decimal('100.00'), created_by=self.user)
        Payment.objects.create(invoice=invoice, payment_method='upi', amount=Decimal('40.00'), created_by=self.user)

        # Manual receipt entries (Payments page) should contribute by payment_mode.
        LedgerEntry.objects.create(
            customer=self.customer,
            invoice=None,
            entry_type='credit',
            payment_mode='cash',
            amount=Decimal('25.00'),
            created_by=self.user,
            created_at=timezone.now()
        )
        LedgerEntry.objects.create(
            customer=self.customer,
            invoice=None,
            entry_type='credit',
            payment_mode='upi',
            amount=Decimal('10.00'),
            created_by=self.user,
            created_at=timezone.now()
        )

        Expenses.objects.create(
            expense_date=timezone.now().date(),
            expense_type='rent',
            payment_choices_type='CASH',
            expense_amount=20.0,
            created_by=self.user,
            last_updated_by=self.user
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']

        self.assertEqual(kpis['total_cash'], 125.0)      # 100 + 25
        self.assertEqual(kpis['total_online'], 50.0)     # 40 + 10
        self.assertEqual(kpis['total_expenses'], 20.0)
        self.assertEqual(kpis['total_inhand'], 105.0)    # total_cash - expenses

    def test_dashboard_kpis_excludes_void_and_manish_traders_loss_pos_payments(self):
        """Dashboard should exclude POS payments from void invoices and internal loss customer."""
        normal_invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='paid'
        )
        void_invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='cash',
            status='void'
        )
        loss_customer = TestDataFactory.create_customer(
            name='Manish Traders Loss',
            phone=f"8{timezone.now().strftime('%H%M%S%f')[:9]}"
        )
        loss_invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=loss_customer,
            store=self.store,
            invoice_type='cash',
            status='paid'
        )

        Payment.objects.create(invoice=normal_invoice, payment_method='cash', amount=Decimal('70.00'), created_by=self.user)
        Payment.objects.create(invoice=void_invoice, payment_method='cash', amount=Decimal('999.00'), created_by=self.user)
        Payment.objects.create(invoice=loss_invoice, payment_method='cash', amount=Decimal('888.00'), created_by=self.user)

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']

        self.assertEqual(kpis['total_cash'], 70.0)

    def test_dashboard_kpis_repair_cash_upi_invoice_and_payment_breakdown(self):
        """Dashboard should return repair invoice-type and payment-method cash/upi breakdown."""
        repair_store = TestDataFactory.create_store(code=f"RPR_{TestDataFactory.random_string(6).upper()}")
        repair_store.shop_type = 'repair'
        repair_store.save(update_fields=['shop_type'])

        retail_store = TestDataFactory.create_store(code=f"RTL_{TestDataFactory.random_string(6).upper()}")
        retail_store.shop_type = 'retail'
        retail_store.save(update_fields=['shop_type'])

        repair_cash_invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=repair_store,
            invoice_type='cash',
            status='paid'
        )
        repair_cash_invoice.total = Decimal('150.00')
        repair_cash_invoice.save(update_fields=['total'])

        repair_upi_invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=repair_store,
            invoice_type='upi',
            status='paid'
        )
        repair_upi_invoice.total = Decimal('220.00')
        repair_upi_invoice.save(update_fields=['total'])

        retail_invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=retail_store,
            invoice_type='cash',
            status='paid'
        )
        retail_invoice.total = Decimal('500.00')
        retail_invoice.save(update_fields=['total'])

        # Repair payments received by method (can differ from invoice_type in real life partials/splits).
        Payment.objects.create(invoice=repair_cash_invoice, payment_method='cash', amount=Decimal('100.00'), created_by=self.user)
        Payment.objects.create(invoice=repair_cash_invoice, payment_method='upi', amount=Decimal('50.00'), created_by=self.user)
        Payment.objects.create(invoice=repair_upi_invoice, payment_method='upi', amount=Decimal('220.00'), created_by=self.user)

        # Non-repair payment should not affect repair-only breakdown.
        Payment.objects.create(invoice=retail_invoice, payment_method='cash', amount=Decimal('500.00'), created_by=self.user)

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']

        self.assertEqual(kpis['repair_invoice_cash_total'], 150.0)
        self.assertEqual(kpis['repair_invoice_upi_total'], 220.0)
        self.assertEqual(kpis['repair_invoice_cash_count'], 1)
        self.assertEqual(kpis['repair_invoice_upi_count'], 1)

        self.assertEqual(kpis['repair_payment_cash_total'], 100.0)
        self.assertEqual(kpis['repair_payment_upi_total'], 270.0)
        self.assertEqual(kpis['repair_payment_cash_count'], 1)
        self.assertEqual(kpis['repair_payment_upi_count'], 2)

    def test_dashboard_kpis_includes_cash_upi_contribution_rows(self):
        """Dashboard should return invoice/manual contribution rows for cash and UPI."""
        invoice = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.store,
            invoice_type='mixed',
            status='paid'
        )
        Payment.objects.create(invoice=invoice, payment_method='cash', amount=Decimal('120.00'), created_by=self.user)
        Payment.objects.create(invoice=invoice, payment_method='upi', amount=Decimal('80.00'), created_by=self.user)

        LedgerEntry.objects.create(
            customer=self.customer,
            invoice=None,
            entry_type='credit',
            payment_mode='cash',
            amount=Decimal('10.00'),
            created_by=self.user,
            created_at=timezone.now()
        )
        LedgerEntry.objects.create(
            customer=self.customer,
            invoice=None,
            entry_type='credit',
            payment_mode='upi',
            amount=Decimal('25.00'),
            created_by=self.user,
            created_at=timezone.now()
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        contributions = response.data.get('cash_online_contributions', {})
        cash_data = contributions.get('cash', {})
        upi_data = contributions.get('upi', {})

        self.assertTrue(len(cash_data.get('invoice_payments', [])) >= 1)
        self.assertTrue(len(upi_data.get('invoice_payments', [])) >= 1)
        self.assertTrue(len(cash_data.get('manual_payments', [])) >= 1)
        self.assertTrue(len(upi_data.get('manual_payments', [])) >= 1)

        first_cash_invoice_payment = cash_data['invoice_payments'][0]
        self.assertEqual(first_cash_invoice_payment['invoice_number'], invoice.invoice_number)
        self.assertEqual(first_cash_invoice_payment['party_name'], self.customer.name)

    def test_dashboard_kpis_handles_mixed_manual_payment_split(self):
        """Mixed manual ledger payments should split into cash and UPI totals and contribution rows."""
        mixed_entry = LedgerEntry.objects.create(
            customer=self.customer,
            invoice=None,
            entry_type='credit',
            payment_mode='mixed',
            cash_amount=Decimal('30.00'),
            upi_amount=Decimal('70.00'),
            amount=Decimal('100.00'),
            created_by=self.user,
            created_at=timezone.now()
        )

        response = self.client.get('/api/v1/reports/dashboard-kpis/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        kpis = response.data['kpis']
        self.assertEqual(kpis['total_cash'], 30.0)
        self.assertEqual(kpis['total_online'], 70.0)

        contributions = response.data.get('cash_online_contributions', {})
        cash_manual = contributions.get('cash', {}).get('manual_payments', [])
        upi_manual = contributions.get('upi', {}).get('manual_payments', [])

        self.assertTrue(any(row.get('id') == mixed_entry.id and row.get('amount') == 30.0 for row in cash_manual))
        self.assertTrue(any(row.get('id') == mixed_entry.id and row.get('amount') == 70.0 for row in upi_manual))
