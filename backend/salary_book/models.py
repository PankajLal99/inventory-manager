import os
import re
import uuid
from datetime import time
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.db.models import Q

from backend.core.storage import SalaryBookImageStorage
def _uuid_upload(folder, filename):
    ext = os.path.splitext(filename or '')[1].lower() or '.jpg'
    if ext not in {'.jpg', '.jpeg', '.png', '.webp'}:
        ext = '.jpg'
    return f'salary_book/{folder}/{uuid.uuid4().hex}{ext}'


def employee_photo_upload(instance, filename):
    return _uuid_upload('profiles', filename)


def attendance_photo_upload(instance, filename):
    return _uuid_upload('attendance', filename)


def checkout_photo_upload(instance, filename):
    return _uuid_upload('attendance', filename)


mobile_validator = RegexValidator(
    regex=r'^(\+91)?[6-9]\d{9}$',
    message='Enter a valid 10-digit Indian mobile number.',
)


class SalaryBookSettings(models.Model):
    METHOD_CALENDAR = 'CALENDAR_DAYS'
    METHOD_FIXED = 'FIXED_WORKING_DAYS'
    METHOD_CHOICES = [
        (METHOD_CALENDAR, 'Calendar Days'),
        (METHOD_FIXED, 'Fixed Working Days'),
    ]

    salary_calculation_method = models.CharField(
        max_length=32, choices=METHOD_CHOICES, default=METHOD_CALENDAR
    )
    fixed_working_days = models.PositiveSmallIntegerField(default=26)
    max_gps_accuracy_meters = models.PositiveIntegerField(default=100)
    office_latitude = models.DecimalField(max_digits=9, decimal_places=6, default=Decimal('23.259900'))
    office_longitude = models.DecimalField(max_digits=9, decimal_places=6, default=Decimal('77.412600'))
    geofence_radius_meters = models.PositiveIntegerField(default=150)
    require_gps = models.BooleanField(default=True)
    require_photo = models.BooleanField(default=True)
    require_checkout_gps_photo = models.BooleanField(default=True)
    default_check_in = models.TimeField(default=time(9, 0))
    default_check_out = models.TimeField(default=time(18, 0))
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_settings'

    def __str__(self):
        return 'Salary Book Settings'

    def clean(self):
        if not self.require_gps:
            raise ValidationError({'require_gps': 'GPS is mandatory and cannot be disabled.'})
        if self.fixed_working_days < 1:
            raise ValidationError({'fixed_working_days': 'Must be at least 1.'})
        if self.max_gps_accuracy_meters < 1:
            raise ValidationError({'max_gps_accuracy_meters': 'Must be at least 1 meter.'})
        if self.geofence_radius_meters < 1:
            raise ValidationError({'geofence_radius_meters': 'Must be at least 1 meter.'})
        if self.default_check_in and self.default_check_out:
            if self.default_check_out <= self.default_check_in:
                raise ValidationError(
                    {'default_check_out': 'Default check-out must be after default check-in.'}
                )

    def save(self, *args, **kwargs):
        self.require_gps = True
        self.full_clean()
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Employee(models.Model):
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_INACTIVE = 'INACTIVE'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_INACTIVE, 'Inactive'),
    ]

    METHOD_INHERIT = 'INHERIT'
    METHOD_CALENDAR = SalaryBookSettings.METHOD_CALENDAR
    METHOD_FIXED = SalaryBookSettings.METHOD_FIXED
    METHOD_CHOICES = [
        (METHOD_INHERIT, 'Inherit from settings'),
        (METHOD_CALENDAR, 'Calendar Days'),
        (METHOD_FIXED, 'Fixed Working Days'),
    ]

    BLOOD_GROUP_CHOICES = [
        ('A+', 'A+'),
        ('A-', 'A-'),
        ('B+', 'B+'),
        ('B-', 'B-'),
        ('AB+', 'AB+'),
        ('AB-', 'AB-'),
        ('O+', 'O+'),
        ('O-', 'O-'),
    ]

    employee_id = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=200)
    mobile = models.CharField(max_length=15, validators=[mobile_validator])
    alternate_contact = models.CharField(max_length=15, blank=True)
    address = models.TextField(blank=True)
    blood_group = models.CharField(max_length=8, blank=True, choices=BLOOD_GROUP_CHOICES)
    date_of_joining = models.DateField()
    designation = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)
    monthly_salary = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal('0'))]
    )
    salary_calculation_method = models.CharField(
        max_length=32, choices=METHOD_CHOICES, default=METHOD_INHERIT
    )
    fixed_working_days = models.PositiveSmallIntegerField(null=True, blank=True)
    expected_check_in = models.TimeField(null=True, blank=True)
    expected_check_out = models.TimeField(null=True, blank=True)
    profile_photo = models.ImageField(
        storage=SalaryBookImageStorage(),
        upload_to=employee_photo_upload,
        blank=True,
        null=True,
    )
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_employees'
        ordering = ['name']
        indexes = [
            models.Index(fields=['employee_id']),
            models.Index(fields=['status']),
            models.Index(fields=['name']),
            models.Index(fields=['mobile']),
        ]

    def __str__(self):
        return f'{self.name} ({self.employee_id})'

    def clean(self):
        if self.alternate_contact:
            if not re.match(r'^(\+91)?[6-9]\d{9}$', self.alternate_contact):
                raise ValidationError(
                    {'alternate_contact': 'Enter a valid 10-digit Indian mobile number.'}
                )
        if self.salary_calculation_method == self.METHOD_FIXED and not self.fixed_working_days:
            raise ValidationError(
                {'fixed_working_days': 'Required when using fixed working days.'}
            )
        if self.expected_check_in and self.expected_check_out:
            if self.expected_check_out <= self.expected_check_in:
                raise ValidationError(
                    {'expected_check_out': 'Check-out time must be after check-in time.'}
                )
        elif self.expected_check_in or self.expected_check_out:
            raise ValidationError(
                'Set both expected check-in and check-out, or leave both blank to use company defaults.'
            )

    def save(self, *args, **kwargs):
        if not self.employee_id:
            self.employee_id = self._next_employee_id()
        super().save(*args, **kwargs)

    @staticmethod
    def _next_employee_id():
        existing = Employee.objects.filter(employee_id__startswith='EMP-').values_list(
            'employee_id', flat=True
        )
        max_n = 0
        for eid in existing:
            try:
                max_n = max(max_n, int(str(eid).split('-', 1)[1]))
            except (ValueError, IndexError):
                continue
        return f'EMP-{max_n + 1:03d}'


