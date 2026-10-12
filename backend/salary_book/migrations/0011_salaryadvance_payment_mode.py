from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0010_mtshop_salary_advances'),
    ]

    operations = [
        migrations.AddField(
            model_name='salaryadvance',
            name='payment_mode',
            field=models.CharField(
                blank=True,
                choices=[('CASH', 'Cash'), ('UPI', 'UPI')],
                default='',
                max_length=16,
            ),
        ),
    ]
