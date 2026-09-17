"""ATTLOG parser for ZKTeco iClock ADMS push payloads."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime

from django.utils import timezone


ATTLOG_TIMESTAMP_FORMAT = '%Y-%m-%d %H:%M:%S'


@dataclass(frozen=True)
class ParsedAttLog:
    device_user_id: str
    punch_datetime: datetime
    status: int
    verify_mode: int
    work_code: int
    raw_payload: str


class AttLogParseError(ValueError):
    pass


def compute_event_hash(
    serial_number: str,
    device_user_id: str,
    punch_datetime: datetime,
    status: int,
    verify_mode: int,
    work_code: int,
) -> str:
    ts = punch_datetime.strftime(ATTLOG_TIMESTAMP_FORMAT)
    payload = (
        f'{serial_number}|{device_user_id}|{ts}|{status}|{verify_mode}|{work_code}'
    )
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def _parse_int(value: str, field_name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise AttLogParseError(f'Invalid {field_name}: {value!r}') from exc


def parse_attlog_line(line: str) -> ParsedAttLog:
    """Parse one tab-separated ATTLOG line. Extra fields are allowed."""
    raw = (line or '').strip()
    if not raw:
        raise AttLogParseError('Empty ATTLOG line')

    parts = raw.split('\t')
    if len(parts) < 5:
        raise AttLogParseError(
            f'ATTLOG line needs at least 5 fields, got {len(parts)}: {raw!r}'
        )

    device_user_id = parts[0].strip()
    if not device_user_id:
        raise AttLogParseError('Missing device user ID')

    try:
        naive = datetime.strptime(parts[1].strip(), ATTLOG_TIMESTAMP_FORMAT)
    except ValueError as exc:
        raise AttLogParseError(f'Invalid timestamp: {parts[1]!r}') from exc

    punch_datetime = timezone.make_aware(naive, timezone.get_current_timezone())

    return ParsedAttLog(
        device_user_id=device_user_id,
        punch_datetime=punch_datetime,
        status=_parse_int(parts[2].strip(), 'status'),
        verify_mode=_parse_int(parts[3].strip(), 'verify_mode'),
        work_code=_parse_int(parts[4].strip(), 'work_code'),
        raw_payload=raw,
    )


def parse_attlog_body(body: str) -> list[ParsedAttLog]:
    """Parse a multi-line ATTLOG POST body. Skips blank lines."""
    records: list[ParsedAttLog] = []
    for line in (body or '').splitlines():
        if not line.strip():
            continue
        records.append(parse_attlog_line(line))
    return records


def redact_operlog(body: str) -> str:
    """Redact biometric TMP fields from OPERLOG payloads for safe logging."""
    if not body:
        return body
    lines = []
    for line in body.splitlines():
        if 'TMP=' in line.upper() or 'TMP=' in line:
            # Case-insensitive TMP= redaction while preserving other fields.
            upper = line.upper()
            idx = upper.find('TMP=')
            if idx >= 0:
                lines.append(line[:idx] + 'TMP=[REDACTED]')
            else:
                lines.append(line)
        else:
            lines.append(line)
    return '\n'.join(lines)
