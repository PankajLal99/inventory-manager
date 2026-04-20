from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.signals import m2m_changed
from django.dispatch import receiver
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
    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='users',
    )
    default_store = models.ForeignKey(
        'locations.Store',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='users_default_store',
        help_text='Preferred shop for POS and stock context when not overridden.',
    )
    assigned_stores = models.ManyToManyField(
        'locations.Store',
        blank=True,
        related_name='assigned_users',
        help_text='If empty, user can access all stores allowed by their groups for this retailer. If set, only these stores (still filtered by group shop types).',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        super().clean()
        rid = self.retailer_id
        if self.default_store_id and rid:
            sid = self.default_store_id
            from backend.locations.models import Store

            store = Store.objects.filter(pk=sid).only('retailer_id').first()
            if store and store.retailer_id != rid:
                raise ValidationError({'default_store': 'Default store must belong to the user\'s retailer.'})

    class Meta:
        db_table = 'users'


@receiver(m2m_changed, sender=User.assigned_stores.through)
def _user_assigned_stores_retailer_check(sender, instance, action, pk_set, **kwargs):
    if action != 'pre_add' or not pk_set:
        return
    rid = getattr(instance, 'retailer_id', None)
    if not rid:
        return
    from backend.locations.models import Store

    if Store.objects.filter(pk__in=pk_set).exclude(retailer_id=rid).exists():
        raise ValidationError('Assigned stores must belong to the user\'s retailer.')


class AccessPermission(models.Model):
    """Granular UI / feature codename (global catalog). Roles attach subsets per retailer."""

    codename = models.CharField(max_length=64, unique=True, db_index=True)
    label = models.CharField(max_length=200)
    category = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)

    class Meta:
        db_table = 'access_permissions'
        ordering = ['category', 'codename']

    def __str__(self):
        return self.codename


class Role(models.Model):
    """Named role per retailer: bundle of AccessPermissions (shop assignments use UserStoreRole)."""

    retailer = models.ForeignKey(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        related_name='access_roles',
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    permissions = models.ManyToManyField(AccessPermission, blank=True, related_name='roles')

    class Meta:
        db_table = 'access_roles'
        constraints = [
            models.UniqueConstraint(fields=['retailer', 'name'], name='uniq_access_role_retailer_name'),
        ]
        ordering = ['retailer_id', 'name']

    def __str__(self):
        return f'{self.retailer_id}:{self.name}'


class UserStoreRole(models.Model):
    """Which role this user has at a specific shop (additive with Django group permissions)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='store_roles')
    store = models.ForeignKey('locations.Store', on_delete=models.CASCADE, related_name='user_store_roles')
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name='user_store_assignments')

    class Meta:
        db_table = 'user_store_roles'
        constraints = [
            models.UniqueConstraint(fields=['user', 'store'], name='uniq_user_store_role'),
        ]

    def clean(self):
        super().clean()
        if not (self.user_id and self.store_id and self.role_id):
            return
        if self.store.retailer_id != self.role.retailer_id:
            raise ValidationError('Store and role must belong to the same retailer.')
        uid = getattr(self.user, 'retailer_id', None)
        if uid and self.store.retailer_id != uid:
            raise ValidationError('Store must belong to the user\'s retailer.')

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


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


class RetailerDashboardViewConfig(models.Model):
    """Per-retailer dashboard block visibility flags for frontend rendering."""

    retailer = models.OneToOneField(
        'tenants.Retailer',
        on_delete=models.CASCADE,
        related_name='dashboard_view_config',
    )
    block_visibility = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'retailer_dashboard_view_configs'

    def __str__(self):
        return f'dashboard-config:{self.retailer_id}'


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
