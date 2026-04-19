from django.apps import AppConfig
from django.db.models.signals import post_delete, post_save


class CatalogConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.catalog'
    
    def ready(self):
        """Import signals when app is ready"""
        import backend.catalog.barcode_cache  # noqa: F401

        from backend.catalog import global_search_vocab as gsv
        from backend.catalog.models import Brand, Category

        def _invalidate_global_search_vocab_cache(*args, **kwargs):
            gsv.invalidate_global_search_vocab_cache()

        uid = 'catalog_global_search_vocab_cache'
        post_save.connect(
            _invalidate_global_search_vocab_cache,
            sender=Brand,
            dispatch_uid=f'{uid}_brand_save',
        )
        post_delete.connect(
            _invalidate_global_search_vocab_cache,
            sender=Brand,
            dispatch_uid=f'{uid}_brand_delete',
        )
        post_save.connect(
            _invalidate_global_search_vocab_cache,
            sender=Category,
            dispatch_uid=f'{uid}_category_save',
        )
        post_delete.connect(
            _invalidate_global_search_vocab_cache,
            sender=Category,
            dispatch_uid=f'{uid}_category_delete',
        )
