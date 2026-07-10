from django.contrib import admin

from .models import (
    CreditCart,
    CreditCartItem,
    CreditCustomer,
    CreditInvoice,
    CreditInvoiceItem,
    CreditLedgerEntry,
    CreditPayment,
    CreditProduct,
    CreditReturn,
    CreditReturnItem,
)


@admin.register(CreditCustomer)
class CreditCustomerAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'customer_group', 'balance', 'linked_customer', 'is_active', 'created_at']
    list_filter = ['is_active', 'customer_group', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['name']


@admin.register(CreditProduct)
class CreditProductAdmin(admin.ModelAdmin):
    list_display = ['name', 'sku', 'unit_price', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'sku']
    ordering = ['name']


class CreditCartItemInline(admin.TabularInline):
    model = CreditCartItem
    extra = 0


@admin.register(CreditCart)
class CreditCartAdmin(admin.ModelAdmin):
    list_display = ['cart_number', 'store', 'customer', 'status', 'created_by', 'created_at']
    list_filter = ['status', 'store', 'created_at']
    search_fields = ['cart_number', 'customer__name']
    inlines = [CreditCartItemInline]


class CreditInvoiceItemInline(admin.TabularInline):
    model = CreditInvoiceItem
    extra = 0
    readonly_fields = ['product_name', 'quantity', 'unit_price', 'line_total', 'returned_quantity']


@admin.register(CreditInvoice)
class CreditInvoiceAdmin(admin.ModelAdmin):
    list_display = ['invoice_number', 'store', 'customer', 'status', 'total', 'created_by', 'created_at']
    list_filter = ['status', 'store', 'created_at']
    search_fields = ['invoice_number', 'customer__name', 'customer__phone']
    inlines = [CreditInvoiceItemInline]
    ordering = ['-created_at']


class CreditReturnItemInline(admin.TabularInline):
    model = CreditReturnItem
    extra = 0
    readonly_fields = ['product_name', 'quantity', 'unit_price', 'line_total', 'invoice_item']


@admin.register(CreditReturn)
class CreditReturnAdmin(admin.ModelAdmin):
    list_display = ['return_number', 'store', 'customer', 'status', 'total', 'created_by', 'created_at']
    list_filter = ['status', 'store', 'created_at']
    search_fields = ['return_number', 'customer__name']
    inlines = [CreditReturnItemInline]
    ordering = ['-created_at']


@admin.register(CreditPayment)
class CreditPaymentAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer', 'payment_method', 'amount', 'cash_amount', 'upi_amount', 'paid_at', 'created_by']
    list_filter = ['payment_method', 'paid_at']
    search_fields = ['customer__name', 'notes']
    ordering = ['-paid_at']
    date_hierarchy = 'paid_at'


@admin.register(CreditLedgerEntry)
class CreditLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer', 'entry_type', 'amount', 'invoice', 'credit_return', 'payment', 'created_by', 'created_at']
    list_filter = ['entry_type', 'created_at']
    search_fields = ['customer__name', 'description', 'invoice__invoice_number', 'credit_return__return_number']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'
