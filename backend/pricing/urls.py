from django.urls import path
from .views import (
    price_list_list_create, price_list_detail, price_list_items,
    bulk_price_update_preview, bulk_price_update_commit,
    promotion_list_create, promotion_detail, promotion_validate,
    bulk_price_update_log_list, bulk_price_update_log_detail
)

urlpatterns = [
    # PriceList endpoints
    path('price-lists/', price_list_list_create, name='price-list-list-create'),
    path('price-lists/<int:pk>/', price_list_detail, name='price-list-detail'),
    path('price-lists/<int:pk>/items/', price_list_items, name='price-list-items'),
    
    # Promotion endpoints
    path('promotions/', promotion_list_create, name='promotion-list-create'),
    path('promotions/<int:pk>/', promotion_detail, name='promotion-detail'),
    path('promotions/validate/', promotion_validate, name='promotion-validate'),
    
    # BulkPriceUpdate endpoints
    path('pricing/bulk-update/preview/', bulk_price_update_preview, name='bulk-price-update-preview'),
    path('pricing/bulk-update/commit/', bulk_price_update_commit, name='bulk-price-update-commit'),
    
    # BulkPriceUpdateLog endpoints
    path('pricing/change-log/', bulk_price_update_log_list, name='bulk-price-update-log-list'),
    path('pricing/change-log/<int:pk>/', bulk_price_update_log_detail, name='bulk-price-update-log-detail'),
]
