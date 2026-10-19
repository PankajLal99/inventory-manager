"""Persist ADMS attendance events and bridge into Salary Book when configured."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
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


def _min_checkout_interval() -> timedelta:
    """Minimum time after check-in before a punch may become check-out."""
    minutes = getattr(settings, 'ATTENDANCE_MIN_CHECKOUT_MINUTES', 45)
    try:
        minutes = int(minutes)
    except (TypeError, ValueError):
        minutes = 45
    return timedelta(minutes=max(0, minutes))


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
            # A re-upload of the same scan should repair a day that was paired
            # out of order (check-out before check-in, or a double scan saved as out).
            try:
                bridge_event_to_salary_book(event, hardware_only=True)
            except Exception:
                logger.exception(
                    'ADMS salary-book repair failed event_id=%s',
                    event.id,
                )

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


def pair_day_punches(
    punches: list[datetime],
    min_gap: timedelta | None = None,
) -> tuple[datetime | None, datetime | None]:
    """Earliest punch is check-in. A later punch is check-out only after min_gap.

    Scans inside the gap are double marks and are dropped. Arrival order does
    not matter: the result is the same set of timestamps either way.
    """
    if not punches:
        return None, None
    ordered = sorted(punches)
    check_in = ordered[0]
    gap = _min_checkout_interval() if min_gap is None else min_gap
    check_out = None
    for punch in ordered[1:]:
        if punch <= check_in or punch - check_in < gap:
            continue
        if check_out is None or punch > check_out:
            check_out = punch
    return check_in, check_out


def _adjusted_day_punches(employee, att_date, settings_obj) -> list[datetime]:
    """All hardware punches for this employee that fall on att_date after the machine delta."""
    mappings = list(
        DeviceUserMapping.objects.filter(
            employee_id=employee.employee_id,
            is_active=True,
        )
    )
    if not mappings:
        return []
    local_tz = timezone.get_current_timezone()
    window_start = timezone.make_aware(
        datetime.combine(att_date - timedelta(days=1), time.min),
        local_tz,
    )
    window_end = timezone.make_aware(
        datetime.combine(att_date + timedelta(days=2), time.min),
        local_tz,
    )
    query = Q()
    for mapping in mappings:
        query |= Q(device_id=mapping.device_id, device_user_id=mapping.device_user_id)
    events = AttendanceEvent.objects.filter(
        query,
        punch_datetime__gte=window_start,
        punch_datetime__lt=window_end,
    )
    punches: list[datetime] = []
    for event in events:
        punch = settings_obj.apply_machine_time_delta(event.punch_datetime)
        if timezone.localtime(punch).date() == att_date:
            punches.append(punch)
    return punches


def _hardware_capture_mode(settings_obj) -> bool:
    from backend.salary_book.models import SalaryBookSettings

    mode = getattr(settings_obj, 'attendance_capture_mode', None)
    if mode is None:
        mode = (
            SalaryBookSettings.CAPTURE_GEO
            if settings_obj.require_gps
            else SalaryBookSettings.CAPTURE_MANUAL
        )
    return mode == SalaryBookSettings.CAPTURE_HARDWARE


def rebuild_hardware_day(employee, att_date, settings_obj, *, hardware_only: bool = False) -> str:
    """Rebuild one salary-book day from stored punches.

    Returns: 'updated' | 'unchanged' | 'skipped_protected' | 'skipped_manual' | 'no_punches'.
    """
    from backend.salary_book.models import Attendance
    from backend.salary_book.services.attendance_evaluator import (
        evaluate_check_in,
        refresh_worked_minutes,
    )

    if employee.date_of_joining and att_date < employee.date_of_joining:
        return 'no_punches'

    punches = _adjusted_day_punches(employee, att_date, settings_obj)
    check_in, check_out = pair_day_punches(punches)
    if check_in is None:
        return 'no_punches'

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
            return 'skipped_protected'

        if (
            hardware_only
            and not created
            and attendance.attendance_method != Attendance.METHOD_HARDWARE
        ):
            return 'skipped_manual'

        before = (attendance.check_in_time, attendance.check_out_time, attendance.status)
        evaluation = evaluate_check_in(
            employee, att_date, Attendance.STATUS_PRESENT, check_in
        )
        attendance.status = evaluation.status
        attendance.check_in_time = check_in
        attendance.check_out_time = check_out
        attendance.minutes_late = evaluation.minutes_late
        attendance.is_late = evaluation.is_late
        attendance.worked_minutes = evaluation.worked_minutes
        attendance.payable_minutes = evaluation.payable_minutes
        attendance.rule_penalty_applied = evaluation.rule_penalty_applied
        attendance.rule_remarks = evaluation.rule_remarks
        attendance.attendance_method = Attendance.METHOD_HARDWARE

        if check_out is not None:
            if (
                attendance.status == Attendance.STATUS_ABSENT
                and not attendance.rule_penalty_applied
            ):
                attendance.status = Attendance.STATUS_PRESENT
            elif attendance.status not in Attendance.PHOTO_STATUSES:
                attendance.status = Attendance.STATUS_PRESENT
            refresh_worked_minutes(attendance)

        after = (attendance.check_in_time, attendance.check_out_time, attendance.status)
        if before == after and not created:
            return 'unchanged'
        attendance.save()
        return 'updated'


def repair_hardware_attendance(*, dry_run: bool = False) -> dict[str, int]:
    """Re-pair every mapped hardware day from AttendanceEvent rows.

    Fixes inverted check-in/out and double-scan check-outs left by older logic.
    Leaves leave/holiday and non-hardware (manual/geo) rows alone.
    """
    from backend.salary_book.models import Attendance, Employee, SalaryBookSettings

    settings_obj = SalaryBookSettings.get_solo()
    stats = {
        'scanned': 0,
        'updated': 0,
        'unchanged': 0,
        'skipped_protected': 0,
        'skipped_manual': 0,
        'no_punches': 0,
        'dry_run': 1 if dry_run else 0,
    }
    if not _hardware_capture_mode(settings_obj):
        return stats

    mappings = (
        DeviceUserMapping.objects.filter(is_active=True)
        .select_related('device')
        .order_by('employee_id', 'id')
    )
    by_employee: dict[str, list[DeviceUserMapping]] = {}
    for mapping in mappings:
        by_employee.setdefault(mapping.employee_id, []).append(mapping)

    for employee_id, emp_mappings in by_employee.items():
        employee = Employee.objects.filter(
            employee_id=employee_id,
            status=Employee.STATUS_ACTIVE,
        ).first()
        if not employee:
            continue

        query = Q()
        for mapping in emp_mappings:
            query |= Q(device_id=mapping.device_id, device_user_id=mapping.device_user_id)
        events = AttendanceEvent.objects.filter(query).only('punch_datetime')
        dates = set()
        for event in events.iterator():
            punch = settings_obj.apply_machine_time_delta(event.punch_datetime)
            dates.add(timezone.localtime(punch).date())

        # Also catch hardware rows that no longer match punches (e.g. inverted times).
        for att_date in Attendance.objects.filter(
            employee=employee,
            attendance_method=Attendance.METHOD_HARDWARE,
        ).values_list('date', flat=True):
            dates.add(att_date)

        for att_date in sorted(dates):
            stats['scanned'] += 1
            if dry_run:
                punches = _adjusted_day_punches(employee, att_date, settings_obj)
                check_in, check_out = pair_day_punches(punches)
                existing = Attendance.objects.filter(employee=employee, date=att_date).first()
                if existing and existing.status in PROTECTED_STATUSES:
                    stats['skipped_protected'] += 1
                elif (
                    existing
                    and existing.attendance_method != Attendance.METHOD_HARDWARE
                ):
                    stats['skipped_manual'] += 1
                elif check_in is None:
                    stats['no_punches'] += 1
                elif (
                    existing
                    and existing.check_in_time == check_in
                    and existing.check_out_time == check_out
                ):
                    stats['unchanged'] += 1
                else:
                    stats['updated'] += 1
                continue

            result = rebuild_hardware_day(
                employee, att_date, settings_obj, hardware_only=True
            )
            stats[result] = stats.get(result, 0) + 1

    return stats


def bridge_event_to_salary_book(event: AttendanceEvent, *, hardware_only: bool = False) -> None:
    """Apply a hardware punch to salary_book.Attendance when capture mode is HARDWARE.

    The day's check-in and check-out are rebuilt from every stored punch, so a
    double scan or an out-of-order upload cannot leave check-out before check-in.
    ``hardware_only`` is for duplicate re-uploads: leave a manual edit alone.
    """
    from backend.salary_book.models import Employee, SalaryBookSettings

    settings_obj = SalaryBookSettings.get_solo()
    if not _hardware_capture_mode(settings_obj):
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

    # Raw device timestamp is kept on AttendanceEvent; adjust only for salary-book.
    punch = settings_obj.apply_machine_time_delta(event.punch_datetime)
    att_date = timezone.localtime(punch).date()

    if employee.date_of_joining and att_date < employee.date_of_joining:
        logger.info(
            'ADMS bridge skipped: punch before date_of_joining employee=%s date=%s join=%s',
            employee.employee_id,
            att_date,
            employee.date_of_joining,
        )
        return

    result = rebuild_hardware_day(
        employee, att_date, settings_obj, hardware_only=hardware_only
    )
    if result == 'skipped_protected':
        logger.info(
            'ADMS bridge skipped protected status employee=%s date=%s',
            employee.employee_id,
            att_date,
        )
