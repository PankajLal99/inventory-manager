"""JWT auth that sets request.retailer after the user is resolved (DRF runs after TenantMiddleware)."""

from rest_framework_simplejwt.authentication import JWTAuthentication

from backend.tenants.tenancy import resolve_request_retailer


class JWTAuthenticationWithTenant(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            user, validated_token = result
            request.user = user
            request.retailer = resolve_request_retailer(request)
        return result
