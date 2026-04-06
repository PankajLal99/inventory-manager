# AccessPermission, Role, UserStoreRole + seed codenames

import django.db.models.deletion
from django.db import migrations, models


ACCESS_PERMISSION_SEED = [
    ('nav.pos', 'POS', 'core'),
    ('nav.repair_register', 'New repair', 'core'),
    ('nav.search', 'Search', 'core'),
    ('nav.dashboard', 'Dashboard', 'core'),
    ('nav.invoices', 'Invoices', 'sales'),
    ('nav.credit_notes', 'Credit notes', 'sales'),
    ('nav.customers', 'Customers', 'sales'),
    ('nav.replacement', 'Replacement', 'sales'),
    ('nav.repairs', 'Repairs', 'sales'),
    ('nav.products', 'Products', 'inventory'),
    ('nav.stock_overview', 'Stock overview', 'inventory'),
    ('nav.stock_transfers', 'Stock transfers', 'inventory'),
    ('nav.purchases', 'Purchases', 'inventory'),
    ('nav.ledger', 'Ledger', 'financial'),
    ('nav.personal_ledger', 'Personal ledger', 'financial'),
    ('nav.internal_ledger', 'Internal / shop ledger', 'financial'),
    ('nav.payment_reminders', 'Payment reminders', 'financial'),
    ('nav.expenses', 'Expenses', 'financial'),
    ('nav.payments', 'Payments', 'financial'),
    ('nav.active_carts', 'Active carts', 'admin'),
    ('nav.vendors', 'Vendors', 'admin'),
    ('nav.reports', 'Reports', 'admin'),
    ('nav.history', 'History', 'admin'),
]


def seed_permissions(apps, schema_editor):
    AP = apps.get_model('core', 'AccessPermission')
    for codename, label, category in ACCESS_PERMISSION_SEED:
        AP.objects.get_or_create(
            codename=codename,
            defaults={'label': label, 'category': category},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_user_default_store_assigned_stores'),
        ('locations', '0004_multitenant_phase1'),
        ('tenants', '0001_multitenant_phase1'),
    ]

    operations = [
        migrations.CreateModel(
            name='AccessPermission',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('codename', models.CharField(db_index=True, max_length=64, unique=True)),
                ('label', models.CharField(max_length=200)),
                ('category', models.CharField(blank=True, max_length=64)),
            ],
            options={
                'db_table': 'access_permissions',
                'ordering': ['category', 'codename'],
            },
        ),
        migrations.CreateModel(
            name='Role',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('description', models.TextField(blank=True)),
                (
                    'retailer',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='access_roles',
                        to='tenants.retailer',
                    ),
                ),
            ],
            options={
                'db_table': 'access_roles',
                'ordering': ['retailer_id', 'name'],
            },
        ),
        migrations.CreateModel(
            name='UserStoreRole',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'role',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='user_store_assignments',
                        to='core.role',
                    ),
                ),
                (
                    'store',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='user_store_roles',
                        to='locations.store',
                    ),
                ),
                (
                    'user',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='store_roles',
                        to='core.user',
                    ),
                ),
            ],
            options={'db_table': 'user_store_roles'},
        ),
        migrations.AddField(
            model_name='role',
            name='permissions',
            field=models.ManyToManyField(
                blank=True,
                related_name='roles',
                to='core.accesspermission',
            ),
        ),
        migrations.AddConstraint(
            model_name='role',
            constraint=models.UniqueConstraint(fields=('retailer', 'name'), name='uniq_access_role_retailer_name'),
        ),
        migrations.AddConstraint(
            model_name='userstorerole',
            constraint=models.UniqueConstraint(fields=('user', 'store'), name='uniq_user_store_role'),
        ),
        migrations.RunPython(seed_permissions, migrations.RunPython.noop),
    ]
