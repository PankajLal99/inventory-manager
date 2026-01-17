from django.db import models
from decimal import Decimal
from backend.core.models import User


class CustomerGroup(models.Model):
    """Customer groups for pricing"""
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    discount_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'customer_groups'


class Customer(models.Model):
    """Customers"""
    name = models.CharField(max_length=200, unique=True)
    phone = models.CharField(max_length=20, unique=True, blank=True, null=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    customer_group = models.ForeignKey(CustomerGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='customers')
    credit_limit = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    credit_balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'customers'


class Supplier(models.Model):
    """Suppliers"""
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, unique=True, blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    contact_person = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'suppliers'


class LedgerEntry(models.Model):
    """Ledger entries for customer accounts"""
    ENTRY_TYPE_CHOICES = [
        ('credit', 'Credit'),
        ('debit', 'Debit'),
    ]
    
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='ledger_entries', null=True, blank=True)
    invoice = models.ForeignKey('pos.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='ledger_entries')
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='ledger_entries')
    created_at = models.DateTimeField(auto_now_add=False, null=True, blank=True)  # Allow custom dates
    
    def __str__(self):
        customer_name = self.customer.name if self.customer else 'Anonymous'
        return f"{customer_name} - {self.entry_type} - {self.amount}"
    
    class Meta:
        db_table = 'ledger_entries'
        ordering = ['-created_at']


class PersonalCustomer(models.Model):
    """Personal customers for personal ledger (separate from regular customers)"""
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    credit_balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return self.name
    
    class Meta:
        db_table = 'personal_customers'
        ordering = ['name']


class PersonalLedgerEntry(models.Model):
    """Personal ledger entries (without invoice link)"""
    ENTRY_TYPE_CHOICES = [
        ('credit', 'Credit'),
        ('debit', 'Debit'),
    ]
    
    customer = models.ForeignKey(PersonalCustomer, on_delete=models.CASCADE, related_name='personal_ledger_entries', null=True, blank=True)
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='personal_ledger_entries')
    created_at = models.DateTimeField(auto_now_add=False, null=True, blank=True)  # Allow custom dates
    
    def __str__(self):
        customer_name = self.customer.name if self.customer else 'Anonymous'
        return f"{customer_name} - {self.entry_type} - {self.amount}"
    
    class Meta:
        db_table = 'personal_ledger_entries'
        ordering = ['-created_at']


class InternalCustomer(models.Model):
    """Internal customers for internal ledger (separate from regular and personal customers)"""
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    credit_balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return self.name
    
    class Meta:
        db_table = 'internal_customers'
        ordering = ['name']


class InternalLedgerEntry(models.Model):
    """Internal ledger entries (without invoice link)"""
    ENTRY_TYPE_CHOICES = [
        ('credit', 'Credit'),
        ('debit', 'Debit'),
    ]
    
    customer = models.ForeignKey(InternalCustomer, on_delete=models.CASCADE, related_name='internal_ledger_entries', null=True, blank=True)
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='internal_ledger_entries')
    created_at = models.DateTimeField(auto_now_add=False, null=True, blank=True)  # Allow custom dates
    
    def __str__(self):
        customer_name = self.customer.name if self.customer else 'Anonymous'
        return f"{customer_name} - {self.entry_type} - {self.amount}"
    
    class Meta:
        db_table = 'internal_ledger_entries'
        ordering = ['-created_at']
