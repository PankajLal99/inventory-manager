"""
Comprehensive dashboard KPI fixture: invoices + repairs with margin randomized (seeded).

Run with KPI dump:
  PRINT_DASHBOARD_KPI=1 python manage.py test backend.reports.test_dashboard_comprehensive.DashboardComprehensiveScenarioTest.test_dashboard_kpis_full_matrix --verbosity=1

Random seed is fixed (42) so line-level prices and dashboard totals are reproducible.

Example snapshot (same calendar day as test run, seed=42, PostgreSQL/SQLite may match):
  total_cash 2590.73   total_upi 2587.22   total_credit 2006.86   total_pending 1922.74
  total_inhand 2590.73   counter_profit 284.15   repair_profit 667.34   overall_profit 951.49
  Repair profit only includes repair jobs with status done|delivered (invoice not draft, type not pending).
"""
import json
import os
import uuid
from decimal import Decimal
from typing import Optional

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient
from backend.locations.models import Store
from backend.pos.models import Invoice, InvoiceItem, Payment, Repair

PRINT_KPI = os.environ.get('PRINT_DASHBOARD_KPI', '')


def _margin_cut_sell_unit(purchase: Decimal, rng) -> Decimal:
    """Selling unit price: purchase + (margin * random factor), margin ~45% of purchase, factor in [0.5, 1.0]."""
    base_margin = purchase * Decimal('0.45')
    factor = Decimal(str(rng.uniform(0.5, 1.0)))
    unit = (purchase + base_margin * factor).quantize(Decimal('0.01'))
    return unit


def _save_invoice_totals(inv: Invoice, subtotal: Decimal, paid: Optional[Decimal] = None):
    inv.subtotal = subtotal
    inv.total = subtotal
    if paid is not None:
        inv.paid_amount = paid
        inv.due_amount = subtotal - paid
    inv.save(update_fields=['subtotal', 'total', 'paid_amount', 'due_amount'])


def _add_two_products(inv: Invoice, products: tuple, rng) -> Decimal:
    """Add two line items; return invoice line sum."""
    total = Decimal('0.00')
    for p in products:
        purchase = Decimal(str(rng.randint(55, 130)))
        unit = _margin_cut_sell_unit(purchase, rng)
        qty = Decimal('1')
        lt = (unit * qty).quantize(Decimal('0.01'))
        InvoiceItem.objects.create(
            invoice=inv,
            product=p,
            quantity=qty,
            unit_price=unit,
            line_total=lt,
            purchase_price=purchase,
        )
        total += lt
    return total


