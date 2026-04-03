from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0030_invoice_pos_trade_ins'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoiceitem',
            name='exchange_snapshot',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
