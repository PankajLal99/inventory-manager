from django.apps import AppConfig


class CatalogConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.catalog'
    
    def ready(self):
        """Import signals when app is ready"""
        import backend.catalog.barcode_cache  # noqa: F401
