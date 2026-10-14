import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Sum
from django.utils import timezone

from backend.salary_book.models import (
    Attendance,
    Employee,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryPayment,
    SalaryRecord,
)
from backend.salary_book.services.schedule_utils import (
    FOUR,
    TWO,
    ZERO,
    _q,
    hours_from_minutes,
    payable_minutes,
    scheduled_hours,
    scheduled_minutes,
    worked_minutes,
)

HALF = Decimal('0.5')


def month_range(year, month):
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def clamp_cycle_day(day) -> int:
    """Salary cycle day is 1–28 so every month has that calendar day."""
    try:
        value = int(day or 1)
    except (TypeError, ValueError):
        value = 1
    return max(1, min(28, value))


def cycle_day_for(employee: Employee) -> int:
    return clamp_cycle_day(getattr(employee, 'salary_cycle_start_day', 1))


def _safe_day(year: int, month: int, day: int) -> date:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last))


def _shift_month(year: int, month: int, delta: int):
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def cycle_range(employee: Employee, year: int, month: int):
    """
    Inclusive start/end for the salary period keyed by (year, month).

    (year, month) is the month of the period end marker (payday day).
    Example day=9, period Feb 2026 → 9 Jan … 8 Feb (ends on the 9th marker).
    Day=1 keeps a normal calendar month (1st … last day).
    """
    day = cycle_day_for(employee)
    if day == 1:
        return month_range(year, month)
    end_marker = _safe_day(year, month, day)
    prev_y, prev_m = _shift_month(year, month, -1)
    start = _safe_day(prev_y, prev_m, day)
    inclusive_end = end_marker - timedelta(days=1)
    return start, inclusive_end


def cycle_end_marker(employee: Employee, year: int, month: int) -> date:
    """The 'ends on this date' marker (e.g. 9 Feb for a 9→9 cycle)."""
    day = cycle_day_for(employee)
    if day == 1:
        _, end = month_range(year, month)
        return end
    return _safe_day(year, month, day)


def period_containing(employee: Employee, for_date: date):
    """Return (year, month) period key that contains for_date for this employee."""
    day = cycle_day_for(employee)
    if day == 1:
        return for_date.year, for_date.month
    if for_date.day < day:
        return for_date.year, for_date.month
    next_y, next_m = _shift_month(for_date.year, for_date.month, 1)
    return next_y, next_m


def effective_method(employee: Employee, settings_obj: SalaryBookSettings):
    method = employee.salary_calculation_method
    if method == Employee.METHOD_INHERIT:
        method = settings_obj.salary_calculation_method
    if method == SalaryBookSettings.METHOD_FIXED:
        days = employee.fixed_working_days or settings_obj.fixed_working_days
        return method, int(days)
    return SalaryBookSettings.METHOD_CALENDAR, None


def divisor_for(year, month, method, fixed_days, employee: Employee | None = None):
    if method == SalaryBookSettings.METHOD_FIXED:
        return int(fixed_days or 26)
    if employee is not None:
        start, end = cycle_range(employee, year, month)
        return (end - start).days + 1
    return calendar.monthrange(year, month)[1]


def coverage_end(year, month, today=None, employee: Employee | None = None):
    today = today or timezone.localdate()
    if employee is not None:
        start, end = cycle_range(employee, year, month)
        if start <= today <= end:
            return today
        return end
    start, end = month_range(year, month)
    if year == today.year and month == today.month:
        return min(end, today)
    return end


def iter_expected_dates(employee: Employee, year, month, today=None):
    start, _ = cycle_range(employee, year, month)
    end = coverage_end(year, month, today, employee=employee)
    join = employee.date_of_joining
    cursor = max(start, join)
    while cursor <= end:
        yield cursor
        cursor = date.fromordinal(cursor.toordinal() + 1)


def iter_pre_join_dates(employee: Employee, year, month, today=None):
    """Days in the covered cycle window that fall before date_of_joining."""
    start, _ = cycle_range(employee, year, month)
    end = coverage_end(year, month, today, employee=employee)
    join = employee.date_of_joining
    if join <= start:
        return
    last = min(end, date.fromordinal(join.toordinal() - 1))
    cursor = start
    while cursor <= last:
        yield cursor
        cursor = date.fromordinal(cursor.toordinal() + 1)


