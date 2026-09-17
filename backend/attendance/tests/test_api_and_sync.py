"""API + end-to-end sync tests for device mappings and hardware attendance."""

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from backend.attendance.models import AttendanceEvent, Device, DeviceCommand, DeviceUserMapping
from backend.attendance.services.commands import (
    build_userinfo_update,
    sync_employee_name_to_devices,
)
from backend.salary_book.models import Attendance, Employee, SalaryBookSettings
from backend.salary_book.permissions import SALARY_BOOK_GROUP

User = get_user_model()
DEVICE_SN = 'WED3253601172'
FIXTURE = '2\t2026-09-17 09:05:00\t0\t1\t0\t0\t0\t0\t0\t0'
FIXTURE_OUT = '2\t2026-09-17 18:10:00\t0\t1\t0\t0\t0\t0\t0\t0'


class DeviceMappingApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser('sbadmin', 'a@t.com', 'pass12345')
        self.user = User.objects.create_user('sbuser', password='pass12345')
        g, _ = Group.objects.get_or_create(name=SALARY_BOOK_GROUP)
        self.user.groups.add(g)

        self.device = Device.objects.create(
            serial_number=DEVICE_SN,
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )
        self.emp = Employee.objects.create(
            employee_id='EMP-001',
            name='ROHIT',
            mobile='9876543210',
            date_of_joining=date(2025, 1, 1),
            monthly_salary=Decimal('30000'),
        )
        settings = SalaryBookSettings.get_solo()
        settings.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        settings.save()

    def test_list_devices_requires_auth(self):
        res = self.client.get(reverse('salary-book-device-list'))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_devices(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.get(reverse('salary-book-device-list'))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['serial_number'], DEVICE_SN)

    def test_non_admin_cannot_create_mapping(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.post(
            reverse('salary-book-mapping-list'),
            {
                'device': self.device.id,
                'device_user_id': '2',
                'employee_id': 'EMP-001',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_create_mapping_queues_userinfo(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            reverse('salary-book-mapping-list'),
            {
                'device': self.device.id,
                'device_user_id': '2',
                'employee_id': 'EMP-001',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['employee_name'], 'ROHIT')
        self.assertEqual(DeviceUserMapping.objects.count(), 1)
        cmd = DeviceCommand.objects.get()
        self.assertEqual(cmd.purpose, 'USERINFO_UPSERT')
        self.assertIn('PIN=2', cmd.command_text)
        self.assertIn('Name=ROHIT', cmd.command_text)
        self.assertIn('Password=', cmd.command_text)
        self.assertNotIn('TMP=', cmd.command_text)

    def test_admin_create_rejects_unknown_employee(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.post(
            reverse('salary-book-mapping-list'),
            {
                'device': self.device.id,
                'device_user_id': '9',
                'employee_id': 'EMP-999',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_pin_change_queues_delete_and_update(self):
        self.client.force_authenticate(user=self.admin)
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()
        res = self.client.patch(
            reverse('salary-book-mapping-detail', args=[mapping.id]),
            {'device_user_id': '7'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        texts = list(DeviceCommand.objects.order_by('id').values_list('command_text', flat=True))
        self.assertEqual(len(texts), 2)
        self.assertIn('DATA DELETE USERINFO PIN=2', texts[0])
        self.assertIn('PIN=7', texts[1])
        self.assertIn('Name=ROHIT', texts[1])

    def test_admin_delete_mapping_queues_device_delete(self):
        self.client.force_authenticate(user=self.admin)
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()
        res = self.client.delete(reverse('salary-book-mapping-detail', args=[mapping.id]))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(DeviceUserMapping.objects.count(), 0)
        cmd = DeviceCommand.objects.get()
        self.assertEqual(cmd.purpose, 'USERINFO_DELETE')
        self.assertIn('PIN=2', cmd.command_text)

    def test_sync_endpoint_requeues(self):
        self.client.force_authenticate(user=self.admin)
        mapping = DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()
        res = self.client.post(reverse('salary-book-mapping-sync', args=[mapping.id]))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['queued'], 1)

    def test_sync_all_mappings(self):
        self.client.force_authenticate(user=self.admin)
        DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()
        res = self.client.post(
            reverse('salary-book-device-sync-mappings', args=[self.device.id])
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['queued'], 1)


class EmployeeNameSyncTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser('sbadmin2', 'b@t.com', 'pass12345')
        self.device = Device.objects.create(
            serial_number=DEVICE_SN,
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )
        self.emp = Employee.objects.create(
            employee_id='EMP-001',
            name='ROHIT',
            mobile='9876543210',
            date_of_joining=date(2025, 1, 1),
            monthly_salary=Decimal('30000'),
        )
        DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        DeviceCommand.objects.all().delete()

    def test_rename_employee_queues_name_update(self):
        self.client.force_authenticate(user=self.admin)
        res = self.client.patch(
            reverse('salary-book-employee-detail', args=[self.emp.id]),
            {'name': 'ROHIT SHARMA'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        cmd = DeviceCommand.objects.latest('id')
        self.assertIn('Name=ROHIT SHARMA', cmd.command_text)
        self.assertIn('PIN=2', cmd.command_text)
        mapping = DeviceUserMapping.objects.get()
        self.assertEqual(mapping.employee_name, 'ROHIT SHARMA')

    def test_sync_employee_name_helper(self):
        n = sync_employee_name_to_devices('EMP-001', 'NEW NAME')
        self.assertEqual(n, 1)
        self.assertIn('Name=NEW NAME', DeviceCommand.objects.get().command_text)


class HardwareBridgeE2ETests(APITestCase):
    def setUp(self):
        self.device = Device.objects.create(
            serial_number=DEVICE_SN,
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )
        self.emp = Employee.objects.create(
            employee_id='EMP-001',
            name='ROHIT',
            mobile='9876543210',
            date_of_joining=date(2025, 1, 1),
            monthly_salary=Decimal('30000'),
            expected_check_in='09:00',
            expected_check_out='18:00',
        )
        DeviceUserMapping.objects.create(
            device=self.device,
            device_user_id='2',
            employee_id='EMP-001',
            employee_name='ROHIT',
        )
        settings = SalaryBookSettings.get_solo()
        settings.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        settings.default_check_in = '09:00'
        settings.default_check_out = '18:00'
        settings.save()

    def test_full_day_timetable_from_two_punches(self):
        url = f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999'
        self.client.post(url, data=FIXTURE, content_type='text/plain')
        self.client.post(url, data=FIXTURE_OUT, content_type='text/plain')

        self.assertEqual(AttendanceEvent.objects.count(), 2)
        att = Attendance.objects.get(employee=self.emp, date=date(2026, 9, 17))
        self.assertEqual(att.attendance_method, Attendance.METHOD_HARDWARE)
        self.assertEqual(att.status, Attendance.STATUS_PRESENT)
        self.assertIsNotNone(att.check_in_time)
        self.assertIsNotNone(att.check_out_time)
        from django.utils import timezone as dj_tz

        cin = dj_tz.localtime(att.check_in_time)
        cout = dj_tz.localtime(att.check_out_time)
        self.assertEqual(cin.hour, 9)
        self.assertEqual(cin.minute, 5)
        self.assertEqual(cout.hour, 18)
        self.assertEqual(cout.minute, 10)
        self.assertGreater(att.worked_minutes, 0)
        self.assertGreaterEqual(att.minutes_late, 0)

    def test_manual_mode_stores_event_without_salary_row(self):
        settings = SalaryBookSettings.get_solo()
        settings.attendance_capture_mode = SalaryBookSettings.CAPTURE_MANUAL
        settings.save()
        self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE,
            content_type='text/plain',
        )
        self.assertEqual(AttendanceEvent.objects.count(), 1)
        self.assertEqual(Attendance.objects.count(), 0)

    def test_inactive_mapping_does_not_bridge(self):
        DeviceUserMapping.objects.update(is_active=False)
        self.client.post(
            f'/iclock/cdata?SN={DEVICE_SN}&table=ATTLOG&Stamp=9999',
            data=FIXTURE,
            content_type='text/plain',
        )
        self.assertEqual(AttendanceEvent.objects.count(), 1)
        self.assertEqual(Attendance.objects.count(), 0)


class CommandSafetyTests(APITestCase):
    def test_name_sanitized(self):
        cmd = build_userinfo_update('1', 'A\tB\nC')
        self.assertNotIn('\tName=A\tB', cmd)
        self.assertIn('Name=A B C', cmd)

    def test_invalid_pin_rejected(self):
        with self.assertRaises(ValueError):
            build_userinfo_update('12 3', 'X')

    def test_failed_return_marks_command_failed(self):
        device = Device.objects.create(
            serial_number=DEVICE_SN,
            status=Device.STATUS_ACTIVE,
            is_active=True,
        )
        cmd = DeviceCommand.objects.create(
            device=device,
            command_text=build_userinfo_update('1', 'X'),
            purpose='USERINFO_UPSERT',
            related_pin='1',
        )
        self.client.get('/iclock/getrequest', {'SN': DEVICE_SN})
        self.client.post(
            f'/iclock/devicecmd?SN={DEVICE_SN}&ID={cmd.pk}&Return=-1002',
            data=f'ID={cmd.pk}&Return=-1002',
            content_type='text/plain',
        )
        cmd.refresh_from_db()
        self.assertEqual(cmd.status, DeviceCommand.STATUS_FAILED)
        self.assertEqual(cmd.result_code, '-1002')

    def test_inactive_device_does_not_receive_commands(self):
        device = Device.objects.create(
            serial_number='INACTIVE1',
            status=Device.STATUS_INACTIVE,
            is_active=False,
        )
        DeviceCommand.objects.create(
            device=device,
            command_text=build_userinfo_update('1', 'X'),
            purpose='USERINFO_UPSERT',
        )
        res = self.client.get('/iclock/getrequest', {'SN': 'INACTIVE1'})
        self.assertEqual(res.content.decode(), 'OK')
        self.assertEqual(
            DeviceCommand.objects.get().status, DeviceCommand.STATUS_PENDING
        )
