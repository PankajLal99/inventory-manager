"""Persist ADMS attendance events and bridge into Salary Book when configured."""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from backend.attendance.models import AttendanceEvent, Device, DeviceUserMapping
from backend.attendance.services.parser import (
    AttLogParseError,
    ParsedAttLog,
    compute_event_hash,
    parse_attlog_body,
)

logger = logging.getLogger('attendance.adms')


PROTECTED_STATUSES = frozenset({
    'PAID_LEAVE',
    'UNPAID_LEAVE',
    'HOLIDAY',
})


def persist_attlog(
    device: Device,
    body: str,
    *,
    source_ip: str | None = None,
) -> tuple[int, int, list[str]]:
    """
    Parse and store ATTLOG lines.

    Returns (created_count, duplicate_count, errors).
    Acknowledges duplicates as success (idempotent).
    """
    created = 0
    duplicates = 0
    errors: list[str] = []

    try:
        records = parse_attlog_body(body)
    except AttLogParseError as exc:
        return 0, 0, [str(exc)]

    if not records:
        return 0, 0, []

    latest_punch = None
    for record in records:
        try:
            event, was_created = _store_event(device, record, source_ip=source_ip)
        except AttLogParseError as exc:
            errors.append(str(exc))
            continue
        except Exception:
            logger.exception(
                'ADMS failed to persist ATTLOG device=%s user=%s',
                device.serial_number,
                record.device_user_id,
            )
            errors.append(f'persist failed for user={record.device_user_id}')
            continue

        if was_created:
            created += 1
            latest_punch = record.punch_datetime
            try:
                bridge_event_to_salary_book(event)
            except Exception:
                logger.exception(
                    'ADMS salary-book bridge failed event_id=%s',
                    event.id,
                )
        else:
            duplicates += 1

    if latest_punch is not None:
        Device.objects.filter(pk=device.pk).update(
            last_attendance_at=latest_punch,
            last_seen_at=timezone.now(),
        )

    return created, duplicates, errors


def _store_event(
    device: Device,
    record: ParsedAttLog,
    *,
    source_ip: str | None,
) -> tuple[AttendanceEvent, bool]:
    event_hash = compute_event_hash(
        device.serial_number,
        record.device_user_id,
        record.punch_datetime,
        record.status,
        record.verify_mode,
        record.work_code,
    )
    existing = AttendanceEvent.objects.filter(event_hash=event_hash).first()
    if existing:
        return existing, False

    try:
        with transaction.atomic():
            event = AttendanceEvent.objects.create(
                device=device,
                device_user_id=record.device_user_id,
                punch_datetime=record.punch_datetime,
                status=record.status,
                verify_mode=record.verify_mode,
                work_code=record.work_code,
                raw_payload=record.raw_payload,
                source_ip=source_ip,
                received_at=timezone.now(),
                event_hash=event_hash,
            )
        logger.info(
            'ADMS ATTLOG received device=%s user=%s timestamp=%s verify_mode=%s status=%s',
            device.serial_number,
            record.device_user_id,
            record.punch_datetime.isoformat(),
            record.verify_mode,
            record.status,
        )
        return event, True
    except IntegrityError:
        existing = AttendanceEvent.objects.filter(event_hash=event_hash).first()
        if existing:
            return existing, False
        raise


def bridge_event_to_salary_book(event: AttendanceEvent) -> None:
    """Apply a hardware punch to salary_book.Attendance when capture mode is HARDWARE."""
    from backend.salary_book.models import Attendance, Employee, SalaryBookSettings
    from backend.salary_book.services.attendance_evaluator import (
        evaluate_check_in,
        refresh_worked_minutes,
    )

    settings_obj = SalaryBookSettings.get_solo()
    mode = getattr(settings_obj, 'attendance_capture_mode', None)
    if mode is None:
        # Migration not applied yet / older row — fall back to require_gps semantics.
        mode = (
            SalaryBookSettings.CAPTURE_GEO
            if settings_obj.require_gps
            else SalaryBookSettings.CAPTURE_MANUAL
        )
    if mode != SalaryBookSettings.CAPTURE_HARDWARE:
        return

    mapping = (
        DeviceUserMapping.objects.filter(
            device=event.device,
            device_user_id=event.device_user_id,
            is_active=True,
        )
        .order_by('-id')
        .first()
    )
    if not mapping:
        logger.info(
            'ADMS bridge skipped: no mapping device=%s user=%s',
            event.device.serial_number,
            event.device_user_id,
        )
        return

    employee = Employee.objects.filter(
        employee_id=mapping.employee_id,
        status=Employee.STATUS_ACTIVE,
    ).first()
    if not employee:
        logger.warning(
            'ADMS bridge skipped: employee %s not found/active',
            mapping.employee_id,
        )
        return

    punch = event.punch_datetime
    att_date = timezone.localtime(punch).date()

    with transaction.atomic():
        attendance, created = Attendance.objects.select_for_update().get_or_create(
            employee=employee,
            date=att_date,
            defaults={
                'status': Attendance.STATUS_PRESENT,
                'attendance_method': Attendance.METHOD_HARDWARE,
            },
        )

        if attendance.status in PROTECTED_STATUSES:
            logger.info(
                'ADMS bridge skipped protected status=%s employee=%s date=%s',
                attendance.status,
                employee.employee_id,
                att_date,
            )
            return

        def apply_check_in(check_in_punch):
            evaluation = evaluate_check_in(
                employee, att_date, Attendance.STATUS_PRESENT, check_in_punch
            )
            attendance.status = evaluation.status
            attendance.check_in_time = check_in_punch
            attendance.minutes_late = evaluation.minutes_late
            attendance.is_late = evaluation.is_late
            attendance.worked_minutes = evaluation.worked_minutes
            attendance.payable_minutes = evaluation.payable_minutes
            attendance.rule_penalty_applied = evaluation.rule_penalty_applied
            attendance.rule_remarks = evaluation.rule_remarks
            attendance.attendance_method = Attendance.METHOD_HARDWARE

        if created or attendance.check_in_time is None:
            apply_check_in(punch)
            attendance.save()
            return

        if punch < attendance.check_in_time:
            old_out = attendance.check_out_time
            apply_check_in(punch)
            if old_out and old_out > punch:
                attendance.check_out_time = old_out
                refresh_worked_minutes(attendance)
            attendance.save()
            return

        if punch == attendance.check_in_time:
            return

        # Later punch → check-out
        if attendance.check_out_time is None or punch > attendance.check_out_time:
            attendance.check_out_time = punch
            if (
                attendance.status not in PROTECTED_STATUSES
                and attendance.status == Attendance.STATUS_ABSENT
                and not attendance.rule_penalty_applied
            ):
                attendance.status = Attendance.STATUS_PRESENT
            elif attendance.status not in (
                Attendance.STATUS_ABSENT,
                *PROTECTED_STATUSES,
            ):
                if attendance.status not in Attendance.PHOTO_STATUSES:
                    attendance.status = Attendance.STATUS_PRESENT
            attendance.attendance_method = Attendance.METHOD_HARDWARE
            refresh_worked_minutes(attendance)
            attendance.save()
