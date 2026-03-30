"""
Reconcile catalog.Barcode.tag based on pos.InvoiceItem usage.

Primary intent:
- If a barcode is referenced by an InvoiceItem on a completed sale invoice,
  that barcode should be tagged as "sold" (unless it is already marked as
  returned/defective/unknown).

This command is dry-run by default. Use --apply to persist changes.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from backend.catalog.models import Barcode
from backend.pos.models import InvoiceItem


class Command(BaseCommand):
    help = (
        'Reconcile Barcode.tag for barcodes referenced by InvoiceItems. '
        'Dry-run by default; pass --apply to update rows.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Persist changes to the database (otherwise dry-run).',
        )
        parser.add_argument(
            '--invoice-statuses',
            default='paid,partial,credit',
            help='Comma-separated invoice statuses to treat as a completed sale (default: paid,partial,credit).',
        )
        parser.add_argument(
            '--only-if-current',
            default='new,in-cart',
            help='Comma-separated current tags that are eligible to be changed to sold (default: new,in-cart).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Optional cap on number of barcodes to update (0 = no limit).',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Print a sample of barcodes that would be updated.',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        verbose = options['verbose']
        limit = options['limit'] or 0

        invoice_statuses = [
            s.strip() for s in str(options['invoice_statuses']).split(',') if s.strip()
        ]
        eligible_current_tags = [
            s.strip() for s in str(options['only_if_current']).split(',') if s.strip()
        ]

        self.stdout.write(
            self.style.SUCCESS(
                'Reconciling Barcode.tag from InvoiceItems...\n'
                f'  sale invoice statuses: {invoice_statuses}\n'
                f'  eligible current tags: {eligible_current_tags}\n'
                f'  mode: {"APPLY" if apply_changes else "DRY-RUN"}\n'
            )
        )

        # Barcode IDs that appear on "sale completed" invoices (ignore null barcode links).
        sold_barcode_ids = list(
            InvoiceItem.objects.filter(
                invoice__status__in=invoice_statuses,
                barcode_id__isnull=False,
            ).values_list('barcode_id', flat=True).distinct()
        )

        if not sold_barcode_ids:
            self.stdout.write(self.style.SUCCESS('No invoice-linked barcodes found for the given statuses. Nothing to do.'))
            return

        # Only update barcodes that are currently in the eligible tag set.
        qs = Barcode.objects.filter(id__in=sold_barcode_ids, tag__in=eligible_current_tags)

        total_candidates = qs.count()
        if total_candidates == 0:
            self.stdout.write(
                self.style.SUCCESS(
                    'All invoice-linked barcodes are already aligned (or are tagged returned/defective/etc.).'
                )
            )
            return

        if limit > 0:
            qs = qs.order_by('id')[:limit]

        barcodes_to_update = list(qs.only('id', 'barcode', 'tag'))
        before_counts = Counter(b.tag for b in barcodes_to_update)

        for b in barcodes_to_update:
            b.tag = 'sold'

        if verbose:
            self.stdout.write(self.style.WARNING('\nSample updates (up to 25):'))
            for b in barcodes_to_update[:25]:
                self.stdout.write(f'  Barcode id={b.id} barcode={b.barcode} -> tag=sold')

        self.stdout.write(
            '\n'
            f'Candidates: {total_candidates}\n'
            f'Updating:  {len(barcodes_to_update)} (limit={limit or "none"})\n'
            f'From tags: {dict(before_counts)}\n'
        )

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry-run complete. Re-run with --apply to persist changes.'))
            return

        with transaction.atomic():
            Barcode.objects.bulk_update(barcodes_to_update, ['tag'], batch_size=1000)

        self.stdout.write(self.style.SUCCESS(f'Updated {len(barcodes_to_update)} barcode(s) to tag=sold.'))