class EmployeeAttendanceRule(models.Model):
    TYPE_CONSECUTIVE_LATE = 'CONSECUTIVE_LATE'
    TYPE_CHOICES = [
        (TYPE_CONSECUTIVE_LATE, 'Consecutive late days'),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name='attendance_rules'
    )
    rule_type = models.CharField(
        max_length=32, choices=TYPE_CHOICES, default=TYPE_CONSECUTIVE_LATE
    )
    is_active = models.BooleanField(default=True)
    late_threshold_minutes = models.PositiveSmallIntegerField(default=30)
    consecutive_late_days = models.PositiveSmallIntegerField(default=3)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_attendance_rules'
        ordering = ['-is_active', '-id']
        indexes = [
            models.Index(fields=['employee', 'is_active']),
        ]

    def __str__(self):
        return (
            f'{self.employee} {self.rule_type} '
            f'{self.consecutive_late_days}×{self.late_threshold_minutes}m'
        )

    def clean(self):
        if self.late_threshold_minutes < 1:
            raise ValidationError(
                {'late_threshold_minutes': 'Late threshold must be at least 1 minute.'}
            )
        if self.consecutive_late_days < 1:
            raise ValidationError(
                {'consecutive_late_days': 'Consecutive late days must be at least 1.'}
            )


