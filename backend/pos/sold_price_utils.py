"""Selling-price helpers for invoice lines (trade-in, replacement lookup, etc.)."""
from decimal import Decimal


def effective_sold_unit_price(invoice_item) -> Decimal:
    """Unit price the customer was charged (manual sell price, else catalog unit on the line)."""
    mu = invoice_item.manual_unit_price
    if mu is not None and mu > 0:
        return mu
    if invoice_item.unit_price and invoice_item.unit_price > 0:
        return invoice_item.unit_price
    return Decimal('0.00')


def effective_sold_line_credit(invoice_item) -> Decimal:
    """
    Max credit for a sold line based on selling price (never purchase/cost).
    Uses line manual/unit prices, then barcode catalog selling price, then line_total.
    """
    qty = invoice_item.quantity or Decimal('0')
    if qty <= 0:
        return Decimal('0.00')

    unit = effective_sold_unit_price(invoice_item)
    if unit > 0:
        discount = invoice_item.discount_amount or Decimal('0')
        tax = invoice_item.tax_amount or Decimal('0')
        per_unit_disc = discount / qty
        per_unit_tax = tax / qty
        return (unit - per_unit_disc + per_unit_tax) * qty

    from .views import resolve_invoice_item_barcode

    barcode_obj = resolve_invoice_item_barcode(invoice_item, scanned_override=None, relink=False)
    if barcode_obj:
        selling = barcode_obj.get_selling_price()
        if selling and selling > 0:
            return selling * qty

    line_total = invoice_item.line_total or Decimal('0')
    return line_total if line_total > 0 else Decimal('0.00')
