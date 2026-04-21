from django.contrib import admin
from .models import PriceList, PriceListItem, BulkPriceUpdateLog, Promotion


class PriceListItemInline(admin.TabularInline):
    model = PriceListItem
    fields = ['retailer', 'product', 'variant', 'price']
    extra = 1


@admin.register(PriceList)
class PriceListAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'customer_group', 'is_active', 'valid_from', 'valid_to', 'created_at']
    list_filter = ['retailer', 'is_active', 'customer_group', 'valid_from', 'valid_to', 'created_at']
    search_fields = ['name', 'description']
    ordering = ['retailer', 'name']
    inlines = [PriceListItemInline]
    readonly_fields = ['created_at', 'updated_at']


@admin.register(BulkPriceUpdateLog)
class BulkPriceUpdateLogAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'update_type', 'value', 'affected_count', 'created_by', 'created_at']
    list_filter = ['retailer', 'update_type', 'created_at']
    search_fields = ['filters']
    ordering = ['retailer', '-created_at']
    readonly_fields = ['created_at']


@admin.register(Promotion)
class PromotionAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'promotion_type', 'discount_type', 'discount_value', 'is_active', 'valid_from', 'valid_to', 'created_at']
    list_filter = ['retailer', 'promotion_type', 'discount_type', 'is_active', 'valid_from', 'valid_to', 'created_at']
    search_fields = ['name']
    ordering = ['retailer', '-created_at']
    filter_horizontal = ['applicable_products', 'applicable_categories', 'applicable_brands']
    readonly_fields = ['created_at', 'updated_at']
