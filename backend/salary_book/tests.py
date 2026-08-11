from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from io import BytesIO

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from PIL import Image

from backend.salary_book.models import (
    Attendance,
    Employee,
    LeaveRecord,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryRecord,
)
from backend.salary_book.permissions import SALARY_BOOK_GROUP
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
        dash = self.client.get(reverse('salary-book-dashboard'))
        self.assertEqual(dash.status_code, status.HTTP_200_OK)
        self.assertIn('today_attendance', dash.data)
        self.assertIn('month', dash.data)
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

    def test_cannot_disable_gps(self):
        url = reverse('salary-book-settings')
        res = self.client.patch(url, {'require_gps': False}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(SalaryBookSettings.get_solo().require_gps)


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
