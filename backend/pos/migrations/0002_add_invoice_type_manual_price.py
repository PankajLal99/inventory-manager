# Generated manually
from django.db import migrations, models
from decimal import Decimal


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='cart',
            name='invoice_type',
            field=models.CharField(choices=[('credit', 'Credit Invoice'), ('pending', 'Pending Invoice'), ('sale', 'Sale Invoice')], default='sale', max_length=20),
        ),
        migrations.AddField(
            model_name='cartitem',
            name='manual_unit_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='invoice',
            name='invoice_type',
            field=models.CharField(choices=[('credit', 'Credit Invoice'), ('pending', 'Pending Invoice'), ('sale', 'Sale Invoice')], default='sale', max_length=20),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='manual_unit_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
    ]

