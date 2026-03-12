"""
Management command to validate that barcodes in active/held carts are not already
on a paid or credit invoice. If a barcode is sold (on paid/credit invoice), it must
not appear in any cart's scanned_barcodes (stale cart data).

Example: GLA-0200 in an edit cart but already sold on an invoice — this command
finds such cases and optionally removes those barcodes from the stale cart.
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db.models import Q

from backend.pos.models import CartItem, InvoiceItem
from backend.catalog.models import Barcode


class Command(BaseCommand):
    help = (
        'Validate that barcodes shown in Active Carts are not already on a paid/credit invoice. '
        'Reports and optionally fixes stale cart items.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix',
            action='store_true',
            help='Remove sold barcodes from cart items (and delete item if quantity becomes 0)',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Show each cart/item/barcode and the invoice that sold it',
        )

    def handle(self, *args, **options):
        fix = options['fix']
        verbose = options['verbose']

        self.stdout.write(
            self.style.SUCCESS('Checking: barcodes in active/held carts must not be on paid/credit invoices...\n')
        )

        # Barcode IDs that are on a paid or credit invoice (sold)
        sold_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__status__in=['paid', 'credit']
            ).exclude(barcode_id__isnull=True).values_list('barcode_id', flat=True).distinct()
        )
        if not sold_barcode_ids:
            self.stdout.write(self.style.SUCCESS('No barcodes on paid/credit invoices. Nothing to validate.'))
            return

        # Build barcode_id -> (barcode_str, invoice_number) for reporting
        sold_barcodes = {}
        for inv_item in InvoiceItem.objects.filter(
            invoice__status__in=['paid', 'credit'],
            barcode_id__isnull=False
        ).select_related('invoice', 'barcode'):
            if inv_item.barcode_id and inv_item.barcode_id not in sold_barcodes:
                sold_barcodes[inv_item.barcode_id] = (
                    inv_item.barcode.barcode,
                    inv_item.invoice.invoice_number,
                    inv_item.invoice.status,
                )

        # Active/held carts and their items with scanned_barcodes
        cart_items = CartItem.objects.filter(
            cart__status__in=['active', 'held']
        ).exclude(
            scanned_barcodes__isnull=True
        ).exclude(
            scanned_barcodes=[]
        ).select_related('cart', 'product')

        issues = []  # (cart_item, barcode_id, barcode_str, invoice_number, invoice_status)
        for ci in cart_items:
            if not ci.scanned_barcodes:
                continue
            for barcode_str in ci.scanned_barcodes:
                if not barcode_str:
                    continue
                b_upper = str(barcode_str).strip().upper()
                try:
                    barcode_obj = Barcode.objects.filter(
                        Q(barcode=b_upper) | Q(short_code=b_upper)
                    ).first()
                except Exception:
                    continue
                if barcode_obj and barcode_obj.id in sold_barcode_ids:
                    info = sold_barcodes.get(barcode_obj.id, (barcode_obj.barcode, '?', '?'))
                    issues.append((ci, barcode_obj.id, info[0], info[1], info[2]))

        if not issues:
            self.stdout.write(self.style.SUCCESS('OK: No active/held cart contains a barcode that is already on a paid/credit invoice.'))
            return

        self.stdout.write(
            self.style.WARNING(
                f'Found {len(issues)} barcode(s) in active/held carts that are already on a paid/credit invoice:\n'
            )
        )
        seen = set()
        for ci, barcode_id, barcode_str, inv_number, inv_status in issues:
            key = (ci.id, barcode_id)
            if key in seen:
                continue
            seen.add(key)
            self.stdout.write(
                f'  Cart #{ci.cart.cart_number} (id={ci.cart_id}), '
                f'CartItem id={ci.id}, product={ci.product.name or ci.product_id}, '
                f'barcode={barcode_str} -> already on invoice {inv_number} (status={inv_status})'
            )
            if verbose:
                self.stdout.write(f'    -> Remove from cart or run with --fix to clean.')

        if fix:
            self.stdout.write(self.style.WARNING('\nApplying --fix: removing sold barcodes from cart items...'))
            # Group by cart item: collect all barcode strings to remove per item
            to_remove_by_item = defaultdict(set)  # cart_item_id -> set of barcode_str (upper)
            for ci, _barcode_id, barcode_str, _inv_number, _inv_status in issues:
                to_remove_by_item[ci.id].add(str(barcode_str).strip().upper())
            fixed_count = 0
            deleted_count = 0
            for ci_id, remove_set in to_remove_by_item.items():
                ci = CartItem.objects.filter(pk=ci_id).select_related('cart').first()
                if not ci:
                    continue
                new_list = [
                    b for b in (ci.scanned_barcodes or [])
                    if b and str(b).strip().upper() not in remove_set
                ]
                if new_list == (ci.scanned_barcodes or []):
                    continue
                if not new_list:
                    cart_number = ci.cart.cart_number
                    ci.delete()
                    deleted_count += 1
                    self.stdout.write(f'  Deleted CartItem id={ci_id} (cart {cart_number}): no barcodes left.')
                else:
                    ci.scanned_barcodes = new_list
                    ci.quantity = len(new_list)
                    ci.save(update_fields=['scanned_barcodes', 'quantity'])
                    fixed_count += 1
                    self.stdout.write(
                        f'  Updated CartItem id={ci_id}: removed {len(remove_set)} sold barcode(s), quantity now {len(new_list)}.'
                    )
            self.stdout.write(
                self.style.SUCCESS(f'\nFixed: {fixed_count} item(s) updated, {deleted_count} item(s) deleted.')
            )
        else:
            self.stdout.write(
                self.style.WARNING('\nRun with --fix to remove these barcodes from cart items.')
            )
