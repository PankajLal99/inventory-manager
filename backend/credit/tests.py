from django.test import TestCase

from backend.credit.customer_sync import sync_linked_credit_customers_from_party
from backend.credit.models import CreditCustomer
from backend.parties.models import Customer, CustomerGroup


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
