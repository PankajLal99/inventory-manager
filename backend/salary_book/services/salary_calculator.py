import calendar
from datetime import date
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


def effective_method(employee: Employee, settings_obj: SalaryBookSettings):
    method = employee.salary_calculation_method
    if method == Employee.METHOD_INHERIT:
        method = settings_obj.salary_calculation_method
    if method == SalaryBookSettings.METHOD_FIXED:
        days = employee.fixed_working_days or settings_obj.fixed_working_days
        return method, int(days)
    return SalaryBookSettings.METHOD_CALENDAR, None


def divisor_for(year, month, method, fixed_days):
    if method == SalaryBookSettings.METHOD_FIXED:
        return int(fixed_days or 26)
    return calendar.monthrange(year, month)[1]


def coverage_end(year, month, today=None):
    today = today or timezone.localdate()
    start, end = month_range(year, month)
    if year == today.year and month == today.month:
        return min(end, today)
    return end


def iter_expected_dates(employee: Employee, year, month, today=None):
    start, _ = month_range(year, month)
    end = coverage_end(year, month, today)
    join = employee.date_of_joining
    cursor = max(start, join)
    while cursor <= end:
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
    divisor = divisor_for(year, month, method, fixed_days)
    gross = _q(employee.monthly_salary)
    daily = _q(gross / Decimal(divisor), FOUR) if divisor else ZERO
    sched_mins = scheduled_minutes(employee, settings_obj)
    sched_hours = scheduled_hours(employee, settings_obj)
    hourly = _q(daily / sched_hours, FOUR) if sched_hours else ZERO

    start, end = month_range(year, month)
    rows = {
        row.date: row
        for row in Attendance.objects.filter(employee=employee, date__gte=start, date__lte=end)
    }
    expected = list(iter_expected_dates(employee, year, month, today))
    statuses = [rows.get(d).status if rows.get(d) else None for d in expected]
    counts = _status_counts(statuses)

    daily_breakdown = []
    credits_sum = ZERO
    shortfall = ZERO
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

    leave_deduction = _q(shortfall)
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

    breakdown = {
        'employee_id': employee.employee_id,
        'employee_name': employee.name,
        'year': year,
        'month': month,
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
        'leave_deduction': str(leave_deduction),
        'other_deductions': str(other_deductions),
        'allowances': str(allowances),
        'total_advances': str(total_advances),
        'net_salary': str(net),
        'daily_breakdown': daily_breakdown,
        'notes': [
            'Pay is proportional to hours worked, capped at the scheduled shift (no overtime).',
            'Paid leave and holidays count as a full day.',
            'Unpaid leave, absent, unmarked, and consecutive-late penalty days are unpaid.',
            'Half day is capped at half of daily salary.',
            'Active salary advances in this month reduce net payable.',
        ],
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
    return SalaryRecord.objects.filter(
        employee=employee,
        year=for_date.year,
        month=for_date.month,
        status=SalaryRecord.STATUS_FINALIZED,
    ).exists()
