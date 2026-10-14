from django.core.validators import MinValueValidator
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0011_salaryadvance_payment_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='salary_cycle_start_day',
            field=models.PositiveSmallIntegerField(
                default=1,
                help_text='Salary cycle start/end day (1–28). Example: 9 means 9th → next 9th.',
                validators=[MinValueValidator(1)],
            ),
        ),
    ]
