from django.db import models
from django.db.models import Q
from decimal import Decimal
from backend.core.models import User


class CustomerGroup(models.Model):
    """Customer groups for pricing"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='customer_groups',
    )
    name = models.CharField(max_length=200, db_index=True)
    description = models.TextField(blank=True)
    discount_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'customer_groups'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'name'], name='uniq_custgroup_retailer_name'),
        ]


class Customer(models.Model):
    """Customers"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='customers',
    )
    name = models.CharField(max_length=200, db_index=True)
    phone = models.CharField(max_length=20, blank=True, null=True, db_index=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    state = models.CharField(max_length=100, blank=True, help_text='Customer state for GST bifurcation')
    customer_group = models.ForeignKey(CustomerGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='customers')
    credit_limit = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    credit_balance = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    gst_number = models.CharField(max_length=20, blank=True, null=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'customers'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'name'], name='uniq_customer_retailer_name'),
            models.UniqueConstraint(
                fields=['retailer', 'phone'],
                condition=Q(phone__isnull=False) & ~Q(phone=''),
                name='uniq_customer_retailer_phone_nonnull',
            ),
        ]


class PaymentReminder(models.Model):
    """Payment reminders linked to customers."""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='payment_reminders',
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='payment_reminders',
    )
    due_date = models.DateField()
    due_amount = models.DecimalField(max_digits=10, decimal_places=2)
    is_settled = models.BooleanField(default=False)
    settled_at = models.DateTimeField(null=True, blank=True)
    settled_payment = models.ForeignKey('pos.Payment', on_delete=models.SET_NULL, null=True, blank=True, related_name='settled_payment_reminders')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.customer_id:
            self.retailer = self.customer.retailer
        super().save(*args, **kwargs)

    def __str__(self):
        cname = self.customer.name if self.customer else 'Unknown customer'
        return f"{cname} - {self.due_date} - {self.due_amount}"

    class Meta:
        db_table = 'payment_reminders'
        ordering = ['due_date', 'customer__name']


class Supplier(models.Model):
    """Suppliers"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='suppliers',
    )
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, blank=True, null=True, db_index=True)
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
        constraints = [
            models.UniqueConstraint(
                fields=['retailer', 'code'],
                condition=Q(code__isnull=False) & ~Q(code=''),
                name='uniq_supplier_retailer_code_nonnull',
            ),
        ]


class LedgerEntry(models.Model):
    """Ledger entries for customer accounts"""
    ENTRY_TYPE_CHOICES = [
        ('credit', 'Credit'),
        ('debit', 'Debit'),
    ]
    PAYMENT_MODE_CHOICES = [
        ('cash', 'Cash'),
        ('upi', 'UPI'),
        ('mixed', 'Mixed (Cash + UPI)'),
        ('other', 'Other'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='ledger_entries',
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ledger_entries',
    )
    invoice = models.ForeignKey('pos.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='ledger_entries')
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    payment_mode = models.CharField(max_length=20, choices=PAYMENT_MODE_CHOICES, default='other')
    cash_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    upi_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'), help_text='Total quantity associated with this entry (e.g. sum of invoice items)')
    description = models.TextField(blank=True)
    is_sent = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='ledger_entries')
    created_at = models.DateTimeField(auto_now_add=False, null=True, blank=True)  # Allow custom dates

    def save(self, *args, **kwargs):
        if not self.retailer_id:
            if self.customer_id:
                self.retailer = self.customer.retailer
            elif self.invoice_id:
                self.retailer = self.invoice.retailer
        super().save(*args, **kwargs)

    def __str__(self):
        customer_name = self.customer.name if self.customer else 'Anonymous'
        return f"{customer_name} - {self.entry_type} - {self.amount}"

    class Meta:
        db_table = 'ledger_entries'
        ordering = ['-created_at', '-id']


class PersonalCustomer(models.Model):
    """Personal customers for personal ledger (separate from regular customers)"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='personal_customers',
    )
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

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='personal_ledger_entries',
    )
    customer = models.ForeignKey(
        PersonalCustomer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='personal_ledger_entries',
    )
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='personal_ledger_entries')
    created_at = models.DateTimeField(auto_now_add=False, null=True, blank=True)  # Allow custom dates

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.customer_id:
            self.retailer = self.customer.retailer
        super().save(*args, **kwargs)

    def __str__(self):
        customer_name = self.customer.name if self.customer else 'Anonymous'
        return f"{customer_name} - {self.entry_type} - {self.amount}"

    class Meta:
        db_table = 'personal_ledger_entries'
        ordering = ['-created_at', '-id']


class InternalCustomer(models.Model):
    """Internal customers for internal ledger (separate from regular and personal customers).
    Only customers with customer_group name 'MTSHOP' are shown in Shop Boys Ledger."""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='internal_customers',
    )
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    customer_group = models.ForeignKey(
        CustomerGroup, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='internal_customers'
    )
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
    """Internal ledger entries (without invoice link). Uses Customer (MTSHOP group) only."""
    ENTRY_TYPE_CHOICES = [
        ('credit', 'Credit'),
        ('debit', 'Debit'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='internal_ledger_entries',
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='internal_ledger_entries',
    )
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='internal_ledger_entries')
    created_at = models.DateTimeField(auto_now_add=False, null=True, blank=True)  # Allow custom dates
    # Set when created by backfill from main LedgerEntry; null when created from POS mirroring
    source_ledger_entry_id = models.PositiveIntegerField(null=True, blank=True, unique=True, db_index=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.customer_id:
            self.retailer = self.customer.retailer
        super().save(*args, **kwargs)

    def __str__(self):
        customer_name = self.customer.name if self.customer else 'Anonymous'
        return f"{customer_name} - {self.entry_type} - {self.amount}"

    class Meta:
        db_table = 'internal_ledger_entries'
        ordering = ['-created_at', '-id']
