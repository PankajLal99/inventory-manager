import os
import django
import sys

# Set up Django environment
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../../"))
sys.path.append(PROJECT_ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from decimal import Decimal
from django.db.models import Count, Q
from backend.catalog.models import Barcode, Product
from backend.pos.models import Invoice, InvoiceItem, Cart, CartItem
from csv_logger import logger

def audit_barcodes():
    print("--- Barcode Audit Report ---")
    
    # 1. Barcodes marked SOLD but not linked to any InvoiceItem (active)
    sold_barcodes = Barcode.objects.filter(tag='sold')
    inconsistencies_1 = []
    for b in sold_barcodes:
        item = InvoiceItem.objects.filter(barcode=b).exclude(invoice__status='void').first()
        if not item:
            inconsistencies_1.append(b)
            
    print(f"\n1. Barcodes marked SOLD but not in any active InvoiceItem: {len(inconsistencies_1)}")
    for b in inconsistencies_1:
        meta = f"Barcode: {b.barcode}, Product: {b.product.name if b.product else 'N/A'}"
        print(f"   - {meta}")
        logger.log('AUDIT_INCONSISTENCY', 'Barcode', b.id, 'NONE', 'tag', 'sold', 'STUCK', 'Sold but no InvoiceItem found', meta)

    # 2. Barcodes linked to InvoiceItems that were NOT in the CartItem's scanned_barcodes
    # This identifies auto-assigned barcodes during checkout.
    print("\n2. Identifying auto-assigned barcodes (not physically scanned):")
    mismatches = 0
    invoices_with_auto_assign = set()
    
    invoices = Invoice.objects.exclude(status='void').prefetch_related('items', 'cart__items')
    
    for inv in invoices:
        cart = inv.cart
        if not cart: continue
        
        # Map product -> scanned barcodes in cart
        cart_scanned = {}
        for ci in cart.items.all():
            key = (ci.product_id, ci.variant_id)
            if key not in cart_scanned:
                cart_scanned[key] = set()
            if ci.scanned_barcodes:
                cart_scanned[key].update(ci.scanned_barcodes)
        
        # Check InvoiceItems
        for ii in inv.items.filter(product__track_inventory=True):
            if ii.barcode:
                key = (ii.product_id, ii.variant_id)
                scanned_for_prod = cart_scanned.get(key, set())
                if ii.barcode.barcode not in scanned_for_prod:
                    mismatches += 1
                    invoices_with_auto_assign.add(inv.invoice_number)
                    meta = f"Product: {ii.product.name}, Barcode: {ii.barcode.barcode}, CartScanned: {list(scanned_for_prod)}"
                    print(f"   - Invoice {inv.invoice_number}: {meta}")
                    logger.log('AUDIT_AUTO_ASSIGN', 'InvoiceItem', ii.id, inv.invoice_number, 'barcode', 'SCANNED_MISMATCH', ii.barcode.barcode, 'Auto-assigned barcode (not scanned)', meta)

    print(f"\nTotal Auto-assigned barcodes found: {mismatches}")
    print(f"Total Invoices affected: {len(invoices_with_auto_assign)}")

    # 3. Barcodes that were scanned but NOT in the final invoice
    print("\n3. Scanned barcodes that are NOT in the final invoice:")
    lost_scans = 0
    completed_carts = Cart.objects.filter(status='completed').prefetch_related('items')
    for cart in completed_carts:
        inv = Invoice.objects.filter(cart=cart).exclude(status='void').first()
        if not inv: continue
        
        inv_barcodes = set(inv.items.values_list('barcode__barcode', flat=True))
        
        for ci in cart.items.all():
            if ci.scanned_barcodes:
                for b_val in ci.scanned_barcodes:
                    if b_val not in inv_barcodes:
                        lost_scans += 1
                        meta = f"Cart: {cart.cart_number}, Barcode: {b_val}, Invoice: {inv.invoice_number}"
                        print(f"   - {meta}")
                        logger.log('AUDIT_LOST_SCAN', 'CartItem', 'NONE', cart.cart_number, 'barcode', b_val, 'MISSING_IN_INV', 'Scanned barcode lost during checkout', meta)

    print(f"\nTotal Scanned barcodes 'lost' during checkout: {lost_scans}")

if __name__ == "__main__":
    audit_barcodes()
