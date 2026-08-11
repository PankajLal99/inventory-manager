from rest_framework import serializers

from .models import (
    Attendance,
    Employee,
    LeaveRecord,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryPayment,
    SalaryRecord,
)


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
            'updated_at',
        ]
        read_only_fields = ['id', 'require_gps', 'updated_at']

    def validate_require_gps(self, value):
        if value is False:
            raise serializers.ValidationError('GPS is mandatory and cannot be disabled.')
        return True


class EmployeeSerializer(serializers.ModelSerializer):
    profile_photo_url = serializers.SerializerMethodField()

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
            'profile_photo',
            'profile_photo_url',
            'status',
            'notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'profile_photo_url']
        extra_kwargs = {
            'profile_photo': {'write_only': True, 'required': False},
            'employee_id': {'required': False, 'allow_blank': True},
        }

    def get_profile_photo_url(self, obj):
        if not obj.profile_photo:
            return None
        return _abs_url(self.context.get('request'), f'/api/v1/salary-book/employees/{obj.pk}/photo/')

    def validate_monthly_salary(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Monthly salary cannot be negative.')
        return value


class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    photo_url = serializers.SerializerMethodField()
    check_out_photo_url = serializers.SerializerMethodField()

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
