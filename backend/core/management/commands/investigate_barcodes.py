"""
Comprehensive barcode integrity investigation.

Cross-references barcodes (tag=new/returned) against invoices, carts, purchases,
returns, replacements, and audit logs to find phantom barcodes and system gaps.

Runs 8 phases:
  1. Barcode Tag Distribution vs Stock
  2. Ghost Barcode Detection
  3. Invoice-Barcode Cross Reference
  4. Cart-Barcode Cross Reference
  5. Purchase-Barcode Integrity
  6. Return & Replacement Trace
  7. Audit Log Analysis (for flagged barcodes)
  8. System Gap Summary Report

Examples:
  python manage.py investigate_barcodes
  python manage.py investigate_barcodes --product-id 42
  python manage.py investigate_barcodes --barcode FRAM-0001
  python manage.py investigate_barcodes --product-id 42 --show-audit-trail --verbose
  python manage.py investigate_barcodes --output-json > report.json
"""

import json
from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Count, Q, Sum

from backend.catalog.models import Barcode, Product
from backend.core.models import AuditLog
from backend.inventory.models import Stock, StockAdjustment
from backend.pos.models import Cart, CartItem, Invoice, InvoiceItem, Return, ReturnItem
from backend.purchasing.models import Purchase, PurchaseItem

IN_STOCK_TAGS = ('new', 'returned')
SOLD_INVOICE_STATUSES = ('paid', 'partial', 'credit')
ALL_TAGS = ('new', 'sold', 'returned', 'defective', 'unknown', 'in-cart')


