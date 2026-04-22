from django.db import models
from django.db.models import Q
from django.utils import timezone
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

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='pos_sessions',
    )
    session_number = models.CharField(max_length=100, db_index=True)
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
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'session_number'], name='uniq_possession_retailer_session'),
        ]


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
        ('credit', 'Credit Invoice'),
        ('mixed', 'Mixed Payment (Cash + UPI)'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='carts',
    )
    cart_number = models.CharField(max_length=100, db_index=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='carts')
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name='carts')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPE_CHOICES, default='cash')
    session = models.ForeignKey(POSSession, on_delete=models.SET_NULL, null=True, blank=True, related_name='carts')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='carts')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    locked = models.BooleanField(default=False)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))

    def __str__(self):
        return self.cart_number

    class Meta:
        db_table = 'carts'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'cart_number'], name='uniq_cart_retailer_number'),
        ]


class CartItem(models.Model):
    """Cart items"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='cart_items_explicit',
    )
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cart_items',
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='cart_items',
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    manual_unit_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    applied_promotions = models.ManyToManyField(Promotion, related_name='cart_items', blank=True)
    scanned_barcodes = models.JSONField(default=list, blank=True)  # Store list of scanned barcodes/SKUs
    # For custom/other products: cost entered at POS (item not from a real purchase; we still store it in DB)
    purchase_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.cart_id:
            self.retailer = self.cart.retailer
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'cart_items'
        ordering = ['id']
        indexes = [
            models.Index(fields=['retailer', 'cart', 'product'], name='idx_cartitem_ret_cart_prod'),
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
        ('credit', 'Credit Invoice'),
        ('mixed', 'Mixed Payment (Cash + UPI)'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='invoices',
    )
    invoice_number = models.CharField(max_length=100, db_index=True)
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
    created_at = models.DateTimeField(default=timezone.now)  # Set at creation; POS can pass custom invoice date
    updated_at = models.DateTimeField(auto_now=True)
    # Set once when a draft pending invoice is finalized (checkout to sale/credit or mark credit).
    # Used for wholesale dashboard: pending cleared by month (distinct from invoice created_at).
    pending_cleared_at = models.DateTimeField(null=True, blank=True, db_index=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='voided_invoices')
    is_edited = models.BooleanField(default=False)
    edited_on = models.DateTimeField(null=True, blank=True)
    # POS checkout: returns/trade-ins applied against prior invoices (same customer), netted on this invoice
    trade_in_credit = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    pos_trade_ins = models.JSONField(null=True, blank=True)
    round_off = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'),
        help_text='Rounding adjustment applied to total (positive = rounded up, negative = rounded down)')
    # Replace Product: list of {invoice_item_id, old_product_name, charge_unit_price, ...} for invoice / print UI
    exchange_snapshots = models.JSONField(null=True, blank=True)
    # Replacement POS: return-invoice for already-sold barcodes (separate from Replace Product exchange flow)
    is_replacement_return = models.BooleanField(default=False, db_index=True)
    replacement_mode = models.CharField(max_length=20, blank=True, null=True)
    replacement_customer_warning = models.BooleanField(default=False)
    replacement_source_customers = models.JSONField(default=list, blank=True)

    def __str__(self):
        return self.invoice_number

    class Meta:
        db_table = 'invoices'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'invoice_number'], name='uniq_invoice_retailer_number'),
        ]


class Repair(models.Model):
    """Repair orders linked to invoices from Repair shops"""
    STATUS_CHOICES = [
        ('received', 'Received'),
        ('work_in_progress', 'Work in Progress'),
        ('done', 'Done'),
        ('delivered', 'Delivered'),
        ('not_repaired', 'Not Repaired'),
        ('cancelled', 'Cancelled'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='repairs',
    )
    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='repair', unique=True)
    contact_no = models.CharField(max_length=20, blank=True, help_text='Contact number for repair')
    model_name = models.CharField(max_length=200, help_text='Device model name given for repair')
    description = models.TextField(help_text='Description of the repair issue')
    booking_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text='Booking amount for repair')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='received', help_text='Repair status')
    barcode = models.CharField(max_length=100, db_index=True, help_text='Barcode for tracking repair')
    label_image = models.TextField(blank=True, null=True, help_text='Label image URL (blob URL or base64 data URL)')
    delivery_date = models.DateField(null=True, blank=True, help_text='Expected or actual delivery date')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='repairs_updated')

    def __str__(self):
        return f"Repair {self.barcode} - {self.invoice.invoice_number}"

    @property
    def customer_name(self):
        """Convenience accessor for admin/UI usage."""
        if self.invoice and self.invoice.customer:
            return self.invoice.customer.name
        return ''

    class Meta:
        db_table = 'repairs'
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'barcode'], name='uniq_repair_retailer_barcode'),
        ]


class InvoiceItem(models.Model):
    """Invoice items"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='invoice_items_explicit',
    )
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoice_items',
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoice_items',
    )
    barcode = models.ForeignKey('catalog.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoice_items')
    # Immutable snapshot of Barcode.barcode at sale time so returns/replacements work if FK is cleared or row was recreated.
    sold_barcode_value = models.CharField(max_length=100, blank=True, db_index=True, default='')
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    manual_unit_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    line_total = models.DecimalField(max_digits=10, decimal_places=2)
    # For custom/other products: cost at time of sale (no barcode/purchase); copied from CartItem at checkout
    purchase_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Replacement POS linkage/snapshots so return invoices remain immutable and auditable.
    original_invoice = models.ForeignKey(
        Invoice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replacement_child_items',
    )
    original_invoice_item = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replacement_return_items',
    )
    replacement_return_tag = models.CharField(max_length=20, blank=True, default='')
    accepted_return_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    original_sold_unit_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    original_sold_line_total = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    original_invoice_number = models.CharField(max_length=100, blank=True, default='')
    original_customer_name = models.CharField(max_length=255, blank=True, default='')
    # Replacement tracking fields
    replaced_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    replaced_at = models.DateTimeField(null=True, blank=True)
    replaced_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='replaced_items')
    # Replacement POS line: link to original sale + accepted return terms
    original_invoice = models.ForeignKey(
        'Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='+'
    )
    original_invoice_item = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='+'
    )
    replacement_return_tag = models.CharField(max_length=20, blank=True, null=True)
    accepted_return_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    original_sold_unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    original_sold_line_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    original_invoice_number = models.CharField(max_length=100, blank=True, null=True)
    original_customer_name = models.CharField(max_length=255, blank=True, null=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.invoice_id:
            self.retailer = self.invoice.retailer
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'invoice_items'
        indexes = [
            models.Index(fields=['retailer', 'barcode'], name='idx_invitem_retailer_barcode'),
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

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='payments_explicit',
    )
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reference = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='payments')
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.invoice_id:
            self.retailer = self.invoice.retailer
        super().save(*args, **kwargs)

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

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='returns',
    )
    return_number = models.CharField(max_length=100, db_index=True)
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
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'return_number'], name='uniq_return_retailer_number'),
        ]


