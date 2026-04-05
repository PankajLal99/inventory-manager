import json

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db import connection
from django.db.models import TextField
from django.db.models.functions import Cast

from .models import User, Setting, AuditLog


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ['username', 'email', 'first_name', 'last_name', 'is_active', 'is_staff', 'date_joined']
    list_filter = ['is_active', 'is_staff', 'is_superuser', 'date_joined']
    search_fields = ['username', 'email', 'first_name', 'last_name']
    ordering = ['username']
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Additional Info', {'fields': ('phone',)}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('Additional Info', {'fields': ('phone',)}),
    )


@admin.register(Setting)
class SettingAdmin(admin.ModelAdmin):
    list_display = ['key', 'value', 'updated_at']
    search_fields = ['key', 'description']
    ordering = ['key']
    readonly_fields = ['updated_at']


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['user', 'action', 'model_name', 'object_id', 'changes', 'ip_address', 'created_at']
    list_filter = ['action', 'model_name', 'created_at']
    search_fields = [
        'user__username',
        'user__email',
        'model_name',
        'object_id',
        'object_name',
        'object_reference',
        'barcode',
        'action',
    ]
    ordering = ['-created_at']
    readonly_fields = ['user', 'action', 'model_name', 'object_id', 'changes', 'ip_address', 'created_at']

    def get_search_results(self, request, queryset, search_term):
        term = (search_term or '').strip()
        if not term:
            return super().get_search_results(request, queryset, search_term)

        queryset_std, use_distinct = super().get_search_results(request, queryset, term)

        if connection.vendor != 'postgresql':
            return queryset_std, use_distinct

        qs_json = queryset.annotate(
            _changes_text=Cast('changes', TextField())
        ).filter(_changes_text__icontains=term)
        combined = (queryset_std | qs_json).distinct()
        return combined, True

    def changes(self, obj):
        return json.dumps(obj.changes, indent=4)
