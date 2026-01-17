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
    
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, unique=True)
    shop_type = models.CharField(max_length=20, choices=SHOP_TYPE_CHOICES, default='retail')
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        db_table = 'stores'


class Warehouse(models.Model):
    """Warehouses"""
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=50, unique=True)
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
