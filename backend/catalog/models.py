from django.db import models
from decimal import Decimal


class Category(models.Model):
    """Product categories"""
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
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'brands'


class TaxRate(models.Model):
    """Tax rates"""
    name = models.CharField(max_length=100)
    rate = models.DecimalField(max_digits=5, decimal_places=2)  # e.g., 18.00 for 18%
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.rate}%)"

    class Meta:
        db_table = 'tax_rates'


class Product(models.Model):
    """Product master"""
    PRODUCT_TYPE_CHOICES = [
        ('simple', 'Simple'),
        ('variant', 'Variant Parent'),
        ('composite', 'Composite/Bundle'),
    ]

    name = models.CharField(max_length=200, db_index=True)
    sku = models.CharField(max_length=100, unique=True, blank=True, null=True, db_index=True)
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

    class Meta:
        db_table = 'products'


class ProductVariant(models.Model):
    """Product variants (size, color, etc.)"""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='variants')
    name = models.CharField(max_length=200)  # e.g., "Red - Large"
    sku = models.CharField(max_length=100, unique=True)
    attributes = models.JSONField(default=dict)  # e.g., {"color": "red", "size": "L"}
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.product.name} - {self.name}"


    class Meta:
        db_table = 'product_variants'


class Barcode(models.Model):
    """Barcodes for products/variants - linked to purchases"""
    TAG_CHOICES = [
        ('new', 'NEW (Fresh)'),
        ('sold', 'Sold'),
        ('returned', 'Returned'),
        ('defective', 'Defective'),
        ('unknown', 'Unknown'),
        ('in-cart', 'In Cart'),
    ]
    
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='barcodes', null=True, blank=True)
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='barcodes', null=True, blank=True)
    barcode = models.CharField(max_length=100, unique=True, db_index=True)
    short_code = models.CharField(max_length=50, unique=True, db_index=True, null=True, blank=True, 
                                  help_text='Short barcode identifier without date (e.g., FRAM-0001)')
    is_primary = models.BooleanField(default=False)
    tag = models.CharField(max_length=20, choices=TAG_CHOICES, default='new', db_index=True)
    # Link to purchase - tracks which purchase this barcode came from
    purchase = models.ForeignKey('purchasing.Purchase', on_delete=models.SET_NULL, null=True, blank=True, related_name='barcodes')
    purchase_item = models.ForeignKey('purchasing.PurchaseItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='barcodes')
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
    
    def save(self, *args, **kwargs):
        """Override save to ensure short_code uniqueness before saving"""
        if self.short_code:
            # Check if short_code already exists for another barcode
            existing = Barcode.objects.filter(short_code=self.short_code).exclude(pk=self.pk).first()
            if existing:
                # Generate a unique short_code if collision detected
                if not self.pk:  # Only for new barcodes
                    # If this is a new barcode and short_code collides, generate a new one
                    base_short_code = self.short_code
                    counter = 1
                    max_attempts = 1000
                    while Barcode.objects.filter(short_code=self.short_code).exists():
                        counter += 1
                        if counter > max_attempts:
                            # Fallback: use UUID suffix
                            import uuid
                            unique_suffix = str(uuid.uuid4())[:8]
                            self.short_code = f"{base_short_code}-{unique_suffix}"
                            break
                        self.short_code = f"{base_short_code}-{counter}"
                else:
                    # For existing barcodes, keep the original short_code
                    # The database unique constraint will catch any issues
                    pass
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'barcodes'
        unique_together = [['product', 'variant', 'barcode']]


class ProductComponent(models.Model):
    """Components for composite/bundle products"""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='components')
    component_product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='used_in_bundles')
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal('1.000'))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'product_components'
        unique_together = [['product', 'component_product']]


class BarcodeLabel(models.Model):
    """Cached barcode label images"""
    barcode = models.OneToOneField(Barcode, on_delete=models.CASCADE, related_name='label')
    label_image = models.TextField()  # Base64 encoded image
    generated_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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

    move_out_number = models.CharField(max_length=100, unique=True)
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


class DefectiveProductItem(models.Model):
    """Individual items in a defective product move-out"""
    move_out = models.ForeignKey(DefectiveProductMoveOut, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='defective_move_out_items')
    barcode = models.ForeignKey(Barcode, on_delete=models.SET_NULL, null=True, blank=True, related_name='defective_move_outs')
    purchase_price = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.move_out.move_out_number} - {self.product.name}"

    class Meta:
        db_table = 'defective_product_items'
        unique_together = [['move_out', 'barcode']]  # Each barcode can only be in one move-out
