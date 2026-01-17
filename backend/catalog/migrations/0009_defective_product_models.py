# Generated manually for DefectiveProductMoveOut and DefectiveProductItem models

from django.db import migrations, models
import django.db.models.deletion
from decimal import Decimal


class Migration(migrations.Migration):

    dependencies = [
        ('catalog', '0008_alter_barcode_tag'),
        ('locations', '0003_alter_store_shop_type'),
        ('pos', '0006_alter_cart_invoice_type_alter_invoice_invoice_type'),
        ('core', '0002_remove_role_and_permission_models'),
    ]

    operations = [
        migrations.CreateModel(
            name='DefectiveProductMoveOut',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('move_out_number', models.CharField(max_length=100, unique=True)),
                ('reason', models.CharField(choices=[('damaged', 'Damaged'), ('expired', 'Expired'), ('defective', 'Defective'), ('return_to_supplier', 'Return to Supplier'), ('disposal', 'Disposal'), ('other', 'Other')], default='defective', max_length=50)),
                ('notes', models.TextField(blank=True)),
                ('total_loss', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('total_items', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='defective_move_outs', to='core.user')),
                ('invoice', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='defective_move_outs', to='pos.invoice')),
                ('store', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='defective_move_outs', to='locations.store')),
            ],
            options={
                'db_table': 'defective_product_move_outs',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='DefectiveProductItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('purchase_price', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('barcode', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='defective_move_outs', to='catalog.barcode')),
                ('move_out', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='catalog.defectiveproductmoveout')),
                ('product', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='defective_move_out_items', to='catalog.product')),
            ],
            options={
                'db_table': 'defective_product_items',
                'unique_together': {('move_out', 'barcode')},
            },
        ),
    ]

