from django.contrib import admin
from .models import PriceList, PriceListItem, BulkPriceUpdateLog, Promotion


class PriceListItemInline(admin.TabularInline):
    model = PriceListItem
    extra = 1


@admin.register(PriceList)
class PriceListAdmin(admin.ModelAdmin):
    list_display = ['name', 'customer_group', 'is_active', 'valid_from', 'valid_to', 'created_at']
    list_filter = ['is_active', 'customer_group', 'valid_from', 'valid_to', 'created_at']
    search_fields = ['name', 'description']
    ordering = ['name']
    inlines = [PriceListItemInline]
    readonly_fields = ['created_at', 'updated_at']


@admin.register(BulkPriceUpdateLog)
class BulkPriceUpdateLogAdmin(admin.ModelAdmin):
    list_display = ['update_type', 'value', 'affected_count', 'created_by', 'created_at']
    list_filter = ['update_type', 'created_at']
    search_fields = ['filters']
    ordering = ['-created_at']
    readonly_fields = ['created_at']


@admin.register(Promotion)
class PromotionAdmin(admin.ModelAdmin):
    list_display = ['name', 'promotion_type', 'discount_type', 'discount_value', 'is_active', 'valid_from', 'valid_to', 'created_at']
    list_filter = ['promotion_type', 'discount_type', 'is_active', 'valid_from', 'valid_to', 'created_at']
    search_fields = ['name']
    ordering = ['-created_at']
    filter_horizontal = ['applicable_products', 'applicable_categories', 'applicable_brands']
    readonly_fields = ['created_at', 'updated_at']
