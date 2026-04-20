from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.shortcuts import get_object_or_404
from django.db.models import Q
from django.db import transaction
from django.db.utils import OperationalError, ProgrammingError
from backend.core.tenant_api import require_active_retailer

from backend.catalog.product_name_relevance import order_product_ids_by_name_relevance
from .models import AccessPermission, AuditLog, RetailerDashboardViewConfig, Role, Setting, UserStoreRole
from .serializers import (
    UserSerializer, UserCreateSerializer,
    SettingSerializer, AuditLogSerializer, AccessPermissionSerializer, RoleSerializer
)

User = get_user_model()


def _effective_permissions(user) -> set[str]:
    from backend.core.access import merge_store_role_permissions, permissions_from_django_groups

    groups = list(user.groups.values_list('name', flat=True))
    base = permissions_from_django_groups(groups, user)
    return merge_store_role_permissions(user, base)


def _can_manage_roles(user) -> bool:
    return user.is_superuser or ('feature.role_management' in _effective_permissions(user))


def _default_dashboard_blocks_for_retailer(retailer) -> dict:
    if not retailer:
        return {}
    code = str(getattr(retailer, 'code', '') or '').strip().upper()
    name = str(getattr(retailer, 'name', '') or '').strip().upper()
    # Explicit request: Manish Traders sees full dashboard; others see limited default KPIs.
    if code == 'MANISH_TRADERS' or name == 'MANISH TRADERS':
        return {}
    return {
        'profits': False,
        'manualLedgerPayments': False,
        'overallPendingInvoices': False,
        'wholesalePendingCleared': False,
        'stockAndDefective': False,
        'storeBreakdowns': False,
        'kpi.totalPending': False,
        'kpi.totalCredit': False,
        'kpi.overallProfit': True,
    }


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        # Ensure user is active
        if not self.user.is_active:
            from rest_framework_simplejwt.exceptions import AuthenticationFailed
            raise AuthenticationFailed('User account is disabled.')
        return data
    
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['username'] = user.username
        # Include groups in token
        token['groups'] = list(user.groups.values_list('name', flat=True))
        return token


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    """Custom token refresh serializer that handles deleted users gracefully"""
    def validate(self, attrs):
        try:
            return super().validate(attrs)
        except (InvalidToken, TokenError):
            raise InvalidToken('Token is invalid or expired.')
        except (ObjectDoesNotExist, User.DoesNotExist):
            # User referenced in token doesn't exist anymore
            raise InvalidToken('Token is invalid. User no longer exists.')
        except Exception as e:
            # Check if it's a DoesNotExist exception by checking the message or type name
            error_type_name = str(type(e).__name__)
            error_message = str(e)
            if 'DoesNotExist' in error_type_name or 'matching query does not exist' in error_message:
                raise InvalidToken('Token is invalid. User no longer exists.')
            # Re-raise other exceptions
            raise


class CustomTokenRefreshView(TokenRefreshView):
    """Custom token refresh view that handles deleted users gracefully"""
    serializer_class = CustomTokenRefreshSerializer


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    """User registration endpoint"""
    serializer = UserCreateSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        # Ensure user is active
        user.is_active = True
        user.save()
        # Generate tokens for the new user
        token_serializer = CustomTokenObtainPairSerializer()
        token = token_serializer.get_token(user)
        return Response({
            'user': UserSerializer(user).data,
            'access': str(token.access_token),
            'refresh': str(token),
        }, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


# User views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsAdminUser])
def user_list_create(request):
    """List all users or create a new user"""
    if request.method == 'GET':
        users = User.objects.all()
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)
    else:
        serializer = UserCreateSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsAdminUser])
