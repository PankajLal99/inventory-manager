"""
Django management command to sync Stock model with barcode counts
This fixes discrepancies where Stock.quantity doesn't match barcode counts
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Sum
from decimal import Decimal
from backend.inventory.models import Stock
from backend.catalog.models import Product, Barcode
from backend.locations.models import Store, Warehouse


class Command(BaseCommand):
    help = 'Sync Stock model quantities with barcode counts (new + returned tags)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be changed without actually updating',
        )
        parser.add_argument(
            '--product-id',
            type=int,
            help='Sync specific product ID only',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Force sync even if no discrepancies found',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        product_id = options.get('product_id')
        force = options.get('force', False)

        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("STOCK SYNC FROM BARCODES"))
        self.stdout.write("=" * 80)
        self.stdout.write("")

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN MODE - No changes will be made"))
            self.stdout.write("")

        # Get products
        if product_id:
            products = Product.objects.filter(id=product_id)
        else:
            products = Product.objects.filter(track_inventory=True).order_by('id')

        # Get default location (first active store or warehouse)
        default_store = Store.objects.filter(is_active=True).first()
        default_warehouse = Warehouse.objects.filter(is_active=True).first() if not default_store else None

        if not default_store and not default_warehouse:
            self.stdout.write(self.style.ERROR("ERROR: No active Store or Warehouse found. Cannot sync stock."))
            return

        discrepancies = []
        updates_made = []

        with transaction.atomic():
            for product in products:
                # Count barcodes with 'new' and 'returned' tags (available stock)
                barcode_count = Barcode.objects.filter(
                    product=product,
                    tag__in=['new', 'returned']
                ).count()

                # Get or create stock entry for default location
                stock, created = Stock.objects.get_or_create(
                    product=product,
                    variant=None,
                    store=default_store,
                    warehouse=default_warehouse,
                    defaults={'quantity': Decimal('0.000')}
                )

                current_stock = float(stock.quantity)
                difference = current_stock - barcode_count

                # Only update if there's a discrepancy or force is enabled
                if abs(difference) > 0.001 or force:
                    discrepancies.append({
                        'product': product,
                        'current_stock': current_stock,
                        'barcode_count': barcode_count,
                        'difference': difference,
                        'stock_entry': stock,
                    })

                    if not dry_run:
                        old_quantity = stock.quantity
                        stock.quantity = Decimal(str(barcode_count))
                        stock.save()

                        updates_made.append({
                            'product': product,
                            'old_quantity': float(old_quantity),
                            'new_quantity': barcode_count,
                            'difference': difference,
                        })

        # Report results
        self.stdout.write(f"Products checked: {products.count()}")
        self.stdout.write(f"Discrepancies found: {len(discrepancies)}")
        self.stdout.write("")

        if discrepancies:
            self.stdout.write(self.style.WARNING("DISCREPANCIES FOUND:"))
            self.stdout.write("")
            for item in discrepancies:
                self.stdout.write(f"Product: {item['product'].name} (ID: {item['product'].id})")
                self.stdout.write(f"  Current Stock: {item['current_stock']}")
                self.stdout.write(f"  Barcode Count (new+returned): {item['barcode_count']}")
                self.stdout.write(f"  Difference: {item['difference']:+.3f}")
                if not dry_run:
                    update = next((u for u in updates_made if u['product'].id == item['product'].id), None)
                    if update:
                        self.stdout.write(f"  ✓ Updated: {update['old_quantity']} → {update['new_quantity']}")
                self.stdout.write("")
        else:
            self.stdout.write(self.style.SUCCESS("✓ No discrepancies found! Stock is in sync."))
            self.stdout.write("")

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN - No changes were made. Run without --dry-run to apply changes."))
        elif updates_made:
            self.stdout.write(self.style.SUCCESS(f"✓ Successfully updated {len(updates_made)} stock entries"))
            self.stdout.write("")
            self.stdout.write("Updated Products:")
            for update in updates_made:
                self.stdout.write(f"  - {update['product'].name}: {update['old_quantity']} → {update['new_quantity']}")

        self.stdout.write("")
        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("SYNC COMPLETE"))
        self.stdout.write("=" * 80)

