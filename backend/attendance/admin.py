from django.contrib import admin

from backend.attendance.models import (
    AttendanceEvent,
    Device,
    DeviceCommand,
    DeviceUserMapping,
)
from backend.attendance.services.commands import sync_mapping_to_device


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = (
        'serial_number',
        'device_name',
        'status',
        'is_active',
        'ip_address',
        'last_seen_at',
        'last_attendance_at',
        'firmware_version',
    )
    list_filter = ('status', 'is_active')
    search_fields = ('serial_number', 'device_name', 'ip_address')
    readonly_fields = ('created_at', 'updated_at', 'last_seen_at', 'last_attendance_at')


@admin.register(DeviceUserMapping)
class DeviceUserMappingAdmin(admin.ModelAdmin):
    list_display = (
        'device',
        'device_user_id',
        'employee_id',
        'employee_name',
        'is_active',
        'updated_at',
    )
    list_filter = ('is_active', 'device')
    search_fields = ('device_user_id', 'employee_id', 'employee_name', 'device__serial_number')
    actions = ['push_to_device']

    @admin.action(description='Push selected users to device (name+PIN only)')
    def push_to_device(self, request, queryset):
        n = 0
        for mapping in queryset.select_related('device'):
            n += len(sync_mapping_to_device(mapping))
        self.message_user(request, f'Queued {n} command(s) for the device.')

    def save_model(self, request, obj, form, change):
        old_pin = None
        if change and obj.pk:
            old = DeviceUserMapping.objects.filter(pk=obj.pk).first()
            if old:
                old_pin = old.device_user_id
        super().save_model(request, obj, form, change)
        sync_mapping_to_device(
            obj, old_pin=old_pin if old_pin and old_pin != obj.device_user_id else None
        )


@admin.register(DeviceCommand)
class DeviceCommandAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'device',
        'purpose',
        'related_pin',
        'related_employee_id',
        'status',
        'sent_at',
        'acked_at',
        'created_at',
    )
    list_filter = ('status', 'purpose', 'device')
    search_fields = ('related_pin', 'related_employee_id', 'command_text')
    readonly_fields = (
        'device',
        'command_text',
        'status',
        'purpose',
        'related_employee_id',
        'related_pin',
        'result_code',
        'result_payload',
        'sent_at',
        'acked_at',
        'created_at',
        'updated_at',
    )


@admin.register(AttendanceEvent)
class AttendanceEventAdmin(admin.ModelAdmin):
    list_display = (
        'device',
        'device_user_id',
        'punch_datetime',
        'status',
        'verify_mode',
        'work_code',
        'received_at',
    )
    list_filter = ('device', 'verify_mode', 'status')
    search_fields = ('device_user_id', 'event_hash', 'device__serial_number')
    readonly_fields = (
        'device',
        'device_user_id',
        'punch_datetime',
        'status',
        'verify_mode',
        'work_code',
        'raw_payload',
        'source_ip',
        'received_at',
        'event_hash',
        'created_at',
    )
    ordering = ('-punch_datetime',)
