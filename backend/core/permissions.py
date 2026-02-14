"""
Custom permission classes for the inventory manager.
"""
from rest_framework.permissions import BasePermission, IsAuthenticated

try:
    from backend.purchasing.models import Purchase
except ImportError:
    Purchase = None


class IsAuthenticatedOrVendorPurchaseLabels(BasePermission):
    """
    Allow access if:
    1. User is authenticated, OR
    2. Request is from vendor-purchases context: unauthenticated with supplier + purchase_id
       and the product (pk from URL) is in that purchase for that supplier.

    Used for product label endpoints (labels-status, labels, generate-labels) so that
    vendors can print labels when accessing /vendor-purchases/:id?supplier=X without logging in.
    """

    def has_permission(self, request, view):
        if request.user and request.user.is_authenticated:
            return True

        # Must have supplier for vendor access
        supplier_id = request.query_params.get('supplier')
        if not supplier_id:
            return False

        # purchase_id can come from query params (GET) or body (POST)
        purchase_id = request.query_params.get('purchase_id')
        if not purchase_id and request.data:
            purchase_id = request.data.get('purchase_id')
        if not purchase_id:
            return False

        # Get product pk from URL (view.kwargs or resolver_match)
        product_pk = None
        if hasattr(view, 'kwargs') and view.kwargs:
            product_pk = view.kwargs.get('pk')
        if product_pk is None and hasattr(request, 'resolver_match') and request.resolver_match:
            product_pk = request.resolver_match.kwargs.get('pk')
        if product_pk is None:
            return False

        # Validate: purchase exists, belongs to supplier, and contains this product
        if not Purchase:
            return False
        try:
            purchase_id_int = int(purchase_id)
            product_pk_int = int(product_pk)
        except (ValueError, TypeError):
            return False

        if not Purchase.objects.filter(
            pk=purchase_id_int,
            supplier_id=supplier_id,
            items__product_id=product_pk_int
        ).exists():
            return False

        return True
