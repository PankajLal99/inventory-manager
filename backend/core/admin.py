import json

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.db import connection
from django.db.models import Q, TextField
from django.db.models.functions import Cast
from django.utils.html import format_html

from backend.locations.models import Store

from .models import AccessPermission, AuditLog, RetailerDashboardViewConfig, Role, Setting, User, UserStoreRole


class UserStoreRoleInline(admin.TabularInline):
    model = UserStoreRole
    fk_name = 'user'
    extra = 0
    autocomplete_fields = ['store', 'role']

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        obj = getattr(request, "_obj_", None)
        rid = getattr(obj, 'retailer_id', None) if obj else None
        if rid and db_field.name == 'role':
            kwargs['queryset'] = Role.objects.filter(retailer_id=rid)
        if rid and db_field.name == 'store':
            kwargs['queryset'] = Store.objects.filter(retailer_id=rid)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    inlines = (UserStoreRoleInline,)
    list_display = [
        'username',
        'email',
        'first_name',
        'last_name',
        'retailer',
        'default_store',
        'is_active',
        'is_staff',
        'date_joined',
    ]
    list_filter = ['is_active', 'is_staff', 'is_superuser', 'retailer', 'date_joined']
    search_fields = ['username', 'email', 'first_name', 'last_name']
    ordering = ['username']
    filter_horizontal = ('assigned_stores',)
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Tenant & locations', {'fields': ('retailer', 'default_store', 'assigned_stores')}),
        ('Additional Info', {'fields': ('phone',)}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('Tenant & locations', {'fields': ('retailer', 'default_store')}),
        ('Additional Info', {'fields': ('phone',)}),
    )

    def get_form(self, request, obj=None, **kwargs):
        # Pass parent object to inlines via request for queryset scoping.
        request._obj_ = obj
        return super().get_form(request, obj, **kwargs)


@admin.register(AccessPermission)
class AccessPermissionAdmin(admin.ModelAdmin):
    list_display = ['codename', 'label', 'category', 'description']
    search_fields = ['codename', 'label', 'description']
    list_filter = ['category']
    ordering = ['category', 'codename']


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'retailer', 'permission_count']
    list_filter = ['retailer']
    search_fields = ['name', 'description']
    autocomplete_fields = ['retailer']
    filter_horizontal = ['permissions']

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(_permission_count=Count('permissions', distinct=True))

    def permission_count(self, obj):
        n = getattr(obj, '_permission_count', None)
        if n is not None:
            return n
        return obj.permissions.count() if obj.pk else 0

    permission_count.short_description = 'Permissions'


@admin.register(UserStoreRole)
class UserStoreRoleAdmin(admin.ModelAdmin):
    list_display = ['user', 'store', 'role']
    list_filter = ['role__retailer']
    search_fields = ['user__username', 'store__name', 'role__name']
    autocomplete_fields = ['user', 'store', 'role']


@admin.register(Setting)
class SettingAdmin(admin.ModelAdmin):
    list_display = ['key', 'value', 'updated_at']
    search_fields = ['key', 'description']
    ordering = ['key']
    readonly_fields = ['updated_at']


@admin.register(RetailerDashboardViewConfig)
class RetailerDashboardViewConfigAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'updated_at']
    search_fields = ['retailer__code', 'retailer__name']
    autocomplete_fields = ['retailer']
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
