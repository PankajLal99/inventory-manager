from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from backend.salary_book.models import Attendance, Employee, SalaryBookSettings

TWO = Decimal('0.01')
FOUR = Decimal('0.0001')
ZERO = Decimal('0')


def _q(value, places=TWO):
    return Decimal(value).quantize(places, rounding=ROUND_HALF_UP)


def effective_schedule(employee: Employee, settings_obj: SalaryBookSettings | None = None):
    cin = employee.expected_check_in
    cout = employee.expected_check_out
    if cin and cout:
        return cin, cout
    settings_obj = settings_obj or SalaryBookSettings.get_solo()
    return settings_obj.default_check_in, settings_obj.default_check_out


def scheduled_minutes(employee: Employee, settings_obj: SalaryBookSettings | None = None) -> int:
    cin, cout = effective_schedule(employee, settings_obj)
    start = datetime.combine(date.min, cin)
    end = datetime.combine(date.min, cout)
    delta = end - start
    return max(0, int(delta.total_seconds() // 60))


def scheduled_hours(employee: Employee, settings_obj: SalaryBookSettings | None = None) -> Decimal:
    minutes = scheduled_minutes(employee, settings_obj)
    if minutes <= 0:
        return ZERO
    return _q(Decimal(minutes) / Decimal(60), TWO)


def combine_local(day: date, clock: time):
    naive = datetime.combine(day, clock)
    tz = timezone.get_current_timezone()
    if timezone.is_naive(naive):
        return timezone.make_aware(naive, tz)
    return timezone.localtime(naive, tz)


def minutes_late_at(check_in, employee: Employee, att_date: date, settings_obj=None) -> int:
    if not check_in:
        return 0
    cin, _ = effective_schedule(employee, settings_obj)
    expected = combine_local(att_date, cin)
    actual = check_in
    if timezone.is_naive(actual):
        actual = timezone.make_aware(actual, timezone.get_current_timezone())
    delta = (timezone.localtime(actual) - timezone.localtime(expected)).total_seconds()
    return max(0, int(delta // 60))


def worked_minutes(attendance: Attendance, employee: Employee, settings_obj=None) -> int:
    scheduled = scheduled_minutes(employee, settings_obj)
    cin, cout = effective_schedule(employee, settings_obj)
    if attendance.check_in_time and attendance.check_out_time:
        delta = (attendance.check_out_time - attendance.check_in_time).total_seconds()
        return max(0, int(delta // 60))
    if attendance.check_in_time:
        expected_out = combine_local(attendance.date, cout)
        actual_in = attendance.check_in_time
        if timezone.is_naive(actual_in):
            actual_in = timezone.make_aware(actual_in, timezone.get_current_timezone())
        delta = (expected_out - actual_in).total_seconds()
        return max(0, min(scheduled, int(delta // 60)))
    if attendance.status in Attendance.PHOTO_STATUSES:
        return scheduled
    return 0


def payable_minutes(worked: int, employee: Employee, settings_obj=None) -> int:
    scheduled = scheduled_minutes(employee, settings_obj)
    if scheduled <= 0:
        return 0
    return min(max(0, worked), scheduled)


def hours_from_minutes(minutes: int) -> Decimal:
    return _q(Decimal(minutes) / Decimal(60), TWO)
