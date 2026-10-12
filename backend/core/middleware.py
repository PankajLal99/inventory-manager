"""Block API export endpoints and hide sensitive modules while emergency data mask is active."""
import re

from django.http import JsonResponse

# Match real export endpoints only — not settings like ledger-export-settings.
_EXPORT_PATH_RE = re.compile(r'/export(?:/|$|\?)', re.IGNORECASE)


class EmergencyMaskExportBlockMiddleware:
    """
    While emergency mask is on:
    - Refuse dedicated /export API paths
    - Refuse payment-reminders + internal-ledger APIs (hidden from nav too)
    Client-side PDF/Excel/CSV downloads are blocked separately in the frontend.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ''
        if path.startswith('/api/'):
            from backend.core.emergency_mask import (
                is_emergency_hidden_api_path,
                is_emergency_mask_enabled,
            )

            if is_emergency_mask_enabled():
                if is_emergency_hidden_api_path(path):
                    return JsonResponse(
                        {
                            'detail': (
                                'This module is unavailable while emergency data mask is active.'
                            ),
                        },
                        status=403,
                    )
                if _EXPORT_PATH_RE.search(path):
                    return JsonResponse(
                        {
                            'detail': (
                                'Exports are disabled while emergency data mask is active.'
                            ),
                        },
                        status=403,
                    )
        return self.get_response(request)
