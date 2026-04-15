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
from collections import Counter
import heapq
import re
from difflib import SequenceMatcher

from backend.catalog.global_search_vocab import (
    get_global_search_brand_tokens,
    get_global_search_category_tokens,
)
from .models import Setting, AuditLog
from .serializers import (
    UserSerializer, UserCreateSerializer,
    SettingSerializer, AuditLogSerializer
)

User = get_user_model()

# Global search: product name tokenization (compiled once).
_PRODUCT_NAME_TOKEN_RE = re.compile(r'[a-z0-9]+')


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


def _order_product_ids_by_name_relevance(pairs, query: str, limit: int):
    """
    Order product ids for global search by practical relevance.

    ProductFilter(name_only) already enforces token matching; within that set we want:
    - multiset token coverage (query words treated as a bag) so permutations like
      "OLED FOLDER IPHONE X ..." still rank highly for "iPhone X OLED FOLDER"
    - when users type "<MODEL> ... <PART ...>" but SKUs are stored as "<PART ...> <MODEL> ...",
      gently prefer the SKU-shaped ordering (without breaking normal substring/exact matches).
      Query shape uses active Brand + Category name tokens (cached): first word vs last word of the query.
      A part-first SKU boost treats a non-brand leading product token as the "accessory-first" layout.
    - among remaining candidates, prefer names whose *token order* is closer to the typed query
      (SequenceMatcher on whitespace tokens), with exact/substring matches as tie-breakers
    - tighter clustering of matched tokens (smaller span) before length / lexical tie-breakers

    `pairs` is a list of dicts: {'id': int, 'name': str}
    """
    if not pairs or not query:
        return []

    q = (query or '').strip()
    if not q:
        return [p['id'] for p in pairs][:limit]

    q_lower = q.lower()
    tokens = [t for t in q_lower.split() if t]
    if not tokens:
        return [p['id'] for p in pairs][:limit]

    brand_tokens = get_global_search_brand_tokens()
    category_tokens = get_global_search_category_tokens()
    qcnt = Counter(tokens)
    q_keys = frozenset(qcnt)
    tokens_len = len(tokens)
    query_part_first_eligible = (
        tokens_len >= 2
        and tokens[0] in brand_tokens
        and tokens[-1] in category_tokens
    )

    def _multiset_hits(name_tokens: list[str]) -> int:
        if not name_tokens:
            return 0
        nc: dict[str, int] = {}
        for t in name_tokens:
            if t in q_keys:
                nc[t] = nc.get(t, 0) + 1
        return sum(min(c, nc.get(t, 0)) for t, c in qcnt.items())

    def score_row(name: str) -> tuple:
        if not name:
            return (-0, 1, 0.0, 999, 10**9, 10**9, 10**9, 999, '')

        n = name.lower()

        # Tier 0: exact / phrase containment (strong signal)
        if n == q_lower:
            tier = 0
        elif n.startswith(q_lower):
            tier = 1
        elif q_lower in n:
            tier = 2
        else:
            tier = 3

        name_tokens = _PRODUCT_NAME_TOKEN_RE.findall(n)
        token_hits = _multiset_hits(name_tokens)

        # Map each token -> occurrences in order (for multiset assignment in query order)
        occ: dict[str, list[int]] = {}
        for idx, t in enumerate(name_tokens):
            occ.setdefault(t, []).append(idx)

        ptr: dict[str, int] = {t: 0 for t in occ}
        positions: list[int] = []
        missing = 0
        for tok in tokens:
            lst = occ.get(tok)
            if not lst:
                missing += 1
                continue
            p = ptr.get(tok, 0)
            if p >= len(lst):
                missing += 1
                continue
            positions.append(lst[p])
            ptr[tok] = p + 1

        if missing > 0:
            # Partial coverage: prioritize multiset hits, then phrase tiers / missing count.
            order_sim = SequenceMatcher(
                a=tokens,
                b=name_tokens,
                autojunk=False,
            ).ratio()
            return (-token_hits, 1, -order_sim, 40 + tier, missing, 10**9, len(n), tier, name)

        span = max(positions) - min(positions) if positions else 0
        inversions = 0
        lp = len(positions)
        for i in range(lp):
            pi = positions[i]
            for j in range(i + 1, lp):
                if pi > positions[j]:
                    inversions += 1

        # Prefer shorter names among equally-good matches (often closer to the exact SKU/name)
        name_len = len(n)

        order_sim = SequenceMatcher(
            a=tokens,
            b=name_tokens,
            autojunk=False,
        ).ratio()

        full_token_coverage = token_hits >= tokens_len
        # Once all query tokens are present, prefer token-order similarity over raw substring tiers,
        # otherwise "IPHONE X OLED FOLDER ..." always beats permutations even when users type a reorder.
        effective_tier = 3 if full_token_coverage else tier

        part_first_boost = False
        if full_token_coverage and query_part_first_eligible and name_tokens:
            nf = name_tokens[0]
            # Prefer "<part> ... <brand/model> ..." when the user typed "<brand> ... <category> ...".
            # Name leading token should not be a brand dictionary token (category names need not list every part keyword).
            part_first_boost = nf != tokens[0] and nf not in brand_tokens

        # Sort key: maximize multiset token hits, then (optional) prefer common "<PART> ... <MODEL>" SKUs
        # when the user typed "<MODEL> ... <PART>", then maximize token-order similarity, then phrase tiers /
        # inversions / span / shorter names.
        return (
            -token_hits,
            0 if part_first_boost else 1,
            -order_sim,
            effective_tier,
            inversions,
            span,
            name_len,
            tier,
            name,
        )

    if limit >= len(pairs):
        scored = sorted(pairs, key=lambda p: score_row(p.get('name') or ''))
    else:
        scored = heapq.nsmallest(limit, pairs, key=lambda p: score_row(p.get('name') or ''))
    return [p['id'] for p in scored[:limit]]


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
        ordered_ids = _order_product_ids_by_name_relevance(candidate_pairs, query, product_limit)

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
        for item in CartItem.objects.filter(cart__status='active').exclude(
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
        barcodes = Barcode.objects.filter(barcode_q).select_related('product').prefetch_related(
            'invoice_items__invoice', 'invoice_items__invoice__customer'
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
        )[:20]
        add_to_results('invoices', invoices, InvoiceSerializer)
    
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

