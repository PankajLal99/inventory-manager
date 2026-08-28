from django.db import migrations


def seed(apps, schema_editor):
    Group = apps.get_model('auth', 'Group')
    Group.objects.get_or_create(name='SalaryBook')
    SalaryBookSettings = apps.get_model('salary_book', 'SalaryBookSettings')
    SalaryBookSettings.objects.get_or_create(
        pk=1,
        defaults={
            'salary_calculation_method': 'CALENDAR_DAYS',
            'fixed_working_days': 26,
            'max_gps_accuracy_meters': 100,
            'require_gps': True,
            'require_photo': True,
            'require_checkout_gps_photo': True,
        },
    )


def unseed(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0001_initial'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