class DashboardComprehensiveScenarioTest(TestCase):
    """Retail + wholesale counter invoices and repair-shop matrix (all repair statuses × invoice types)."""

    def setUp(self):
        cache.clear()
        self.rng = __import__('random').Random(42)
        self.user = TestDataFactory.create_user()
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.customer = TestDataFactory.create_customer()
        self.products = (TestDataFactory.create_product(), TestDataFactory.create_product())

        self.retail_store = TestDataFactory.create_store()
        self.retail_store.shop_type = 'retail'
        self.retail_store.save(update_fields=['shop_type'])

        self.wholesale_store = Store.objects.create(
            name=f'WS_{TestDataFactory.random_string(4)}',
            code=f'WS_{TestDataFactory.random_string(6)}',
            shop_type='wholesale',
        )

        self.repair_store = Store.objects.create(
            name=f'RP_{TestDataFactory.random_string(4)}',
            code=f'RP_{TestDataFactory.random_string(6)}',
            shop_type='repair',
        )

    def _mk_counter(self, store, invoice_type: str, status: str) -> Invoice:
        inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=store,
            invoice_type=invoice_type,
            status=status,
        )
        line_sum = _add_two_products(inv, self.products, self.rng)
        if status == 'credit' and invoice_type == 'credit':
            _save_invoice_totals(inv, line_sum, paid=Decimal('0.00'))
        elif status == 'draft':
            _save_invoice_totals(inv, line_sum, paid=Decimal('0.00'))
        elif invoice_type == 'mixed' and status == 'paid':
            _save_invoice_totals(inv, line_sum, paid=line_sum)
            half = (line_sum / Decimal('2')).quantize(Decimal('0.01'))
            rest = line_sum - half
            Payment.objects.create(
                invoice=inv, payment_method='cash', amount=half, created_by=self.user
            )
            Payment.objects.create(
                invoice=inv, payment_method='upi', amount=rest, created_by=self.user
            )
        else:
            paid = line_sum if status == 'paid' else Decimal('0.00')
            _save_invoice_totals(inv, line_sum, paid=paid)
        return inv

    def _mk_repair_invoice(
        self,
        invoice_type: str,
        invoice_status: str,
        repair_status: str,
    ) -> Invoice:
        inv = TestDataFactory.create_invoice(
            user=self.user,
            customer=self.customer,
            store=self.repair_store,
            invoice_type=invoice_type,
            status=invoice_status,
        )
        line_sum = _add_two_products(inv, self.products, self.rng)

        if invoice_type == 'mixed' and invoice_status == 'paid':
            _save_invoice_totals(inv, line_sum, paid=line_sum)
            half = (line_sum / Decimal('2')).quantize(Decimal('0.01'))
            Payment.objects.create(
                invoice=inv, payment_method='cash', amount=half, created_by=self.user
            )
            Payment.objects.create(
                invoice=inv, payment_method='upi', amount=line_sum - half, created_by=self.user
            )
        elif invoice_type == 'credit' and invoice_status in ('credit', 'paid'):
            _save_invoice_totals(
                inv,
                line_sum,
                paid=Decimal('0.00') if invoice_status == 'credit' else line_sum,
            )
        else:
            paid = line_sum if invoice_status == 'paid' else Decimal('0.00')
            _save_invoice_totals(inv, line_sum, paid=paid)

        Repair.objects.create(
            invoice=inv,
            contact_no='9999999999',
            model_name='Test device',
            description='Comprehensive test repair',
            barcode=f'REP-TEST-{uuid.uuid4().hex[:12]}',
            status=repair_status,
            delivery_date=timezone.now().date(),
        )
        return inv

    def test_dashboard_kpis_full_matrix(self):
        """
        Counter (retail): cash, upi, mixed, credit, draft+pending, defective — each with two products.
        Counter (wholesale): cash paid + two products.
        Repair shop: every Repair.STATUS × every Invoice.INVOICE_TYPE (36), two products each.
        Invoice statuses chosen so KPI paths are exercised (paid/credit/draft as appropriate).
        """
        # --- Retail counter ---
        self._mk_counter(self.retail_store, 'cash', 'paid')
        self._mk_counter(self.retail_store, 'upi', 'paid')
        self._mk_counter(self.retail_store, 'mixed', 'paid')
        self._mk_counter(self.retail_store, 'credit', 'credit')
        self._mk_counter(self.retail_store, 'pending', 'draft')
        self._mk_counter(self.retail_store, 'defective', 'paid')

        # --- Wholesale ---
        self._mk_counter(self.wholesale_store, 'cash', 'paid')

        repair_statuses = [c[0] for c in Repair.STATUS_CHOICES]
        invoice_types = [c[0] for c in Invoice.INVOICE_TYPE_CHOICES]

        for rs in repair_statuses:
            for it in invoice_types:
                if it == 'pending':
                    inv_st = 'draft'
                elif it == 'credit':
                    inv_st = 'credit'
                else:
                    inv_st = 'paid'
                self._mk_repair_invoice(it, inv_st, rs)

        today = timezone.now().date().isoformat()
        response = self.client.get(
            f'/api/v1/reports/dashboard-kpis/?date_from={today}&date_to={today}'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        kpis = response.data['kpis']

        self.assertGreater(kpis['total_cash'], 0)
        self.assertGreater(kpis['counter_profit'], 0)
        self.assertIn('repair_profit', kpis)
        self.assertIn('total_pending', kpis)

        if PRINT_KPI:
            dump = {
                'kpis': kpis,
                'overall_profit_billing_period_window': response.data.get(
                    'overall_profit_billing_period_window'
                ),
                'total_pending_by_store_len': len(response.data.get('total_pending_by_store') or []),
                'repair_profit_by_invoice_type': response.data.get('repair_profit_by_invoice_type'),
                'counter_profit_by_invoice_type': response.data.get('counter_profit_by_invoice_type'),
            }
            print('\n=== DASHBOARD KPI SNAPSHOT (seed=42) ===')
            print(json.dumps(dump, indent=2, default=str))
