from django.db import migrations, models


def lock_existing_nonzero_delta(apps, schema_editor):
    Settings = apps.get_model('salary_book', 'SalaryBookSettings')
    Settings.objects.exclude(machine_time_delta_minutes=0).update(
        machine_time_delta_locked=True
    )


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0008_salarybooksettings_machine_time_delta_minutes'),
    ]

    operations = [
        migrations.AddField(
            model_name='salarybooksettings',
            name='machine_time_delta_locked',
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(lock_existing_nonzero_delta, migrations.RunPython.noop),
    ]
