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
from backend.catalog.models import Barcode, Product
from backend.pos.models import Invoice, InvoiceItem, Cart, CartItem
from csv_logger import logger

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
    
    processed_carts = {} # cart_id -> first_invoice_number
    
    for inv in invoices:
        stats['total_analyzed'] += 1
        cart = inv.cart
        if not cart:
            continue
            
        # PROD SAFETY: Detect if this cart is already linked to another healed invoice
        if cart.id in processed_carts:
            print(f"\n[WARNING] DUPLICATE CART DETECTED: Invoice {inv.invoice_number} shares Cart {cart.id} with {processed_carts[cart.id]}.")
            print(f"    - Action: Skipping this invoice to prevent duplicate inventory deduction.")
            continue
        processed_carts[cart.id] = inv.invoice_number

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
                for item in inv_items:
                    data = f"Product: {item.product.name}, Barcode: {item.barcode.barcode if item.barcode else 'N/A'}"
                    logger.log('DELETE_PROPOSAL', 'InvoiceItem', item.id, 'ALL', data, 'NONE', f'Structural mismatch in {inv.invoice_number}')

                for d in cart_data:
                    product = Product.objects.get(id=d['product_id'])
                    meta = f"Product: {product.name}, SKU: {product.sku if hasattr(product, 'sku') else 'N/A'}"
                    if product.track_inventory:
                        if not d['scanned'] and d['quantity'] > 0:
                            print(f"      - Use Legacy Tracked Product (No beeps): {product.name} (Qty: {d['quantity']})")
                            logger.log('CREATE_PROPOSAL', 'InvoiceItem', 'NEW', inv.invoice_number, 'product', 'NONE', f"{product.name} (Legacy Qty: {d['quantity']})", f'Structural repair (legacy manual) for {inv.invoice_number}', meta)
                        else:
                            print(f"      - Use Barcodes: {d['scanned']}")
                            for b_val in d['scanned']:
                                logger.log('CREATE_PROPOSAL', 'InvoiceItem', 'NEW', inv.invoice_number, 'barcode', 'NONE', b_val, f'Structural repair for {inv.invoice_number}', meta)
                    else:
                        print(f"      - Use Non-tracked Product: {product.name} (Qty: {d['quantity']})")
                        logger.log('CREATE_PROPOSAL', 'InvoiceItem', 'NEW', inv.invoice_number, 'product', 'NONE', product.name, f'Structural repair (non-tracked) for {inv.invoice_number}', meta)
            else:
                print(f"    [HEALING]: Reconstructing invoice items...")
                stats['structural_fixes'] += 1
                with transaction.atomic():
                    for item in inv.items.all():
                        data = f"Product: {item.product.name}, Barcode: {item.barcode.barcode if item.barcode else 'N/A'}"
                        logger.log('DELETE', 'InvoiceItem', item.id, 'ALL', data, 'NONE', f'Structural mismatch in {inv.invoice_number}')
                        item.delete()

                    for d in cart_data:
                        product = Product.objects.get(id=d['product_id'])
                        meta = f"Product: {product.name}, SKU: {product.sku if hasattr(product, 'sku') else 'N/A'}"
                        if product.track_inventory:
                            if not d['scanned'] and d['quantity'] > 0:
                                # Legacy case: tracked but no barcodes (manual entry)
                                ii = InvoiceItem.objects.create(invoice=inv, product=product, quantity=d['quantity'], unit_price=d['price'], line_total=d['price'] * d['quantity'])
                                logger.log('CREATE', 'InvoiceItem', ii.id, inv.invoice_number, 'ALL', 'NONE', f"Product: {product.name} (Legacy Qty: {d['quantity']})", f'Structural repair (legacy manual) for {inv.invoice_number}', meta)
                            else:
                                for b_val in d['scanned']:
                                    try:
                                        b_obj = Barcode.objects.get(barcode=b_val)
                                        old_tag = b_obj.tag
                                        b_obj.tag = 'sold'
                                        b_obj.save(update_fields=['tag'])
                                        logger.log('UPDATE', 'Barcode', b_obj.id, inv.invoice_number, 'tag', old_tag, 'sold', f'Repair for {inv.invoice_number}', meta)

                                        ii = InvoiceItem.objects.create(invoice=inv, product=product, barcode=b_obj, quantity=1, unit_price=d['price'], line_total=d['price'])
                                        logger.log('CREATE', 'InvoiceItem', ii.id, inv.invoice_number, 'ALL', 'NONE', f'Barcode: {b_val}', f'Structural repair for {inv.invoice_number}', meta)
                                    except Barcode.DoesNotExist:
                                        ii = InvoiceItem.objects.create(invoice=inv, product=product, quantity=1, unit_price=d['price'], line_total=d['price'])
                                        logger.log('CREATE', 'InvoiceItem', ii.id, inv.invoice_number, 'ALL', 'NONE', 'Product only', f'Structural repair (missing barcode) for {inv.invoice_number}', meta)
                        else:
                            ii = InvoiceItem.objects.create(invoice=inv, product=product, quantity=d['quantity'], unit_price=d['price'], line_total=d['price'] * d['quantity'])
                            logger.log('CREATE', 'InvoiceItem', ii.id, inv.invoice_number, 'ALL', 'NONE', f'Product: {product.name}', f'Structural repair (non-tracked) for {inv.invoice_number}', meta)
            continue

        # Tag status check for items that exist but have the wrong status
        for ii in inv_items:
            if ii.barcode and ii.barcode.tag != 'sold':
                print(f"\n[!] STATUS ERROR: Barcode {ii.barcode.barcode} on Invoice {inv.invoice_number} is marked '{ii.barcode.tag}'.")
                print(f"    - Description: This item was sold, but its tag escaped the 'sold' status transition.")
                if dry_run:
                    print(f"    [PROPOSAL]: Force tag change to 'sold'.")
                    logger.log('UPDATE_PROPOSAL', 'Barcode', ii.barcode.id, inv.invoice_number, 'tag', ii.barcode.tag, 'sold', f'Status mismatch on {inv.invoice_number}', f"Barcode: {ii.barcode.barcode}")
                else:
                    old_tag = ii.barcode.tag
                    ii.barcode.tag = 'sold'
                    ii.barcode.save(update_fields=['tag'])
                    logger.log('UPDATE', 'Barcode', ii.barcode.id, inv.invoice_number, 'tag', old_tag, 'sold', f'Status mismatch on {inv.invoice_number}', f"Barcode: {ii.barcode.barcode}")
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
