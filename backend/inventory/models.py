from django.db import models
from decimal import Decimal
from backend.catalog.models import Product, ProductVariant
from backend.locations.models import Store, Warehouse


class Stock(models.Model):
    """Stock entries per product/variant/location"""
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='stock_entries')
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='stock_entries',
    )
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
        # UniqueConstraint handles nullable fields better than unique_together
        constraints = [
            models.UniqueConstraint(
                fields=['product', 'variant', 'store', 'warehouse'],
                name='unique_stock_product_variant_store_warehouse',
            ),
        ]
        indexes = [
            models.Index(fields=['product', 'store'], name='idx_stock_product_store'),
            models.Index(fields=['product', 'warehouse'], name='idx_stock_product_warehouse'),
            models.Index(fields=['store'], name='idx_stock_store'),
        ]


class StockBatch(models.Model):
    """Batches for products with expiry tracking"""
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='batches')
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='batches',
    )
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
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='adjustments')
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='adjustments',
    )
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

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='stock_transfers',
    )
    transfer_number = models.CharField(max_length=100, db_index=True)
    from_store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='transfers_from', null=True, blank=True)
    from_warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='transfers_from', null=True, blank=True)
    to_store = models.ForeignKey(Store, on_delete=models.CASCADE, related_name='transfers_to', null=True, blank=True)
    to_warehouse = models.ForeignKey(Warehouse, on_delete=models.CASCADE, related_name='transfers_to', null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey('core.User', on_delete=models.SET_NULL, null=True, related_name='stock_transfers')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        from django.core.exceptions import ValidationError

        has_fs = bool(self.from_store_id)
        has_fw = bool(self.from_warehouse_id)
        has_ts = bool(self.to_store_id)
        has_tw = bool(self.to_warehouse_id)

        if has_fs == has_fw:
            raise ValidationError('Specify exactly one source: from_store or from_warehouse.')
        if has_ts == has_tw:
            raise ValidationError('Specify exactly one destination: to_store or to_warehouse.')

        if has_fs and has_ts and self.from_store_id == self.to_store_id:
            raise ValidationError('Source and destination cannot be the same store.')
        if has_fw and has_tw and self.from_warehouse_id == self.to_warehouse_id:
            raise ValidationError('Source and destination cannot be the same warehouse.')

        rid = self.retailer_id
        if rid:
            if has_fs and self.from_store.retailer_id != rid:
                raise ValidationError({'from_store': 'Store does not belong to this retailer.'})
            if has_fw and self.from_warehouse.retailer_id != rid:
                raise ValidationError({'from_warehouse': 'Warehouse does not belong to this retailer.'})
            if has_ts and self.to_store.retailer_id != rid:
                raise ValidationError({'to_store': 'Store does not belong to this retailer.'})
            if has_tw and self.to_warehouse.retailer_id != rid:
                raise ValidationError({'to_warehouse': 'Warehouse does not belong to this retailer.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'stock_transfers'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'transfer_number'], name='uniq_stockxfer_retailer_number'),
        ]


class StockTransferItem(models.Model):
    """Items in a stock transfer"""
    transfer = models.ForeignKey(StockTransfer, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='transfer_items')
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='transfer_items',
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    received_quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('0.000'))

    class Meta:
        db_table = 'stock_transfer_items'
