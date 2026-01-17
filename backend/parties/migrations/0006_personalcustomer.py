# Generated manually
import django.db.models.deletion
from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('parties', '0005_personalledgerentry'),
    ]

    operations = [
        migrations.CreateModel(
            name='PersonalCustomer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('phone', models.CharField(blank=True, max_length=20, null=True)),
                ('email', models.EmailField(blank=True, max_length=254)),
                ('address', models.TextField(blank=True)),
                ('credit_balance', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'personal_customers',
                'ordering': ['name'],
            },
        ),
        migrations.AlterField(
            model_name='personalledgerentry',
            name='customer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='personal_ledger_entries', to='parties.personalcustomer'),
        ),
    ]

