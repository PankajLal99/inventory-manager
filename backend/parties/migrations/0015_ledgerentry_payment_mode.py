from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('parties', '0014_paymentreminder_settlement_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='ledgerentry',
            name='payment_mode',
            field=models.CharField(
                choices=[('cash', 'Cash'), ('upi', 'UPI'), ('other', 'Other')],
                default='other',
                max_length=20,
            ),
        ),
    ]
