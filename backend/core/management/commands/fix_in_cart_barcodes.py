"""
Management command to update all barcodes with 'in-cart' tag to 'new'
This fixes barcodes that may have been stuck in 'in-cart' status
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from backend.catalog.models import Barcode


class Command(BaseCommand):
    help = "Updates all barcodes with 'in-cart' tag to 'new'"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be updated without making changes',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(self.style.SUCCESS("FIX IN-CART BARCODES"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(f"Dry Run: {dry_run}\n")

        # Find all barcodes with 'in-cart' tag
        in_cart_barcodes = Barcode.objects.filter(tag='in-cart')

        count = in_cart_barcodes.count()

        if count == 0:
            self.stdout.write(self.style.SUCCESS("No barcodes with 'in-cart' tag found. All barcodes are already fixed."))
            return

        self.stdout.write(f"Found {count} barcode(s) with 'in-cart' tag:\n")

        # Show details of barcodes that will be updated
        for barcode in in_cart_barcodes[:20]:  # Show first 20
            product_name = barcode.product.name if barcode.product else 'Unknown'
            self.stdout.write(f"  - {barcode.barcode} (Product: {product_name})")

        if count > 20:
            self.stdout.write(f"  ... and {count - 20} more")

        if dry_run:
            self.stdout.write(self.style.WARNING("\n[DRY RUN] Would update all barcodes from 'in-cart' to 'new'"))
            self.stdout.write(self.style.WARNING(f"[DRY RUN] Total barcodes to update: {count}"))
        else:
            self.stdout.write(self.style.WARNING(f"\nUpdating {count} barcode(s) from 'in-cart' to 'new'..."))

            with transaction.atomic():
                updated_count = in_cart_barcodes.update(tag='new')

            self.stdout.write(self.style.SUCCESS(f"\n✓ Successfully updated {updated_count} barcode(s) from 'in-cart' to 'new'"))

        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(self.style.SUCCESS("COMPLETE"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))

