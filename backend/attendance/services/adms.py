"""ZKTeco iClock ADMS protocol response helpers."""

from __future__ import annotations


def ok_response(count: int | None = None) -> str:
    if count is None:
        return 'OK'
    return f'OK:{count}'


def getrequest_idle() -> str:
    """No pending device commands."""
    return 'OK'


def getrequest_command(wire_payload: str) -> str:
    """Deliver one queued command to the device."""
    return wire_payload


def cdata_options(serial_number: str) -> str:
    """
    Configuration handshake returned to GET /iclock/cdata.

    Stamp values of 9999 match what the K45 Pro was observed sending back.
    """
    sn = serial_number or ''
    return (
        f'GET OPTION FROM: {sn}\n'
        'Stamp=9999\n'
        'OpStamp=9999\n'
        'ErrorDelay=60\n'
        'Delay=30\n'
        'TransTimes=00:00;14:00\n'
        'TransInterval=1\n'
        'TransFlag=1111000000\n'
        'TimeZone=5.5\n'
        'Realtime=1\n'
        'Encrypt=0\n'
    )


def plaintext(body: str, status: int = 200):
    from django.http import HttpResponse

    return HttpResponse(body, content_type='text/plain', status=status)
