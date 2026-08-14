from django.contrib import admin

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


@admin.register(SalaryBookSettings)
class SalaryBookSettingsAdmin(admin.ModelAdmin):
    list_display = [
        'salary_calculation_method',
        'fixed_working_days',
        'default_check_in',
        'default_check_out',
        'max_gps_accuracy_meters',
        'office_latitude',
        'office_longitude',
        'geofence_radius_meters',
        'require_gps',
        'require_photo',
        'updated_at',
    ]


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = [
        'employee_id', 'name', 'mobile', 'monthly_salary',
        'expected_check_in', 'expected_check_out', 'status', 'date_of_joining',
    ]
    list_filter = ['status', 'department']
    search_fields = ['employee_id', 'name', 'mobile']


@admin.register(EmployeeAttendanceRule)
class EmployeeAttendanceRuleAdmin(admin.ModelAdmin):
    list_display = [
        'employee', 'rule_type', 'is_active',
        'late_threshold_minutes', 'consecutive_late_days',
    ]
    list_filter = ['rule_type', 'is_active']


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = [
        'employee', 'date', 'status', 'minutes_late', 'is_late',
        'rule_penalty_applied', 'latitude', 'longitude', 'location_accuracy',
    ]
    list_filter = ['status', 'date']
    search_fields = ['employee__name', 'employee__employee_id']


@admin.register(LeaveRecord)
class LeaveRecordAdmin(admin.ModelAdmin):
    list_display = ['employee', 'leave_type', 'start_date', 'end_date', 'days', 'status']
    list_filter = ['leave_type', 'status']


@admin.register(SalaryAdvance)
class SalaryAdvanceAdmin(admin.ModelAdmin):
    list_display = ['employee', 'date', 'amount', 'status']
    list_filter = ['status']


@admin.register(SalaryRecord)
class SalaryRecordAdmin(admin.ModelAdmin):
    list_display = [
        'employee', 'year', 'month', 'gross_salary', 'net_salary',
        'status', 'payment_status',
    ]
    list_filter = ['status', 'payment_status', 'year', 'month']


@admin.register(SalaryPayment)
class SalaryPaymentAdmin(admin.ModelAdmin):
    list_display = ['employee', 'salary_record', 'payment_date', 'amount', 'payment_mode', 'status']
    list_filter = ['status', 'payment_mode']
