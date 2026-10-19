from django.db import migrations, models
from django.core.validators import MaxValueValidator, MinValueValidator


def backfill_late_month_cycle_days(apps, schema_editor):
    """Employees who joined on 29–31 were clamped to cycle day 28; restore the real day."""
    Employee = apps.get_model('salary_book', 'Employee')
    for emp in Employee.objects.all().iterator():
        join = emp.date_of_joining
        if not join:
            continue
        join_day = max(1, min(31, int(join.day)))
        if join_day <= 28:
            continue
        # Only rewrite if still on the old 28-day clamp (not a custom cycle like 1).
        if int(emp.salary_cycle_start_day or 1) == 28:
            emp.salary_cycle_start_day = join_day
            emp.save(update_fields=['salary_cycle_start_day'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0014_backfill_salary_cycle_from_joining'),
    ]

    operations = [
        migrations.AlterField(
            model_name='employee',
            name='salary_cycle_start_day',
            field=models.PositiveSmallIntegerField(
                default=1,
                help_text=(
                    'Salary cycle start/end day (1–31). Example: 30 means 30th → next 30th '
                    '(Feb uses last day).'
                ),
                validators=[MinValueValidator(1), MaxValueValidator(31)],
            ),
        ),
        migrations.RunPython(backfill_late_month_cycle_days, noop_reverse),
    ]
