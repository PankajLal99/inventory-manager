"""Multi-tenant helpers: resolve retailer per request, platform users, queryset scoping."""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from django.http import HttpRequest

if TYPE_CHECKING:
    from backend.tenants.models import Retailer


PLATFORM_ADMIN_GROUP = 'PlatformAdmin'


def is_platform_user(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False):
        return True
    return user.groups.filter(name=PLATFORM_ADMIN_GROUP).exists()


def resolve_request_retailer(request: HttpRequest):
    """
    Return the active Retailer for this request, or None.
    - Normal users: user.retailer
    - Platform users: X-Retailer-Code header (required for tenant-scoped APIs when user has no retailer)
    """
    from backend.tenants.models import Retailer

    user = getattr(request, 'user', None)
    if not user or not user.is_authenticated:
        return None

    if is_platform_user(user):
        code = (request.headers.get('X-Retailer-Code') or request.META.get('HTTP_X_RETAILER_CODE') or '').strip()
        if code:
            return Retailer.objects.filter(code__iexact=code, is_active=True).first()
        if getattr(user, 'retailer_id', None):
            return user.retailer
        return None

    return getattr(user, 'retailer', None)


def require_retailer(request: HttpRequest):
    """Return retailer or None; callers should return 403 if None for tenant routes."""
    r = getattr(request, 'retailer', None)
    if r is not None:
        return r
    return resolve_request_retailer(request)
