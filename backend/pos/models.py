from django.db import models
from decimal import Decimal
from backend.catalog.models import Product, ProductVariant
from backend.parties.models import Customer
from backend.locations.models import Store
from backend.pricing.models import Promotion
from backend.core.models import User


class POSSession(models.Model):
    """POS sessions (optional)"""
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('closed', 'Closed'),
    ]

    session_number = models.CharField(max_length=100, unique=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='pos_sessions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='pos_sessions')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    opening_cash = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    closing_cash = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.session_number

    class Meta:
        db_table = 'pos_sessions'


class Cart(models.Model):
    """POS carts"""
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('held', 'Held'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    
    INVOICE_TYPE_CHOICES = [
        ('cash', 'Cash Invoice'),
        ('upi', 'UPI Invoice'),
        ('pending', 'Pending Invoice'),
        ('mixed', 'Mixed Payment (Cash + UPI)'),
    ]

    cart_number = models.CharField(max_length=100, unique=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='carts')
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name='carts')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPE_CHOICES, default='cash')
    session = models.ForeignKey(POSSession, on_delete=models.SET_NULL, null=True, blank=True, related_name='carts')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='carts')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.cart_number

    class Meta:
        db_table = 'carts'


class CartItem(models.Model):
    """Cart items"""
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='cart_items')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='cart_items', null=True, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    manual_unit_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    applied_promotions = models.ManyToManyField(Promotion, related_name='cart_items', blank=True)
    scanned_barcodes = models.JSONField(default=list, blank=True)  # Store list of scanned barcodes/SKUs

    class Meta:
        db_table = 'cart_items'
        ordering = ['id']
        indexes = [
            models.Index(fields=['cart', 'product'], name='idx_cartitem_cart_product'),
        ]


class Invoice(models.Model):
    """Invoices"""
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('paid', 'Paid'),
        ('partial', 'Partially Paid'),
        ('credit', 'Credit'),
        ('void', 'Void'),
    ]
    
    INVOICE_TYPE_CHOICES = [
        ('cash', 'Cash Invoice'),
        ('upi', 'UPI Invoice'),
        ('pending', 'Pending Invoice'),
        ('defective', 'Defective Invoice'),
        ('mixed', 'Mixed Payment (Cash + UPI)'),
    ]

    invoice_number = models.CharField(max_length=100, unique=True)
    cart = models.ForeignKey(Cart, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='invoices')
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPE_CHOICES, default='cash')
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    due_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    applied_promotions = models.ManyToManyField(Promotion, related_name='invoices', blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='invoices')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='voided_invoices')

    def __str__(self):
        return self.invoice_number

    class Meta:
        db_table = 'invoices'


class Repair(models.Model):
    """Repair orders linked to invoices from Repair shops"""
    STATUS_CHOICES = [
        ('received', 'Received'),
        ('work_in_progress', 'Work in Progress'),
        ('done', 'Done'),
        ('delivered', 'Delivered'),
    ]

    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='repair', unique=True)
    contact_no = models.CharField(max_length=20, help_text='Contact number for repair')
    model_name = models.CharField(max_length=200, help_text='Device model name given for repair')
    description = models.TextField(help_text='Description of the repair issue')
    booking_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text='Booking amount for repair')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='received', help_text='Repair status')
    barcode = models.CharField(max_length=100, unique=True, db_index=True, help_text='Barcode for tracking repair')
    label_image = models.TextField(blank=True, null=True, help_text='Label image URL (blob URL or base64 data URL)')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='repairs_updated')

    def __str__(self):
        return f"Repair {self.barcode} - {self.invoice.invoice_number}"

    class Meta:
        db_table = 'repairs'
        ordering = ['-created_at']


class InvoiceItem(models.Model):
    """Invoice items"""
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='invoice_items')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='invoice_items', null=True, blank=True)
    barcode = models.ForeignKey('catalog.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoice_items')
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    manual_unit_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    # Replacement tracking fields
    replaced_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    replaced_at = models.DateTimeField(null=True, blank=True)
    replaced_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='replaced_items')

    class Meta:
        db_table = 'invoice_items'
        indexes = [
            models.Index(fields=['barcode'], name='idx_invitem_barcode'),
            models.Index(fields=['invoice', 'barcode'], name='idx_invitem_inv_barcode'),
            models.Index(fields=['invoice', 'product'], name='idx_invitem_inv_product'),
        ]


class Payment(models.Model):
    """Payments"""
    PAYMENT_METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('card', 'Card'),
        ('upi', 'UPI'),
        ('bank_transfer', 'Bank Transfer'),
        ('credit', 'Credit'),
        ('refund', 'Refund'),
        ('other', 'Other'),
    ]

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='payments')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'payments'


class Return(models.Model):
    """Returns"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('completed', 'Completed'),
    ]

    return_number = models.CharField(max_length=100, unique=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='returns')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    reason = models.TextField()
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='returns')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.return_number

    class Meta:
        db_table = 'returns'


class ReturnItem(models.Model):
    """Return items"""
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='items')
    invoice_item = models.ForeignKey(InvoiceItem, on_delete=models.CASCADE, related_name='return_items')
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    condition = models.CharField(max_length=50)  # e.g., 'saleable', 'damaged', 'expired'
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        db_table = 'return_items'


class CreditNote(models.Model):
    """Credit notes for returns"""
    credit_note_number = models.CharField(max_length=100, unique=True)
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='credit_notes')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='credit_notes')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.credit_note_number

    class Meta:
        db_table = 'credit_notes'


class Exchange(models.Model):
    """Product exchanges"""
    exchange_number = models.CharField(max_length=100, unique=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='exchanges')
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='exchanges', null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='exchanges')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.exchange_number

    class Meta:
        db_table = 'exchanges'
