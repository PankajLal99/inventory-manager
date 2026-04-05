"""
Finalize draft + invoice_type=pending invoices where every line still has 0 sell price:
set unit_price = purchase_unit_cost + profit (default ₹20), mark barcodes sold (checkout parity),
then move to credit / ledger (same as invoice_mark_credit + pending_cleared_at).

Examples:
  python manage.py bulk_unpriced_pending_to_credit --dry-run
  python manage.py bulk_unpriced_pending_to_credit --profit 20 --username admin
"""
from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.pos.invoice_credit_service import (
    all_lines_have_resolvable_purchase_cost,
    finalize_invoice_mark_credit_core,
    invoice_has_only_unpriced_positive_lines,
    resolve_item_purchase_unit_cost,
)
from backend.pos.models import Invoice

User = get_user_model()


class Command(BaseCommand):
    help = (
        'Find draft pending invoices with items but all sell prices still 0; '
        'set unit price = purchase cost + profit, mark barcodes sold, mark credit + ledger.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--profit',
            type=str,
            default='20',
            help='Fixed profit per unit (₹) added to purchase cost for unit_price. Default: 20',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List matching invoices and planned prices without saving.',
        )
        parser.add_argument(
            '--username',
            type=str,
            default='',
            help='User for ledger created_by and audit (required unless --dry-run).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Max invoices to process (0 = no limit).',
        )
        parser.add_argument(
            '--invoice-ids',
            type=str,
            default='',
            help='Comma-separated invoice IDs to restrict (must still match other filters).',
        )
        parser.add_argument(
            '--store-id',
            type=int,
            default=0,
            help='Only invoices for this store id (0 = any).',
        )
        parser.add_argument(
            '--shop-type',
            type=str,
            default='',
            choices=['', 'retail', 'wholesale', 'repair', 'warehouse', 'other'],
            help='Filter by store.shop_type (empty = all).',
        )
        parser.add_argument(
            '--include-repair',
            action='store_true',
            help='Include invoices linked to a repair (default: skip repair invoices).',
        )

    def handle(self, *args, **options):
        dry_run: bool = options['dry_run']
        username: str = (options['username'] or '').strip()
        limit: int = options['limit'] or 0
        include_repair: bool = options['include_repair']

        try:
            profit = Decimal(str(options['profit']))
        except Exception as e:
            raise CommandError(f'Invalid --profit: {e}') from e
        if profit < 0:
            raise CommandError('--profit must be >= 0')

        user = None
        if not dry_run:
            if not username:
                raise CommandError('--username is required unless --dry-run')
            user = User.objects.filter(username=username).first()
            if not user:
                raise CommandError(f'User not found: {username}')

        raw_ids = (options['invoice_ids'] or '').strip()
        id_list = []
        if raw_ids:
            for part in raw_ids.split(','):
                part = part.strip()
                if not part:
                    continue
                try:
                    id_list.append(int(part))
                except ValueError:
                    raise CommandError(f'Invalid invoice id: {part}')

        qs = (
            Invoice.objects.filter(status='draft', invoice_type='pending')
            .exclude(status='void')
            .select_related('store', 'customer')
            .prefetch_related('items__product', 'items__barcode')
            .order_by('id')
        )
        if not include_repair:
            qs = qs.filter(repair__isnull=True)
        if id_list:
            qs = qs.filter(pk__in=id_list)
        sid = int(options['store_id'] or 0)
        if sid:
            qs = qs.filter(store_id=sid)
        st = (options['shop_type'] or '').strip()
        if st:
            qs = qs.filter(store__shop_type=st)

        candidates = []
        for inv in qs:
            if not inv.customer_id:
                continue
            if not inv.items.exists():
                continue
            if not invoice_has_only_unpriced_positive_lines(inv):
                continue
            if not all_lines_have_resolvable_purchase_cost(inv):
                continue
            candidates.append(inv)
            if limit and len(candidates) >= limit:
                break

        if not candidates:
            self.stdout.write(self.style.WARNING('No matching invoices.'))
            return

        self.stdout.write(
            self.style.NOTICE(
                f'Found {len(candidates)} invoice(s). profit=₹{profit} per unit. dry_run={dry_run}\n'
            )
        )

        for inv in candidates:
            lines = []
            for it in inv.items.select_related('product', 'barcode').all():
                if it.quantity is None or it.quantity <= 0:
                    continue
                cost = resolve_item_purchase_unit_cost(it)
                sale = (cost + profit).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                lines.append(
                    f"  item {it.id} {getattr(it.product, 'sku', '')} qty={it.quantity} cost={cost} -> unit_price={sale}"
                )

            self.stdout.write(f'Invoice {inv.id} {inv.invoice_number} store={inv.store_id} customer={inv.customer_id}')
            for L in lines:
                self.stdout.write(L)

            if dry_run:
                self.stdout.write(self.style.WARNING('  (dry-run: no changes)\n'))
                continue

            try:
                with transaction.atomic():
                    # Do not combine select_related/prefetch with select_for_update on Postgres:
                    # nullable FK joins become outer joins and FOR UPDATE is rejected on them.
                    locked = Invoice.objects.select_for_update().get(pk=inv.pk)
                    if locked.status != 'draft' or locked.invoice_type != 'pending':
                        self.stdout.write(
                            self.style.ERROR(
                                '  skipped: no longer draft+pending under lock '
                                f'(status={locked.status!r}, invoice_type={locked.invoice_type!r}). '
                                'Another user/process may have finalized it, or the row changed after the scan.'
                            )
                        )
                        continue
                    if not invoice_has_only_unpriced_positive_lines(locked):
                        self.stdout.write(
                            self.style.ERROR(
                                '  skipped: lines no longer all unpriced (prices may have been set since scan)'
                            )
                        )
                        continue
                    if not all_lines_have_resolvable_purchase_cost(locked):
                        self.stdout.write(
                            self.style.ERROR('  skipped: purchase cost missing on one or more lines')
                        )
                        continue

                    pre_type = locked.invoice_type
                    pre_stat = locked.status

                    for it in locked.items.select_related('product', 'barcode').all():
                        if it.quantity is None or it.quantity <= 0:
                            continue
                        cost = resolve_item_purchase_unit_cost(it)
                        sale = (cost + profit).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                        it.manual_unit_price = None
                        it.unit_price = sale
                        it.line_total = (
                            it.quantity * sale - it.discount_amount + it.tax_amount
                        )
                        it.save(
                            update_fields=[
                                'manual_unit_price',
                                'unit_price',
                                'line_total',
                            ]
                        )

                    finalize_invoice_mark_credit_core(
                        locked,
                        user,
                        pre_mark_invoice_type=pre_type,
                        pre_mark_status=pre_stat,
                        request=None,
                        mark_barcodes_sold=True,
                    )
                self.stdout.write(self.style.SUCCESS(f'  OK -> credit, ledger, pending_cleared_at\n'))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  FAILED: {e}'))
