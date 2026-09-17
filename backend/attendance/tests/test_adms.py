"""ADMS protocol and ATTLOG parser tests using captured K45 Pro fixtures."""

from datetime import date
from decimal import Decimal
import os

from django.test import TestCase
from django.utils import timezone

from backend.attendance.models import AttendanceEvent, Device, DeviceUserMapping
from backend.attendance.services.parser import (
    AttLogParseError,
    compute_event_hash,
    parse_attlog_line,
    redact_operlog,
)
from backend.salary_book.models import Attendance, Employee, SalaryBookSettings

# Captured from ZKTeco K45 Pro (plan.md)
FIXTURE_ATTLOG_1 = '1\t2026-09-17 13:22:40\t0\t2\t0\t0\t0\t0\t0\t0'
FIXTURE_ATTLOG_2 = '2\t2026-09-17 13:23:32\t0\t1\t0\t0\t0\t0\t0\t0'
DEVICE_SN = 'WED3253601172'


class ParserTests(TestCase):
    def test_parse_real_fixture(self):
        parsed = parse_attlog_line(FIXTURE_ATTLOG_1)
        self.assertEqual(parsed.device_user_id, '1')
        self.assertEqual(parsed.status, 0)
        self.assertEqual(parsed.verify_mode, 2)
        self.assertEqual(parsed.work_code, 0)
        self.assertEqual(parsed.raw_payload, FIXTURE_ATTLOG_1)
        local = timezone.localtime(parsed.punch_datetime)
        self.assertEqual(local.year, 2026)
        self.assertEqual(local.month, 9)
        self.assertEqual(local.day, 17)
        self.assertEqual(local.hour, 13)
        self.assertEqual(local.minute, 22)

    def test_event_hash_stable(self):
        parsed = parse_attlog_line(FIXTURE_ATTLOG_1)
        h1 = compute_event_hash(
            DEVICE_SN,
            parsed.device_user_id,
            parsed.punch_datetime,
            parsed.status,
            parsed.verify_mode,
            parsed.work_code,
        )
        h2 = compute_event_hash(
            DEVICE_SN,
            parsed.device_user_id,
            parsed.punch_datetime,
            parsed.status,
            parsed.verify_mode,
            parsed.work_code,
        )
        self.assertEqual(h1, h2)
        self.assertEqual(len(h1), 64)

    def test_malformed_line(self):
        with self.assertRaises(AttLogParseError):
            parse_attlog_line('1\tbad-ts\t0\t2\t0')

    def test_redact_operlog_tmp(self):
        raw = 'FP PIN=2 FID=6 Size=1240 Valid=1 TMP=ABCDEF1234'
        redacted = redact_operlog(raw)
        self.assertIn('TMP=[REDACTED]', redacted)
        self.assertNotIn('ABCDEF', redacted)


class AdmsEndpointTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(
            serial_number=DEVICE_SN,
            device_name='K45 Pro',
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )

    def test_get_cdata(self):
        res = self.client.get('/iclock/cdata', {'SN': DEVICE_SN})
        self.assertEqual(res.status_code, 200)
        body = res.content.decode()
        self.assertIn('GET OPTION FROM:', body)
        self.assertIn(DEVICE_SN, body)
        self.device.refresh_from_db()
        self.assertIsNotNone(self.device.last_seen_at)

    def test_getrequest(self):
        res = self.client.get(
            '/iclock/getrequest',
            {'SN': DEVICE_SN, 'INFO': 'Firmware=8.0.4.2,PushVersion=2.0.333'},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content.decode(), 'OK')

    def test_post_attlog_creates_event(self):
        res = self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE_ATTLOG_1,
            content_type='text/plain',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AttendanceEvent.objects.count(), 1)
        event = AttendanceEvent.objects.get()
        self.assertEqual(event.device_user_id, '1')
        self.assertEqual(event.verify_mode, 2)
        self.device.refresh_from_db()
        self.assertIsNotNone(self.device.last_attendance_at)

    def test_post_attlog_duplicate_idempotent(self):
        url = f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999'
        self.client.post(url, data=FIXTURE_ATTLOG_1, content_type='text/plain')
        self.client.post(url, data=FIXTURE_ATTLOG_1, content_type='text/plain')
        self.assertEqual(AttendanceEvent.objects.count(), 1)

    def test_post_multiple_attlog_lines(self):
        body = FIXTURE_ATTLOG_1 + '\n' + FIXTURE_ATTLOG_2
        res = self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=body,
            content_type='text/plain',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AttendanceEvent.objects.count(), 2)

    def test_unknown_device_does_not_persist(self):
        res = self.client.post(
            '/iclock/cdata?SN=UNKNOWN999&table=ATTLOG&Stamp=9999',
            data=FIXTURE_ATTLOG_1,
            content_type='text/plain',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AttendanceEvent.objects.count(), 0)
        pending = Device.objects.get(serial_number='UNKNOWN999')
        self.assertEqual(pending.status, Device.STATUS_PENDING)
        self.assertFalse(pending.is_active)

    def test_auto_approve_unknown_device(self):
        os.environ['ATTENDANCE_AUTO_APPROVE_DEVICES'] = 'true'
        try:
            res = self.client.post(
                '/iclock/cdata?SN=AUTOAPPROVE1&table=ATTLOG&Stamp=9999',
                data=FIXTURE_ATTLOG_1,
                content_type='text/plain',
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(AttendanceEvent.objects.count(), 1)
            device = Device.objects.get(serial_number='AUTOAPPROVE1')
            self.assertTrue(device.is_active)
        finally:
            os.environ.pop('ATTENDANCE_AUTO_APPROVE_DEVICES', None)

    def test_operlog_tmp_not_stored(self):
        body = 'FP PIN=2 FID=6 Size=1240 Valid=1 TMP=SECRETTEMPLATE'
        res = self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=OPERLOG&OpStamp=9999',
            data=body,
            content_type='text/plain',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AttendanceEvent.objects.count(), 0)
        self.device.refresh_from_db()
        self.assertNotIn('SECRETTEMPLATE', str(self.device.__dict__))

    def test_devicecmd(self):
        res = self.client.post(f'/iclock/devicecmd?SN={DEVICE_SN}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content.decode(), 'OK')

    def test_health(self):
        res = self.client.get('/health/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['status'], 'ok')


class BridgeTests(TestCase):
    def setUp(self):
        self.settings = SalaryBookSettings.get_solo()
        self.settings.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        self.settings.save()

        self.device = Device.objects.create(
            serial_number=DEVICE_SN,
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )
        self.employee = Employee.objects.create(
            employee_id='EMP-001',
            name='Test Worker',
            mobile='9876543210',
            date_of_joining=date(2025, 1, 1),
            monthly_salary=Decimal('30000'),
            status=Employee.STATUS_ACTIVE,
        )
        DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='1',
            employee_id='EMP-001',
            employee_name='Test Worker',
        )

    def test_first_punch_creates_check_in(self):
        self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE_ATTLOG_1,
            content_type='text/plain',
        )
        att = Attendance.objects.get(employee=self.employee)
        self.assertEqual(att.status, Attendance.STATUS_PRESENT)
        self.assertEqual(att.attendance_method, Attendance.METHOD_HARDWARE)
        self.assertIsNotNone(att.check_in_time)
        self.assertIsNone(att.check_out_time)

    def test_second_punch_sets_check_out(self):
        line1 = '1\t2026-09-17 09:00:00\t0\t2\t0\t0\t0\t0\t0\t0'
        line2 = '1\t2026-09-17 18:00:00\t0\t2\t0\t0\t0\t0\t0\t0'
        url = f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999'
        self.client.post(url, data=line1, content_type='text/plain')
        self.client.post(url, data=line2, content_type='text/plain')
        att = Attendance.objects.get(employee=self.employee)
        self.assertIsNotNone(att.check_in_time)
        self.assertIsNotNone(att.check_out_time)
        self.assertGreater(att.check_out_time, att.check_in_time)
        self.assertGreater(att.worked_minutes, 0)

    def test_geo_mode_does_not_bridge(self):
        self.settings.attendance_capture_mode = SalaryBookSettings.CAPTURE_GEO
        self.settings.save()
        self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE_ATTLOG_1,
            content_type='text/plain',
        )
        self.assertEqual(AttendanceEvent.objects.count(), 1)
        self.assertEqual(Attendance.objects.count(), 0)

    def test_unmapped_user_skips_bridge(self):
        self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE_ATTLOG_2,  # user 2 unmapped
            content_type='text/plain',
        )
        self.assertEqual(AttendanceEvent.objects.count(), 1)
        self.assertEqual(Attendance.objects.count(), 0)

    def test_leave_status_not_overwritten(self):
        Attendance.objects.create(
            employee=self.employee,
            date=date(2026, 9, 17),
            status=Attendance.STATUS_PAID_LEAVE,
            attendance_method=Attendance.METHOD_MANUAL,
        )
        self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE_ATTLOG_1,
            content_type='text/plain',
        )
        att = Attendance.objects.get(employee=self.employee)
        self.assertEqual(att.status, Attendance.STATUS_PAID_LEAVE)
        self.assertIsNone(att.check_in_time)
