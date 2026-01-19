from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.core'
    
    def ready(self):
        """Import signals when app is ready"""
        import backend.core.model_cache  # noqa: F401
        import backend.core.cache_signals  # noqa: F401  # Cache invalidation signals