def user_detail(request, pk):
    """Retrieve, update or delete a user"""
    user = get_object_or_404(User, pk=pk)
    
    if request.method == 'GET':
        serializer = UserSerializer(user)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = UserSerializer(user, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = UserSerializer(user, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_me(request):
    """Get current user with groups and permissions"""
    user = (
        User.objects.select_related('retailer', 'default_store')
        .prefetch_related(
            'assigned_stores',
            'store_roles__role__permissions',
        )
        .get(pk=request.user.pk)
    )
    serializer = UserSerializer(user)
    user_data = serializer.data
    
    # Add Django groups
    user_data['groups'] = list(user.groups.values_list('name', flat=True))

    # Backward compatibility: single `store` mirrors default_store when set
    if user.default_store_id:
        user_data['store'] = {
            'id': user.default_store.id,
            'name': user.default_store.name,
            'shop_type': getattr(user.default_store, 'shop_type', 'retail'),
        }
    
    perms = sorted(_effective_permissions(user))
    user_data['permissions'] = perms
    pset = set(perms)
    user_data['is_admin'] = user.is_superuser or user.is_staff
    user_data['can_access_dashboard'] = 'nav.dashboard' in pset
    user_data['can_access_reports'] = 'nav.reports' in pset
    user_data['can_access_customers'] = 'nav.customers' in pset
    user_data['can_access_ledger'] = 'nav.ledger' in pset
    user_data['can_access_history'] = 'nav.history' in pset
    user_data['dashboard_blocks'] = _default_dashboard_blocks_for_retailer(getattr(user, 'retailer', None))
    if user.retailer_id:
        try:
            cfg = RetailerDashboardViewConfig.objects.filter(retailer_id=user.retailer_id).first()
            if cfg:
                user_data['dashboard_blocks'] = dict(getattr(cfg, 'block_visibility', {}) or {})
        except (ProgrammingError, OperationalError):
            # Keep auth/me backward-compatible on environments missing this table.
            pass
    
    return Response(user_data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def access_permission_list(request):
    if not _can_manage_roles(request.user):
        return Response({'detail': 'You do not have permission to manage roles.'}, status=status.HTTP_403_FORBIDDEN)
    perms = AccessPermission.objects.all().order_by('category', 'codename')
    return Response(AccessPermissionSerializer(perms, many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def role_list_create(request):
    if not _can_manage_roles(request.user):
        return Response({'detail': 'You do not have permission to manage roles.'}, status=status.HTTP_403_FORBIDDEN)

    qs = Role.objects.prefetch_related('permissions')
    if not request.user.is_superuser:
        qs = qs.filter(retailer_id=request.user.retailer_id)

    if request.method == 'GET':
        serializer = RoleSerializer(qs.order_by('name'), many=True)
        return Response(serializer.data)

    payload = dict(request.data)
    if not request.user.is_superuser and request.user.retailer_id:
        payload['retailer'] = request.user.retailer_id
    serializer = RoleSerializer(data=payload, context={'request': request})
    if serializer.is_valid():
        role = serializer.save()
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def role_detail(request, pk):
    if not _can_manage_roles(request.user):
        return Response({'detail': 'You do not have permission to manage roles.'}, status=status.HTTP_403_FORBIDDEN)

    qs = Role.objects.prefetch_related('permissions')
    if not request.user.is_superuser:
        qs = qs.filter(retailer_id=request.user.retailer_id)
    role = get_object_or_404(qs, pk=pk)

    if request.method == 'GET':
        return Response(RoleSerializer(role).data)
    if request.method == 'PATCH':
        payload = dict(request.data)
        if not request.user.is_superuser and request.user.retailer_id:
            payload['retailer'] = request.user.retailer_id
        serializer = RoleSerializer(role, data=payload, partial=True, context={'request': request})
        if serializer.is_valid():
            role = serializer.save()
            return Response(RoleSerializer(role).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    role.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def access_control_users(request):
    if not _can_manage_roles(request.user):
        return Response({'detail': 'You do not have permission to manage access.'}, status=status.HTTP_403_FORBIDDEN)

    qs = User.objects.select_related('default_store').prefetch_related('assigned_stores', 'groups')
    if not request.user.is_superuser:
        qs = qs.filter(retailer_id=request.user.retailer_id)
    data = []
    for user in qs.order_by('username'):
        data.append(
            {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'groups': list(user.groups.values_list('name', flat=True)),
                'default_store_id': user.default_store_id,
                'assigned_store_ids': list(user.assigned_stores.values_list('id', flat=True)),
                'dashboard_only': user.store_roles.filter(role__name='Dashboard Viewer').exists(),
            }
        )
    return Response(data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def access_control_user_update(request, pk):
    if not _can_manage_roles(request.user):
        return Response({'detail': 'You do not have permission to manage access.'}, status=status.HTTP_403_FORBIDDEN)

    target_qs = User.objects.prefetch_related('assigned_stores', 'groups')
    if not request.user.is_superuser:
        target_qs = target_qs.filter(retailer_id=request.user.retailer_id)
    target = get_object_or_404(target_qs, pk=pk)

    assigned_store_ids = request.data.get('assigned_store_ids')
    default_store_id = request.data.get('default_store_id')
    dashboard_only = request.data.get('dashboard_only')
    role_id = request.data.get('role_id')

    from backend.locations.models import Store
    from backend.core.models import UserStoreRole

    with transaction.atomic():
        if assigned_store_ids is not None:
            valid_stores = Store.objects.filter(retailer_id=target.retailer_id, id__in=assigned_store_ids)
            target.assigned_stores.set(valid_stores)
            UserStoreRole.objects.filter(user_id=target.id).exclude(store_id__in=valid_stores.values_list('id', flat=True)).delete()

        if default_store_id is not None:
            if default_store_id == '':
                target.default_store = None
            else:
                ds = Store.objects.filter(retailer_id=target.retailer_id, id=default_store_id).first()
                if not ds:
                    return Response({'detail': 'Invalid default store.'}, status=status.HTTP_400_BAD_REQUEST)
                target.default_store = ds
            target.save(update_fields=['default_store'])

        if role_id is not None:
            if role_id == '':
                UserStoreRole.objects.filter(user_id=target.id).delete()
            else:
                role = Role.objects.filter(id=role_id, retailer_id=target.retailer_id).first()
                if not role:
                    return Response({'detail': 'Invalid role.'}, status=status.HTTP_400_BAD_REQUEST)
                store_ids = list(target.assigned_stores.values_list('id', flat=True))
                for sid in store_ids:
                    UserStoreRole.objects.update_or_create(
                        user_id=target.id,
                        store_id=sid,
                        defaults={'role': role},
                    )

        if dashboard_only is not None:
            if bool(dashboard_only):
                dashboard_perm = AccessPermission.objects.filter(codename='nav.dashboard').first()
                if not dashboard_perm:
                    return Response({'detail': 'Dashboard permission not found.'}, status=status.HTTP_400_BAD_REQUEST)
                dash_role, _ = Role.objects.get_or_create(
                    retailer_id=target.retailer_id,
                    name='Dashboard Viewer',
                    defaults={'description': 'System-managed role: dashboard only'},
                )
                dash_role.permissions.set([dashboard_perm])
                UserStoreRole.objects.filter(user_id=target.id).delete()
                store_ids = list(target.assigned_stores.values_list('id', flat=True))
                if not store_ids and target.default_store_id:
                    store_ids = [target.default_store_id]
                if not store_ids:
                    store_ids = list(Store.objects.filter(retailer_id=target.retailer_id).values_list('id', flat=True))
                for sid in store_ids:
                    UserStoreRole.objects.update_or_create(
                        user_id=target.id,
                        store_id=sid,
                        defaults={'role': dash_role},
                    )
            else:
                UserStoreRole.objects.filter(
                    user_id=target.id,
                    role__retailer_id=target.retailer_id,
                    role__name='Dashboard Viewer',
                ).delete()

    return Response({'detail': 'Access updated successfully.'})


@api_view(['GET'])
@permission_classes([AllowAny])
def onboarding_status(request):
    # Onboarding is intentionally reusable; keep it unlocked.
    from backend.tenants.models import Retailer

    retailers = list(
        Retailer.objects.filter(is_active=True)
        .order_by('name')
        .values('id', 'code', 'name')
    )
    return Response({'completed': False, 'retailers': retailers})


def _normalize_onboarding_mode(request_data):
    mode = str(request_data.get('mode') or '').strip().lower()
    if not mode:
        # Backward compatibility: old payloads were create-only.
        return 'create_retailer'
    if mode not in {'create_retailer', 'extend_retailer'}:
        return None
    return mode


def _resolve_onboarding_retailer(mode, request_data):
    from backend.tenants.models import Retailer

    if mode == 'create_retailer':
        retailer_data = request_data.get('retailer') or {}
        code = str(retailer_data.get('code') or '').strip().upper()
        name = str(retailer_data.get('name') or '').strip()
        if not code or not name:
            return None, Response(
                {'detail': 'Retailer code and name are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Retailer.objects.filter(code__iexact=code).exists():
            return None, Response(
                {'detail': 'Retailer code already exists.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return {'create': True, 'code': code, 'name': name}, None

    existing = request_data.get('existing_retailer') or {}
    retailer_id = existing.get('id')
    retailer_code = str(existing.get('code') or '').strip().upper()
    retailer_name = str(existing.get('name') or '').strip()
    retailer_qs = Retailer.objects.filter(is_active=True)
    retailer = None
    if retailer_id:
        retailer = retailer_qs.filter(id=retailer_id).first()
    elif retailer_code:
        retailer = retailer_qs.filter(code__iexact=retailer_code).first()
    elif retailer_name:
        retailer = retailer_qs.filter(name__iexact=retailer_name).first()

    if not retailer:
        return None, Response(
            {'detail': 'Existing retailer is required for extend mode.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return {'create': False, 'retailer': retailer}, None


def _validate_onboarding_stores(stores_data, mode):
    if not stores_data:
        return None, Response({'detail': 'At least one store is required.'}, status=status.HTTP_400_BAD_REQUEST)

    normalized = []
    seen_codes = set()
    primary_count = 0
    for row in stores_data:
        s_name = str(row.get('name') or '').strip()
        s_code = str(row.get('code') or '').strip().upper()
        shop_type = str(row.get('shop_type') or 'retail').strip().lower()
        if not s_name or not s_code:
            return None, Response({'detail': 'Each store needs name and code.'}, status=status.HTTP_400_BAD_REQUEST)
        if s_code in seen_codes:
            return None, Response(
                {'detail': f'Duplicate store code in payload: {s_code}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        seen_codes.add(s_code)
        is_primary = bool(row.get('is_primary'))
        if is_primary:
            primary_count += 1
        normalized.append(
            {
                'name': s_name,
                'code': s_code,
                'shop_type': shop_type,
                'is_primary': is_primary,
                'is_active': bool(row.get('is_active', True)),
            }
        )

    if primary_count > 1:
        return None, Response(
            {'detail': 'Mark only one store as primary.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if mode == 'create_retailer' and primary_count != 1:
        return None, Response(
            {'detail': 'Exactly one primary store is required for create mode.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return normalized, None


@api_view(['POST'])
@permission_classes([AllowAny])
def onboarding_complete(request):
    configured_password = str(getattr(settings, 'ONBOARDING_SETUP_PASSWORD', '') or '')
    if not configured_password:
        return Response({'detail': 'Onboarding password is not configured.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    provided_password = str(request.data.get('password') or '')
    if provided_password != configured_password:
        return Response({'detail': 'Invalid onboarding password.'}, status=status.HTTP_403_FORBIDDEN)

    mode = _normalize_onboarding_mode(request.data)
    if not mode:
        return Response(
            {'detail': 'Invalid mode. Use create_retailer or extend_retailer.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    stores_data = request.data.get('stores') or []
    roles_data = request.data.get('roles') or []
    users_data = request.data.get('users') or []

    from backend.locations.models import Store
    from backend.tenants.models import Retailer

    retailer_target, retailer_err = _resolve_onboarding_retailer(mode, request.data)
    if retailer_err:
        return retailer_err

    normalized_stores, store_err = _validate_onboarding_stores(stores_data, mode)
    if store_err:
        return store_err

    with transaction.atomic():
        if retailer_target['create']:
            retailer = Retailer.objects.create(
                code=retailer_target['code'],
                name=retailer_target['name'],
                is_active=True,
            )
        else:
            retailer = retailer_target['retailer']

        created_stores = {}
        primary_store = None
        for row in normalized_stores:
            s_name = row['name']
            s_code = row['code']
            if Store.objects.filter(retailer_id=retailer.id, code__iexact=s_code).exists():
                transaction.set_rollback(True)
                return Response(
                    {'detail': f'Store code already exists for this retailer: {s_code}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            store = Store.objects.create(
                retailer=retailer,
                name=s_name,
                code=s_code,
                shop_type=row['shop_type'],
                is_active=row['is_active'],
            )
            created_stores[s_code] = store
            if row['is_primary']:
                primary_store = store

        if primary_store:
            retailer.primary_store = primary_store
            retailer.save(update_fields=['primary_store_id'])
        elif mode == 'create_retailer':
            transaction.set_rollback(True)
            return Response(
                {'detail': 'Create mode requires one primary store.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        elif not retailer.primary_store_id and created_stores:
            transaction.set_rollback(True)
            return Response(
                {'detail': 'Extend mode needs an existing primary store or mark one new store as primary.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_roles = {}
        existing_roles = {
            r.name: r
            for r in Role.objects.filter(retailer_id=retailer.id)
        }
        for role in roles_data:
            role_name = str(role.get('name') or '').strip()
            if not role_name:
                continue
            access_role = existing_roles.get(role_name)
            if not access_role:
                access_role = Role.objects.create(
                    retailer=retailer,
                    name=role_name,
                    description=str(role.get('description') or '').strip(),
                )
            codenames = role.get('permission_codenames') or []
            perms = AccessPermission.objects.filter(codename__in=codenames)
            access_role.permissions.set(perms)
            created_roles[role_name] = access_role

        all_permissions = list(AccessPermission.objects.all())
        owner_role, _ = Role.objects.get_or_create(
            retailer=retailer,
            name='Owner',
            defaults={'description': 'System default full-access role for onboarding owner'},
        )
        owner_role.permissions.set(all_permissions)
        dashboard_perm = AccessPermission.objects.filter(codename='nav.dashboard').first()
        dashboard_role = None
        if dashboard_perm:
            dashboard_role, _ = Role.objects.get_or_create(
                retailer=retailer,
                name='Dashboard Viewer',
                defaults={'description': 'System-managed role: dashboard only'},
            )
            dashboard_role.permissions.set([dashboard_perm])

        created_user_ids = []
        all_retailer_stores_by_code = {
            s.code.upper(): s
            for s in Store.objects.filter(retailer_id=retailer.id)
        }
        for idx, u in enumerate(users_data):
            username = str(u.get('username') or '').strip()
            password = str(u.get('password') or '')
            if not username or not password:
                transaction.set_rollback(True)
                return Response({'detail': 'Each user needs username and password.'}, status=status.HTTP_400_BAD_REQUEST)
            if User.objects.filter(username=username).exists():
                transaction.set_rollback(True)
                return Response({'detail': f'Username already exists: {username}'}, status=status.HTTP_400_BAD_REQUEST)

            user = User.objects.create_user(
                username=username,
                password=password,
                email=str(u.get('email') or f'{username}@local'),
                first_name=str(u.get('first_name') or ''),
                last_name=str(u.get('last_name') or ''),
                phone=str(u.get('phone') or ''),
                retailer=retailer,
                # First onboarding user is store owner/admin by default.
                is_staff=bool(u.get('is_staff', False) or idx == 0),
                is_active=True,
            )
            created_user_ids.append(user.id)

            group_names = [str(g).strip() for g in (u.get('groups') or []) if str(g).strip()]
            if group_names:
                groups = []
                for gname in list(dict.fromkeys(group_names)):
                    g, _ = Group.objects.get_or_create(name=gname)
                    groups.append(g)
                user.groups.add(*groups)

            assigned_codes = [str(x).strip().upper() for x in (u.get('assigned_store_codes') or []) if str(x).strip()]
            if assigned_codes:
                assigned_stores = [all_retailer_stores_by_code[c] for c in assigned_codes if c in all_retailer_stores_by_code]
                if len(assigned_stores) != len(assigned_codes):
                    transaction.set_rollback(True)
                    return Response(
                        {'detail': f'Invalid assigned_store_codes for user {username}.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                user.assigned_stores.set(assigned_stores)
            elif idx == 0:
                user.assigned_stores.set(Store.objects.filter(retailer_id=retailer.id))

            default_code = str(u.get('default_store_code') or '').strip().upper()
            if default_code and default_code in all_retailer_stores_by_code:
                user.default_store = all_retailer_stores_by_code[default_code]
            elif idx == 0:
                user.default_store = retailer.primary_store
            if user.default_store_id:
                user.save(update_fields=['default_store'])

            role_name = str(u.get('role_name') or '').strip()
            if role_name and role_name in created_roles:
                role_obj = created_roles[role_name]
                store_ids = list(user.assigned_stores.values_list('id', flat=True))
                if not store_ids and user.default_store_id:
                    store_ids = [user.default_store_id]
                for sid in store_ids:
                    UserStoreRole.objects.update_or_create(
                        user_id=user.id,
                        store_id=sid,
                        defaults={'role': role_obj},
                    )
            elif bool(u.get('dashboard_only')) and dashboard_role:
                store_ids = list(user.assigned_stores.values_list('id', flat=True))
                if not store_ids and user.default_store_id:
                    store_ids = [user.default_store_id]
                if not store_ids:
                    store_ids = list(created_stores.values())
                    store_ids = [s.id for s in store_ids]
                for sid in store_ids:
                    UserStoreRole.objects.update_or_create(
                        user_id=user.id,
                        store_id=sid,
                        defaults={'role': dashboard_role},
                    )
            elif idx == 0:
                for store in Store.objects.filter(retailer_id=retailer.id):
                    UserStoreRole.objects.update_or_create(
                        user_id=user.id,
                        store_id=store.id,
                        defaults={'role': owner_role},
                    )

    return Response(
        {
            'detail': 'Onboarding completed.',
            'mode': mode,
            'retailer_id': retailer.id,
            'retailer_code': retailer.code,
            'store_count': len(created_stores),
            'user_count': len(created_user_ids),
            'role_count': len(created_roles),
        },
        status=status.HTTP_201_CREATED,
    )


# Setting views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsAdminUser])
def setting_list_create(request):
    """List all settings or create a new setting"""
    if request.method == 'GET':
        settings = Setting.objects.all()
        serializer = SettingSerializer(settings, many=True)
        return Response(serializer.data)
    else:
        serializer = SettingSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated, IsAdminUser])
def setting_detail(request, pk):
    """Retrieve, update or delete a setting"""
    setting = get_object_or_404(Setting, pk=pk)
    
    if request.method == 'GET':
        serializer = SettingSerializer(setting)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = SettingSerializer(setting, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = SettingSerializer(setting, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        setting.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# AuditLog views (read-only)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def audit_log_list(request):
    """List all audit logs with filtering"""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    queryset = AuditLog.objects.filter(
        Q(user__retailer_id=retailer.id) | Q(changes__retailer_id=retailer.id)
    )
    
    is_admin = bool(request.user.is_staff or request.user.is_superuser)
    allowed_store_ids = []
    if not is_admin:
        allowed_store_ids = list(
            request.user.assigned_stores.filter(retailer_id=retailer.id).values_list('id', flat=True)
        )
        if not allowed_store_ids and request.user.default_store_id:
            allowed_store_ids = [request.user.default_store_id]
        if not allowed_store_ids:
            return Response([])
    
    # Filter by action (comma-separated for multiple, e.g. action=invoice_update,invoice_edit)
    action_filter = request.query_params.get('action', None)
    if action_filter:
        actions = [a.strip() for a in action_filter.split(',') if a.strip()]
        if actions:
            queryset = queryset.filter(action__in=actions)
    
    # Filter by model_name
    model_filter = request.query_params.get('model', None)
    if model_filter:
        queryset = queryset.filter(model_name=model_filter)
    
    # Filter by date range
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    if date_from:
        queryset = queryset.filter(created_at__gte=date_from)
    if date_to:
        queryset = queryset.filter(created_at__lte=date_to)

    store_filter = request.query_params.get('store', None)
    if store_filter:
        try:
            sid = int(store_filter)
            if (not is_admin) and sid not in allowed_store_ids:
                return Response({'detail': 'Store access denied.'}, status=status.HTTP_403_FORBIDDEN)
            queryset = queryset.filter(
                Q(changes__store_id=sid)
                | Q(changes__store=sid)
                | Q(changes__store_id=str(sid))
                | Q(changes__store=str(sid))
                | Q(changes__from_store=sid)
                | Q(changes__to_store=sid)
                | Q(changes__from_store=str(sid))
                | Q(changes__to_store=str(sid))
            )
        except (TypeError, ValueError):
            return Response({'detail': 'Invalid store filter.'}, status=status.HTTP_400_BAD_REQUEST)
    elif not is_admin:
        allowed_store_ids_str = [str(sid) for sid in allowed_store_ids]
        queryset = queryset.filter(
            Q(changes__store_id__in=allowed_store_ids)
            | Q(changes__store__in=allowed_store_ids)
            | Q(changes__store_id__in=allowed_store_ids_str)
            | Q(changes__store__in=allowed_store_ids_str)
            | Q(changes__from_store__in=allowed_store_ids)
            | Q(changes__to_store__in=allowed_store_ids)
            | Q(changes__from_store__in=allowed_store_ids_str)
            | Q(changes__to_store__in=allowed_store_ids_str)
        )
    
    queryset = queryset.order_by('-created_at')
    serializer = AuditLogSerializer(queryset, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def audit_log_detail(request, pk):
    """Retrieve an audit log"""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    audit_log = get_object_or_404(
        AuditLog.objects.filter(
            Q(user__retailer_id=retailer.id) | Q(changes__retailer_id=retailer.id)
        ),
        pk=pk,
    )
    
    # Non-admin users can access only logs tied to their assigned/default stores.
    if not request.user.is_staff and not request.user.is_superuser:
        allowed_store_ids = list(
            request.user.assigned_stores.filter(retailer_id=retailer.id).values_list('id', flat=True)
        )
        if not allowed_store_ids and request.user.default_store_id:
            allowed_store_ids = [request.user.default_store_id]
        if not allowed_store_ids:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        allowed_store_ids_str = {str(sid) for sid in allowed_store_ids}
        log_changes = audit_log.changes or {}
        log_store_refs = {
            str(log_changes.get('store_id')) if log_changes.get('store_id') is not None else None,
            str(log_changes.get('store')) if log_changes.get('store') is not None else None,
            str(log_changes.get('from_store')) if log_changes.get('from_store') is not None else None,
            str(log_changes.get('to_store')) if log_changes.get('to_store') is not None else None,
        }
        log_store_refs.discard(None)
        if not (log_store_refs & allowed_store_ids_str):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    
    serializer = AuditLogSerializer(audit_log)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def global_search(request):
    """Global search across all entities. Optional product_limit (default 40); 0 or 'all' = cap at 500."""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    query = request.query_params.get('q', '').strip()
    search_type = request.query_params.get('type', 'all').lower()
    raw_limit = request.query_params.get('product_limit') or request.query_params.get('limit')
    if raw_limit in (None, ''):
        product_limit = 40
    elif str(raw_limit).lower() in ('0', 'all'):
        product_limit = 500
    else:
        try:
            product_limit = min(500, max(1, int(raw_limit)))
        except (TypeError, ValueError):
            product_limit = 40

    if not query:
        return Response({
            'products': [],
            'variants': [],
            'barcodes': [],
            'customers': [],
            'invoices': [],
            'carts': [],
            'suppliers': [],
            'categories': [],
            'brands': [],
            'stores': [],
            'warehouses': [],
            'purchases': [],
        })
    
    results = {
        'products': [],
        'variants': [],
        'barcodes': [],
        'customers': [],
        'invoices': [],
        'carts': [],
        'suppliers': [],
        'categories': [],
        'brands': [],
        'stores': [],
        'warehouses': [],
        'purchases': [],
    }
    
    # Import models
    from backend.catalog.models import Product, ProductVariant, Barcode, Category, Brand
    from backend.parties.models import Customer, Supplier
    from backend.pos.models import Invoice, Cart
    from backend.locations.models import Store, Warehouse
    from backend.purchasing.models import Purchase
    from backend.catalog.serializers import (
        ProductListSerializer, ProductVariantSerializer, BarcodeSerializer,
        CategorySerializer, BrandSerializer
    )
    from backend.parties.serializers import CustomerSerializer, SupplierSerializer
    from backend.pos.serializers import InvoiceSerializer, CartSerializer
    from backend.locations.serializers import StoreSerializer, WarehouseSerializer
    from backend.purchasing.serializers import PurchaseSerializer
    
    # helper for results
    def add_to_results(key, queryset, serializer_class, many=True, context=None):
        if context:
            results[key] = serializer_class(queryset, many=many, context=context).data
        else:
            results[key] = serializer_class(queryset, many=many).data

    # Search Products: use name_only so "FOLDER BKC" matches "FOLDER BKC 8A" (all words in name)
    if search_type in ['all', 'product']:
        from backend.catalog.filters import ProductFilter
        from backend.pos.models import CartItem
        from django.db.models import Case, When, Value, IntegerField

        # Lean queryset for search + ranking (id/name only); prefetches only on the final page.
        products_base = Product.objects.filter(is_active=True, retailer_id=retailer.id).exclude(
            name__istartswith='Other -'
        )
        products_filter = ProductFilter(
            {'search': query, 'search_mode': 'name_only'},
            queryset=products_base,
        )

        # Pull a larger candidate window, rank in Python for better relevance than SQL `order_by('name')`,
        # then materialize the final page with prefetches intact.
        candidate_cap = min(500, max(product_limit * 10, 200))
        candidate_pairs = list(products_filter.qs.values('id', 'name')[:candidate_cap])
        ordered_ids = order_product_ids_by_name_relevance(candidate_pairs, query, product_limit)

        preserved_order = Case(
            *[When(pk=pk, then=Value(idx)) for idx, pk in enumerate(ordered_ids)],
            output_field=IntegerField(),
        )
        products = (
            products_base.filter(pk__in=ordered_ids)
            .prefetch_related(
                'barcodes',
                'barcodes__purchase__supplier',
                'stock_entries',
                'stock_entries__store',
                'stock_entries__warehouse',
            )
            .annotate(_search_order=preserved_order)
            .order_by('_search_order')
        )

        # Pass active_cart_barcodes so available_quantity matches Products page (barcode count is source of truth)
        active_cart_barcodes = set()
        for item in CartItem.objects.filter(cart__status='active', cart__retailer_id=retailer.id).exclude(
            scanned_barcodes__isnull=True
        ).exclude(scanned_barcodes=[]).only('scanned_barcodes'):
            if item.scanned_barcodes:
                active_cart_barcodes.update(item.scanned_barcodes)

        product_context = {
            'request': request,
            'active_cart_barcodes': active_cart_barcodes,
        }
        add_to_results('products', products, ProductListSerializer, context=product_context)
    
    # Search Product Variants (SKU Search)
    if search_type in ['all', 'sku']:
        variants = ProductVariant.objects.filter(retailer_id=retailer.id).filter(
            Q(sku__icontains=query) | Q(name__icontains=query)
        )[:20]
        if search_type == 'sku':
            # Priority to SKU match
            variants = ProductVariant.objects.filter(retailer_id=retailer.id, sku__icontains=query)[:20]
        add_to_results('variants', variants, ProductVariantSerializer)
    
    # Search Barcodes - exact match for barcode/short_code; optionally by tag (barcode_status)
    if search_type in ['all', 'barcode', 'barcode_status']:
        query_clean = query.strip()
        # Barcodes are stored in capitals; normalize so scanner/machine input matches
        query_upper = query_clean.upper()
        # Exact match on barcode or short_code (no partial/icontains)
        barcode_q = Q(barcode=query_upper) | Q(short_code=query_upper)
        if search_type == 'barcode_status':
            # Also search by tag (exact match, e.g. "sold", "new", "defective", "returned")
            barcode_q |= Q(tag__iexact=query_clean.lower())
        barcodes = Barcode.objects.filter(barcode_q, retailer_id=retailer.id).select_related('product').prefetch_related(
            'invoice_items__invoice', 'invoice_items__invoice__customer'
        )[:20]
        add_to_results('barcodes', barcodes, BarcodeSerializer)
    
    # Search Customers
    if search_type in ['all', 'customer']:
        customers = Customer.objects.filter(
            retailer_id=retailer.id
        ).filter(
            Q(name__icontains=query) |
            Q(phone__icontains=query) |
            Q(email__icontains=query)
        )[:20]
        add_to_results('customers', customers, CustomerSerializer)
    
    # Search Invoices
    if search_type in ['all']: # Invoices only in 'all' for now unless requested
        invoices = Invoice.objects.filter(
            retailer_id=retailer.id
        ).filter(
            Q(invoice_number__icontains=query)
        )[:20]
        add_to_results('invoices', invoices, InvoiceSerializer)
    
    # Search Carts
    if search_type in ['all']:
        carts = Cart.objects.filter(
            retailer_id=retailer.id
        ).filter(
            Q(cart_number__icontains=query)
        )[:20]
        add_to_results('carts', carts, CartSerializer)
    
    # Search Suppliers
    if search_type in ['all']:
        suppliers = Supplier.objects.filter(
            retailer_id=retailer.id
        ).filter(
            Q(name__icontains=query) |
            Q(code__icontains=query) |
            Q(phone__icontains=query) |
            Q(email__icontains=query)
        )[:20]
        add_to_results('suppliers', suppliers, SupplierSerializer)
    
    # Search Brands
    if search_type in ['all', 'brand']:
        brands = Brand.objects.filter(
            retailer_id=retailer.id
        ).filter(
            Q(name__icontains=query)
        )[:20]
        add_to_results('brands', brands, BrandSerializer)

    # Search Categories
    if search_type in ['all', 'category']:
        categories = Category.objects.filter(
            retailer_id=retailer.id
        ).filter(
            Q(name__icontains=query)
        )[:20]
        add_to_results('categories', categories, CategorySerializer)
    
    # Search Stores/Warehouses/Purchases only in 'all'
    if search_type == 'all':
        stores = Store.objects.filter(retailer_id=retailer.id).filter(Q(name__icontains=query) | Q(code__icontains=query))[:20]
        add_to_results('stores', stores, StoreSerializer)
        
        warehouses = Warehouse.objects.filter(retailer_id=retailer.id).filter(Q(name__icontains=query) | Q(code__icontains=query))[:20]
        add_to_results('warehouses', warehouses, WarehouseSerializer)
        
        purchases = Purchase.objects.filter(retailer_id=retailer.id).filter(Q(purchase_number__icontains=query) | Q(bill_number__icontains=query))[:20]
        add_to_results('purchases', purchases, PurchaseSerializer)
    
    return Response(results)