class ReturnItem(models.Model):
    """Return items"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='return_items_explicit',
    )
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='items')
    invoice_item = models.ForeignKey(InvoiceItem, on_delete=models.SET_NULL, null=True, blank=True, related_name='return_items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='return_items',
    )
    variant = models.ForeignKey(ProductVariant, on_delete=models.SET_NULL, null=True, blank=True, related_name='return_items')
    barcode = models.ForeignKey('catalog.Barcode', on_delete=models.SET_NULL, null=True, blank=True, related_name='return_items')
    product_name = models.CharField(max_length=255, blank=True)
    product_sku = models.CharField(max_length=100, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    condition = models.CharField(max_length=50)  # e.g., 'saleable', 'damaged', 'expired'
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.return_obj_id:
            self.retailer = self.return_obj.retailer
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'return_items'



class CreditNote(models.Model):
    """Credit notes for returns"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='credit_notes',
    )
    credit_note_number = models.CharField(max_length=100, db_index=True)
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='credit_notes')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='credit_notes')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.credit_note_number

    class Meta:
        db_table = 'credit_notes'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'credit_note_number'], name='uniq_creditnote_retailer_number'),
        ]


class Exchange(models.Model):
    """Product exchanges"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='exchanges',
    )
    exchange_number = models.CharField(max_length=100, db_index=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='exchanges')
    return_obj = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='exchanges', null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='exchanges')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.exchange_number

    class Meta:
        db_table = 'exchanges'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'exchange_number'], name='uniq_exchange_retailer_number'),
        ]


class Expenses(models.Model):
    """
        Expenses -- This model will contain the expense informations for all 
                            entries
    """
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='expenses',
    )
    payment_choices = (('CASH','CASH'),('ONLINE','ONLINE'))
    expense_date = models.DateField(auto_now=False, auto_now_add=False)
    expense_type = models.CharField(max_length=100)
    lender_name = models.CharField(max_length=50,default="Manish Traders")
    borrower_name = models.CharField(max_length=100, blank=True, default="")
    payment_choices_type = models.CharField(max_length=100,choices=payment_choices,default='CASH')
    expense_amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_on = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='expenses')
    last_updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='expenses_updated')
    last_updated_on = models.DateTimeField(auto_now=True)

    class Meta:
         verbose_name = "Expense"