"""
Report credit invoices cleared (pending_cleared_at) on a given day, grouped by store shop_type.

Use after a bulk_unpriced_pending_to_credit run to see impact by shop (e.g. retail vs wholesale).

Examples:
  python manage.py report_pending_cleared_credit_by_shop
  python manage.py report_pending_cleared_credit_by_shop --date 2026-04-05
  python manage.py report_pending_cleared_credit_by_shop --list-retail-repair
"""
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count
from django.utils import timezone

from backend.pos.models import Invoice


class Command(BaseCommand):
    help = 'Count credit invoices with pending_cleared_at on a date, grouped by store shop_type.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            type=str,
            default='',
            help='Date (YYYY-MM-DD) in default timezone. Empty = today (local).',
        )
        parser.add_argument(
            '--list-retail-repair',
            action='store_true',
            help='Print invoice id, number, store id, shop_type for retail + repair only.',
        )

    def handle(self, *args, **options):
        raw = (options['date'] or '').strip()
        if raw:
            try:
                d = datetime.strptime(raw[:10], '%Y-%m-%d').date()
            except ValueError as e:
                raise CommandError(f'Invalid --date (use YYYY-MM-DD): {e}') from e
        else:
            d = timezone.localdate()

        base = Invoice.objects.filter(
            pending_cleared_at__date=d,
            status='credit',
            invoice_type='credit',
        )

        total = base.count()
        self.stdout.write(
            self.style.NOTICE(
                f'Credit invoices with pending_cleared_at on {d} (local): {total} total\n'
            )
        )

        rows = (
            base.values('store__shop_type')
            .annotate(c=Count('id'))
            .order_by('store__shop_type')
        )
        for row in rows:
            st = row['store__shop_type'] or '(null)'
            self.stdout.write(f"  shop_type={st!r}: {row['c']}")

        rr = base.filter(store__shop_type__in=['retail', 'repair'])
        n_rr = rr.count()
        self.stdout.write('')
        self.stdout.write(
            self.style.WARNING(
                f'  retail + repair (candidate scope for revert_bulk_credit_wrong_shops): {n_rr}'
            )
        )

        if options['list_retail_repair']:
            self.stdout.write('')
            for inv in rr.select_related('store').order_by('id'):
                self.stdout.write(
                    f"  id={inv.id}  {inv.invoice_number}  store_id={inv.store_id}  "
                    f"shop_type={inv.store.shop_type!r}"
                )
