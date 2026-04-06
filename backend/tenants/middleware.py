from backend.tenants.tenancy import resolve_request_retailer


class TenantMiddleware:
    """Attach request.retailer for authenticated requests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.retailer = resolve_request_retailer(request)
        return self.get_response(request)
