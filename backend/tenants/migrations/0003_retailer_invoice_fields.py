from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('tenants', '0002_retailer_azure_blob_folder'),
    ]

    operations = [
        migrations.AddField(
            model_name='retailer',
            name='retailer_name_extra',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Secondary / trade name printed on invoices (e.g. "Manish Traders").',
                max_length=200,
            ),
        ),
        migrations.AddField(
            model_name='retailer',
            name='shop_address',
            field=models.TextField(
                blank=True,
                default='',
                help_text='Shop address printed on A4 invoices. Separate lines with newline.',
            ),
        ),
    ]
