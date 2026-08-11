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

TWO = Decimal('0.01')
FOUR = Decimal('0.0001')
ZERO = Decimal('0')
HALF = Decimal('0.5')


def _q(value, places=TWO):
    return Decimal(value).quantize(places, rounding=ROUND_HALF_UP)


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


def calculate_employee_month(employee: Employee, year: int, month: int, today=None):
    """Return a transparent salary breakdown. Never called from the frontend."""
    settings_obj = SalaryBookSettings.get_solo()
    method, fixed_days = effective_method(employee, settings_obj)
    divisor = divisor_for(year, month, method, fixed_days)
    gross = _q(employee.monthly_salary)
    daily = _q(gross / Decimal(divisor), FOUR) if divisor else ZERO

    start, end = month_range(year, month)
    rows = {
        row.date: row.status
        for row in Attendance.objects.filter(employee=employee, date__gte=start, date__lte=end)
    }
    statuses = [rows.get(d) for d in iter_expected_dates(employee, year, month, today)]
    counts = _status_counts(statuses)

    leave_deduction = _q(daily * counts['deduction_days'])
    other_deductions = ZERO
    allowances = ZERO
    advances = SalaryAdvance.objects.filter(
        employee=employee,
        status=SalaryAdvance.STATUS_ACTIVE,
        date__gte=start,
        date__lte=end,
    ).aggregate(total=Sum('amount'))['total'] or ZERO
    total_advances = _q(advances)
    net = _q(gross - leave_deduction - other_deductions - total_advances + allowances)

    breakdown = {
        'employee_id': employee.employee_id,
        'employee_name': employee.name,
        'year': year,
        'month': month,
        'gross_salary': str(gross),
        'calculation_method': method,
        'divisor_days': divisor,
        'daily_salary': str(daily),
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
        'notes': [
            'Paid leave does not reduce salary.',
            'Unpaid leave, absent, and unmarked days reduce salary.',
            'Half day deducts half of daily salary.',
            'Holiday does not reduce salary.',
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
