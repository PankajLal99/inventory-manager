"""
Management command to clean up abandoned carts and restore their stock.

Abandoned carts permanently reduce stock because quantity is decremented
at cart-add time. This command finds carts older than a threshold that
are still 'active' or 'held' and restores their stock.

Usage:
    python manage.py cleanup_abandoned_carts              # dry-run (default)
    python manage.py cleanup_abandoned_carts --apply       # actually delete
    python manage.py cleanup_abandoned_carts --hours 12    # custom threshold

Schedule via cron (e.g. every 6 hours):
    0 */6 * * * cd /path/to/project && python manage.py cleanup_abandoned_carts --apply
"""

from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from backend.catalog.barcode_cache import invalidate_barcode_cache
from backend.catalog.models import Barcode
from backend.inventory.models import Stock
from backend.pos.models import Cart


class Command(BaseCommand):
    help = 'Clean up abandoned carts older than N hours and restore their stock.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--hours', type=int, default=24,
            help='Age threshold in hours (default: 24)',
        )
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually delete carts. Without this flag, runs in dry-run mode.',
        )

    def handle(self, *args, **options):
        hours = options['hours']
        apply = options['apply']
        cutoff = timezone.now() - timedelta(hours=hours)

        abandoned = Cart.objects.filter(
            status__in=['active', 'held'],
            updated_at__lt=cutoff,
        ).prefetch_related('items', 'items__product', 'items__variant')

        count = abandoned.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS('No abandoned carts found.'))
            return

        self.stdout.write(f'Found {count} abandoned cart(s) older than {hours}h.')

        if not apply:
            for cart in abandoned:
                self.stdout.write(f'  [DRY-RUN] Cart #{cart.cart_number} (updated {cart.updated_at})')
            self.stdout.write(self.style.WARNING('Run with --apply to delete them.'))
            return

        restored = 0
        for cart in abandoned:
            try:
                with transaction.atomic():
                    # Restore stock for each item
                    for item in cart.items.all():
                        if not item.product.track_inventory and cart.store:
                            stock, _ = Stock.objects.select_for_update().get_or_create(
                                product=item.product,
                                variant=item.variant,
                                store=cart.store,
                                defaults={'quantity': Decimal('0.000')},
                            )
                            Stock.objects.filter(id=stock.id).update(
                                quantity=F('quantity') + item.quantity,
                            )

                        # Restore barcode tags for tracked items
                        if item.scanned_barcodes:
                            for bc_val in item.scanned_barcodes:
                                if not bc_val:
                                    continue
                                b_upper = str(bc_val).strip().upper()
                                try:
                                    try:
                                        barcode_obj = Barcode.objects.select_for_update().get(barcode=b_upper)
                                    except Barcode.DoesNotExist:
                                        barcode_obj = Barcode.objects.select_for_update().get(short_code=b_upper)
                                    if barcode_obj.tag == 'in-cart':
                                        barcode_obj.tag = 'new'
                                        barcode_obj.save(update_fields=['tag'])
                                        invalidate_barcode_cache(barcode_obj)
                                except Barcode.DoesNotExist:
                                    pass

                    cart.delete()
                    restored += 1
                    self.stdout.write(f'  Cleaned cart #{cart.cart_number}')
            except Exception as e:
                self.stderr.write(f'  Error cleaning cart #{cart.cart_number}: {e}')

        self.stdout.write(self.style.SUCCESS(f'Done. Cleaned {restored}/{count} abandoned cart(s).'))