class LeaveRecord(models.Model):
    TYPE_PAID = 'PAID'
    TYPE_UNPAID = 'UNPAID'
    TYPE_CHOICES = [
        (TYPE_PAID, 'Paid Leave'),
        (TYPE_UNPAID, 'Unpaid Leave'),
    ]

    STATUS_ACTIVE = 'ACTIVE'
    STATUS_VOID = 'VOID'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_VOID, 'Void'),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name='leaves'
    )
    leave_type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveIntegerField()
    reason = models.CharField(max_length=255, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='salary_book_leaves_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_leaves'
        ordering = ['-start_date', '-id']
        indexes = [
            models.Index(fields=['employee', 'start_date']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'{self.employee} {self.leave_type} {self.start_date}–{self.end_date}'

    def clean(self):
        if self.end_date < self.start_date:
            raise ValidationError({'end_date': 'End date cannot be before start date.'})

    def save(self, *args, **kwargs):
        self.days = (self.end_date - self.start_date).days + 1
        self.full_clean()
        super().save(*args, **kwargs)


class Attendance(models.Model):
    STATUS_PRESENT = 'PRESENT'
    STATUS_ABSENT = 'ABSENT'
    STATUS_PAID_LEAVE = 'PAID_LEAVE'
    STATUS_UNPAID_LEAVE = 'UNPAID_LEAVE'
    STATUS_HALF_DAY = 'HALF_DAY'
    STATUS_HOLIDAY = 'HOLIDAY'
    STATUS_CHOICES = [
        (STATUS_PRESENT, 'Present'),
        (STATUS_ABSENT, 'Absent'),
        (STATUS_PAID_LEAVE, 'Paid Leave'),
        (STATUS_UNPAID_LEAVE, 'Unpaid Leave'),
        (STATUS_HALF_DAY, 'Half Day'),
        (STATUS_HOLIDAY, 'Holiday'),
    ]

    METHOD_MANUAL = 'MANUAL'
    METHOD_CAMERA = 'CAMERA'
    METHOD_CHOICES = [
        (METHOD_MANUAL, 'Manual'),
        (METHOD_CAMERA, 'Camera'),
    ]

    PHOTO_STATUSES = {STATUS_PRESENT, STATUS_HALF_DAY}

    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name='attendance'
    )
    date = models.DateField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES)
    check_in_time = models.DateTimeField(null=True, blank=True)
    check_out_time = models.DateTimeField(null=True, blank=True)
    photo = models.ImageField(
        storage=SalaryBookImageStorage(),
        upload_to=attendance_photo_upload,
        blank=True,
        null=True,
    )
    check_out_photo = models.ImageField(
        storage=SalaryBookImageStorage(),
        upload_to=checkout_photo_upload,
        blank=True,
        null=True,
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    location_accuracy = models.DecimalField(max_digits=8, decimal_places=2)
    location_captured_at = models.DateTimeField()
    check_out_latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    check_out_longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    check_out_accuracy = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    check_out_captured_at = models.DateTimeField(null=True, blank=True)
    attendance_method = models.CharField(
        max_length=16, choices=METHOD_CHOICES, default=METHOD_MANUAL
    )
    face_verification_status = models.CharField(max_length=32, blank=True)
    face_verification_score = models.DecimalField(
        max_digits=6, decimal_places=3, null=True, blank=True
    )
    face_match_id = models.CharField(max_length=64, blank=True)
    remarks = models.TextField(blank=True)
    minutes_late = models.PositiveIntegerField(default=0)
    is_late = models.BooleanField(default=False)
    worked_minutes = models.PositiveIntegerField(default=0)
    payable_minutes = models.PositiveIntegerField(default=0)
    rule_penalty_applied = models.BooleanField(default=False)
    rule_remarks = models.CharField(max_length=255, blank=True)
    leave = models.ForeignKey(
        LeaveRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_rows',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='salary_book_attendance_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_attendance'
        ordering = ['-date', 'employee_id']
        constraints = [
            models.UniqueConstraint(fields=['employee', 'date'], name='uniq_salary_book_att_emp_date'),
        ]
        indexes = [
            models.Index(fields=['date']),
            models.Index(fields=['employee', 'date']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'{self.employee} {self.date} {self.status}'


class SalaryAdvance(models.Model):
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_VOID = 'VOID'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_VOID, 'Void'),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name='advances'
    )
    date = models.DateField()
    amount = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))]
    )
    reason = models.CharField(max_length=255, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='salary_book_advances_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='salary_book_advances_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_advances'
        ordering = ['-date', '-id']
        indexes = [
            models.Index(fields=['employee', 'date']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'{self.employee} {self.date} {self.amount}'


class SalaryRecord(models.Model):
    STATUS_DRAFT = 'DRAFT'
    STATUS_FINALIZED = 'FINALIZED'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'),
        (STATUS_FINALIZED, 'Finalized'),
    ]

    PAY_PENDING = 'PENDING'
    PAY_PARTIAL = 'PARTIALLY_PAID'
    PAY_PAID = 'PAID'
    PAYMENT_STATUS_CHOICES = [
        (PAY_PENDING, 'Pending'),
        (PAY_PARTIAL, 'Partially Paid'),
        (PAY_PAID, 'Paid'),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name='salary_records'
    )
    year = models.PositiveIntegerField()
    month = models.PositiveSmallIntegerField()
    gross_salary = models.DecimalField(max_digits=12, decimal_places=2)
    present_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    absent_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    paid_leave_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    unpaid_leave_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    half_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    holiday_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    unmarked_days = models.DecimalField(max_digits=6, decimal_places=1, default=0)
    leave_deduction = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_advances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2)
    calculation_method = models.CharField(max_length=32)
    divisor_days = models.PositiveSmallIntegerField()
    daily_salary = models.DecimalField(max_digits=12, decimal_places=4)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    payment_status = models.CharField(
        max_length=16, choices=PAYMENT_STATUS_CHOICES, default=PAY_PENDING
    )
    breakdown = models.JSONField(default=dict, blank=True)
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='salary_book_finalized',
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_salary_records'
        ordering = ['-year', '-month', 'employee_id']
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'year', 'month'],
                name='uniq_salary_book_record_emp_month',
            ),
            models.CheckConstraint(
                check=Q(month__gte=1) & Q(month__lte=12),
                name='salary_book_record_month_range',
            ),
        ]
        indexes = [
            models.Index(fields=['year', 'month']),
            models.Index(fields=['status']),
            models.Index(fields=['payment_status']),
        ]

    def __str__(self):
        return f'{self.employee} {self.month:02d}/{self.year} {self.net_salary}'


