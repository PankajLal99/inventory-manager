# Generated manually for stock movement audit trail

import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('purchasing', '0008_purchaseitem_shop_quantity_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='PurchaseStockMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('quantity', models.DecimalField(decimal_places=3, max_digits=10)),
                ('direction', models.CharField(choices=[('warehouse_to_shop', 'Warehouse to shop'), ('shop_to_warehouse', 'Shop to warehouse')], max_length=32)),
                ('shop_quantity_before', models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=10)),
                ('warehouse_quantity_before', models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=10)),
                ('shop_quantity_after', models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=10)),
                ('warehouse_quantity_after', models.DecimalField(decimal_places=3, default=Decimal('0.000'), max_digits=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='purchase_stock_movements', to=settings.AUTH_USER_MODEL)),
                ('purchase', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='stock_movements', to='purchasing.purchase')),
                ('purchase_item', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='stock_movements', to='purchasing.purchaseitem')),
            ],
            options={
                'db_table': 'purchase_stock_movements',
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='purchasestockmovement',
            index=models.Index(fields=['purchase', '-created_at'], name='idx_purstockmov_pur_created'),
        ),
    ]
