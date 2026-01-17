from django.contrib import admin
from .models import (
    CustomerGroup, Customer, Supplier, LedgerEntry,
    PersonalCustomer, PersonalLedgerEntry,
    InternalCustomer, InternalLedgerEntry
)


@admin.register(CustomerGroup)
class CustomerGroupAdmin(admin.ModelAdmin):
    list_display = ['name', 'discount_percentage', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name']
    ordering = ['name']


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'email', 'customer_group', 'credit_balance', 'is_active', 'created_at']
    list_filter = ['is_active', 'customer_group', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['name']


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ['name', 'code', 'phone', 'email', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'code', 'email']
    ordering = ['name']


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer', 'entry_type', 'amount', 'description', 'invoice', 'created_by', 'created_at']
    list_filter = ['entry_type', 'created_at', 'created_by']
    search_fields = ['customer__name', 'customer__phone', 'description', 'invoice__invoice_number']
    readonly_fields = ['created_at']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'


@admin.register(PersonalCustomer)
class PersonalCustomerAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'email', 'credit_balance', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['name']


@admin.register(PersonalLedgerEntry)
class PersonalLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer', 'entry_type', 'amount', 'description', 'created_by', 'created_at']
    list_filter = ['entry_type', 'created_at', 'created_by']
    search_fields = ['customer__name', 'customer__phone', 'description']
    readonly_fields = ['created_at']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'


@admin.register(InternalCustomer)
class InternalCustomerAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'email', 'credit_balance', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'phone', 'email']
    ordering = ['name']


@admin.register(InternalLedgerEntry)
class InternalLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer', 'entry_type', 'amount', 'description', 'created_by', 'created_at']
    list_filter = ['entry_type', 'created_at', 'created_by']
    search_fields = ['customer__name', 'customer__phone', 'description']
    readonly_fields = ['created_at']
    ordering = ['-created_at']
    date_hierarchy = 'created_at'
