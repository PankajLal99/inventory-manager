from django.urls import path
from .views import (
    CustomTokenObtainPairView, CustomTokenRefreshView, register, user_me,
    user_list_create, user_detail,
    setting_list_create, setting_detail, document_theme, ledger_export_settings,
    invoice_export_settings, product_name_color_rules,
    audit_log_list, audit_log_detail,
    global_search,
    custom_nav_links_mine, custom_nav_link_list_create, custom_nav_link_detail,
    custom_nav_link_options,
    emergency_mask_status, emergency_mask_activate,
)

urlpatterns = [
    # Auth endpoints
    path('auth/register/', register, name='register'),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', CustomTokenRefreshView.as_view(), name='token_refresh'),
    path('auth/me/', user_me, name='user-me'),
    
    # User endpoints
    path('users/', user_list_create, name='user-list-create'),
    path('users/<int:pk>/', user_detail, name='user-detail'),
    
    # Setting endpoints
    path('settings/', setting_list_create, name='setting-list-create'),
    path('settings/<int:pk>/', setting_detail, name='setting-detail'),
    path('document-theme/', document_theme, name='document-theme'),
    path('ledger-export-settings/', ledger_export_settings, name='ledger-export-settings'),
    path('invoice-export-settings/', invoice_export_settings, name='invoice-export-settings'),
    path('product-name-color-rules/', product_name_color_rules, name='product-name-color-rules'),

    # Emergency display mask (Admin activate only; no HTTP deactivate)
    path('emergency-mask/', emergency_mask_status, name='emergency-mask-status'),
    path('emergency-mask/activate/', emergency_mask_activate, name='emergency-mask-activate'),
    
    # Custom nav links (Admin-managed shortcuts)
    path('custom-nav-links/mine/', custom_nav_links_mine, name='custom-nav-links-mine'),
    path('custom-nav-links/options/', custom_nav_link_options, name='custom-nav-links-options'),
    path('custom-nav-links/', custom_nav_link_list_create, name='custom-nav-links-list-create'),
    path('custom-nav-links/<int:pk>/', custom_nav_link_detail, name='custom-nav-links-detail'),
    
    # AuditLog endpoints
    path('audit-logs/', audit_log_list, name='audit-log-list'),
    path('audit-logs/<int:pk>/', audit_log_detail, name='audit-log-detail'),
    
    # Global search endpoint
    path('search/', global_search, name='global-search'),
]
