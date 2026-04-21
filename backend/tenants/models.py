from django.db import models


class Retailer(models.Model):
    """Tenant root: one catalog, parties, and document number space per retailer."""

    code = models.CharField(max_length=50, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    # Per-tenant Azure blob folder for barcode labels (e.g. "mt-labels").
    azure_blob_folder = models.CharField(max_length=120, blank=True, default='')
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

    def _default_blob_folder_from_code(self) -> str:
        code = (self.code or '').strip().lower()
        if not code:
            return ''
        # Keep it deterministic and human readable, e.g. MT -> mt-labels.
        return f'{code}-labels'

    def get_effective_blob_folder(self) -> str:
        folder = (self.azure_blob_folder or '').strip()
        return folder or self._default_blob_folder_from_code()

    def save(self, *args, **kwargs):
        # Auto-populate on create/update when no explicit folder is provided.
        if not (self.azure_blob_folder or '').strip():
            self.azure_blob_folder = self._default_blob_folder_from_code()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} — {self.name}"

    class Meta:
        db_table = 'retailers'
        ordering = ['code']
