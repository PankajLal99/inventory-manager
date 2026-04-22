"""
Management command: seed_permissions
Idempotent – safe to run multiple times.

Restores everything that gets wiped on `manage.py flush`:
  1. AccessPermission rows (all nav.* and feature.* codenames)
  2. Django auth Groups with correct Django auth model permissions

Usage:
    python manage.py seed_permissions
"""

from django.apps import apps as django_apps
from django.contrib.auth.management import create_permissions
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand

from backend.core.access import ACCESS_PERMISSION_SEED, FEATURE_PERMISSION_SEED
from backend.core.models import AccessPermission


# ---------------------------------------------------------------------------
# Django Groups and the Django-model-permission profile for each
# ---------------------------------------------------------------------------

# Sentinel used to mean "grant every Permission row in auth_permission".
_ALL = '__all__'

# Sentinel used to mean "every permission EXCLUDING Django-admin write access".
_ALL_EXCEPT_ADMIN_WRITE = '__all_except_admin_write__'

GROUPS_CONFIG = [
    {
        'name': 'Admin',
        'description': 'Full system access including Django admin backend.',
        'django_permissions': _ALL,
    },
    {
        'name': 'PlatformAdmin',
        'description': 'Platform-level admin (superuser equivalent for multi-tenant ops).',
        'django_permissions': _ALL,
    },
    {
        'name': 'RetailAdmin',
        'description': 'Retail shop owner – full access to all app modules, no raw Django admin.',
        'django_permissions': _ALL_EXCEPT_ADMIN_WRITE,
    },
    {
        'name': 'WholesaleAdmin',
        'description': 'Wholesale shop owner – full access to all app modules, no raw Django admin.',
        'django_permissions': _ALL_EXCEPT_ADMIN_WRITE,
    },
    {
        'name': 'Retail',
        'description': 'Retail shop staff – POS billing only.',
        'django_permissions': [],
    },
    {
        'name': 'Wholesale',
        'description': 'Wholesale shop staff – POS billing only.',
        'django_permissions': [],
    },
]


class Command(BaseCommand):
    help = (
        'Idempotent seed: restores AccessPermission rows and Django Groups '
        'after a database flush.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--groups-only',
            action='store_true',
            help='Skip AccessPermission seeding; only create/update Django Groups.',
        )
        parser.add_argument(
            '--permissions-only',
            action='store_true',
            help='Skip Group creation; only seed AccessPermission rows.',
        )

    def handle(self, *args, **options):
        groups_only = options['groups_only']
        permissions_only = options['permissions_only']

        if not permissions_only:
            self._seed_access_permissions()

        if not groups_only:
            self._seed_django_groups()

        self.stdout.write(self.style.SUCCESS('\nDone.'))

    # ------------------------------------------------------------------
    # Step 1 – AccessPermission rows (nav.* and feature.*)
    # ------------------------------------------------------------------

    def _seed_access_permissions(self):
        self.stdout.write(self.style.MIGRATE_HEADING('\n=== AccessPermission rows ==='))

        all_seeds = list(ACCESS_PERMISSION_SEED) + list(FEATURE_PERMISSION_SEED)
        created = updated = 0

        for codename, label, category in all_seeds:
            obj, was_created = AccessPermission.objects.update_or_create(
                codename=codename,
                defaults={'label': label, 'category': category},
            )
            if was_created:
                created += 1
                self.stdout.write(f'  + created  {codename}')
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'  AccessPermissions: {created} created, {updated} already existed.'
            )
        )

    # ------------------------------------------------------------------
    # Step 2 – Django auth Groups
    # ------------------------------------------------------------------

    def _seed_django_groups(self):
        self.stdout.write(self.style.MIGRATE_HEADING('\n=== Django Groups ==='))

        # After `manage.py flush`, auth.Permission rows are wiped.
        # Recreate them from ContentTypes so group assignment works correctly.
        self.stdout.write('  Ensuring auth.Permission rows exist...')
        for app_config in django_apps.get_app_configs():
            create_permissions(app_config, verbosity=0)

        all_permissions = Permission.objects.all()
        non_admin_permissions = Permission.objects.exclude(
            content_type__app_label='admin'
        ).exclude(
            content_type__app_label='auth',
            codename__in=['add_user', 'change_user', 'delete_user'],
        )

        groups_created = groups_updated = 0

        for cfg in GROUPS_CONFIG:
            name = cfg['name']
            existing = Group.objects.filter(name__iexact=name).first()

            if existing:
                group = existing
                if group.name != name:
                    group.name = name
                    group.save(update_fields=['name'])
                groups_updated += 1
                self.stdout.write(f'  ~ exists   {name}')
            else:
                group = Group.objects.create(name=name)
                groups_created += 1
                self.stdout.write(self.style.SUCCESS(f'  + created  {name}'))

            django_perms = cfg['django_permissions']
            if django_perms is _ALL:
                group.permissions.set(all_permissions)
                self.stdout.write(f'             → assigned all {all_permissions.count()} permissions')
            elif django_perms is _ALL_EXCEPT_ADMIN_WRITE:
                group.permissions.set(non_admin_permissions)
                self.stdout.write(f'             → assigned {non_admin_permissions.count()} permissions (excl. admin write)')
            elif isinstance(django_perms, list) and django_perms:
                # Named list of (app_label, codename) tuples – not used in current config
                # but kept for forward compatibility.
                perm_qs = Permission.objects.filter(
                    content_type__app_label__in=[al for al, _ in django_perms],
                    codename__in=[cn for _, cn in django_perms],
                )
                group.permissions.set(perm_qs)
            # else: empty list → leave group permissions empty

        self.stdout.write(
            self.style.SUCCESS(
                f'  Groups: {groups_created} created, {groups_updated} already existed.'
            )
        )
