from django.db import migrations


def add_role_management_permissions(apps, schema_editor):
    AccessPermission = apps.get_model('core', 'AccessPermission')
    rows = [
        ('nav.role_management', 'Role management', 'admin'),
        ('feature.role_management', 'Manage roles and page visibility from app UI', 'feature'),
    ]
    for codename, label, category in rows:
        AccessPermission.objects.update_or_create(
            codename=codename,
            defaults={'label': label, 'category': category},
        )


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0011_merge_20260420_1221'),
    ]

    operations = [
        migrations.RunPython(add_role_management_permissions, migrations.RunPython.noop),
    ]
