import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.locations.models import Store
from backend.tenants.models import Retailer
from backend.tenants.tenancy import is_platform_user

logger = logging.getLogger(__name__)
User = get_user_model()


def _platform_denied():
    return Response({'detail': 'Platform admin or superuser only.'}, status=status.HTTP_403_FORBIDDEN)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def platform_retailer_list(request):
    if not is_platform_user(request.user):
        return _platform_denied()
    rows = Retailer.objects.all().order_by('code')
    data = [
        {
            'id': r.id,
            'code': r.code,
            'name': r.name,
            'is_active': r.is_active,
            'primary_store_id': r.primary_store_id,
            'azure_blob_folder': r.get_effective_blob_folder(),
        }
        for r in rows
    ]
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def platform_retailer_create(request):
    if not is_platform_user(request.user):
        return _platform_denied()
    code = (request.data.get('code') or '').strip().upper()
    name = (request.data.get('name') or '').strip()
    store_name = (request.data.get('primary_store_name') or name or code).strip()
    store_code = (request.data.get('primary_store_code') or code).strip().upper()
    azure_blob_folder = (request.data.get('azure_blob_folder') or '').strip()
    if not code or not name:
        return Response({'detail': 'code and name are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if Retailer.objects.filter(code__iexact=code).exists():
        return Response({'detail': 'Retailer code already exists.'}, status=status.HTTP_400_BAD_REQUEST)
    admin_username = (request.data.get('admin_username') or '').strip()
    admin_password = request.data.get('admin_password') or ''
    admin_email = (request.data.get('admin_email') or '').strip() or None
    with transaction.atomic():
        r = Retailer.objects.create(
            code=code,
            name=name,
            is_active=True,
            azure_blob_folder=azure_blob_folder,
        )
        if Store.objects.filter(retailer=r, code=store_code).exists():
            store_code = f'{store_code}-1'
        store = Store.objects.create(
            retailer=r,
            name=store_name or code,
            code=store_code,
            shop_type='retail',
        )
        r.primary_store = store
        r.save(update_fields=['primary_store_id'])
        user_created = None
        if admin_username and admin_password:
            if User.objects.filter(username=admin_username).exists():
                return Response({'detail': 'admin_username already exists.'}, status=status.HTTP_400_BAD_REQUEST)
            from django.contrib.auth.models import Group

            user_created = User.objects.create_user(
                username=admin_username,
                email=admin_email or f'{admin_username}@local',
                password=admin_password,
                retailer=r,
                is_staff=True,
            )
            ag, _ = Group.objects.get_or_create(name='Admin')
            user_created.groups.add(ag)
    out = {
        'retailer': {
            'id': r.id,
            'code': r.code,
            'name': r.name,
            'azure_blob_folder': r.get_effective_blob_folder(),
        },
        'primary_store': {'id': store.id, 'code': store.code, 'name': store.name},
    }
    if user_created:
        out['admin_user_id'] = user_created.id
    return Response(out, status=status.HTTP_201_CREATED)
