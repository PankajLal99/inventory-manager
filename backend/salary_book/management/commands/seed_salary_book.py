from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import BytesIO
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.utils import timezone
from PIL import Image, ImageDraw, ImageFont

from backend.salary_book.models import (
    Attendance,
    Employee,
    LeaveRecord,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryPayment,
    SalaryRecord,
)
from backend.salary_book.services.salary_calculator import (
    apply_calculation_to_record,
    calculate_employee_month,
    refresh_payment_status,
)

IST = ZoneInfo('Asia/Kolkata')

EMPLOYEES = [
    {
        'employee_id': 'EMP-001',
        'name': 'Ramesh Kumar',
        'mobile': '9876543210',
        'designation': 'Driver',
        'department': 'Operations',
        'monthly_salary': Decimal('15000.00'),
        'blood_group': 'B+',
        'address': '12 MG Road, Bhopal',
        'date_of_joining': date(2024, 6, 1),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-002',
        'name': 'Suresh Sharma',
        'mobile': '9876543211',
        'designation': 'Helper',
        'department': 'Operations',
        'monthly_salary': Decimal('18000.00'),
        'blood_group': 'O+',
        'address': '45 New Market, Bhopal',
        'date_of_joining': date(2023, 11, 15),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-003',
        'name': 'Amit Kumar',
        'mobile': '9876543212',
        'designation': 'Sales Executive',
        'department': 'Sales',
        'monthly_salary': Decimal('22000.00'),
        'blood_group': 'A+',
        'address': '8 MP Nagar, Bhopal',
        'date_of_joining': date(2025, 1, 10),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-004',
        'name': 'Priya Verma',
        'mobile': '9876543213',
        'designation': 'Accountant',
        'department': 'Accounts',
        'monthly_salary': Decimal('25000.00'),
        'blood_group': 'AB+',
        'address': '21 Arera Colony, Bhopal',
        'date_of_joining': date(2022, 4, 1),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-005',
        'name': 'Vikas Patel',
        'mobile': '9876543214',
        'designation': 'Store Keeper',
        'department': 'Warehouse',
        'monthly_salary': Decimal('16000.00'),
        'blood_group': 'B-',
        'address': '3 Kolar Road, Bhopal',
        'date_of_joining': date(2024, 9, 20),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-006',
        'name': 'Neha Singh',
        'mobile': '9876543215',
        'designation': 'Receptionist',
        'department': 'Admin',
        'monthly_salary': Decimal('14000.00'),
        'blood_group': 'O-',
        'address': '9 Bittan Market, Bhopal',
        'date_of_joining': date(2025, 3, 1),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-007',
        'name': 'Rahul Yadav',
        'mobile': '9876543216',
        'designation': 'Technician',
        'department': 'Repair',
        'monthly_salary': Decimal('20000.00'),
        'blood_group': 'A-',
        'address': '16 Indrapuri, Bhopal',
        'date_of_joining': date(2024, 2, 12),
        'status': Employee.STATUS_ACTIVE,
    },
    {
        'employee_id': 'EMP-008',
        'name': 'Sunita Devi',
        'mobile': '9876543217',
        'designation': 'Housekeeping',
        'department': 'Admin',
        'monthly_salary': Decimal('12000.00'),
        'blood_group': 'B+',
        'address': '5 Berasia Road, Bhopal',
        'date_of_joining': date(2021, 8, 5),
        'status': Employee.STATUS_INACTIVE,
    },
]


def _selfie(label: str) -> ContentFile:
    image = Image.new('RGB', (480, 640), color=(16, 185, 129))
    draw = ImageDraw.Draw(image)
    draw.ellipse((140, 120, 340, 320), fill=(254, 243, 199))
    draw.rectangle((80, 560, 400, 620), fill=(6, 95, 70))
    try:
        font = ImageFont.load_default()
    except OSError:
        font = None
    draw.text((40, 40), 'SELFIE', fill=(255, 255, 255), font=font)
    draw.text((40, 575), label[:28], fill=(255, 255, 255), font=font)
    buf = BytesIO()
    image.save(buf, format='JPEG', quality=70)
    return ContentFile(buf.getvalue(), name=f'{label.replace(" ", "_")}.jpg')


