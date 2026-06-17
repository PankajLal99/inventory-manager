from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0037_cart_and_invoice_scanned_at'),
    ]

    operations = [
        migrations.CreateModel(
            name='InvoiceTag',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=50, unique=True)),
                ('color', models.CharField(default='#3B82F6', help_text='Hex color, e.g. #3B82F6', max_length=7)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'db_table': 'invoice_tags',
                'ordering': ['name'],
            },
        ),
        migrations.AddField(
            model_name='invoice',
            name='tags',
            field=models.ManyToManyField(blank=True, related_name='invoices', to='pos.invoicetag'),
        ),
    ]
