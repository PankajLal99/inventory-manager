from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum
from decimal import Decimal
from backend.parties.models import Customer, LedgerEntry
from backend.pos.models import Invoice

class Command(BaseCommand):
    help = 'Repairs customer credit balances and removes incorrect ledger entries'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Perform a dry run without saving changes',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN MODE: No changes will be saved."))

        customers = Customer.objects.all()
        self.stdout.write(f"Starting balance repair for {customers.count()} customers...")

        with transaction.atomic():
            for c in customers:
                self.stdout.write(f"\nProcessing Customer: {c.name} (ID: {c.id})")
                
                entries = LedgerEntry.objects.filter(customer=c)
                to_delete_ids = []
                
                # Group by invoice to find invalid entries
                invoice_ids = entries.values_list('invoice_id', flat=True).distinct()
                for inv_id in invoice_ids:
                    if inv_id is None: continue
                    inv = Invoice.objects.get(pk=inv_id)
                    inv_entries = entries.filter(invoice=inv)
                    
                    has_debit = inv_entries.filter(entry_type='debit').exists()
                    has_credit = inv_entries.filter(entry_type='credit').exists()
                    
                    # Logic: Cash/UPI sales should not have ledger entries unless they were credit purchases first
                    if inv.invoice_type in ['cash', 'upi', 'mixed']:
                        if has_credit and not has_debit:
                            self.stdout.write(self.style.NOTICE(f"  - Mark invalid entries for deletion: Invoice {inv.invoice_number} ({inv.invoice_type})"))
                            to_delete_ids.extend([e.id for e in inv_entries])
                
                if to_delete_ids:
                    self.stdout.write(f"  - Deleting {len(to_delete_ids)} incorrect entries: {to_delete_ids}")
                    if not dry_run:
                        LedgerEntry.objects.filter(id__in=to_delete_ids).delete()
                
                # Recalculate balance
                if dry_run:
                    remaining = LedgerEntry.objects.filter(customer=c).exclude(id__in=to_delete_ids)
                else:
                    remaining = LedgerEntry.objects.filter(customer=c)
                
                total_credit = remaining.filter(entry_type='credit').aggregate(s=Sum('amount'))['s'] or Decimal('0.00')
                total_debit = remaining.filter(entry_type='debit').aggregate(s=Sum('amount'))['s'] or Decimal('0.00')
                
                new_balance = total_credit - total_debit
                if c.credit_balance != new_balance:
                    self.stdout.write(self.style.SUCCESS(f"  - Balance Update: {c.credit_balance} -> {new_balance}"))
                    if not dry_run:
                        c.credit_balance = new_balance
                        c.save(update_fields=['credit_balance'])
                else:
                    self.stdout.write(f"  - Balance Correct: {new_balance}")

            if dry_run:
                self.stdout.write(self.style.WARNING("\nDry run complete. Rolling back changes."))
                transaction.set_rollback(True)
            else:
                self.stdout.write(self.style.SUCCESS("\nBalance repair complete and committed."))
