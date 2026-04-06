"""Create a new retailer, primary store, and optional admin user (management / ops)."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.locations.models import Store
from backend.tenants.models import Retailer

User = get_user_model()


class Command(BaseCommand):
    help = 'Onboard a new retailer with a primary store and optional Admin user.'

    def add_arguments(self, parser):
        parser.add_argument('--code', required=True, help='Retailer code, e.g. STR')
        parser.add_argument('--name', required=True, help='Display name')
        parser.add_argument('--store-code', default='', help='Primary store code (default: same as retailer code)')
        parser.add_argument('--store-name', default='', help='Primary store name (default: same as retailer name)')
        parser.add_argument('--admin-username', default='', help='Optional admin username')
        parser.add_argument('--admin-password', default='', help='Optional admin password')
        parser.add_argument('--admin-email', default='', help='Optional admin email')

    def handle(self, *args, **options):
        code = options['code'].strip().upper()
        name = options['name'].strip()
        store_code = (options['store_code'] or code).strip().upper()
        store_name = (options['store_name'] or name).strip()
        au = (options['admin_username'] or '').strip()
        ap = options['admin_password'] or ''
        ae = (options['admin_email'] or '').strip() or None

        if Retailer.objects.filter(code__iexact=code).exists():
            raise CommandError(f'Retailer code {code!r} already exists.')

        with transaction.atomic():
            r = Retailer.objects.create(code=code, name=name, is_active=True)
            if Store.objects.filter(retailer=r, code=store_code).exists():
                raise CommandError(f'Store code {store_code!r} already exists for this retailer.')
            store = Store.objects.create(
                retailer=r,
                name=store_name,
                code=store_code,
                shop_type='retail',
            )
            r.primary_store = store
            r.save(update_fields=['primary_store_id'])
            self.stdout.write(self.style.SUCCESS(f'Retailer {r.code} (id={r.id}), store {store.code} (id={store.id})'))

            if au:
                if not ap:
                    raise CommandError('--admin-password is required when --admin-username is set.')
                if User.objects.filter(username=au).exists():
                    raise CommandError(f'User {au!r} already exists.')
                u = User.objects.create_user(
                    username=au,
                    email=ae or f'{au}@local',
                    password=ap,
                    retailer=r,
                    is_staff=True,
                )
                g, _ = Group.objects.get_or_create(name='Admin')
                u.groups.add(g)
                self.stdout.write(self.style.SUCCESS(f'Admin user {au} (id={u.id})'))
