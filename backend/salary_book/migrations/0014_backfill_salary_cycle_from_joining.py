from django.db import migrations


def backfill_cycle_from_joining(apps, schema_editor):
    Employee = apps.get_model('salary_book', 'Employee')
    for emp in Employee.objects.all().iterator():
        join = emp.date_of_joining
        current = emp.salary_cycle_start_day or 1
        if not join or current != 1:
            continue
        day = min(28, max(1, join.day))
        if day == 1:
            continue
        emp.salary_cycle_start_day = day
        emp.save(update_fields=['salary_cycle_start_day'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0013_employee_check_in_buffer_minutes'),
    ]

    operations = [
        migrations.RunPython(backfill_cycle_from_joining, noop_reverse),
    ]
