import csv
import os
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from backend.catalog.models import Product, Category, Brand
from backend.tenants.models import Retailer


class Command(BaseCommand):
    help = 'Populate products from CSV file (Product Name, Category, Brand; Unit optional)'

    def add_arguments(self, parser):
        parser.add_argument(
            'csv_file',
            type=str,
            help='Path to the CSV file to import from'
        )
        parser.add_argument(
            '--retailer-id',
            type=int,
            default=None,
            help='Retailer ID to associate products with (defaults to first active retailer)'
        )
        parser.add_argument(
            '--skip-duplicates',
            action='store_true',
            help='Skip products that already exist by name (default: update)'
        )

    def handle(self, *args, **options):
        csv_file = options['csv_file']
        retailer_id = options['retailer_id']
        skip_duplicates = options['skip_duplicates']

        # Validate CSV file exists
        if not os.path.isfile(csv_file):
            raise CommandError(f'CSV file not found: {csv_file}')

        # Get retailer
        if retailer_id:
            try:
                retailer = Retailer.objects.get(id=retailer_id)
            except Retailer.DoesNotExist:
                raise CommandError(f'Retailer with ID {retailer_id} not found')
        else:
            retailer = Retailer.objects.filter(is_active=True).first()
            if not retailer:
                raise CommandError('No active retailers found. Create a retailer first or specify --retailer-id')

        self.stdout.write(f'Using retailer: {retailer.name}')

        # Read and process CSV
        product_count = 0
        category_count = 0
        brand_count = 0
        skipped_count = 0
        error_count = 0

        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                
                # Validate required columns. Unit is optional and defaults to EACH.
                required_columns = ['Product Name', 'Category', 'Brand']
                if not reader.fieldnames or not all(col in reader.fieldnames for col in required_columns):
                    raise CommandError(f'CSV must contain columns: {", ".join(required_columns)}')

                with transaction.atomic():
                    for row_num, row in enumerate(reader, start=2):  # Start at 2 (after header)
                        try:
                            product_name = row.get('Product Name', '').strip()
                            unit = (row.get('Unit') or 'EACH').strip() or 'EACH'
                            category_name = row.get('Category', '').strip()
                            brand_name = row.get('Brand', '').strip()

                            # Validate required fields
                            if not product_name:
                                self.stdout.write(self.style.WARNING(f'Row {row_num}: Skipping - Product Name is empty'))
                                skipped_count += 1
                                continue

                            # Get or create Category
                            category = None
                            if category_name:
                                category, created = Category.objects.get_or_create(
                                    retailer=retailer,
                                    name=category_name,
                                    defaults={'is_active': True}
                                )
                                if created:
                                    category_count += 1
                                    self.stdout.write(self.style.SUCCESS(f'Created category: {category_name}'))

                            # Get or create Brand
                            brand = None
                            if brand_name:
                                brand, created = Brand.objects.get_or_create(
                                    retailer=retailer,
                                    name=brand_name,
                                    defaults={'is_active': True}
                                )
                                if created:
                                    brand_count += 1
                                    self.stdout.write(self.style.SUCCESS(f'Created brand: {brand_name}'))

                            # Get or create Product
                            product, created = Product.objects.get_or_create(
                                retailer=retailer,
                                name=product_name,
                                defaults={
                                    'category': category,
                                    'brand': brand,
                                    'is_active': True,
                                    'track_inventory': True,
                                }
                            )

                            if created:
                                product_count += 1
                                self.stdout.write(self.style.SUCCESS(f'Created product: {product_name}'))
                            else:
                                if skip_duplicates:
                                    skipped_count += 1
                                    self.stdout.write(self.style.WARNING(f'Row {row_num}: Skipping duplicate - {product_name}'))
                                else:
                                    # Update existing product
                                    product.category = category
                                    product.brand = brand
                                    product.save(update_fields=['category', 'brand'])
                                    self.stdout.write(self.style.SUCCESS(f'Updated product: {product_name}'))

                        except Exception as e:
                            error_count += 1
                            self.stdout.write(self.style.ERROR(f'Row {row_num}: Error - {str(e)}'))

        except IOError as e:
            raise CommandError(f'Error reading CSV file: {str(e)}')

        # Summary
        self.stdout.write(self.style.SUCCESS('\n' + '='*60))
        self.stdout.write(self.style.SUCCESS(f'Import complete!'))
        self.stdout.write(f'Products created: {product_count}')
        self.stdout.write(f'Categories created: {category_count}')
        self.stdout.write(f'Brands created: {brand_count}')
        self.stdout.write(f'Rows skipped: {skipped_count}')
        self.stdout.write(f'Errors: {error_count}')
        self.stdout.write(self.style.SUCCESS('='*60))
