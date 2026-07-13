from decimal import Decimal

from django.db import models
from django.utils import timezone

from backend.catalog.models import Product
from backend.core.models import User
from backend.locations.models import Store
from backend.parties.models import Customer, CustomerGroup


class CreditCustomer(models.Model):
    """Customers used only by the credit POS / ledger (may link to parties.Customer)."""
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, null=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    linked_customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_customers',
    )
    customer_group = models.ForeignKey(
        CustomerGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_customers',
    )
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'credit_customers'
        ordering = ['name']
        indexes = [
            models.Index(fields=['name'], name='idx_cred_cust_name'),
            models.Index(fields=['phone'], name='idx_cred_cust_phone'),
        ]


class CreditProduct(models.Model):
    """Ad-hoc / temporary products created only in credit POS."""
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100, blank=True, null=True)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'credit_products'
        ordering = ['name']
        indexes = [
            models.Index(fields=['name'], name='idx_cred_prod_name'),
        ]


class CreditCart(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]

    cart_number = models.CharField(max_length=100, unique=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='credit_carts')
    customer = models.ForeignKey(
        CreditCustomer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='carts',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    locked = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='credit_carts')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.cart_number

    class Meta:
        db_table = 'credit_carts'
        ordering = ['-created_at']


class CreditCartItem(models.Model):
    cart = models.ForeignKey(CreditCart, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_cart_items',
    )
    credit_product = models.ForeignKey(
        CreditProduct,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cart_items',
    )
    product_name = models.CharField(max_length=255, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('1.000'))
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'credit_cart_items'
        ordering = ['id']


class CreditInvoice(models.Model):
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('void', 'Void'),
    ]

    invoice_number = models.CharField(max_length=100, unique=True)
    cart = models.ForeignKey(
        CreditCart,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
    )
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='credit_invoices')
    customer = models.ForeignKey(
        CreditCustomer,
        on_delete=models.PROTECT,
        related_name='invoices',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='credit_invoices')
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='voided_credit_invoices',
    )

    def __str__(self):
        return self.invoice_number

    class Meta:
        db_table = 'credit_invoices'
        ordering = ['-id']
        indexes = [
            models.Index(fields=['-created_at'], name='idx_cred_inv_created'),
            models.Index(fields=['status'], name='idx_cred_inv_status'),
        ]


class CreditInvoiceItem(models.Model):
    invoice = models.ForeignKey(CreditInvoice, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_invoice_items',
    )
    credit_product = models.ForeignKey(
        CreditProduct,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoice_items',
    )
    product_name = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)
    returned_quantity = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        default=Decimal('0.000'),
        help_text='Qty already returned against this sale line',
    )

    @property
    def returnable_quantity(self):
        remaining = self.quantity - (self.returned_quantity or Decimal('0'))
        return remaining if remaining > 0 else Decimal('0')

    class Meta:
        db_table = 'credit_invoice_items'
        ordering = ['id']


class CreditReturn(models.Model):
    """Credit POS return — reduces customer debt against prior credit invoice lines."""
    STATUS_CHOICES = [
        ('completed', 'Completed'),
        ('void', 'Void'),
    ]

    return_number = models.CharField(max_length=100, unique=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='credit_returns')
    customer = models.ForeignKey(
        CreditCustomer,
        on_delete=models.PROTECT,
        related_name='returns',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='completed')
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='credit_returns')
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.return_number

    class Meta:
        db_table = 'credit_returns'
        ordering = ['-created_at']


class CreditReturnItem(models.Model):
    credit_return = models.ForeignKey(CreditReturn, on_delete=models.CASCADE, related_name='items')
    invoice_item = models.ForeignKey(
        CreditInvoiceItem,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='return_items',
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_return_items',
    )
    credit_product = models.ForeignKey(
        CreditProduct,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='return_items',
    )
    product_name = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        db_table = 'credit_return_items'
        ordering = ['id']


class CreditPayment(models.Model):
    """
    Payments recorded against credit customers / ledger only.
    Unrelated to pos.Payment — cash / UPI / mixed receipts that reduce credit balance.
    """
    PAYMENT_METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('upi', 'UPI'),
        ('mixed', 'Cash + UPI'),
    ]

    customer = models.ForeignKey(
        CreditCustomer,
        on_delete=models.PROTECT,
        related_name='payments',
    )
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    cash_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    upi_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    paid_at = models.DateTimeField(default=timezone.now, help_text='Payment date/time')
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_payments',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.payment_method} {self.amount} - {self.customer}'

    class Meta:
        db_table = 'credit_payments'
        ordering = ['-paid_at']
        indexes = [
            models.Index(fields=['customer', '-paid_at'], name='idx_cred_pay_cust'),
        ]


class CreditLedgerEntry(models.Model):
    ENTRY_TYPE_CHOICES = [
        ('debit', 'Debit'),
        ('credit', 'Credit'),  # Void reversals, returns, and payments
    ]

    customer = models.ForeignKey(
        CreditCustomer,
        on_delete=models.CASCADE,
        related_name='ledger_entries',
    )
    invoice = models.ForeignKey(
        CreditInvoice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ledger_entries',
    )
    credit_return = models.ForeignKey(
        'CreditReturn',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ledger_entries',
    )
    payment = models.ForeignKey(
        'CreditPayment',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ledger_entries',
    )
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_ledger_entries',
    )
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f'{self.entry_type} {self.amount} - {self.customer}'

    class Meta:
        db_table = 'credit_ledger_entries'
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['customer', '-created_at'], name='idx_cred_led_cust'),
        ]
