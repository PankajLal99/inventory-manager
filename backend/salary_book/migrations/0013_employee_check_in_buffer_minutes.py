from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0012_employee_salary_cycle_start_day'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='check_in_buffer_minutes',
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text='Grace minutes after expected check-in. Example: 10 AM + 10 min buffer → on time until 10:10.',
            ),
        ),
    ]
