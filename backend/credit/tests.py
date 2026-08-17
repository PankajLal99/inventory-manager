from datetime import datetime, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from backend.core.test_utils import AuthenticatedAPIClient, TestDataFactory
from backend.credit.customer_sync import sync_linked_credit_customers_from_party
from backend.credit.ledger_sync import sync_main_ledger_payment
from backend.credit.models import (
    CreditCustomer,
    CreditInvoice,
    CreditLedgerEntry,
    CreditPayment,
    CreditReturn,
)
from backend.parties.models import Customer, CustomerGroup, LedgerEntry


class PartyCreditCustomerSyncTest(TestCase):
    def test_party_save_syncs_linked_credit_customer(self):
        group = CustomerGroup.objects.create(name='Retail Sync Test')
        party = Customer.objects.create(
            name='VIJAY BHAI',
            phone='9000001234',
            email='vijay@example.com',
            address='Main Road',
            customer_group=group,
            is_active=True,
        )
        credit = CreditCustomer.objects.create(
            name='VIJAY BHAI',
            phone='9000001234',
            linked_customer=party,
            is_active=True,
        )

        party.name = 'VIJAY BHAI KURAWAR'
        party.phone = '9000009999'
        party.email = 'new@example.com'
        party.address = 'New Address'
        party.is_active = False
        party.save()

        credit.refresh_from_db()
        self.assertEqual(credit.name, 'VIJAY BHAI KURAWAR')
        self.assertEqual(credit.phone, '9000009999')
        self.assertEqual(credit.email, 'new@example.com')
        self.assertEqual(credit.address, 'New Address')
        self.assertFalse(credit.is_active)
        self.assertEqual(credit.customer_group_id, group.id)

    def test_unlinked_credit_customer_is_not_updated(self):
        party = Customer.objects.create(name='Party Only', phone='9111111111')
        credit = CreditCustomer.objects.create(name='Credit Only', phone='9222222222')

        updated = sync_linked_credit_customers_from_party(party)

        self.assertEqual(updated, 0)
        credit.refresh_from_db()
        self.assertEqual(credit.name, 'Credit Only')
        self.assertEqual(credit.phone, '9222222222')


