from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class SoftDeleteQuerySet(models.QuerySet):
    """Bulk soft-delete: set deleted_at instead of removing rows."""

    def delete(self):
        count = self.update(deleted_at=timezone.now())
        return count, {self.model._meta.label: count}


class SoftDeleteManager(models.Manager):
    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)


class AllObjectsManager(models.Manager):
    """Unfiltered queryset; use for admin, hard purge, or uniqueness checks across all rows."""


class SoftDeleteModel(models.Model):
    """Rows stay in the DB; default manager hides deleted rows."""

    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    objects = SoftDeleteManager()
    all_objects = AllObjectsManager()

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False, hard: bool = False):
        if hard:
            return super().delete(using=using, keep_parents=keep_parents)
        self.deleted_at = timezone.now()
        self.save(update_fields=['deleted_at'])


class User(AbstractUser):
    """Extended user model with additional fields"""
    phone = models.CharField(max_length=20, blank=True, null=True)
    # Temporarily commented out until migrations are run - uncomment after running migrations
    # store = models.ForeignKey('locations.Store', on_delete=models.SET_NULL, null=True, blank=True, related_name='users')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users'


class Setting(models.Model):
    """System settings"""
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField()
    description = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key

    class Meta:
        db_table = 'settings'


class AuditLog(models.Model):
    """Audit log for critical operations"""
    ACTION_CHOICES = [
        ('create', 'Create'),
        ('update', 'Update'),
        ('delete', 'Delete'),
        ('view', 'View'),
        ('stock_adjust', 'Stock Adjustment'),
        ('price_change', 'Price Change'),
        ('invoice_void', 'Invoice Void'),
        ('invoice_create', 'Invoice Created'),
        ('invoice_edit', 'Invoice Edit Started'),
        ('invoice_update', 'Invoice Updated'),
        ('invoice_checkout', 'Invoice Checkout'),
        ('payment_add', 'Payment Added'),
        ('return', 'Return'),
        ('refund', 'Refund'),
        ('cart_add', 'Add to Cart'),
        ('cart_remove', 'Remove from Cart'),
        ('cart_checkout', 'Cart Checkout'),
        ('cart_update', 'Cart Update'),
        ('barcode_scan', 'Barcode Scanned'),
        ('barcode_tag_change', 'Barcode Tag Changed'),
        ('stock_purchase', 'Stock Added (Purchase)'),
        ('stock_sale', 'Stock Removed (Sale)'),
        ('replacement_create', 'Replacement Created'),
        ('replacement_replace', 'Item Replaced'),
        ('replacement_return', 'Item Returned'),
        ('replacement_defective', 'Item Marked Defective'),
        ('replacement_pos_create', 'Replacement POS Created'),
        ('replacement_pos_checkout', 'Replacement POS Checkout'),
    ]

    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='audit_logs')
    action = models.CharField(max_length=50, choices=ACTION_CHOICES)
    model_name = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100)
    object_name = models.CharField(max_length=255, blank=True, null=True, help_text="Human-readable name of the object (e.g., product name, invoice number)")
    object_reference = models.CharField(max_length=255, blank=True, null=True, help_text="Reference identifier (e.g., invoice number, cart number, purchase number)")
    barcode = models.CharField(max_length=1000, blank=True, null=True, help_text="Barcode/SKU if applicable (can contain multiple comma-separated barcodes)")
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'audit_logs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['action']),
            models.Index(fields=['model_name']),
            models.Index(fields=['barcode']),
            models.Index(fields=['object_reference']),
        ]
