from decimal import Decimal
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone

from backend.parties.models import (
    Customer,
    CustomerGroup,
    LedgerEntry,
    PersonalCustomer,
    PersonalLedgerEntry,
    InternalCustomer,
    InternalLedgerEntry,
)

User = get_user_model()


def create_admin_user():
    """Create a user in the Admin group for ledger access."""
    user = User.objects.create_user(username='admin_ledger', password='testpass123')
    admin_group, _ = Group.objects.get_or_create(name='Admin')
    user.groups.add(admin_group)
    return user


def create_regular_user():
    """Create a user without Admin group (should get 403 on ledger)."""
    return User.objects.create_user(username='regular_user', password='testpass123')


class LedgerAPITestCase(APITestCase):
    """Tests for main Ledger (Vyapaar): list, create, summary, customer detail, get/update/delete entry, totals."""

    def setUp(self):
        self.admin = create_admin_user()
        self.customer = Customer.objects.create(
            name='Test Customer Ledger',
            phone='9999990001',
            credit_balance=Decimal('0.00'),
        )
        self.client.force_authenticate(user=self.admin)

    def test_ledger_list_returns_all_entries_when_no_date_filter(self):
        """Without date_from/date_to, list returns all entries."""
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='Entry 1',
            created_by=self.admin,
            created_at=timezone.now(),
        )
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='debit',
            amount=Decimal('30.00'),
            description='Entry 2',
            created_by=self.admin,
            created_at=timezone.now(),
        )
        url = reverse('ledger-entry-list-create')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)

    def test_ledger_create_credit_updates_customer_balance(self):
        """Creating a credit entry increases customer credit_balance."""
        url = reverse('ledger-entry-list-create')
        data = {
            'customer': self.customer.id,
            'entry_type': 'credit',
            'amount': '150.50',
            'description': 'Test credit',
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, Decimal('150.50'))

    def test_ledger_create_debit_updates_customer_balance(self):
        """Creating a debit entry decreases customer credit_balance."""
        self.customer.credit_balance = Decimal('200.00')
        self.customer.save()
        url = reverse('ledger-entry-list-create')
        data = {
            'customer': self.customer.id,
            'entry_type': 'debit',
            'amount': '50.25',
            'description': 'Test debit',
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, Decimal('149.75'))

    def test_ledger_summary_totals(self):
        """Summary returns correct total_credit, total_debit, num_accounts, balance."""
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='C1',
            created_by=self.admin,
        )
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('50.00'),
            description='C2',
            created_by=self.admin,
        )
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='debit',
            amount=Decimal('30.00'),
            description='D1',
            created_by=self.admin,
        )
        url = reverse('ledger-summary')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(response.data['total_credit']), Decimal('150.00'))
        self.assertEqual(Decimal(response.data['total_debit']), Decimal('30.00'))
        self.assertEqual(response.data['num_accounts'], 1)
        self.assertEqual(Decimal(response.data['balance']), Decimal('120.00'))

    def test_ledger_customer_detail_entries_and_final_balance(self):
        """Customer detail returns entries and correct final_balance (running balance)."""
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='A',
            created_by=self.admin,
        )
        LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='debit',
            amount=Decimal('40.00'),
            description='B',
            created_by=self.admin,
        )
        url = reverse('ledger-customer-detail', kwargs={'customer_id': self.customer.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entries = response.data['entries']
        self.assertEqual(len(entries), 2)
        self.assertEqual(Decimal(response.data['final_balance']), Decimal('60.00'))

    def test_ledger_entry_get_update_delete_and_balance(self):
        """Get entry, update it (amount/type/description), then delete; balance stays correct."""
        entry = LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='Original',
            created_by=self.admin,
        )
        self.customer.credit_balance = Decimal('100.00')
        self.customer.save()

        # GET
        url = reverse('ledger-entry-retrieve-update-destroy', kwargs={'entry_id': entry.id})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(resp.data['amount']), Decimal('100.00'))
        self.assertEqual(resp.data['entry_type'], 'credit')

        # PATCH: change to debit 50 (reverse 100 credit => balance 0, apply 50 debit => balance -50)
        resp = self.client.patch(url, {'entry_type': 'debit', 'amount': '50.00', 'description': 'Updated'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, Decimal('-50.00'))

        # DELETE: reverse debit 50 => balance -50 + 50 = 0
        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_balance, Decimal('0.00'))
        self.assertFalse(LedgerEntry.objects.filter(id=entry.id).exists())

    def test_ledger_non_admin_forbidden(self):
        """Non-admin user gets 403 on ledger list/create/summary/detail/update/delete."""
        self.client.force_authenticate(user=create_regular_user())
        list_url = reverse('ledger-entry-list-create')
        self.assertEqual(self.client.get(list_url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.post(list_url, {'customer': self.customer.id, 'entry_type': 'credit', 'amount': '10'}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(self.client.get(reverse('ledger-summary')).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.get(reverse('ledger-customer-detail', kwargs={'customer_id': self.customer.id})).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        entry = LedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('10.00'),
            description='X',
            created_by=self.admin,
        )
        detail_url = reverse('ledger-entry-retrieve-update-destroy', kwargs={'entry_id': entry.id})
        self.assertEqual(self.client.get(detail_url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.patch(detail_url, {'amount': '20'}, format='json').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.delete(detail_url).status_code, status.HTTP_403_FORBIDDEN)


class PersonalLedgerAPITestCase(APITestCase):
    """Tests for Personal Ledger: list, create, summary, customer detail, get/update/delete entry, totals."""

    def setUp(self):
        self.admin = create_admin_user()
        self.personal_customer = PersonalCustomer.objects.create(
            name='Personal Test',
            phone='9999990002',
            credit_balance=Decimal('0.00'),
        )
        self.client.force_authenticate(user=self.admin)

    def test_personal_ledger_list_all_when_no_date_filter(self):
        """Without date params, list returns all personal ledger entries."""
        PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='credit',
            amount=Decimal('200.00'),
            description='P1',
            created_by=self.admin,
        )
        PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='debit',
            amount=Decimal('60.00'),
            description='P2',
            created_by=self.admin,
        )
        url = reverse('personal-ledger-entry-list-create')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)

    def test_personal_ledger_create_with_customer_key(self):
        """Create entry using 'customer' key (not personal_customer); balance updates."""
        url = reverse('personal-ledger-entry-list-create')
        data = {
            'customer': self.personal_customer.id,
            'entry_type': 'credit',
            'amount': '75.25',
            'description': 'Personal credit',
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data.get('customer_name'), 'Personal Test')
        self.personal_customer.refresh_from_db()
        self.assertEqual(self.personal_customer.credit_balance, Decimal('75.25'))

    def test_personal_ledger_summary_totals(self):
        """Personal ledger summary has correct total_credit, total_debit, num_accounts."""
        PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='A',
            created_by=self.admin,
        )
        PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='debit',
            amount=Decimal('25.00'),
            description='B',
            created_by=self.admin,
        )
        url = reverse('personal-ledger-summary')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(response.data['total_credit']), Decimal('100.00'))
        self.assertEqual(Decimal(response.data['total_debit']), Decimal('25.00'))
        self.assertEqual(response.data['num_accounts'], 1)
        self.assertEqual(Decimal(response.data['balance']), Decimal('75.00'))

    def test_personal_ledger_customer_detail_final_balance(self):
        """Personal ledger customer detail returns entries and final_balance."""
        PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='credit',
            amount=Decimal('80.00'),
            description='X',
            created_by=self.admin,
        )
        PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='debit',
            amount=Decimal('20.00'),
            description='Y',
            created_by=self.admin,
        )
        url = reverse('personal-ledger-customer-detail', kwargs={'customer_id': self.personal_customer.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['entries']), 2)
        self.assertEqual(Decimal(response.data['final_balance']), Decimal('60.00'))

    def test_personal_ledger_entry_update_and_delete_balance(self):
        """Update personal entry then delete; customer balance correct after each step."""
        entry = PersonalLedgerEntry.objects.create(
            customer=self.personal_customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='E',
            created_by=self.admin,
        )
        self.personal_customer.credit_balance = Decimal('100.00')
        self.personal_customer.save()

        url = reverse('personal-ledger-entry-retrieve-update-destroy', kwargs={'entry_id': entry.id})
        # Update to credit 200 (reverse 100 credit => 0, apply 200 credit => 200)
        resp = self.client.patch(url, {'amount': '200.00', 'description': 'Updated'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.personal_customer.refresh_from_db()
        self.assertEqual(self.personal_customer.credit_balance, Decimal('200.00'))

        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.personal_customer.refresh_from_db()
        self.assertEqual(self.personal_customer.credit_balance, Decimal('0.00'))


class InternalLedgerAPITestCase(APITestCase):
    """Tests for Internal (Shop Boys) Ledger: list, create, summary, customer detail, get/update/delete entry, totals."""

    def setUp(self):
        self.admin = create_admin_user()
        self.internal_customer = InternalCustomer.objects.create(
            name='Shop Boy One',
            phone='9999990003',
            credit_balance=Decimal('0.00'),
        )
        self.client.force_authenticate(user=self.admin)

    def test_internal_ledger_list_all_when_no_date_filter(self):
        """Without date filter, internal ledger list returns all entries."""
        InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='credit',
            amount=Decimal('50.00'),
            description='I1',
            created_by=self.admin,
        )
        InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='debit',
            amount=Decimal('10.00'),
            description='I2',
            created_by=self.admin,
        )
        url = reverse('internal-ledger-entry-list-create')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)

    def test_internal_ledger_create_and_balance(self):
        """Create internal ledger entry; customer balance updates."""
        url = reverse('internal-ledger-entry-list-create')
        data = {
            'customer': self.internal_customer.id,
            'entry_type': 'credit',
            'amount': '99.99',
            'description': 'Internal credit',
        }
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.internal_customer.refresh_from_db()
        self.assertEqual(self.internal_customer.credit_balance, Decimal('99.99'))

    def test_internal_ledger_summary_totals(self):
        """Internal ledger summary totals and num_accounts correct."""
        InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='credit',
            amount=Decimal('40.00'),
            description='A',
            created_by=self.admin,
        )
        InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='debit',
            amount=Decimal('15.00'),
            description='B',
            created_by=self.admin,
        )
        url = reverse('internal-ledger-summary')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(response.data['total_credit']), Decimal('40.00'))
        self.assertEqual(Decimal(response.data['total_debit']), Decimal('15.00'))
        self.assertEqual(response.data['num_accounts'], 1)
        self.assertEqual(Decimal(response.data['balance']), Decimal('25.00'))

    def test_internal_ledger_customer_detail_and_final_balance(self):
        """Internal ledger customer detail has entries and final_balance."""
        InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='credit',
            amount=Decimal('100.00'),
            description='C',
            created_by=self.admin,
        )
        InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='debit',
            amount=Decimal('35.00'),
            description='D',
            created_by=self.admin,
        )
        url = reverse('internal-ledger-customer-detail', kwargs={'customer_id': self.internal_customer.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['entries']), 2)
        self.assertEqual(Decimal(response.data['final_balance']), Decimal('65.00'))

    def test_internal_ledger_entry_get_update_delete(self):
        """Get, update (amount/type), delete internal entry; balance correct."""
        entry = InternalLedgerEntry.objects.create(
            customer=self.internal_customer,
            entry_type='debit',
            amount=Decimal('20.00'),
            description='E',
            created_by=self.admin,
        )
        self.internal_customer.credit_balance = Decimal('-20.00')
        self.internal_customer.save()

        url = reverse('internal-ledger-entry-retrieve-update-destroy', kwargs={'entry_id': entry.id})
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['entry_type'], 'debit')

        # Change to credit 30: reverse debit 20 => balance -20+20=0, apply credit 30 => 30
        resp = self.client.patch(url, {'entry_type': 'credit', 'amount': '30.00'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.internal_customer.refresh_from_db()
        self.assertEqual(self.internal_customer.credit_balance, Decimal('30.00'))

        resp = self.client.delete(url)
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.internal_customer.refresh_from_db()
        self.assertEqual(self.internal_customer.credit_balance, Decimal('0.00'))


class LedgerEntryNotFoundTestCase(APITestCase):
    """Test 404 for invalid entry id on get/update/delete."""

    def setUp(self):
        self.admin = create_admin_user()
        self.client.force_authenticate(user=self.admin)

    def test_ledger_entry_404_get_patch_delete(self):
        url = reverse('ledger-entry-retrieve-update-destroy', kwargs={'entry_id': 99999})
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.patch(url, {'amount': '1'}, format='json').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_personal_ledger_entry_404(self):
        url = reverse('personal-ledger-entry-retrieve-update-destroy', kwargs={'entry_id': 99999})
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_internal_ledger_entry_404(self):
        url = reverse('internal-ledger-entry-retrieve-update-destroy', kwargs={'entry_id': 99999})
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)
