from django.db import migrations


def repair_pairs(apps, schema_editor):
    # Import live service so pairing matches current ATTENDANCE_MIN_CHECKOUT_MINUTES.
    from backend.attendance.services.attendance import repair_hardware_attendance

    stats = repair_hardware_attendance(dry_run=False)
    print(
        'repair_hardware_attendance: '
        f'scanned={stats["scanned"]} updated={stats["updated"]} '
        f'unchanged={stats["unchanged"]} skipped_protected={stats["skipped_protected"]} '
        f'skipped_manual={stats["skipped_manual"]} no_punches={stats["no_punches"]}'
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('attendance', '0003_alter_attendanceevent_options_alter_device_options_and_more'),
        ('salary_book', '0010_mtshop_salary_advances'),
    ]

    operations = [
        migrations.RunPython(repair_pairs, noop_reverse),
    ]
