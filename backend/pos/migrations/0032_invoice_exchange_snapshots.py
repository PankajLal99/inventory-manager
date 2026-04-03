from django.db import migrations, models


def copy_item_snapshots_to_invoice(apps, schema_editor):
    InvoiceItem = apps.get_model('pos', 'InvoiceItem')
    Invoice = apps.get_model('pos', 'Invoice')
    from collections import defaultdict

    by_invoice = defaultdict(list)
    for ii in InvoiceItem.objects.exclude(exchange_snapshot__isnull=True):
        snap = ii.exchange_snapshot
        if not snap:
            continue
        row = dict(snap) if isinstance(snap, dict) else {}
        row['invoice_item_id'] = ii.id
        by_invoice[ii.invoice_id].append(row)

    for inv_id, rows in by_invoice.items():
        try:
            inv = Invoice.objects.get(pk=inv_id)
        except Invoice.DoesNotExist:
            continue
        inv.exchange_snapshots = rows
        inv.save(update_fields=['exchange_snapshots'])


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0031_invoiceitem_exchange_snapshot'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='exchange_snapshots',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.RunPython(copy_item_snapshots_to_invoice, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='invoiceitem',
            name='exchange_snapshot',
        ),
    ]
