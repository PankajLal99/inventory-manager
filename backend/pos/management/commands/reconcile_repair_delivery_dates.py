"""
Reconcile invalid Repair.delivery_date values.

Rule (matches UI/backend validation):
- If Repair.invoice.status == 'draft' AND Repair.invoice.invoice_type == 'pending',
  the repair must NOT have a delivery_date.

This command is dry-run by default. Use --apply to persist changes.

Examples:
  python manage.py reconcile_repair_delivery_dates --dry-run
  python manage.py reconcile_repair_delivery_dates --apply --username admin
  python manage.py reconcile_repair_delivery_dates --apply --username admin --limit 500
  python manage.py reconcile_repair_delivery_dates --store-shop-type repair --dry-run
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.core.utils import create_audit_log
from backend.pos.models import Repair

User = get_user_model()

STORE_SHOP_TYPES = ('all', 'retail', 'wholesale', 'repair', 'warehouse', 'other')


class Command(BaseCommand):
    help = (
        'Clear Repair.delivery_date for repairs whose invoice is draft+pending. '
        'Dry-run by default; pass --apply to update rows and write audit logs.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show counts and a sample of rows that would change; do not write.',
        )
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Persist changes to the database (writes audit logs).',
        )
        parser.add_argument(
            '--username',
            type=str,
            default='',
            help='User for updated_by and audit (required with --apply).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Optional cap on number of repairs to update (0 = no limit).',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Print a sample of repairs that would be updated.',
        )
        parser.add_argument(
            '--store-shop-type',
            choices=list(STORE_SHOP_TYPES),
            default='all',
            help='Limit to repairs whose invoice.store.shop_type matches (default: all).',
        )

    def handle(self, *args, **options):
        dry_run: bool = bool(options['dry_run'])
        apply_changes: bool = bool(options['apply'])
        verbose: bool = bool(options['verbose'])
        limit: int = int(options['limit'] or 0)
        store_shop_type: str = str(options['store_shop_type'] or 'all')

        if apply_changes and dry_run:
            raise CommandError('Use either --dry-run or --apply (not both).')

        user = None
        if apply_changes:
            username = (options['username'] or '').strip()
            if not username:
                raise CommandError('--username is required with --apply')
            user = User.objects.filter(username=username).first()
            if not user:
                raise CommandError(f'User not found: {username}')

        store_filter = {}
        if store_shop_type != 'all':
            store_filter['invoice__store__shop_type'] = store_shop_type

        qs = (
            Repair.objects.filter(
                invoice__status='draft',
                invoice__invoice_type='pending',
                delivery_date__isnull=False,
                **store_filter,
            )
            .select_related('invoice', 'invoice__store')
            .order_by('id')
        )

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS('No invalid repair delivery dates found.'))
            return

        sample = list(qs[: min(25, total)].only('id', 'barcode', 'delivery_date', 'invoice_id'))

        self.stdout.write(
            self.style.WARNING(
                'Reconciling invalid Repair.delivery_date where invoice is draft+pending\n'
                f'  store shop_type filter: {store_shop_type}\n'
                f'  matches: {total}\n'
                f'  mode: {"APPLY" if apply_changes else "DRY-RUN"}\n'
                f'  limit: {limit or "none"}\n'
            )
        )

        if verbose:
            self.stdout.write(self.style.NOTICE('Sample (up to 25):'))
            for r in sample:
                inv = getattr(r, 'invoice', None)
                inv_no = getattr(inv, 'invoice_number', None) if inv else None
                self.stdout.write(
                    f'  Repair id={r.id} barcode={r.barcode} invoice_id={r.invoice_id} '
                    f'invoice_no={inv_no or "?"} delivery_date={r.delivery_date}'
                )

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry-run complete. Re-run with --apply to persist changes.'))
            return

        to_update = qs
        if limit and limit > 0:
            to_update = qs[:limit]

        updated = 0
        with transaction.atomic():
            for r in to_update.iterator(chunk_size=200):
                old = r.delivery_date
                if old is None:
                    continue
                r.delivery_date = None
                if user is not None:
                    r.updated_by = user
                r.save(update_fields=['delivery_date', 'updated_by', 'updated_at'])
                updated += 1

                create_audit_log(
                    request=None,
                    user=user,
                    action='repair_delivery_date_reconcile',
                    model_name='Repair',
                    object_id=str(r.id),
                    object_name=f"Repair {r.barcode}",
                    object_reference=r.barcode,
                    barcode=r.barcode,
                    changes={'delivery_date': {'old': str(old), 'new': None}},
                )

        self.stdout.write(self.style.SUCCESS(f'Updated {updated} repair(s): cleared delivery_date + wrote audit logs.'))

