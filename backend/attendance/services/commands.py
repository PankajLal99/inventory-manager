"""Queue ADMS device commands (USERINFO register/update/delete — no biometrics)."""

from __future__ import annotations

import logging
import re
from urllib.parse import parse_qs

from django.db import transaction
from django.utils import timezone

from backend.attendance.models import Device, DeviceCommand, DeviceUserMapping

logger = logging.getLogger('attendance.adms')

# Strip chars that break tab-separated ADMS fields.
_NAME_SAFE = re.compile(r'[\t\r\n]+')


def _safe_name(name: str) -> str:
    return _NAME_SAFE.sub(' ', (name or '').strip())[:32] or 'User'


def _safe_pin(pin: str) -> str:
    pin = (pin or '').strip()
    if not pin or not re.fullmatch(r'[0-9A-Za-z]+', pin):
        raise ValueError(f'Invalid device PIN: {pin!r}')
    return pin


def build_userinfo_update(pin: str, name: str, *, privilege: int = 0, card: str = '') -> str:
    """
    Register/update a user on the device without password or fingerprint.

    Real K45/ADMS devices expect DATA UPDATE USERINFO (not datasheet USER ADD).
    Password and FP templates are intentionally omitted.
    """
    pin = _safe_pin(pin)
    name = _safe_name(name)
    card = (card or '').strip()
    # Empty Password= is fine; never send TMP/fingerprint fields.
    return (
        f'DATA UPDATE USERINFO PIN={pin}\tName={name}\tPrivilege={privilege}'
        f'\tPassword=\tCard={card}'
    )


def build_userinfo_delete(pin: str) -> str:
    pin = _safe_pin(pin)
    return f'DATA DELETE USERINFO PIN={pin}'


def enqueue_command(
    device: Device,
    command_text: str,
    *,
    purpose: str = '',
    related_employee_id: str = '',
    related_pin: str = '',
) -> DeviceCommand:
    cmd = DeviceCommand.objects.create(
        device=device,
        command_text=command_text,
        purpose=purpose,
        related_employee_id=related_employee_id or '',
        related_pin=related_pin or '',
    )
    logger.info(
        'ADMS queued command id=%s device=%s purpose=%s',
        cmd.pk,
        device.serial_number,
        purpose,
    )
    return cmd


def queue_register_or_update_user(
    device: Device,
    pin: str,
    name: str,
    *,
    employee_id: str = '',
) -> DeviceCommand:
    """Push employee identity to device (PIN + Name only)."""
    text = build_userinfo_update(pin, name)
    return enqueue_command(
        device,
        text,
        purpose='USERINFO_UPSERT',
        related_employee_id=employee_id,
        related_pin=pin,
    )


def queue_delete_user(
    device: Device,
    pin: str,
    *,
    employee_id: str = '',
) -> DeviceCommand:
    text = build_userinfo_delete(pin)
    return enqueue_command(
        device,
        text,
        purpose='USERINFO_DELETE',
        related_employee_id=employee_id,
        related_pin=pin,
    )


def sync_mapping_to_device(
    mapping: DeviceUserMapping,
    *,
    old_pin: str | None = None,
) -> list[DeviceCommand]:
    """
    Ensure device has this mapping's PIN+name.

    If old_pin is set and differs, delete old PIN then register new PIN.
    """
    if not mapping.is_active or not mapping.device.is_accepted:
        return []

    cmds: list[DeviceCommand] = []
    name = mapping.employee_name or mapping.employee_id
    new_pin = mapping.device_user_id

    with transaction.atomic():
        if old_pin and old_pin != new_pin:
            cmds.append(
                queue_delete_user(
                    mapping.device, old_pin, employee_id=mapping.employee_id
                )
            )
        cmds.append(
            queue_register_or_update_user(
                mapping.device,
                new_pin,
                name,
                employee_id=mapping.employee_id,
            )
        )
    return cmds


def sync_employee_name_to_devices(employee_id: str, name: str) -> int:
    """Re-push Name for all active mappings of this salary-book employee."""
    count = 0
    mappings = DeviceUserMapping.objects.filter(
        employee_id=employee_id, is_active=True
    ).select_related('device')
    for mapping in mappings:
        if not mapping.device.is_accepted:
            continue
        mapping.employee_name = name
        mapping.save(update_fields=['employee_name', 'updated_at'])
        queue_register_or_update_user(
            mapping.device,
            mapping.device_user_id,
            name,
            employee_id=employee_id,
        )
        count += 1
    return count


def next_pending_command(device: Device) -> DeviceCommand | None:
    with transaction.atomic():
        cmd = (
            DeviceCommand.objects.select_for_update()
            .filter(device=device, status=DeviceCommand.STATUS_PENDING)
            .order_by('id')
            .first()
        )
        if not cmd:
            return None
        cmd.status = DeviceCommand.STATUS_SENT
        cmd.sent_at = timezone.now()
        cmd.save(update_fields=['status', 'sent_at', 'updated_at'])
        return cmd


def acknowledge_command(
    device: Device,
    *,
    command_id: int | None = None,
    return_code: str = '',
    raw_body: str = '',
) -> DeviceCommand | None:
    cmd = None
    if command_id:
        cmd = DeviceCommand.objects.filter(device=device, pk=command_id).first()
    if cmd is None:
        # Fall back to most recent SENT command for this device.
        cmd = (
            DeviceCommand.objects.filter(device=device, status=DeviceCommand.STATUS_SENT)
            .order_by('-sent_at', '-id')
            .first()
        )
    if cmd is None:
        return None

    failed = return_code not in ('', '0', 'OK', 'ok')
    cmd.status = DeviceCommand.STATUS_FAILED if failed else DeviceCommand.STATUS_ACKED
    cmd.result_code = (return_code or '')[:32]
    cmd.result_payload = (raw_body or '')[:2000]
    cmd.acked_at = timezone.now()
    cmd.save(
        update_fields=['status', 'result_code', 'result_payload', 'acked_at', 'updated_at']
    )
    logger.info(
        'ADMS command ack id=%s device=%s status=%s return=%s',
        cmd.pk,
        device.serial_number,
        cmd.status,
        return_code,
    )
    return cmd


def parse_devicecmd_body(body: str, query: dict) -> tuple[int | None, str]:
    """Extract command id and Return code from device ACK."""
    command_id = None
    return_code = ''

    for key in ('ID', 'id', 'CmdID', 'cmdid'):
        raw = query.get(key)
        if raw:
            try:
                command_id = int(str(raw).lstrip('C:').split(':')[0])
            except (TypeError, ValueError):
                pass
            if command_id:
                break

    for key in ('Return', 'return', 'Result', 'result'):
        if query.get(key) is not None:
            return_code = str(query.get(key))
            break

    # Body may be ID=12&Return=0 or plain text.
    if body and ('=' in body or '&' in body):
        parsed = parse_qs(body, keep_blank_values=True)
        if command_id is None:
            for key in ('ID', 'id', 'CmdID'):
                vals = parsed.get(key) or []
                if vals:
                    try:
                        command_id = int(str(vals[0]).lstrip('C:').split(':')[0])
                    except (TypeError, ValueError):
                        pass
        if not return_code:
            for key in ('Return', 'return', 'Result'):
                vals = parsed.get(key) or []
                if vals:
                    return_code = str(vals[0])
                    break

    # Sometimes body starts with C:12:...
    if command_id is None and body:
        m = re.match(r'C:(\d+):', body.strip())
        if m:
            command_id = int(m.group(1))

    return command_id, return_code
