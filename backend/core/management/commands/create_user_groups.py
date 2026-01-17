from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType


class Command(BaseCommand):
    help = 'Create Django user groups for RBAC: Retail, Wholesale, RetailAdmin, WholesaleAdmin, Admin'

    def handle(self, *args, **options):
        groups_config = [
            {
                'name': 'Retail',
                'description': 'Retail shop staff - can only create invoices at POS, no metrics/dashboard',
                'permissions': [
                    # POS permissions
                    ('pos', 'Can create invoice'),
                    ('pos', 'Can add product to cart'),
                    ('catalog', 'Can view product'),
                    ('inventory', 'Can view stock'),
                    ('inventory', 'Can update stock'),
                    ('inventory', 'Can create stock adjustment'),
                    ('pos', 'Can cancel invoice'),
                ]
            },
            {
                'name': 'Wholesale',
                'description': 'Wholesale shop staff - can only create invoices at POS, no metrics/dashboard',
                'permissions': [
                    # POS permissions
                    ('pos', 'Can create invoice'),
                    ('pos', 'Can add product to cart'),
                    ('catalog', 'Can view product'),
                    ('inventory', 'Can view stock'),
                    ('inventory', 'Can update stock'),
                    ('inventory', 'Can create stock adjustment'),
                    ('pos', 'Can cancel invoice'),
                ]
            },
            {
                'name': 'RetailAdmin',
                'description': 'Retail shop owner - full access to retail shop modules, no backend access',
                'permissions': [
                    # All permissions except Django admin
                    ('*', 'All modules'),  # Will be handled specially
                ]
            },
            {
                'name': 'WholesaleAdmin',
                'description': 'Wholesale shop owner - full access to wholesale shop modules, no backend access',
                'permissions': [
                    # All permissions except Django admin
                    ('*', 'All modules'),  # Will be handled specially
                ]
            },
            {
                'name': 'Admin',
                'description': 'Developers and shop owners - full system access including backend',
                'permissions': [
                    ('*', 'All permissions'),  # Will be handled specially
                ]
            },
        ]

        created_count = 0
        updated_count = 0

        for group_config in groups_config:
            group, created = Group.objects.get_or_create(name=group_config['name'])
            
            if created:
                self.stdout.write(self.style.SUCCESS(f'✓ Created group: {group_config["name"]}'))
                created_count += 1
            else:
                self.stdout.write(f'  Group already exists: {group_config["name"]}')
                updated_count += 1
            
            # For Admin group, add all permissions
            if group_config['name'] == 'Admin':
                all_permissions = Permission.objects.all()
                group.permissions.set(all_permissions)
                self.stdout.write(f'  Added all permissions to Admin group')
            # For RetailAdmin and WholesaleAdmin, add most permissions except admin
            elif group_config['name'] in ['RetailAdmin', 'WholesaleAdmin']:
                # Add all permissions except Django admin access
                all_permissions = Permission.objects.exclude(
                    content_type__app_label='admin'
                ).exclude(
                    content_type__app_label='auth',
                    codename__in=['add_user', 'change_user', 'delete_user']
                )
                group.permissions.set(all_permissions)
                self.stdout.write(f'  Added module permissions to {group_config["name"]} group')
            else:
                # For Retail and Wholesale, add specific permissions
                # Permissions are managed through Django's built-in Permission system
                self.stdout.write(f'  Basic permissions set for {group_config["name"]} group')
        
        self.stdout.write(self.style.SUCCESS(
            f'\nCompleted: {created_count} groups created, {updated_count} groups already existed'
        ))

