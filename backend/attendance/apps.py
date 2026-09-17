from django.apps import AppConfig


class AttendanceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.attendance'
    label = 'attendance'
    verbose_name = 'Hardware Attendance'

    def ready(self):
        # Ensure ModelAdmin classes register even if autodiscover misses the package.
        from backend.attendance import admin as _admin  # noqa: F401
