import calendar
import re
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
    minutes_early_at,
    minutes_late_at,
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
    """Salary cycle day is 1–31. Shorter months use the last day (_safe_day)."""
    try:
        value = int(day or 1)
    except (TypeError, ValueError):
        value = 1
    return max(1, min(31, value))


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
    Inclusive calendar/salary window keyed by (year, month) of the payday.

    Anchored on the employee's joining day-of-month (salary_cycle_start_day),
    not on a calendar-month grid. Example day=13, October 2026:
      13 Sep → 13 Oct  (31 days — full strip on the calendar).
    Day=1 keeps a normal calendar month (1st … last day).
    """
    day = cycle_day_for(employee)
    if day == 1:
        return month_range(year, month)
    end = _safe_day(year, month, day)
    prev_y, prev_m = _shift_month(year, month, -1)
    start = _safe_day(prev_y, prev_m, day)
    return start, end


def cycle_end_marker(employee: Employee, year: int, month: int) -> date:
    """The inclusive period end / payday (e.g. 13 Oct for a joining-day-13 cycle)."""
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
    # Payday closes this period; the next cycle (and cleared Taken / salary)
    # begins the following calendar day.
    if for_date.day <= day:
        return for_date.year, for_date.month
    next_y, next_m = _shift_month(for_date.year, for_date.month, 1)
    return next_y, next_m


def paid_cycle_range(employee: Employee, year: int, month: int):
    """
    Non-overlapping paid window for Taken / salary math.

    The calendar strip is joining-day → joining-day (inclusive). Consecutive
    strips share that payday; paid days assign the shared day to the period
    that ends on it, so the next period's paid start is the day after.
    """
    start, end = cycle_range(employee, year, month)
    if cycle_day_for(employee) == 1:
        return start, end
    if period_containing(employee, start) != (year, month):
        start = start + timedelta(days=1)
    if start > end:
        return end, end
    return start, end


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
        start, end = paid_cycle_range(employee, year, month)
        return (end - start).days + 1
    return calendar.monthrange(year, month)[1]


def coverage_end(year, month, today=None, employee: Employee | None = None):
    today = today or timezone.localdate()
    if employee is not None:
        start, end = paid_cycle_range(employee, year, month)
        if start <= today <= end:
            return today
        return end
    start, end = month_range(year, month)
    if year == today.year and month == today.month:
        return min(end, today)
    return end


def iter_expected_dates(employee: Employee, year, month, today=None):
    start, _ = paid_cycle_range(employee, year, month)
    end = coverage_end(year, month, today, employee=employee)
    join = employee.date_of_joining
    cursor = max(start, join)
    while cursor <= end:
        yield cursor
        cursor = date.fromordinal(cursor.toordinal() + 1)


def iter_pre_join_dates(employee: Employee, year, month, today=None):
    """Days in the covered cycle window that fall before date_of_joining."""
    start, _ = paid_cycle_range(employee, year, month)
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


def overall_late_day_counts(employee: Employee) -> tuple[int, int]:
    """Per-employee late-day counts. Defaults are 5 (half day) and 6 (full day)."""
    try:
        half = int(getattr(employee, 'overall_late_half_days', 5) or 5)
    except (TypeError, ValueError):
        half = 5
    try:
        full = int(getattr(employee, 'overall_late_full_days', 6) or 6)
    except (TypeError, ValueError):
        full = 6
    half = max(1, min(31, half))
    full = max(half + 1, min(31, full))
    return half, full

_INVOICE_NOISE = re.compile(r'(?i)\b(?:credit\s+)?invoice\b[:#\-]?\s*\S*')


def _slip_date(day: date) -> str:
    return day.strftime('%d/%m/%y')


def _item_product_name(item) -> str:
    product = getattr(item, 'product', None)
    if product is not None and getattr(product, 'name', None):
        return str(product.name).strip()
    variant = getattr(item, 'variant', None)
    if variant is not None and getattr(variant, 'name', None):
        return str(variant.name).strip()
    named = getattr(item, 'product_name', None)
    if named and str(named).strip():
        return str(named).strip()
    return 'Product'


def _clean_product_label(reason: str, invoice_number: str) -> str:
    text = reason or ''
    if invoice_number:
        text = text.replace(invoice_number, ' ')
    text = _INVOICE_NOISE.sub(' ', text)
    text = ' '.join(text.split()).strip(' -–:')
    return text or 'Product'


def _scale_to_total(parts: list[tuple[str, Decimal]], total: Decimal) -> list[tuple[str, Decimal]]:
    """Split `total` across named parts. Last line absorbs rounding."""
    if not parts:
        return []
    if len(parts) == 1:
        return [(parts[0][0], _q(total))]
    weight = sum((amount for _, amount in parts), ZERO)
    if weight <= ZERO:
        share = _q(total / Decimal(len(parts)))
        scaled = [(name, share) for name, _ in parts[:-1]]
        used = sum((amount for _, amount in scaled), ZERO)
        scaled.append((parts[-1][0], _q(total - used)))
        return [(name, amount) for name, amount in scaled if amount > ZERO]
    scaled = []
    used = ZERO
    for index, (name, amount) in enumerate(parts):
        if index == len(parts) - 1:
            part = _q(total - used)
        else:
            part = _q(total * amount / weight)
            used += part
        if part > ZERO:
            scaled.append((name, part))
    return scaled


def _invoice_product_amounts(invoice_number: str, advance_amount: Decimal) -> list[tuple[str, Decimal]]:
    """Product names from the system invoice. Never returns the invoice number."""
    number = (invoice_number or '').strip()
    if not number:
        return []
    from backend.pos.models import InvoiceItem

    items = list(
        InvoiceItem.objects.filter(invoice__invoice_number=number).select_related('product', 'variant')
    )
    if not items:
        from backend.credit.models import CreditInvoiceItem

        items = list(
            CreditInvoiceItem.objects.filter(invoice__invoice_number=number).select_related('product')
        )
    if not items:
        return []
    parts = []
    for item in items:
        line = Decimal(str(getattr(item, 'line_total', 0) or 0))
        if line < ZERO:
            line = abs(line)
        parts.append((_item_product_name(item) or 'Product', line))
    return _scale_to_total(parts, advance_amount)


def _advance_cut_lines(advance: SalaryAdvance) -> list[tuple[str, str, Decimal]]:
    """Return (kind, description, amount) rows for one active advance."""
    amount = _q(advance.amount)
    number = (advance.source_invoice_number or '').strip()
    if advance.source == SalaryAdvance.SOURCE_MTSHOP or number:
        products = _invoice_product_amounts(number, amount)
        if products:
            return [('PRODUCT', name, part) for name, part in products]
        return [('PRODUCT', _clean_product_label(advance.reason, number), amount)]
    mode = (advance.payment_mode or '').upper()
    if mode == SalaryAdvance.MODE_UPI:
        return [('ONLINE', 'ONLINE LIYA', amount)]
    return [('CASH', 'CASH LIYA', amount)]


def build_salary_slip(
    employee: Employee,
    *,
    today: date,
    daily: Decimal,
    gross: Decimal,
    sched_mins: int,
    paid_start: date,
    paid_end: date,
    period_end_marker: date,
    rows: dict,
) -> dict:
    """
    Salary-less ledger for one cycle.

    Open cycle (today still inside it): salary so far is only days already
    worked, so the morning after payday the boxes are 0 until new punches
    or amounts arrive. A closed cycle uses full monthly salary as the base.
    """
    if today < paid_start:
        period_open = True
        scan_end = paid_start - timedelta(days=1)
    elif today > period_end_marker:
        period_open = False
        scan_end = paid_end
    else:
        period_open = True
        scan_end = min(today, paid_end)

    per_minute = (daily / Decimal(sched_mins)) if sched_mins > 0 else ZERO
    punch_lines = []
    late_days = 0
    accrued = ZERO
    cursor = paid_start
    while cursor <= scan_end:
        row = rows.get(cursor)
        if row is not None:
            if row.status == Attendance.STATUS_PRESENT:
                accrued += daily
            elif row.status == Attendance.STATUS_HALF_DAY:
                accrued += daily * HALF
            elif row.status in (Attendance.STATUS_PAID_LEAVE, Attendance.STATUS_HOLIDAY):
                accrued += daily
            late = minutes_late_at(row.check_in_time, employee, row.date) if row.check_in_time else 0
            early = minutes_early_at(row.check_out_time, employee, row.date) if row.check_out_time else 0
            if late > 0:
                late_days += 1
            day_room = daily
            if late > 0 and per_minute > ZERO:
                cut = _q(min(day_room, per_minute * Decimal(late)))
                if cut > ZERO:
                    day_room -= cut
                    punch_lines.append({
                        'date': cursor.isoformat(),
                        'date_label': _slip_date(cursor),
                        'kind': 'LATE_IN',
                        'description': f'LATE IN SALARY LESS ({late} min)',
                        'minutes': late,
                        'amount': str(cut),
                    })
            if early > 0 and per_minute > ZERO and day_room > ZERO:
                cut = _q(min(day_room, per_minute * Decimal(early)))
                if cut > ZERO:
                    punch_lines.append({
                        'date': cursor.isoformat(),
                        'date_label': _slip_date(cursor),
                        'kind': 'EARLY_OUT',
                        'description': f'BEFORE TIME OUT SALARY LESS ({early} min)',
                        'minutes': early,
                        'amount': str(cut),
                    })
        cursor += timedelta(days=1)

    penalty_lines = []
    half_days, full_days = overall_late_day_counts(employee)
    if getattr(employee, 'overall_late_penalty_enabled', False):
        if late_days >= full_days:
            penalty_lines.append({
                'date': None,
                'date_label': '',
                'kind': 'OVERALL_FULL',
                'description': f'OVERALL {full_days} DAY LATE SALARY LESS',
                'minutes': 0,
                'amount': str(_q(daily)),
            })
        elif late_days >= half_days:
            penalty_lines.append({
                'date': None,
                'date_label': '',
                'kind': 'OVERALL_HALF',
                'description': f'OVERALL {half_days} DAY LATE SALARY LESS',
                'minutes': 0,
                'amount': str(_q(daily * HALF)),
            })

    money_lines = []
    advances = SalaryAdvance.objects.filter(
        employee=employee,
        status=SalaryAdvance.STATUS_ACTIVE,
        date__gte=paid_start,
        date__lte=paid_end,
    ).order_by('date', 'id')
    for advance in advances:
        for kind, description, amount in _advance_cut_lines(advance):
            if amount <= ZERO:
                continue
            money_lines.append({
                'date': advance.date.isoformat(),
                'date_label': _slip_date(advance.date),
                'kind': kind,
                'description': description,
                'minutes': 0,
                'amount': str(_q(amount)),
            })

    lines = punch_lines + penalty_lines + money_lines
    time_less = _q(sum(
        (Decimal(line['amount']) for line in punch_lines + penalty_lines),
        ZERO,
    ))
    taken_less = _q(sum((Decimal(line['amount']) for line in money_lines), ZERO))
    total_less = _q(time_less + taken_less)
    base = accrued if period_open else gross
    total_salary = _q(max(ZERO, base))
    # Time cuts come out of salary generated; cash / products stay in Taken.
    salary_generated = _q(max(ZERO, total_salary - time_less))
    final_payable = _q(salary_generated - taken_less)
    fresh_cycle = period_open and salary_generated == ZERO and taken_less == ZERO

    return {
        'lines': lines,
        'total_less': str(total_less),
        'monthly_salary': str(gross),
        'daily_salary': str(_q(daily)),
        'total_salary': str(total_salary),
        'time_less': str(time_less),
        'taken_less': str(taken_less),
        'salary_generated': str(salary_generated),
        'final_payable': str(final_payable),
        'period_open': period_open,
        'fresh_cycle': fresh_cycle,
        'late_days': late_days,
        'overall_late_penalty_enabled': bool(getattr(employee, 'overall_late_penalty_enabled', False)),
        'overall_late_half_days': half_days,
        'overall_late_full_days': full_days,
    }


def calculate_employee_month(employee: Employee, year: int, month: int, today=None):
    """Return a transparent salary breakdown. Never called from the frontend."""
    today = today or timezone.localdate()
    settings_obj = SalaryBookSettings.get_solo()
    method, fixed_days = effective_method(employee, settings_obj)
    divisor = divisor_for(year, month, method, fixed_days, employee=employee)
    gross = _q(employee.monthly_salary)
    daily = _q(gross / Decimal(divisor), FOUR) if divisor else ZERO
    sched_mins = scheduled_minutes(employee, settings_obj)
    sched_hours = scheduled_hours(employee, settings_obj)
    hourly = _q(daily / sched_hours, FOUR) if sched_hours else ZERO

    # Calendar strip: joining day → joining day. Paid math: non-overlapping window.
    strip_start, _strip_end = cycle_range(employee, year, month)
    start, end = paid_cycle_range(employee, year, month)
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
        f'Salary cycle follows joining day {cycle_day} '
        f'({strip_start.isoformat()} → {end_marker.isoformat()}); next cycle starts the day after payday.',
        'Active salary advances in this cycle reduce net payable.',
        'MT Shop / Shop Boys purchases appear as advances; Paid or Voided advances are excluded.',
    ]
    if pre_join:
        notes.insert(
            0,
            f'{len(pre_join)} day(s) before date of joining ({employee.date_of_joining.isoformat()}) '
            'are unpaid.',
        )

    salary_slip = build_salary_slip(
        employee,
        today=today,
        daily=daily,
        gross=gross,
        sched_mins=sched_mins,
        paid_start=start,
        paid_end=end,
        period_end_marker=end_marker,
        rows=rows,
    )

    breakdown = {
        'employee_id': employee.employee_id,
        'employee_name': employee.name,
        'year': year,
        'month': month,
        'period_start': strip_start.isoformat(),
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
        'salary_slip': salary_slip,
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
