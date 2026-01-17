from django.contrib import admin
from .models import Stock, StockBatch, StockAdjustment, StockTransfer, StockTransferItem


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ['product', 'variant', 'store', 'warehouse', 'quantity', 'reserved_quantity', 'updated_at']
    list_filter = ['store', 'warehouse', 'updated_at']
    search_fields = ['product__name', 'product__sku']
    ordering = ['product', 'store', 'warehouse']


@admin.register(StockBatch)
class StockBatchAdmin(admin.ModelAdmin):
    list_display = ['product', 'variant', 'batch_number', 'expiry_date', 'quantity', 'store', 'warehouse', 'created_at']
    list_filter = ['store', 'warehouse', 'expiry_date', 'created_at']
    search_fields = ['batch_number', 'product__name']
    ordering = ['-created_at']


@admin.register(StockAdjustment)
class StockAdjustmentAdmin(admin.ModelAdmin):
    list_display = ['product', 'variant', 'adjustment_type', 'quantity', 'reason', 'store', 'warehouse', 'created_by', 'created_at']
    list_filter = ['adjustment_type', 'reason', 'store', 'warehouse', 'created_at']
    search_fields = ['product__name', 'notes']
    ordering = ['-created_at']
    readonly_fields = ['created_at']


class StockTransferItemInline(admin.TabularInline):
    model = StockTransferItem
    extra = 1


@admin.register(StockTransfer)
class StockTransferAdmin(admin.ModelAdmin):
    list_display = ['transfer_number', 'from_store', 'from_warehouse', 'to_store', 'to_warehouse', 'status', 'created_by', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['transfer_number', 'notes']
    ordering = ['-created_at']
    inlines = [StockTransferItemInline]
    readonly_fields = ['created_at', 'updated_at']
