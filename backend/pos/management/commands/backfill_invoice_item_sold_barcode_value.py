"""
Populate InvoiceItem.sold_barcode_value from the linked catalog Barcode row.

The pos.0034 migration already runs this once when applied. Use this command to:
  - Re-fill after manual DB fixes or restores
  - Catch rows created before checkout started writing sold_barcode_value (if any)
  - Refresh empty snapshots where barcode_id still points at a row

Dry-run by default; pass --apply to update. On PostgreSQL, --sql uses a single UPDATE (fastest).
"""

from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Q

from backend.catalog.models import Barcode
from backend.pos.models import InvoiceItem


class Command(BaseCommand):
    help = (
        'Backfill invoice_items.sold_barcode_value from barcodes.barcode where FK is set '
        'and the snapshot is empty. Dry-run unless --apply. See migration pos.0034 for the '
        'initial one-time backfill.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Persist updates (default is dry-run: counts only).',
        )
        parser.add_argument(
            '--sql',
            action='store_true',
            help=(
                'Use one SQL UPDATE (PostgreSQL only). Fastest for large tables. '
                'Ignored on other databases (falls back to batched ORM).'
            ),
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=1000,
            help='ORM mode: invoice items per batch (default 1000).',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        use_sql = options['sql']
        batch_size = max(1, int(options['batch_size']))

        empty_q = Q(sold_barcode_value='') | Q(sold_barcode_value__isnull=True)
        base_qs = InvoiceItem.objects.filter(barcode_id__isnull=False).filter(empty_q)

        total_candidates = base_qs.count()
        self.stdout.write(
            self.style.NOTICE(
                f'Invoice lines with barcode_id set and empty sold_barcode_value: {total_candidates}\n'
                f'Mode: {"APPLY" if apply_changes else "DRY-RUN"}\n'
            )
        )

        if total_candidates == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to do.'))
            return

        if not apply_changes:
            self.stdout.write(self.style.WARNING('No rows updated (dry-run). Pass --apply to write.'))
            return

        if use_sql and connection.vendor == 'postgresql':
            n = self._postgresql_bulk_update()
            self.stdout.write(self.style.SUCCESS(f'Updated {n} invoice item(s) (single SQL UPDATE).'))
            return

        if use_sql and connection.vendor != 'postgresql':
            self.stdout.write(
                self.style.WARNING('--sql is only supported on PostgreSQL; using batched ORM instead.')
            )

        updated = self._orm_batched(batch_size)
        self.stdout.write(self.style.SUCCESS(f'Updated {updated} invoice item(s) (ORM batches).'))

    def _postgresql_bulk_update(self) -> int:
        # barcodes.deleted_at: include soft-deleted rows so snapshot still matches historical FK
        sql = """
            UPDATE invoice_items AS ii
            SET sold_barcode_value = LEFT(TRIM(b.barcode), 100)
            FROM barcodes AS b
            WHERE ii.barcode_id = b.id
              AND (ii.sold_barcode_value = '' OR ii.sold_barcode_value IS NULL)
              AND TRIM(COALESCE(b.barcode, '')) <> ''
        """
        with connection.cursor() as cursor:
            cursor.execute(sql)
            return cursor.rowcount if cursor.rowcount is not None else 0

    def _orm_batched(self, batch_size: int) -> int:
        empty_q = Q(sold_barcode_value='') | Q(sold_barcode_value__isnull=True)
        qs = (
            InvoiceItem.objects.filter(barcode_id__isnull=False)
            .filter(empty_q)
            .order_by('pk')
        )
        updated_total = 0
        last_pk = 0

        while True:
            batch = list(qs.filter(pk__gt=last_pk)[:batch_size])
            if not batch:
                break
            last_pk = batch[-1].pk

            barcode_ids = {item.barcode_id for item in batch}
            bars = {
                b.pk: b
                for b in Barcode.all_objects.filter(pk__in=barcode_ids).only('pk', 'barcode')
            }

            to_save = []
            for item in batch:
                b = bars.get(item.barcode_id)
                if not b:
                    continue
                val = (b.barcode or '').strip()[:100]
                if not val:
                    continue
                item.sold_barcode_value = val
                to_save.append(item)

            if to_save:
                InvoiceItem.objects.bulk_update(to_save, ['sold_barcode_value'], batch_size=batch_size)
                updated_total += len(to_save)

        return updated_total
