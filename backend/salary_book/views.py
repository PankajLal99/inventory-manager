import calendar
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken, TokenError

from backend.core.views import CustomTokenObtainPairSerializer
from backend.salary_book.authentication import (
    issue_salary_book_tokens,
    password_fingerprint,
)
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()

from .models import (
    Attendance,
    Employee,
    EmployeeAttendanceRule,
    LeaveRecord,
    SalaryAdvance,
    SalaryBookSettings,
    SalaryPayment,
    SalaryRecord,
)
from .permissions import IsSalaryBookUser, user_can_access_salary_book
from .serializers import (
    AttendanceSerializer,
    EmployeeAttendanceRuleSerializer,
    EmployeeSerializer,
    LeaveRecordSerializer,
    SalaryAdvanceSerializer,
    SalaryBookSettingsSerializer,
    SalaryPaymentSerializer,
    SalaryRecordSerializer,
)
from .services.attendance_gps import (
    validate_checkout_gps_and_photo,
    validate_create_gps_and_photo,
)
from .services.attendance_evaluator import evaluate_check_in, refresh_worked_minutes
from .services.image_utils import maybe_compress, validate_and_compress_image
from .services.salary_calculator import (
    apply_calculation_to_record,
    calculate_employee_month,
    month_is_finalized,
    month_range,
    refresh_payment_status,
)


def _paginate(queryset, request, serializer_class):
    try:
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 25))
    except (TypeError, ValueError):
        page, page_size = 1, 25
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    total = queryset.count()
    start = (page - 1) * page_size
    page_qs = queryset[start:start + page_size]
    return Response({
        'count': total,
        'page': page,
        'page_size': page_size,
        'results': serializer_class(page_qs, many=True, context={'request': request}).data,
    })


def _err(message, http_status=status.HTTP_400_BAD_REQUEST):
    return Response({'error': message}, status=http_status)


def _parse_date(value, field='date'):
    if not value:
        raise ValidationError({field: 'This field is required.'})
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError({field: 'Enter a valid date (YYYY-MM-DD).'})


def _captured_at(data, key='location_captured_at'):
    raw = data.get(key)
    if not raw:
        return timezone.now()
    if isinstance(raw, datetime):
        return raw
    try:
        parsed = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed
    except ValueError:
        return timezone.now()


def _assert_month_open(employee, for_date):
    if month_is_finalized(employee, for_date):
        raise ValidationError(
            'This month is finalized. Reopen the salary record to make changes.'
        )


def _request_data(request):
    return request.data if hasattr(request, 'data') else {}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([AllowAny])
def salary_book_login(request):
    serializer = CustomTokenObtainPairSerializer(data=request.data)
    try:
        serializer.is_valid(raise_exception=True)
    except (AuthenticationFailed, InvalidToken, TokenError):
        return _err('Invalid user ID or password.', status.HTTP_401_UNAUTHORIZED)
    except ValidationError:
        return _err('Invalid user ID or password.', status.HTTP_401_UNAUTHORIZED)
    user = serializer.user
    if not user_can_access_salary_book(user):
        return _err('You do not have access to Salary Book.', status.HTTP_403_FORBIDDEN)
    return Response(issue_salary_book_tokens(user))


@api_view(['POST'])
@permission_classes([AllowAny])
def salary_book_refresh(request):
    raw = request.data.get('refresh')
    if not raw:
        return _err('Session expired. Please log in again.', status.HTTP_401_UNAUTHORIZED)
    try:
        token = RefreshToken(raw)
    except TokenError:
        return _err('Session expired. Please log in again.', status.HTTP_401_UNAUTHORIZED)
    user = User.objects.filter(pk=token.get('user_id'), is_active=True).first()
    if not user or not user_can_access_salary_book(user):
        return _err('Session expired. Please log in again.', status.HTTP_401_UNAUTHORIZED)
    if token.get('pwd') != password_fingerprint(user):
        return _err('Password changed. Please log in again.', status.HTTP_401_UNAUTHORIZED)
    return Response(issue_salary_book_tokens(user))


