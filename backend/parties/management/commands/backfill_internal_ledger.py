"""
Backfill InternalLedgerEntry from existing LedgerEntry for customers whose name contains "MT SHOP".
Use after deploying the internal-ledger mirroring so that historical main-ledger activity
appears in the Shop Boys Ledger. Safe to run multiple times (skips already-backfilled entries).
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from backend.parties.internal_ledger_utils import INTERNAL_LEDGER_NAME_CONTAINS
from backend.parties.models import LedgerEntry, InternalLedgerEntry


class Command(BaseCommand):
    help = (
        'Backfill internal ledger (Shop Boys) from main ledger for customers with "MT SHOP" in name. '
        'Skips entries already backfilled. Safe to re-run.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Only report what would be created; do not write to DB.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=500,
            help='Number of LedgerEntry rows to process per batch (default 500).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        batch_size = options['batch_size']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN: no changes will be saved.'))

        # LedgerEntry with customer whose name contains MT SHOP, not yet backfilled
        name_filter = Q(customer__name__icontains=INTERNAL_LEDGER_NAME_CONTAINS)
        already_backfilled_ids = set(
            InternalLedgerEntry.objects.filter(source_ledger_entry_id__isnull=False)
            .values_list('source_ledger_entry_id', flat=True)
        )
        qs = (
            LedgerEntry.objects.filter(name_filter, customer__isnull=False)
            .exclude(id__in=already_backfilled_ids)
            .select_related('customer', 'created_by')
            .order_by('created_at', 'id')
        )
        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS('No ledger entries to backfill for MT SHOP customers.'))
            return

        self.stdout.write(f'Found {total} LedgerEntry row(s) to backfill for customers with "{INTERNAL_LEDGER_NAME_CONTAINS}" in name.')

        created = 0
        errors = 0
        with transaction.atomic():
            for start in range(0, total, batch_size):
                batch = list(qs[start : start + batch_size])
                for entry in batch:
                    try:
                        if dry_run:
                            self.stdout.write(
                                f'  [dry-run] would create InternalLedgerEntry: customer={entry.customer.name}, '
                                f'entry_type={entry.entry_type}, amount={entry.amount}, created_at={entry.created_at}'
                            )
                            created += 1
                            continue
                        InternalLedgerEntry.objects.create(
                            customer=entry.customer,
                            entry_type=entry.entry_type,
                            amount=entry.amount,
                            description=entry.description or '',
                            created_by=entry.created_by,
                            created_at=entry.created_at,
                            source_ledger_entry_id=entry.id,
                        )
                        created += 1
                    except Exception as e:
                        errors += 1
                        self.stdout.write(
                            self.style.ERROR(f'  Failed LedgerEntry id={entry.id}: {e}')
                        )
            if dry_run:
                self.stdout.write(self.style.WARNING('Dry run complete. Rolling back.'))
                transaction.set_rollback(True)

        self.stdout.write(
            self.style.SUCCESS(f'Backfill complete: {created} internal ledger entries created, {errors} errors.')
        )
