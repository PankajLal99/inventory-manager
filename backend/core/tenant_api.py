"""DRF helpers: require an active tenant (retailer) on scoped API routes."""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework import status

from backend.tenants.tenancy import is_platform_user, resolve_request_retailer
from backend.tenants.models import Retailer


def get_active_retailer(request):
    """Return Retailer instance or None."""
    r = getattr(request, 'retailer', None)
    if r is not None:
        return r
    return resolve_request_retailer(request)


def require_active_retailer(request):
    """
    For tenant-scoped endpoints: ensure we have a retailer.
    Platform users must send X-Retailer-Code.
    Returns (retailer, None) or (None, Response).
    """
    r = get_active_retailer(request)
    if r is not None:
        return r, None
    user = getattr(request, 'user', None)
    if user and user.is_authenticated and user.is_superuser:
        return None, None  # Signals "platform" access for superusers

    available_retailers = list(
        Retailer.objects.filter(is_active=True)
        .order_by('name')
        .values('id', 'code', 'name')
    )
    if user and user.is_authenticated and is_platform_user(user):
        return None, Response(
            {
                'detail': 'Platform access requires X-Retailer-Code header for this resource.',
                'available_retailers': available_retailers,
                'action': 'select_retailer',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None, Response(
        {
            'detail': 'User is not assigned to a retailer. Choose an existing retailer code or create a new retailer first.',
            'available_retailers': available_retailers,
            'action': 'select_or_create_retailer',
            'create_hint': 'Use onboarding flow to create a new retailer and initial stores/users.',
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def filter_for_retailer(qs, retailer, field_name='retailer_id'):
    """Filter queryset by tenant when the model has a retailer FK."""
    model = qs.model
    if not hasattr(model, field_name):
        return qs
    # Superuser bypass: if retailer is None (resolved for superuser in require_active_retailer)
    # or if we explicitly want to see everything as a superuser.
    if retailer is None:
        return qs
    return qs.filter(**{field_name: retailer.id})


def assign_retailer_on_save(instance, retailer, field_name='retailer'):
    """Set retailer on a model instance before save if missing."""
    if retailer is None:
        return
    if getattr(instance, f'{field_name}_id', None) is None:
        setattr(instance, f'{field_name}_id', retailer.id)


def get_user_allowed_store_ids(user, retailer):
    """
    Resolve store scope for the current user in a retailer.

    - Admin/staff: all active stores in the retailer.
    - Non-admin: assigned stores if present, else default_store only.
    """
    from backend.locations.models import Store

    if user.is_superuser or user.is_staff:
        return list(Store.objects.filter(retailer_id=retailer.id, is_active=True).values_list('id', flat=True))

    assigned_ids = list(
        user.assigned_stores.filter(retailer_id=retailer.id, is_active=True).values_list('id', flat=True)
    )
    if assigned_ids:
        return assigned_ids
    if getattr(user, 'default_store_id', None):
        return [user.default_store_id]
    if getattr(retailer, 'primary_store_id', None):
        return [retailer.primary_store_id]
    first_store_id = (
        Store.objects.filter(retailer_id=retailer.id, is_active=True).values_list('id', flat=True).first()
    )
    return [first_store_id] if first_store_id else []
