"""
Management command to check invoice data sanity and fix inconsistencies.
"""
from django.core.management.base import BaseCommand
from django.db.models import Q, F
from decimal import Decimal
from backend.pos.models import InvoiceItem, Invoice
from backend.catalog.models import Barcode


class Command(BaseCommand):
    help = 'Check invoice data for inconsistencies and report/fix issues'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix',
            action='store_true',
            help='Automatically fix issues where possible',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Show detailed information',
        )

    def handle(self, *args, **options):
        fix = options['fix']
        verbose = options['verbose']
        
        self.stdout.write(self.style.SUCCESS('Checking invoice data sanity...\n'))
        
        issues_found = 0
        issues_fixed = 0
        
        # Check 1: Invoice items where replaced_quantity > quantity
        self.stdout.write('1. Checking for invoice items with replaced_quantity > quantity...')
        invalid_items = InvoiceItem.objects.filter(
            replaced_quantity__gt=F('quantity')
        )
        
        if invalid_items.exists():
            issues_found += invalid_items.count()
            self.stdout.write(
                self.style.WARNING(
                    f'   Found {invalid_items.count()} invoice items with replaced_quantity > quantity'
                )
            )
            
            if verbose:
                for item in invalid_items[:10]:  # Show first 10
                    self.stdout.write(
                        f'   - InvoiceItem {item.id}: quantity={item.quantity}, '
                        f'replaced_quantity={item.replaced_quantity}, '
                        f'invoice={item.invoice.invoice_number}'
                    )
            
            if fix:
                # Fix by capping replaced_quantity to quantity
                fixed_count = 0
                for item in invalid_items:
                    old_replaced = item.replaced_quantity
                    item.replaced_quantity = item.quantity
                    item.save()
                    fixed_count += 1
                    if verbose:
                        self.stdout.write(
                            f'   Fixed InvoiceItem {item.id}: '
                            f'replaced_quantity set from {old_replaced} to {item.quantity}'
                        )
                issues_fixed += fixed_count
                self.stdout.write(
                    self.style.SUCCESS(f'   Fixed {fixed_count} invoice items')
                )
        else:
            self.stdout.write(self.style.SUCCESS('   ✓ No issues found'))
        
        # Check 2: Barcodes with return tags but no invoice items
        self.stdout.write('\n2. Checking for barcodes with return tags but no invoice items...')
        return_tags = ['returned', 'defective', 'unknown']
        orphaned_barcodes = Barcode.objects.filter(
            tag__in=return_tags
        ).exclude(
            id__in=InvoiceItem.objects.values_list('barcode_id', flat=True).distinct()
        )
        
        if orphaned_barcodes.exists():
            issues_found += orphaned_barcodes.count()
            self.stdout.write(
                self.style.WARNING(
                    f'   Found {orphaned_barcodes.count()} barcodes with return tags but no invoice items'
                )
            )
            
            if verbose:
                for barcode in orphaned_barcodes[:10]:  # Show first 10
                    self.stdout.write(
                        f'   - Barcode {barcode.id} ({barcode.barcode}): '
                        f'tag={barcode.tag}, product={barcode.product.name if barcode.product else "None"}'
                    )
            
            if fix:
                # Reset tag to 'new' for orphaned barcodes
                fixed_count = 0
                for barcode in orphaned_barcodes:
                    old_tag = barcode.tag
                    barcode.tag = 'new'
                    barcode.save()
                    fixed_count += 1
                    if verbose:
                        self.stdout.write(
                            f'   Fixed Barcode {barcode.id}: '
                            f'tag changed from {old_tag} to new'
                        )
                issues_fixed += fixed_count
                self.stdout.write(
                    self.style.SUCCESS(f'   Fixed {fixed_count} barcodes')
                )
        else:
            self.stdout.write(self.style.SUCCESS('   ✓ No issues found'))
        
        # Check 3: Invoice items with replaced_quantity but barcode not marked as returned/defective
        self.stdout.write('\n3. Checking for invoice items with replaced_quantity but barcode not marked as returned...')
        items_with_replaced = InvoiceItem.objects.filter(
            replaced_quantity__gt=Decimal('0.000'),
            barcode__isnull=False
        ).exclude(
            barcode__tag__in=['returned', 'defective', 'unknown']
        )
        
        if items_with_replaced.exists():
            issues_found += items_with_replaced.count()
            self.stdout.write(
                self.style.WARNING(
                    f'   Found {items_with_replaced.count()} invoice items with replaced_quantity '
                    f'but barcode not marked as returned/defective/unknown'
                )
            )
            
            if verbose:
                for item in items_with_replaced[:10]:  # Show first 10
                    self.stdout.write(
                        f'   - InvoiceItem {item.id}: replaced_quantity={item.replaced_quantity}, '
                        f'barcode_tag={item.barcode.tag if item.barcode else "None"}, '
                        f'invoice={item.invoice.invoice_number}'
                    )
            
            # Note: We don't auto-fix this as it might be intentional (partial replacement)
            self.stdout.write(
                self.style.WARNING('   Note: This may be intentional for partial replacements')
            )
        else:
            self.stdout.write(self.style.SUCCESS('   ✓ No issues found'))
        
        # Check 4: Barcodes with 'sold' tag but no invoice items
        self.stdout.write('\n4. Checking for barcodes with "sold" tag but no invoice items...')
        sold_without_invoice = Barcode.objects.filter(
            tag='sold'
        ).exclude(
            id__in=InvoiceItem.objects.values_list('barcode_id', flat=True).distinct()
        )
        
        if sold_without_invoice.exists():
            issues_found += sold_without_invoice.count()
            self.stdout.write(
                self.style.WARNING(
                    f'   Found {sold_without_invoice.count()} barcodes with "sold" tag but no invoice items'
                )
            )
            
            if verbose:
                for barcode in sold_without_invoice[:10]:  # Show first 10
                    self.stdout.write(
                        f'   - Barcode {barcode.id} ({barcode.barcode}): '
                        f'product={barcode.product.name if barcode.product else "None"}'
                    )
            
            if fix:
                # Reset tag to 'new' for sold barcodes without invoices
                fixed_count = 0
                for barcode in sold_without_invoice:
                    barcode.tag = 'new'
                    barcode.save()
                    fixed_count += 1
                    if verbose:
                        self.stdout.write(
                            f'   Fixed Barcode {barcode.id}: tag changed from sold to new'
                        )
                issues_fixed += fixed_count
                self.stdout.write(
                    self.style.SUCCESS(f'   Fixed {fixed_count} barcodes')
                )
        else:
            self.stdout.write(self.style.SUCCESS('   ✓ No issues found'))
        
        # Summary
        self.stdout.write('\n' + '='*60)
        self.stdout.write(self.style.SUCCESS(f'Summary:'))
        self.stdout.write(f'  Issues found: {issues_found}')
        if fix:
            self.stdout.write(f'  Issues fixed: {issues_fixed}')
            self.stdout.write(f'  Issues remaining: {issues_found - issues_fixed}')
        else:
            self.stdout.write(
                self.style.WARNING(
                    '  Run with --fix to automatically fix issues where possible'
                )
            )
        
        if issues_found == 0:
            self.stdout.write(self.style.SUCCESS('\n✓ All checks passed! No issues found.'))

