from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0036_replacement_pos_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='cartitem',
            name='barcode_scanned_at',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='cartitem',
            name='scanned_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='scanned_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
