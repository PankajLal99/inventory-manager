from django.db import models


class Retailer(models.Model):
    """Tenant root: one catalog, parties, and document number space per retailer."""

    code = models.CharField(max_length=50, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)
    primary_store = models.ForeignKey(
        'locations.Store',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.code} — {self.name}"

    class Meta:
        db_table = 'retailers'
        ordering = ['code']
