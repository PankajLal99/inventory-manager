import os
import django
import sys
from decimal import Decimal

# Set up Django
sys.path.append('/Users/pankajlal/Desktop/Projects/inventory-manager')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.db import transaction
from backend.catalog.models import Barcode, Product
from backend.pos.models import Invoice, InvoiceItem, Cart, CartItem

def status_healer(dry_run=True):
    print(f"--- Enhanced Barcode Status Healer (Dry Run: {dry_run}) ---")
    
    invoices = Invoice.objects.exclude(status='void').prefetch_related('items__barcode', 'cart__items').order_by('-id')
    
    # Summary Statistics
    stats = {
        'total_analyzed': 0,
        'mismatches': 0,
        'empty_invoices': 0,
        'structural_fixes': 0,
        'tag_fixes': 0
    }
    
    for inv in invoices:
        stats['total_analyzed'] += 1
        cart = inv.cart
        if not cart:
            continue
            
        # Get what SHOULD be on the invoice according to the cart beeps
        cart_data = []
        for ci in cart.items.all():
            cart_data.append({
                'product_id': ci.product_id,
                'quantity': int(ci.quantity),
                'scanned': ci.scanned_barcodes or [],
                'price': ci.unit_price
            })
            
        # Get what IS on the invoice
        inv_items = inv.items.all()
        
        # Check for structural mismatches (Missing items or wrong products)
        needs_structural_fix = False
        cart_prod_counts = {}
        for d in cart_data:
            cart_prod_counts[d['product_id']] = cart_prod_counts.get(d['product_id'], 0) + d['quantity']

        if not inv_items.exists() and cart_prod_counts:
            print(f"\n[!] ALERT: Invoice {inv.invoice_number} is effectively EMPTY despite a completed cart.")
            print(f"    - Description: The system session finished, but no items were saved to the invoice.")
            stats['empty_invoices'] += 1
            needs_structural_fix = True
        elif cart_prod_counts:
            inv_prod_counts = {}
            for ii in inv_items:
                inv_prod_counts[ii.product_id] = inv_prod_counts.get(ii.product_id, 0) + int(ii.quantity)
                
            if cart_prod_counts != inv_prod_counts:
                print(f"\n[!] ALERT: Invoice {inv.invoice_number} has a PRODUCT MISMATCH.")
                print(f"    - Description: The physical products scanned do not match the digital entries on this invoice.")
                stats['mismatches'] += 1
                needs_structural_fix = True

        if needs_structural_fix:
            print(f"--- DIAGNOSTIC for {inv.invoice_number} ---")
            print(f"    [PHYSICAL REALITY]: Scanned beeps for Product IDs: {cart_prod_counts}")
            print(f"    [DIGITAL RECORD] : Invoice currently shows IDs: {inv_prod_counts if inv_items.exists() else 'EMPTY'}")
            
            if dry_run:
                print(f"    [PROPOSAL]: Reconstruct digital records to perfectly match beeps.")
            else:
                print(f"    [HEALING]: Reconstructing invoice items...")
                stats['structural_fixes'] += 1
                with transaction.atomic():
                    inv.items.all().delete()
                    for d in cart_data:
                        product = Product.objects.get(id=d['product_id'])
                        if product.track_inventory:
                            for b_val in d['scanned']:
                                try:
                                    b_obj = Barcode.objects.get(barcode=b_val)
                                    b_obj.tag = 'sold'
                                    b_obj.save(update_fields=['tag'])
                                    InvoiceItem.objects.create(invoice=inv, product=product, barcode=b_obj, quantity=1, price=d['price'], subtotal=d['price'])
                                except Barcode.DoesNotExist:
                                    InvoiceItem.objects.create(invoice=inv, product=product, quantity=1, price=d['price'], subtotal=d['price'])
                        else:
                            InvoiceItem.objects.create(invoice=inv, product=product, quantity=d['quantity'], price=d['price'], subtotal=d['price'] * d['quantity'])
            continue

        # Tag status check for items that exist but have the wrong status
        for ii in inv_items:
            if ii.barcode and ii.barcode.tag != 'sold':
                print(f"\n[!] STATUS ERROR: Barcode {ii.barcode.barcode} on Invoice {inv.invoice_number} is marked '{ii.barcode.tag}'.")
                print(f"    - Description: This item was sold, but its tag escaped the 'sold' status transition.")
                if dry_run:
                    print(f"    [PROPOSAL]: Force tag change to 'sold'.")
                else:
                    ii.barcode.tag = 'sold'
                    ii.barcode.save(update_fields=['tag'])
                    stats['tag_fixes'] += 1
                    print(f"    [HEALING]: Marked as 'sold'.")

    # Final Summary Report
    print("\n" + "="*60)
    print("   FINAL INTEGRITY SUMMARY REPORT")
    print("="*60)
    print(f"Total Transactions Analyzed: {stats['total_analyzed']}")
    print(f"Mismatches Identified     : {stats['mismatches'] + stats['empty_invoices']}")
    print(f"  - Empty Invoices Found  : {stats['empty_invoices']}")
    print(f"  - Product Discrepancies : {stats['mismatches']}")
    
    if not dry_run:
        print(f"\nHealed Structural Issues  : {stats['structural_fixes']}")
        print(f"Healed Tag Status Issues  : {stats['tag_fixes']}")
    
    print("-" * 60)
    if dry_run:
        print("STATUS: REPORT ONLY. No changes made. Run with '--apply' to fix.")
    else:
        print("STATUS: HEALING COMPLETE. Your inventory is now synchronized.")
    print("="*60)

if __name__ == "__main__":
    is_dry_run = "--apply" not in sys.argv
    status_healer(dry_run=is_dry_run)