def _user_profile(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email or '',
        'first_name': user.first_name or '',
        'last_name': user.last_name or '',
        'phone': getattr(user, 'phone', None) or '',
        'groups': list(user.groups.values_list('name', flat=True)),
        'is_superuser': user.is_superuser,
        'is_staff': user.is_staff,
        'date_joined': user.date_joined.isoformat() if user.date_joined else None,
    }


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_book_me(request):
    user = request.user
    if request.method == 'GET':
        return Response(_user_profile(user))

    first_name = request.data.get('first_name', user.first_name)
    last_name = request.data.get('last_name', user.last_name)
    email = request.data.get('email', user.email)
    phone = request.data.get('phone', getattr(user, 'phone', '') or '')
    if first_name is not None:
        user.first_name = str(first_name).strip()[:150]
    if last_name is not None:
        user.last_name = str(last_name).strip()[:150]
    if email is not None:
        user.email = str(email).strip()[:254]
    if phone is not None and hasattr(user, 'phone'):
        user.phone = str(phone).strip()[:20]
    user.save()
    return Response(_user_profile(user))


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_book_change_password(request):
    user = request.user
    current = request.data.get('current_password') or ''
    new = request.data.get('new_password') or ''
    if not user.check_password(current):
        return _err('Current password is incorrect.')
    if len(str(new)) < 8:
        return _err('New password must be at least 8 characters.')
    if current == new:
        return _err('New password must be different from the current password.')
    user.set_password(new)
    user.save()
    return Response(issue_salary_book_tokens(user))


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def settings_view(request):
    obj = SalaryBookSettings.get_solo()
    if request.method == 'GET':
        return Response(SalaryBookSettingsSerializer(obj).data)
    data = request.data.copy()
    if data.get('require_gps') in (False, 'false', 'False', '0', 0):
        return _err('GPS is mandatory and cannot be disabled.')
    data['require_gps'] = True
    serializer = SalaryBookSettingsSerializer(obj, data=data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def employee_list_create(request):
    if request.method == 'GET':
        qs = Employee.objects.all()
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter.upper())
        q = (request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) | Q(employee_id__icontains=q) | Q(mobile__icontains=q)
            )
        return _paginate(qs, request, EmployeeSerializer)

    data = request.data.copy()
    photo = maybe_compress(request.FILES, 'profile_photo')
    serializer = EmployeeSerializer(data=data, context={'request': request})
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    employee = serializer.save()
    if photo:
        employee.profile_photo = photo
        employee.save(update_fields=['profile_photo'])
    return Response(
        EmployeeSerializer(employee, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def employee_detail(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    if request.method == 'GET':
        return Response(EmployeeSerializer(employee, context={'request': request}).data)

    if 'monthly_salary' in request.data:
        try:
            new_salary = Decimal(str(request.data.get('monthly_salary')))
        except Exception:
            return _err('Invalid salary amount.')
        if new_salary != employee.monthly_salary:
            pass  # confirmation happens on the client; still apply
    serializer = EmployeeSerializer(
        employee, data=request.data, partial=True, context={'request': request}
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    employee = serializer.save()
    photo = maybe_compress(request.FILES, 'profile_photo')
    if photo:
        employee.profile_photo = photo
        employee.save(update_fields=['profile_photo'])
    return Response(EmployeeSerializer(employee, context={'request': request}).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_attendance_rule_list(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    if request.method == 'GET':
        qs = employee.attendance_rules.all()
        return Response(EmployeeAttendanceRuleSerializer(qs, many=True).data)

    serializer = EmployeeAttendanceRuleSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    rule = serializer.save(employee=employee)
    return Response(EmployeeAttendanceRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_attendance_rule_detail(request, pk, rule_id):
    employee = get_object_or_404(Employee, pk=pk)
    rule = get_object_or_404(EmployeeAttendanceRule, pk=rule_id, employee=employee)
    if request.method == 'GET':
        return Response(EmployeeAttendanceRuleSerializer(rule).data)
    if request.method == 'DELETE':
        rule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = EmployeeAttendanceRuleSerializer(rule, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_photo(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    if not employee.profile_photo:
        raise Http404('No photo')
    try:
        handle = employee.profile_photo.open('rb')
    except FileNotFoundError:
        raise Http404('No photo')
    return FileResponse(handle, content_type='image/jpeg')


def _employee_history_month_filter(qs, request, date_field):
    month = request.query_params.get('month')
    year = request.query_params.get('year')
    if month and year:
        try:
            start, end = month_range(int(year), int(month))
            qs = qs.filter(**{f'{date_field}__gte': start, f'{date_field}__lte': end})
        except (TypeError, ValueError, calendar.IllegalMonthError):
            pass
    return qs


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_attendance_history(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    qs = Attendance.objects.filter(employee=employee)
    qs = _employee_history_month_filter(qs, request, 'date')
    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter.upper())
    return _paginate(qs, request, AttendanceSerializer)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_leave_history(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    qs = LeaveRecord.objects.filter(employee=employee)
    qs = _employee_history_month_filter(qs, request, 'start_date')
    return _paginate(qs, request, LeaveRecordSerializer)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_advance_history(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    qs = SalaryAdvance.objects.filter(employee=employee)
    qs = _employee_history_month_filter(qs, request, 'date')
    total = qs.filter(status=SalaryAdvance.STATUS_ACTIVE).aggregate(total=Sum('amount'))['total'] or 0
    page = _paginate(qs, request, SalaryAdvanceSerializer)
    page.data['total_active'] = str(total)
    return page


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def employee_salary_history(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    qs = SalaryRecord.objects.filter(employee=employee)
    return _paginate(qs, request, SalaryRecordSerializer)


# ---------------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def attendance_list_create(request):
    if request.method == 'GET':
        qs = Attendance.objects.select_related('employee').all()
        date_str = request.query_params.get('date')
        if date_str:
            qs = qs.filter(date=_parse_date(date_str))
        employee_id = request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter.upper())
        return _paginate(qs, request, AttendanceSerializer)

    data = request.data
    try:
        employee = Employee.objects.get(pk=data.get('employee'))
    except (Employee.DoesNotExist, ValueError, TypeError):
        return _err('Select a valid employee.')

    att_date = _parse_date(data.get('date') or timezone.localdate().isoformat())
    att_status = (data.get('status') or Attendance.STATUS_PRESENT).upper()
    if employee.status != Employee.STATUS_ACTIVE:
        return _err('Inactive employees cannot be marked in daily attendance.')
    if att_status not in dict(Attendance.STATUS_CHOICES):
        return _err('Invalid attendance status.')

    try:
        _assert_month_open(employee, att_date)
        gps = validate_create_gps_and_photo(data, request.FILES, att_status)
    except ValidationError as exc:
        detail = exc.detail if hasattr(exc, 'detail') else str(exc)
        if isinstance(detail, dict):
            msg = next(iter(detail.values()))
            if isinstance(msg, list):
                msg = msg[0]
            return _err(str(msg))
        return _err(str(detail))

    if Attendance.objects.filter(employee=employee, date=att_date).exists():
        return _err('Attendance for this employee on this date already exists.')

    photo = gps['photo']
    if photo:
        try:
            photo = validate_and_compress_image(photo, 'photo')
        except ValidationError as exc:
            detail = exc.detail
            msg = next(iter(detail.values())) if isinstance(detail, dict) else detail
            if isinstance(msg, list):
                msg = msg[0]
            return _err(str(msg))

    method = Attendance.METHOD_CAMERA if photo else Attendance.METHOD_MANUAL
    check_in = None
    if att_status in Attendance.PHOTO_STATUSES:
        check_in = timezone.now()

    evaluated = evaluate_check_in(employee, att_date, att_status, check_in)
    remarks = data.get('remarks') or ''
    if evaluated.rule_penalty_applied:
        extra = evaluated.rule_remarks
        remarks = f'{remarks} {extra}'.strip() if remarks else extra

    attendance = Attendance.objects.create(
        employee=employee,
        date=att_date,
        status=evaluated.status,
        check_in_time=check_in,
        photo=photo,
        latitude=gps['latitude'],
        longitude=gps['longitude'],
        location_accuracy=gps['location_accuracy'],
        location_captured_at=_captured_at(data),
        attendance_method=method,
        remarks=remarks,
        minutes_late=evaluated.minutes_late,
        is_late=evaluated.is_late,
        worked_minutes=evaluated.worked_minutes,
        payable_minutes=evaluated.payable_minutes,
        rule_penalty_applied=evaluated.rule_penalty_applied,
        rule_remarks=evaluated.rule_remarks,
        created_by=request.user,
    )
    return Response(
        AttendanceSerializer(attendance, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def attendance_detail(request, pk):
    attendance = get_object_or_404(Attendance.objects.select_related('employee'), pk=pk)
    if request.method == 'GET':
        return Response(AttendanceSerializer(attendance, context={'request': request}).data)

    try:
        _assert_month_open(attendance.employee, attendance.date)
    except ValidationError as exc:
        return _err(str(exc.detail if hasattr(exc, 'detail') else exc))

    data = request.data
    action = (data.get('action') or '').lower()

    if action == 'checkout' or data.get('check_out') in (True, 'true', '1', 1):
        if attendance.check_out_time:
            return _err('Check-out has already been recorded.')
        if attendance.status not in Attendance.PHOTO_STATUSES:
            return _err('Check-out is only for present or half-day attendance.')
        try:
            lat, lng, accuracy, photo = validate_checkout_gps_and_photo(data, request.FILES)
        except ValidationError as exc:
            detail = exc.detail if hasattr(exc, 'detail') else str(exc)
            if isinstance(detail, dict):
                msg = next(iter(detail.values()))
                if isinstance(msg, list):
                    msg = msg[0]
                return _err(str(msg))
            return _err(str(detail))
        if photo:
            photo = validate_and_compress_image(photo, 'check_out_photo')
        attendance.check_out_time = timezone.now()
        attendance.check_out_latitude = lat
        attendance.check_out_longitude = lng
        attendance.check_out_accuracy = accuracy
        attendance.check_out_captured_at = _captured_at(data, 'check_out_captured_at')
        if photo:
            attendance.check_out_photo = photo
        refresh_worked_minutes(attendance)
        attendance.save()
        return Response(AttendanceSerializer(attendance, context={'request': request}).data)

    new_status = data.get('status')
    if new_status:
        new_status = new_status.upper()
        if new_status not in dict(Attendance.STATUS_CHOICES):
            return _err('Invalid attendance status.')
        attendance.status = new_status
    if 'remarks' in data:
        attendance.remarks = data.get('remarks') or ''
    attendance.save()
    return Response(AttendanceSerializer(attendance, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def attendance_photo(request, pk):
    attendance = get_object_or_404(Attendance, pk=pk)
    kind = request.query_params.get('kind', 'check_in')
    field = attendance.check_out_photo if kind == 'check_out' else attendance.photo
    if not field:
        raise Http404('No photo')
    try:
        handle = field.open('rb')
    except FileNotFoundError:
        raise Http404('No photo')
    return FileResponse(handle, content_type='image/jpeg')


# ---------------------------------------------------------------------------
# Leaves
# ---------------------------------------------------------------------------

def _daterange(start, end):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def leave_list_create(request):
    if request.method == 'GET':
        qs = LeaveRecord.objects.select_related('employee').all()
        employee_id = request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter.upper())
        leave_type = request.query_params.get('leave_type')
        if leave_type:
            qs = qs.filter(leave_type=leave_type.upper())
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            start, end = month_range(int(year), int(month))
            qs = qs.filter(start_date__lte=end, end_date__gte=start)
        return _paginate(qs, request, LeaveRecordSerializer)

    data = request.data
    try:
        employee = Employee.objects.get(pk=data.get('employee'))
    except (Employee.DoesNotExist, ValueError, TypeError):
        return _err('Select a valid employee.')

    start = _parse_date(data.get('start_date') or data.get('date'), 'start_date')
    end = _parse_date(data.get('end_date') or start, 'end_date')
    if end < start:
        return _err('End date cannot be before start date.')
    leave_type = (data.get('leave_type') or '').upper()
    if leave_type not in dict(LeaveRecord.TYPE_CHOICES):
        return _err('Leave type must be Paid or Unpaid.')

    overlap = LeaveRecord.objects.filter(
        employee=employee,
        status=LeaveRecord.STATUS_ACTIVE,
        start_date__lte=end,
        end_date__gte=start,
    ).exists()
    if overlap:
        return _err('This employee already has leave overlapping these dates.')

    existing_att = Attendance.objects.filter(employee=employee, date__gte=start, date__lte=end)
    if existing_att.exists():
        return _err('Attendance already exists for one or more days in this range.')

    for day in _daterange(start, end):
        try:
            _assert_month_open(employee, day)
        except ValidationError as exc:
            return _err(str(exc.detail if hasattr(exc, 'detail') else exc))

    try:
        gps = validate_create_gps_and_photo(
            data,
            None,
            Attendance.STATUS_PAID_LEAVE,
        )
    except ValidationError as exc:
        detail = exc.detail if hasattr(exc, 'detail') else str(exc)
        if isinstance(detail, dict):
            msg = next(iter(detail.values()))
            if isinstance(msg, list):
                msg = msg[0]
            return _err(str(msg))
        return _err(str(detail))

    att_status = (
        Attendance.STATUS_PAID_LEAVE
        if leave_type == LeaveRecord.TYPE_PAID
        else Attendance.STATUS_UNPAID_LEAVE
    )
    captured = _captured_at(data)

    with transaction.atomic():
        leave = LeaveRecord(
            employee=employee,
            leave_type=leave_type,
            start_date=start,
            end_date=end,
            reason=data.get('reason') or '',
            remarks=data.get('remarks') or '',
            created_by=request.user,
        )
        leave.save()
        rows = [
            Attendance(
                employee=employee,
                date=day,
                status=att_status,
                latitude=gps['latitude'],
                longitude=gps['longitude'],
                location_accuracy=gps['location_accuracy'],
                location_captured_at=captured,
                attendance_method=Attendance.METHOD_MANUAL,
                leave=leave,
                remarks=data.get('reason') or '',
                created_by=request.user,
            )
            for day in _daterange(start, end)
        ]
        Attendance.objects.bulk_create(rows)

    return Response(
        LeaveRecordSerializer(leave, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def leave_void(request, pk):
    leave = get_object_or_404(LeaveRecord, pk=pk)
    if leave.status == LeaveRecord.STATUS_VOID:
        return _err('This leave is already voided.')
    for day in _daterange(leave.start_date, leave.end_date):
        try:
            _assert_month_open(leave.employee, day)
        except ValidationError as exc:
            return _err(str(exc.detail if hasattr(exc, 'detail') else exc))
    with transaction.atomic():
        leave.attendance_rows.all().delete()
        leave.status = LeaveRecord.STATUS_VOID
        leave.save(update_fields=['status', 'updated_at'])
    return Response(LeaveRecordSerializer(leave, context={'request': request}).data)


# ---------------------------------------------------------------------------
# Advances
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def advance_list_create(request):
    if request.method == 'GET':
        qs = SalaryAdvance.objects.select_related('employee').all()
        employee_id = request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter.upper())
        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            start, end = month_range(int(year), int(month))
            qs = qs.filter(date__gte=start, date__lte=end)
        return _paginate(qs, request, SalaryAdvanceSerializer)

    data = request.data
    try:
        employee = Employee.objects.get(pk=data.get('employee'))
    except (Employee.DoesNotExist, ValueError, TypeError):
        return _err('Select a valid employee.')
    adv_date = _parse_date(data.get('date') or timezone.localdate().isoformat())
    try:
        _assert_month_open(employee, adv_date)
        amount = Decimal(str(data.get('amount')))
    except ValidationError as exc:
        return _err(str(exc.detail if hasattr(exc, 'detail') else exc))
    except Exception:
        return _err('Enter a valid amount.')
    if amount <= 0:
        return _err('Advance amount must be greater than zero.')

    advance = SalaryAdvance.objects.create(
        employee=employee,
        date=adv_date,
        amount=amount,
        reason=data.get('reason') or '',
        remarks=data.get('remarks') or '',
        created_by=request.user,
    )
    return Response(
        SalaryAdvanceSerializer(advance, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def advance_void(request, pk):
    advance = get_object_or_404(SalaryAdvance, pk=pk)
    if advance.status == SalaryAdvance.STATUS_VOID:
        return _err('This advance is already voided.')
    try:
        _assert_month_open(advance.employee, advance.date)
    except ValidationError as exc:
        return _err(str(exc.detail if hasattr(exc, 'detail') else exc))
    advance.status = SalaryAdvance.STATUS_VOID
    advance.updated_by = request.user
    advance.save(update_fields=['status', 'updated_by', 'updated_at'])
    return Response(SalaryAdvanceSerializer(advance, context={'request': request}).data)


# ---------------------------------------------------------------------------
# Salaries
# ---------------------------------------------------------------------------

def _upsert_draft(employee, year, month):
    existing = SalaryRecord.objects.filter(employee=employee, year=year, month=month).first()
    if existing and existing.status == SalaryRecord.STATUS_FINALIZED:
        return existing, False
    calc = calculate_employee_month(employee, year, month)
    if existing:
        apply_calculation_to_record(existing, calc)
        existing.save()
        refresh_payment_status(existing)
        return existing, False
    record = SalaryRecord(employee=employee, year=year, month=month, status=SalaryRecord.STATUS_DRAFT)
    apply_calculation_to_record(record, calc)
    record.save()
    refresh_payment_status(record)
    return record, True


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_list(request):
    today = timezone.localdate()
    try:
        year = int(request.query_params.get('year', today.year))
        month = int(request.query_params.get('month', today.month))
    except (TypeError, ValueError):
        return _err('Invalid month or year.')
    if month < 1 or month > 12:
        return _err('Month must be between 1 and 12.')

    employees = Employee.objects.filter(status=Employee.STATUS_ACTIVE).order_by('name')
    records = []
    for emp in employees:
        record, _ = _upsert_draft(emp, year, month)
        records.append(record)

    serializer = SalaryRecordSerializer(records, many=True, context={'request': request})
    totals = {
        'total_employees': len(records),
        'total_gross_salary': str(sum((r.gross_salary for r in records), Decimal('0'))),
        'total_leave_deduction': str(sum((r.leave_deduction for r in records), Decimal('0'))),
        'total_advances': str(sum((r.total_advances for r in records), Decimal('0'))),
        'total_net_payable': str(sum((r.net_salary for r in records), Decimal('0'))),
        'year': year,
        'month': month,
    }
    return Response({'totals': totals, 'results': serializer.data})


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_generate(request):
    today = timezone.localdate()
    try:
        year = int(request.data.get('year', today.year))
        month = int(request.data.get('month', today.month))
    except (TypeError, ValueError):
        return _err('Invalid month or year.')
    created = updated = skipped = 0
    for emp in Employee.objects.filter(status=Employee.STATUS_ACTIVE):
        existing = SalaryRecord.objects.filter(employee=emp, year=year, month=month).first()
        if existing and existing.status == SalaryRecord.STATUS_FINALIZED:
            skipped += 1
            continue
        _, was_created = _upsert_draft(emp, year, month)
        if was_created:
            created += 1
        else:
            updated += 1
    return Response({'created': created, 'updated': updated, 'skipped_finalized': skipped, 'year': year, 'month': month})


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_detail(request, pk):
    record = get_object_or_404(SalaryRecord.objects.select_related('employee'), pk=pk)
    if record.status != SalaryRecord.STATUS_FINALIZED:
        calc = calculate_employee_month(record.employee, record.year, record.month)
        apply_calculation_to_record(record, calc)
        record.save()
        refresh_payment_status(record)
        record.refresh_from_db()
    payments = SalaryPayment.objects.filter(salary_record=record)
    data = SalaryRecordSerializer(record, context={'request': request}).data
    data['payments'] = SalaryPaymentSerializer(payments, many=True).data
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_finalize(request, pk):
    record = get_object_or_404(SalaryRecord, pk=pk)
    if record.status == SalaryRecord.STATUS_FINALIZED:
        return _err('This salary is already finalized.')
    calc = calculate_employee_month(record.employee, record.year, record.month)
    apply_calculation_to_record(record, calc)
    record.status = SalaryRecord.STATUS_FINALIZED
    record.finalized_by = request.user
    record.finalized_at = timezone.now()
    record.save()
    refresh_payment_status(record)
    return Response(SalaryRecordSerializer(record, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def salary_reopen(request, pk):
    record = get_object_or_404(SalaryRecord, pk=pk)
    if record.status != SalaryRecord.STATUS_FINALIZED:
        return _err('Only finalized salaries can be reopened.')
    record.status = SalaryRecord.STATUS_DRAFT
    record.finalized_by = None
    record.finalized_at = None
    record.save(update_fields=['status', 'finalized_by', 'finalized_at', 'updated_at'])
    calc = calculate_employee_month(record.employee, record.year, record.month)
    apply_calculation_to_record(record, calc)
    record.save()
    refresh_payment_status(record)
    return Response(SalaryRecordSerializer(record, context={'request': request}).data)


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def payment_list_create(request):
    if request.method == 'GET':
        qs = SalaryPayment.objects.select_related('employee', 'salary_record').all()
        record_id = request.query_params.get('salary_record')
        if record_id:
            qs = qs.filter(salary_record_id=record_id)
        employee_id = request.query_params.get('employee')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        return _paginate(qs, request, SalaryPaymentSerializer)

    data = request.data
    record = get_object_or_404(SalaryRecord, pk=data.get('salary_record'))
    try:
        amount = Decimal(str(data.get('amount')))
    except Exception:
        return _err('Enter a valid amount.')
    if amount <= 0:
        return _err('Payment amount must be greater than zero.')
    pay_date = _parse_date(data.get('payment_date') or timezone.localdate().isoformat(), 'payment_date')
    mode = (data.get('payment_mode') or SalaryPayment.MODE_CASH).upper()
    if mode not in dict(SalaryPayment.MODE_CHOICES):
        return _err('Invalid payment mode.')

    payment = SalaryPayment.objects.create(
        employee=record.employee,
        salary_record=record,
        payment_date=pay_date,
        amount=amount,
        payment_mode=mode,
        reference_number=data.get('reference_number') or '',
        remarks=data.get('remarks') or '',
        created_by=request.user,
    )
    refresh_payment_status(record)
    return Response(
        SalaryPaymentSerializer(payment, context={'request': request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def payment_void(request, pk):
    payment = get_object_or_404(SalaryPayment, pk=pk)
    if payment.status == SalaryPayment.STATUS_VOID:
        return _err('This payment is already voided.')
    payment.status = SalaryPayment.STATUS_VOID
    payment.updated_by = request.user
    payment.save(update_fields=['status', 'updated_by', 'updated_at'])
    refresh_payment_status(payment.salary_record)
    return Response(SalaryPaymentSerializer(payment, context={'request': request}).data)


# ---------------------------------------------------------------------------
# Attendance calendar
# ---------------------------------------------------------------------------

def _status_counts():
    counts = {key: 0 for key, _ in Attendance.STATUS_CHOICES}
    counts['unmarked'] = 0
    return counts


def _dt_iso(value):
    if value is None:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def attendance_calendar(request):
    today = timezone.localdate()
    try:
        year = int(request.query_params.get('year', today.year))
        month = int(request.query_params.get('month', today.month))
    except (TypeError, ValueError):
        year, month = today.year, today.month
    try:
        start, end = month_range(year, month)
    except (calendar.IllegalMonthError, ValueError):
        return _err('Invalid month.')

    days_in_month = calendar.monthrange(year, month)[1]
    employee_id = request.query_params.get('employee')
    if employee_id:
        employees = list(Employee.objects.filter(pk=employee_id))
        if not employees:
            return _err('Employee not found.', status.HTTP_404_NOT_FOUND)
        view = 'employee'
    else:
        employees = list(Employee.objects.filter(status=Employee.STATUS_ACTIVE).order_by('name'))
        view = 'admin'

    rows = Attendance.objects.filter(
        employee_id__in=[emp.id for emp in employees],
        date__gte=start,
        date__lte=end,
    ).values(
        'id',
        'employee_id',
        'date',
        'status',
        'check_in_time',
        'check_out_time',
        'minutes_late',
        'is_late',
        'rule_penalty_applied',
    )

    by_emp = {}
    for row in rows:
        by_emp.setdefault(row['employee_id'], {})[row['date'].day] = {
            'id': row['id'],
            'status': row['status'],
            'check_in_time': _dt_iso(row['check_in_time']),
            'check_out_time': _dt_iso(row['check_out_time']),
            'minutes_late': row['minutes_late'],
            'is_late': row['is_late'],
            'rule_penalty_applied': row['rule_penalty_applied'],
        }

    team = _status_counts()
    payload = []
    for emp in employees:
        counts = _status_counts()
        days = {}
        for day in range(1, days_in_month + 1):
            cell_date = date(year, month, day)
            if emp.date_of_joining and cell_date < emp.date_of_joining:
                days[str(day)] = {'status': 'BEFORE_JOINING'}
                continue
            if cell_date > today:
                days[str(day)] = {'status': None}
                continue
            marked = by_emp.get(emp.id, {}).get(day)
            if marked:
                days[str(day)] = marked
                counts[marked['status']] += 1
                team[marked['status']] += 1
            else:
                days[str(day)] = {'status': None}
                counts['unmarked'] += 1
                team['unmarked'] += 1
        payload.append({
            'id': emp.id,
            'name': emp.name,
            'employee_id': emp.employee_id,
            'days': days,
            'counts': counts,
        })

    considered = (
        team[Attendance.STATUS_PRESENT]
        + team[Attendance.STATUS_ABSENT]
        + team[Attendance.STATUS_HALF_DAY]
        + team[Attendance.STATUS_PAID_LEAVE]
        + team[Attendance.STATUS_UNPAID_LEAVE]
        + team[Attendance.STATUS_HOLIDAY]
        + team['unmarked']
    )
    paid_presence = (
        team[Attendance.STATUS_PRESENT]
        + team[Attendance.STATUS_HOLIDAY]
        + team[Attendance.STATUS_PAID_LEAVE]
        + Decimal(team[Attendance.STATUS_HALF_DAY]) / 2
    )
    rate = (paid_presence / considered * 100) if considered else Decimal('0')

    return Response({
        'year': year,
        'month': month,
        'days_in_month': days_in_month,
        'today': today.isoformat(),
        'view': view,
        'kpis': {
            'employees': len(employees),
            'present': team[Attendance.STATUS_PRESENT],
            'absent': team[Attendance.STATUS_ABSENT],
            'half_day': team[Attendance.STATUS_HALF_DAY],
            'paid_leave': team[Attendance.STATUS_PAID_LEAVE],
            'unpaid_leave': team[Attendance.STATUS_UNPAID_LEAVE],
            'holiday': team[Attendance.STATUS_HOLIDAY],
            'unmarked': team['unmarked'],
            'attendance_rate': str(rate.quantize(Decimal('0.1'))),
        },
        'employees': payload,
    })


# ---------------------------------------------------------------------------
# Dashboard + reports
# ---------------------------------------------------------------------------

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def dashboard(request):
    today = timezone.localdate()
    try:
        year = int(request.query_params.get('year', today.year))
        month = int(request.query_params.get('month', today.month))
    except (TypeError, ValueError):
        year, month = today.year, today.month

    today_rows = Attendance.objects.filter(date=today).select_related('employee')
    counts = {key: 0 for key, _ in Attendance.STATUS_CHOICES}
    for row in today_rows.values('status').annotate(n=Count('id')):
        counts[row['status']] = row['n']

    employees = Employee.objects.filter(status=Employee.STATUS_ACTIVE)
    marked_ids = set(today_rows.values_list('employee_id', flat=True))
    unmarked_employees = list(
        employees.exclude(id__in=marked_ids).order_by('name').values('id', 'name', 'employee_id')
    )
    live_marked = sorted(
        today_rows,
        key=lambda row: (
            0 if row.check_in_time else 1,
            -(row.check_in_time.timestamp() if row.check_in_time else 0),
            -(row.updated_at.timestamp() if row.updated_at else 0),
        ),
    )
    payroll = Decimal('0')
    advances = Decimal('0')
    pending = Decimal('0')
    for emp in employees:
        record, _ = _upsert_draft(emp, year, month)
        payroll += record.gross_salary
        advances += record.total_advances
        if record.payment_status != SalaryRecord.PAY_PAID:
            paid = record.payments.filter(status=SalaryPayment.STATUS_ACTIVE).aggregate(
                total=Sum('amount')
            )['total'] or Decimal('0')
            remaining = record.net_salary - paid
            if remaining > 0:
                pending += remaining

    hour = timezone.localtime().hour
    if hour < 12:
        greeting = 'Good Morning'
    elif hour < 17:
        greeting = 'Good Afternoon'
    else:
        greeting = 'Good Evening'

    return Response({
        'greeting': greeting,
        'today': today.isoformat(),
        'today_attendance': {
            'present': counts.get(Attendance.STATUS_PRESENT, 0),
            'absent': counts.get(Attendance.STATUS_ABSENT, 0),
            'paid_leave': counts.get(Attendance.STATUS_PAID_LEAVE, 0),
            'unpaid_leave': counts.get(Attendance.STATUS_UNPAID_LEAVE, 0),
            'half_day': counts.get(Attendance.STATUS_HALF_DAY, 0),
            'holiday': counts.get(Attendance.STATUS_HOLIDAY, 0),
            'unmarked': len(unmarked_employees),
        },
        'live': {
            'updated_at': timezone.localtime().isoformat(),
            'marked': AttendanceSerializer(live_marked, many=True, context={'request': request}).data,
            'unmarked': unmarked_employees,
        },
        'month': {
            'year': year,
            'month': month,
            'total_employees': employees.count(),
            'monthly_payroll': str(payroll),
            'advances': str(advances),
            'salary_pending': str(pending),
        },
    })


def _report_filters(request):
    params = {}
    employee = request.query_params.get('employee')
    if employee:
        params['employee_id'] = employee
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    month = request.query_params.get('month')
    year = request.query_params.get('year')
    return params, date_from, date_to, month, year


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def report_attendance(request):
    qs = Attendance.objects.select_related('employee').all()
    params, date_from, date_to, month, year = _report_filters(request)
    if params.get('employee_id'):
        qs = qs.filter(employee_id=params['employee_id'])
    if date_from:
        qs = qs.filter(date__gte=_parse_date(date_from, 'date_from'))
    if date_to:
        qs = qs.filter(date__lte=_parse_date(date_to, 'date_to'))
    if month and year:
        start, end = month_range(int(year), int(month))
        qs = qs.filter(date__gte=start, date__lte=end)
    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter.upper())
    return _paginate(qs, request, AttendanceSerializer)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def report_leaves(request):
    qs = LeaveRecord.objects.select_related('employee').all()
    params, date_from, date_to, month, year = _report_filters(request)
    if params.get('employee_id'):
        qs = qs.filter(employee_id=params['employee_id'])
    if month and year:
        start, end = month_range(int(year), int(month))
        qs = qs.filter(start_date__lte=end, end_date__gte=start)
    return _paginate(qs, request, LeaveRecordSerializer)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def report_advances(request):
    qs = SalaryAdvance.objects.select_related('employee').all()
    params, date_from, date_to, month, year = _report_filters(request)
    if params.get('employee_id'):
        qs = qs.filter(employee_id=params['employee_id'])
    if month and year:
        start, end = month_range(int(year), int(month))
        qs = qs.filter(date__gte=start, date__lte=end)
    if date_from:
        qs = qs.filter(date__gte=_parse_date(date_from, 'date_from'))
    if date_to:
        qs = qs.filter(date__lte=_parse_date(date_to, 'date_to'))
    page = _paginate(qs, request, SalaryAdvanceSerializer)
    total = qs.filter(status=SalaryAdvance.STATUS_ACTIVE).aggregate(total=Sum('amount'))['total'] or 0
    page.data['total_active'] = str(total)
    return page


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsSalaryBookUser])
def report_salaries(request):
    today = timezone.localdate()
    try:
        year = int(request.query_params.get('year', today.year))
        month = int(request.query_params.get('month', today.month))
    except (TypeError, ValueError):
        year, month = today.year, today.month
    qs = SalaryRecord.objects.select_related('employee').filter(year=year, month=month)
    employee = request.query_params.get('employee')
    if employee:
        qs = qs.filter(employee_id=employee)
    return _paginate(qs, request, SalaryRecordSerializer)
