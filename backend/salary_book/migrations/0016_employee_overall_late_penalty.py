from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0015_cycle_day_allow_31_and_backfill'),
    ]

    operations = [
        migrations.AddField(
            model_name='employee',
            name='overall_late_penalty_enabled',
            field=models.BooleanField(
                default=False,
                help_text='When on, 5 late days in the salary cycle deduct half a day, and 6 or more deduct one full day.',
            ),
        ),
    ]
