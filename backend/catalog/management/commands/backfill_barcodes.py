from django.core.management.base import BaseCommand
from ...models import Product, Barcode


class Command(BaseCommand):
    help = 'Backfill barcodes for products that have SKUs but no barcodes'

    def add_arguments(self, parser):
        parser.add_argument(
            '--retailer-code',
            type=str,
            default='',
            help='Optional retailer code to scope backfill to one tenant.',
        )

    def handle(self, *args, **options):
        retailer_code = (options.get('retailer_code') or '').strip()
        retailer = None
        if retailer_code:
            from backend.tenants.models import Retailer
            retailer = Retailer.objects.filter(code__iexact=retailer_code, is_active=True).first()
            if not retailer:
                self.stdout.write(self.style.ERROR(f'Retailer code "{retailer_code}" not found or inactive.'))
                return

        # Get all products with SKU
        products = Product.objects.filter(sku__isnull=False).prefetch_related('barcodes')
        if retailer:
            products = products.filter(retailer_id=retailer.id)
        products_without_barcodes = [p for p in products if not p.barcodes.exists()]
        
        created_count = 0
        skipped_count = 0
        error_count = 0
        
        self.stdout.write(f'Found {len(products_without_barcodes)} products without barcodes')
        
        for product in products_without_barcodes:
            if product.sku:
                try:
                    # Check if barcode with this SKU already exists globally (exact match only)
                    try:
                        existing_qs = Barcode.objects.filter(barcode=product.sku)
                        if retailer:
                            existing_qs = existing_qs.filter(retailer_id=retailer.id)
                        existing_barcode = existing_qs.get()
                    except Barcode.DoesNotExist:
                        existing_barcode = None
                    if existing_barcode:
                        # Link existing barcode to this product if not already linked
                        if not existing_barcode.product:
                            existing_barcode.product = product
                            existing_barcode.is_primary = True
                            existing_barcode.save()
                            created_count += 1
                            self.stdout.write(f'  ✓ Linked existing barcode to {product.name} (SKU: {product.sku})')
                        else:
                            skipped_count += 1
                            self.stdout.write(f'  - Skipped {product.name} (SKU: {product.sku}) - barcode already linked to another product')
                    else:
                        # Create new barcode
                        Barcode.objects.create(
                            retailer_id=product.retailer_id,
                            product=product,
                            barcode=product.sku,
                            is_primary=True
                        )
                        created_count += 1
                        self.stdout.write(f'  ✓ Created barcode for {product.name} (SKU: {product.sku})')
                except Exception as e:
                    error_count += 1
                    self.stdout.write(self.style.ERROR(f'  ✗ Error creating barcode for {product.name} (SKU: {product.sku}): {str(e)}'))
        
        self.stdout.write(self.style.SUCCESS(
            f'\nCompleted: {created_count} barcodes created/linked, {skipped_count} skipped, {error_count} errors'
        ))

