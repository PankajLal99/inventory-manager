"""
Revert bulk_unpriced_pending_to_credit for invoices that should NOT have been finalized
(e.g. missed --shop-type wholesale): restore draft pending, clear ledger, zero prices, barcodes -> new.

Targets credit invoices with pending_cleared_at on a given date whose store shop_type is in
--shop-types (default: retail,repair). Wholesale/warehouse/other are skipped unless listed.

Refuses any invoice with non-refund payments (sum != 0).

Examples:
  python manage.py revert_bulk_credit_wrong_shops --dry-run
  python manage.py revert_bulk_credit_wrong_shops --username pankajlal --dry-run
  python manage.py revert_bulk_credit_wrong_shops --username pankajlal
  python manage.py revert_bulk_credit_wrong_shops --date 2026-04-05 --shop-types retail,repair --username pankajlal
"""
from datetime import datetime

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from backend.pos.invoice_credit_service import revert_credit_invoice_to_draft_pending
from backend.pos.models import Invoice

User = get_user_model()

VALID_SHOP_TYPES = frozenset({'retail', 'wholesale', 'repair', 'warehouse', 'other'})


class Command(BaseCommand):
    help = (
        'Revert credit finalization for invoices on a date, limited to selected store shop_type values.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            type=str,
            default='',
            help='Match pending_cleared_at date (YYYY-MM-DD). Empty = today (local).',
        )
        parser.add_argument(
            '--shop-types',
            type=str,
            default='retail,repair',
            help='Comma-separated store.shop_type values to revert (default: retail,repair).',
        )
        parser.add_argument(
            '--username',
            type=str,
            required=True,
            help='User for audit / ledger reversal (required).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List invoices that would be reverted; no DB changes.',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Max invoices to process (0 = no limit).',
        )
        parser.add_argument(
            '--skip-barcode-restore',
            action='store_true',
            help='Do not set sold barcodes back to new (not recommended).',
        )
        parser.add_argument(
            '--invoice-ids',
            type=str,
            default='',
            help='Optional comma-separated IDs; each must still match date + shop-type filters.',
        )

    def handle(self, *args, **options):
        user = User.objects.filter(username=(options['username'] or '').strip()).first()
        if not user:
            raise CommandError(f'User not found: {options["username"]}')

        raw_date = (options['date'] or '').strip()
        if raw_date:
            try:
                d = datetime.strptime(raw_date[:10], '%Y-%m-%d').date()
            except ValueError as e:
                raise CommandError(f'Invalid --date: {e}') from e
        else:
            d = timezone.localdate()

        st_parts = [x.strip().lower() for x in (options['shop_types'] or '').split(',') if x.strip()]
        for s in st_parts:
            if s not in VALID_SHOP_TYPES:
                raise CommandError(f'Invalid shop_type: {s!r}. Allowed: {sorted(VALID_SHOP_TYPES)}')
        if not st_parts:
            raise CommandError('--shop-types expanded to empty list')

        id_filter = []
        raw_ids = (options['invoice_ids'] or '').strip()
        if raw_ids:
            for p in raw_ids.split(','):
                p = p.strip()
                if not p:
                    continue
                try:
                    id_filter.append(int(p))
                except ValueError:
                    raise CommandError(f'Invalid invoice id: {p}')

        qs = (
            Invoice.objects.filter(
                pending_cleared_at__date=d,
                status='credit',
                invoice_type='credit',
                store__shop_type__in=st_parts,
            )
            .select_related('store', 'customer')
            .order_by('id')
        )
        if id_filter:
            qs = qs.filter(pk__in=id_filter)

        candidates = list(qs)
        limit = int(options['limit'] or 0)
        if limit:
            candidates = candidates[:limit]

        if not candidates:
            self.stdout.write(self.style.WARNING('No matching invoices.'))
            return

        dry = options['dry_run']
        self.stdout.write(
            self.style.NOTICE(
                f'Date={d} shop_types={st_parts}  candidates={len(candidates)} dry_run={dry}\n'
            )
        )

        for inv in candidates:
            self.stdout.write(
                f"  {inv.id}  {inv.invoice_number}  store={inv.store_id} {inv.store.shop_type!r}  "
                f"customer={inv.customer_id}"
            )

        if dry:
            self.stdout.write(self.style.WARNING('\n(dry-run: no changes)'))
            return

        skip_bc = options['skip_barcode_restore']
        ok = 0
        for inv in candidates:
            try:
                with transaction.atomic():
                    locked = Invoice.objects.select_for_update().get(pk=inv.pk)
                    revert_credit_invoice_to_draft_pending(
                        locked,
                        user,
                        skip_barcode_restore=skip_bc,
                    )
                ok += 1
                self.stdout.write(self.style.SUCCESS(f'  reverted invoice {inv.id}'))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  FAILED invoice {inv.id}: {e}'))

        self.stdout.write(self.style.NOTICE(f'\nDone. Reverted {ok}/{len(candidates)}.'))
