from django.apps import AppConfig


class TenantsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.tenants'
    label = 'tenants'
    verbose_name = 'Retailers / Tenants'
