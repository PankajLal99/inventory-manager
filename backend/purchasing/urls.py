from django.urls import path
from .views import (
    purchase_list_create, purchase_detail, purchase_items,
    vendor_purchases, vendor_purchase_detail, vendor_purchase_cancel,
    purchase_finalize
)

urlpatterns = [
    # Purchase endpoints (authenticated)
    path('purchases/', purchase_list_create, name='purchase-list-create'),
    path('purchases/<int:pk>/', purchase_detail, name='purchase-detail'),
    path('purchases/<int:pk>/items/', purchase_items, name='purchase-items'),
    path('purchases/<int:pk>/finalize/', purchase_finalize, name='purchase-finalize'),
    
    # Vendor endpoints (public, no auth required)
    path('vendor-purchases/', vendor_purchases, name='vendor-purchase-list-create'),
    path('vendor-purchases/<int:pk>/', vendor_purchase_detail, name='vendor-purchase-detail'),
    path('vendor-purchases/<int:pk>/cancel/', vendor_purchase_cancel, name='vendor-purchase-cancel'),
]
