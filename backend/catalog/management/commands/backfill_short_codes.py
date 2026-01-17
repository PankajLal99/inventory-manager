from django.core.management.base import BaseCommand
from backend.catalog.models import Barcode, Product
from backend.catalog.utils import get_prefix_for_product, get_max_number_for_prefix
import re


class Command(BaseCommand):
    help = 'Backfill and update short_code field for existing barcodes using category-based format (e.g., HOU-56789)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Run without making changes to see what would be updated',
        )
        parser.add_argument(
            '--update-existing',
            action='store_true',
            help='Also update existing short_codes that don\'t match the new category-based format',
        )

    def needs_update(self, barcode, expected_prefix):
        """
        Check if a barcode's short_code needs to be updated.
        Returns True if:
        - short_code is None/empty
        - short_code doesn't start with the expected prefix
        - short_code doesn't match the format PREFIX-NUMBER
        """
        if not barcode.short_code:
            return True
        
        # Check if it starts with expected prefix
        if not barcode.short_code.startswith(f'{expected_prefix}-'):
            return True
        
        # Check if it matches the format PREFIX-NUMBER (where NUMBER is 4-5 digits)
        pattern = rf'^{re.escape(expected_prefix)}-\d{{4,5}}$'
        if not re.match(pattern, barcode.short_code):
            return True
        
        return False

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        update_existing = options.get('update_existing', False)
        
        # Get all barcodes that have a product
        if update_existing:
            # Get all barcodes with products (including those with existing short_codes)
            barcodes = Barcode.objects.exclude(
                product__isnull=True
            ).select_related('product', 'product__category')
            self.stdout.write('Processing all barcodes (including updating existing short_codes)...')
        else:
            # Only get barcodes without short_code
            barcodes = Barcode.objects.filter(
                short_code__isnull=True
            ).exclude(product__isnull=True).select_related('product', 'product__category')
            self.stdout.write('Processing only barcodes without short_code...')
        
        total_count = barcodes.count()
        updated_count = 0
        skipped_count = 0
        error_count = 0
        already_correct_count = 0
        
        self.stdout.write(f'Found {total_count} barcodes to process')
        
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN MODE - No changes will be made'))
        
        # Track prefix counters to ensure sequential numbering within each prefix
        prefix_counters = {}
        
        for barcode in barcodes:
            try:
                product = barcode.product
                if not product:
                    skipped_count += 1
                    self.stdout.write(f'  - Skipped {barcode.barcode} - no product associated')
                    continue
                
                # Get prefix for this product (category-based)
                expected_prefix = get_prefix_for_product(product)
                
                # Check if update is needed
                if not self.needs_update(barcode, expected_prefix):
                    already_correct_count += 1
                    if already_correct_count % 100 == 0:
                        self.stdout.write(f'  Skipped {already_correct_count} already correct...')
                    continue
                
                # Initialize counter for this prefix if not exists
                if expected_prefix not in prefix_counters:
                    # Get the highest number already used for this prefix
                    existing_max = get_max_number_for_prefix(expected_prefix)
                    prefix_counters[expected_prefix] = existing_max
                
                # Increment counter for this prefix
                prefix_counters[expected_prefix] += 1
                next_number = prefix_counters[expected_prefix]
                
                # Generate short_code
                if next_number <= 9999:
                    short_code = f"{expected_prefix}-{next_number:04d}"
                else:
                    short_code = f"{expected_prefix}-{next_number:05d}"
                
                # Ensure uniqueness (shouldn't happen with sequential numbering, but safety check)
                original_short_code = short_code
                collision_counter = 0
                max_attempts = 10000
                
                while Barcode.objects.filter(short_code=short_code).exclude(id=barcode.id).exists():
                    collision_counter += 1
                    if collision_counter > max_attempts:
                        # Fallback: use UUID suffix if too many collisions
                        import uuid
                        unique_suffix = str(uuid.uuid4())[:8]
                        short_code = f"{original_short_code}-{unique_suffix}"
                        self.stdout.write(
                            self.style.WARNING(
                                f'  ⚠ Too many collisions for {expected_prefix}, using UUID: {barcode.barcode} -> {short_code}'
                            )
                        )
                        break
                    
                    # Increment number and try again
                    prefix_counters[expected_prefix] += 1
                    next_number = prefix_counters[expected_prefix]
                    if next_number <= 9999:
                        short_code = f"{expected_prefix}-{next_number:04d}"
                    else:
                        short_code = f"{expected_prefix}-{next_number:05d}"
                
                # Show what's being updated
                old_code = barcode.short_code or '(none)'
                if old_code != short_code:
                    if updated_count < 10 or updated_count % 100 == 0:
                        self.stdout.write(
                            f'  Updating: {barcode.barcode} | {old_code} -> {short_code}'
                        )
                
                if not dry_run:
                    barcode.short_code = short_code
                    barcode.save(update_fields=['short_code'])
                
                updated_count += 1
                if updated_count % 100 == 0:
                    self.stdout.write(f'  Processed {updated_count}/{total_count}...')
                    
            except Exception as e:
                error_count += 1
                self.stdout.write(
                    self.style.ERROR(
                        f'  ✗ Error processing {barcode.barcode}: {str(e)}'
                    )
                )
        
        if dry_run:
            self.stdout.write(self.style.SUCCESS(
                f'\nDRY RUN Complete: Would update {updated_count} barcodes, '
                f'{already_correct_count} already correct, '
                f'{skipped_count} skipped, {error_count} errors'
            ))
            # Show prefix summary
            if prefix_counters:
                self.stdout.write('\nPrefix counters:')
                for prefix, count in sorted(prefix_counters.items()):
                    self.stdout.write(f'  {prefix}: {count} codes')
        else:
            self.stdout.write(self.style.SUCCESS(
                f'\nCompleted: {updated_count} barcodes updated, '
                f'{already_correct_count} already correct, '
                f'{skipped_count} skipped, {error_count} errors'
            ))
            # Show prefix summary
            if prefix_counters:
                self.stdout.write('\nPrefix counters:')
                for prefix, count in sorted(prefix_counters.items()):
                    self.stdout.write(f'  {prefix}: {count} codes')
