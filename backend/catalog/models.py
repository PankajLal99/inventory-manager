from django.db import models
from django.db.models import Q
from decimal import Decimal

from django.utils import timezone

from backend.core.models import SoftDeleteModel, SoftDeleteQuerySet, SoftDeleteManager
from backend.locations.models import Store, Warehouse


class ProductQuerySet(SoftDeleteQuerySet):
    def delete(self):
        count = self.update(deleted_at=timezone.now(), is_active=False)
        return count, {self.model._meta.label: count}


class ProductManager(SoftDeleteManager):
    def get_queryset(self):
        return ProductQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)


class Category(models.Model):
    """Product categories"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='categories',
    )
    name = models.CharField(max_length=200, db_index=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'categories'
        verbose_name_plural = 'categories'


class Brand(models.Model):
    """Product brands"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='brands',
    )
    name = models.CharField(max_length=200, db_index=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'brands'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'name'], name='uniq_brand_retailer_name'),
        ]


class TaxRate(models.Model):
    """Tax rates"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='tax_rates',
    )
    name = models.CharField(max_length=100)
    rate = models.DecimalField(max_digits=5, decimal_places=2)  # e.g., 18.00 for 18%
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.rate}%)"

    class Meta:
        db_table = 'tax_rates'


class Product(SoftDeleteModel):
    """Product master"""
    objects = ProductManager()

    PRODUCT_TYPE_CHOICES = [
        ('simple', 'Simple'),
        ('variant', 'Variant Parent'),
        ('composite', 'Composite/Bundle'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='products',
    )
    name = models.CharField(max_length=200, db_index=True)
    sku = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    product_type = models.CharField(max_length=20, choices=PRODUCT_TYPE_CHOICES, default='simple')
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True, related_name='products')
    brand = models.ForeignKey(Brand, on_delete=models.SET_NULL, null=True, blank=True, related_name='products')
    description = models.TextField(blank=True)
    can_go_below_purchase_price = models.BooleanField(default=False)  # Still needed for POS validation
    tax_rate = models.ForeignKey(TaxRate, on_delete=models.SET_NULL, null=True, blank=True, related_name='products')
    track_inventory = models.BooleanField(default=True)
    track_batches = models.BooleanField(default=False)
    low_stock_threshold = models.IntegerField(default=0)
    image = models.URLField(blank=True)  # or use ImageField with storage
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.sku or 'NO-SKU'})"

    def delete(self, using=None, keep_parents=False, hard: bool = False):
        if hard:
            return super().delete(using=using, keep_parents=keep_parents, hard=True)
        self.is_active = False
        self.deleted_at = timezone.now()
        self.save(update_fields=['is_active', 'deleted_at'])

    class Meta:
        db_table = 'products'
        indexes = [
            models.Index(fields=['-updated_at', '-created_at'], name='idx_product_updated'),
            models.Index(fields=['category', 'is_active'], name='idx_product_category_active'),
            models.Index(fields=['brand', 'is_active'], name='idx_product_brand_active'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['retailer', 'sku'],
                condition=Q(sku__isnull=False) & ~Q(sku=''),
                name='uniq_product_retailer_sku_nonnull',
            ),
        ]


class ProductVariant(models.Model):
    """Product variants (size, color, etc.)"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='variants',
    )
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='variants')
    name = models.CharField(max_length=200)  # e.g., "Red - Large"
    sku = models.CharField(max_length=100, db_index=True)
    attributes = models.JSONField(default=dict)  # e.g., {"color": "red", "size": "L"}
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.product.name} - {self.name}"

    class Meta:
        db_table = 'product_variants'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'sku'], name='uniq_variant_retailer_sku'),
        ]


