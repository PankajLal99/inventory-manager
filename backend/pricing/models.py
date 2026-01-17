from django.db import models
from decimal import Decimal
from backend.catalog.models import Product, ProductVariant
from backend.parties.models import CustomerGroup
from backend.core.models import User


class PriceList(models.Model):
    """Price lists for different customer groups or channels"""
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    customer_group = models.ForeignKey(CustomerGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='price_lists')
    is_active = models.BooleanField(default=True)
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'price_lists'


class PriceListItem(models.Model):
    """Price list items"""
    price_list = models.ForeignKey(PriceList, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='price_list_items')
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name='price_list_items', null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = 'price_list_items'
        unique_together = [['price_list', 'product', 'variant']]


class BulkPriceUpdateLog(models.Model):
    """Log of bulk price updates"""
    UPDATE_TYPE_CHOICES = [
        ('increase_percent', 'Increase by %'),
        ('decrease_percent', 'Decrease by %'),
        ('increase_amount', 'Increase by Amount'),
        ('decrease_amount', 'Decrease by Amount'),
        ('set_price', 'Set Price'),
    ]

    update_type = models.CharField(max_length=20, choices=UPDATE_TYPE_CHOICES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    filters = models.JSONField(default=dict)  # category, brand, supplier filters
    affected_count = models.IntegerField(default=0)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='bulk_price_updates')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'bulk_price_update_logs'


class Promotion(models.Model):
    """Promotions and discounts"""
    PROMOTION_TYPE_CHOICES = [
        ('cart_total', 'Cart Total Discount'),
        ('buy_x_get_y', 'Buy X Get Y'),
        ('category_discount', 'Category Discount'),
        ('brand_discount', 'Brand Discount'),
        ('product_discount', 'Product Discount'),
    ]

    DISCOUNT_TYPE_CHOICES = [
        ('percentage', 'Percentage'),
        ('fixed', 'Fixed Amount'),
    ]

    name = models.CharField(max_length=200)
    promotion_type = models.CharField(max_length=30, choices=PROMOTION_TYPE_CHOICES)
    discount_type = models.CharField(max_length=20, choices=DISCOUNT_TYPE_CHOICES)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2)
    conditions = models.JSONField(default=dict)  # e.g., {"min_cart_total": 1000, "buy_quantity": 2, "get_quantity": 1}
    applicable_products = models.ManyToManyField(Product, related_name='promotions', blank=True)
    applicable_categories = models.ManyToManyField('catalog.Category', related_name='promotions', blank=True)
    applicable_brands = models.ManyToManyField('catalog.Brand', related_name='promotions', blank=True)
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'promotions'
