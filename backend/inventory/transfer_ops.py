"""Stock transfer: numbering and applying stock movements on completion."""

from __future__ import annotations

from decimal import Decimal

from backend.inventory.models import Stock, StockTransfer


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

    for item in items:
        if item.product.retailer_id != transfer.retailer_id:
            raise ValueError(f'Product {item.product_id} does not belong to this retailer.')
        if item.variant_id and item.variant.product_id != item.product_id:
            raise ValueError('Variant does not match product on a transfer line.')

        qty = item.quantity
        if qty <= 0:
            raise ValueError('Line quantity must be positive.')

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
