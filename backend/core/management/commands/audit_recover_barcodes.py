"""
Investigate / recover barcode traces for a missing or soft-deleted product.

Uses AuditLog (same data as History UI), Barcode.all_objects (includes soft-deleted),
and InvoiceItem lines linked by barcode id.

Examples:
  python manage.py audit_recover_barcodes --product-id 2126
  python manage.py audit_recover_barcodes --sku FOLD-20260123-3D9981FD
  python manage.py audit_recover_barcodes --product-id 2126 --restore-soft-deleted
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from backend.core.models import AuditLog
from backend.catalog.models import Barcode, Product
from backend.pos.models import Invoice, InvoiceItem


class Command(BaseCommand):
    help = 'List audit clues and DB rows to recover barcodes for a product (see docstring).'

    def add_arguments(self, parser):
        parser.add_argument('--product-id', type=int, default=None, help='Product PK')
        parser.add_argument('--sku', type=str, default=None, help='Product SKU (exact or partial in audit)')
        parser.add_argument(
            '--restore-soft-deleted',
            action='store_true',
            help='Clear deleted_at on matching Barcode rows and restore product if soft-deleted',
        )
        parser.add_argument(
            '--invoice-number',
            type=str,
            default=None,
            help='Show invoice items for this invoice (from audit clues, e.g. INV-...)',
        )

    def handle(self, *args, **options):
        pid = options['product_id']
        sku = (options['sku'] or '').strip() or None
        invoice_number = (options['invoice_number'] or '').strip() or None
        do_restore = options['restore_soft_deleted']

        if not pid and not sku:
            self.stderr.write('Provide --product-id and/or --sku')
            return

        self.stdout.write(self.style.WARNING('=== Product (all_objects, includes soft-deleted) ==='))
        if pid:
            try:
                p = Product.all_objects.get(pk=pid)
            except Product.DoesNotExist:
                p = None
            if p:
                self.stdout.write(
                    f'  id={p.id} name={p.name!r} sku={p.sku!r} '
                    f'is_active={p.is_active} deleted_at={p.deleted_at!r}'
                )
            else:
                self.stdout.write(self.style.ERROR(f'  No product row with id={pid} (hard-deleted from DB).'))
        if sku and not pid:
            for p in Product.all_objects.filter(sku__iexact=sku)[:20]:
                self.stdout.write(
                    f'  id={p.id} name={p.name!r} sku={p.sku!r} deleted_at={p.deleted_at!r}'
                )

        self.stdout.write(self.style.WARNING('\n=== AuditLog: Product delete / update (object_id match) ==='))
        if pid:
            for log in AuditLog.objects.filter(model_name='Product', object_id=str(pid)).order_by('-created_at')[:15]:
                self._print_log(log)
        if sku:
            for log in AuditLog.objects.filter(
                Q(model_name='Product', object_reference__iexact=sku)
                | Q(model_name='Product', changes__contains={'sku': sku})
            ).order_by('-created_at')[:15]:
                self._print_log(log)

        self.stdout.write(self.style.WARNING('\n=== AuditLog: Barcode (JSON product_id or SKU / barcode field) ==='))
        # Prefer DB JSON filter when supported (Postgres); else scan recent logs.
        audit_barcode_qs = AuditLog.objects.filter(model_name='Barcode').order_by('-created_at')
        json_hits = []
        if pid:
            json_hits = list(
                audit_barcode_qs.filter(
                    Q(changes__product_id=pid) | Q(changes__product_id=str(pid))
                )[:500]
            )
            if json_hits:
                self.stdout.write(self.style.SUCCESS(f'  JSON filter hits: {len(json_hits)}'))
                strings = set()
                for log in json_hits:
                    self._print_log(log)
                    self._audit_barcode_row_hint(log)
                    ch = log.changes if isinstance(log.changes, dict) else {}
                    for key in ('barcode', 'scanned_barcode', 'old_barcode', 'new_barcode'):
                        v = ch.get(key)
                        if v:
                            strings.add(str(v))
                    if log.barcode:
                        strings.add(str(log.barcode))
                if strings:
                    self.stdout.write(self.style.WARNING(f'  Unique barcode strings from these logs: {sorted(strings)}'))

        scanned = 0
        max_scan = 15000
        if not json_hits:
            for log in audit_barcode_qs[:max_scan]:
                scanned += 1
                ch = log.changes if isinstance(log.changes, dict) else {}
                match = False
                if pid:
                    if ch.get('product_id') == pid or str(ch.get('product_id')) == str(pid):
                        match = True
                if sku and not match:
                    if ch.get('product_sku') and sku.lower() in str(ch.get('product_sku')).lower():
                        match = True
                    if ch.get('barcode') and sku.lower() in str(ch.get('barcode')).lower():
                        match = True
                    if log.object_reference and sku.lower() in str(log.object_reference).lower():
                        match = True
                    if log.barcode and sku.lower() in str(log.barcode).lower():
                        match = True
                if match:
                    self._print_log(log)
                    self._audit_barcode_row_hint(log)

            if scanned >= max_scan:
                self.stdout.write(
                    self.style.NOTICE(
                        f'(Scanned last {max_scan} Barcode audit rows; for Postgres use: '
                        f'AuditLog.objects.filter(model_name="Barcode", changes__product_id=<id>))'
                    )
                )

        self.stdout.write(self.style.WARNING('\n=== AuditLog: any row mentioning SKU in object_reference / barcode column ==='))
        if sku:
            for log in (
                AuditLog.objects.filter(Q(object_reference__icontains=sku) | Q(barcode__icontains=sku))
                .order_by('-created_at')[:40]
            ):
                self._print_log(log)

        self.stdout.write(self.style.WARNING('\n=== Barcode.all_objects (by product_id / sku hints) ==='))
        if pid:
            qs = Barcode.all_objects.filter(product_id=pid).order_by('-id')
            self.stdout.write(f'  count={qs.count()}')
            for b in qs[:50]:
                self.stdout.write(
                    f'  id={b.id} barcode={b.barcode!r} tag={b.tag} deleted_at={b.deleted_at!r} '
                    f'purchase_id={b.purchase_id}'
                )
        if sku:
            qs = Barcode.all_objects.filter(
                Q(barcode__icontains=sku) | Q(short_code__icontains=sku)
            ).order_by('-id')[:30]
            for b in qs:
                self.stdout.write(
                    f'  id={b.id} barcode={b.barcode!r} product_id={b.product_id} tag={b.tag} deleted_at={b.deleted_at!r}'
                )

        self.stdout.write(self.style.WARNING('\n=== InvoiceItem (by barcode ids for this product) ==='))
        if pid:
            bc_ids = list(Barcode.all_objects.filter(product_id=pid).values_list('id', flat=True))
            if bc_ids:
                items = (
                    InvoiceItem.objects.filter(barcode_id__in=bc_ids)
                    .select_related('invoice', 'barcode')
                    .order_by('-id')[:40]
                )
                for ii in items:
                    inv = ii.invoice
                    self.stdout.write(
                        f'  inv_item id={ii.id} invoice={getattr(inv, "invoice_number", None)} '
                        f'barcode_id={ii.barcode_id} qty={ii.quantity}'
                    )
            else:
                self.stdout.write('  (no barcodes linked to product_id in all_objects)')

        inv_no = invoice_number
        if not inv_no and pid:
            # Pull invoice numbers from JSON hits or a scan of recent Barcode audit rows
            inv_nos = set()
            for log in json_hits or []:
                ch = log.changes if isinstance(log.changes, dict) else {}
                n = ch.get('invoice_number')
                if n:
                    inv_nos.add(n)
            if not inv_nos:
                for log in AuditLog.objects.filter(model_name='Barcode').order_by('-created_at')[:8000]:
                    ch = log.changes if isinstance(log.changes, dict) else {}
                    if ch.get('product_id') == pid or str(ch.get('product_id')) == str(pid):
                        n = ch.get('invoice_number')
                        if n:
                            inv_nos.add(n)
            if len(inv_nos) == 1:
                inv_no = inv_nos.pop()
                self.stdout.write(self.style.NOTICE(f'  Inferred invoice_number={inv_no!r} from audit (use --invoice-number to override).'))
            elif len(inv_nos) > 1:
                self.stdout.write(self.style.NOTICE(f'  Multiple invoice numbers in audit: {sorted(inv_nos)} — pass one with --invoice-number'))

        if inv_no:
            self.stdout.write(self.style.WARNING(f'\n=== Invoice + lines for {inv_no!r} ==='))
            inv_qs = Invoice.objects.filter(invoice_number=inv_no).select_related('retailer').order_by('-id')
            inv_count = inv_qs.count()
            inv = inv_qs.first()
            if inv_count > 1:
                self.stdout.write(
                    self.style.WARNING(
                        f'  Multiple invoices found for number {inv_no!r} (count={inv_count}); '
                        f'showing latest id={inv.id}.'
                    )
                )
            if inv:
                self.stdout.write(
                    f'  invoice id={inv.id} retailer={getattr(inv.retailer, "code", None)} '
                    f'status={inv.status} total={inv.total}'
                )
                for ii in inv.items.select_related('product', 'barcode').all():
                    self.stdout.write(
                        f'  line id={ii.id} product_id={ii.product_id} barcode_id={ii.barcode_id} '
                        f'qty={ii.quantity} line_total={ii.line_total}'
                    )
            else:
                self.stdout.write(self.style.ERROR(f'  No invoice with number {inv_no!r}'))

        if do_restore:
            self.stdout.write(self.style.WARNING('\n=== RESTORE (soft-deleted only) ==='))
            if pid:
                try:
                    p = Product.all_objects.get(pk=pid)
                except Product.DoesNotExist:
                    p = None
                if p and p.deleted_at is not None:
                    p.deleted_at = None
                    p.is_active = True
                    p.save(update_fields=['deleted_at', 'is_active'])
                    self.stdout.write(self.style.SUCCESS(f'  Restored product id={pid}'))
                elif p:
                    self.stdout.write('  Product exists and is not soft-deleted.')
            if pid:
                n = Barcode.all_objects.filter(product_id=pid, deleted_at__isnull=False).update(deleted_at=None)
                self.stdout.write(self.style.SUCCESS(f'  Cleared deleted_at on {n} barcode(s) for product_id={pid}'))
        else:
            self.stdout.write(
                self.style.NOTICE(
                    '\nTo clear soft-delete flags, run again with --restore-soft-deleted '
                    '(only if you intend to bring rows back into normal API lists).'
                )
            )

    def _print_log(self, log):
        self.stdout.write(
            f'  {log.created_at} action={log.action} object_id={log.object_id!r} '
            f'object_reference={log.object_reference!r} barcode_field={log.barcode!r}\n'
            f'    changes={log.changes!r}'
        )

    def _audit_barcode_row_hint(self, log):
        """If audit log is for a Barcode row, say whether that PK still exists."""
        oid = log.object_id
        if not oid or oid == 'deleted':
            return
        try:
            bpk = int(oid)
        except (TypeError, ValueError):
            return
        try:
            b = Barcode.all_objects.get(pk=bpk)
        except Barcode.DoesNotExist:
            b = None
        if b:
            self.stdout.write(
                self.style.SUCCESS(
                    f'    -> Barcode row EXISTS id={b.id} barcode={b.barcode!r} tag={b.tag} deleted_at={b.deleted_at!r}'
                )
            )
        else:
            self.stdout.write(
                self.style.ERROR(
                    f'    -> Barcode PK {bpk} NOT in DB (hard-deleted); only the string above can be reused manually.'
                )
            )
