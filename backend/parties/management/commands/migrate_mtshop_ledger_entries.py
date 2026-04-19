from django.core.management.base import BaseCommand
from django.db import transaction

from backend.parties.models import InternalLedgerEntry, LedgerEntry


MTSHOP_GROUP_NAME = 'MTSHOP'


class Command(BaseCommand):
    help = (
        'Migrate legacy LedgerEntry rows for MTSHOP customers into InternalLedgerEntry. '
        'Safe to re-run: links existing duplicates when possible and skips already mapped rows.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Preview migration without saving changes.',
        )
        parser.add_argument(
            '--keep-source',
            action='store_true',
            help='Do not delete migrated source rows from LedgerEntry.',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=500,
            help='Rows processed per batch (default: 500).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        keep_source = options['keep_source']
        batch_size = max(int(options['batch_size'] or 500), 1)

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN: no DB changes will be committed.'))

        source_qs = (
            LedgerEntry.objects.filter(customer__customer_group__name__iexact=MTSHOP_GROUP_NAME)
            .select_related('customer', 'created_by')
            .order_by('id')
        )
        source_total = source_qs.count()
        if source_total == 0:
            self.stdout.write(self.style.SUCCESS('No MTSHOP LedgerEntry rows found.'))
            return

        existing_source_ids = set(
            InternalLedgerEntry.objects.exclude(source_ledger_entry_id__isnull=True).values_list('source_ledger_entry_id', flat=True)
        )
        pending_qs = source_qs.exclude(id__in=existing_source_ids)
        pending_total = pending_qs.count()

        self.stdout.write(
            f'Found {source_total} MTSHOP LedgerEntry rows; {source_total - pending_total} already mapped; '
            f'{pending_total} pending.'
        )

        linked_existing = 0
        created_new = 0
        skipped_ambiguous = 0
        migrated_source_ids: list[int] = []
        ambiguous_ids: list[int] = []

        with transaction.atomic():
            start = 0
            while start < pending_total:
                batch = list(pending_qs[start:start + batch_size])
                for entry in batch:
                    matches = InternalLedgerEntry.objects.filter(
                        source_ledger_entry_id__isnull=True,
                        customer=entry.customer,
                        entry_type=entry.entry_type,
                        amount=entry.amount,
                        description=entry.description,
                        created_at=entry.created_at,
                    )
                    match_count = matches.count()

                    if match_count == 1:
                        existing = matches.first()
                        existing.source_ledger_entry_id = entry.id
                        existing.save(update_fields=['source_ledger_entry_id'])
                        linked_existing += 1
                        migrated_source_ids.append(entry.id)
                    elif match_count == 0:
                        InternalLedgerEntry.objects.create(
                            customer=entry.customer,
                            entry_type=entry.entry_type,
                            amount=entry.amount,
                            description=entry.description or '',
                            created_by=entry.created_by,
                            created_at=entry.created_at,
                            source_ledger_entry_id=entry.id,
                        )
                        created_new += 1
                        migrated_source_ids.append(entry.id)
                    else:
                        skipped_ambiguous += 1
                        ambiguous_ids.append(entry.id)
                start += batch_size

            deleted_source_rows = 0
            if not keep_source and migrated_source_ids:
                deleted_source_rows, _ = LedgerEntry.objects.filter(id__in=migrated_source_ids).delete()

            if dry_run:
                transaction.set_rollback(True)

        summary = {
            'source_total': source_total,
            'already_mapped': source_total - pending_total,
            'linked_existing': linked_existing,
            'created_new': created_new,
            'skipped_ambiguous': skipped_ambiguous,
            'deleted_source_rows': 0 if keep_source else deleted_source_rows,
            'mode': 'dry-run' if dry_run else 'apply',
        }

        self.stdout.write(self.style.SUCCESS(f'Migration summary: {summary}'))
        if ambiguous_ids:
            self.stdout.write(
                self.style.WARNING(
                    f'Ambiguous source ids not migrated ({len(ambiguous_ids)}): {ambiguous_ids[:50]}'
                )
            )