class Command(BaseCommand):
    help = 'Investigate barcode integrity: find phantom barcodes, invoice mismatches, and system gaps.'

    def add_arguments(self, parser):
        parser.add_argument('--product-id', type=int, help='Investigate a specific product by ID')
        parser.add_argument('--store-id', type=int, help='Filter stock/invoices to a specific store')
        parser.add_argument('--barcode', type=str, help='Investigate a specific barcode string (full or short_code)')
        parser.add_argument('--show-audit-trail', action='store_true', help='Show full audit log trail for flagged barcodes')
        parser.add_argument('--output-json', action='store_true', help='Output results as JSON (machine-readable)')
        parser.add_argument('--verbose', action='store_true', help='Show all barcodes, not just problematic ones')

    def handle(self, *args, **options):
        self.product_id = options.get('product_id')
        self.store_id = options.get('store_id')
        self.barcode_str = (options.get('barcode') or '').strip().upper() or None
        self.show_audit = options.get('show_audit_trail', False)
        self.output_json = options.get('output_json', False)
        self.verbose = options.get('verbose', False)

        self.flagged_barcode_ids = set()
        self.report = {
            'phases': {},
            'summary': {},
            'gaps': [],
        }

        if self.barcode_str:
            self._resolve_barcode_filter()

        self._phase1_tag_distribution()
        self._phase2_ghost_barcodes()
        self._phase3_invoice_cross_ref()
        self._phase4_cart_cross_ref()
        self._phase5_purchase_integrity()
        self._phase6_return_replacement_trace()
        self._phase7_audit_log_analysis()
        self._phase8_gap_report()

        if self.output_json:
            self.stdout.write(json.dumps(self.report, indent=2, default=str))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _resolve_barcode_filter(self):
        """If --barcode was given, resolve to a product_id for consistent filtering."""
        bc = Barcode.all_objects.filter(
            Q(barcode=self.barcode_str) | Q(short_code=self.barcode_str)
        ).first()
        if bc:
            if not self.product_id and bc.product_id:
                self.product_id = bc.product_id
                self._info(f"Resolved barcode '{self.barcode_str}' to product_id={bc.product_id} ({bc.product})")
        else:
            self._warn(f"Barcode '{self.barcode_str}' not found in database (including soft-deleted)")

    def _get_products_qs(self):
        qs = Product.objects.all()
        if self.product_id:
            qs = qs.filter(id=self.product_id)
        return qs.order_by('id')

    def _get_barcodes_qs(self, **extra_filters):
        qs = Barcode.objects.all()
        if self.product_id:
            qs = qs.filter(product_id=self.product_id)
        if self.barcode_str:
            qs = qs.filter(Q(barcode=self.barcode_str) | Q(short_code=self.barcode_str))
        if extra_filters:
            qs = qs.filter(**extra_filters)
        return qs

    def _header(self, text):
        if not self.output_json:
            self.stdout.write('')
            self.stdout.write(self.style.SUCCESS('=' * 90))
            self.stdout.write(self.style.SUCCESS(text))
            self.stdout.write(self.style.SUCCESS('=' * 90))

    def _sub_header(self, text):
        if not self.output_json:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING(f'--- {text} ---'))

    def _info(self, text):
        if not self.output_json:
            self.stdout.write(f'  {text}')

    def _warn(self, text):
        if not self.output_json:
            self.stdout.write(self.style.WARNING(f'  [!] {text}'))

    def _critical(self, text):
        if not self.output_json:
            self.stdout.write(self.style.ERROR(f'  [CRITICAL] {text}'))

    def _ok(self, text):
        if not self.output_json:
            self.stdout.write(self.style.SUCCESS(f'  [OK] {text}'))

    # ------------------------------------------------------------------
    # Phase 1: Barcode Tag Distribution vs Stock
    # ------------------------------------------------------------------

    def _phase1_tag_distribution(self):
        self._header('PHASE 1: Barcode Tag Distribution vs Stock Quantity')

        products = self._get_products_qs()
        if not products.exists():
            self._warn('No products found for the given filters.')
            return

        phase_data = {'products': [], 'total_mismatches': 0}

        for product in products:
            stock_filter = {'product': product}
            if self.store_id:
                stock_filter['store_id'] = self.store_id
            stock_qty = Stock.objects.filter(**stock_filter).aggregate(
                total=Sum('quantity')
            )['total'] or Decimal('0.000')

            bc_qs = Barcode.objects.filter(product=product)
            tag_counts = dict(bc_qs.values_list('tag').annotate(c=Count('id')).values_list('tag', 'c'))
            in_stock_count = sum(tag_counts.get(t, 0) for t in IN_STOCK_TAGS)
            total_barcodes = sum(tag_counts.values())

            diff = float(stock_qty) - in_stock_count
            has_mismatch = abs(diff) > 0.001

            if has_mismatch:
                phase_data['total_mismatches'] += 1

            product_entry = {
                'product_id': product.id,
                'product_name': product.name,
                'track_inventory': product.track_inventory,
                'stock_quantity': float(stock_qty),
                'barcode_in_stock': in_stock_count,
                'difference': round(diff, 3),
                'tags': {t: tag_counts.get(t, 0) for t in ALL_TAGS},
                'total_barcodes': total_barcodes,
                'mismatch': has_mismatch,
            }
            phase_data['products'].append(product_entry)

            if self.verbose or has_mismatch or total_barcodes > 0:
                self._sub_header(f'{product.name} (ID: {product.id})')
                self._info(f'Track Inventory: {product.track_inventory}')
                self._info(f'Stock Model Qty: {stock_qty}')
                self._info(f'Barcodes (new+returned): {in_stock_count}')
                self._info(f'Total Barcodes: {total_barcodes}')
                for t in ALL_TAGS:
                    c = tag_counts.get(t, 0)
                    if c > 0 or self.verbose:
                        self._info(f'  {t}: {c}')
                self._info(f'Difference (Stock - Barcodes): {diff:+.3f}')
                if has_mismatch:
                    if diff > 0:
                        self._warn(f'Stock is HIGHER than barcodes by {diff:.3f}')
                    else:
                        self._warn(f'Stock is LOWER than barcodes by {abs(diff):.3f}')
                else:
                    self._ok('Stock and barcodes are in sync')

        self._sub_header(f'Phase 1 Summary: {phase_data["total_mismatches"]} product(s) with Stock-Barcode mismatch')
        self.report['phases']['phase1'] = phase_data

    # ------------------------------------------------------------------
    # Phase 2: Ghost Barcode Detection
    # ------------------------------------------------------------------

    def _phase2_ghost_barcodes(self):
        self._header('PHASE 2: Ghost Barcode Detection (tag=new/returned but suspicious)')

        in_stock_barcodes = list(
            self._get_barcodes_qs(tag__in=IN_STOCK_TAGS)
            .select_related('product', 'purchase', 'purchase_item')
        )
        if not in_stock_barcodes:
            self._ok('No barcodes with tag=new/returned found for the given filters.')
            self.report['phases']['phase2'] = {'ghosts': [], 'total_checked': 0}
            return

        bc_ids = [b.id for b in in_stock_barcodes]

        invoice_items_by_barcode = defaultdict(list)
        for ii in InvoiceItem.objects.filter(barcode_id__in=bc_ids).select_related('invoice'):
            invoice_items_by_barcode[ii.barcode_id].append(ii)

        return_items_by_barcode = set(
            ReturnItem.objects.filter(barcode_id__in=bc_ids).values_list('barcode_id', flat=True)
        )

        active_cart_items = CartItem.objects.filter(
            cart__status__in=['active', 'held']
        ).exclude(scanned_barcodes=[]).exclude(scanned_barcodes__isnull=True)
        cart_barcode_strings = set()
        for ci in active_cart_items:
            for b_str in (ci.scanned_barcodes or []):
                if b_str:
                    cart_barcode_strings.add(str(b_str).strip().upper())

        ghosts = []
        for bc in in_stock_barcodes:
            issues = []

            if not bc.purchase_id:
                issues.append('no_purchase_link')
            elif bc.purchase and bc.purchase.status != 'finalized':
                issues.append(f'purchase_status={bc.purchase.status}')

            inv_items = invoice_items_by_barcode.get(bc.id, [])
            sold_invoices = [
                ii for ii in inv_items if ii.invoice.status in SOLD_INVOICE_STATUSES
            ]
            if sold_invoices:
                inv_nums = ', '.join(ii.invoice.invoice_number for ii in sold_invoices)
                issues.append(f'on_sold_invoice({inv_nums})')

            voided_invoices = [ii for ii in inv_items if ii.invoice.status == 'void']
            if voided_invoices and not sold_invoices:
                inv_nums = ', '.join(ii.invoice.invoice_number for ii in voided_invoices)
                issues.append(f'was_on_voided_invoice({inv_nums})')

            in_cart = (
                bc.barcode in cart_barcode_strings
                or (bc.short_code and bc.short_code.upper() in cart_barcode_strings)
            )
            if in_cart and bc.tag != 'in-cart':
                issues.append('in_active_cart_but_tag_not_in_cart')

            has_return = bc.id in return_items_by_barcode
            if has_return and bc.tag == 'new':
                issues.append('has_return_record_but_tag_is_new')

            if issues:
                self.flagged_barcode_ids.add(bc.id)
                ghost_entry = {
                    'barcode_id': bc.id,
                    'barcode': bc.barcode,
                    'short_code': bc.short_code,
                    'tag': bc.tag,
                    'product_id': bc.product_id,
                    'product_name': bc.product.name if bc.product else None,
                    'purchase_id': bc.purchase_id,
                    'purchase_status': bc.purchase.status if bc.purchase else None,
                    'issues': issues,
                }
                ghosts.append(ghost_entry)

                self._sub_header(f'GHOST: {bc.barcode} (ID: {bc.id})')
                self._info(f'Tag: {bc.tag} | Product: {bc.product.name if bc.product else "?"} (ID: {bc.product_id})')
                self._info(f'Short Code: {bc.short_code or "N/A"}')
                self._info(f'Purchase: {bc.purchase_id or "NONE"} (status: {bc.purchase.status if bc.purchase else "N/A"})')
                for issue in issues:
                    self._critical(issue)
            elif self.verbose:
                self._info(f'OK: {bc.barcode} (tag={bc.tag}, purchase={bc.purchase_id})')

        self._sub_header(f'Phase 2 Summary: {len(ghosts)} ghost barcode(s) found out of {len(in_stock_barcodes)} checked')
        self.report['phases']['phase2'] = {
            'ghosts': ghosts,
            'total_checked': len(in_stock_barcodes),
        }

    # ------------------------------------------------------------------
    # Phase 3: Invoice-Barcode Cross Reference
    # ------------------------------------------------------------------

    def _phase3_invoice_cross_ref(self):
        self._header('PHASE 3: Invoice-Barcode Cross Reference')

        inv_item_qs = InvoiceItem.objects.filter(barcode_id__isnull=False).select_related(
            'invoice', 'invoice__store', 'barcode', 'product'
        )
        if self.product_id:
            inv_item_qs = inv_item_qs.filter(product_id=self.product_id)
        if self.store_id:
            inv_item_qs = inv_item_qs.filter(invoice__store_id=self.store_id)

        mismatches = []

        for ii in inv_item_qs:
            if not ii.barcode:
                continue
            inv = ii.invoice
            bc = ii.barcode
            expected_tag = None
            issue_type = None

            if inv.status in SOLD_INVOICE_STATUSES and bc.tag != 'sold':
                expected_tag = 'sold'
                issue_type = 'sold_invoice_but_barcode_not_sold'

            elif inv.status == 'void' and bc.tag == 'sold':
                expected_tag = 'new'
                issue_type = 'voided_invoice_but_barcode_still_sold'

            elif inv.status == 'draft' and inv.invoice_type == 'pending':
                is_repair = bool(inv.store and (inv.store.shop_type or '').lower() == 'repair')
                if is_repair and bc.tag not in ('in-cart', 'sold'):
                    expected_tag = 'in-cart'
                    issue_type = 'repair_pending_draft_tag_mismatch'
                elif not is_repair and bc.tag not in ('sold',):
                    expected_tag = 'sold'
                    issue_type = 'nonrepair_pending_draft_tag_mismatch'

            if issue_type:
                self.flagged_barcode_ids.add(bc.id)
                entry = {
                    'invoice_number': inv.invoice_number,
                    'invoice_status': inv.status,
                    'invoice_type': inv.invoice_type,
                    'invoice_item_id': ii.id,
                    'barcode_id': bc.id,
                    'barcode': bc.barcode,
                    'current_tag': bc.tag,
                    'expected_tag': expected_tag,
                    'issue': issue_type,
                    'product_id': ii.product_id,
                    'product_name': ii.product.name if ii.product else None,
                }
                mismatches.append(entry)

                self._sub_header(f'{issue_type}')
                self._info(f'Invoice: {inv.invoice_number} (status={inv.status}, type={inv.invoice_type})')
                self._info(f'Barcode: {bc.barcode} (ID: {bc.id})')
                self._info(f'Current Tag: {bc.tag} | Expected: {expected_tag}')
                self._info(f'Product: {ii.product.name if ii.product else "?"} (ID: {ii.product_id})')
            elif self.verbose:
                self._ok(f'{bc.barcode} on {inv.invoice_number} (status={inv.status}) -> tag={bc.tag}')

        self._sub_header(f'Phase 3 Summary: {len(mismatches)} invoice-barcode mismatch(es)')
        self.report['phases']['phase3'] = {
            'mismatches': mismatches,
            'total_checked': inv_item_qs.count(),
        }

    # ------------------------------------------------------------------
    # Phase 4: Cart-Barcode Cross Reference
    # ------------------------------------------------------------------

    def _phase4_cart_cross_ref(self):
        self._header('PHASE 4: Cart-Barcode Cross Reference (active/held carts)')

        cart_items = CartItem.objects.filter(
            cart__status__in=['active', 'held']
        ).exclude(
            scanned_barcodes=[]
        ).exclude(
            scanned_barcodes__isnull=True
        ).select_related('cart', 'product')

        if self.store_id:
            cart_items = cart_items.filter(cart__store_id=self.store_id)

        sold_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__status__in=SOLD_INVOICE_STATUSES,
                barcode_id__isnull=False,
            ).values_list('barcode_id', flat=True).distinct()
        )

        issues = []
        total_scanned = 0

        for ci in cart_items:
            for barcode_str in (ci.scanned_barcodes or []):
                if not barcode_str:
                    continue
                total_scanned += 1
                b_upper = str(barcode_str).strip().upper()

                bc = Barcode.objects.filter(
                    Q(barcode=b_upper) | Q(short_code=b_upper)
                ).first()

                if not bc:
                    entry = {
                        'cart_number': ci.cart.cart_number,
                        'cart_item_id': ci.id,
                        'barcode_string': barcode_str,
                        'issue': 'barcode_not_found_in_db',
                        'product_name': ci.product.name if ci.product else None,
                    }
                    issues.append(entry)
                    self._warn(f'Cart #{ci.cart.cart_number}: barcode "{barcode_str}" not found in DB')
                    continue

                if self.product_id and bc.product_id != self.product_id:
                    continue

                cart_issues = []

                if bc.id in sold_barcode_ids:
                    cart_issues.append('already_on_sold_invoice')

                if bc.tag not in ('in-cart', 'sold'):
                    cart_issues.append(f'tag_is_{bc.tag}_expected_in_cart_or_sold')

                if cart_issues:
                    self.flagged_barcode_ids.add(bc.id)
                    entry = {
                        'cart_number': ci.cart.cart_number,
                        'cart_item_id': ci.id,
                        'barcode_id': bc.id,
                        'barcode': bc.barcode,
                        'current_tag': bc.tag,
                        'issues': cart_issues,
                        'product_name': ci.product.name if ci.product else None,
                    }
                    issues.append(entry)

                    self._sub_header(f'Cart #{ci.cart.cart_number} - {bc.barcode}')
                    self._info(f'Product: {ci.product.name if ci.product else "?"}')
                    self._info(f'Barcode Tag: {bc.tag}')
                    for ci_issue in cart_issues:
                        self._critical(ci_issue)

        self._sub_header(f'Phase 4 Summary: {len(issues)} cart-barcode issue(s) from {total_scanned} scanned entries')
        self.report['phases']['phase4'] = {
            'issues': issues,
            'total_scanned': total_scanned,
        }

    # ------------------------------------------------------------------
    # Phase 5: Purchase-Barcode Integrity
    # ------------------------------------------------------------------

    def _phase5_purchase_integrity(self):
        self._header('PHASE 5: Purchase-Barcode Integrity')

        pi_qs = PurchaseItem.objects.filter(
            purchase__status='finalized'
        ).select_related('purchase', 'product')
        if self.product_id:
            pi_qs = pi_qs.filter(product_id=self.product_id)

        pi_ids = list(pi_qs.values_list('id', flat=True))

        bc_counts_by_pi = {}
        if pi_ids:
            for row in (
                Barcode.objects.filter(purchase_item_id__in=pi_ids)
                .values('purchase_item_id', 'tag')
                .annotate(c=Count('id'))
            ):
                pid = row['purchase_item_id']
                bc_counts_by_pi.setdefault(pid, {})[row['tag']] = row['c']

        discrepancies = []

        for item in pi_qs:
            expected = int(item.quantity)
            tags = bc_counts_by_pi.get(item.id, {})
            actual = sum(tags.values())
            gap = expected - actual

            if gap != 0:
                entry = {
                    'purchase_number': item.purchase.purchase_number,
                    'purchase_item_id': item.id,
                    'product_id': item.product_id,
                    'product_name': item.product.name if item.product else None,
                    'expected_barcodes': expected,
                    'actual_barcodes': actual,
                    'gap': gap,
                    'tags': tags,
                }
                discrepancies.append(entry)

                self._sub_header(f'{item.purchase.purchase_number} - Item #{item.id}')
                self._info(f'Product: {item.product.name if item.product else "?"} (ID: {item.product_id})')
                self._info(f'Purchased Qty: {expected} | Barcodes Found: {actual} | Gap: {gap}')
                self._info(f'Tag breakdown: {dict(tags)}')
                if gap > 0:
                    self._warn(f'{gap} barcode(s) missing from this purchase line')
                else:
                    self._warn(f'{abs(gap)} extra barcode(s) beyond purchased qty')
            elif self.verbose:
                self._ok(f'{item.purchase.purchase_number} Item #{item.id}: {expected} purchased = {actual} barcodes')

        orphan_count = self._get_barcodes_qs(purchase_id__isnull=True).count()
        cancelled_new = Barcode.objects.filter(
            purchase__status__in=['cancelled', 'draft'],
            tag__in=IN_STOCK_TAGS,
        )
        if self.product_id:
            cancelled_new = cancelled_new.filter(product_id=self.product_id)
        cancelled_new_count = cancelled_new.count()

        cancelled_new_list = []
        if cancelled_new_count > 0:
            for bc in cancelled_new.select_related('purchase', 'product')[:50]:
                self.flagged_barcode_ids.add(bc.id)
                cancelled_new_list.append({
                    'barcode_id': bc.id,
                    'barcode': bc.barcode,
                    'tag': bc.tag,
                    'purchase_id': bc.purchase_id,
                    'purchase_status': bc.purchase.status if bc.purchase else None,
                    'product_name': bc.product.name if bc.product else None,
                })
                self._critical(
                    f'{bc.barcode} (tag={bc.tag}) linked to '
                    f'{bc.purchase.status} purchase #{bc.purchase.purchase_number}'
                )

        self._sub_header(
            f'Phase 5 Summary: {len(discrepancies)} purchase-line discrepancies, '
            f'{orphan_count} orphan barcodes (no purchase), '
            f'{cancelled_new_count} barcodes on cancelled/draft purchases still tagged new/returned'
        )
        self.report['phases']['phase5'] = {
            'discrepancies': discrepancies,
            'orphan_barcode_count': orphan_count,
            'cancelled_draft_new_barcodes': cancelled_new_list,
        }

    # ------------------------------------------------------------------
    # Phase 6: Return & Replacement Trace
    # ------------------------------------------------------------------

    def _phase6_return_replacement_trace(self):
        self._header('PHASE 6: Return & Replacement Trace')

        returned_barcodes = list(
            self._get_barcodes_qs(tag='returned').select_related('product')
        )

        returned_bc_ids = [b.id for b in returned_barcodes]
        return_item_bc_ids = set()
        if returned_bc_ids:
            return_item_bc_ids = set(
                ReturnItem.objects.filter(barcode_id__in=returned_bc_ids)
                .values_list('barcode_id', flat=True)
            )

        issues = []
        for bc in returned_barcodes:
            if bc.id not in return_item_bc_ids:
                replacement_audit = AuditLog.objects.filter(
                    action__in=[
                        'replacement_create', 'replacement_replace',
                        'replacement_return', 'replacement_defective',
                        'barcode_tag_change',
                    ],
                    barcode=bc.barcode,
                ).order_by('-created_at').first()

                source = 'unknown'
                if replacement_audit:
                    source = replacement_audit.action

                self.flagged_barcode_ids.add(bc.id)
                entry = {
                    'barcode_id': bc.id,
                    'barcode': bc.barcode,
                    'product_id': bc.product_id,
                    'product_name': bc.product.name if bc.product else None,
                    'issue': 'returned_tag_but_no_return_record',
                    'likely_source': source,
                }
                issues.append(entry)

                self._sub_header(f'{bc.barcode} (tag=returned, no ReturnItem)')
                self._info(f'Product: {bc.product.name if bc.product else "?"} (ID: {bc.product_id})')
                self._warn(f'No ReturnItem record found. Likely source: {source}')
            elif self.verbose:
                self._ok(f'{bc.barcode} (tag=returned) has matching ReturnItem')

        tag_change_audit = AuditLog.objects.filter(
            action='barcode_tag_change',
        )
        if self.product_id:
            product = Product.objects.filter(id=self.product_id).first()
            if product:
                tag_change_audit = tag_change_audit.filter(
                    Q(object_name=product.name) | Q(changes__product_id=self.product_id)
                )

        suspicious_transitions = []
        for log in tag_change_audit.order_by('-created_at')[:500]:
            changes = log.changes if isinstance(log.changes, dict) else {}
            tag_info = changes.get('tag', {})
            if not isinstance(tag_info, dict):
                continue
            old_tag = tag_info.get('old', '')
            new_tag = tag_info.get('new', '')

            suspicious = False
            reason = ''

            if old_tag == 'sold' and new_tag == 'new':
                context = changes.get('context', '')
                if context not in ('void_invoice', 'invoice_void'):
                    suspicious = True
                    reason = f'sold->new without void (context: {context or "none"})'

            if old_tag == 'sold' and new_tag == 'returned':
                if not ReturnItem.objects.filter(barcode__barcode=log.barcode).exists():
                    suspicious = True
                    reason = 'sold->returned but no ReturnItem exists'

            if new_tag in ('new', 'returned') and old_tag in ('sold', 'in-cart'):
                if not suspicious:
                    context = changes.get('context', '')
                    if 'credit_note' in str(context).lower() or 'replacement' in str(context).lower():
                        suspicious = True
                        reason = f'{old_tag}->{new_tag} via {context}'

            if suspicious:
                sus_entry = {
                    'audit_id': log.id,
                    'created_at': str(log.created_at),
                    'barcode': log.barcode,
                    'old_tag': old_tag,
                    'new_tag': new_tag,
                    'context': changes.get('context', ''),
                    'object_reference': log.object_reference,
                    'reason': reason,
                }
                suspicious_transitions.append(sus_entry)

                self._sub_header(f'Suspicious transition: {log.barcode}')
                self._info(f'{old_tag} -> {new_tag} at {log.created_at}')
                self._info(f'Reference: {log.object_reference}')
                self._critical(reason)

        self._sub_header(
            f'Phase 6 Summary: {len(issues)} returned barcodes without ReturnItem, '
            f'{len(suspicious_transitions)} suspicious tag transitions'
        )
        self.report['phases']['phase6'] = {
            'returned_without_return_record': issues,
            'suspicious_transitions': suspicious_transitions,
        }

    # ------------------------------------------------------------------
    # Phase 7: Audit Log Analysis
    # ------------------------------------------------------------------

    def _phase7_audit_log_analysis(self):
        self._header('PHASE 7: Audit Log Analysis for Flagged Barcodes')

        if not self.flagged_barcode_ids and not self.show_audit:
            self._ok('No flagged barcodes to analyze. Use --show-audit-trail to force.')
            self.report['phases']['phase7'] = {'trails': []}
            return

        if self.flagged_barcode_ids:
            flagged_barcodes = Barcode.all_objects.filter(id__in=self.flagged_barcode_ids)
        elif self.barcode_str:
            flagged_barcodes = Barcode.all_objects.filter(
                Q(barcode=self.barcode_str) | Q(short_code=self.barcode_str)
            )
        else:
            flagged_barcodes = self._get_barcodes_qs(tag__in=IN_STOCK_TAGS)[:50]

        trails = []

        for bc in flagged_barcodes:
            logs = AuditLog.objects.filter(
                Q(barcode=bc.barcode)
                | Q(barcode__icontains=bc.barcode)
                | (Q(model_name='Barcode') & Q(object_id=str(bc.id)))
            ).order_by('created_at')

            if not logs.exists() and not self.show_audit:
                continue

            trail_entries = []
            for log in logs[:100]:
                trail_entries.append({
                    'timestamp': str(log.created_at),
                    'action': log.action,
                    'model': log.model_name,
                    'object_reference': log.object_reference,
                    'changes': log.changes,
                })

            trail = {
                'barcode_id': bc.id,
                'barcode': bc.barcode,
                'current_tag': bc.tag,
                'product_id': bc.product_id,
                'entries': trail_entries,
            }
            trails.append(trail)

            if self.show_audit or self.verbose:
                self._sub_header(f'Audit Trail: {bc.barcode} (ID: {bc.id}, tag={bc.tag})')
                if not trail_entries:
                    self._warn('No audit log entries found for this barcode')
                for entry in trail_entries:
                    self._info(
                        f'[{entry["timestamp"]}] {entry["action"]} | '
                        f'ref={entry["object_reference"]} | '
                        f'changes={json.dumps(entry["changes"], default=str)[:200]}'
                    )

        self._sub_header(f'Phase 7 Summary: {len(trails)} barcode audit trail(s) retrieved')
        self.report['phases']['phase7'] = {'trails': trails}

    # ------------------------------------------------------------------
    # Phase 8: System Gap Report
    # ------------------------------------------------------------------

    def _phase8_gap_report(self):
        self._header('PHASE 8: System Gap Report & Recommendations')

        p1 = self.report['phases'].get('phase1', {})
        p2 = self.report['phases'].get('phase2', {})
        p3 = self.report['phases'].get('phase3', {})
        p4 = self.report['phases'].get('phase4', {})
        p5 = self.report['phases'].get('phase5', {})
        p6 = self.report['phases'].get('phase6', {})

        stock_mismatches = p1.get('total_mismatches', 0)
        ghost_count = len(p2.get('ghosts', []))
        invoice_mismatches = len(p3.get('mismatches', []))
        cart_issues = len(p4.get('issues', []))
        purchase_discrepancies = len(p5.get('discrepancies', []))
        orphan_barcodes = p5.get('orphan_barcode_count', 0)
        cancelled_new = len(p5.get('cancelled_draft_new_barcodes', []))
        returned_no_record = len(p6.get('returned_without_return_record', []))
        suspicious_transitions = len(p6.get('suspicious_transitions', []))

        summary = {
            'stock_barcode_mismatches': stock_mismatches,
            'ghost_barcodes': ghost_count,
            'invoice_barcode_mismatches': invoice_mismatches,
            'cart_barcode_issues': cart_issues,
            'purchase_line_discrepancies': purchase_discrepancies,
            'orphan_barcodes_no_purchase': orphan_barcodes,
            'barcodes_on_cancelled_draft_purchases': cancelled_new,
            'returned_without_return_record': returned_no_record,
            'suspicious_tag_transitions': suspicious_transitions,
            'total_flagged_barcodes': len(self.flagged_barcode_ids),
        }
        self.report['summary'] = summary

        self._sub_header('Counts')
        for key, val in summary.items():
            label = key.replace('_', ' ').title()
            if val > 0:
                self._warn(f'{label}: {val}')
            else:
                self._ok(f'{label}: {val}')

        gaps = []

        ghost_on_sold = [
            g for g in p2.get('ghosts', [])
            if any('on_sold_invoice' in i for i in g.get('issues', []))
        ]
        if ghost_on_sold:
            gap = {
                'id': 'GAP-001',
                'severity': 'CRITICAL',
                'title': 'Barcodes tagged new/returned but present on sold invoices',
                'count': len(ghost_on_sold),
                'description': (
                    'These barcodes show tag=new or returned (meaning "in stock") but are '
                    'linked to paid/partial/credit invoices. The tag was likely reverted to '
                    '"new" during an invoice void/edit/delete without checking if the item '
                    'was physically given to customer.'
                ),
                'affected_barcodes': [g['barcode'] for g in ghost_on_sold],
                'fix': (
                    'Run: python manage.py reconcile_barcode_tags --apply\n'
                    'Code fix: invoice_detail DELETE and invoice_item_detail DELETE should '
                    'check if the invoice was ever in paid/credit status before reverting '
                    'barcode tags to "new".'
                ),
            }
            gaps.append(gap)

        if cancelled_new > 0:
            gap = {
                'id': 'GAP-002',
                'severity': 'HIGH',
                'title': 'Barcodes on cancelled/draft purchases still tagged as in-stock',
                'count': cancelled_new,
                'description': (
                    'Barcodes linked to cancelled or draft purchases still have tag=new/returned. '
                    'These barcodes represent stock that was never finalized into inventory.'
                ),
                'fix': (
                    'These barcodes should be soft-deleted or their tags set to "unknown". '
                    'Purchase cancellation should clean up associated barcodes.'
                ),
            }
            gaps.append(gap)

        if returned_no_record > 0:
            gap = {
                'id': 'GAP-003',
                'severity': 'MEDIUM',
                'title': 'Barcodes tagged "returned" but no ReturnItem record exists',
                'count': returned_no_record,
                'description': (
                    'These barcodes have tag=returned but there is no ReturnItem linking them '
                    'to an actual return. They may have been set to "returned" via replacement '
                    'flows or manual tag updates without proper return documentation.'
                ),
                'fix': (
                    'Replacement and manual tag change flows should create a ReturnItem or '
                    'equivalent audit record. Investigate via --show-audit-trail.'
                ),
            }
            gaps.append(gap)

        if cart_issues > 0:
            gap = {
                'id': 'GAP-004',
                'severity': 'HIGH',
                'title': 'Stale barcodes in active carts',
                'count': cart_issues,
                'description': (
                    'Active/held carts contain barcodes that are already sold or have '
                    'unexpected tag states. This can cause double-selling or incorrect '
                    'stock counts.'
                ),
                'fix': (
                    'Run: python manage.py validate_cart_invoice_barcodes --fix\n'
                    'Code fix: cart_item_remove_sku should also check "partial" invoice '
                    'status (currently only checks paid/credit).'
                ),
            }
            gaps.append(gap)

        if invoice_mismatches > 0:
            sold_not_tagged = [
                m for m in p3.get('mismatches', [])
                if m['issue'] == 'sold_invoice_but_barcode_not_sold'
            ]
            if sold_not_tagged:
                gap = {
                    'id': 'GAP-005',
                    'severity': 'CRITICAL',
                    'title': 'Sold invoices with barcodes not tagged as sold',
                    'count': len(sold_not_tagged),
                    'description': (
                        'Barcodes on paid/partial/credit invoices do not have tag=sold. '
                        'This inflates the "in stock" count and is the primary cause of '
                        'phantom stock.'
                    ),
                    'affected_invoices': list({m['invoice_number'] for m in sold_not_tagged}),
                    'fix': (
                        'Run: python manage.py reconcile_barcode_tags --apply\n'
                        'Root cause: checkout/invoice flows may have failed to tag barcodes, '
                        'or a subsequent operation (edit, revert) reset the tag.'
                    ),
                }
                gaps.append(gap)

        if suspicious_transitions > 0:
            gap = {
                'id': 'GAP-006',
                'severity': 'HIGH',
                'title': 'Suspicious barcode tag transitions in audit log',
                'count': suspicious_transitions,
                'description': (
                    'Tag transitions like sold->new or sold->returned were detected without '
                    'corresponding void/return records. These transitions can create phantom '
                    'stock if not properly guarded.'
                ),
                'fix': (
                    'Code fixes needed:\n'
                    '1. invoice_detail DELETE: check if invoice was ever paid before reverting tags\n'
                    '2. replacement_credit_note: validate status param against allowed values\n'
                    '3. replacement_return: validate return_tag against TAG_CHOICES\n'
                    '4. revert_credit_invoice_to_draft_pending: add guard for physical dispatch'
                ),
            }
            gaps.append(gap)

        if stock_mismatches > 0 and ghost_count == 0 and invoice_mismatches == 0:
            gap = {
                'id': 'GAP-007',
                'severity': 'MEDIUM',
                'title': 'Stock quantity out of sync with barcode counts (no barcode-level issue found)',
                'count': stock_mismatches,
                'description': (
                    'The Stock model quantity does not match barcode new+returned counts, but '
                    'no individual barcode anomaly was detected. This may be due to stock '
                    'adjustments, untracked products, or rounding.'
                ),
                'fix': (
                    'Run: python manage.py sync_stock_from_barcodes --dry-run to preview, '
                    'then --apply to fix.'
                ),
            }
            gaps.append(gap)

        self.report['gaps'] = [g for g in gaps]

        self._sub_header('Identified Gaps')
        if not gaps:
            self._ok('No system gaps identified.')
        for gap in gaps:
            self._sub_header(f'{gap["id"]}: {gap["title"]}')
            self._info(f'Severity: {gap["severity"]}')
            self._info(f'Count: {gap["count"]}')
            self._info(f'Description: {gap["description"]}')
            self._info(f'Recommended Fix: {gap["fix"]}')

        self._header('INVESTIGATION COMPLETE')
        self._info(f'Total flagged barcodes: {len(self.flagged_barcode_ids)}')
        if self.flagged_barcode_ids and not self.show_audit:
            self._info('Run again with --show-audit-trail to see full history for flagged barcodes.')
        if not self.output_json:
            self._info('Run again with --output-json to get machine-readable output.')
