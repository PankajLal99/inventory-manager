"""DRF renderer that applies emergency money masking to outbound JSON."""
from rest_framework.renderers import JSONRenderer

from backend.core.emergency_mask import (
    apply_emergency_mask,
    get_emergency_mask_config,
    should_skip_path,
)


class EmergencyMaskJSONRenderer(JSONRenderer):
    """
    Scales money-like fields in JSON responses when emergency mask is enabled.
    Skips write-critical POS/credit cart paths so recording can use real amounts.
    """

    def render(self, data, accepted_media_type=None, renderer_context=None):
        renderer_context = renderer_context or {}
        request = renderer_context.get('request')
        path = getattr(request, 'path', '') if request is not None else ''

        if data is not None and not should_skip_path(path):
            cfg = get_emergency_mask_config()
            if cfg.get('enabled'):
                data = apply_emergency_mask(data, percent=cfg.get('percent'))

        return super().render(data, accepted_media_type, renderer_context)
