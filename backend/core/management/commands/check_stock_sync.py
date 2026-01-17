"""
Django management command to check Stock model synchronization with Barcodes
and analyze audit logs to understand what happened
"""
from django.core.management.base import BaseCommand
from django.db.models import Sum, Count
from decimal import Decimal
from backend.inventory.models import Stock, StockAdjustment
from backend.catalog.models import Product, Barcode
from backend.core.models import AuditLog


class Command(BaseCommand):
    help = 'Check Stock model synchronization with Barcodes and analyze audit logs'

    def add_arguments(self, parser):
        parser.add_argument(
            '--product-id',
            type=int,
            help='Check specific product ID only',
        )
        parser.add_argument(
            '--show-all',
            action='store_true',
            help='Show all products, not just discrepancies',
        )
        parser.add_argument(
            '--audit-limit',
            type=int,
            default=50,
            help='Number of recent audit logs to show (default: 50)',
        )

    def handle(self, *args, **options):
        product_id = options.get('product_id')
        show_all = options.get('show_all', False)
        audit_limit = options.get('audit_limit', 50)

        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("STOCK vs BARCODE SYNCHRONIZATION ANALYSIS"))
        self.stdout.write("=" * 80)
        self.stdout.write("")

        # Get products
        if product_id:
            products = Product.objects.filter(id=product_id)
        else:
            products = Product.objects.all().order_by('id')

        self.stdout.write(f"Total Products: {products.count()}")
        self.stdout.write("")

        discrepancies = []
        sync_issues = []

        for product in products:
            # Get stock quantity from Stock model
            stock_entries = Stock.objects.filter(product=product)
            stock_qty = stock_entries.aggregate(total=Sum('quantity'))['total'] or Decimal('0.000')
            
            # Get barcode counts
            barcode_new_returned = Barcode.objects.filter(
                product=product,
                tag__in=['new', 'returned']
            ).count()
            
            barcode_total = Barcode.objects.filter(product=product).count()
            barcode_sold = Barcode.objects.filter(product=product, tag='sold').count()
            barcode_in_cart = Barcode.objects.filter(product=product, tag='in-cart').count()
            barcode_defective = Barcode.objects.filter(product=product, tag='defective').count()
            barcode_unknown = Barcode.objects.filter(product=product, tag='unknown').count()
            barcode_returned = Barcode.objects.filter(product=product, tag='returned').count()
            
            # Calculate difference
            difference = float(stock_qty) - barcode_new_returned
            
            # Track discrepancies
            if abs(difference) > 0.001:  # More than 0.001 difference
                discrepancies.append({
                    'product': product,
                    'stock_qty': float(stock_qty),
                    'barcode_new_returned': barcode_new_returned,
                    'difference': difference,
                    'track_inventory': product.track_inventory
                })
            
            # Show details for products with issues or if show_all
            if show_all or abs(difference) > 0.001 or barcode_total > 0:
                self.stdout.write(f"Product: {product.name} (ID: {product.id})")
                self.stdout.write(f"  Track Inventory: {product.track_inventory}")
                self.stdout.write(f"  Stock Model Total: {stock_qty}")
                self.stdout.write(f"  Barcodes (new+returned): {barcode_new_returned}")
                self.stdout.write(f"  Barcodes (total): {barcode_total}")
                self.stdout.write(f"    - New: {barcode_new_returned - barcode_returned}")
                self.stdout.write(f"    - Returned: {barcode_returned}")
                self.stdout.write(f"    - Sold: {barcode_sold}")
                self.stdout.write(f"    - In Cart: {barcode_in_cart}")
                self.stdout.write(f"    - Defective: {barcode_defective}")
                self.stdout.write(f"    - Unknown: {barcode_unknown}")
                self.stdout.write(f"  Difference: {difference:+.3f}")
                
                if abs(difference) > 0.001:
                    if difference > 0:
                        self.stdout.write(self.style.WARNING(f"  ⚠️  Stock is HIGHER than barcodes (by {difference:.3f})"))
                    else:
                        self.stdout.write(self.style.WARNING(f"  ⚠️  Stock is LOWER than barcodes (by {abs(difference):.3f})"))
                else:
                    self.stdout.write(self.style.SUCCESS("  ✓ Stock and barcodes are in sync"))
                
                # Check stock entries by location
                if stock_entries.exists():
                    self.stdout.write(f"  Stock Entries by Location:")
                    for entry in stock_entries:
                        location = entry.store.name if entry.store else (entry.warehouse.name if entry.warehouse else 'No Location')
                        self.stdout.write(f"    - {location}: {entry.quantity} (reserved: {entry.reserved_quantity})")
                
                self.stdout.write("")

        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("DISCREPANCIES SUMMARY"))
        self.stdout.write("=" * 80)
        self.stdout.write(f"Total Products with Discrepancies: {len(discrepancies)}")
        self.stdout.write("")

        if discrepancies:
            self.stdout.write(self.style.WARNING("Products with Stock-Barcode Mismatch:"))
            for item in discrepancies:
                self.stdout.write(f"  - {item['product'].name} (ID: {item['product'].id})")
                self.stdout.write(f"    Stock: {item['stock_qty']}, Barcodes (new+returned): {item['barcode_new_returned']}, Diff: {item['difference']:+.3f}")
                self.stdout.write(f"    Track Inventory: {item['track_inventory']}")
                self.stdout.write("")
        else:
            self.stdout.write(self.style.SUCCESS("✓ No discrepancies found!"))

        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("RECENT AUDIT LOGS - STOCK OPERATIONS"))
        self.stdout.write("=" * 80)
        self.stdout.write("")

        # Get recent stock-related audit logs
        stock_actions = ['stock_purchase', 'stock_adjust', 'stock_sale', 'cart_add', 'cart_remove', 'cart_checkout']
        recent_logs = AuditLog.objects.filter(
            action__in=stock_actions
        ).order_by('-created_at')[:audit_limit]

        self.stdout.write(f"Recent Stock-Related Audit Logs (last {audit_limit}):")
        self.stdout.write("")

        if recent_logs.exists():
            for log in recent_logs:
                self.stdout.write(f"[{log.created_at.strftime('%Y-%m-%d %H:%M:%S')}] {log.action}")
                self.stdout.write(f"  Model: {log.model_name}, Object: {log.object_name or log.object_id}")
                if log.barcode:
                    self.stdout.write(f"  Barcode: {log.barcode}")
                if log.changes:
                    import json
                    changes_str = json.dumps(log.changes, indent=4)
                    self.stdout.write(f"  Changes: {changes_str}")
                self.stdout.write("")
        else:
            self.stdout.write("  No stock-related audit logs found.")
            self.stdout.write("")

        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("RECENT STOCK ADJUSTMENTS"))
        self.stdout.write("=" * 80)
        self.stdout.write("")

        recent_adjustments = StockAdjustment.objects.all().order_by('-created_at')[:20]

        self.stdout.write(f"Recent Stock Adjustments (last 20):")
        self.stdout.write("")

        if recent_adjustments.exists():
            for adj in recent_adjustments:
                location = adj.store.name if adj.store else (adj.warehouse.name if adj.warehouse else 'No Location')
                self.stdout.write(f"[{adj.created_at.strftime('%Y-%m-%d %H:%M:%S')}] {adj.adjustment_type.upper()}")
                self.stdout.write(f"  Product: {adj.product.name}")
                self.stdout.write(f"  Quantity: {adj.quantity}")
                self.stdout.write(f"  Location: {location}")
                self.stdout.write(f"  Reason: {adj.reason}")
                if adj.notes:
                    self.stdout.write(f"  Notes: {adj.notes}")
                self.stdout.write("")
        else:
            self.stdout.write("  No stock adjustments found.")
            self.stdout.write("")

        self.stdout.write("=" * 80)
        self.stdout.write(self.style.SUCCESS("ANALYSIS COMPLETE"))
        self.stdout.write("=" * 80)

