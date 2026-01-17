"""
Management command to clear Products, Invoices, Barcodes, and Audit Logs from database
Usage: python manage.py clear_data
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from backend.catalog.models import Product, ProductVariant, ProductComponent, Barcode, BarcodeLabel
from backend.pos.models import Invoice, InvoiceItem, Payment, Cart, CartItem, Return, ReturnItem, CreditNote, Exchange
from backend.inventory.models import Stock, StockAdjustment, StockTransfer, StockTransferItem, StockBatch
from backend.core.models import AuditLog
from backend.purchasing.models import Purchase, PurchaseItem
from backend.parties.models import LedgerEntry


class Command(BaseCommand):
    help = 'Clear Products, Invoices, Barcodes, and Audit Logs from database'

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Skip confirmation prompt',
        )

    def handle(self, *args, **options):
        if not options['confirm']:
            self.stdout.write(self.style.WARNING(
                '⚠️  WARNING: This will delete ALL:'
            ))
            self.stdout.write('  - Products (and related: variants, components, barcodes, labels)')
            self.stdout.write('  - Invoices (and related: invoice items, payments, carts)')
            self.stdout.write('  - Purchases (and related: purchase items)')
            self.stdout.write('  - Barcodes (and related: barcode labels)')
            self.stdout.write('  - Audit Logs (history)')
            self.stdout.write('  - Stock entries (and related: adjustments, transfers, batches)')
            self.stdout.write('')
            
            confirm = input('Type "YES" to confirm: ')
            if confirm != 'YES':
                self.stdout.write(self.style.ERROR('Operation cancelled.'))
                return

        self.stdout.write('Starting data cleanup...')
        
        try:
            with transaction.atomic():
                # Count before deletion
                product_count = Product.objects.count()
                invoice_count = Invoice.objects.count()
                barcode_count = Barcode.objects.count()
                audit_log_count = AuditLog.objects.count()
                stock_count = Stock.objects.count()
                purchase_count = Purchase.objects.count()
                
                self.stdout.write(f'\nFound:')
                self.stdout.write(f'  - Products: {product_count}')
                self.stdout.write(f'  - Invoices: {invoice_count}')
                self.stdout.write(f'  - Purchases: {purchase_count}')
                self.stdout.write(f'  - Barcodes: {barcode_count}')
                self.stdout.write(f'  - Audit Logs: {audit_log_count}')
                self.stdout.write(f'  - Stock Entries: {stock_count}')
                self.stdout.write('')
                
                # Delete in correct order to avoid foreign key constraint issues
                # Order matters: delete child records before parent records
                
                # 1. Delete most dependent items first (items that reference multiple parents)
                self.stdout.write('Deleting Credit Notes...')
                CreditNote.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Credit Notes deleted'))
                
                self.stdout.write('Deleting Return Items...')
                ReturnItem.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Return Items deleted'))
                
                self.stdout.write('Deleting Exchanges...')
                Exchange.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Exchanges deleted'))
                
                self.stdout.write('Deleting Returns...')
                Return.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Returns deleted'))
                
                self.stdout.write('Deleting Ledger Entries...')
                LedgerEntry.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Ledger Entries deleted'))
                
                self.stdout.write('Deleting Invoice Items...')
                InvoiceItem.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Invoice Items deleted'))
                
                self.stdout.write('Deleting Payments...')
                Payment.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Payments deleted'))
                
                self.stdout.write('Deleting Invoices...')
                Invoice.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Invoices deleted'))
                
                # 2. Delete Purchase-related items (barcodes reference purchases)
                self.stdout.write('Deleting Purchase Items...')
                PurchaseItem.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Purchase Items deleted'))
                
                self.stdout.write('Deleting Purchases...')
                Purchase.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Purchases deleted'))
                
                # 3. Delete Cart-related items
                self.stdout.write('Deleting Cart Items...')
                CartItem.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Cart Items deleted'))
                
                self.stdout.write('Deleting Carts...')
                Cart.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Carts deleted'))
                
                # 2. Delete Stock-related items
                self.stdout.write('Deleting Stock Transfer Items...')
                StockTransferItem.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Stock Transfer Items deleted'))
                
                self.stdout.write('Deleting Stock Transfers...')
                StockTransfer.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Stock Transfers deleted'))
                
                self.stdout.write('Deleting Stock Adjustments...')
                StockAdjustment.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Stock Adjustments deleted'))
                
                self.stdout.write('Deleting Stock Batches...')
                StockBatch.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Stock Batches deleted'))
                
                self.stdout.write('Deleting Stock Entries...')
                Stock.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Stock Entries deleted'))
                
                # 3. Delete Barcode Labels (references Barcode)
                self.stdout.write('Deleting Barcode Labels...')
                BarcodeLabel.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Barcode Labels deleted'))
                
                # 4. Delete Barcodes (references Product)
                self.stdout.write('Deleting Barcodes...')
                Barcode.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Barcodes deleted'))
                
                # 5. Delete Product Components (references Product)
                self.stdout.write('Deleting Product Components...')
                ProductComponent.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Product Components deleted'))
                
                # 6. Delete Product Variants (references Product)
                self.stdout.write('Deleting Product Variants...')
                ProductVariant.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Product Variants deleted'))
                
                # 7. Delete Products
                self.stdout.write('Deleting Products...')
                Product.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Products deleted'))
                
                # 8. Delete Audit Logs (standalone, no dependencies)
                self.stdout.write('Deleting Audit Logs...')
                AuditLog.objects.all().delete()
                self.stdout.write(self.style.SUCCESS('  ✓ Audit Logs deleted'))
                
                self.stdout.write('')
                self.stdout.write(self.style.SUCCESS('✅ Data cleanup completed successfully!'))
                self.stdout.write('')
                self.stdout.write('Deleted:')
                self.stdout.write(f'  - {product_count} Products')
                self.stdout.write(f'  - {invoice_count} Invoices')
                self.stdout.write(f'  - {purchase_count} Purchases')
                self.stdout.write(f'  - {barcode_count} Barcodes')
                self.stdout.write(f'  - {audit_log_count} Audit Logs')
                self.stdout.write(f'  - {stock_count} Stock Entries')
                
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'\n❌ Error during cleanup: {str(e)}'))
            import traceback
            self.stdout.write(self.style.ERROR(traceback.format_exc()))
            raise