def _status_counts(statuses):
    present = absent = paid = unpaid = half = holiday = unmarked = 0
    deduction_days = ZERO
    for status in statuses:
        if status is None:
            unmarked += 1
            absent += 1
            deduction_days += Decimal('1')
        elif status == Attendance.STATUS_PRESENT:
            present += 1
        elif status == Attendance.STATUS_PAID_LEAVE:
            paid += 1
        elif status == Attendance.STATUS_HOLIDAY:
            holiday += 1
        elif status == Attendance.STATUS_UNPAID_LEAVE:
            unpaid += 1
            deduction_days += Decimal('1')
        elif status == Attendance.STATUS_ABSENT:
            absent += 1
            deduction_days += Decimal('1')
        elif status == Attendance.STATUS_HALF_DAY:
            half += 1
            deduction_days += HALF
        else:
            unmarked += 1
            absent += 1
            deduction_days += Decimal('1')
    return {
        'present_days': Decimal(present),
        'absent_days': Decimal(absent),
        'paid_leave_days': Decimal(paid),
        'unpaid_leave_days': Decimal(unpaid),
        'half_days': Decimal(half),
        'holiday_days': Decimal(holiday),
        'unmarked_days': Decimal(unmarked),
        'deduction_days': deduction_days,
    }


def _day_credit(row: Attendance | None, employee: Employee, daily: Decimal, scheduled_mins: int) -> Decimal:
    if row is None:
        return ZERO
    if row.status in (Attendance.STATUS_PAID_LEAVE, Attendance.STATUS_HOLIDAY):
        return daily
    if row.status in (Attendance.STATUS_ABSENT, Attendance.STATUS_UNPAID_LEAVE):
        return ZERO
    if row.status not in Attendance.PHOTO_STATUSES:
        return ZERO
    if scheduled_mins <= 0:
        return ZERO
    if row.payable_minutes:
        payable = min(row.payable_minutes, scheduled_mins)
    else:
        payable = payable_minutes(worked_minutes(row, employee), employee)
    credit = daily * Decimal(payable) / Decimal(scheduled_mins)
    cap = daily if row.status == Attendance.STATUS_PRESENT else _q(daily * HALF, FOUR)
    if credit > cap:
        credit = cap
    return _q(credit, FOUR)


