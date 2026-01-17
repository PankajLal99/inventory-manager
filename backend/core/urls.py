from django.urls import path
from .views import (
    CustomTokenObtainPairView, CustomTokenRefreshView, register, user_me,
    user_list_create, user_detail,
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
    
    # Setting endpoints
    path('settings/', setting_list_create, name='setting-list-create'),
    path('settings/<int:pk>/', setting_detail, name='setting-detail'),
    
    # AuditLog endpoints
    path('audit-logs/', audit_log_list, name='audit-log-list'),
    path('audit-logs/<int:pk>/', audit_log_detail, name='audit-log-detail'),
    
    # Global search endpoint
    path('search/', global_search, name='global-search'),
]
