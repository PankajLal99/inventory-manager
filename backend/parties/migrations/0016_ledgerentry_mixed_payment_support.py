from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('parties', '0015_ledgerentry_payment_mode'),
    ]

    operations = [
        migrations.AlterField(
            model_name='ledgerentry',
            name='payment_mode',
            field=models.CharField(
                choices=[
                    ('cash', 'Cash'),
                    ('upi', 'UPI'),
                    ('mixed', 'Mixed (Cash + UPI)'),
                    ('other', 'Other'),
                ],
                default='other',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='ledgerentry',
            name='cash_amount',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='ledgerentry',
            name='upi_amount',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
    ]
