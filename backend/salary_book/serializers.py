from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from .models import (
    Attendance,
    Employee,
    EmployeeAttendanceRule,
    LeaveRecord,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryPayment,
    SalaryRecord,
)
from .services.salary_calculator import divisor_for, effective_method
from .services.schedule_utils import FOUR, ZERO, _q, effective_schedule, hours_from_minutes, scheduled_hours


def _abs_url(request, path):
    if request:
        return request.build_absolute_uri(path)
    return path


class SalaryBookSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryBookSettings
        fields = [
            'id',
            'salary_calculation_method',
            'fixed_working_days',
            'max_gps_accuracy_meters',
            'office_latitude',
            'office_longitude',
            'geofence_radius_meters',
            'require_gps',
            'require_photo',
            'require_checkout_gps_photo',
            'default_check_in',
            'default_check_out',
            'updated_at',
        ]
        read_only_fields = ['id', 'updated_at']

    def validate(self, attrs):
        cin = attrs.get('default_check_in', getattr(self.instance, 'default_check_in', None))
        cout = attrs.get('default_check_out', getattr(self.instance, 'default_check_out', None))
        if cin and cout and cout <= cin:
            raise serializers.ValidationError(
                {'default_check_out': 'Default check-out must be after default check-in.'}
            )
        return attrs


