from django.db import models
from django.db.models import Q
from decimal import Decimal
from backend.catalog.models import Product, ProductVariant
from backend.parties.models import Supplier
from backend.locations.models import Store, Warehouse
from backend.core.models import User, SoftDeleteModel


class Purchase(SoftDeleteModel):
    """Purchase/Bill from supplier"""
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('finalized', 'Finalized'),
        ('cancelled', 'Cancelled'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='purchases',
    )
    purchase_number = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchases',
    )
    purchase_date = models.DateField()
    bill_number = models.CharField(max_length=100, blank=True, null=True)  # Bill/Invoice number from supplier
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    # Location where stock should be added
    store = models.ForeignKey(Store, on_delete=models.SET_NULL, null=True, blank=True, related_name='purchases')
    warehouse = models.ForeignKey(Warehouse, on_delete=models.SET_NULL, null=True, blank=True, related_name='purchases')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='purchases')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.purchase_number or f"Purchase-{self.id}"

    def get_subtotal(self):
        """Calculate subtotal from all items"""
        return sum(item.quantity * item.unit_price for item in self.items.all())

    def get_total(self):
        """Get total purchase amount"""
        return self.get_subtotal()

    class Meta:
        db_table = 'purchases'
        ordering = ['-purchase_date', '-created_at']
        indexes = [
            models.Index(fields=['status'], name='idx_purchase_status'),
            models.Index(fields=['supplier', 'status'], name='idx_purchase_supplier_status'),
            models.Index(fields=['-purchase_date', '-created_at'], name='idx_purchase_date_created'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['retailer', 'purchase_number'],
                condition=Q(purchase_number__isnull=False) & ~Q(purchase_number=''),
                name='uniq_purchase_retailer_number_nonnull',
            ),
        ]


class PurchaseItem(models.Model):
    """Purchase line items"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='purchase_items_explicit',
    )
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_items',
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_items',
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text='Selling price for this item. If null/0, falls back to purchase price for validation.')
    tax_rate = models.ForeignKey(
        'catalog.TaxRate',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='purchase_items',
    )
    gst_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    gst_inclusive = models.BooleanField(default=False)
    # Quantity distribution
    shop_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    warehouse_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    is_printed = models.BooleanField(default=False)
    printed_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.purchase_id:
            self.retailer = self.purchase.retailer
        super().save(*args, **kwargs)


    def get_line_total(self):
        """Calculate line total"""
        return self.quantity * self.unit_price

    class Meta:
        db_table = 'purchase_items'
        ordering = ['id']
        indexes = [
            models.Index(fields=['purchase', 'product'], name='idx_puritem_pur_product'),
        ]


class PurchaseStockMovement(models.Model):
    """Audit log for shop ↔ warehouse quantity changes on a purchase line."""
    DIRECTION_CHOICES = [
        ('warehouse_to_shop', 'Warehouse to shop'),
        ('shop_to_warehouse', 'Shop to warehouse'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='purchase_stock_movements',
    )
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name='stock_movements')
    purchase_item = models.ForeignKey(PurchaseItem, on_delete=models.CASCADE, related_name='stock_movements')
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    direction = models.CharField(max_length=32, choices=DIRECTION_CHOICES)
    shop_quantity_before = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    warehouse_quantity_before = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    shop_quantity_after = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    warehouse_quantity_after = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='purchase_stock_movements')
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.purchase_id:
            self.retailer = self.purchase.retailer
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'purchase_stock_movements'
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['purchase', '-created_at'], name='idx_purstockmov_pur_created'),
        ]
