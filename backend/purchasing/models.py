from django.db import models
from decimal import Decimal
from backend.catalog.models import Product, ProductVariant
from backend.parties.models import Supplier
from backend.locations.models import Store, Warehouse
from backend.core.models import User


class Purchase(models.Model):
    """Purchase/Bill from supplier"""
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('finalized', 'Finalized'),
        ('cancelled', 'Cancelled'),
    ]
    
    purchase_number = models.CharField(max_length=100, unique=True, blank=True, null=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='purchases')
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


class PurchaseItem(models.Model):
    """Purchase line items"""
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='purchase_items')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, null=True, blank=True, related_name='purchase_items')
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text='Selling price for this item. If null/0, falls back to purchase price for validation.')

    def get_line_total(self):
        """Calculate line total"""
        return self.quantity * self.unit_price

    class Meta:
        db_table = 'purchase_items'
        ordering = ['id']
        indexes = [
            models.Index(fields=['purchase', 'product'], name='idx_puritem_pur_product'),
        ]