class EmployeeSerializer(serializers.ModelSerializer):
    profile_photo_url = serializers.SerializerMethodField()
    scheduled_hours = serializers.SerializerMethodField()
    daily_rate_preview = serializers.SerializerMethodField()
    hourly_rate_preview = serializers.SerializerMethodField()
    effective_check_in = serializers.SerializerMethodField()
    effective_check_out = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            'id',
            'employee_id',
            'name',
            'mobile',
            'alternate_contact',
            'address',
            'blood_group',
            'date_of_joining',
            'designation',
            'department',
            'monthly_salary',
            'salary_calculation_method',
            'fixed_working_days',
            'expected_check_in',
            'expected_check_out',
            'effective_check_in',
            'effective_check_out',
            'scheduled_hours',
            'daily_rate_preview',
            'hourly_rate_preview',
            'profile_photo',
            'profile_photo_url',
            'status',
            'notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'created_at',
            'updated_at',
            'profile_photo_url',
            'scheduled_hours',
            'daily_rate_preview',
            'hourly_rate_preview',
            'effective_check_in',
            'effective_check_out',
        ]
        extra_kwargs = {
            'profile_photo': {'write_only': True, 'required': False},
            'employee_id': {'required': False, 'allow_blank': True},
            'expected_check_in': {'required': False, 'allow_null': True},
            'expected_check_out': {'required': False, 'allow_null': True},
        }

    def _settings(self):
        cached = self.context.get('_settings')
        if cached is None:
            cached = SalaryBookSettings.get_solo()
            self.context['_settings'] = cached
        return cached

    def get_profile_photo_url(self, obj):
        if not obj.profile_photo:
            return None
        return _abs_url(self.context.get('request'), f'/api/v1/salary-book/employees/{obj.pk}/photo/')

    def get_scheduled_hours(self, obj):
        return str(scheduled_hours(obj, self._settings()))

    def _schedule(self, obj):
        return effective_schedule(obj, self._settings())

    def get_effective_check_in(self, obj):
        cin, _ = self._schedule(obj)
        return cin.strftime('%H:%M:%S') if cin else None

    def get_effective_check_out(self, obj):
        _, cout = self._schedule(obj)
        return cout.strftime('%H:%M:%S') if cout else None

    def _daily_preview(self, obj):
        today = timezone.localdate()
        method, fixed_days = effective_method(obj, self._settings())
        divisor = divisor_for(today.year, today.month, method, fixed_days)
        if not divisor:
            return ZERO
        return _q(Decimal(obj.monthly_salary) / Decimal(divisor), FOUR)

    def get_daily_rate_preview(self, obj):
        return str(self._daily_preview(obj))

    def get_hourly_rate_preview(self, obj):
        hours = scheduled_hours(obj, self._settings())
        if not hours:
            return str(ZERO)
        return str(_q(self._daily_preview(obj) / hours, FOUR))

    def validate_monthly_salary(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Monthly salary cannot be negative.')
        return value

    def validate(self, attrs):
        for key in ('expected_check_in', 'expected_check_out'):
            if attrs.get(key) == '':
                attrs[key] = None
        cin = attrs.get('expected_check_in', getattr(self.instance, 'expected_check_in', None))
        cout = attrs.get('expected_check_out', getattr(self.instance, 'expected_check_out', None))
        if cin and cout and cout <= cin:
            raise serializers.ValidationError(
                {'expected_check_out': 'Check-out time must be after check-in time.'}
            )
        if bool(cin) != bool(cout):
            raise serializers.ValidationError(
                'Set both expected check-in and check-out, or leave both blank to use company defaults.'
            )
        return attrs


class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    photo_url = serializers.SerializerMethodField()
    check_out_photo_url = serializers.SerializerMethodField()
    worked_hours = serializers.SerializerMethodField()
    payable_hours = serializers.SerializerMethodField()
    expected_check_in = serializers.SerializerMethodField()
    expected_check_out = serializers.SerializerMethodField()

    class Meta:
        model = Attendance
        fields = [
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'date',
            'status',
            'check_in_time',
            'check_out_time',
            'photo_url',
            'check_out_photo_url',
            'latitude',
            'longitude',
            'location_accuracy',
            'location_captured_at',
            'check_out_latitude',
            'check_out_longitude',
            'check_out_accuracy',
            'check_out_captured_at',
            'attendance_method',
            'remarks',
            'minutes_late',
            'is_late',
            'worked_minutes',
            'payable_minutes',
            'worked_hours',
            'payable_hours',
            'rule_penalty_applied',
            'rule_remarks',
            'expected_check_in',
            'expected_check_out',
            'leave',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'photo_url',
            'check_out_photo_url',
            'created_at',
            'updated_at',
            'employee_name',
            'employee_code',
            'minutes_late',
            'is_late',
            'worked_minutes',
            'payable_minutes',
            'worked_hours',
            'payable_hours',
            'rule_penalty_applied',
            'rule_remarks',
            'expected_check_in',
            'expected_check_out',
        ]

    def get_photo_url(self, obj):
        if not obj.photo:
            return None
        return _abs_url(
            self.context.get('request'),
            f'/api/v1/salary-book/attendance/{obj.pk}/photo/?kind=check_in',
        )

    def get_check_out_photo_url(self, obj):
        if not obj.check_out_photo:
            return None
        return _abs_url(
            self.context.get('request'),
            f'/api/v1/salary-book/attendance/{obj.pk}/photo/?kind=check_out',
        )

    def get_worked_hours(self, obj):
        return str(hours_from_minutes(obj.worked_minutes or 0))

    def get_payable_hours(self, obj):
        return str(hours_from_minutes(obj.payable_minutes or 0))

    def _schedule(self, obj):
        settings = self.context.get('_settings')
        if settings is None:
            settings = SalaryBookSettings.get_solo()
            self.context['_settings'] = settings
        return effective_schedule(obj.employee, settings)

    def get_expected_check_in(self, obj):
        cin, _ = self._schedule(obj)
        return cin.strftime('%H:%M:%S') if cin else None

    def get_expected_check_out(self, obj):
        _, cout = self._schedule(obj)
        return cout.strftime('%H:%M:%S') if cout else None


class EmployeeAttendanceRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeAttendanceRule
        fields = [
            'id',
            'employee',
            'rule_type',
            'is_active',
            'late_threshold_minutes',
            'consecutive_late_days',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'employee', 'created_at', 'updated_at']

    def validate_late_threshold_minutes(self, value):
        if value is None or value < 1:
            raise serializers.ValidationError('Late threshold must be at least 1 minute.')
        return value

    def validate_consecutive_late_days(self, value):
        if value is None or value < 1:
            raise serializers.ValidationError('Consecutive late days must be at least 1.')
        return value

    def validate_rule_type(self, value):
        if value and value not in dict(EmployeeAttendanceRule.TYPE_CHOICES):
            raise serializers.ValidationError('Unsupported attendance rule type.')
        return value or EmployeeAttendanceRule.TYPE_CONSECUTIVE_LATE


class LeaveRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = LeaveRecord
        fields = [
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'leave_type',
            'start_date',
            'end_date',
            'days',
            'reason',
            'remarks',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['days', 'status', 'created_at', 'updated_at']


class SalaryAdvanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = SalaryAdvance
        fields = [
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'date',
            'amount',
            'reason',
            'remarks',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['status', 'created_at', 'updated_at']


class SalaryPaymentSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)

    class Meta:
        model = SalaryPayment
        fields = [
            'id',
            'employee',
            'salary_record',
            'employee_name',
            'payment_date',
            'amount',
            'payment_mode',
            'reference_number',
            'remarks',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['status', 'created_at', 'updated_at', 'employee']


class SalaryRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    total_paid = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    hourly_rate = serializers.SerializerMethodField()
    earned_salary = serializers.SerializerMethodField()
    scheduled_hours = serializers.SerializerMethodField()

    class Meta:
        model = SalaryRecord
        fields = [
            'id',
            'employee',
            'employee_name',
            'employee_code',
            'year',
            'month',
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
            'hourly_rate',
            'earned_salary',
            'scheduled_hours',
            'status',
            'payment_status',
            'breakdown',
            'total_paid',
            'remaining',
            'finalized_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def _breakdown_value(self, obj, key, default='0.00'):
        breakdown = obj.breakdown or {}
        return str(breakdown.get(key, default))

    def get_hourly_rate(self, obj):
        return self._breakdown_value(obj, 'hourly_rate', '0.0000')

    def get_earned_salary(self, obj):
        return self._breakdown_value(obj, 'earned_salary', str(obj.net_salary))

    def get_scheduled_hours(self, obj):
        return self._breakdown_value(obj, 'scheduled_hours', '0.00')

    def get_total_paid(self, obj):
        paid = self.context.get('paid_map', {}).get(obj.pk)
        if paid is None:
            from django.db.models import Sum
            from .models import SalaryPayment
            paid = obj.payments.filter(status=SalaryPayment.STATUS_ACTIVE).aggregate(
                total=Sum('amount')
            )['total'] or 0
        return str(paid)

    def get_remaining(self, obj):
        from decimal import Decimal
        paid = Decimal(str(self.get_total_paid(obj)))
        remaining = obj.net_salary - paid
        if remaining < 0:
            remaining = Decimal('0')
        return str(remaining)
