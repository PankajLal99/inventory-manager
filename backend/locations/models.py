from django.db import models


class Store(models.Model):
    """Retail stores"""
    SHOP_TYPE_CHOICES = [
        ('retail', 'Retail Shop'),
        ('wholesale', 'Wholesale Shop'),
        ('warehouse', 'Warehouse'),
        ('other', 'Other'),
        ('repair', 'Repair Shop')
    ]

    INVOICE_TYPE_CHOICES = [
        ('cash', 'Cash Invoice'),
        ('upi', 'UPI Invoice'),
        ('pending', 'Pending Invoice'),
        ('defective', 'Defective Invoice'),
        ('credit', 'Credit Invoice'),
        ('mixed', 'Mixed Payment (Cash + UPI)'),
        ('card','Card Invoice'),
    ]

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        related_name='stores',
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, db_index=True)
    shop_type = models.CharField(max_length=20, choices=SHOP_TYPE_CHOICES, default='retail')
    default_invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPE_CHOICES, default='cash')
    address = models.TextField(blank=True)
    state = models.CharField(max_length=100, blank=True, help_text='State for GST billing (e.g., Delhi, Maharashtra)')
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    auto_populate_price = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'stores'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'code'], name='uniq_store_retailer_code'),
        ]


class Warehouse(models.Model):
    """Warehouses"""
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        related_name='warehouses',
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, db_index=True)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'warehouses'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'code'], name='uniq_warehouse_retailer_code'),
        ]