def calculate_employee_month(employee: Employee, year: int, month: int, today=None):
    """Return a transparent salary breakdown. Never called from the frontend."""
    settings_obj = SalaryBookSettings.get_solo()
    method, fixed_days = effective_method(employee, settings_obj)
    divisor = divisor_for(year, month, method, fixed_days, employee=employee)
    gross = _q(employee.monthly_salary)
    daily = _q(gross / Decimal(divisor), FOUR) if divisor else ZERO
    sched_mins = scheduled_minutes(employee, settings_obj)
    sched_hours = scheduled_hours(employee, settings_obj)
    hourly = _q(daily / sched_hours, FOUR) if sched_hours else ZERO

    start, end = cycle_range(employee, year, month)
    end_marker = cycle_end_marker(employee, year, month)
    cycle_day = cycle_day_for(employee)
    rows = {
        row.date: row
        for row in Attendance.objects.filter(employee=employee, date__gte=start, date__lte=end)
    }
    expected = list(iter_expected_dates(employee, year, month, today))
    pre_join = list(iter_pre_join_dates(employee, year, month, today))
    statuses = [rows.get(d).status if rows.get(d) else None for d in expected]
    counts = _status_counts(statuses)

    daily_breakdown = []
    credits_sum = ZERO
    # Days before date_of_joining are unpaid — salary calculation starts from that date.
    shortfall = daily * Decimal(len(pre_join))
    for day in pre_join:
        daily_breakdown.append({
            'date': day.isoformat(),
            'status': 'BEFORE_JOINING',
            'worked_hours': '0.00',
            'payable_hours': '0.00',
            'day_credit': str(ZERO),
            'minutes_late': 0,
            'rule_penalty_applied': False,
        })
    for day in expected:
        row = rows.get(day)
        credit = _day_credit(row, employee, daily, sched_mins)
        credits_sum += credit
        shortfall += max(ZERO, daily - credit)
        status = row.status if row else None
        worked = 0
        payable = 0
        late = 0
        penalty = False
        if row:
            if row.status in Attendance.PHOTO_STATUSES:
                worked = row.worked_minutes or worked_minutes(row, employee)
                payable = row.payable_minutes or payable_minutes(worked, employee)
                if row.check_in_time is None and row.check_out_time is None and not row.worked_minutes:
                    worked = sched_mins
                    payable = sched_mins
            late = row.minutes_late or 0
            penalty = row.rule_penalty_applied
        daily_breakdown.append({
            'date': day.isoformat(),
            'status': status,
            'worked_hours': str(hours_from_minutes(worked)),
            'payable_hours': str(hours_from_minutes(payable)),
            'day_credit': str(_q(credit)),
            'minutes_late': late,
            'rule_penalty_applied': penalty,
        })

    leave_deduction = _q(min(shortfall, gross))
    earned_salary = _q(gross - leave_deduction)
    other_deductions = ZERO
    allowances = ZERO
    advances = SalaryAdvance.objects.filter(
        employee=employee,
        status=SalaryAdvance.STATUS_ACTIVE,
        date__gte=start,
        date__lte=end,
    ).aggregate(total=Sum('amount'))['total'] or ZERO
    total_advances = _q(advances)
    net = _q(earned_salary - other_deductions - total_advances + allowances)

    notes = [
        'Pay is proportional to hours worked, capped at the scheduled shift (no overtime).',
        'Paid leave and holidays count as a full day.',
        'Unpaid leave, absent, unmarked, and consecutive-late penalty days are unpaid.',
        'Half day is capped at half of daily salary.',
        'Salary calculation starts from the employee date of joining; earlier days are unpaid.',
        f'Salary cycle starts on day {cycle_day} and ends on day {cycle_day} '
        f'({start.isoformat()} → {end_marker.isoformat()}).',
        'Active salary advances in this cycle reduce net payable.',
        'MT Shop / Shop Boys purchases appear as advances; Paid or Voided advances are excluded.',
    ]
    if pre_join:
        notes.insert(
            0,
            f'{len(pre_join)} day(s) before date of joining ({employee.date_of_joining.isoformat()}) '
            'are unpaid.',
        )

    breakdown = {
        'employee_id': employee.employee_id,
        'employee_name': employee.name,
        'year': year,
        'month': month,
        'period_start': start.isoformat(),
        'period_end': end.isoformat(),
        'period_end_marker': end_marker.isoformat(),
        'salary_cycle_start_day': cycle_day,
        'gross_salary': str(gross),
        'calculation_method': method,
        'divisor_days': divisor,
        'daily_salary': str(daily),
        'hourly_rate': str(hourly),
        'scheduled_hours': str(sched_hours),
        'earned_salary': str(earned_salary),
        'present_days': str(counts['present_days']),
        'absent_days': str(counts['absent_days']),
        'paid_leave_days': str(counts['paid_leave_days']),
        'unpaid_leave_days': str(counts['unpaid_leave_days']),
        'half_days': str(counts['half_days']),
        'holiday_days': str(counts['holiday_days']),
        'unmarked_days': str(counts['unmarked_days']),
        'deduction_days': str(counts['deduction_days']),
        'pre_join_days': str(Decimal(len(pre_join))),
        'date_of_joining': employee.date_of_joining.isoformat(),
        'leave_deduction': str(leave_deduction),
        'other_deductions': str(other_deductions),
        'allowances': str(allowances),
        'total_advances': str(total_advances),
        'net_salary': str(net),
        'daily_breakdown': daily_breakdown,
        'notes': notes,
    }

    return {
        'gross_salary': gross,
        'present_days': counts['present_days'],
        'absent_days': counts['absent_days'],
        'paid_leave_days': counts['paid_leave_days'],
        'unpaid_leave_days': counts['unpaid_leave_days'],
        'half_days': counts['half_days'],
        'holiday_days': counts['holiday_days'],
        'unmarked_days': counts['unmarked_days'],
        'leave_deduction': leave_deduction,
        'other_deductions': other_deductions,
        'allowances': allowances,
        'total_advances': total_advances,
        'net_salary': net,
        'calculation_method': method,
        'divisor_days': divisor,
        'daily_salary': daily,
        'breakdown': breakdown,
    }


def apply_calculation_to_record(record: SalaryRecord, calc: dict):
    for key in (
        'gross_salary',
        'present_days',
        'absent_days',
        'paid_leave_days',
        'unpaid_leave_days',
        'half_days',
        'holiday_days',
        'unmarked_days',
        'leave_deduction',
        'other_deductions',
        'allowances',
        'total_advances',
        'net_salary',
        'calculation_method',
        'divisor_days',
        'daily_salary',
        'breakdown',
    ):
        setattr(record, key, calc[key])
    return record


def refresh_payment_status(record: SalaryRecord):
    paid = record.payments.filter(status=SalaryPayment.STATUS_ACTIVE).aggregate(
        total=Sum('amount')
    )['total'] or ZERO
    paid = _q(paid)
    net = _q(record.net_salary)
    if paid <= ZERO:
        record.payment_status = SalaryRecord.PAY_PENDING
    elif paid < net:
        record.payment_status = SalaryRecord.PAY_PARTIAL
    else:
        record.payment_status = SalaryRecord.PAY_PAID
    record.save(update_fields=['payment_status', 'updated_at'])
    return paid


def month_is_finalized(employee: Employee, for_date: date) -> bool:
    year, month = period_containing(employee, for_date)
    return SalaryRecord.objects.filter(
        employee=employee,
        year=year,
        month=month,
        status=SalaryRecord.STATUS_FINALIZED,
    ).exists()
