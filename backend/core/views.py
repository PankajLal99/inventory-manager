from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from django.contrib.auth import get_user_model
from django.core.exceptions import ObjectDoesNotExist
from django.shortcuts import get_object_or_404
from django.db.models import Q
import json
import re

from backend.catalog.product_name_relevance import order_product_ids_by_name_relevance
from .models import Setting, AuditLog
from .serializers import (
    UserSerializer, UserCreateSerializer,
    SettingSerializer, AuditLogSerializer
)

User = get_user_model()


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
    user = request.user
    serializer = UserSerializer(user)
    user_data = serializer.data
    
    # Add Django groups
    user_data['groups'] = list(user.groups.values_list('name', flat=True))
    
    # Add store info if available (safely handle missing store field)
    try:
        if hasattr(user, 'store') and user.store:
            user_data['store'] = {
                'id': user.store.id,
                'name': user.store.name,
                'shop_type': getattr(user.store, 'shop_type', 'retail'),
            }
    except AttributeError:
        # Store field not available (migration not run yet)
        pass
    
    # Determine access permissions based on groups
    # Priority: Group membership > superuser/staff status for application access control
    user_groups = user_data['groups']
    is_admin_group = 'Admin' in user_groups
    is_retail_admin = 'RetailAdmin' in user_groups
    is_retail = 'Retail' in user_groups
    is_wholesale = 'Wholesale' in user_groups
    is_wholesale_admin = 'WholesaleAdmin' in user_groups
    is_repair = 'Repair' in user_groups
    is_repair_admin = 'RepairAdmin' in user_groups
    
    # If user is in a specific group, use group-based permissions
    # Only use superuser/staff if user is NOT in any application group
    has_application_group = is_admin_group or is_retail_admin or is_retail or is_wholesale or is_wholesale_admin or is_repair or is_repair_admin
    
    if has_application_group:
        # User is in an application group - use group-based permissions
        # Admin group has all access
        user_data['is_admin'] = is_admin_group
        
        # Dashboard access: Admin, RetailAdmin, and WholesaleAdmin only (not Retail/Wholesale)
        user_data['can_access_dashboard'] = is_admin_group or is_retail_admin or is_wholesale_admin
        
        # Reports access: Admin, RetailAdmin, and WholesaleAdmin only (not Retail/Wholesale)
        user_data['can_access_reports'] = is_admin_group or is_retail_admin or is_wholesale_admin
        
        # Additional granular permissions for frontend
        # Retail/Wholesale groups can access: POS, Search, Invoices, Replacement, Products, Purchases
        # RetailAdmin/WholesaleAdmin can access: Everything Retail/Wholesale can + Dashboard, Reports, Customers
        # Admin can access: Everything
        user_data['can_access_customers'] = is_admin_group or is_retail_admin or is_wholesale_admin or is_repair_admin  # Admin, RetailAdmin, and WholesaleAdmin
        user_data['can_access_ledger'] = is_admin_group  # Only Admin group
        user_data['can_access_history'] = is_admin_group  # Only Admin group
    else:
        # User is not in any application group - fall back to superuser/staff
        # This allows superusers/staff without groups to have admin access
        is_superuser_or_staff = user.is_superuser or user.is_staff
        user_data['is_admin'] = is_superuser_or_staff
        user_data['can_access_dashboard'] = is_superuser_or_staff
        user_data['can_access_reports'] = is_superuser_or_staff
        user_data['can_access_customers'] = is_superuser_or_staff
        user_data['can_access_ledger'] = is_superuser_or_staff
        user_data['can_access_history'] = is_superuser_or_staff
    
    return Response(user_data)


DOCUMENT_THEME_KEY = 'credit_doc_themes'
LEDGER_EXPORT_SETTINGS_KEY = 'credit_ledger_export_split'
INVOICE_EXPORT_SETTINGS_KEY = 'invoice_photo_export_split'
PRODUCT_NAME_COLOR_RULES_KEY = 'product_name_color_rules'

