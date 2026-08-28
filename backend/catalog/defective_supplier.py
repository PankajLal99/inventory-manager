"""Helpers for matching defective barcodes to a move-out invoice's supplier."""
from __future__ import annotations

import re

from backend.catalog.models import Barcode, DefectiveProductItem, DefectiveProductMoveOut


def barcode_supplier(barcode_obj):
    """Return (supplier_id|None, supplier_name) for a barcode's purchase supplier."""
    if not barcode_obj:
        return None, 'No Supplier'

    b = Barcode.objects.select_related(
        'purchase__supplier',
        'purchase_item__purchase__supplier',
    ).filter(pk=barcode_obj.pk).first() or barcode_obj

    if getattr(b, 'purchase', None) and b.purchase.supplier_id:
        return b.purchase.supplier_id, b.purchase.supplier.name

    purchase_item = getattr(b, 'purchase_item', None)
    if (
        purchase_item is not None
        and getattr(purchase_item, 'purchase', None) is not None
        and purchase_item.purchase.supplier_id
    ):
        return purchase_item.purchase.supplier_id, purchase_item.purchase.supplier.name

    return None, 'No Supplier'


def normalize_supplier_name(name):
    cleaned = (name or '').strip()
    return cleaned.lower() if cleaned else 'no supplier'


def defective_suppliers_match(expected_id, expected_name, barcode_id, barcode_name):
    """True when barcode belongs to the same supplier as the move-out invoice."""
    if expected_id is not None and barcode_id is not None:
        return expected_id == barcode_id
    return normalize_supplier_name(expected_name) == normalize_supplier_name(barcode_name)


def defective_invoice_supplier(invoice):
    """Supplier this defective move-out invoice is written to: (id|None, name)."""
    move_out = DefectiveProductMoveOut.objects.filter(invoice=invoice).first()

    # Prefer supplier from barcodes already on the move-out / invoice
    barcode_ids = []
    if move_out:
        barcode_ids = list(
            DefectiveProductItem.objects.filter(move_out=move_out, barcode_id__isnull=False)
            .values_list('barcode_id', flat=True)[:1]
        )
    if not barcode_ids:
        barcode_ids = list(
            invoice.items.filter(barcode_id__isnull=False).values_list('barcode_id', flat=True)[:1]
        )
    if barcode_ids:
        barcode = Barcode.objects.filter(pk=barcode_ids[0]).first()
        if barcode:
            return barcode_supplier(barcode)

    # Empty invoice: resolve from linked customer name (created as supplier name)
    customer = getattr(invoice, 'customer', None)
    if customer and (customer.name or '').strip():
        from backend.parties.models import Supplier
        supplier = Supplier.objects.filter(name__iexact=customer.name.strip()).first()
        if supplier:
            return supplier.id, supplier.name
        return None, customer.name.strip()

    # Notes fallback: "[Supplier: KS] ..." or "Supplier: KS"
    if move_out and move_out.notes:
        match = re.search(r'\[?\s*Supplier:\s*([^\]\n]+?)\s*\]?', move_out.notes, re.IGNORECASE)
        if match:
            name = match.group(1).strip()
            if name:
                from backend.parties.models import Supplier
                supplier = Supplier.objects.filter(name__iexact=name).first()
                if supplier:
                    return supplier.id, supplier.name
                return None, name

    return None, 'No Supplier'
