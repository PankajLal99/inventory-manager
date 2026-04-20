from django.urls import path
from .views import (
    CustomTokenObtainPairView, CustomTokenRefreshView, register, user_me,
    user_list_create, user_detail,
    access_permission_list, role_list_create, role_detail,
    access_control_users, access_control_user_update,
    onboarding_status, onboarding_complete,
    setting_list_create, setting_detail,
    audit_log_list, audit_log_detail,
    global_search
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
    path('access-permissions/', access_permission_list, name='access-permission-list'),
    path('roles/', role_list_create, name='role-list-create'),
    path('roles/<int:pk>/', role_detail, name='role-detail'),
    path('access-control/users/', access_control_users, name='access-control-users'),
    path('access-control/users/<int:pk>/', access_control_user_update, name='access-control-user-update'),
    path('onboarding/status/', onboarding_status, name='onboarding-status'),
    path('onboarding/complete/', onboarding_complete, name='onboarding-complete'),
    
    # Setting endpoints
    path('settings/', setting_list_create, name='setting-list-create'),
    path('settings/<int:pk>/', setting_detail, name='setting-detail'),
    
    # AuditLog endpoints
    path('audit-logs/', audit_log_list, name='audit-log-list'),
    path('audit-logs/<int:pk>/', audit_log_detail, name='audit-log-detail'),
    
    # Global search endpoint
    path('search/', global_search, name='global-search'),
]
