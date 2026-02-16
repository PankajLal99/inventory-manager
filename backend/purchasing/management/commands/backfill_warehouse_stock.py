"""
Django management command to backfill Stock at warehouse from finalized PurchaseItems.
Populates warehouse Stock records based on PurchaseItem.warehouse_quantity for purchases
where stock was never redistributed or was missing (e.g. before GODOWN was configured).

Idempotent: only adds the deficit (expected - current) per product/variant/warehouse,
so safe to run multiple times.
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from decimal import Decimal
from backend.inventory.models import Stock
from backend.purchasing.models import PurchaseItem
from backend.locations.models import Warehouse


class Command(BaseCommand):
    help = 'Backfill warehouse Stock from PurchaseItem.warehouse_quantity (finalized purchases)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be changed without updating Stock',
        )
        parser.add_argument(
            '--warehouse-code',
            type=str,
            default='GODOWN',
            help='Warehouse code to use when purchase.warehouse is not set (default: GODOWN)',
        )
        parser.add_argument(
            '--product-id',
            type=int,
            help='Limit backfill to a specific product ID',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run', False)
        warehouse_code = options.get('warehouse_code', 'GODOWN')
        product_id = options.get('product_id')

        self.stdout.write('=' * 70)
        self.stdout.write(self.style.SUCCESS('BACKFILL WAREHOUSE STOCK'))
        self.stdout.write('=' * 70)
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - No changes will be made'))
        self.stdout.write('')

        # Resolve default warehouse
        default_warehouse = Warehouse.objects.filter(
            code=warehouse_code, is_active=True
        ).first()
        if not default_warehouse:
            self.stdout.write(
                self.style.ERROR(
                    f"Warehouse with code '{warehouse_code}' not found or inactive."
                )
            )
            return

        self.stdout.write(f"Default warehouse: {default_warehouse.name} ({warehouse_code})")
        self.stdout.write('')

        # Build expected warehouse quantities per (product_id, variant_id, warehouse_id)
        # From finalized purchases; use purchase.warehouse or default_warehouse
        items = (
            PurchaseItem.objects.filter(
                purchase__status='finalized',
                warehouse_quantity__gt=0,
            )
            .select_related('purchase', 'product', 'variant')
        )
        if product_id:
            items = items.filter(product_id=product_id)

        # Aggregate per (product, variant, warehouse)
        # Group by purchase to get warehouse per purchase, then by product/variant
        expected = {}  # (product_id, variant_id, warehouse_id) -> Decimal
        for item in items:
            warehouse = item.purchase.warehouse or default_warehouse
            key = (item.product_id, item.variant_id or 0, warehouse.id)
            expected[key] = expected.get(key, Decimal('0')) + item.warehouse_quantity

        if not expected:
            self.stdout.write(
                self.style.NOTICE(
                    'No finalized purchase items with warehouse_quantity > 0 found.'
                )
            )
            return

        self.stdout.write(f"Expected warehouse quantities: {len(expected)} product/variant/warehouse combinations")
        self.stdout.write('')

        updates = []
        with transaction.atomic():
            for (product_id_, variant_id_, warehouse_id_), qty_expected in expected.items():
                variant_id = variant_id_ if variant_id_ else None
                warehouse = Warehouse.objects.get(pk=warehouse_id_)

                stock, created = Stock.objects.get_or_create(
                    product_id=product_id_,
                    variant_id=variant_id,
                    store=None,
                    warehouse_id=warehouse_id_,
                    defaults={'quantity': Decimal('0.000')},
                )
                current = stock.quantity
                deficit = qty_expected - current
                if deficit <= 0:
                    continue

                updates.append({
                    'product_id': product_id_,
                    'variant_id': variant_id,
                    'warehouse': warehouse,
                    'current': current,
                    'add': deficit,
                    'new': current + deficit,
                    'stock': stock,
                })

                if not dry_run:
                    stock.quantity += deficit
                    stock.save()

        # Report
        self.stdout.write(self.style.WARNING('UPDATES:'))
        for u in updates[:20]:
            v = f" (variant {u['variant_id']})" if u['variant_id'] else ''
            self.stdout.write(
                f"  Product {u['product_id']}{v} @ {u['warehouse'].name}: "
                f"{u['current']} + {u['add']} -> {u['new']}"
            )
        if len(updates) > 20:
            self.stdout.write(f"  ... and {len(updates) - 20} more")

        self.stdout.write('')
        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Dry run: would update {len(updates)} Stock records. "
                    "Run without --dry-run to apply."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(f"Backfill complete. Updated {len(updates)} Stock records.")
            )
        self.stdout.write('=' * 70)
