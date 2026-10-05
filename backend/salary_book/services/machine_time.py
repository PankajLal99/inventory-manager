"""Apply a one-time machine-clock delta to existing hardware attendance rows."""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction

from backend.salary_book.models import Attendance
from backend.salary_book.services.attendance_evaluator import (
    evaluate_check_in,
    refresh_worked_minutes,
)


def shift_hardware_attendance_times(shift_minutes: int) -> int:
    """
    Shift HARDWARE attendance check-in/out by shift_minutes and refresh late/worked.

    Returns the number of attendance rows updated.
    """
    shift = int(shift_minutes or 0)
    if not shift:
        return 0

    delta = timedelta(minutes=shift)
    updated = 0

    qs = (
        Attendance.objects.filter(attendance_method=Attendance.METHOD_HARDWARE)
        .filter(check_in_time__isnull=False)
        .select_related('employee')
        .order_by('date', 'id')
    )

    with transaction.atomic():
        for attendance in qs:
            if attendance.status in (
                Attendance.STATUS_PAID_LEAVE,
                Attendance.STATUS_UNPAID_LEAVE,
                Attendance.STATUS_HOLIDAY,
            ):
                continue

            new_in = attendance.check_in_time + delta
            new_out = (
                attendance.check_out_time + delta if attendance.check_out_time else None
            )

            # Re-evaluate from PRESENT (or HALF_DAY) so late rules refresh with new times.
            if attendance.status == Attendance.STATUS_HALF_DAY:
                requested = Attendance.STATUS_HALF_DAY
            else:
                requested = Attendance.STATUS_PRESENT

            evaluation = evaluate_check_in(
                attendance.employee,
                attendance.date,
                requested,
                new_in,
            )
            attendance.check_in_time = new_in
            attendance.check_out_time = new_out
            attendance.status = evaluation.status
            attendance.minutes_late = evaluation.minutes_late
            attendance.is_late = evaluation.is_late
            attendance.rule_penalty_applied = evaluation.rule_penalty_applied
            attendance.rule_remarks = evaluation.rule_remarks
            attendance.worked_minutes = evaluation.worked_minutes
            attendance.payable_minutes = evaluation.payable_minutes
            if new_out:
                refresh_worked_minutes(attendance)
            attendance.save(
                update_fields=[
                    'check_in_time',
                    'check_out_time',
                    'status',
                    'minutes_late',
                    'is_late',
                    'rule_penalty_applied',
                    'rule_remarks',
                    'worked_minutes',
                    'payable_minutes',
                    'updated_at',
                ]
            )
            updated += 1

    return updated
