"""
Management command to clean up abandoned carts and restore free cart-held stock.

Abandoned carts permanently reduce stock because quantity is decremented
at cart-add time. This command finds carts older than a threshold that
are still 'active' or 'held' and discards them with barcode-safe rules:
barcodes on any non-void invoice are left unchanged; only free `in-cart`
barcodes are released to `new`.

EDIT-* (invoice-edit) carts use a shorter TTL and can also be cleared
immediately when every scanned barcode is already on a non-void invoice.

Usage:
    python manage.py cleanup_abandoned_carts                 # dry-run (default)
    python manage.py cleanup_abandoned_carts --apply          # actually delete
    python manage.py cleanup_abandoned_carts --hours 12       # normal cart TTL
    python manage.py cleanup_abandoned_carts --edit-hours 1   # EDIT cart TTL
    python manage.py cleanup_abandoned_carts --edit-only      # only EDIT-* carts
    python manage.py cleanup_abandoned_carts --stale-edit-now # clear fully invoice-covered EDIT carts now

Schedule via cron (e.g. every hour):
    0 * * * * cd /path/to/backend && python manage.py cleanup_abandoned_carts --apply
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from backend.pos.cart_discard import (
    discard_cart_safely,
    edit_cart_is_fully_invoice_covered,
    get_edit_cart_stale_hours,
    non_void_invoice_barcode_ids,
)
from backend.pos.models import Cart


class Command(BaseCommand):
    help = (
        'Clean up abandoned carts (normal TTL + shorter EDIT TTL) with '
        'barcode-safe discard (preserve non-void invoice barcodes).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--hours', type=int, default=24,
            help='Age threshold in hours for normal carts (default: 24)',
        )
        parser.add_argument(
            '--edit-hours', type=int, default=None,
            help=(
                'Age threshold in hours for EDIT-* invoice-edit carts '
                '(default: Admin Setting edit_cart_stale_hours, usually 1)'
            ),
        )
        parser.add_argument(
            '--edit-only', action='store_true',
            help='Only consider EDIT-* invoice-edit carts.',
        )
        parser.add_argument(
            '--stale-edit-now', action='store_true',
            help=(
                'Also clear EDIT-* carts whose scanned barcodes are all already '
                'on a non-void invoice, regardless of age.'
            ),
        )
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually delete carts. Without this flag, runs in dry-run mode.',
        )

    def handle(self, *args, **options):
        hours = options['hours']
        edit_hours = options['edit_hours']
        if edit_hours is None:
            edit_hours = get_edit_cart_stale_hours()
        edit_only = options['edit_only']
        apply = options['apply']
        # --stale-edit-now is accepted for ops/docs; fully-covered EDIT carts
        # are always included below (immediate clear of post-save orphans).

        now = timezone.now()
        normal_cutoff = now - timedelta(hours=hours)
        edit_cutoff = now - timedelta(hours=edit_hours)

        qs = Cart.objects.filter(status__in=['active', 'held']).prefetch_related(
            'items', 'items__product', 'items__variant',
        )

        if edit_only:
            qs = qs.filter(cart_number__istartswith='EDIT-')

        # Age-based candidates
        age_q = Q(cart_number__istartswith='EDIT-', updated_at__lt=edit_cutoff)
        if not edit_only:
            age_q = age_q | (
                ~Q(cart_number__istartswith='EDIT-') & Q(updated_at__lt=normal_cutoff)
            )
        age_ids = set(qs.filter(age_q).values_list('id', flat=True))

        # Fully invoice-covered EDIT carts: clear immediately (post-save orphans).
        stale_ids: set[int] = set()
        protected_ids = non_void_invoice_barcode_ids()
        edit_qs = qs.filter(cart_number__istartswith='EDIT-')
        for cart in edit_qs.exclude(id__in=age_ids):
            if edit_cart_is_fully_invoice_covered(cart, protected_ids):
                stale_ids.add(cart.id)

        candidate_ids = age_ids | stale_ids
        if not candidate_ids:
            self.stdout.write(self.style.SUCCESS('No abandoned carts found.'))
            return

        abandoned = list(
            Cart.objects.filter(id__in=candidate_ids)
            .prefetch_related('items', 'items__product', 'items__variant')
            .order_by('updated_at')
        )
        count = len(abandoned)
        self.stdout.write(
            f'Found {count} abandoned cart(s) '
            f'(normal>{hours}h, EDIT>{edit_hours}h'
            f'{", +fully invoice-covered EDIT" if stale_ids else ""}).'
        )

        if not apply:
            for cart in abandoned:
                reason = []
                is_edit = (cart.cart_number or '').upper().startswith('EDIT-')
                if cart.id in age_ids:
                    reason.append(f'age>{edit_hours if is_edit else hours}h')
                if cart.id in stale_ids:
                    reason.append('fully-invoice-covered')
                self.stdout.write(
                    f'  [DRY-RUN] Cart #{cart.cart_number} '
                    f'(updated {cart.updated_at}, {", ".join(reason) or "matched"})'
                )
            self.stdout.write(self.style.WARNING('Run with --apply to delete them.'))
            return

        restored = 0
        for cart in abandoned:
            cart_number = cart.cart_number
            try:
                summary = discard_cart_safely(cart)
                restored += 1
                self.stdout.write(
                    f'  Cleaned cart #{cart_number} '
                    f'(released={summary["released"]}, preserved={summary["preserved"]}, '
                    f'stock_lines={summary["stock_restored_lines"]})'
                )
            except Exception as e:
                self.stderr.write(f'  Error cleaning cart #{cart_number}: {e}')

        self.stdout.write(
            self.style.SUCCESS(f'Done. Cleaned {restored}/{count} abandoned cart(s).')
        )
