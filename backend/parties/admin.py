from django.contrib import admin
from .models import (
    CustomerGroup, Customer, Supplier, LedgerEntry,
    PersonalCustomer, PersonalLedgerEntry,
    InternalCustomer, InternalLedgerEntry, PaymentReminder
)


@admin.register(CustomerGroup)
class CustomerGroupAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'discount_percentage', 'is_active', 'created_at']
    list_filter = ['retailer', 'is_active', 'created_at']
    search_fields = ['name']
    ordering = ['retailer', 'name']


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'phone', 'email', 'customer_group', 'credit_balance', 'is_active', 'created_at']
    list_filter = ['retailer', 'is_active', 'customer_group', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['retailer', 'name']


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'code', 'phone', 'email', 'is_active', 'created_at']
    list_filter = ['retailer', 'is_active', 'created_at']
    search_fields = ['name', 'code', 'email']
    ordering = ['retailer', 'name']


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'retailer', 'customer', 'entry_type', 'amount', 'description', 'invoice', 'created_by', 'created_at']
    list_filter = ['retailer', 'entry_type', 'created_at', 'created_by']
    search_fields = ['customer__name', 'customer__phone', 'description', 'invoice__invoice_number']
    readonly_fields = ['created_at']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'


@admin.register(PersonalCustomer)
class PersonalCustomerAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'phone', 'email', 'credit_balance', 'is_active', 'created_at']
    list_filter = ['retailer', 'is_active', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['retailer', 'name']


@admin.register(PersonalLedgerEntry)
class PersonalLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'retailer', 'customer', 'entry_type', 'amount', 'description', 'created_by', 'created_at']
    list_filter = ['retailer', 'entry_type', 'created_at', 'created_by']
    search_fields = ['customer__name', 'customer__phone', 'description']
    readonly_fields = ['created_at']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'


@admin.register(InternalCustomer)
class InternalCustomerAdmin(admin.ModelAdmin):
    list_display = ['retailer', 'name', 'phone', 'email', 'credit_balance', 'is_active', 'created_at']
    list_filter = ['retailer', 'is_active', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['retailer', 'name']


@admin.register(InternalLedgerEntry)
class InternalLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'retailer', 'customer', 'entry_type', 'amount', 'description', 'created_by', 'created_at']
    list_filter = ['retailer', 'entry_type', 'created_at', 'created_by']
    search_fields = ['customer__name', 'customer__phone', 'description']
    readonly_fields = ['created_at']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'


@admin.register(PaymentReminder)
class PaymentReminderAdmin(admin.ModelAdmin):
    list_display = ['id', 'retailer', 'customer', 'due_date', 'due_amount', 'is_settled', 'settled_payment', 'settled_at', 'created_at']
    list_filter = ['retailer', 'is_settled', 'due_date', 'customer__customer_group', 'created_at']
    search_fields = ['customer__name', 'customer__phone']
    ordering = ['due_date', 'customer__name']
