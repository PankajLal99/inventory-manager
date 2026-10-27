from django.db import migrations


def repair_pairs(apps, schema_editor):
    # Import live service so pairing matches current ATTENDANCE_MIN_CHECKOUT_MINUTES.
    # Use the historical settings row: later salary-book columns are not created yet.
    from backend.attendance.services.attendance import repair_hardware_attendance
    from backend.salary_book.models import SalaryBookSettings

    Historical = apps.get_model('salary_book', 'SalaryBookSettings')

    class _Settings:
        def __init__(self, row):
            self.attendance_capture_mode = row.attendance_capture_mode
            self.require_gps = row.require_gps
            self.machine_time_delta_minutes = getattr(row, 'machine_time_delta_minutes', 0)

        def apply_machine_time_delta(self, punch_datetime):
            return SalaryBookSettings.apply_machine_time_delta(self, punch_datetime)

    def get_solo():
        row = Historical.objects.filter(pk=1).first()
        if row is None:
            row = Historical.objects.create(pk=1)
        return _Settings(row)

    original = SalaryBookSettings.get_solo
    SalaryBookSettings.get_solo = staticmethod(get_solo)
    try:
        stats = repair_hardware_attendance(dry_run=False)
    finally:
        SalaryBookSettings.get_solo = original
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
