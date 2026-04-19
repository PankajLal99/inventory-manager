"""
One-time: rewrite AuditLog.barcode and barcode-like keys in changes JSON to Barcode.audit_display_label().

Run when ready (can be slow on large tables):

  python manage.py backfill_audit_log_short_codes --apply

Dry-run (default) only prints how many rows would be updated.
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from backend.catalog.models import Barcode
from backend.core.models import AuditLog

BARCODE_KEYS = frozenset({
    'barcode',
    'barcode_added',
    'barcodes',
    'scanned_barcode',
    'scanned_barcodes',
    'removed_barcode',
    'old_barcode',
    'new_barcode',
    'sold_barcode_value',
})


def _resolve_str(value):
    if not value or not isinstance(value, str):
        return value
    t = value.strip()
    if not t:
        return value
    row = (
        Barcode.all_objects.filter(Q(barcode__iexact=t) | Q(short_code__iexact=t))
        .only('id', 'short_code', 'barcode')
        .first()
    )
    if row:
        return row.audit_display_label()
    return value


def _resolve_audit_barcode_column(value):
    if not value or not isinstance(value, str):
        return value
    if ',' in value:
        parts = [p.strip() for p in value.split(',') if p.strip()]
        return ', '.join(_resolve_str(p) for p in parts) if parts else value
    return _resolve_str(value)


def _rewrite_changes(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in BARCODE_KEYS and isinstance(v, str):
                out[k] = _resolve_str(v)
            elif k in BARCODE_KEYS and isinstance(v, list):
                out[k] = [
                    _resolve_str(x) if isinstance(x, str) else _rewrite_changes(x) for x in v
                ]
            else:
                out[k] = _rewrite_changes(v)
        return out
    if isinstance(obj, list):
        return [_rewrite_changes(x) for x in obj]
    return obj


class Command(BaseCommand):
    help = 'Backfill audit_logs barcode column and changes JSON to use short_code-style labels'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Persist updates (default is dry-run)')
        parser.add_argument('--batch-size', type=int, default=200)
        parser.add_argument('--limit', type=int, default=0, help='Max rows to scan (0 = all)')

    def handle(self, *args, **options):
        apply = options['apply']
        batch_size = max(1, options['batch_size'])
        limit = max(0, options['limit'] or 0)
        qs = AuditLog.objects.all().order_by('id')
        if limit:
            qs = qs[:limit]
            self.stdout.write(f'AuditLog scan limit: {limit} (apply={apply})')
        else:
            self.stdout.write(f'AuditLog full scan (apply={apply})')

        updated = 0
        batch = []
        for log in qs.iterator(chunk_size=batch_size):
            changed = False
            new_barcode = log.barcode
            if log.barcode:
                resolved = _resolve_audit_barcode_column(log.barcode)
                if resolved != log.barcode:
                    new_barcode = resolved
                    changed = True
            new_changes = log.changes
            if log.changes:
                rewritten = _rewrite_changes(log.changes)
                if rewritten != log.changes:
                    new_changes = rewritten
                    changed = True
            if changed:
                updated += 1
                if apply:
                    log.barcode = new_barcode
                    log.changes = new_changes
                    batch.append(log)
            if apply and len(batch) >= batch_size:
                AuditLog.objects.bulk_update(batch, ['barcode', 'changes'])
                batch.clear()

        if apply and batch:
            AuditLog.objects.bulk_update(batch, ['barcode', 'changes'])

        self.stdout.write(self.style.SUCCESS(f'Rows {"updated" if apply else "to update"}: {updated}'))
