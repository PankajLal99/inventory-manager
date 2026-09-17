"""Device lookup and registration for ADMS."""

from __future__ import annotations

import logging
import os

from django.utils import timezone

from backend.attendance.models import Device

logger = logging.getLogger('attendance.adms')


def auto_approve_enabled() -> bool:
    return os.getenv('ATTENDANCE_AUTO_APPROVE_DEVICES', 'false').lower() in (
        '1',
        'true',
        'yes',
        'on',
    )


def client_ip(request) -> str | None:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip() or None
    return request.META.get('REMOTE_ADDR') or None


def touch_device(device: Device, *, ip: str | None = None, info: str | None = None) -> Device:
    updates = ['last_seen_at', 'updated_at']
    device.last_seen_at = timezone.now()
    if ip:
        device.ip_address = ip
        updates.append('ip_address')
    if info:
        _apply_info_fields(device, info, updates)
    device.save(update_fields=updates)
    return device


def _apply_info_fields(device: Device, info: str, updates: list[str]) -> None:
    """Best-effort parse of getrequest INFO=Firmware=...,PushVersion=... style strings."""
    for part in info.replace(',', '~').split('~'):
        if '=' not in part:
            continue
        key, value = part.split('=', 1)
        key = key.strip().lower()
        value = value.strip()
        if not value:
            continue
        if key in ('firmware', 'fwversion', 'ver') and not device.firmware_version:
            device.firmware_version = value[:64]
            updates.append('firmware_version')
        elif key in ('platform',) and not device.platform:
            device.platform = value[:64]
            updates.append('platform')
        elif key in ('pushversion', 'push_service', 'pushver') and not device.push_service_version:
            device.push_service_version = value[:64]
            updates.append('push_service_version')


def resolve_device(serial_number: str, *, ip: str | None = None, info: str | None = None) -> Device | None:
    """
    Return an accepted Device for ADMS processing, or None if attendance must not be stored.

    Unknown serials are recorded as PENDING (or ACTIVE when auto-approve is on).
    """
    sn = (serial_number or '').strip()
    if not sn:
        return None

    device = Device.objects.filter(serial_number=sn).first()
    if device is None:
        is_auto = auto_approve_enabled()
        device = Device.objects.create(
            serial_number=sn,
            device_name=sn,
            ip_address=ip,
            status=Device.STATUS_ACTIVE if is_auto else Device.STATUS_PENDING,
            is_active=is_auto,
            last_seen_at=timezone.now(),
        )
        logger.info(
            'ADMS new device serial=%s auto_approve=%s status=%s',
            sn,
            is_auto,
            device.status,
        )
        if info:
            touch_device(device, ip=ip, info=info)
        return device if device.is_accepted else None

    touch_device(device, ip=ip, info=info)
    if not device.is_accepted:
        logger.warning(
            'ADMS rejected inactive/pending device serial=%s status=%s',
            sn,
            device.status,
        )
        return None
    return device
