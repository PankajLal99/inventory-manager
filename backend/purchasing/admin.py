from django.contrib import admin
from .models import Purchase, PurchaseItem


class PurchaseItemInline(admin.TabularInline):
    model = PurchaseItem
    extra = 1
    fields = ['product', 'quantity', 'unit_price']
    readonly_fields = []


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ['purchase_number', 'supplier', 'purchase_date', 'bill_number', 'get_total', 'created_by', 'created_at']
    list_filter = ['supplier', 'purchase_date', 'created_at']
    search_fields = ['purchase_number', 'bill_number', 'notes']
    ordering = ['-purchase_date', '-created_at']
    inlines = [PurchaseItemInline]
    readonly_fields = ['created_at', 'updated_at']

    def get_total(self, obj):
        return f"₹{obj.get_total():.2f}"
    get_total.short_description = 'Total'