class Barcode(SoftDeleteModel):
    """Barcodes for products/variants - linked to purchases"""
    TAG_CHOICES = [
        ('new', 'NEW (Fresh)'),
        ('sold', 'Sold'),
        ('returned', 'Returned'),
        ('defective', 'Defective'),
        ('unknown', 'Unknown'),
        ('in-cart', 'In Cart'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='barcodes',
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='barcodes',
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='barcodes',
    )
    barcode = models.CharField(max_length=100, db_index=True)
    short_code = models.CharField(
        max_length=50, db_index=True, null=True, blank=True,
        help_text='Short barcode identifier without date (e.g., FRAM-0001)',
    )
    is_primary = models.BooleanField(default=False)
    tag = models.CharField(max_length=20, choices=TAG_CHOICES, default='new', db_index=True)
    # Link to purchase - tracks which purchase this barcode came from
    purchase = models.ForeignKey('purchasing.Purchase', on_delete=models.SET_NULL, null=True, blank=True, related_name='barcodes')
    purchase_item = models.ForeignKey('purchasing.PurchaseItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='barcodes')
    current_store = models.ForeignKey(
        Store,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='current_barcodes',
    )
    current_warehouse = models.ForeignKey(
        Warehouse,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='current_barcodes',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.barcode

    def generate_short_code(self):
        """Generate short code from barcode by removing the date part
        Format: {base_name}-{timestamp}-{serial_number} -> {base_name}-{serial_number}
        Format: {base_name}-{timestamp}-{serial_number}-{counter} -> {base_name}-{serial_number}-{counter}
        """
        if not self.barcode:
            return None

        parts = self.barcode.split('-')
        if len(parts) >= 3:
            # Standard format: BASE-TIMESTAMP-SERIAL or BASE-TIMESTAMP-SERIAL-COUNTER
            # Remove the timestamp (index 1) and keep the rest
            base_name = parts[0]
            serial_and_rest = parts[2:]  # Everything after timestamp
            short_code = f"{base_name}-{'-'.join(serial_and_rest)}"
            return short_code
        # If format doesn't match, return None (will be handled by backfill)
        return None

    def audit_display_label(self):
        """Short code for audit/history; fall back to derived short form or full barcode."""
        if self.short_code:
            return self.short_code
        derived = self.generate_short_code()
        if derived:
            return derived
        return self.barcode

    def get_purchase_price(self):
        """Get the purchase price for this specific barcode from its purchase_item"""
        if self.purchase_item:
            return self.purchase_item.unit_price
        # If barcode doesn't have purchase_item, it's legacy data or not from a purchase
        return Decimal('0.00')

    def get_selling_price(self):
        """Get the selling price for this specific barcode from its purchase_item.
        Returns None if selling_price is 0 or null, indicating fallback to purchase price."""
        if self.purchase_item and self.purchase_item.selling_price:
            selling_price = self.purchase_item.selling_price
            # Return None if selling_price is 0 (treat as null/empty)
            if selling_price == Decimal('0.00') or selling_price == 0:
                return None
            return selling_price
        return None

    def set_current_location(self, *, store=None, warehouse=None, save=True):
        """Set a barcode's current ownership location."""
        if store is not None and warehouse is not None:
            raise ValueError('Set either store or warehouse, not both.')
        self.current_store = store
        self.current_warehouse = warehouse
        if save:
            self.save(update_fields=['current_store', 'current_warehouse'])

    def save(self, *args, **kwargs):
        """Override save to ensure short_code uniqueness before saving (per retailer)."""
        if self.short_code and self.retailer_id:
            qs = Barcode.all_objects.filter(
                retailer_id=self.retailer_id,
                short_code=self.short_code,
            ).exclude(pk=self.pk)
            if qs.exists():
                if not self.pk:
                    base_short_code = self.short_code
                    counter = 1
                    max_attempts = 1000
                    while Barcode.all_objects.filter(
                        retailer_id=self.retailer_id,
                        short_code=self.short_code,
                    ).exists():
                        counter += 1
                        if counter > max_attempts:
                            import uuid
                            unique_suffix = str(uuid.uuid4())[:8]
                            self.short_code = f"{base_short_code}-{unique_suffix}"
                            break
                        self.short_code = f"{base_short_code}-{counter}"
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'barcodes'
        unique_together = [['product', 'variant', 'barcode']]
        indexes = [
            models.Index(fields=['product', 'tag'], name='idx_barcode_product_tag'),
            models.Index(fields=['tag', 'product'], name='idx_barcode_tag_product'),
            models.Index(fields=['purchase', 'tag'], name='idx_barcode_purchase_tag'),
            models.Index(fields=['retailer', 'current_store', 'tag'], name='idx_barcode_retailer_store_tag'),
            models.Index(fields=['retailer', 'current_warehouse', 'tag'], name='idx_barcode_retailer_wh_tag'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'barcode'], name='uniq_barcode_retailer_barcode'),
            models.UniqueConstraint(
                fields=['retailer', 'short_code'],
                condition=Q(short_code__isnull=False) & ~Q(short_code=''),
                name='uniq_barcode_retailer_short_code_nonnull',
            ),
            models.CheckConstraint(
                check=~(Q(current_store__isnull=False) & Q(current_warehouse__isnull=False)),
                name='barcode_single_current_location',
            ),
        ]


class ProductComponent(models.Model):
    """Components for composite/bundle products"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='product_components',
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='components',
    )
    component_product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='used_in_bundles',
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('1.000'))
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.product_id:
            self.retailer = self.product.retailer
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'product_components'
        unique_together = [['product', 'component_product']]


class BarcodeLabel(models.Model):
    """Cached barcode label images"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='barcode_labels',
    )
    barcode = models.OneToOneField(Barcode, on_delete=models.CASCADE, related_name='label')
    label_image = models.TextField()  # Base64 encoded image
    generated_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.barcode_id:
            self.retailer = self.barcode.retailer
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'barcode_labels'


class DefectiveProductMoveOut(models.Model):
    """Track defective product move-out transactions"""
    REASON_CHOICES = [
        ('damaged', 'Damaged'),
        ('expired', 'Expired'),
        ('defective', 'Defective'),
        ('return_to_supplier', 'Return to Supplier'),
        ('disposal', 'Disposal'),
        ('other', 'Other'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='defective_move_outs',
    )
    move_out_number = models.CharField(max_length=100, db_index=True)
    store = models.ForeignKey('locations.Store', on_delete=models.CASCADE, related_name='defective_move_outs')
    invoice = models.ForeignKey('pos.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='defective_move_outs')
    reason = models.CharField(max_length=50, choices=REASON_CHOICES, default='defective')
    notes = models.TextField(blank=True)
    total_loss = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total_adjustment = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total_items = models.IntegerField(default=0)
    created_by = models.ForeignKey('core.User', on_delete=models.SET_NULL, null=True, related_name='defective_move_outs')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.move_out_number} - {self.store.name if self.store else 'N/A'}"

    class Meta:
        db_table = 'defective_product_move_outs'
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['retailer', 'move_out_number'],
                name='uniq_defective_moveout_retailer_number',
            ),
        ]


class DefectiveProductItem(models.Model):
    """Individual items in a defective product move-out"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='defective_items',
    )
    move_out = models.ForeignKey(DefectiveProductMoveOut, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(
        Product,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='defective_move_out_items',
    )
    barcode = models.ForeignKey(Barcode, on_delete=models.SET_NULL, null=True, blank=True, related_name='defective_move_outs')
    purchase_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.retailer_id and self.move_out_id:
            self.retailer = self.move_out.retailer
        super().save(*args, **kwargs)

    def __str__(self):
        pname = self.product.name if self.product else 'Unknown product'
        return f"{self.move_out.move_out_number} - {pname}"

    class Meta:
        db_table = 'defective_product_items'
        unique_together = [['move_out', 'barcode']]  # Each barcode can only be in one move-out
