from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from io import BytesIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from PIL import Image

from backend.salary_book.models import (
    Attendance,
    Employee,
    EmployeeAttendanceRule,
    LeaveRecord,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryPayment,
    SalaryRecord,
)
from backend.salary_book.permissions import SALARY_BOOK_GROUP
from backend.salary_book.services.attendance_evaluator import evaluate_check_in
from backend.salary_book.services.salary_calculator import calculate_employee_month

User = get_user_model()


def jpeg_file(name='photo.jpg'):
    buf = BytesIO()
    Image.new('RGB', (80, 80), color='red').save(buf, format='JPEG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/jpeg')


class SalaryBookMixin:
    def make_user(self, username, password='pass12345', group=True, admin=False):
        user = User.objects.create_user(username=username, password=password)
        if admin:
            user.is_superuser = True
            user.save()
        if group:
            g, _ = Group.objects.get_or_create(name=SALARY_BOOK_GROUP)
            user.groups.add(g)
        return user

    def make_employee(self, **kwargs):
        defaults = {
            'name': 'Ramesh Kumar',
            'mobile': '9876543210',
            'date_of_joining': date(2026, 4, 1),
            'monthly_salary': Decimal('15000.00'),
            'salary_calculation_method': Employee.METHOD_FIXED,
            'fixed_working_days': 30,
        }
        defaults.update(kwargs)
        return Employee.objects.create(**defaults)

    gps = {
        'latitude': '23.259900',
        'longitude': '77.412600',
        'location_accuracy': '18',
    }


class AuthTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.allowed = self.make_user('owner')
        self.denied = self.make_user('cashier', group=False)

    def test_login_allowed(self):
        url = reverse('salary-book-login')
        res = self.client.post(url, {'username': 'owner', 'password': 'pass12345'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)

    def test_login_denied_without_group(self):
        url = reverse('salary-book-login')
        res = self.client.post(url, {'username': 'cashier', 'password': 'pass12345'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_api_requires_auth(self):
        res = self.client.get(reverse('salary-book-employee-list-create'))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_api_requires_group(self):
        self.client.force_authenticate(user=self.denied)
        res = self.client.get(reverse('salary-book-employee-list-create'))
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_login_tokens_are_long_lived_and_scoped(self):
        login = self.client.post(reverse('salary-book-login'), {
            'username': 'owner', 'password': 'pass12345',
        })
        access = AccessToken(login.data['access'])
        refresh = RefreshToken(login.data['refresh'])
        self.assertEqual(access['scope'], 'salary_book')
        self.assertEqual(refresh['scope'], 'salary_book')
        self.assertIn('pwd', access)
        self.assertGreaterEqual(access['exp'] - access['iat'], int(timedelta(days=6).total_seconds()))
        self.assertGreaterEqual(refresh['exp'] - refresh['iat'], int(timedelta(days=360).total_seconds()))
        me = self.client.get(
            reverse('salary-book-me'),
            HTTP_AUTHORIZATION=f'Bearer {login.data["access"]}',
        )
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertEqual(me.data['username'], 'owner')

    def test_refresh_keeps_session(self):
        login = self.client.post(reverse('salary-book-login'), {
            'username': 'owner', 'password': 'pass12345',
        })
        refresh = login.data['refresh']
        res = self.client.post(reverse('salary-book-refresh'), {'refresh': refresh})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)

    def test_calendar_admin_and_employee(self):
        emp = self.make_employee(
            expected_check_in=time(9, 0),
            expected_check_out=time(18, 0),
        )
        Attendance.objects.create(
            employee=emp,
            date=date(2026, 8, 1),
            status=Attendance.STATUS_PRESENT,
            check_in_time=_local_dt(date(2026, 8, 1), 9, 30),
            check_out_time=_local_dt(date(2026, 8, 1), 17, 0),
            minutes_late=30,
            is_late=True,
            latitude=Decimal('23.259900'),
            longitude=Decimal('77.412600'),
            location_accuracy=18,
            location_captured_at=datetime(2026, 8, 1, 9, 0, tzinfo=dt_timezone.utc),
        )
        self.client.force_authenticate(user=self.allowed)
        admin = self.client.get(reverse('salary-book-calendar'), {'year': 2026, 'month': 8})
        self.assertEqual(admin.status_code, status.HTTP_200_OK)
        self.assertEqual(admin.data['view'], 'admin')
        self.assertGreaterEqual(admin.data['kpis']['employees'], 1)
        self.assertEqual(admin.data['kpis']['present'], 1)
        self.assertTrue(any(row['id'] == emp.id for row in admin.data['employees']))
        emp_view = self.client.get(reverse('salary-book-calendar'), {
            'year': 2026, 'month': 8, 'employee': emp.id,
        })
        self.assertEqual(emp_view.status_code, status.HTTP_200_OK)
        self.assertEqual(emp_view.data['view'], 'employee')
        self.assertEqual(len(emp_view.data['employees']), 1)
        day1 = emp_view.data['employees'][0]['days']['1']
        self.assertEqual(day1['status'], 'PRESENT')
        self.assertTrue(day1['is_late'])
        self.assertTrue(day1['is_early'])
        self.assertEqual(day1['minutes_early'], 60)
        missing = self.client.get(reverse('salary-book-calendar'), {'employee': 999999})
        self.assertEqual(missing.status_code, status.HTTP_404_NOT_FOUND)

    def test_calendar_admin_rolls_open_cycle_after_payday(self):
        emp = self.make_employee(
            name='Cycle Worker',
            employee_id='EMP-013',
            date_of_joining=date(2025, 1, 13),
            salary_cycle_start_day=13,
        )
        self.client.force_authenticate(user=self.allowed)
        with mock.patch(
            'backend.salary_book.views.timezone.localdate',
            return_value=date(2026, 10, 19),
        ):
            res = self.client.get(
                reverse('salary-book-calendar'),
                {'year': 2026, 'month': 10},
            )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        row = next(r for r in res.data['employees'] if r['id'] == emp.id)
        self.assertEqual(row['period_start'], '2026-10-13')
        self.assertEqual(row['period_end_marker'], '2026-11-13')
        self.assertEqual(row['period_year'], 2026)
        self.assertEqual(row['period_month'], 11)
        self.assertIn('2026-10-13', row['cycle_days'])
        self.assertIn('2026-11-13', row['cycle_days'])
        self.assertNotIn('2026-09-13', row['cycle_days'])

    def test_dashboard_and_reports(self):
        emp = self.make_employee()
        other = self.make_employee(name='Sita Devi', employee_id='EMP-088')
        today = timezone.localdate()
        Attendance.objects.create(
            employee=emp,
            date=date(2026, 8, 1),
            status=Attendance.STATUS_PRESENT,
            latitude=Decimal('23.259900'),
            longitude=Decimal('77.412600'),
            location_accuracy=18,
            location_captured_at=datetime(2026, 8, 1, 9, 0, tzinfo=dt_timezone.utc),
        )
        Attendance.objects.create(
            employee=emp,
            date=today,
            status=Attendance.STATUS_PRESENT,
            check_in_time=timezone.now(),
            latitude=Decimal('23.259900'),
            longitude=Decimal('77.412600'),
            location_accuracy=18,
            location_captured_at=timezone.now(),
        )
        self.client.force_authenticate(user=self.allowed)
        dash = self.client.get(reverse('salary-book-dashboard'))
        self.assertEqual(dash.status_code, status.HTTP_200_OK)
        self.assertIn('today_attendance', dash.data)
        self.assertIn('month', dash.data)
        self.assertIn('live', dash.data)
        marked_ids = [row['employee'] for row in dash.data['live']['marked']]
        unmarked_ids = [row['id'] for row in dash.data['live']['unmarked']]
        self.assertIn(emp.id, marked_ids)
        self.assertIn(other.id, unmarked_ids)
        self.assertEqual(dash.data['live']['marked'][0]['status'], Attendance.STATUS_PRESENT)
        self.assertTrue(dash.data['live']['marked'][0]['check_in_time'])
        self.assertGreaterEqual(dash.data['today_attendance']['unmarked'], 1)
        att = self.client.get(reverse('salary-book-report-attendance'), {'year': 2026, 'month': 8})
        self.assertEqual(att.status_code, status.HTTP_200_OK)
        leaves = self.client.get(reverse('salary-book-report-leaves'), {'year': 2026, 'month': 8})
        self.assertEqual(leaves.status_code, status.HTTP_200_OK)
        adv = self.client.get(reverse('salary-book-report-advances'), {'year': 2026, 'month': 8})
        self.assertEqual(adv.status_code, status.HTTP_200_OK)
        sal = self.client.get(reverse('salary-book-report-salaries'), {'year': 2026, 'month': 8})
        self.assertEqual(sal.status_code, status.HTTP_200_OK)

    def test_profile_update_and_password_change(self):
        self.client.force_authenticate(user=self.allowed)
        me = self.client.get(reverse('salary-book-me'))
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        patched = self.client.patch(reverse('salary-book-me'), {
            'first_name': 'Ramesh',
            'last_name': 'Owner',
            'email': 'owner@example.com',
            'phone': '9876543210',
        }, format='json')
        self.assertEqual(patched.status_code, status.HTTP_200_OK)
        self.assertEqual(patched.data['first_name'], 'Ramesh')
        self.assertEqual(patched.data['phone'], '9876543210')
        changed = self.client.post(reverse('salary-book-change-password'), {
            'current_password': 'pass12345',
            'new_password': 'newpass999',
        }, format='json')
        self.assertEqual(changed.status_code, status.HTTP_200_OK)
        self.assertIn('access', changed.data)
        self.allowed.refresh_from_db()
        self.assertTrue(self.allowed.check_password('newpass999'))
        bad = self.client.post(reverse('salary-book-change-password'), {
            'current_password': 'wrong',
            'new_password': 'another999',
        }, format='json')
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        short = self.client.post(reverse('salary-book-change-password'), {
            'current_password': 'newpass999',
            'new_password': 'short',
        }, format='json')
        self.assertEqual(short.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_change_invalidates_session(self):
        login = self.client.post(reverse('salary-book-login'), {
            'username': 'owner', 'password': 'pass12345',
        })
        access = login.data['access']
        refresh = login.data['refresh']
        self.allowed.set_password('newpass999')
        self.allowed.save()
        me = self.client.get(
            reverse('salary-book-me'),
            HTTP_AUTHORIZATION=f'Bearer {access}',
        )
        self.assertEqual(me.status_code, status.HTTP_401_UNAUTHORIZED)
        res = self.client.post(reverse('salary-book-refresh'), {'refresh': refresh})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)


class EmployeeTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)

    def test_create_and_unique_id(self):
        url = reverse('salary-book-employee-list-create')
        payload = {
            'name': 'Ramesh Kumar',
            'mobile': '9876543210',
            'date_of_joining': '2026-04-01',
            'monthly_salary': '15000.00',
        }
        res = self.client.post(url, payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.data['employee_id'].startswith('EMP-'))
        res2 = self.client.post(url, {**payload, 'employee_id': res.data['employee_id']}, format='json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inactive_omitted_from_active_list(self):
        active = self.make_employee(name='Active Emp')
        self.make_employee(name='Inactive Emp', employee_id='EMP-099', status=Employee.STATUS_INACTIVE)
        res = self.client.get(reverse('salary-book-employee-list-create'), {'status': 'ACTIVE'})
        ids = [row['id'] for row in res.data['results']]
        self.assertIn(active.id, ids)
        self.assertEqual(len(ids), 1)

    def test_delete_removes_employee_and_related_salary_book_data(self):
        emp = self.make_employee(employee_id='EMP-DEL')
        Attendance.objects.create(
            employee=emp,
            date=date(2026, 4, 10),
            status=Attendance.STATUS_ABSENT,
        )
        LeaveRecord.objects.create(
            employee=emp,
            leave_type=LeaveRecord.TYPE_UNPAID,
            start_date=date(2026, 4, 11),
            end_date=date(2026, 4, 11),
            reason='Personal',
            created_by=self.user,
        )
        SalaryAdvance.objects.create(
            employee=emp,
            date=date(2026, 4, 5),
            amount=Decimal('500.00'),
            reason='Advance',
        )
        record = SalaryRecord.objects.create(
            employee=emp,
            year=2026,
            month=4,
            gross_salary=Decimal('15000.00'),
            net_salary=Decimal('14500.00'),
            calculation_method=SalaryBookSettings.METHOD_FIXED,
            divisor_days=30,
            daily_salary=Decimal('500.0000'),
        )
        SalaryPayment.objects.create(
            employee=emp,
            salary_record=record,
            amount=Decimal('1000.00'),
            payment_date=date(2026, 4, 20),
            payment_mode=SalaryPayment.MODE_CASH,
        )
        url = reverse('salary-book-employee-detail', args=[emp.id])
        res = self.client.delete(url)
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Employee.objects.filter(pk=emp.id).exists())
        self.assertEqual(Attendance.objects.filter(employee_id=emp.id).count(), 0)
        self.assertEqual(LeaveRecord.objects.filter(employee_id=emp.id).count(), 0)
        self.assertEqual(SalaryAdvance.objects.filter(employee_id=emp.id).count(), 0)
        self.assertEqual(SalaryRecord.objects.filter(employee_id=emp.id).count(), 0)
        self.assertEqual(SalaryPayment.objects.filter(employee_id=emp.id).count(), 0)


class AttendanceGpsTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.office_latitude = Decimal('23.259900')
        settings_obj.office_longitude = Decimal('77.412600')
        settings_obj.geofence_radius_meters = 150
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_GEO
        settings_obj.save()

    def test_reject_without_gps(self):
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'ABSENT',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_poor_accuracy(self):
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'ABSENT',
            **self.gps,
            'location_accuracy': '250',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_present_requires_photo(self):
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'PRESENT',
            **self.gps,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_present_with_gps_and_photo(self):
        url = reverse('salary-book-attendance-list-create')
        data = {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'PRESENT',
            **self.gps,
            'photo': jpeg_file(),
        }
        res = self.client.post(url, data, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Attendance.objects.filter(employee=self.emp, date='2026-04-10').count(), 1)
        att = Attendance.objects.get(employee=self.emp, date='2026-04-10')
        from backend.core.storage import ProductImageStorage, SalaryBookImageStorage
        self.assertIsInstance(att.photo.storage, SalaryBookImageStorage)
        self.assertEqual(att.photo.storage.container, ProductImageStorage().container)
        self.assertTrue(att.photo.storage.folder.startswith('mt-images'))
        self.assertTrue(att.photo.name)

    def test_duplicate_attendance(self):
        url = reverse('salary-book-attendance-list-create')
        payload = {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'ABSENT',
            **self.gps,
        }
        first = self.client.post(url, payload, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post(url, payload, format='json')
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_attendance_rejected_before_date_of_joining(self):
        self.emp.date_of_joining = date(2026, 4, 16)
        self.emp.save(update_fields=['date_of_joining'])
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'ABSENT',
            **self.gps,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('date of joining', res.data.get('error', '').lower())
        self.assertEqual(Attendance.objects.filter(employee=self.emp, date='2026-04-10').count(), 0)

    def test_absent_rejected_outside_geofence(self):
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-12',
            'status': 'ABSENT',
            'latitude': '28.613900',
            'longitude': '77.209000',
            'location_accuracy': '18',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_stale_gps_rejected(self):
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-13',
            'status': 'ABSENT',
            **self.gps,
            'location_captured_at': '2026-04-13T08:00:00+05:30',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('stale', res.data.get('error', '').lower())

    def test_present_rejected_outside_geofence(self):
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-11',
            'status': 'PRESENT',
            'latitude': '28.613900',
            'longitude': '77.209000',
            'location_accuracy': '18',
            'photo': jpeg_file(),
        }, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('away from the office', res.data.get('error', '').lower())

    def test_admin_can_disable_location_attendance(self):
        self.user.is_superuser = True
        self.user.save()
        url = reverse('salary-book-settings')
        res = self.client.patch(url, {'require_gps': False}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        settings_obj = SalaryBookSettings.get_solo()
        self.assertFalse(settings_obj.require_gps)
        self.assertEqual(settings_obj.attendance_capture_mode, SalaryBookSettings.CAPTURE_MANUAL)

    def test_admin_can_set_hardware_mode(self):
        self.user.is_superuser = True
        self.user.save()
        url = reverse('salary-book-settings')
        res = self.client.patch(
            url, {'attendance_capture_mode': SalaryBookSettings.CAPTURE_HARDWARE}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        settings_obj = SalaryBookSettings.get_solo()
        self.assertEqual(settings_obj.attendance_capture_mode, SalaryBookSettings.CAPTURE_HARDWARE)
        self.assertFalse(settings_obj.require_gps)

    def test_machine_time_delta_requires_confirm_then_locks(self):
        self.user.is_superuser = True
        self.user.save()
        url = reverse('salary-book-settings')
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        settings_obj.save()

        emp = self.make_employee()
        check_in = timezone.make_aware(
            datetime(2026, 9, 17, 9, 0),
            timezone.get_current_timezone(),
        )
        att = Attendance.objects.create(
            employee=emp,
            date=date(2026, 9, 17),
            status=Attendance.STATUS_PRESENT,
            check_in_time=check_in,
            attendance_method=Attendance.METHOD_HARDWARE,
        )

        denied = self.client.patch(url, {'machine_time_delta_minutes': 10}, format='json')
        self.assertEqual(denied.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('confirm_machine_time_delta', denied.data)

        ok = self.client.patch(
            url,
            {
                'machine_time_delta_minutes': 10,
                'confirm_machine_time_delta': True,
            },
            format='json',
        )
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        self.assertEqual(ok.data['machine_time_delta_minutes'], 10)
        self.assertTrue(ok.data['machine_time_delta_locked'])

        att.refresh_from_db()
        self.assertEqual(
            timezone.localtime(att.check_in_time).strftime('%H:%M'),
            '09:10',
        )

        locked = self.client.patch(
            url,
            {
                'machine_time_delta_minutes': 20,
                'confirm_machine_time_delta': True,
            },
            format='json',
        )
        self.assertEqual(locked.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('machine_time_delta_minutes', locked.data)
        settings_obj.refresh_from_db()
        self.assertEqual(settings_obj.machine_time_delta_minutes, 10)
        self.assertTrue(settings_obj.machine_time_delta_locked)

    def test_admin_can_set_geo_mode(self):
        self.user.is_superuser = True
        self.user.save()
        url = reverse('salary-book-settings')
        res = self.client.patch(
            url, {'attendance_capture_mode': SalaryBookSettings.CAPTURE_GEO}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        settings_obj = SalaryBookSettings.get_solo()
        self.assertEqual(settings_obj.attendance_capture_mode, SalaryBookSettings.CAPTURE_GEO)
        self.assertTrue(settings_obj.require_gps)

    def test_non_admin_cannot_change_capture_mode(self):
        url = reverse('salary-book-settings')
        res = self.client.patch(
            url, {'attendance_capture_mode': SalaryBookSettings.CAPTURE_HARDWARE}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_hardware_mode_allows_attendance_without_gps(self):
        self.user.is_superuser = True
        self.user.save()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        settings_obj.save()
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'PRESENT',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        att = Attendance.objects.get(employee=self.emp, date='2026-04-10')
        self.assertEqual(att.attendance_method, Attendance.METHOD_MANUAL)
        self.assertIsNone(att.latitude)

    def test_non_admin_cannot_disable_location_attendance(self):
        url = reverse('salary-book-settings')
        res = self.client.patch(url, {'require_gps': False}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(SalaryBookSettings.get_solo().require_gps)

    def test_manual_attendance_without_gps(self):
        self.user.is_superuser = True
        self.user.save()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_MANUAL
        settings_obj.save()
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'status': 'ABSENT',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        att = Attendance.objects.get(employee=self.emp, date='2026-04-10')
        self.assertEqual(att.attendance_method, Attendance.METHOD_MANUAL)
        self.assertIsNone(att.latitude)

    def test_manual_timed_attendance_creates_in_out(self):
        self.user.is_superuser = True
        self.user.save()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        settings_obj.save()
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-11',
            'status': 'PRESENT',
            'check_in_time': '09:15',
            'check_out_time': '18:30',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        att = Attendance.objects.get(employee=self.emp, date='2026-04-11')
        self.assertEqual(att.attendance_method, Attendance.METHOD_MANUAL)
        self.assertEqual(timezone.localtime(att.check_in_time).strftime('%H:%M'), '09:15')
        self.assertEqual(timezone.localtime(att.check_out_time).strftime('%H:%M'), '18:30')
        self.assertGreater(att.worked_minutes, 0)

    def test_manual_timed_attendance_rejects_partial_times(self):
        self.user.is_superuser = True
        self.user.save()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_HARDWARE
        settings_obj.save()
        url = reverse('salary-book-attendance-list-create')
        res = self.client.post(url, {
            'employee': self.emp.id,
            'date': '2026-04-12',
            'status': 'PRESENT',
            'check_in_time': '09:00',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Attendance.objects.filter(employee=self.emp, date='2026-04-12').count(), 0)


class SalaryRuleTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee()

    def _seed_april(self, unpaid=3, paid=2, present=25):
        day = 1
        rows = []
        for _ in range(present):
            rows.append(self._att(day, Attendance.STATUS_PRESENT))
            day += 1
        for _ in range(paid):
            rows.append(self._att(day, Attendance.STATUS_PAID_LEAVE))
            day += 1
        for _ in range(unpaid):
            rows.append(self._att(day, Attendance.STATUS_UNPAID_LEAVE))
            day += 1
        Attendance.objects.bulk_create(rows)

    def _att(self, day, status_value):
        return Attendance(
            employee=self.emp,
            date=date(2026, 4, day),
            status=status_value,
            latitude=Decimal('23.259900'),
            longitude=Decimal('77.412600'),
            location_accuracy=Decimal('18.00'),
            location_captured_at=datetime(2026, 4, 1, 9, 0, tzinfo=dt_timezone.utc),
            attendance_method=Attendance.METHOD_MANUAL,
        )

    def test_example_net_8500(self):
        self._seed_april()
        SalaryAdvance.objects.create(
            employee=self.emp,
            date=date(2026, 4, 5),
            amount=Decimal('5000.00'),
            reason='Personal',
            created_by=self.user,
        )
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['leave_deduction'], Decimal('1500.00'))
        self.assertEqual(calc['total_advances'], Decimal('5000.00'))
        self.assertEqual(calc['net_salary'], Decimal('8500.00'))
        self.assertEqual(calc['paid_leave_days'], Decimal('2.0'))

    def test_paid_leave_no_deduction(self):
        Attendance.objects.bulk_create([self._att(d, Attendance.STATUS_PAID_LEAVE) for d in range(1, 31)])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['leave_deduction'], Decimal('0.00'))
        self.assertEqual(calc['net_salary'], Decimal('15000.00'))

    def test_absent_deducts(self):
        Attendance.objects.bulk_create([
            self._att(1, Attendance.STATUS_ABSENT),
            *[self._att(d, Attendance.STATUS_PRESENT) for d in range(2, 31)],
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['leave_deduction'], Decimal('500.00'))

    def test_half_day_half_deduction(self):
        Attendance.objects.bulk_create([
            self._att(1, Attendance.STATUS_HALF_DAY),
            *[self._att(d, Attendance.STATUS_PRESENT) for d in range(2, 31)],
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['leave_deduction'], Decimal('250.00'))

    def test_voided_advance_excluded(self):
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 5), amount=Decimal('2000.00'),
            status=SalaryAdvance.STATUS_VOID, created_by=self.user,
        )
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 15), amount=Decimal('3000.00'),
            created_by=self.user,
        )
        Attendance.objects.bulk_create([self._att(d, Attendance.STATUS_PRESENT) for d in range(1, 31)])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['total_advances'], Decimal('3000.00'))

    def test_finalize_locks_and_reopen(self):
        Attendance.objects.bulk_create([self._att(d, Attendance.STATUS_PRESENT) for d in range(1, 31)])
        res = self.client.get(reverse('salary-book-salary-list'), {'year': 2026, 'month': 4})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        record_id = res.data['results'][0]['id']
        fin = self.client.post(reverse('salary-book-salary-finalize', args=[record_id]))
        self.assertEqual(fin.status_code, status.HTTP_200_OK)
        blocked = self.client.post(reverse('salary-book-advance-list-create'), {
            'employee': self.emp.id,
            'date': '2026-04-12',
            'amount': '100.00',
            'reason': 'Test',
        }, format='json')
        self.assertEqual(blocked.status_code, status.HTTP_400_BAD_REQUEST)
        reopen = self.client.post(reverse('salary-book-salary-reopen', args=[record_id]))
        self.assertEqual(reopen.status_code, status.HTTP_200_OK)

    def test_partial_payments(self):
        Attendance.objects.bulk_create([self._att(d, Attendance.STATUS_PRESENT) for d in range(1, 31)])
        res = self.client.get(reverse('salary-book-salary-list'), {'year': 2026, 'month': 4})
        record_id = res.data['results'][0]['id']
        pay_url = reverse('salary-book-payment-list-create')
        self.client.post(pay_url, {
            'salary_record': record_id, 'amount': '5000.00', 'payment_date': '2026-04-10', 'payment_mode': 'CASH',
        }, format='json')
        mid = self.client.get(reverse('salary-book-salary-detail', args=[record_id]))
        self.assertEqual(mid.data['payment_status'], SalaryRecord.PAY_PARTIAL)
        self.client.post(pay_url, {
            'salary_record': record_id, 'amount': '10000.00', 'payment_date': '2026-04-20', 'payment_mode': 'UPI',
        }, format='json')
        done = self.client.get(reverse('salary-book-salary-detail', args=[record_id]))
        self.assertEqual(done.data['payment_status'], SalaryRecord.PAY_PAID)

    def test_mid_month_join_prorates_from_start_date(self):
        """Present every day after joining mid-month → pay only from start date."""
        self.emp.date_of_joining = date(2026, 4, 16)
        self.emp.save(update_fields=['date_of_joining'])
        Attendance.objects.bulk_create([
            self._att(d, Attendance.STATUS_PRESENT) for d in range(16, 31)
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        # 15 pre-join days unpaid at daily 15000/30 = 500 → 7500 deduction
        self.assertEqual(calc['leave_deduction'], Decimal('7500.00'))
        self.assertEqual(calc['net_salary'], Decimal('7500.00'))
        self.assertEqual(calc['breakdown']['pre_join_days'], '15')
        self.assertEqual(calc['present_days'], Decimal('15.0'))

    def test_month_before_joining_earns_zero(self):
        self.emp.date_of_joining = date(2026, 5, 1)
        self.emp.save(update_fields=['date_of_joining'])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['leave_deduction'], Decimal('15000.00'))
        self.assertEqual(calc['net_salary'], Decimal('0.00'))
        self.assertEqual(calc['breakdown']['pre_join_days'], '30')

    def test_salary_cycle_follows_joining_day_inclusive(self):
        """Cycle day 9 for May → 9 Apr … 9 May (31-day strip); paid window drops shared payday overlap."""
        from backend.salary_book.services.salary_calculator import (
            cycle_range,
            paid_cycle_range,
            period_containing,
        )

        self.emp.salary_cycle_start_day = 9
        self.emp.salary_calculation_method = Employee.METHOD_CALENDAR
        self.emp.save(update_fields=['salary_cycle_start_day', 'salary_calculation_method'])
        start, end = cycle_range(self.emp, 2026, 5)
        self.assertEqual(start, date(2026, 4, 9))
        self.assertEqual(end, date(2026, 5, 9))
        self.assertEqual((end - start).days + 1, 31)
        paid_start, paid_end = paid_cycle_range(self.emp, 2026, 5)
        # 9 Apr belongs to April's closing payday; May paid days start 10 Apr.
        self.assertEqual(paid_start, date(2026, 4, 10))
        self.assertEqual(paid_end, date(2026, 5, 9))
        self.assertEqual(period_containing(self.emp, date(2026, 4, 15)), (2026, 5))
        self.assertEqual(period_containing(self.emp, date(2026, 5, 9)), (2026, 5))
        self.assertEqual(period_containing(self.emp, date(2026, 5, 10)), (2026, 6))

        # Present every day in the paid window
        rows = []
        cursor = paid_start
        while cursor <= paid_end:
            rows.append(
                Attendance(
                    employee=self.emp,
                    date=cursor,
                    status=Attendance.STATUS_PRESENT,
                    latitude=Decimal('23.259900'),
                    longitude=Decimal('77.412600'),
                    location_accuracy=Decimal('18.00'),
                    location_captured_at=datetime(2026, 4, 9, 9, 0, tzinfo=dt_timezone.utc),
                    attendance_method=Attendance.METHOD_MANUAL,
                )
            )
            cursor = date.fromordinal(cursor.toordinal() + 1)
        Attendance.objects.bulk_create(rows)
        calc = calculate_employee_month(self.emp, 2026, 5, today=date(2026, 5, 10))
        self.assertEqual(calc['divisor_days'], 30)
        self.assertEqual(calc['breakdown']['period_start'], '2026-04-09')
        self.assertEqual(calc['breakdown']['period_end_marker'], '2026-05-09')
        self.assertEqual(calc['leave_deduction'], Decimal('0.00'))
        self.assertEqual(calc['net_salary'], Decimal('15000.00'))

    def test_october_cycle_strip_has_31_days(self):
        """Joining day 13: October strip is 13 Sep → 13 Oct (31 days), not 30."""
        from backend.salary_book.services.salary_calculator import cycle_range

        self.emp.salary_cycle_start_day = 13
        self.emp.save(update_fields=['salary_cycle_start_day'])
        start, end = cycle_range(self.emp, 2026, 10)
        self.assertEqual(start, date(2026, 9, 13))
        self.assertEqual(end, date(2026, 10, 13))
        self.assertEqual((end - start).days + 1, 31)

    def test_new_cycle_clears_taken_and_salary_from_prior_period(self):
        """Advances in the closed cycle must not appear in the next cycle's Taken."""
        from backend.salary_book.services.salary_calculator import (
            cycle_range,
            paid_cycle_range,
            period_containing,
        )

        self.emp.salary_cycle_start_day = 13
        self.emp.salary_calculation_method = Employee.METHOD_CALENDAR
        self.emp.date_of_joining = date(2026, 9, 1)
        self.emp.save(
            update_fields=['salary_cycle_start_day', 'salary_calculation_method', 'date_of_joining']
        )
        nov_start, nov_end = cycle_range(self.emp, 2026, 11)
        self.assertEqual(nov_start, date(2026, 10, 13))
        self.assertEqual(nov_end, date(2026, 11, 13))
        paid_start, paid_end = paid_cycle_range(self.emp, 2026, 11)
        self.assertEqual(paid_start, date(2026, 10, 14))
        self.assertEqual(paid_end, date(2026, 11, 13))
        self.assertEqual(period_containing(self.emp, date(2026, 11, 14)), (2026, 12))

        SalaryAdvance.objects.create(
            employee=self.emp,
            date=date(2026, 10, 20),
            amount=Decimal('2000.00'),
            reason='Old cycle',
            status=SalaryAdvance.STATUS_ACTIVE,
            created_by=self.user,
        )
        old = calculate_employee_month(self.emp, 2026, 11, today=date(2026, 11, 13))
        self.assertEqual(old['total_advances'], Decimal('2000.00'))

        fresh = calculate_employee_month(self.emp, 2026, 12, today=date(2026, 11, 14))
        self.assertEqual(fresh['total_advances'], Decimal('0.00'))
        self.assertEqual(fresh['breakdown']['period_start'], '2026-11-13')
        self.assertEqual(fresh['breakdown']['period_end_marker'], '2026-12-13')


class LeaveAdvanceTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee()

    def test_leave_upserts_attendance(self):
        res = self.client.post(reverse('salary-book-leave-list-create'), {
            'employee': self.emp.id,
            'leave_type': 'UNPAID',
            'start_date': '2026-04-01',
            'end_date': '2026-04-03',
            'reason': 'Personal',
            **self.gps,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['days'], 3)
        self.assertEqual(
            Attendance.objects.filter(employee=self.emp, status=Attendance.STATUS_UNPAID_LEAVE).count(),
            3,
        )
        self.assertEqual(LeaveRecord.objects.filter(employee=self.emp).count(), 1)


def _local_dt(day, hour, minute):
    return timezone.make_aware(
        datetime(day.year, day.month, day.day, hour, minute),
        timezone.get_current_timezone(),
    )


class ScheduleAndHourlyPayTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee(
            monthly_salary=Decimal('24000.00'),
            salary_calculation_method=Employee.METHOD_FIXED,
            fixed_working_days=30,
            expected_check_in=time(9, 0),
            expected_check_out=time(17, 0),
        )

    def _att(self, day, status_value, check_in=None, check_out=None, **kwargs):
        defaults = dict(
            employee=self.emp,
            date=date(2026, 4, day),
            status=status_value,
            check_in_time=check_in,
            check_out_time=check_out,
            latitude=Decimal('23.259900'),
            longitude=Decimal('77.412600'),
            location_accuracy=Decimal('18.00'),
            location_captured_at=datetime(2026, 4, 1, 9, 0, tzinfo=dt_timezone.utc),
            attendance_method=Attendance.METHOD_MANUAL,
        )
        defaults.update(kwargs)
        return Attendance(**defaults)

    def test_schedule_validation(self):
        self.emp.expected_check_in = time(18, 0)
        self.emp.expected_check_out = time(9, 0)
        with self.assertRaises(DjangoValidationError):
            self.emp.full_clean()
        res = self.client.patch(
            reverse('salary-book-employee-detail', args=[self.emp.id]),
            {'expected_check_in': '18:00', 'expected_check_out': '09:00'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_hourly_no_overtime(self):
        day = date(2026, 4, 1)
        Attendance.objects.bulk_create([
            self._att(1, Attendance.STATUS_PRESENT, _local_dt(day, 8, 0), _local_dt(day, 17, 0)),
            *[self._att(d, Attendance.STATUS_ABSENT) for d in range(2, 31)],
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['daily_salary'], Decimal('800.0000'))
        self.assertEqual(calc['breakdown']['hourly_rate'], '100.0000')
        self.assertEqual(calc['breakdown']['scheduled_hours'], '8.00')
        self.assertEqual(calc['leave_deduction'], Decimal('23200.00'))
        self.assertEqual(calc['net_salary'], Decimal('800.00'))
        self.assertEqual(calc['breakdown']['daily_breakdown'][0]['worked_hours'], '9.00')
        self.assertEqual(calc['breakdown']['daily_breakdown'][0]['payable_hours'], '8.00')

    def test_proportional_under_time(self):
        day = date(2026, 4, 1)
        Attendance.objects.bulk_create([
            self._att(1, Attendance.STATUS_PRESENT, _local_dt(day, 9, 0), _local_dt(day, 15, 0)),
            *[self._att(d, Attendance.STATUS_ABSENT) for d in range(2, 31)],
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['net_salary'], Decimal('600.00'))
        self.assertEqual(calc['breakdown']['daily_breakdown'][0]['payable_hours'], '6.00')

    def test_manual_present_no_times(self):
        Attendance.objects.bulk_create([
            self._att(1, Attendance.STATUS_PRESENT),
            *[self._att(d, Attendance.STATUS_ABSENT) for d in range(2, 31)],
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['net_salary'], Decimal('800.00'))

    def test_paid_leave_full_credit(self):
        Attendance.objects.bulk_create([
            self._att(1, Attendance.STATUS_PAID_LEAVE),
            *[self._att(d, Attendance.STATUS_ABSENT) for d in range(2, 31)],
        ])
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['net_salary'], Decimal('800.00'))
        self.assertEqual(calc['paid_leave_days'], Decimal('1.0'))


class ConsecutiveLateRuleTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee(
            expected_check_in=time(9, 0),
            expected_check_out=time(17, 0),
        )
        EmployeeAttendanceRule.objects.create(
            employee=self.emp,
            rule_type=EmployeeAttendanceRule.TYPE_CONSECUTIVE_LATE,
            late_threshold_minutes=30,
            consecutive_late_days=3,
        )

    def _seed_day(self, day, hour, minute, minutes_late):
        check_in = _local_dt(date(2026, 4, day), hour, minute)
        return Attendance.objects.create(
            employee=self.emp,
            date=date(2026, 4, day),
            status=Attendance.STATUS_PRESENT,
            check_in_time=check_in,
            minutes_late=minutes_late,
            is_late=minutes_late >= 30,
            latitude=Decimal('23.259900'),
            longitude=Decimal('77.412600'),
            location_accuracy=Decimal('18.00'),
            location_captured_at=check_in,
            attendance_method=Attendance.METHOD_CAMERA,
        )

    def test_consecutive_late_penalty(self):
        self._seed_day(1, 9, 40, 40)
        self._seed_day(2, 9, 45, 45)
        self._seed_day(3, 9, 35, 35)
        on_time = _local_dt(date(2026, 4, 4), 9, 0)
        result = evaluate_check_in(self.emp, date(2026, 4, 4), Attendance.STATUS_PRESENT, on_time)
        self.assertEqual(result.status, Attendance.STATUS_ABSENT)
        self.assertTrue(result.rule_penalty_applied)
        self.assertIn('Consecutive late penalty', result.rule_remarks)

        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.office_latitude = Decimal('23.259900')
        settings_obj.office_longitude = Decimal('77.412600')
        settings_obj.geofence_radius_meters = 150
        settings_obj.save()
        res = self.client.post(reverse('salary-book-attendance-list-create'), {
            'employee': self.emp.id,
            'date': '2026-04-04',
            'status': 'PRESENT',
            **self.gps,
            'photo': jpeg_file(),
        }, format='multipart')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['status'], Attendance.STATUS_ABSENT)
        self.assertTrue(res.data['rule_penalty_applied'])

    def test_streak_resets_on_time(self):
        self._seed_day(1, 9, 40, 40)
        self._seed_day(2, 9, 45, 45)
        self._seed_day(3, 9, 0, 0)
        late = _local_dt(date(2026, 4, 4), 9, 40)
        result = evaluate_check_in(self.emp, date(2026, 4, 4), Attendance.STATUS_PRESENT, late)
        self.assertEqual(result.status, Attendance.STATUS_PRESENT)
        self.assertFalse(result.rule_penalty_applied)

    def test_check_in_buffer_treats_grace_as_on_time(self):
        """Expected 09:00 + 10 min buffer → 09:10 is not late; 09:15 is 5 min late."""
        from backend.salary_book.services.schedule_utils import minutes_late_at

        self.emp.check_in_buffer_minutes = 10
        self.emp.save(update_fields=['check_in_buffer_minutes'])
        within = minutes_late_at(_local_dt(date(2026, 4, 1), 9, 10), self.emp, date(2026, 4, 1))
        self.assertEqual(within, 0)
        over = minutes_late_at(_local_dt(date(2026, 4, 1), 9, 15), self.emp, date(2026, 4, 1))
        self.assertEqual(over, 5)
        result = evaluate_check_in(
            self.emp, date(2026, 4, 1), Attendance.STATUS_PRESENT, _local_dt(date(2026, 4, 1), 9, 10)
        )
        self.assertFalse(result.is_late)
        self.assertEqual(result.minutes_late, 0)

    def test_buffer_zero_requires_exact_check_in(self):
        from backend.salary_book.services.schedule_utils import minutes_late_at

        self.emp.check_in_buffer_minutes = 0
        self.emp.save(update_fields=['check_in_buffer_minutes'])
        late = minutes_late_at(_local_dt(date(2026, 4, 1), 9, 1), self.emp, date(2026, 4, 1))
        self.assertEqual(late, 1)

    def test_holiday_breaks_consecutive_late_streak(self):
        """Holiday in between resets streak — next working day does not inherit prior lates."""
        self._seed_day(1, 9, 40, 40)
        self._seed_day(2, 9, 45, 45)
        Attendance.objects.create(
            employee=self.emp,
            date=date(2026, 4, 3),
            status=Attendance.STATUS_HOLIDAY,
            attendance_method=Attendance.METHOD_MANUAL,
        )
        # Day 4 late should only count as streak=1 (holiday broke days 1–2).
        late = _local_dt(date(2026, 4, 4), 9, 40)
        result = evaluate_check_in(self.emp, date(2026, 4, 4), Attendance.STATUS_PRESENT, late)
        self.assertEqual(result.status, Attendance.STATUS_PRESENT)
        self.assertFalse(result.rule_penalty_applied)
        self.assertTrue(result.is_late)

    def test_rule_api_crud(self):
        url = reverse('salary-book-employee-attendance-rules', args=[self.emp.id])
        listed = self.client.get(url)
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listed.data), 1)
        created = self.client.post(url, {
            'late_threshold_minutes': 15,
            'consecutive_late_days': 2,
        }, format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        rule_id = created.data['id']
        patched = self.client.patch(
            reverse('salary-book-employee-attendance-rule-detail', args=[self.emp.id, rule_id]),
            {'is_active': False},
            format='json',
        )
        self.assertEqual(patched.status_code, status.HTTP_200_OK)
        self.assertFalse(patched.data['is_active'])
        deleted = self.client.delete(
            reverse('salary-book-employee-attendance-rule-detail', args=[self.emp.id, rule_id])
        )
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(len(self.client.get(url).data), 1)


class SalaryBookIntegrationTests(SalaryBookMixin, APITestCase):
    """End-to-end flow: manual attendance, leaves, salary, and reports."""

    def setUp(self):
        self.user = self.make_user('owner', admin=True)
        self.client.force_authenticate(user=self.user)
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.attendance_capture_mode = SalaryBookSettings.CAPTURE_MANUAL
        settings_obj.save()
        self.emp = self.make_employee(monthly_salary=Decimal('30000.00'))
        self.att_url = reverse('salary-book-attendance-list-create')

    def _manual(self, day, status_value):
        return self.client.post(self.att_url, {
            'employee': self.emp.id,
            'date': f'2026-04-{day:02d}',
            'status': status_value,
        }, format='json')

    def test_manual_month_salary_and_reports(self):
        for day in range(1, 29):
            res = self._manual(day, 'PRESENT')
            self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        leave = self.client.post(reverse('salary-book-leave-list-create'), {
            'employee': self.emp.id,
            'leave_type': 'UNPAID',
            'start_date': '2026-04-29',
            'end_date': '2026-04-30',
            'reason': 'Personal',
        }, format='json')
        self.assertEqual(leave.status_code, status.HTTP_201_CREATED)
        self.client.post(reverse('salary-book-advance-list-create'), {
            'employee': self.emp.id,
            'date': '2026-04-10',
            'amount': '2000.00',
            'reason': 'Loan',
        }, format='json')
        gen = self.client.post(reverse('salary-book-salary-generate'), {'year': 2026, 'month': 4}, format='json')
        self.assertEqual(gen.status_code, status.HTTP_200_OK)
        sal = self.client.get(reverse('salary-book-salary-list'), {'year': 2026, 'month': 4})
        self.assertEqual(sal.status_code, status.HTTP_200_OK)
        record = next(r for r in sal.data['results'] if r['employee'] == self.emp.id)
        self.assertEqual(Decimal(record['gross_salary']), Decimal('30000.00'))
        self.assertEqual(Decimal(record['leave_deduction']), Decimal('2000.00'))
        self.assertEqual(Decimal(record['total_advances']), Decimal('2000.00'))
        self.assertEqual(Decimal(record['net_salary']), Decimal('26000.00'))

        att_report = self.client.get(reverse('salary-book-report-attendance'), {
            'year': 2026, 'month': 4, 'employee': self.emp.id,
        })
        self.assertEqual(att_report.status_code, status.HTTP_200_OK)
        self.assertEqual(att_report.data['count'], 30)

        leave_report = self.client.get(reverse('salary-book-report-leaves'), {
            'year': 2026, 'month': 4, 'employee': self.emp.id,
        })
        self.assertEqual(leave_report.status_code, status.HTTP_200_OK)
        self.assertEqual(leave_report.data['count'], 1)

        adv_report = self.client.get(reverse('salary-book-report-advances'), {
            'year': 2026, 'month': 4, 'employee': self.emp.id,
        })
        self.assertEqual(adv_report.status_code, status.HTTP_200_OK)
        self.assertEqual(adv_report.data['count'], 1)

        sal_report = self.client.get(reverse('salary-book-report-salaries'), {
            'year': 2026, 'month': 4, 'employee': self.emp.id,
        })
        self.assertEqual(sal_report.status_code, status.HTTP_200_OK)
        self.assertEqual(sal_report.data['count'], 1)

    def test_manual_present_skips_late_penalty_and_check_in(self):
        emp = self.make_employee(
            name='Late Test',
            mobile='9876500001',
            expected_check_in=time(9, 0),
            expected_check_out=time(17, 0),
        )
        EmployeeAttendanceRule.objects.create(
            employee=emp,
            rule_type=EmployeeAttendanceRule.TYPE_CONSECUTIVE_LATE,
            late_threshold_minutes=30,
            consecutive_late_days=3,
        )
        for day in (1, 2, 3):
            Attendance.objects.create(
                employee=emp,
                date=date(2026, 4, day),
                status=Attendance.STATUS_PRESENT,
                check_in_time=_local_dt(date(2026, 4, day), 9, 45),
                minutes_late=45,
                is_late=True,
                attendance_method=Attendance.METHOD_CAMERA,
            )
        res = self.client.post(self.att_url, {
            'employee': emp.id,
            'date': '2026-04-04',
            'status': 'PRESENT',
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['status'], Attendance.STATUS_PRESENT)
        self.assertFalse(res.data['rule_penalty_applied'])
        self.assertIsNone(res.data['check_in_time'])
        att = Attendance.objects.get(employee=emp, date='2026-04-04')
        self.assertEqual(att.attendance_method, Attendance.METHOD_MANUAL)


class MtshopAdvanceSyncTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('mtshop-owner', admin=True)
        self.client.force_authenticate(user=self.user)
        from backend.parties.models import Customer, CustomerGroup, InternalLedgerEntry

        self.Customer = Customer
        self.InternalLedgerEntry = InternalLedgerEntry
        self.mtshop_group = CustomerGroup.objects.create(name='MTSHOP', description='Shop boys')
        self.customer = Customer.objects.create(
            name='MT SHOP Ramesh Kumar',
            phone='9876543210',
            customer_group=self.mtshop_group,
        )
        self.emp = self.make_employee(
            name='Ramesh Kumar',
            mobile='9876543210',
            mtshop_customer=self.customer,
        )

    def test_debit_creates_active_advance(self):
        from backend.parties.internal_ledger_utils import create_internal_ledger_entry_if_mtshop

        create_internal_ledger_entry_if_mtshop(
            self.customer,
            'debit',
            Decimal('2000.00'),
            'Invoice INV-1001 (CREDIT)',
            self.user,
        )
        adv = SalaryAdvance.objects.get(employee=self.emp, source=SalaryAdvance.SOURCE_MTSHOP)
        self.assertEqual(adv.amount, Decimal('2000.00'))
        self.assertEqual(adv.status, SalaryAdvance.STATUS_ACTIVE)
        self.assertEqual(adv.source_invoice_number, 'INV-1001')
        self.assertIn('MT Shop', adv.remarks)

    def test_credit_marks_advance_paid(self):
        from backend.parties.internal_ledger_utils import create_internal_ledger_entry_if_mtshop

        create_internal_ledger_entry_if_mtshop(
            self.customer, 'debit', Decimal('2000.00'),
            'Invoice INV-2002 (CREDIT)', self.user,
        )
        create_internal_ledger_entry_if_mtshop(
            self.customer, 'credit', Decimal('2000.00'),
            'Payment for Invoice INV-2002', self.user,
        )
        adv = SalaryAdvance.objects.get(employee=self.emp, source=SalaryAdvance.SOURCE_MTSHOP)
        self.assertEqual(adv.status, SalaryAdvance.STATUS_PAID)

    def test_mark_paid_endpoint_excludes_from_salary(self):
        adv = SalaryAdvance.objects.create(
            employee=self.emp,
            date=date(2026, 4, 10),
            amount=Decimal('1500.00'),
            reason='MT Shop purchase',
            source=SalaryAdvance.SOURCE_MTSHOP,
            status=SalaryAdvance.STATUS_ACTIVE,
            created_by=self.user,
        )
        Attendance.objects.bulk_create([
            Attendance(
                employee=self.emp, date=date(2026, 4, d), status=Attendance.STATUS_PRESENT,
            )
            for d in range(1, 31)
        ])
        res = self.client.post(reverse('salary-book-advance-mark-paid', args=[adv.id]), {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(res.data['partial'])
        self.assertEqual(res.data['advance']['status'], SalaryAdvance.STATUS_PAID)
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['total_advances'], Decimal('0.00'))

    def test_partial_mark_paid_keeps_remaining_active(self):
        adv = SalaryAdvance.objects.create(
            employee=self.emp,
            date=date(2026, 4, 10),
            amount=Decimal('2000.00'),
            reason='MT Shop purchase',
            source=SalaryAdvance.SOURCE_MTSHOP,
            status=SalaryAdvance.STATUS_ACTIVE,
            created_by=self.user,
        )
        Attendance.objects.bulk_create([
            Attendance(
                employee=self.emp, date=date(2026, 4, d), status=Attendance.STATUS_PRESENT,
            )
            for d in range(1, 31)
        ])
        res = self.client.post(
            reverse('salary-book-advance-mark-paid', args=[adv.id]),
            {'amount': '500.00'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['partial'])
        self.assertEqual(Decimal(res.data['advance']['amount']), Decimal('1500.00'))
        self.assertEqual(res.data['advance']['status'], SalaryAdvance.STATUS_ACTIVE)
        self.assertEqual(res.data['paid_entry']['status'], SalaryAdvance.STATUS_PAID)
        self.assertEqual(Decimal(res.data['paid_entry']['amount']), Decimal('500.00'))
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['total_advances'], Decimal('1500.00'))

    def test_employee_advance_ledger_totals(self):
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 5), amount=Decimal('1000.00'),
            status=SalaryAdvance.STATUS_ACTIVE, source=SalaryAdvance.SOURCE_MTSHOP,
            created_by=self.user,
        )
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 8), amount=Decimal('400.00'),
            status=SalaryAdvance.STATUS_PAID, source=SalaryAdvance.SOURCE_MTSHOP,
            created_by=self.user,
        )
        res = self.client.get(
            reverse('salary-book-employee-advances', args=[self.emp.id]),
            {'year': 2026, 'month': 4},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 2)
        self.assertEqual(Decimal(res.data['total_active']), Decimal('1000.00'))
        self.assertEqual(Decimal(res.data['total_paid']), Decimal('400.00'))
        self.assertEqual(res.data['employee_name'], self.emp.name)

    def test_advance_unvoid_restores_active(self):
        adv = SalaryAdvance.objects.create(
            employee=self.emp,
            date=date(2026, 4, 10),
            amount=Decimal('800.00'),
            reason='Cash advance',
            status=SalaryAdvance.STATUS_VOID,
            created_by=self.user,
        )
        res = self.client.post(reverse('salary-book-advance-unvoid', args=[adv.id]), {}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], SalaryAdvance.STATUS_ACTIVE)
        adv.refresh_from_db()
        self.assertEqual(adv.status, SalaryAdvance.STATUS_ACTIVE)

    def test_advance_mark_unpaid_restores_active(self):
        adv = SalaryAdvance.objects.create(
            employee=self.emp,
            date=date(2026, 4, 10),
            amount=Decimal('1200.00'),
            reason='Cash advance',
            status=SalaryAdvance.STATUS_PAID,
            created_by=self.user,
        )
        Attendance.objects.bulk_create([
            Attendance(
                employee=self.emp, date=date(2026, 4, d), status=Attendance.STATUS_PRESENT,
            )
            for d in range(1, 31)
        ])
        res = self.client.post(
            reverse('salary-book-advance-mark-unpaid', args=[adv.id]),
            {},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], SalaryAdvance.STATUS_ACTIVE)
        calc = calculate_employee_month(self.emp, 2026, 4, today=date(2026, 5, 1))
        self.assertEqual(calc['total_advances'], Decimal('1200.00'))

    def test_phone_match_without_explicit_link(self):
        from backend.parties.internal_ledger_utils import create_internal_ledger_entry_if_mtshop

        other = self.Customer.objects.create(
            name='MT SHOP Suresh',
            phone='9123456789',
            customer_group=self.mtshop_group,
        )
        emp2 = self.make_employee(name='Suresh', mobile='9123456789')
        create_internal_ledger_entry_if_mtshop(
            other, 'debit', Decimal('500.00'), 'Invoice INV-9 (CREDIT)', self.user,
        )
        self.assertTrue(
            SalaryAdvance.objects.filter(
                employee=emp2, source=SalaryAdvance.SOURCE_MTSHOP, amount=Decimal('500.00'),
            ).exists()
        )

    def test_empty_group_debit_creates_taken_advance(self):
        """Empty-group customer linked to employee → repair/POS debit lands in Taken."""
        from backend.parties.internal_ledger_utils import create_internal_ledger_entry_if_mtshop

        empty_customer = self.Customer.objects.create(
            name='Abhishek',
            phone='9000011111',
            customer_group=None,
        )
        emp = self.make_employee(
            name='Abhishek',
            mobile='9000011111',
            employee_id='EMP-EMPTY-1',
            mtshop_customer=empty_customer,
        )
        create_internal_ledger_entry_if_mtshop(
            empty_customer,
            'debit',
            Decimal('750.00'),
            'Repair invoice REP-55 (CREDIT)',
            self.user,
        )
        adv = SalaryAdvance.objects.get(employee=emp, source=SalaryAdvance.SOURCE_MTSHOP)
        self.assertEqual(adv.amount, Decimal('750.00'))
        self.assertEqual(adv.status, SalaryAdvance.STATUS_ACTIVE)

    def test_manual_credit_without_invoice_creates_taken(self):
        """Shop Boys Credit (+) with no invoice should increase Taken, not mark paid."""
        from backend.parties.models import InternalLedgerEntry
        from backend.salary_book.services.mtshop_advances import (
            sync_salary_advance_from_internal_entry,
        )

        entry = InternalLedgerEntry.objects.create(
            customer=self.customer,
            entry_type='credit',
            amount=Decimal('300.00'),
            description='Cash given to shop boy',
            created_by=self.user,
        )
        sync_salary_advance_from_internal_entry(entry, created_by=self.user)
        adv = SalaryAdvance.objects.get(
            employee=self.emp,
            source=SalaryAdvance.SOURCE_MTSHOP,
            source_internal_entry_id=entry.id,
        )
        self.assertEqual(adv.amount, Decimal('300.00'))
        self.assertEqual(adv.status, SalaryAdvance.STATUS_ACTIVE)


class AdvanceResetOpeningTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('reset-owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee(name='Reset Emp', employee_id='EMP-RST-1')

    def test_reset_clears_history_and_creates_opening(self):
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 5), amount=Decimal('1000.00'),
            status=SalaryAdvance.STATUS_ACTIVE, created_by=self.user,
        )
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 8), amount=Decimal('400.00'),
            status=SalaryAdvance.STATUS_PAID, created_by=self.user,
        )
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 3, 1), amount=Decimal('50.00'),
            status=SalaryAdvance.STATUS_VOID, created_by=self.user,
        )
        today = timezone.localdate()
        res = self.client.post(
            reverse('salary-book-employee-advance-reset-opening', args=[self.emp.id]),
            {'amount': '5000.00', 'remarks': 'Carry forward'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertEqual(res.data['deleted'], 3)
        self.assertIsNotNone(res.data['opening'])
        self.assertEqual(Decimal(res.data['opening']['amount']), Decimal('5000.00'))
        self.assertEqual(res.data['opening']['status'], SalaryAdvance.STATUS_ACTIVE)
        self.assertEqual(res.data['opening']['reason'], 'Opening balance')

        remaining = list(SalaryAdvance.objects.filter(employee=self.emp))
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].amount, Decimal('5000.00'))
        self.assertEqual(remaining[0].date, today)
        self.assertEqual(remaining[0].remarks, 'Carry forward')

        calc = calculate_employee_month(
            self.emp, today.year, today.month, today=today,
        )
        self.assertEqual(calc['total_advances'], Decimal('5000.00'))

    def test_reset_amount_zero_clears_only(self):
        SalaryAdvance.objects.create(
            employee=self.emp, date=date(2026, 4, 5), amount=Decimal('1000.00'),
            status=SalaryAdvance.STATUS_ACTIVE, created_by=self.user,
        )
        res = self.client.post(
            reverse('salary-book-employee-advance-reset-opening', args=[self.emp.id]),
            {'amount': '0'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertEqual(res.data['deleted'], 1)
        self.assertIsNone(res.data['opening'])
        self.assertEqual(SalaryAdvance.objects.filter(employee=self.emp).count(), 0)

    def test_reset_rejects_negative(self):
        res = self.client.post(
            reverse('salary-book-employee-advance-reset-opening', args=[self.emp.id]),
            {'amount': '-10'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class CalendarTakenAndAttendanceEditTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('cal-owner', admin=True)
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee(
            name='Ajay',
            employee_id='EMP-CAL-1',
            monthly_salary=Decimal('18500.00'),
        )

    def test_calendar_includes_today_kpis_and_taken(self):
        today = timezone.localdate()
        SalaryAdvance.objects.create(
            employee=self.emp,
            date=today.replace(day=1) if today.day > 1 else today,
            amount=Decimal('1500.00'),
            reason='Cash',
            payment_mode=SalaryAdvance.MODE_CASH,
            status=SalaryAdvance.STATUS_ACTIVE,
            created_by=self.user,
        )
        Attendance.objects.create(
            employee=self.emp,
            date=today,
            status=Attendance.STATUS_PRESENT,
            check_in_time=_local_dt(today, 9, 0),
            check_out_time=_local_dt(today, 18, 0),
        )
        res = self.client.get(
            reverse('salary-book-calendar'),
            {'year': today.year, 'month': today.month},
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('today_kpis', res.data)
        self.assertGreaterEqual(res.data['today_kpis']['total_employees'], 1)
        self.assertGreaterEqual(res.data['today_kpis']['present'], 1)
        row = next(e for e in res.data['employees'] if e['id'] == self.emp.id)
        self.assertIn('salary_generated', row)
        self.assertEqual(Decimal(row['taken']), Decimal('1500.00'))

    def test_advance_create_with_payment_mode(self):
        res = self.client.post(
            reverse('salary-book-advance-list-create'),
            {
                'employee': self.emp.id,
                'date': '2026-10-05',
                'amount': '500.00',
                'reason': 'UPI advance',
                'payment_mode': 'UPI',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['payment_mode'], 'UPI')
        adv = SalaryAdvance.objects.get(pk=res.data['id'])
        self.assertEqual(adv.payment_mode, SalaryAdvance.MODE_UPI)

    def test_edit_marked_attendance_times(self):
        day = date(2026, 10, 6)
        att = Attendance.objects.create(
            employee=self.emp,
            date=day,
            status=Attendance.STATUS_PRESENT,
            check_in_time=_local_dt(day, 9, 0),
            check_out_time=_local_dt(day, 18, 0),
            attendance_method=Attendance.METHOD_HARDWARE,
        )
        res = self.client.patch(
            reverse('salary-book-attendance-detail', args=[att.id]),
            {
                'status': 'PRESENT',
                'check_in_time': '09:15',
                'check_out_time': '14:00',
            },
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        att.refresh_from_db()
        self.assertEqual(att.attendance_method, Attendance.METHOD_MANUAL)
        self.assertEqual(timezone.localtime(att.check_in_time).hour, 9)
        self.assertEqual(timezone.localtime(att.check_in_time).minute, 15)
        self.assertEqual(timezone.localtime(att.check_out_time).hour, 14)
        self.assertEqual(timezone.localtime(att.check_out_time).minute, 0)

    def test_edit_marked_attendance_to_absent(self):
        day = date(2026, 10, 7)
        att = Attendance.objects.create(
            employee=self.emp,
            date=day,
            status=Attendance.STATUS_PRESENT,
            check_in_time=_local_dt(day, 9, 0),
            check_out_time=_local_dt(day, 18, 0),
        )
        res = self.client.patch(
            reverse('salary-book-attendance-detail', args=[att.id]),
            {'status': 'ABSENT'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        att.refresh_from_db()
        self.assertEqual(att.status, Attendance.STATUS_ABSENT)
        self.assertIsNone(att.check_in_time)
        self.assertIsNone(att.check_out_time)
