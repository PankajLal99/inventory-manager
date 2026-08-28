from dataclasses import dataclass
from datetime import date, datetime

from backend.salary_book.models import Attendance, Employee, EmployeeAttendanceRule
from backend.salary_book.services.schedule_utils import (
    minutes_late_at,
    payable_minutes,
    scheduled_minutes,
    worked_minutes,
)


@dataclass
class CheckInEvaluation:
    status: str
    minutes_late: int
    is_late: bool
    worked_minutes: int
    payable_minutes: int
    rule_penalty_applied: bool
    rule_remarks: str


def _late_threshold(employee: Employee) -> int | None:
    thresholds = list(
        employee.attendance_rules.filter(
            is_active=True,
            rule_type=EmployeeAttendanceRule.TYPE_CONSECUTIVE_LATE,
        ).values_list('late_threshold_minutes', flat=True)
    )
    if not thresholds:
        return None
    return min(thresholds)


def consecutive_late_streak(
    employee: Employee,
    before_date: date,
    threshold_minutes: int,
) -> int:
    """Count consecutive attended days immediately before `before_date` that were late."""
    streak = 0
    cursor = before_date
    while True:
        cursor = cursor.fromordinal(cursor.toordinal() - 1)
        row = Attendance.objects.filter(employee=employee, date=cursor).first()
        if not row:
            break
        if row.status not in Attendance.PHOTO_STATUSES:
            break
        late = row.minutes_late
        if row.check_in_time and late == 0:
            late = minutes_late_at(row.check_in_time, employee, row.date)
        if late >= threshold_minutes:
            streak += 1
            continue
        break
    return streak


def evaluate_manual_attendance(
    employee: Employee,
    att_date: date,
    requested_status: str,
) -> CheckInEvaluation:
    """Admin backfill: no late rules, no automatic check-in times."""
    stub = Attendance(
        employee=employee,
        date=att_date,
        status=requested_status,
        check_in_time=None,
        check_out_time=None,
    )
    worked = worked_minutes(stub, employee) if requested_status in Attendance.PHOTO_STATUSES else 0
    payable = payable_minutes(worked, employee) if requested_status in Attendance.PHOTO_STATUSES else 0
    return CheckInEvaluation(
        status=requested_status,
        minutes_late=0,
        is_late=False,
        worked_minutes=worked,
        payable_minutes=payable,
        rule_penalty_applied=False,
        rule_remarks='',
    )


def evaluate_check_in(
    employee: Employee,
    att_date: date,
    requested_status: str,
    check_in: datetime | None,
) -> CheckInEvaluation:
    scheduled = scheduled_minutes(employee)
    late = minutes_late_at(check_in, employee, att_date) if check_in else 0
    threshold = _late_threshold(employee)
    is_late = late >= threshold if threshold is not None else late > 0

    stub = Attendance(
        employee=employee,
        date=att_date,
        status=requested_status,
        check_in_time=check_in,
        check_out_time=None,
    )
    worked = worked_minutes(stub, employee) if requested_status in Attendance.PHOTO_STATUSES else 0
    payable = payable_minutes(worked, employee) if requested_status in Attendance.PHOTO_STATUSES else 0

    result = CheckInEvaluation(
        status=requested_status,
        minutes_late=late,
        is_late=is_late,
        worked_minutes=worked,
        payable_minutes=payable,
        rule_penalty_applied=False,
        rule_remarks='',
    )

    if requested_status not in Attendance.PHOTO_STATUSES:
        return result

    rules = employee.attendance_rules.filter(
        is_active=True,
        rule_type=EmployeeAttendanceRule.TYPE_CONSECUTIVE_LATE,
    )
    for rule in rules:
        streak = consecutive_late_streak(employee, att_date, rule.late_threshold_minutes)
        if streak >= rule.consecutive_late_days:
            result.status = Attendance.STATUS_ABSENT
            result.rule_penalty_applied = True
            result.rule_remarks = (
                f'Consecutive late penalty ({rule.consecutive_late_days} days × '
                f'{rule.late_threshold_minutes} min)'
            )
            result.payable_minutes = 0
            break
    return result


def refresh_worked_minutes(attendance: Attendance) -> Attendance:
    """Recompute worked/payable minutes after check-out. Leaves penalty days unpaid."""
    if attendance.rule_penalty_applied or attendance.status not in Attendance.PHOTO_STATUSES:
        attendance.worked_minutes = worked_minutes(attendance, attendance.employee)
        attendance.payable_minutes = 0 if attendance.rule_penalty_applied else payable_minutes(
            attendance.worked_minutes, attendance.employee
        )
        return attendance
    attendance.worked_minutes = worked_minutes(attendance, attendance.employee)
    attendance.payable_minutes = payable_minutes(attendance.worked_minutes, attendance.employee)
    return attendance
