"""ZKTeco iClock ADMS HTTP endpoints (no JWT / CSRF)."""

from __future__ import annotations

import logging

from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from backend.attendance.services import adms as adms_proto
from backend.attendance.services.attendance import persist_attlog
from backend.attendance.services.devices import client_ip, resolve_device, touch_device
from backend.attendance.services.parser import redact_operlog
from backend.attendance.models import Device

logger = logging.getLogger('attendance.adms')


def _sn(request) -> str:
    return (request.GET.get('SN') or request.POST.get('SN') or '').strip()


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def cdata(request):
    sn = _sn(request)
    ip = client_ip(request)
    table = (request.GET.get('table') or '').strip().upper()

    if request.method == 'GET':
        device = resolve_device(sn, ip=ip) if sn else None
        # Handshake even for pending devices so they can be approved later.
        if sn and device is None:
            pending = Device.objects.filter(serial_number=sn).first()
            if pending:
                touch_device(pending, ip=ip)
        return adms_proto.plaintext(adms_proto.cdata_options(sn))

    # POST
    if not sn:
        logger.warning('ADMS POST /iclock/cdata missing SN')
        return adms_proto.plaintext(adms_proto.ok_response(), status=200)

    body = request.body.decode('utf-8', errors='replace')
    device = resolve_device(sn, ip=ip)

    if table == 'ATTLOG':
        if device is None:
            # Do not ACK as stored — return OK so device does not wedge, but log.
            # Plan: unknown/pending devices must not persist attendance.
            logger.warning('ADMS ATTLOG ignored for unaccepted device SN=%s', sn)
            return adms_proto.plaintext(adms_proto.ok_response())
        created, duplicates, errors = persist_attlog(device, body, source_ip=ip)
        if errors and created == 0 and duplicates == 0:
            logger.warning(
                'ADMS ATTLOG parse/persist errors SN=%s errors=%s',
                sn,
                errors[:5],
            )
            # Temporary failure / all bad — do not falsely ACK if nothing usable.
            # Malformed-only: still OK so device continues; duplicates OK.
            return adms_proto.plaintext(adms_proto.ok_response(), status=200)
        total_ack = created + duplicates
        return adms_proto.plaintext(adms_proto.ok_response(total_ack if total_ack else None))

    if table == 'OPERLOG':
        safe = redact_operlog(body)
        logger.info(
            'ADMS OPERLOG acknowledged SN=%s bytes=%s preview=%s',
            sn,
            len(body),
            (safe[:200] + '…') if len(safe) > 200 else safe,
        )
        if device:
            touch_device(device, ip=ip)
        return adms_proto.plaintext(adms_proto.ok_response())

    logger.warning('ADMS unknown table=%s SN=%s', table or '(none)', sn)
    if device:
        touch_device(device, ip=ip)
    return adms_proto.plaintext(adms_proto.ok_response())


@csrf_exempt
@require_http_methods(['GET'])
def getrequest(request):
    sn = _sn(request)
    info = request.GET.get('INFO') or ''
    ip = client_ip(request)
    device = None
    if sn:
        device = Device.objects.filter(serial_number=sn).first()
        if device:
            touch_device(device, ip=ip, info=info)
        else:
            device = resolve_device(sn, ip=ip, info=info)

    if device and device.is_accepted:
        from backend.attendance.services.commands import next_pending_command

        cmd = next_pending_command(device)
        if cmd:
            logger.info(
                'ADMS delivering command id=%s device=%s purpose=%s',
                cmd.pk,
                sn,
                cmd.purpose,
            )
            return adms_proto.plaintext(adms_proto.getrequest_command(cmd.wire_payload()))

    return adms_proto.plaintext(adms_proto.getrequest_idle())


@csrf_exempt
@require_http_methods(['POST'])
def devicecmd(request):
    sn = _sn(request)
    ip = client_ip(request)
    body = request.body.decode('utf-8', errors='replace')
    device = None
    if sn:
        device = Device.objects.filter(serial_number=sn).first()
        if device:
            touch_device(device, ip=ip)
        else:
            device = resolve_device(sn, ip=ip)

    if device:
        from backend.attendance.services.commands import (
            acknowledge_command,
            parse_devicecmd_body,
        )

        command_id, return_code = parse_devicecmd_body(body, request.GET)
        acknowledge_command(
            device,
            command_id=command_id,
            return_code=return_code,
            raw_body=body,
        )

    logger.info('ADMS /iclock/devicecmd SN=%s', sn or '(none)')
    return adms_proto.plaintext(adms_proto.ok_response())


@csrf_exempt
@require_http_methods(['GET'])
def health(request):
    from django.db import connection
    from django.http import JsonResponse

    db_ok = True
    try:
        connection.ensure_connection()
    except Exception:
        db_ok = False
    status_code = 200 if db_ok else 503
    return JsonResponse({'status': 'ok' if db_ok else 'degraded', 'database': db_ok}, status=status_code)
