from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Count

from backend.catalog.models import Barcode
from backend.purchasing.models import PurchaseItem


class Command(BaseCommand):
    help = (
        "Check purchase-item quantity discrepancies: purchased vs allocated "
        "(shop+warehouse) and purchased vs barcode count."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--product-id",
            type=int,
            help="Filter to one product id (example: --product-id 3521)",
        )
        parser.add_argument(
            "--purchase-number",
            type=str,
            help="Filter to one purchase number (example: --purchase-number PUR-1001)",
        )
        parser.add_argument(
            "--fix-allocation",
            action="store_true",
            help=(
                "Normalize allocations to match purchased quantity exactly. "
                "Use with --dry-run to preview."
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview only; do not save changes.",
        )

    def handle(self, *args, **options):
        product_id = options.get("product_id")
        purchase_number = options.get("purchase_number")
        fix_allocation = options.get("fix_allocation", False)
        dry_run = options.get("dry_run", False)

        qs = (
            PurchaseItem.objects.filter(purchase__status="finalized")
            .select_related("purchase", "purchase__supplier", "product")
            .order_by("purchase__purchase_date", "id")
        )
        if product_id:
            qs = qs.filter(product_id=product_id)
        if purchase_number:
            qs = qs.filter(purchase__purchase_number=purchase_number)

        purchase_item_ids = list(qs.values_list("id", flat=True))
        tag_counts = {}
        if purchase_item_ids:
            for row in (
                Barcode.objects.filter(purchase_item_id__in=purchase_item_ids)
                .values("purchase_item_id", "tag")
                .annotate(c=Count("id"))
            ):
                pid = row["purchase_item_id"]
                tag = row["tag"]
                tag_counts.setdefault(pid, {})[tag] = row["c"]

        if dry_run:
            self.stdout.write(self.style.NOTICE("Running in DRY RUN mode (no changes will be saved)."))
        if fix_allocation:
            action = "Will fix allocation gaps." if not dry_run else "Would fix allocation gaps."
            self.stdout.write(self.style.NOTICE(action))
        else:
            self.stdout.write(self.style.NOTICE("Check-only mode (no changes requested)."))

        total_rows = 0
        discrepancy_rows = 0
        changed_rows = 0

        for item in qs:
            total_rows += 1

            qty = Decimal(item.quantity or 0)
            shop_alloc = Decimal(item.shop_quantity or 0)
            whse_alloc = Decimal(item.warehouse_quantity or 0)
            alloc_total = shop_alloc + whse_alloc

            tags = tag_counts.get(item.id, {})
            barcodes_total = sum(tags.values())

            alloc_gap = qty - alloc_total
            barcode_gap = qty - Decimal(barcodes_total)

            has_discrepancy = alloc_gap != 0 or barcode_gap != 0
            if not has_discrepancy:
                continue

            discrepancy_rows += 1
            supplier_name = "Unknown"
            if item.purchase and item.purchase.supplier:
                supplier_name = item.purchase.supplier.code or item.purchase.supplier.name
            purchase_no = item.purchase.purchase_number or f"Purchase-{item.purchase_id}"

            self.stdout.write(
                self.style.WARNING(
                    f"[DISCREPANCY] purchase_number={purchase_no} | purchase_item_id={item.id} "
                    f"| product_id={item.product_id} | supplier={supplier_name}"
                )
            )
            self.stdout.write(
                f"  purchased={qty}, shop_alloc={shop_alloc}, whse_alloc={whse_alloc}, "
                f"alloc_total={alloc_total}, alloc_gap={alloc_gap}"
            )
            self.stdout.write(
                f"  barcodes_total={barcodes_total}, barcode_gap={barcode_gap}, "
                f"tags(new={tags.get('new', 0)}, returned={tags.get('returned', 0)}, sold={tags.get('sold', 0)}, "
                f"defective={tags.get('defective', 0)}, unknown={tags.get('unknown', 0)}, in-cart={tags.get('in-cart', 0)})"
            )

            if fix_allocation and alloc_gap != 0:
                # Keep warehouse allocation when possible, and correct shop allocation
                # so shop + warehouse always equals purchased quantity.
                if whse_alloc <= qty:
                    new_whse_qty = whse_alloc
                    new_shop_qty = qty - whse_alloc
                else:
                    # If warehouse itself exceeds purchased qty, clamp warehouse and zero shop.
                    new_whse_qty = qty
                    new_shop_qty = Decimal("0")
                self.stdout.write(
                    self.style.NOTICE(
                        f"  fix: shop_quantity {shop_alloc} -> {new_shop_qty}, "
                        f"warehouse_quantity {whse_alloc} -> {new_whse_qty}"
                    )
                )
                final_total = new_shop_qty + new_whse_qty
                final_gap = qty - final_total
                self.stdout.write(
                    self.style.NOTICE(
                        f"  final: purchased={qty}, final_shop={new_shop_qty}, "
                        f"final_whse={new_whse_qty}, final_alloc_total={final_total}, final_gap={final_gap}"
                    )
                )
                if not dry_run:
                    item.shop_quantity = new_shop_qty
                    item.warehouse_quantity = new_whse_qty
                    item.save(update_fields=["shop_quantity", "warehouse_quantity"])
                    changed_rows += 1

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Scanned rows: {total_rows}"))
        self.stdout.write(self.style.SUCCESS(f"Rows with discrepancy: {discrepancy_rows}"))
        if fix_allocation:
            if dry_run:
                self.stdout.write(self.style.SUCCESS("Dry run complete. No rows updated."))
            else:
                self.stdout.write(self.style.SUCCESS(f"Rows updated: {changed_rows}"))
