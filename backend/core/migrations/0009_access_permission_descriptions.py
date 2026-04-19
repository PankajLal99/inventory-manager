from django.db import migrations, models


DESCRIPTIONS = {
    'nav.pos': 'Show POS billing page in sidebar and allow POS flows.',
    'nav.repair_register': 'Show repair registration page and related create flow.',
    'nav.search': 'Show global search page for products, barcodes, and invoices.',
    'nav.dashboard': 'Show dashboard page with KPI blocks and summaries.',
    'nav.invoices': 'Show invoices list/detail pages.',
    'nav.credit_notes': 'Show credit notes listing and credit note actions.',
    'nav.customers': 'Show customers page and customer management section.',
    'nav.replacement': 'Show replacement workflows/pages.',
    'nav.repairs': 'Show repairs listing and repair status workflows.',
    'nav.products': 'Show products page and product management area.',
    'nav.stock_overview': 'Show stock overview page.',
    'nav.stock_transfers': 'Show stock transfer page and transfer history.',
    'nav.purchases': 'Show purchases page and purchase workflows.',
    'nav.ledger': 'Show main ledger page.',
    'nav.personal_ledger': 'Show personal ledger page.',
    'nav.internal_ledger': 'Show internal/shop ledger page.',
    'nav.payment_reminders': 'Show payment reminders page.',
    'nav.expenses': 'Show expenses page.',
    'nav.payments': 'Show payments page.',
    'nav.active_carts': 'Show active carts overview page.',
    'nav.vendors': 'Show vendors page.',
    'nav.reports': 'Show reports page.',
    'nav.history': 'Show history/audit trail page.',
    'feature.super_metrics': 'Enable super-only totals/metrics blocks on pages.',
    'feature.pos_admin': 'Enable POS admin lane behavior (global admin context).',
    'feature.pos_retail_lane': 'Enable POS retail lane behavior (retail store selector behavior).',
    'feature.pos_wholesale': 'Enable POS wholesale lane behavior.',
    'feature.pos_wholesale_admin': 'Enable POS wholesale-admin lane behavior.',
    'feature.invoice_admin_stores': 'Invoices page: allow admin store controls / all-store behavior.',
    'feature.invoice_restricted': 'Invoice detail: apply restricted retail/wholesale editing rules.',
    'feature.invoice_hide_cash_checkout': 'Hide cash/UPI checkout options in invoice checkout UI.',
    'feature.retail_catalog_restricted': 'Restrict catalog actions for retail-only users (for example hide delete).',
    'feature.ledger_admin': 'Enable ledger admin lane behavior.',
    'feature.store_management': 'Allow store management admin controls.',
    'feature.payments_extended_columns': 'Show extended columns on payments page.',
    'feature.discard_invoice_edit_carts': 'Allow discard of invoice-edit carts in active carts page.',
}


def populate_descriptions(apps, schema_editor):
    AP = apps.get_model('core', 'AccessPermission')
    for codename, description in DESCRIPTIONS.items():
        AP.objects.filter(codename=codename).update(description=description)
    AP.objects.filter(description='').update(description=models.F('label'))


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0008_feature_access_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='accesspermission',
            name='description',
            field=models.TextField(blank=True),
        ),
        migrations.RunPython(populate_descriptions, migrations.RunPython.noop),
    ]
from django.db import migrations, models


DESCRIPTIONS = {
    # Navigation permissions
    'nav.pos': 'Show POS billing page in sidebar and allow POS flows.',
    'nav.repair_register': 'Show repair registration page and related create flow.',
    'nav.search': 'Show global search page for products, barcodes, and invoices.',
    'nav.dashboard': 'Show dashboard page with KPI blocks and summaries.',
    'nav.invoices': 'Show invoices list/detail pages.',
    'nav.credit_notes': 'Show credit notes listing and credit note actions.',
    'nav.customers': 'Show customers page and customer management section.',
    'nav.replacement': 'Show replacement workflows/pages.',
    'nav.repairs': 'Show repairs listing and repair status workflows.',
    'nav.products': 'Show products page and product management area.',
    'nav.stock_overview': 'Show stock overview page.',
    'nav.stock_transfers': 'Show stock transfer page and transfer history.',
    'nav.purchases': 'Show purchases page and purchase workflows.',
    'nav.ledger': 'Show main ledger page.',
    'nav.personal_ledger': 'Show personal ledger page.',
    'nav.internal_ledger': 'Show internal/shop ledger page.',
    'nav.payment_reminders': 'Show payment reminders page.',
    'nav.expenses': 'Show expenses page.',
    'nav.payments': 'Show payments page.',
    'nav.active_carts': 'Show active carts overview page.',
    'nav.vendors': 'Show vendors page.',
    'nav.reports': 'Show reports page.',
    'nav.history': 'Show history/audit trail page.',
    # Feature permissions
    'feature.super_metrics': 'Enable super-only totals/metrics blocks on pages.',
    'feature.pos_admin': 'Enable POS admin lane behavior (global admin context).',
    'feature.pos_retail_lane': 'Enable POS retail lane behavior (retail store selector behavior).',
    'feature.pos_wholesale': 'Enable POS wholesale lane behavior.',
    'feature.pos_wholesale_admin': 'Enable POS wholesale-admin lane behavior.',
    'feature.invoice_admin_stores': 'Invoices page: allow admin store controls / all-store behavior.',
    'feature.invoice_restricted': 'Invoice detail: apply restricted retail/wholesale editing rules.',
    'feature.invoice_hide_cash_checkout': 'Hide cash/UPI checkout options in invoice checkout UI.',
    'feature.retail_catalog_restricted': 'Restrict catalog actions for retail-only users (for example hide delete).',
    'feature.ledger_admin': 'Enable ledger admin lane behavior.',
    'feature.store_management': 'Allow store management admin controls.',
    'feature.payments_extended_columns': 'Show extended columns on payments page.',
    'feature.discard_invoice_edit_carts': 'Allow discard of invoice-edit carts in active carts page.',
}


def populate_descriptions(apps, schema_editor):
    AP = apps.get_model('core', 'AccessPermission')
    for codename, description in DESCRIPTIONS.items():
        AP.objects.filter(codename=codename).update(description=description)
    # Provide a sensible default for any missing codename.
    AP.objects.filter(description='').update(description=models.F('label'))


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0008_feature_access_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='accesspermission',
            name='description',
            field=models.TextField(blank=True),
        ),
        migrations.RunPython(populate_descriptions, migrations.RunPython.noop),
    ]

