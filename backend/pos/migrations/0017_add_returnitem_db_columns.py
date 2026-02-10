# RCA: Migration 0015 only updated Django state (SeparateDatabaseAndState); it did not
# run any ALTER TABLE. So on a fresh DB, return_items is missing barcode_id, product_id,
# product_name, product_sku, variant_id, and invoice_item_id was never set nullable.
# This migration adds those columns in the database only (state already correct from 0015).
#
# Production-safe: additive only. No existing rows are updated or deleted. New columns
# are NULL/default for existing data. Idempotent: safe on prod (with or without columns).

from django.db import migrations, connection


def _column_exists(cursor, table, column):
    cursor.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        """,
        [table, column],
    )
    return cursor.fetchone() is not None


def add_returnitem_columns_if_missing(apps, schema_editor):
    with connection.cursor() as cursor:
        table = "return_items"
        if connection.vendor == "postgresql":
            # Catalog app uses db_table: barcodes, products, product_variants (no catalog_ prefix)
            if not _column_exists(cursor, table, "barcode_id"):
                cursor.execute(
                    "ALTER TABLE return_items ADD COLUMN barcode_id bigint NULL REFERENCES barcodes(id) ON DELETE SET NULL;"
                )
            if not _column_exists(cursor, table, "product_id"):
                cursor.execute(
                    "ALTER TABLE return_items ADD COLUMN product_id bigint NULL REFERENCES products(id) ON DELETE CASCADE;"
                )
            if not _column_exists(cursor, table, "product_name"):
                cursor.execute(
                    "ALTER TABLE return_items ADD COLUMN product_name varchar(255) NOT NULL DEFAULT '';"
                )
            if not _column_exists(cursor, table, "product_sku"):
                cursor.execute(
                    "ALTER TABLE return_items ADD COLUMN product_sku varchar(100) NOT NULL DEFAULT '';"
                )
            if not _column_exists(cursor, table, "variant_id"):
                cursor.execute(
                    "ALTER TABLE return_items ADD COLUMN variant_id bigint NULL REFERENCES product_variants(id) ON DELETE SET NULL;"
                )
            # Allow invoice_item_id to be NULL (idempotent: only if currently NOT NULL)
            cursor.execute(
                """
                SELECT is_nullable FROM information_schema.columns
                WHERE table_name = 'return_items' AND column_name = 'invoice_item_id'
                """
            )
            row = cursor.fetchone()
            if row and row[0] == "NO":
                cursor.execute(
                    "ALTER TABLE return_items ALTER COLUMN invoice_item_id DROP NOT NULL;"
                )
        else:
            # SQLite / other: add columns only if missing (try SELECT to detect)
            for col, sql in [
                ("barcode_id", "ALTER TABLE return_items ADD COLUMN barcode_id integer NULL"),
                ("product_id", "ALTER TABLE return_items ADD COLUMN product_id integer NULL"),
                ("product_name", "ALTER TABLE return_items ADD COLUMN product_name varchar(255) DEFAULT ''"),
                ("product_sku", "ALTER TABLE return_items ADD COLUMN product_sku varchar(100) DEFAULT ''"),
                ("variant_id", "ALTER TABLE return_items ADD COLUMN variant_id integer NULL"),
            ]:
                try:
                    cursor.execute(f"SELECT {col} FROM return_items LIMIT 0")
                except Exception:
                    cursor.execute(sql)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0016_creditnote_quantity"),
    ]

    operations = [
        migrations.RunPython(add_returnitem_columns_if_missing, noop),
    ]
