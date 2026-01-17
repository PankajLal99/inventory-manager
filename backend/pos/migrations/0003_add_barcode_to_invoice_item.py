# Generated manually
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0002_add_invoice_type_manual_price'),
        ('catalog', '0004_add_barcode_tag'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoiceitem',
            name='barcode',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='invoice_items', to='catalog.barcode'),
        ),
    ]

