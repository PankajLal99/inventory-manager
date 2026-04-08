"""
Reconcile catalog.Barcode.tag based on pos.InvoiceItem usage.

Policy (aligned with POS / InvoiceEdit / InvoiceDetail / repair flows):
- Draft pending invoice (invoice_type=pending, status=draft) -> barcode tag sold.
- Completed sale/ledger (status in paid,partial,credit by default) -> barcode tag sold.
- If a barcode is linked to any invoice item, it must not remain new/in-cart.

This command is dry-run by default. Use --apply to persist changes.

Backend write points (audit when changing tag semantics — search for ".tag =" in these):
- backend/pos/views.py: cart add/update (in-cart, restore new), cart_checkout (pending vs sold),
  invoice_detail PATCH (type change pending/cash/credit), invoice_update, invoice_items,
  invoice_checkout, invoice_mark_credit, replacement/exchange paths, void/restore.
- backend/pos/invoice_credit_service.py: mark_invoice_barcodes_sold_for_checkout, bulk revert helpers.
- backend/catalog/views.py: POS/catalog barcode resolution and move-out tagging.
- backend/purchasing/serializers.py: new barcodes from purchase.
- backend/pos/management/commands/cleanup_abandoned_carts.py, check_invoice_data.py: cleanup.
- backend/core/management/commands/fix_in_cart_barcodes.py: bulk reset in-cart->new (use with care).

For repair shops: same Invoice/InvoiceItem rules; filter with --store-shop-type repair.
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.db import transaction

from backend.catalog.models import Barcode
from backend.pos.models import InvoiceItem

STORE_SHOP_TYPES = ('all', 'retail', 'wholesale', 'repair', 'warehouse', 'other')


class Command(BaseCommand):
    help = (
        'Reconcile Barcode.tag for barcodes referenced by InvoiceItems '
        '(pending draft => in-cart, completed => sold). '
        'Optional filters: --store-shop-type, --phase. '
        'Dry-run by default; pass --apply to update rows.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--print-checklist',
            action='store_true',
            help='Print backend tag write-point reference and exit (no DB work).',
        )
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
            default='new,returned,in-cart',
            help='Comma-separated current tags eligible for sold updates from pending draft usage (default: new,returned,in-cart).',
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
        parser.add_argument(
            '--store-shop-type',
            choices=list(STORE_SHOP_TYPES),
            default='all',
            help='Limit to invoices whose store has this shop_type (default: all, includes repair).',
        )
        parser.add_argument(
            '--phase',
            choices=('both', 'sold'),
            default='both',
            help='both: reconcile completed + pending-draft to sold; sold: only completed-invoice reconciliation.',
        )

    def handle(self, *args, **options):
        if options['print_checklist']:
            self.stdout.write(self.style.SUCCESS(__doc__ or ''))
            return

        apply_changes = options['apply']
        verbose = options['verbose']
        limit = options['limit'] or 0
        phase = options['phase']
        store_shop_type = options['store_shop_type']

        invoice_statuses = [
            s.strip() for s in str(options['invoice_statuses']).split(',') if s.strip()
        ]
        eligible_sold_tags = [
            s.strip() for s in str(options['only_if_current']).split(',') if s.strip()
        ]
        eligible_pending_tags = [
            s.strip() for s in str(options['pending_only_if_current']).split(',') if s.strip()
        ]

        store_filter = {}
        if store_shop_type != 'all':
            store_filter['invoice__store__shop_type'] = store_shop_type

        self.stdout.write(
            self.style.SUCCESS(
                'Reconciling Barcode.tag from InvoiceItems...\n'
                f'  sale invoice statuses: {invoice_statuses}\n'
                f'  store shop_type filter: {store_shop_type}\n'
                f'  phase: {phase}\n'
                f'  eligible current tags for sold: {eligible_sold_tags}\n'
                f'  eligible current tags for pending-draft sold: {eligible_pending_tags}\n'
                f'  mode: {"APPLY" if apply_changes else "DRY-RUN"}\n'
            )
        )

        # Barcode IDs on completed invoices -> should be sold.
        sold_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__status__in=invoice_statuses,
                barcode_id__isnull=False,
                **store_filter,
            ).values_list('barcode_id', flat=True).distinct()
        )

        # Barcode IDs on draft pending invoices -> should be sold (same policy as completed).
        pending_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__invoice_type='pending',
                invoice__status='draft',
                barcode_id__isnull=False,
                **store_filter,
            ).values_list('barcode_id', flat=True).distinct()
        )

        # Both completed and pending-draft require sold.
        pending_only_ids = pending_barcode_ids - sold_barcode_ids

        sold_qs = Barcode.objects.filter(id__in=sold_barcode_ids, tag__in=eligible_sold_tags).order_by('id')
        pending_qs = Barcode.objects.filter(id__in=pending_only_ids, tag__in=eligible_pending_tags).order_by('id')

        if phase == 'sold':
            pending_qs = Barcode.objects.none()

        sold_candidates = list(sold_qs.only('id', 'barcode', 'tag'))
        pending_candidates = list(pending_qs.only('id', 'barcode', 'tag'))

        if limit > 0:
            if phase == 'both':
                sold_candidates = sold_candidates[:limit]
                remaining = max(0, limit - len(sold_candidates))
                pending_candidates = pending_candidates[:remaining] if remaining else []
            elif phase == 'sold':
                sold_candidates = sold_candidates[:limit]
            else:
                pending_candidates = pending_candidates[:limit]

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
            b.tag = 'sold'

        if verbose:
            self.stdout.write(self.style.WARNING('\nSample sold updates (up to 25):'))
            for b in sold_candidates[:25]:
                self.stdout.write(f'  Barcode id={b.id} barcode={b.barcode} -> tag=sold')
            self.stdout.write(self.style.WARNING('\nSample pending-draft sold updates (up to 25):'))
            for b in pending_candidates[:25]:
                self.stdout.write(f'  Barcode id={b.id} barcode={b.barcode} -> tag=sold')

        self.stdout.write('\nReconcile summary:')
        self.stdout.write(f'  Completed-linked barcode ids: {len(sold_barcode_ids)}')
        self.stdout.write(f'  Pending-draft-linked barcode ids: {len(pending_barcode_ids)}')
        self.stdout.write(f'  Pending-only ids (after sold priority): {len(pending_only_ids)}')
        self.stdout.write(f'  To sold: {len(sold_candidates)} from {dict(sold_before_counts)}')
        self.stdout.write(f'  Pending-draft to sold: {len(pending_candidates)} from {dict(pending_before_counts)}')
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
                f'Updated {len(sold_candidates)} completed-linked barcode(s) to tag=sold and '
                f'{len(pending_candidates)} pending-draft-linked barcode(s) to tag=sold.'
            )
        )