SUPER_PRODUCT_KEYWORDS = {'NON PESTING', 'PESTING'}
HEX_COLOR_RE = re.compile(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$')

DEFAULT_LEDGER_EXPORT_SPLIT = {
    'useRows': True,
    'useDays': False,
    'rowsPerPage': 40,
    'daysPerPage': 15,
}

DEFAULT_INVOICE_EXPORT_SPLIT = {
    'rowsPerPage': 25,
}


def _clamp_int(value, min_value, max_value, fallback):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(min_value, min(max_value, number))


def normalize_ledger_export_split(value):
    """Shop-wide copy/PDF page split. Not scoped to a user profile."""
    if not isinstance(value, dict):
        value = {}
    use_rows = value.get('useRows')
    use_days = value.get('useDays')
    if use_rows is None and use_days is None:
        if value.get('mode') == 'days':
            use_rows, use_days = False, True
        else:
            use_rows, use_days = True, False
    cleaned = {
        'useRows': bool(use_rows),
        'useDays': bool(use_days),
        'rowsPerPage': _clamp_int(
            value.get('rowsPerPage'), 1, 200, DEFAULT_LEDGER_EXPORT_SPLIT['rowsPerPage']
        ),
        'daysPerPage': _clamp_int(
            value.get('daysPerPage'), 1, 366, DEFAULT_LEDGER_EXPORT_SPLIT['daysPerPage']
        ),
    }
    if not cleaned['useRows'] and not cleaned['useDays']:
        cleaned['useRows'] = True
    return cleaned


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def document_theme(request):
    """
    Shop-wide credit document theme (invoice / ledger colors + invoice typography).
    Shared across all users — not scoped to the logged-in user id.
    """
    setting, _ = Setting.objects.get_or_create(
        key=DOCUMENT_THEME_KEY,
        defaults={
            'value': '{}',
            'description': 'Credit invoice/ledger document theme (colors, fonts, row styles)',
        },
    )

    if request.method == 'GET':
        try:
            data = json.loads(setting.value or '{}')
            if not isinstance(data, dict):
                data = {}
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        return Response(data)

    payload = request.data
    if not isinstance(payload, dict):
        return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

    # Persist only invoice/ledger override bags
    cleaned = {}
    for kind in ('invoice', 'ledger'):
        raw = payload.get(kind)
        if isinstance(raw, dict):
            cleaned[kind] = raw

    setting.value = json.dumps(cleaned)
    if not setting.description:
        setting.description = 'Credit invoice/ledger document theme (colors, fonts, row styles)'
    setting.save(update_fields=['value', 'description', 'updated_at'])
    return Response(cleaned)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def ledger_export_settings(request):
    """
    Shop-wide credit ledger copy/PDF page-split settings (JSON on core.Setting).
    Shared across all users and devices — not scoped to the logged-in user.
    """
    setting = Setting.objects.filter(key=LEDGER_EXPORT_SETTINGS_KEY).first()

    if request.method == 'GET':
        if setting is None:
            return Response({})
        try:
            data = json.loads(setting.value or '{}')
            if not isinstance(data, dict):
                data = {}
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        if not data:
            return Response({})
        return Response(normalize_ledger_export_split(data))

    payload = request.data
    if not isinstance(payload, dict):
        return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

    cleaned = normalize_ledger_export_split(payload)
    if setting is None:
        setting = Setting(
            key=LEDGER_EXPORT_SETTINGS_KEY,
            description='Credit ledger copy/PDF page split (rows/days per image)',
        )
    setting.value = json.dumps(cleaned)
    if not setting.description:
        setting.description = 'Credit ledger copy/PDF page split (rows/days per image)'
    setting.save()
    return Response(cleaned)


def normalize_invoice_export_split(value):
    """Shop-wide invoice photo page split (rows per image)."""
    if not isinstance(value, dict):
        value = {}
    return {
        'rowsPerPage': _clamp_int(
            value.get('rowsPerPage'), 1, 200, DEFAULT_INVOICE_EXPORT_SPLIT['rowsPerPage']
        ),
    }


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def invoice_export_settings(request):
    """
    Shop-wide invoice photo copy page-split settings (JSON on core.Setting).
    Shared across all users and devices — not scoped to the logged-in user.
    """
    setting = Setting.objects.filter(key=INVOICE_EXPORT_SETTINGS_KEY).first()

    if request.method == 'GET':
        if setting is None:
            return Response({})
        try:
            data = json.loads(setting.value or '{}')
            if not isinstance(data, dict):
                data = {}
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        if not data:
            return Response({})
        return Response(normalize_invoice_export_split(data))

    payload = request.data
    if not isinstance(payload, dict):
        return Response({'detail': 'Expected a JSON object.'}, status=status.HTTP_400_BAD_REQUEST)

    cleaned = normalize_invoice_export_split(payload)
    if setting is None:
        setting = Setting(
            key=INVOICE_EXPORT_SETTINGS_KEY,
            description='Invoice photo copy page split (rows per image)',
        )
    setting.value = json.dumps(cleaned)
    if not setting.description:
        setting.description = 'Invoice photo copy page split (rows per image)'
    setting.save()
    return Response(cleaned)


def normalize_product_name_color_rules(value):
    """User-defined keyword highlight rules (PESTING/NON PESTING are fixed super rules on the client)."""
    if not isinstance(value, list):
        return []
    cleaned = []
    for index, entry in enumerate(value):
        if not isinstance(entry, dict):
            continue
        keyword = str(entry.get('keyword') or '').strip()
        color = str(entry.get('color') or '').strip()
        if not keyword or not color or not HEX_COLOR_RE.match(color):
            continue
        if keyword.upper() in SUPER_PRODUCT_KEYWORDS:
            continue
        rule_id = str(entry.get('id') or '').strip() or f'rule-{index}-{keyword.lower().replace(" ", "-")}'
        scope_raw = str(entry.get('scope') or 'keyword').strip().lower()
        scope = 'whole_line' if scope_raw == 'whole_line' else 'keyword'
        cleaned.append({'id': rule_id, 'keyword': keyword, 'color': color, 'scope': scope})
    return cleaned


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def product_name_color_rules(request):
    """
    Shop-wide custom product-name keyword color rules (JSON array on core.Setting).
    PESTING / NON PESTING super rules are fixed in the frontend and not stored here.
    """
    setting = Setting.objects.filter(key=PRODUCT_NAME_COLOR_RULES_KEY).first()

    if request.method == 'GET':
        if setting is None:
            return Response([])
        try:
            data = json.loads(setting.value or '[]')
            if not isinstance(data, list):
                data = []
        except (TypeError, ValueError, json.JSONDecodeError):
            data = []
        return Response(normalize_product_name_color_rules(data))

    payload = request.data
    if not isinstance(payload, list):
        return Response({'detail': 'Expected a JSON array.'}, status=status.HTTP_400_BAD_REQUEST)

    cleaned = normalize_product_name_color_rules(payload)
    if setting is None:
        setting = Setting(
            key=PRODUCT_NAME_COLOR_RULES_KEY,
            description='Custom product name keyword highlight colors',
        )
    setting.value = json.dumps(cleaned)
    if not setting.description:
        setting.description = 'Custom product name keyword highlight colors'
    setting.save()
    return Response(cleaned)


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
    queryset = AuditLog.objects.all()
    
    # Filter by user if not admin
    if not request.user.is_staff:
        queryset = queryset.filter(user=request.user)
    
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
    
    queryset = queryset.order_by('-created_at')
    serializer = AuditLogSerializer(queryset, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def audit_log_detail(request, pk):
    """Retrieve an audit log"""
    audit_log = get_object_or_404(AuditLog, pk=pk)
    
    # Check permission if not admin
    if not request.user.is_staff and audit_log.user != request.user:
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    
    serializer = AuditLogSerializer(audit_log)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def global_search(request):
    """Global search across all entities. Optional product_limit (default 40); 0 or 'all' = cap at 500."""
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
    from backend.pos.serializers import InvoiceSearchSerializer, CartSerializer
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
        from django.db.models import Case, When, Value, IntegerField

        # Lean queryset for search + ranking (id/name only); prefetches only on the final page.
        products_base = Product.objects.filter(is_active=True).exclude(
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

        product_context = {
            'request': request,
            # Search does not request per-barcode payloads, so avoid scanning active carts.
            'active_cart_barcodes': set(),
        }
        add_to_results('products', products, ProductListSerializer, context=product_context)
    
    # Search Product Variants (SKU Search)
    if search_type in ['all', 'sku']:
        variants = ProductVariant.objects.filter(
            Q(sku__icontains=query) | Q(name__icontains=query)
        )[:20]
        if search_type == 'sku':
            # Priority to SKU match
            variants = ProductVariant.objects.filter(Q(sku__icontains=query))[:20]
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
        barcodes = (
            Barcode.objects
            .filter(barcode_q)
            .select_related('product', 'purchase__supplier', 'purchase_item__purchase__supplier')
            .prefetch_related(
                'invoice_items__invoice',
                'invoice_items__invoice__customer',
                'defective_move_outs__move_out',
            )
        )[:20]
        add_to_results('barcodes', barcodes, BarcodeSerializer)
    
    # Search Customers
    if search_type in ['all', 'customer']:
        customers = Customer.objects.filter(
            Q(name__icontains=query) |
            Q(phone__icontains=query) |
            Q(email__icontains=query)
        )[:20]
        add_to_results('customers', customers, CustomerSerializer)
    
    # Search Invoices
    if search_type in ['all']: # Invoices only in 'all' for now unless requested
        invoices = Invoice.objects.filter(
            Q(invoice_number__icontains=query)
        ).select_related('customer')[:20]
        add_to_results('invoices', invoices, InvoiceSearchSerializer)
    
    # Search Carts
    if search_type in ['all']:
        carts = Cart.objects.filter(
            Q(cart_number__icontains=query)
        )[:20]
        add_to_results('carts', carts, CartSerializer)
    
    # Search Suppliers
    if search_type in ['all']:
        suppliers = Supplier.objects.filter(
            Q(name__icontains=query) |
            Q(code__icontains=query) |
            Q(phone__icontains=query) |
            Q(email__icontains=query)
        )[:20]
        add_to_results('suppliers', suppliers, SupplierSerializer)
    
    # Search Brands
    if search_type in ['all', 'brand']:
        brands = Brand.objects.filter(
            Q(name__icontains=query)
        )[:20]
        add_to_results('brands', brands, BrandSerializer)

    # Search Categories
    if search_type in ['all', 'category']:
        categories = Category.objects.filter(
            Q(name__icontains=query)
        )[:20]
        add_to_results('categories', categories, CategorySerializer)
    
    # Search Stores/Warehouses/Purchases only in 'all'
    if search_type == 'all':
        stores = Store.objects.filter(Q(name__icontains=query) | Q(code__icontains=query))[:20]
        add_to_results('stores', stores, StoreSerializer)
        
        warehouses = Warehouse.objects.filter(Q(name__icontains=query) | Q(code__icontains=query))[:20]
        add_to_results('warehouses', warehouses, WarehouseSerializer)
        
        purchases = Purchase.objects.filter(Q(purchase_number__icontains=query) | Q(bill_number__icontains=query))[:20]
        add_to_results('purchases', purchases, PurchaseSerializer)
    
    return Response(results)

