from django.core.management.base import BaseCommand
from backend.purchasing.models import PurchaseItem
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Backfills shop_quantity for PurchaseItem records where distribution is not yet set'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Simulate the backfill without saving changes',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        self.stdout.write(self.style.NOTICE(f"Starting backfill... {'(DRY RUN)' if dry_run else ''}"))
        
        # We target items where both shop and warehouse quantities are zero but total quantity exists
        items_to_update = PurchaseItem.objects.filter(
            shop_quantity=0,
            warehouse_quantity=0,
            quantity__gt=0
        )
        
        total_count = items_to_update.count()
        self.stdout.write(f"Found {total_count} items requiring backfill.")
        
        updated_count = 0
        for item in items_to_update:
            if not dry_run:
                item.shop_quantity = item.quantity
                item.warehouse_quantity = Decimal('0.000')
                item.save()
            
            updated_count += 1
            if updated_count % 50 == 0:
                self.stdout.write(f"Processed {updated_count}/{total_count}...")

        if dry_run:
            self.stdout.write(self.style.SUCCESS(f"Dry run complete. Would have updated {updated_count} records."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Backfill complete. Updated {updated_count} records."))