class SalaryPayment(models.Model):
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_VOID = 'VOID'
    STATUS_CHOICES = [
        (STATUS_ACTIVE, 'Active'),
        (STATUS_VOID, 'Void'),
    ]

    MODE_CASH = 'CASH'
    MODE_BANK = 'BANK_TRANSFER'
    MODE_UPI = 'UPI'
    MODE_OTHER = 'OTHER'
    MODE_CHOICES = [
        (MODE_CASH, 'Cash'),
        (MODE_BANK, 'Bank Transfer'),
        (MODE_UPI, 'UPI'),
        (MODE_OTHER, 'Other'),
    ]

    employee = models.ForeignKey(
        Employee, on_delete=models.PROTECT, related_name='salary_payments'
    )
    salary_record = models.ForeignKey(
        SalaryRecord, on_delete=models.PROTECT, related_name='payments'
    )
    payment_date = models.DateField()
    amount = models.DecimalField(
        max_digits=12, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))]
    )
    payment_mode = models.CharField(max_length=16, choices=MODE_CHOICES, default=MODE_CASH)
    reference_number = models.CharField(max_length=100, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='salary_book_payments_created',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='salary_book_payments_updated',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'salary_book_payments'
        ordering = ['-payment_date', '-id']
        indexes = [
            models.Index(fields=['employee', 'payment_date']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f'{self.employee} {self.amount} {self.payment_date}'
