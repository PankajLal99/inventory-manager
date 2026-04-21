
from decimal import Decimal, ROUND_HALF_UP

def calculate_gst_bifurcation(unit_price, quantity, tax_rate, is_inclusive=True):
    """
    Calculate GST bifurcation according to Indian GST laws (Intra-state only).
    Always splits tax into CGST (50%) and SGST (50%).
    
    Returns:
        dict: {
            'base_amount': Decimal,
            'total_tax': Decimal,
            'cgst': Decimal,
            'sgst': Decimal,
            'igst': Decimal,
            'cgst_rate': Decimal,
            'sgst_rate': Decimal,
            'igst_rate': Decimal,
            'total': Decimal
        }
    """
    q = Decimal(str(quantity))
    r = Decimal(str(tax_rate))
    p = Decimal(str(unit_price))
    
    total_raw = p * q
    
    if is_inclusive:
        # total_raw = base + (base * r/100) = base * (1 + r/100)
        # base = total_raw / (1 + r/100)
        base_amount = (total_raw / (Decimal('1') + (r / Decimal('100')))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        total_tax = (total_raw - base_amount).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    else:
        base_amount = total_raw.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        total_tax = (base_amount * (r / Decimal('100'))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    
    total = (base_amount + total_tax).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    
    # Always Intra-state (CGST+SGST) as per user request
    half_tax = (total_tax / Decimal('2')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    cgst = half_tax
    sgst = total_tax - half_tax # Avoid penny rounding issues
    cgst_rate = r / Decimal('2')
    sgst_rate = r / Decimal('2')
    
    igst = Decimal('0.00')
    igst_rate = Decimal('0.00')
        
    return {
        'base_amount': float(base_amount),
        'total_tax': float(total_tax),
        'cgst': float(cgst),
        'sgst': float(sgst),
        'igst': float(igst),
        'cgst_rate': float(cgst_rate),
        'sgst_rate': float(sgst_rate),
        'igst_rate': float(igst_rate),
        'total': float(total)
    }
