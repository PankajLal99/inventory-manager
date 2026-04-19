import json

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db import connection
from django.db.models import Q, TextField
from django.db.models.functions import Cast
from django.utils.html import format_html

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
    list_display = [
        'created_at',
        'action',
        'model_name',
        'object_id',
        'object_name',
        'object_reference',
        'barcode',
        'changes_preview',
        'user',
        'ip_address',
    ]
    list_filter = ['action', 'model_name', 'created_at']
    date_hierarchy = 'created_at'
    list_per_page = 50
    show_full_result_count = False
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
    readonly_fields = [
        'user',
        'action',
        'model_name',
        'object_id',
        'object_name',
        'object_reference',
        'barcode',
        'changes_pretty',
        'ip_address',
        'created_at',
    ]

    def get_search_results(self, request, queryset, search_term):
        term = (search_term or '').strip()
        if not term:
            return super().get_search_results(request, queryset, search_term)

        queryset_std, use_distinct = super().get_search_results(request, queryset, term)

        # Match sticker barcode, short_code, or audit label against DB columns
        synonyms = {term}
        if len(term) >= 3:
            from backend.catalog.models import Barcode as CatalogBarcode

            for b in (
                CatalogBarcode.all_objects.filter(
                    Q(barcode__iexact=term) | Q(short_code__iexact=term)
                )
                .only('barcode', 'short_code')[:40]
            ):
                if b.barcode:
                    synonyms.add(b.barcode)
                if b.short_code:
                    synonyms.add(b.short_code)
                synonyms.add(b.audit_display_label())

        synonyms = {s for s in synonyms if s}
        q_syn = Q()
        for s in synonyms:
            q_syn |= Q(barcode__icontains=s)
            q_syn |= Q(object_reference__icontains=s)
            q_syn |= Q(object_name__icontains=s)

        qs_syn = queryset.filter(q_syn) if q_syn else queryset.none()

        if connection.vendor != 'postgresql':
            combined = (queryset_std | qs_syn).distinct()
            return combined, True

        qs_json = queryset.annotate(_changes_text=Cast('changes', TextField()))
        q_json = Q()
        for s in synonyms:
            q_json |= Q(_changes_text__icontains=s)
        qs_json = qs_json.filter(q_json) if q_json else queryset.none()

        combined = (queryset_std | qs_syn | qs_json).distinct()
        return combined, True

    @admin.display(description='Changes')
    def changes_preview(self, obj):
        raw = json.dumps(obj.changes or {}, ensure_ascii=False)
        if len(raw) > 160:
            raw = raw[:157] + '...'
        return raw

    @admin.display(description='Changes (JSON)')
    def changes_pretty(self, obj):
        text = json.dumps(obj.changes or {}, indent=2, ensure_ascii=False)
        return format_html('<pre style="max-height:480px;overflow:auto;">{}</pre>', text)
