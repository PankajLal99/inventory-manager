"""Authenticated Salary Book APIs for hardware devices and PIN mappings."""

from __future__ import annotations

from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.attendance.models import Device, DeviceCommand, DeviceUserMapping
from backend.attendance.services.commands import (
    push_all_employees_to_device,
    sync_mapping_to_device,
)
from backend.salary_book.models import Employee
from backend.salary_book.permissions import IsSalaryBookUser, user_is_salary_book_admin


class DeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Device
        fields = [
            'id',
            'serial_number',
            'device_name',
            'ip_address',
            'status',
            'is_active',
            'last_seen_at',
            'last_attendance_at',
            'firmware_version',
            'created_at',
        ]
        read_only_fields = fields


class DeviceUserMappingSerializer(serializers.ModelSerializer):
    device_serial = serializers.CharField(source='device.serial_number', read_only=True)
    pending_commands = serializers.SerializerMethodField()

    class Meta:
        model = DeviceUserMapping
        fields = [
            'id',
            'device',
            'device_serial',
            'device_user_id',
            'employee_id',
            'employee_name',
            'is_active',
            'pending_commands',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'device_serial', 'pending_commands', 'created_at', 'updated_at']

    def get_pending_commands(self, obj):
        return DeviceCommand.objects.filter(
            device=obj.device,
            related_pin=obj.device_user_id,
            status__in=[DeviceCommand.STATUS_PENDING, DeviceCommand.STATUS_SENT],
        ).count()

    def validate_device_user_id(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Device PIN is required.')
        return value

    def validate_employee_id(self, value):
        value = (value or '').strip()
        if not Employee.objects.filter(employee_id=value).exists():
            raise serializers.ValidationError('Unknown salary-book employee_id.')
        return value

    def validate(self, attrs):
        device = attrs.get('device') or getattr(self.instance, 'device', None)
        pin = attrs.get('device_user_id') or getattr(self.instance, 'device_user_id', None)
        if device and pin:
            qs = DeviceUserMapping.objects.filter(device=device, device_user_id=pin)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {'device_user_id': 'This PIN is already mapped on this device.'}
                )
        return attrs


class DeviceCommandSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceCommand
        fields = [
            'id',
            'device',
            'command_text',
            'status',
            'purpose',
            'related_employee_id',
            'related_pin',
            'result_code',
            'sent_at',
            'acked_at',
            'created_at',
        ]
        read_only_fields = fields


def _admin_required(request):
    if not user_is_salary_book_admin(request.user):
        return Response({'error': 'Only admins can manage device mappings.'}, status=403)
    return None


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def device_list(request):
    qs = Device.objects.all().order_by('serial_number')
    return Response(DeviceSerializer(qs, many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def mapping_list_create(request):
    if request.method == 'GET':
        qs = DeviceUserMapping.objects.select_related('device').order_by(
            'device_id', 'device_user_id'
        )
        device_id = request.query_params.get('device')
        if device_id:
            qs = qs.filter(device_id=device_id)
        return Response(DeviceUserMappingSerializer(qs, many=True).data)

    denied = _admin_required(request)
    if denied:
        return denied

    data = request.data.copy()
    emp_id = (data.get('employee_id') or '').strip()
    if emp_id and not data.get('employee_name'):
        emp = Employee.objects.filter(employee_id=emp_id).first()
        if emp:
            data['employee_name'] = emp.name

    serializer = DeviceUserMappingSerializer(data=data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    mapping = serializer.save()
    sync_mapping_to_device(mapping)
    return Response(
        DeviceUserMappingSerializer(mapping).data, status=status.HTTP_201_CREATED
    )


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def mapping_detail(request, pk):
    mapping = DeviceUserMapping.objects.select_related('device').filter(pk=pk).first()
    if not mapping:
        return Response({'error': 'Not found.'}, status=404)

    if request.method == 'GET':
        return Response(DeviceUserMappingSerializer(mapping).data)

    denied = _admin_required(request)
    if denied:
        return denied

    if request.method == 'DELETE':
        from backend.attendance.services.commands import queue_delete_user

        if mapping.device.is_accepted and mapping.is_active:
            queue_delete_user(
                mapping.device,
                mapping.device_user_id,
                employee_id=mapping.employee_id,
            )
        mapping.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    old_pin = mapping.device_user_id
    data = request.data.copy()
    emp_id = (data.get('employee_id') or mapping.employee_id or '').strip()
    if 'employee_id' in data and emp_id and not data.get('employee_name'):
        emp = Employee.objects.filter(employee_id=emp_id).first()
        if emp:
            data['employee_name'] = emp.name

    serializer = DeviceUserMappingSerializer(mapping, data=data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    mapping = serializer.save()
    new_pin = mapping.device_user_id
    if old_pin != new_pin:
        sync_mapping_to_device(mapping, old_pin=old_pin)
    else:
        sync_mapping_to_device(mapping)
    return Response(DeviceUserMappingSerializer(mapping).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def mapping_sync(request, pk):
    """Re-queue USERINFO register for this mapping (no fingerprint/password)."""
    denied = _admin_required(request)
    if denied:
        return denied
    mapping = DeviceUserMapping.objects.select_related('device').filter(pk=pk).first()
    if not mapping:
        return Response({'error': 'Not found.'}, status=404)
    cmds = sync_mapping_to_device(mapping)
    return Response(
        {
            'queued': len(cmds),
            'commands': DeviceCommandSerializer(cmds, many=True).data,
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def device_sync_all_mappings(request, pk):
    denied = _admin_required(request)
    if denied:
        return denied
    device = Device.objects.filter(pk=pk).first()
    if not device:
        return Response({'error': 'Device not found.'}, status=404)
    total = 0
    for mapping in device.user_mappings.filter(is_active=True):
        total += len(sync_mapping_to_device(mapping))
    return Response({'queued': total})


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def device_push_all_employees(request, pk):
    """
    Create PIN mappings for every ACTIVE Salary Book employee (EMP-001 → PIN 1)
    and queue USERINFO register commands (name+PIN only).
    """
    denied = _admin_required(request)
    if denied:
        return denied
    device = Device.objects.filter(pk=pk).first()
    if not device:
        return Response({'error': 'Device not found.'}, status=404)
    result = push_all_employees_to_device(device)
    if not result.get('ok'):
        return Response(result, status=status.HTTP_400_BAD_REQUEST)
    return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def device_command_list(request):
    qs = DeviceCommand.objects.select_related('device').order_by('-id')[:100]
    device_id = request.query_params.get('device')
    if device_id:
        qs = DeviceCommand.objects.filter(device_id=device_id).order_by('-id')[:100]
    return Response(DeviceCommandSerializer(qs, many=True).data)
