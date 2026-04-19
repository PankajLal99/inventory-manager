# Seed feature.* AccessPermission rows for page-level gates

from django.db import migrations


FEATURE_PERMISSION_SEED = [
    ('feature.super_metrics', 'Super-only metrics & listings', 'feature'),
    ('feature.pos_admin', 'POS / repair global admin lane', 'feature'),
    ('feature.pos_retail_lane', 'POS retail lane (store selector)', 'feature'),
    ('feature.pos_wholesale', 'POS wholesale lane', 'feature'),
    ('feature.pos_wholesale_admin', 'POS wholesale admin (store selector)', 'feature'),
    ('feature.invoice_admin_stores', 'Invoices: all stores / admin store UI', 'feature'),
    ('feature.invoice_restricted', 'Invoice detail: restricted retail/wholesale editor', 'feature'),
    ('feature.invoice_hide_cash_checkout', 'Hide cash/UPI checkout options (wholesale)', 'feature'),
    ('feature.retail_catalog_restricted', 'Products/purchases: retail-only restrictions', 'feature'),
    ('feature.ledger_admin', 'Ledger: admin lane (substring Admin in group)', 'feature'),
    ('feature.store_management', 'Stores CRUD: admin / store admins', 'feature'),
    ('feature.payments_extended_columns', 'Payments: extended columns (non-Retail group)', 'feature'),
    ('feature.discard_invoice_edit_carts', 'Active carts: discard EDIT-* carts', 'feature'),
]


def seed_feature_permissions(apps, schema_editor):
    AP = apps.get_model('core', 'AccessPermission')
    for codename, label, category in FEATURE_PERMISSION_SEED:
        AP.objects.get_or_create(
            codename=codename,
            defaults={'label': label, 'category': category},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_access_roles_and_permissions'),
    ]

    operations = [
        migrations.RunPython(seed_feature_permissions, migrations.RunPython.noop),
    ]
