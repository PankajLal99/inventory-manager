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
    
    # Filter by action
    action_filter = request.query_params.get('action', None)
    if action_filter:
        queryset = queryset.filter(action=action_filter)
    
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
    """Global search across all entities"""
    query = request.query_params.get('q', '').strip()
    
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
            'purchase_orders': [],
            'grns': [],
            'direct_purchases': [],
        })
    
    results = {}
    
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
    
    # Search Products using django-filter
    from backend.catalog.filters import ProductFilter
    products_queryset = Product.objects.all().prefetch_related('barcodes', 'barcodes__purchase_item')
    products_filter = ProductFilter({'search': query}, queryset=products_queryset)
    products = products_filter.qs[:20]
    results['products'] = ProductListSerializer(products, many=True, context={'request': request}).data
    
    # Search Product Variants
    variants = ProductVariant.objects.filter(
        Q(name__icontains=query) |
        Q(sku__icontains=query)
    )[:20]
    results['variants'] = ProductVariantSerializer(variants, many=True).data
    
    # Search Barcodes
    barcodes = Barcode.objects.filter(
        Q(barcode__icontains=query)
    ).prefetch_related('invoice_items__invoice')[:20]
    results['barcodes'] = BarcodeSerializer(barcodes, many=True).data
    
    # Search Customers
    customers = Customer.objects.filter(
        Q(name__icontains=query) |
        Q(phone__icontains=query) |
        Q(email__icontains=query)
    )[:20]
    results['customers'] = CustomerSerializer(customers, many=True).data
    
    # Search Invoices
    invoices = Invoice.objects.filter(
        Q(invoice_number__icontains=query)
    )[:20]
    results['invoices'] = InvoiceSerializer(invoices, many=True).data
    
    # Search Carts
    carts = Cart.objects.filter(
        Q(cart_number__icontains=query)
    )[:20]
    results['carts'] = CartSerializer(carts, many=True).data
    
    # Search Suppliers
    suppliers = Supplier.objects.filter(
        Q(name__icontains=query) |
        Q(code__icontains=query) |
        Q(phone__icontains=query) |
        Q(email__icontains=query)
    )[:20]
    results['suppliers'] = SupplierSerializer(suppliers, many=True).data
    
    # Search Categories
    categories = Category.objects.filter(
        Q(name__icontains=query)
    )[:20]
    results['categories'] = CategorySerializer(categories, many=True).data
    
    # Search Brands
    brands = Brand.objects.filter(
        Q(name__icontains=query)
    )[:20]
    results['brands'] = BrandSerializer(brands, many=True).data
    
    # Search Stores
    stores = Store.objects.filter(
        Q(name__icontains=query) |
        Q(code__icontains=query)
    )[:20]
    results['stores'] = StoreSerializer(stores, many=True).data
    
    # Search Warehouses
    warehouses = Warehouse.objects.filter(
        Q(name__icontains=query) |
        Q(code__icontains=query)
    )[:20]
    results['warehouses'] = WarehouseSerializer(warehouses, many=True).data
    
    # Search Purchases
    purchases = Purchase.objects.filter(
        Q(purchase_number__icontains=query) | Q(bill_number__icontains=query)
    )[:20]
    results['purchases'] = PurchaseSerializer(purchases, many=True).data
    
    return Response(results)
