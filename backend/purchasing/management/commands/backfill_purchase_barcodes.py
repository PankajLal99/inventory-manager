"""
Backfill barcodes for PurchaseItems where barcode count is less than purchase quantity
(e.g. created when generate_barcodes_for_purchase_item was disabled, or generation failed partway).
Only generates the missing barcodes; never overwrites or duplicates existing ones.
Label generation (Azure/local) is skipped when DISABLE_BARCODE_LABEL_GENERATION is True.
"""
from django.core.management.base import BaseCommand
from django.db.models import Count, F
from backend.purchasing.models import PurchaseItem
from backend.purchasing.serializers import generate_barcodes_for_purchase_item


class Command(BaseCommand):
    help = 'Generate missing barcodes for purchase items where barcode count < quantity'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be done without creating barcodes',
        )
        parser.add_argument(
            '--product-id',
            type=int,
            metavar='ID',
            help='Only backfill for this product ID (e.g. 1851)',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        product_id = options.get('product_id')

        self.stdout.write(self.style.NOTICE(
            f"Backfill purchase barcodes... {'(DRY RUN)' if dry_run else ''}"
        ))

        # PurchaseItems with tracked product, quantity > 0, and barcode_count < quantity
        qs = PurchaseItem.objects.filter(
            product__track_inventory=True,
            quantity__gt=0,
        ).annotate(
            barcode_count=Count('barcodes'),
        ).filter(barcode_count__lt=F('quantity')).select_related('product', 'purchase', 'purchase__supplier')

        if product_id:
            qs = qs.filter(product_id=product_id)

        items = list(qs)
        # Shortfall per item: how many barcodes to generate
        shortfalls = [(item, max(0, int(item.quantity) - item.barcode_count)) for item in items]
        shortfalls = [(item, qty) for item, qty in shortfalls if qty > 0]
        total_items = len(shortfalls)
        total_quantity = sum(qty for _, qty in shortfalls)

        self.stdout.write(
            f"Found {total_items} purchase item(s) with missing barcodes "
            f"(total {total_quantity} barcode(s) to generate)."
        )
        if not shortfalls:
            self.stdout.write(self.style.SUCCESS("Nothing to do."))
            return

        for item, shortfall in shortfalls:
            self.stdout.write(
                f"  PurchaseItem id={item.id} product={item.product.name} (id={item.product_id}) "
                f"qty={item.quantity} has {item.barcode_count} barcode(s) → generate {shortfall} more"
            )

        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Dry run: would generate {total_quantity} barcode(s) for {total_items} item(s). "
                    "Run without --dry-run to apply."
                )
            )
            return

        created_total = 0
        for item, shortfall in shortfalls:
            try:
                generate_barcodes_for_purchase_item(item, shortfall)
                created_total += shortfall
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  ✓ Generated {shortfall} barcode(s) for {item.product.name} "
                        f"(PurchaseItem {item.id}, {item.purchase.purchase_number or item.purchase_id})"
                    )
                )
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(
                        f"  ✗ Failed PurchaseItem {item.id} ({item.product.name}): {e}"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone. Generated {created_total} barcode(s) for {total_items} purchase item(s)."
            )
        )
