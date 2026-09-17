from django.db import models
from django.utils import timezone


class Device(models.Model):
    STATUS_PENDING = 'PENDING'
    STATUS_ACTIVE = 'ACTIVE'
    STATUS_INACTIVE = 'INACTIVE'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending approval'),
        (STATUS_ACTIVE, 'Active'),
        (STATUS_INACTIVE, 'Inactive'),
    ]

    serial_number = models.CharField(max_length=64, unique=True, db_index=True)
    device_name = models.CharField(max_length=128, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    firmware_version = models.CharField(max_length=64, blank=True)
    platform = models.CharField(max_length=64, blank=True)
    push_service_version = models.CharField(max_length=64, blank=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING
    )
    is_active = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    last_attendance_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attendance_devices'
        ordering = ['serial_number']

    def __str__(self):
        return f'{self.device_name or self.serial_number} ({self.serial_number})'

    @property
    def is_accepted(self) -> bool:
        return self.is_active and self.status == self.STATUS_ACTIVE


class DeviceUserMapping(models.Model):
    device = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name='user_mappings'
    )
    device_user_id = models.CharField(max_length=64)
    employee_id = models.CharField(
        max_length=50,
        help_text='Matches salary_book.Employee.employee_id (e.g. EMP-001)',
    )
    employee_name = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attendance_device_user_mappings'
        ordering = ['device_id', 'device_user_id']
        constraints = [
            models.UniqueConstraint(
                fields=['device', 'device_user_id'],
                name='uniq_attendance_device_user',
            ),
        ]
        indexes = [
            models.Index(fields=['employee_id']),
            models.Index(fields=['device', 'device_user_id']),
        ]

    def __str__(self):
        return f'{self.device.serial_number}:{self.device_user_id} → {self.employee_id}'


class AttendanceEvent(models.Model):
    device = models.ForeignKey(
        Device, on_delete=models.PROTECT, related_name='attendance_events'
    )
    device_user_id = models.CharField(max_length=64, db_index=True)
    punch_datetime = models.DateTimeField()
    status = models.IntegerField(default=0)
    verify_mode = models.IntegerField(default=0)
    work_code = models.IntegerField(default=0)
    raw_payload = models.TextField()
    source_ip = models.GenericIPAddressField(null=True, blank=True)
    received_at = models.DateTimeField(default=timezone.now)
    event_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance_events'
        ordering = ['-punch_datetime', '-id']
        indexes = [
            models.Index(fields=['device', 'punch_datetime']),
            models.Index(fields=['device_user_id', 'punch_datetime']),
            models.Index(fields=['event_hash']),
        ]

    def __str__(self):
        return f'{self.device.serial_number} user={self.device_user_id} @ {self.punch_datetime}'


class DeviceCommand(models.Model):
    """Queued ADMS commands delivered on GET /iclock/getrequest."""

    STATUS_PENDING = 'PENDING'
    STATUS_SENT = 'SENT'
    STATUS_ACKED = 'ACKED'
    STATUS_FAILED = 'FAILED'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_SENT, 'Sent to device'),
        (STATUS_ACKED, 'Acknowledged'),
        (STATUS_FAILED, 'Failed'),
    ]

    device = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name='commands'
    )
    command_text = models.TextField(
        help_text='Body after C:{id}: — e.g. DATA UPDATE USERINFO ...'
    )
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True
    )
    purpose = models.CharField(max_length=64, blank=True)
    related_employee_id = models.CharField(max_length=50, blank=True)
    related_pin = models.CharField(max_length=64, blank=True)
    result_code = models.CharField(max_length=32, blank=True)
    result_payload = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    acked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'attendance_device_commands'
        ordering = ['id']
        indexes = [
            models.Index(fields=['device', 'status', 'id']),
        ]

    def __str__(self):
        return f'cmd#{self.pk} {self.device.serial_number} {self.status}'

    def wire_payload(self) -> str:
        """ADMS getrequest body for this command."""
        return f'C:{self.pk}:{self.command_text}'
