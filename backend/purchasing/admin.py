from django.contrib import admin
from .models import Purchase, PurchaseItem, PurchaseStockMovement


class PurchaseItemInline(admin.TabularInline):
    model = PurchaseItem
    extra = 1
    fields = ['retailer', 'product', 'quantity', 'shop_quantity', 'warehouse_quantity', 'unit_price']
    readonly_fields = []


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = [
        'retailer', 'purchase_number', 'supplier', 'purchase_date', 'bill_number', 'status',
        'get_store', 'get_warehouse', 'get_total', 'created_by', 'created_at',
    ]
    list_filter = ['retailer', 'supplier', 'status', 'purchase_date', 'store', 'warehouse', 'created_at']
    search_fields = ['purchase_number', 'bill_number', 'notes']
    ordering = ['retailer', '-purchase_date', '-created_at']
    inlines = [PurchaseItemInline]
    readonly_fields = ['created_at', 'updated_at']
    autocomplete_fields = ['store', 'warehouse']

    fieldsets = (
        (None, {
            'fields': ('supplier', 'purchase_date', 'bill_number', 'status', 'store', 'warehouse', 'notes', 'created_by'),
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    def get_total(self, obj):
        return f"₹{obj.get_total():.2f}"
    get_total.short_description = 'Total'

    def get_store(self, obj):
        return obj.store.name if obj.store else '—'
    get_store.short_description = 'Store'

    def get_warehouse(self, obj):
        return obj.warehouse.name if obj.warehouse else '—'
    get_warehouse.short_description = 'Warehouse'


@admin.register(PurchaseStockMovement)
class PurchaseStockMovementAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'purchase', 'purchase_item', 'quantity', 'direction', 'created_by', 'created_at']
    list_filter = ['retailer', 'direction', 'created_at']
    search_fields = ['purchase__purchase_number', 'purchase_item__product__name']
    ordering = ['retailer', '-created_at']
