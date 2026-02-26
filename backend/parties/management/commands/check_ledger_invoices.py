"""
Management command to check invoice(s) and their ledger entries (store, customer).
Usage: python manage.py check_ledger_invoices 1703 1694
"""
from django.core.management.base import BaseCommand
from backend.pos.models import Invoice
from backend.parties.models import LedgerEntry


class Command(BaseCommand):
    help = 'Check invoice(s) by ID: store_id, customer_id, and linked ledger entries'

    def add_arguments(self, parser):
        parser.add_argument(
            'invoice_ids',
            nargs='+',
            type=int,
            help='Invoice ID(s) to check (e.g. 1703 1694)',
        )

    def handle(self, *args, **options):
        for inv_id in options['invoice_ids']:
            try:
                inv = Invoice.objects.select_related('store', 'customer').get(pk=inv_id)
            except Invoice.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"Invoice id={inv_id}: NOT FOUND"))
                continue
            ledger_entries = LedgerEntry.objects.filter(invoice_id=inv_id).select_related('customer')
            self.stdout.write(
                self.style.SUCCESS(
                    f"Invoice id={inv_id} | number={inv.invoice_number} | "
                    f"store_id={inv.store_id} (store={getattr(inv.store, 'name', '?')}) | "
                    f"customer_id={inv.customer_id} (customer={getattr(inv.customer, 'name', '?')}) | "
                    f"status={inv.status} | ledger_entries={ledger_entries.count()}"
                )
            )
            for le in ledger_entries:
                self.stdout.write(
                    f"  -> LedgerEntry id={le.id} customer_id={le.customer_id} "
                    f"entry_type={le.entry_type} amount={le.amount}"
                )
