"""
Reconcile catalog.Barcode.tag based on pos.InvoiceItem usage.

Rules:
- If a barcode is referenced by InvoiceItem on a draft pending invoice
  (invoice_type='pending' AND status='draft'), tag should be "in-cart".
- If a barcode is referenced by InvoiceItem on a completed invoice
  (default statuses: paid,partial,credit), tag should be "sold".
- "sold" wins over "in-cart" if historical data has both associations.

This command is dry-run by default. Use --apply to persist changes.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from backend.catalog.models import Barcode
from backend.pos.models import InvoiceItem


class Command(BaseCommand):
    help = (
        'Reconcile Barcode.tag for barcodes referenced by InvoiceItems '
        '(pending draft => in-cart, completed => sold). '
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
            help='Comma-separated current tags eligible for sold updates (default: new,in-cart).',
        )
        parser.add_argument(
            '--pending-only-if-current',
            default='new,returned,sold',
            help='Comma-separated current tags eligible for in-cart updates from pending draft usage (default: new,returned,sold).',
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
        eligible_sold_tags = [
            s.strip() for s in str(options['only_if_current']).split(',') if s.strip()
        ]
        eligible_pending_tags = [
            s.strip() for s in str(options['pending_only_if_current']).split(',') if s.strip()
        ]

        self.stdout.write(
            self.style.SUCCESS(
                'Reconciling Barcode.tag from InvoiceItems...\n'
                f'  sale invoice statuses: {invoice_statuses}\n'
                f'  eligible current tags for sold: {eligible_sold_tags}\n'
                f'  eligible current tags for in-cart: {eligible_pending_tags}\n'
                f'  mode: {"APPLY" if apply_changes else "DRY-RUN"}\n'
            )
        )

        # Barcode IDs on completed invoices -> should be sold.
        sold_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__status__in=invoice_statuses,
                barcode_id__isnull=False,
            ).values_list('barcode_id', flat=True).distinct()
        )

        # Barcode IDs on draft pending invoices -> should be in-cart.
        pending_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__invoice_type='pending',
                invoice__status='draft',
                barcode_id__isnull=False,
            ).values_list('barcode_id', flat=True).distinct()
        )

        # Sold has priority. If a barcode appears in both sets due to historical data, keep sold.
        pending_only_ids = pending_barcode_ids - sold_barcode_ids

        sold_qs = Barcode.objects.filter(id__in=sold_barcode_ids, tag__in=eligible_sold_tags).order_by('id')
        pending_qs = Barcode.objects.filter(id__in=pending_only_ids, tag__in=eligible_pending_tags).order_by('id')

        sold_candidates = list(sold_qs.only('id', 'barcode', 'tag'))
        pending_candidates = list(pending_qs.only('id', 'barcode', 'tag'))

        if limit > 0:
            sold_candidates = sold_candidates[:limit]
            remaining = max(0, limit - len(sold_candidates))
            if remaining == 0:
                pending_candidates = []
            else:
                pending_candidates = pending_candidates[:remaining]

        if not sold_candidates and not pending_candidates:
            self.stdout.write(
                self.style.SUCCESS(
                    'No barcode tag changes required for the selected rules.'
                )
            )
            return

        sold_before_counts = Counter(b.tag for b in sold_candidates)
        pending_before_counts = Counter(b.tag for b in pending_candidates)

        for b in sold_candidates:
            b.tag = 'sold'
        for b in pending_candidates:
            b.tag = 'in-cart'

        if verbose:
            self.stdout.write(self.style.WARNING('\nSample sold updates (up to 25):'))
            for b in sold_candidates[:25]:
                self.stdout.write(f'  Barcode id={b.id} barcode={b.barcode} -> tag=sold')
            self.stdout.write(self.style.WARNING('\nSample in-cart updates (up to 25):'))
            for b in pending_candidates[:25]:
                self.stdout.write(f'  Barcode id={b.id} barcode={b.barcode} -> tag=in-cart')

        self.stdout.write('\nReconcile summary:')
        self.stdout.write(f'  Completed-linked barcode ids: {len(sold_barcode_ids)}')
        self.stdout.write(f'  Pending-draft-linked barcode ids: {len(pending_barcode_ids)}')
        self.stdout.write(f'  Pending-only ids (after sold priority): {len(pending_only_ids)}')
        self.stdout.write(f'  To sold: {len(sold_candidates)} from {dict(sold_before_counts)}')
        self.stdout.write(f'  To in-cart: {len(pending_candidates)} from {dict(pending_before_counts)}')
        self.stdout.write(f'  Limit: {limit or "none"}')

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry-run complete. Re-run with --apply to persist changes.'))
            return

        with transaction.atomic():
            if sold_candidates:
                Barcode.objects.bulk_update(sold_candidates, ['tag'], batch_size=1000)
            if pending_candidates:
                Barcode.objects.bulk_update(pending_candidates, ['tag'], batch_size=1000)

        self.stdout.write(
            self.style.SUCCESS(
                f'Updated {len(sold_candidates)} barcode(s) to tag=sold and '
                f'{len(pending_candidates)} barcode(s) to tag=in-cart.'
            )
        )

