from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from io import BytesIO

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
        emp = self.make_employee()
        Attendance.objects.create(
            employee=emp,
            date=date(2026, 8, 1),
            status=Attendance.STATUS_PRESENT,
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
        self.assertEqual(emp_view.data['employees'][0]['days']['1']['status'], 'PRESENT')
        missing = self.client.get(reverse('salary-book-calendar'), {'employee': 999999})
        self.assertEqual(missing.status_code, status.HTTP_404_NOT_FOUND)

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


class AttendanceGpsTests(SalaryBookMixin, APITestCase):
    def setUp(self):
        self.user = self.make_user('owner')
        self.client.force_authenticate(user=self.user)
        self.emp = self.make_employee()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.office_latitude = Decimal('23.259900')
        settings_obj.office_longitude = Decimal('77.412600')
        settings_obj.geofence_radius_meters = 150
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
        self.assertFalse(SalaryBookSettings.get_solo().require_gps)

    def test_non_admin_cannot_disable_location_attendance(self):
        url = reverse('salary-book-settings')
        res = self.client.patch(url, {'require_gps': False}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(SalaryBookSettings.get_solo().require_gps)

    def test_manual_attendance_without_gps(self):
        self.user.is_superuser = True
        self.user.save()
        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.require_gps = False
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
        settings_obj.require_gps = False
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