class CreditLedgerStatementOrderTests(TestCase):
    """Statement merges every source into one list, then sorts by event datetime."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
        self.store = TestDataFactory.create_store()
        self.customer = CreditCustomer.objects.create(name='Khata Test', phone='9000000001')
        self.tz = timezone.get_current_timezone()

    def _at(self, year, month, day, hour, minute=0):
        return timezone.make_aware(datetime(year, month, day, hour, minute), self.tz)

    def test_merges_all_sources_and_sorts_by_event_datetime(self):
        written_now = timezone.now()

        # Insert newest-looking ledger rows first so SQL created_at order would be wrong.
        mistake = CreditLedgerEntry.objects.create(
            customer=self.customer,
            entry_type='debit',
            amount=Decimal('50.00'),
            description='DOUBLE BILL MISTAKE',
            created_at=self._at(2026, 8, 11, 18, 20),
        )

        ret = CreditReturn.objects.create(
            return_number='CRRET-TEST-1',
            store=self.store,
            customer=self.customer,
            total=Decimal('20.00'),
            created_at=self._at(2026, 8, 10, 12, 0),
        )
        CreditLedgerEntry.objects.create(
            customer=self.customer,
            credit_return=ret,
            entry_type='credit',
            amount=Decimal('20.00'),
            created_at=written_now,
        )

        same_day_pay = CreditPayment.objects.create(
            customer=self.customer,
            payment_method='upi',
            amount=Decimal('30.00'),
            upi_amount=Decimal('30.00'),
            cash_amount=Decimal('0.00'),
            paid_at=self._at(2026, 8, 8, 16, 45),
        )
        CreditLedgerEntry.objects.create(
            customer=self.customer,
            payment=same_day_pay,
            entry_type='credit',
            amount=Decimal('30.00'),
            created_at=written_now,
        )

        sale_same_day = CreditInvoice.objects.create(
            invoice_number='CR-TEST-SAME',
            store=self.store,
            customer=self.customer,
            total=Decimal('80.00'),
            created_at=self._at(2026, 8, 8, 11, 0),
        )
        CreditLedgerEntry.objects.create(
            customer=self.customer,
            invoice=sale_same_day,
            entry_type='debit',
            amount=Decimal('80.00'),
            created_at=written_now,
        )

        sale = CreditInvoice.objects.create(
            invoice_number='CR-TEST-SALE',
            store=self.store,
            customer=self.customer,
            total=Decimal('100.00'),
            created_at=self._at(2026, 8, 4, 14, 15),
        )
        CreditLedgerEntry.objects.create(
            customer=self.customer,
            invoice=sale,
            entry_type='debit',
            amount=Decimal('100.00'),
            created_at=written_now,
        )

        first_pay = CreditPayment.objects.create(
            customer=self.customer,
            payment_method='upi',
            amount=Decimal('40.00'),
            upi_amount=Decimal('40.00'),
            cash_amount=Decimal('0.00'),
            paid_at=self._at(2026, 8, 1, 9, 30),
        )
        CreditLedgerEntry.objects.create(
            customer=self.customer,
            payment=first_pay,
            entry_type='credit',
            amount=Decimal('40.00'),
            created_at=written_now,
        )

        CreditLedgerEntry.objects.create(
            customer=self.customer,
            entry_type='debit',
            amount=Decimal('200.00'),
            description='Opening Balance',
            created_at=self._at(2026, 7, 24, 10, 0),
        )

        response = self.client.get(
            f'/api/v1/credit/ledger/statement/?customer={self.customer.id}'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        particulars = [row['particulars'] for row in response.data['rows']]
        self.assertEqual(
            particulars,
            [
                'Opening Balance',
                'Cr UPI',
                'Dr Sales',
                'Dr Sales',
                'Cr UPI',
                'Cr Return',
                'DOUBLE BILL MISTAKE',
            ],
        )
        # Same calendar day still ordered by clock time (sale 11:00 before UPI 16:45).
        self.assertEqual(response.data['rows'][3]['txn_type'], 'sale')
        self.assertEqual(response.data['rows'][4]['txn_type'], 'payment')
        self.assertEqual(response.data['rows'][-1]['id'], mistake.id)


class MainLedgerSentSyncTimestampTests(TestCase):
    """Payments-page Sent should post credit at 12:00 AM on the click day."""

    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.party = Customer.objects.create(name='VIJAY ❤', phone='9000007777')
        CreditCustomer.objects.create(
            name='VIJAY ❤',
            phone='9000007777',
            linked_customer=self.party,
            is_active=True,
        )

    def _midnight_today(self):
        now = timezone.localtime(timezone.now())
        return now.replace(hour=0, minute=0, second=0, microsecond=0)

    def test_sent_payment_is_stamped_at_local_midnight_today(self):
        yesterday_afternoon = timezone.localtime(timezone.now()).replace(
            hour=15, minute=30, second=0, microsecond=0
        ) - timedelta(days=1)
        entry = LedgerEntry.objects.create(
            customer=self.party,
            entry_type='credit',
            payment_mode='cash',
            amount=Decimal('500.00'),
            description='Manual payment',
            is_sent=True,
            created_by=self.user,
            created_at=yesterday_afternoon,
        )

        sync_main_ledger_payment(entry, self.user)

        payment = CreditPayment.objects.get(source_ledger_entry_id=entry.id)
        ledger_row = CreditLedgerEntry.objects.get(payment=payment)
        expected = self._midnight_today()
        self.assertEqual(timezone.localtime(payment.paid_at), expected)
        self.assertEqual(timezone.localtime(ledger_row.created_at), expected)
        self.assertNotEqual(timezone.localtime(payment.paid_at), yesterday_afternoon)

    def test_rebuild_keeps_original_sent_midnight(self):
        entry = LedgerEntry.objects.create(
            customer=self.party,
            entry_type='credit',
            payment_mode='cash',
            amount=Decimal('200.00'),
            is_sent=True,
            created_by=self.user,
        )
        sync_main_ledger_payment(entry, self.user)
        original_paid_at = CreditPayment.objects.get(source_ledger_entry_id=entry.id).paid_at

        entry.amount = Decimal('250.00')
        entry.save(update_fields=['amount'])
        sync_main_ledger_payment(entry, self.user)

        payment = CreditPayment.objects.get(source_ledger_entry_id=entry.id)
        self.assertEqual(payment.paid_at, original_paid_at)
        self.assertEqual(payment.amount, Decimal('250.00'))
