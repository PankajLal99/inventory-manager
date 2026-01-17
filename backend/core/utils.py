"""Utility functions for audit logging"""
from .models import AuditLog
from django.contrib.auth import get_user_model

User = get_user_model()


def get_client_ip(request):
    """Extract client IP address from request"""
    if not request or not hasattr(request, 'META'):
        return None
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip or None


def create_audit_log(request=None, action=None, model_name=None, object_id=None, 
                     changes=None, user=None, object_name=None, object_reference=None, 
                     barcode=None):
    """
    Create an audit log entry
    
    Args:
        request: Django request object (for user and IP) - optional if user is provided
        action: Action type (create, update, delete, cart_add, etc.)
        model_name: Name of the model being acted upon
        object_id: ID of the object (as string)
        changes: Dictionary of changes made
        user: Optional user override (defaults to request.user if request provided)
        object_name: Human-readable name of the object (e.g., product name, invoice number)
        object_reference: Reference identifier (e.g., invoice number, cart number)
        barcode: Barcode/SKU if applicable
    """
    try:
        # Determine user
        audit_user = None
        if user:
            audit_user = user
        elif request and hasattr(request, 'user'):
            audit_user = request.user
        
        # Get IP address
        ip_address = get_client_ip(request) if request else None
        
        # Validate required fields
        if not action or not model_name or not object_id:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Audit log creation skipped: missing required fields (action={action}, model_name={model_name}, object_id={object_id})")
            return None
        
        AuditLog.objects.create(
            user=audit_user if audit_user and audit_user.is_authenticated else None,
            action=action,
            model_name=model_name,
            object_id=str(object_id),
            object_name=object_name,
            object_reference=object_reference,
            barcode=barcode,
            changes=changes or {},
            ip_address=ip_address
        )
    except Exception as e:
        # Don't fail the main operation if audit logging fails
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to create audit log: {str(e)}")
        return None

