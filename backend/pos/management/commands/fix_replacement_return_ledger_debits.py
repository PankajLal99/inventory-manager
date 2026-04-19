"""
One-time: fix wrong replacement-return instant ledger rows posted as DEBIT (bug) to CREDIT
and correct Customer.credit_balance.

Before the fix, checkout did: LedgerEntry debit + credit_balance -= amount.
Correct behaviour: credit + credit_balance += amount.
So for each bad row: flip type to credit and do credit_balance += 2 * amount.

Dry-run (default):

  python manage.py fix_replacement_return_ledger_debits

Apply:

  python manage.py fix_replacement_return_ledger_debits --apply

Optional: only rows for one replacement invoice (DB pk):

  python manage.py fix_replacement_return_ledger_debits --invoice-id 6683 --apply
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from backend.parties.models import Customer, InternalLedgerEntry, LedgerEntry
from backend.pos.models import Invoice

DESC_SNIPPET = 'Replacement return POS settlement'


class Command(BaseCommand):
    help = 'Flip mistaken replacement-return settlement DEBIT ledger rows to CREDIT and fix credit_balance.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Persist changes (default is dry-run: print only).',
        )
        parser.add_argument(
            '--invoice-id',
            type=int,
            default=None,
            help='Only ledger rows linked to this invoice primary key.',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        invoice_id = options.get('invoice_id')

        if invoice_id is not None:
            inv = Invoice.objects.filter(pk=invoice_id).first()
            if not inv:
                self.stdout.write(self.style.ERROR(f'No invoice with id={invoice_id}.'))
                return
            if not inv.is_replacement_return:
                self.stdout.write(
                    self.style.ERROR(
                        f'Invoice {inv.invoice_number} (id={invoice_id}) is not a replacement return; refusing.'
                    )
                )
                return

        qs = LedgerEntry.objects.filter(
            entry_type='debit',
            customer_id__isnull=False,
            invoice_id__isnull=False,
            invoice__is_replacement_return=True,
            invoice__status='paid',
            description__icontains=DESC_SNIPPET,
        )
        if invoice_id is not None:
            qs = qs.filter(invoice_id=invoice_id)

        rows = list(qs.select_related('customer', 'invoice').order_by('id'))
        if not rows:
            self.stdout.write(self.style.WARNING('No matching DEBIT replacement settlement rows found.'))
            return

        if not apply_changes:
            self.stdout.write(self.style.WARNING('DRY RUN (no DB writes). Pass --apply to commit.\n'))

        for e in rows:
            inv = e.invoice
            inv_label = inv.invoice_number if inv else f'invoice_id={e.invoice_id}'
            self.stdout.write(
                f"  id={e.id} customer={e.customer_id} ({e.customer.name if e.customer else ''}) "
                f"amount={e.amount} inv={inv_label} -> CREDIT; credit_balance += {2 * e.amount}"
            )

        if not apply_changes:
            self.stdout.write(self.style.SUCCESS(f'\nWould update {len(rows)} ledger row(s) and customer balances.'))
            return

        fixed_main = 0
        fixed_internal = 0
        with transaction.atomic():
            for e in rows:
                cust = Customer.objects.select_for_update().get(pk=e.customer_id)
                delta = (Decimal(str(e.amount)) * Decimal('2')).quantize(Decimal('0.01'))
                cust.credit_balance = (cust.credit_balance or Decimal('0')) + delta
                cust.save(update_fields=['credit_balance'])

                e.entry_type = 'credit'
                e.save(update_fields=['entry_type'])
                fixed_main += 1

                ile_qs = InternalLedgerEntry.objects.filter(
                    customer_id=e.customer_id,
                    entry_type='debit',
                    amount=e.amount,
                    description=e.description,
                )
                n = ile_qs.update(entry_type='credit')
                fixed_internal += n

        self.stdout.write(
            self.style.SUCCESS(
                f'Done: {fixed_main} LedgerEntry row(s) set to credit; '
                f'{fixed_internal} InternalLedgerEntry row(s) matched and set to credit; '
                f'customer credit_balance += 2×amount per row.'
            )
        )
