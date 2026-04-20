"""Stock transfer: numbering and applying stock movements on completion."""

from __future__ import annotations

from decimal import Decimal
from django.db.models import Q

from backend.inventory.models import Stock, StockTransfer
from backend.catalog.models import Barcode


def generate_next_transfer_number(retailer) -> str:
    """
    Next human-readable transfer number for this retailer.
    Call inside transaction.atomic() after Retailer.select_for_update() to avoid duplicate numbers.
    """
    n = StockTransfer.objects.filter(retailer_id=retailer.id).count() + 1
    return f"{retailer.code}-TR-{n:06d}"


def apply_stock_transfer_completion(transfer: StockTransfer) -> None:
    """
    Move quantities from source location to destination for all line items.
    Caller must hold transaction.atomic and have locked the transfer row if needed.
    """
    from_store = transfer.from_store_id
    from_wh = transfer.from_warehouse_id
    to_store = transfer.to_store_id
    to_wh = transfer.to_warehouse_id

    items = list(
        transfer.items.select_related('product', 'variant').all()
    )
    if not items:
        raise ValueError('Transfer has no line items.')

    used_barcodes = set()
    for item in items:
        if item.product.retailer_id != transfer.retailer_id:
            raise ValueError(f'Product {item.product_id} does not belong to this retailer.')
        if item.variant_id and item.variant.product_id != item.product_id:
            raise ValueError('Variant does not match product on a transfer line.')

        qty = item.quantity
        if qty <= 0:
            raise ValueError('Line quantity must be positive.')
        if qty != qty.to_integral_value():
            raise ValueError('Line quantity must be a whole number for barcode/serial transfers.')

        selected_barcodes = [str(v).strip().upper() for v in (item.selected_barcodes or []) if str(v).strip()]
        if len(selected_barcodes) != int(qty):
            raise ValueError(f'Barcode/serial count mismatch for product {item.product_id}.')
        for code in selected_barcodes:
            if code in used_barcodes:
                raise ValueError(f'Barcode/serial repeated across lines: {code}')
            used_barcodes.add(code)
        if selected_barcodes:
            source_filter = {}
            if from_store:
                source_filter['current_store_id'] = from_store
            else:
                source_filter['current_warehouse_id'] = from_wh
            barcode_qs = Barcode.all_objects.select_for_update().filter(
                retailer_id=transfer.retailer_id,
                product_id=item.product_id,
                tag__in=['new', 'returned'],
                **source_filter,
            ).filter(Q(barcode__in=selected_barcodes) | Q(short_code__in=selected_barcodes))
            found = set()
            for barcode_value, short_code in barcode_qs.values_list('barcode', 'short_code'):
                if barcode_value:
                    found.add(str(barcode_value).upper())
                if short_code:
                    found.add(str(short_code).upper())
            missing = [c for c in selected_barcodes if c not in found]
            if missing:
                raise ValueError(
                    f'Selected barcode/serial not available for product {item.product_id}: {", ".join(missing)}'
                )
            if to_store:
                barcode_qs.update(current_store_id=to_store, current_warehouse_id=None)
            else:
                barcode_qs.update(current_store_id=None, current_warehouse_id=to_wh)

        src_kwargs = {
            'product_id': item.product_id,
            'variant_id': item.variant_id,
        }
        if from_store:
            src_kwargs['store_id'] = from_store
            src_kwargs['warehouse_id'] = None
        else:
            src_kwargs['store_id'] = None
            src_kwargs['warehouse_id'] = from_wh

        stock_src = (
            Stock.objects.select_for_update()
            .filter(**src_kwargs)
            .first()
        )
        if not stock_src or stock_src.quantity < qty:
            raise ValueError(
                f'Insufficient stock for product {item.product_id}'
                + (f' variant {item.variant_id}' if item.variant_id else '')
            )

        stock_src.quantity -= qty
        stock_src.save(update_fields=['quantity', 'updated_at'])

        dst_kwargs = {
            'product_id': item.product_id,
            'variant_id': item.variant_id,
        }
        if to_store:
            dst_kwargs['store_id'] = to_store
            dst_kwargs['warehouse_id'] = None
        else:
            dst_kwargs['store_id'] = None
            dst_kwargs['warehouse_id'] = to_wh

        stock_dst, _ = Stock.objects.select_for_update().get_or_create(
            **dst_kwargs,
            defaults={'quantity': Decimal('0.000')},
        )
        stock_dst.quantity += qty
        stock_dst.save(update_fields=['quantity', 'updated_at'])

        item.received_quantity = qty
        item.save(update_fields=['received_quantity'])

    transfer.status = 'completed'
    transfer.save(update_fields=['status', 'updated_at'])
