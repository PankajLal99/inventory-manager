import os
import django
import sys
from decimal import Decimal

# Set up Django environment
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../../"))
sys.path.append(PROJECT_ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.db import transaction
from backend.catalog.models import Barcode
from backend.pos.models import Invoice, InvoiceItem, Cart

def repair_barcodes(dry_run=True):
    print(f"--- Barcode Repair Process (Dry Run: {dry_run}) ---")
    
    # 1. Fix barcodes marked SOLD but not in any active InvoiceItem
    sold_barcodes_no_item = []
    sold_barcodes = Barcode.objects.filter(tag='sold')
    for b in sold_barcodes:
        item = InvoiceItem.objects.filter(barcode=b).exclude(invoice__status='void').first()
        if not item:
            sold_barcodes_no_item.append(b)
            
    print(f"\n1. Found {len(sold_barcodes_no_item)} barcodes marked SOLD without active InvoiceItem.")
    for b in sold_barcodes_no_item:
        print(f"   - Reverting {b.barcode} (Product: {b.product.name if b.product else 'N/A'}) to 'new'")
        if not dry_run:
            b.tag = 'new'
            b.save(update_fields=['tag'])

    # 2. Fix Auto-assigned mismatches
    print("\n2. Identifying and repairing auto-assigned barcodes:")
    repaired_swaps = 0
    repaired_removals = 0
    
    invoices = Invoice.objects.exclude(status='void').prefetch_related('items', 'cart__items')
    
    for inv in invoices:
        cart = inv.cart
        if not cart: continue
        
        # Get scanned barcodes from cart
        scanned_list = []
        for ci in cart.items.all():
            if ci.scanned_barcodes:
                scanned_list.extend(ci.scanned_barcodes)
        scanned_set = set(scanned_list)
        
        # Get assigned barcodes in invoice
        assigned_items = list(inv.items.filter(product__track_inventory=True).select_related('barcode'))
        
        # Find auto-assigned items (those whose barcode wasn't in the scanned list)
        auto_assigned_items = [ii for ii in assigned_items if ii.barcode and ii.barcode.barcode not in scanned_set]
        
        # Find "lost" scans (those that were scanned but not assigned to any item in this invoice)
        assigned_barcode_values = {ii.barcode.barcode for ii in assigned_items if ii.barcode}
        lost_scans = [b_val for b_val in scanned_list if b_val not in assigned_barcode_values]
        
        # Attempt to repair each auto-assigned item
        for item in auto_assigned_items:
            old_barcode = item.barcode
            
            # Case A: Try to find a matching "lost scan" product to swap
            match_scan = None
            for ls in lost_scans:
                try:
                    ls_obj = Barcode.objects.get(barcode=ls)
                    if ls_obj.product_id == item.product_id:
                        match_scan = ls
                        break
                except Barcode.DoesNotExist:
                    continue
            
            if match_scan:
                print(f"   - Invoice {inv.invoice_number}: SWAPPING auto-assigned {old_barcode.barcode} with scanned {match_scan}")
                if not dry_run:
                    with transaction.atomic():
                        old_barcode.tag = 'new'
                        old_barcode.save(update_fields=['tag'])
                        
                        new_barcode_obj = Barcode.objects.get(barcode=match_scan)
                        new_barcode_obj.tag = 'sold'
                        new_barcode_obj.save(update_fields=['tag'])
                        
                        item.barcode = new_barcode_obj
                        item.save(update_fields=['barcode'])
                
                lost_scans.remove(match_scan)
                repaired_swaps += 1
            else:
                # Case B: No matching scan found. Revert barcode and unlink from invoice.
                print(f"   - Invoice {inv.invoice_number}: REVERTING auto-assigned {old_barcode.barcode} and unlinking (no scan found)")
                if not dry_run:
                    with transaction.atomic():
                        old_barcode.tag = 'new'
                        old_barcode.save(update_fields=['tag'])
                        
                        item.barcode = None
                        item.save(update_fields=['barcode'])
                repaired_removals += 1

    print(f"\nTotal swaps performed: {repaired_swaps}")
    print(f"Total unlinks performed: {repaired_removals}")

    if dry_run:
        print("\nNOTE: This was a DRY RUN. No changes were made to the database.")
    else:
        print("\nSUCCESS: Database repair completed.")

if __name__ == "__main__":
    is_dry_run = "--real" not in sys.argv
    repair_barcodes(dry_run=is_dry_run)
