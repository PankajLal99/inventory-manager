from datetime import datetime
from decimal import Decimal, InvalidOperation
from math import atan2, cos, radians, sin, sqrt

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from backend.salary_book.models import Attendance, SalaryBookSettings

MAX_LOCATION_AGE_SECONDS = 15


def haversine_meters(lat1, lon1, lat2, lon2) -> float:
    radius = 6371000.0
    p1, p2 = radians(float(lat1)), radians(float(lat2))
    dphi = radians(float(lat2) - float(lat1))
    dlmb = radians(float(lon2) - float(lon1))
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlmb / 2) ** 2
    return 2 * radius * atan2(sqrt(a), sqrt(1 - a))


def _as_decimal(value, field_name):
    if value is None or value == '':
        raise ValidationError({field_name: 'Location is required. Attendance cannot be saved without GPS.'})
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValidationError({field_name: 'Invalid location value.'})


def parse_gps(data, prefix=''):
    """Extract and validate lat/lng/accuracy from request data. prefix e.g. 'check_out_'."""
    lat_key = f'{prefix}latitude' if prefix else 'latitude'
    lng_key = f'{prefix}longitude' if prefix else 'longitude'
    acc_key = f'{prefix}location_accuracy' if prefix else 'location_accuracy'
    if prefix == 'check_out_':
        acc_key = 'check_out_accuracy'
        if acc_key not in data and 'location_accuracy' in data:
            acc_key = 'location_accuracy'

    lat = _as_decimal(data.get(lat_key) if lat_key in data else data.get('latitude'), 'latitude')
    lng = _as_decimal(data.get(lng_key) if lng_key in data else data.get('longitude'), 'longitude')
    accuracy = _as_decimal(
        data.get(acc_key) if data.get(acc_key) is not None else data.get('location_accuracy'),
        'location_accuracy',
    )

    if lat < Decimal('-90') or lat > Decimal('90'):
        raise ValidationError({'latitude': 'Latitude must be between -90 and 90.'})
    if lng < Decimal('-180') or lng > Decimal('180'):
        raise ValidationError({'longitude': 'Longitude must be between -180 and 180.'})
    if accuracy < 0:
        raise ValidationError({'location_accuracy': 'Accuracy cannot be negative.'})
    return lat, lng, accuracy


def assert_accuracy_acceptable(accuracy, settings_obj=None):
    settings_obj = settings_obj or SalaryBookSettings.get_solo()
    max_m = Decimal(settings_obj.max_gps_accuracy_meters)
    if Decimal(str(accuracy)) > max_m:
        raise ValidationError({
            'location_accuracy': (
                'Your location accuracy is too low. Please move to an area with '
                'better GPS signal and try again.'
            )
        })


def parse_captured_at(value):
    if not value:
        return timezone.now()
    if isinstance(value, datetime):
        captured = value
    else:
        try:
            captured = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except ValueError:
            raise ValidationError({'location_captured_at': 'Invalid location timestamp. Sync GPS and try again.'})
    if timezone.is_naive(captured):
        captured = timezone.make_aware(captured, timezone.get_current_timezone())
    return captured


def assert_location_fresh(captured_at):
    captured = parse_captured_at(captured_at)
    age = (timezone.now() - captured).total_seconds()
    if age > MAX_LOCATION_AGE_SECONDS:
        raise ValidationError({
            'location_captured_at': 'Location is stale. Sync GPS and try again.'
        })
    if age < -60:
        raise ValidationError({
            'location_captured_at': 'Location timestamp is invalid. Sync GPS and try again.'
        })
    return captured


def assert_inside_geofence(lat, lng, settings_obj=None, for_status=None):
    """No attendance of any kind outside the workplace geofence."""
    settings_obj = settings_obj or SalaryBookSettings.get_solo()
    if settings_obj.office_latitude is None or settings_obj.office_longitude is None:
        raise ValidationError({
            'latitude': 'Office location is not set. Set it in Salary Book settings.'
        })
    distance = haversine_meters(
        lat, lng, settings_obj.office_latitude, settings_obj.office_longitude
    )
    allowed = float(settings_obj.geofence_radius_meters)
    if distance > allowed:
        raise ValidationError({
            'latitude': (
                f'You are {int(round(distance))}m away from the office. '
                f'Attendance can only be marked within {int(allowed)}m of the workplace.'
            )
        })
    return distance


def validate_create_gps_and_photo(data, files, status):
    """NO LOCATION = NO ATTENDANCE. Present requires geofence + selfie."""
    settings_obj = SalaryBookSettings.get_solo()
    if not settings_obj.require_gps:
        raise ValidationError({'require_gps': 'GPS is mandatory and cannot be disabled.'})

    lat, lng, accuracy = parse_gps(data)
    assert_accuracy_acceptable(accuracy, settings_obj)
    assert_location_fresh(data.get('location_captured_at') or data.get('check_out_captured_at'))
    distance = assert_inside_geofence(lat, lng, settings_obj, for_status=status)

    photo_required = settings_obj.require_photo and status in Attendance.PHOTO_STATUSES
    photo = files.get('photo') if files is not None else None
    if photo_required and not photo:
        raise ValidationError({
            'photo': 'A selfie is required to mark present or half-day attendance.'
        })
    return {
        'latitude': lat,
        'longitude': lng,
        'location_accuracy': accuracy,
        'photo': photo,
        'photo_required': photo_required,
        'settings': settings_obj,
        'distance_meters': distance,
    }


def validate_checkout_gps_and_photo(data, files):
    settings_obj = SalaryBookSettings.get_solo()
    lat, lng, accuracy = parse_gps(data, prefix='check_out_')
    assert_accuracy_acceptable(accuracy, settings_obj)
    assert_location_fresh(data.get('check_out_captured_at') or data.get('location_captured_at'))
    assert_inside_geofence(lat, lng, settings_obj, for_status=Attendance.STATUS_PRESENT)
    photo = None
    if files is not None:
        photo = files.get('check_out_photo') or files.get('photo')
    if settings_obj.require_checkout_gps_photo and not photo:
        raise ValidationError({
            'check_out_photo': 'A selfie is required to check out.'
        })
    return lat, lng, accuracy, photo
