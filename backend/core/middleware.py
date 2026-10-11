"""Block API export endpoints while emergency data mask is active."""
import re

from django.http import JsonResponse

# Match real export endpoints only — not settings like ledger-export-settings.
_EXPORT_PATH_RE = re.compile(r'/export(?:/|$|\?)', re.IGNORECASE)


class EmergencyMaskExportBlockMiddleware:
    """
    Refuse dedicated /export API paths when emergency mask is on.
    Client-side PDF/Excel/CSV downloads are blocked separately in the frontend.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ''
        if path.startswith('/api/') and _EXPORT_PATH_RE.search(path):
            from backend.core.emergency_mask import is_emergency_mask_enabled

            if is_emergency_mask_enabled():
                return JsonResponse(
                    {
                        'detail': (
                            'Exports are disabled while emergency data mask is active.'
                        ),
                    },
                    status=403,
                )
        return self.get_response(request)
