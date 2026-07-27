from django.apps import AppConfig


class CreditConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.credit'

    def ready(self):
        import backend.credit.signals  # noqa: F401
