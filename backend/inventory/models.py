from django.db import models
from decimal import Decimal
from backend.catalog.models import Product, ProductVariant
from backend.locations.models import Store, Warehouse


class Stock(models.Model):
    """Stock entries per product/variant/location"""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='stock_entries')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='stock_entries', null=True, blank=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='stock_entries', null=True, blank=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='stock_entries', null=True, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    reserved_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        """Validate that at least one location (store or warehouse) is specified"""
        from django.core.exceptions import ValidationError
        if not self.store and not self.warehouse:
            raise ValidationError('Stock entry must have either a store or warehouse')
    
    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'stock'
        # Note: unique_together with nullable fields can have issues
        # We handle uniqueness at application level via get_or_create
        unique_together = [['product', 'variant', 'store', 'warehouse']]
        indexes = [
            models.Index(fields=['product', 'store'], name='idx_stock_product_store'),
            models.Index(fields=['product', 'warehouse'], name='idx_stock_product_warehouse'),
            models.Index(fields=['store'], name='idx_stock_store'),
        ]


class StockBatch(models.Model):
    """Batches for products with expiry tracking"""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='batches')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='batches', null=True, blank=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='batches', null=True, blank=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='batches', null=True, blank=True)
    batch_number = models.CharField(max_length=100)
    expiry_date = models.DateField(null=True, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'stock_batches'
        unique_together = [['product', 'variant', 'store', 'warehouse', 'batch_number']]


class StockAdjustment(models.Model):
    """Stock adjustments (in/out)"""
    ADJUSTMENT_TYPE_CHOICES = [
        ('in', 'Stock In'),
        ('out', 'Stock Out'),
    ]

    REASON_CHOICES = [
        ('damaged', 'Damaged'),
        ('expired', 'Expired'),
        ('found', 'Found'),
        ('theft', 'Theft'),
        ('correction', 'Correction'),
        ('other', 'Other'),
    ]

    adjustment_type = models.CharField(max_length=10, choices=ADJUSTMENT_TYPE_CHOICES)
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='adjustments')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='adjustments', null=True, blank=True)
    store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='adjustments', null=True, blank=True)
    warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='adjustments', null=True, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    reason = models.CharField(max_length=50, choices=REASON_CHOICES)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey('core.User', on_delete=models.SET_NULL, null=True, related_name='stock_adjustments')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'stock_adjustments'


class StockTransfer(models.Model):
    """Stock transfers between locations"""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_transit', 'In Transit'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]

    transfer_number = models.CharField(max_length=100, unique=True)
    from_store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='transfers_from', null=True, blank=True)
    from_warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='transfers_from', null=True, blank=True)
    to_store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='transfers_to', null=True, blank=True)
    to_warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='transfers_to', null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey('core.User', on_delete=models.SET_NULL, null=True, related_name='stock_transfers')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'stock_transfers'


class StockTransferItem(models.Model):
    """Items in a stock transfer"""
    transfer = models.ForeignKey(StockTransfer, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='transfer_items')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='transfer_items', null=True, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    received_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))

    class Meta:
        db_table = 'stock_transfer_items'
