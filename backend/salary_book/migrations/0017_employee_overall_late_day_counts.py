from django.db import migrations, models
from django.core.validators import MaxValueValidator, MinValueValidator


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0016_employee_overall_late_penalty'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='overall_late_half_days',
            field=models.PositiveSmallIntegerField(
                default=5,
                help_text='Late days in the cycle that deduct half a day salary.',
                validators=[MinValueValidator(1), MaxValueValidator(31)],
            ),
        ),
        migrations.AddField(
            model_name='employee',
            name='overall_late_full_days',
            field=models.PositiveSmallIntegerField(
                default=6,
                help_text='Late days in the cycle that deduct one full day salary. Must be higher than the half-day count.',
                validators=[MinValueValidator(2), MaxValueValidator(31)],
            ),
        ),
    ]
