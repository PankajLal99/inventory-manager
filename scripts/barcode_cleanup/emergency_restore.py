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

def restore_targeted_invoice(invoice_number):
    print(f"--- Emergency Restoration for {invoice_number} ---")
    
    try:
        inv = Invoice.objects.get(invoice_number=invoice_number)
    except Invoice.DoesNotExist:
        print(f"Error: Invoice {invoice_number} not found.")
        return

    cart = inv.cart
    if not cart:
        print(f"Error: Cart for {invoice_number} not found.")
        return

    with transaction.atomic():
        # Clean current state
        deleted_count = inv.items.all().count()
        inv.items.all().delete()
        print(f"Cleared {deleted_count} current items from {invoice_number}.")

        # Reconstruct from CartItems
        restore_count = 0
        for ci in cart.items.all():
            product = ci.product
            scanned = ci.scanned_barcodes or []
            qty = int(ci.quantity)
            
            if product.track_inventory and scanned:
                for b_val in scanned:
                    try:
                        b_obj = Barcode.objects.get(barcode=b_val)
                        b_obj.tag = 'sold'
                        b_obj.save(update_fields=['tag'])
                        InvoiceItem.objects.create(
                            invoice=inv, product=product, barcode=b_obj, 
                            quantity=1, unit_price=ci.unit_price, line_total=ci.unit_price
                        )
                        restore_count += 1
                    except Barcode.DoesNotExist:
                        InvoiceItem.objects.create(
                            invoice=inv, product=product, 
                            quantity=1, unit_price=ci.unit_price, line_total=ci.unit_price
                        )
                        restore_count += 1
            else:
                # Handle legacy tracked items without barcodes OR non-tracked items
                InvoiceItem.objects.create(
                    invoice=inv, product=product, 
                    quantity=ci.quantity, unit_price=ci.unit_price, 
                    line_total=ci.unit_price * ci.quantity
                )
                restore_count += 1
        
        print(f"Successfully restored {restore_count} items to {invoice_number}.")

if __name__ == "__main__":
    restore_targeted_invoice("INV-20260202-1457B5C3")
