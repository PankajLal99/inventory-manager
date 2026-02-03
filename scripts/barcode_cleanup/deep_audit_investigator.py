import os
import django
import sys
from datetime import timedelta
from django.utils import timezone

# Set up Django environment
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../../"))
sys.path.append(PROJECT_ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from backend.core.models import AuditLog
from backend.catalog.models import Barcode, Product
from backend.pos.models import Invoice, InvoiceItem, Cart, CartItem
from csv_logger import logger

def investigator():
    print("--- Deep Audit Investigation ---")
    
    # 1. Hunt for "Zombie" In-Cart Barcodes
    # Barcodes marked 'in-cart' but not currently in any session's active CartItem
    print("\n1. Hunting for 'Zombie' In-Cart Barcodes...")
    in_cart_barcodes = Barcode.objects.filter(tag='in-cart')
    zombies = []
    for b in in_cart_barcodes:
        # Check if any active cart item (not completed/void) contains this barcode
        active_in_cart = CartItem.objects.filter(
            scanned_barcodes__contains=[b.barcode],
            cart__status='active'
        ).exists()
        
        if not active_in_cart:
            zombies.append(b)
            logger.log('ANOMALY_ZOMBIE', 'Barcode', b.id, 'NONE', 'tag', 'in-cart', 'STUCK', 'In-cart with no active session', f"Barcode: {b.barcode}, Product: {b.product.name if b.product else 'N/A'}")
            
    print(f"   - Found {len(zombies)} barcodes stuck in 'in-cart' state with no active session.")
    for b in zombies:
        print(f"     - {b.barcode} (Product {b.product.name if b.product else 'N/A'})")

    # 2. Duplicate Sale Detection
    # Look for barcodes that appear in multiple 'invoice_create' or 'cart_checkout' logs
    print("\n2. Scanning for Double-Sale Anomalies...")
    sale_logs = AuditLog.objects.filter(action__in=['invoice_create', 'cart_checkout', 'replacement_replace']).exclude(barcode__isnull=True)
    barcode_history = {}
    anomalies = []
    
    for log in sale_logs:
        # Some logs might have multiple barcodes separated by comma
        barcodes = [b.strip() for b in log.barcode.split(',') if b.strip()]
        for b_val in barcodes:
            if b_val not in barcode_history:
                barcode_history[b_val] = []
            barcode_history[b_val].append(log)
            
    for b_val, logs in barcode_history.items():
        if len(logs) > 1:
            # Check if there's a return log in between
            return_logs = AuditLog.objects.filter(barcode__icontains=b_val, action__in=['replacement_return', 'return', 'refund'])
            if return_logs.count() < (len(logs) - 1):
                anomalies.append((b_val, logs))

    print(f"   - Found {len(anomalies)} potential Double-Sale anomalies (multiple sales without recorded returns).")
    for b_val, logs in anomalies:
        inv_nums = []
        for log_entry in logs:
            # Extract invoice number from changes if available, otherwise use action
            changes = log_entry.changes or {}
            ref = changes.get('invoice_number', log_entry.action)
            inv_nums.append(ref)
            logger.log('ANOMALY_DOUBLE_SALE', 'Barcode', b_val, ref, 'tag', 'sold', 'DUPLICATE', 'Sold multiple times without return', f"Log Action: {log_entry.action}, Log ID: {log_entry.id}")
        print(f"     - Barcode {b_val}: Sold {len(logs)} times (Refs: {inv_nums})")

    # 3. State-Audit Mismatch
    # Last log action should ideally determine the current tag
    print("\n3. Checking State vs. Last Action Match...")
    mismatches = 0
    # Sampling 100 recent barcodes for speed, or you can run on all
    for b in Barcode.objects.all().order_by('-id'):
        last_log = AuditLog.objects.filter(barcode__icontains=b.barcode).order_by('-created_at').first()
        if last_log:
            # Simple heuristic mapping
            expected_tag = None
            if last_log.action in ['invoice_create', 'cart_checkout', 'replacement_replace']: expected_tag = 'sold'
            elif last_log.action == 'cart_add': expected_tag = 'in-cart'
            elif last_log.action in ['return', 'replacement_return']: expected_tag = 'returned'
            
            if expected_tag and b.tag != expected_tag:
                # Only flag if the last log is significantly newer than the barcode modified time (approx)
                # This catches if someone manually changed a tag in Admin without it being logged correctly
                mismatches += 1
                logger.log('ANOMALY_STATE_MISMATCH', 'Barcode', b.id, 'NONE', 'tag', b.tag, expected_tag, f"State mismatch: Tag is {b.tag} but last action was {last_log.action}", f"Last Log ID: {last_log.id}")
                print(f"     - Mismatch: {b.barcode}. Last action was '{last_log.action}', but tag is '{b.tag}'.")

    print(f"   - Total state-audit mismatches found in sample: {mismatches}")

    # 4. Explicit Substitution Hunter (System Mistake Detection)
    # Detects where the system used a fallback (like .first()) to sell a different barcode than scanned
    print("\n4. Hunting for Substitution Mistakes (Scanned vs. Sold)...")
    sub_mistakes = 0
    from backend.pos.models import InvoiceItem
    
    # We look at completed invoices with tracked products
    recent_invoices = Invoice.objects.exclude(status='void').prefetch_related('items__barcode', 'cart__items').order_by('-id')
    
    for inv in recent_invoices:
        cart = inv.cart
        if not cart: continue
        
        # Build map of scanned barcodes per product for this cart
        scanned_map = {}
        for ci in cart.items.all():
            if ci.scanned_barcodes:
                scanned_map[ci.product_id] = set(ci.scanned_barcodes)
        
        for item in inv.items.filter(product__track_inventory=True).select_related('barcode'):
            if item.barcode:
                scanned_set = scanned_map.get(item.product_id, set())
                if scanned_set and item.barcode.barcode not in scanned_set:
                    sub_mistakes += 1
                    actual_scanned = list(scanned_set)
                    print(f"     [!] MISTAKE in Invoice {inv.invoice_number}:")
                    print(f"         - System SOLD: {item.barcode.barcode}")
                    print(f"         - You SCANNED: {actual_scanned}")
                    print(f"         - Result: System 'stole' Barcode {item.barcode.barcode} from stock.")

    print(f"   - Total substitution mistakes identified: {sub_mistakes}")

if __name__ == "__main__":
    investigator()
