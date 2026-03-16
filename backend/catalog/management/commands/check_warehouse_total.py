"""
Check warehouse total for a product (sum of PurchaseItem.warehouse_quantity for finalized purchases).
Use this to verify why a product appears or does not appear when "Warehouse Qty > 0" filter is on.
"""
from django.core.management.base import BaseCommand
from django.db.models import Sum
from backend.catalog.models import Product
from backend.purchasing.models import PurchaseItem


class Command(BaseCommand):
    help = 'Print warehouse total for a product (or all products) using the same logic as Stock Overview "Warehouse Qty > 0" filter'

    def add_arguments(self, parser):
        parser.add_argument(
            'product_id',
            type=int,
            nargs='?',
            help='Product ID to check (e.g. 4243). If omitted, use --all to check every product.'
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Check all products instead of a single product.',
        )

    def handle(self, *args, **options):
        product_id = options.get('product_id')
        check_all = options.get('all', False)

        if check_all or product_id is None:
            qs = Product.objects.all().order_by('id')
            self.stdout.write(f'Checking warehouse totals for all products (count={qs.count()})...')
            for product in qs:
                self._print_product_total(product)
            self.stdout.write(self.style.SUCCESS('Done.'))
            return

        try:
            product = Product.objects.get(pk=product_id)
        except Product.DoesNotExist:
            self.stdout.write(self.style.ERROR(f'Product id={product_id} not found.'))
            return

        self._print_product_total(product)

    def _print_product_total(self, product: Product) -> None:
        total = (
            PurchaseItem.objects.filter(
                product_id=product.id,
                purchase__status='finalized'
            ).aggregate(s=Sum('warehouse_quantity'))['s']
        )
        total_val = float(total or 0)
        passes_filter = total_val > 0

        self.stdout.write(f'Product id={product.id} name="{product.name}"')
        self.stdout.write(f'  Warehouse total (sum of PurchaseItem.warehouse_quantity, finalized only) = {total_val}')
        self.stdout.write(f'  Would appear when "Warehouse Qty > 0" is ON: {passes_filter}')
        if not passes_filter:
            self.stdout.write(self.style.WARNING('  So this product should NOT be in the list when the filter is checked.'))
        else:
            self.stdout.write(self.style.SUCCESS('  So this product should be in the list when the filter is checked.'))