def _aware(d: date, hh: int, mm: int) -> datetime:
    return timezone.make_aware(datetime.combine(d, time(hh, mm)), IST)


class Command(BaseCommand):
    help = 'Insert mock Salary Book employees, attendance, leaves, advances, and a draft payroll month.'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true', help='Delete existing salary book rows first.')

    def handle(self, *args, **options):
        if options['reset']:
            SalaryPayment.objects.all().delete()
            SalaryRecord.objects.all().delete()
            SalaryAdvance.objects.all().delete()
            Attendance.objects.all().delete()
            LeaveRecord.objects.all().delete()
            Employee.objects.all().delete()
            self.stdout.write('Cleared existing Salary Book data.')

        settings_obj = SalaryBookSettings.get_solo()
        settings_obj.office_latitude = Decimal('23.259900')
        settings_obj.office_longitude = Decimal('77.412600')
        settings_obj.geofence_radius_meters = 150
        settings_obj.max_gps_accuracy_meters = 100
        settings_obj.require_gps = True
        settings_obj.require_photo = True
        settings_obj.save()

        user = get_user_model().objects.filter(is_superuser=True).order_by('id').first()
        office_lat = settings_obj.office_latitude
        office_lng = settings_obj.office_longitude
        today = timezone.localdate()
        month_start = date(today.year, today.month, 1)

        employees = {}
        for row in EMPLOYEES:
            emp, created = Employee.objects.update_or_create(
                employee_id=row['employee_id'],
                defaults=row,
            )
            if not emp.profile_photo:
                emp.profile_photo = _selfie(emp.name)
                emp.save(update_fields=['profile_photo'])
            employees[emp.employee_id] = emp
            self.stdout.write(('Created' if created else 'Updated') + f' {emp.employee_id} {emp.name}')

        # Pattern for Aug 1..today among active staff
        active = [e for e in employees.values() if e.status == Employee.STATUS_ACTIVE]
        holiday = month_start + timedelta(days=8)  # 9th if month starts on 1st

        for emp in active:
            cursor = month_start
            while cursor <= today:
                if cursor < emp.date_of_joining:
                    cursor += timedelta(days=1)
                    continue
                if Attendance.objects.filter(employee=emp, date=cursor).exists():
                    cursor += timedelta(days=1)
                    continue

                idx = (emp.id + cursor.day) % 10
                if cursor == holiday:
                    status = Attendance.STATUS_HOLIDAY
                elif idx == 0:
                    status = Attendance.STATUS_ABSENT
                elif idx == 1:
                    status = Attendance.STATUS_HALF_DAY
                else:
                    status = Attendance.STATUS_PRESENT

                att = Attendance(
                    employee=emp,
                    date=cursor,
                    status=status,
                    latitude=office_lat,
                    longitude=office_lng,
                    location_accuracy=Decimal('18.00'),
                    location_captured_at=_aware(cursor, 9, 12),
                    attendance_method=(
                        Attendance.METHOD_CAMERA
                        if status in Attendance.PHOTO_STATUSES
                        else Attendance.METHOD_MANUAL
                    ),
                    remarks='Mock seed',
                    created_by=user,
                )
                if status in Attendance.PHOTO_STATUSES:
                    att.check_in_time = _aware(cursor, 9, 10 + (emp.id % 20))
                    att.photo = _selfie(f'{emp.employee_id} {cursor.isoformat()}')
                    if cursor < today and status == Attendance.STATUS_PRESENT:
                        att.check_out_time = _aware(cursor, 18, 5)
                        att.check_out_photo = _selfie(f'{emp.employee_id} out {cursor.isoformat()}')
                        att.check_out_latitude = office_lat
                        att.check_out_longitude = office_lng
                        att.check_out_accuracy = Decimal('22.00')
                        att.check_out_captured_at = att.check_out_time
                att.save()
                cursor += timedelta(days=1)

        ramesh = employees['EMP-001']
        amit = employees['EMP-003']
        if not LeaveRecord.objects.filter(employee=ramesh, start_date=month_start + timedelta(days=2)).exists():
            start = month_start + timedelta(days=2)
            end = month_start + timedelta(days=3)
            leave = LeaveRecord(
                employee=ramesh,
                leave_type=LeaveRecord.TYPE_PAID,
                start_date=start,
                end_date=end,
                reason='Family function',
                created_by=user,
            )
            leave.save()
            Attendance.objects.filter(employee=ramesh, date__gte=start, date__lte=end).delete()
            for day in (start, end):
                Attendance.objects.create(
                    employee=ramesh,
                    date=day,
                    status=Attendance.STATUS_PAID_LEAVE,
                    latitude=office_lat,
                    longitude=office_lng,
                    location_accuracy=Decimal('18.00'),
                    location_captured_at=_aware(day, 10, 0),
                    attendance_method=Attendance.METHOD_MANUAL,
                    leave=leave,
                    remarks=leave.reason,
                    created_by=user,
                )

        if not LeaveRecord.objects.filter(employee=amit, leave_type=LeaveRecord.TYPE_UNPAID).exists():
            start = month_start + timedelta(days=4)
            leave = LeaveRecord(
                employee=amit,
                leave_type=LeaveRecord.TYPE_UNPAID,
                start_date=start,
                end_date=start,
                reason='Personal work',
                created_by=user,
            )
            leave.save()
            Attendance.objects.filter(employee=amit, date=start).delete()
            Attendance.objects.create(
                employee=amit,
                date=start,
                status=Attendance.STATUS_UNPAID_LEAVE,
                latitude=office_lat,
                longitude=office_lng,
                location_accuracy=Decimal('18.00'),
                location_captured_at=_aware(start, 10, 0),
                attendance_method=Attendance.METHOD_MANUAL,
                leave=leave,
                remarks=leave.reason,
                created_by=user,
            )

        advances = [
            (ramesh, month_start + timedelta(days=4), Decimal('2000.00'), 'Personal'),
            (ramesh, month_start + timedelta(days=9), Decimal('3000.00'), 'Personal'),
            (employees['EMP-002'], month_start + timedelta(days=6), Decimal('1500.00'), 'Medical'),
            (employees['EMP-005'], month_start + timedelta(days=3), Decimal('1000.00'), 'Festival'),
        ]
        for emp, adv_date, amount, reason in advances:
            if adv_date > today:
                continue
            SalaryAdvance.objects.get_or_create(
                employee=emp,
                date=adv_date,
                amount=amount,
                defaults={'reason': reason, 'created_by': user, 'status': SalaryAdvance.STATUS_ACTIVE},
            )

        for emp in active:
            calc = calculate_employee_month(emp, today.year, today.month, today=today)
            record, _ = SalaryRecord.objects.get_or_create(
                employee=emp,
                year=today.year,
                month=today.month,
                defaults={
                    'gross_salary': calc['gross_salary'],
                    'net_salary': calc['net_salary'],
                    'daily_salary': calc['daily_salary'],
                    'divisor_days': calc['divisor_days'],
                    'calculation_method': calc['calculation_method'],
                    'status': SalaryRecord.STATUS_DRAFT,
                },
            )
            if record.status != SalaryRecord.STATUS_FINALIZED:
                apply_calculation_to_record(record, calc)
                record.save()
                refresh_payment_status(record)

        priya_record = SalaryRecord.objects.filter(
            employee=employees['EMP-004'], year=today.year, month=today.month
        ).first()
        if priya_record and not priya_record.payments.exists():
            SalaryPayment.objects.create(
                employee=employees['EMP-004'],
                salary_record=priya_record,
                payment_date=today,
                amount=Decimal('10000.00'),
                payment_mode=SalaryPayment.MODE_UPI,
                reference_number='UPI-MOCK-001',
                remarks='Partial mock payment',
                created_by=user,
            )
            refresh_payment_status(priya_record)

        self.stdout.write(self.style.SUCCESS(
            'Seeded Salary Book mock data. '
            f'Office geofence: {office_lat}, {office_lng} within {settings_obj.geofence_radius_meters}m. '
            'Present requires a selfie inside that radius.'
        ))
