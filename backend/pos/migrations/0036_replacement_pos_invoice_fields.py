from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0035_multitenant_phase1'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='is_replacement_return',
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name='invoice',
            name='replacement_customer_warning',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='invoice',
            name='replacement_mode',
            field=models.CharField(blank=True, choices=[('', 'None'), ('instant', 'Instant'), ('pending', 'Pending')], default='', max_length=20),
        ),
        migrations.AddField(
            model_name='invoice',
            name='replacement_source_customers',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='accepted_return_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='original_customer_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='original_invoice',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='replacement_child_items', to='pos.invoice'),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='original_invoice_item',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='replacement_return_items', to='pos.invoiceitem'),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='original_invoice_number',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='original_sold_line_total',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='original_sold_unit_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='invoiceitem',
            name='replacement_return_tag',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
    ]
