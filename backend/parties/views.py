from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Sum, Count
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from decimal import Decimal
from .models import Customer, CustomerGroup, Supplier, LedgerEntry, PersonalCustomer, PersonalLedgerEntry, InternalCustomer, InternalLedgerEntry
from .serializers import CustomerSerializer, CustomerGroupSerializer, SupplierSerializer, LedgerEntrySerializer, PersonalCustomerSerializer, PersonalLedgerEntrySerializer, InternalCustomerSerializer, InternalLedgerEntrySerializer


def is_admin_user(user):
    """
    Check if user is an admin user.
    Returns True if:
    - User is in 'Admin' group, OR
    - User is superuser/staff and not in any application group (fallback)
    """
    user_groups = user.groups.values_list('name', flat=True)
    user_group_names = list(user_groups)
    
    # Check if user is in Admin group
    if 'Admin' in user_group_names:
        return True
    
    # Check if user is superuser/staff but not in any application group (fallback)
    application_groups = ['Admin', 'Retail', 'RetailAdmin', 'Wholesale', 'WholesaleAdmin', 'Repair', 'RepairAdmin']
    has_application_group = any(group in user_group_names for group in application_groups)
    
    if not has_application_group and (user.is_superuser or user.is_staff):
        return True
    
    return False


# CustomerGroup views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def customer_group_list_create(request):
    """List all customer groups or create a new group"""
    if request.method == 'GET':
        groups = CustomerGroup.objects.all()
        serializer = CustomerGroupSerializer(groups, many=True)
        return Response(serializer.data)
    else:
        serializer = CustomerGroupSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def customer_group_detail(request, pk):
    """Retrieve, update or delete a customer group"""
    group = get_object_or_404(CustomerGroup, pk=pk)
    
    if request.method == 'GET':
        serializer = CustomerGroupSerializer(group)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = CustomerGroupSerializer(group, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = CustomerGroupSerializer(group, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Customer views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def customer_list_create(request):
    """List all customers or create a new customer"""
    if request.method == 'GET':
        search = request.query_params.get('search', None)
        customer_group = request.query_params.get('customer_group', None)
        
        # Try cache first
        from backend.core.model_cache import get_customer_list_cache_key, CUSTOMER_LIST_CACHE_TTL
        cache_key = get_customer_list_cache_key(search or '', customer_group or '')
        cached_data = cache.get(cache_key)
        if cached_data:
            response = Response(cached_data)
            response['Cache-Control'] = 'private, max-age=300, stale-while-revalidate=600'
            return response
        
        # Cache miss - fetch from database
        queryset = Customer.objects.all().order_by('-created_at')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(phone__icontains=search))
        if customer_group:
            queryset = queryset.filter(customer_group_id=customer_group)
        serializer = CustomerSerializer(queryset, many=True)
        response_data = serializer.data
        
        # Cache the result
        cache.set(cache_key, response_data, CUSTOMER_LIST_CACHE_TTL)
        
        response = Response(response_data)
        # Add cache headers for browser-level caching
        response['Cache-Control'] = 'private, max-age=300, stale-while-revalidate=600'
        return response
    else:
        serializer = CustomerSerializer(data=request.data)
        if serializer.is_valid():
            customer = serializer.save()
            # Ledger account is auto-created implicitly through the model relationship
            # No explicit creation needed as LedgerEntry can have null customer for anonymous entries
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def customer_detail(request, pk):
    """Retrieve, update or delete a customer"""
    customer = get_object_or_404(Customer, pk=pk)
    
    if request.method == 'GET':
        # Try cache first
        from backend.core.model_cache import get_cached_customer, cache_customer_data
        cached_data = get_cached_customer(pk)
        if cached_data:
            return Response(cached_data)
        
        # Cache miss - fetch from database
        serializer = CustomerSerializer(customer)
        response_data = serializer.data
        
        # Cache the result
        cache_customer_data(customer)
        
        return Response(response_data)
    elif request.method == 'PUT':
        serializer = CustomerSerializer(customer, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = CustomerSerializer(customer, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        customer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def customer_balance(request, pk):
    """Get customer credit balance"""
    customer = get_object_or_404(Customer, pk=pk)
    return Response({'credit_balance': customer.credit_balance, 'credit_limit': customer.credit_limit})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def customer_adjust_credit(request, pk):
    """Adjust customer credit balance"""
    from decimal import Decimal
    customer = get_object_or_404(Customer, pk=pk)
    amount = Decimal(str(request.data.get('amount', 0)))
    customer.credit_balance += amount
    customer.save()
    return Response({'credit_balance': customer.credit_balance})


# Supplier views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def supplier_list_create(request):
    """List all suppliers or create a new supplier"""
    if request.method == 'GET':
        queryset = Supplier.objects.all().order_by('name')
        search = request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | 
                Q(phone__icontains=search) | 
                Q(code__icontains=search) |
                Q(email__icontains=search)
            )
        serializer = SupplierSerializer(queryset, many=True)
        return Response(serializer.data)
    else:
        serializer = SupplierSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def supplier_detail(request, pk):
    """Retrieve, update or delete a supplier"""
    supplier = get_object_or_404(Supplier, pk=pk)
    
    if request.method == 'GET':
        serializer = SupplierSerializer(supplier)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = SupplierSerializer(supplier, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = SupplierSerializer(supplier, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        supplier.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Ledger views (Admin only)
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def ledger_entry_list_create(request):
    """List all ledger entries or create a new entry (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        queryset = LedgerEntry.objects.select_related('customer', 'customer__customer_group', 'invoice', 'created_by').all()
        customer_id = request.query_params.get('customer', None)
        customer_group_id = request.query_params.get('customer_group', None)
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        entry_type = request.query_params.get('entry_type', None)
        search = request.query_params.get('search', None)
        store_id = request.query_params.get('store', None)
        invoice_status = request.query_params.get('invoice_status', None)
        
        # Filter by invoice status if provided (only show entries from invoices with this status)
        if invoice_status:
            from django.db.models import Q
            queryset = queryset.filter(invoice__status=invoice_status)
        
        # Filter by store if provided (through invoice relationship)
        # Include manual entries (without invoices) OR entries with invoices from the selected store
        if store_id:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(invoice__store_id=store_id) | Q(invoice__isnull=True)
            )
        
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)
        if customer_group_id:
            queryset = queryset.filter(customer__customer_group_id=customer_group_id)
        if date_from or date_to:
            from django.db.models import Q
            # Build date filter: include entries with None created_at OR entries within date range
            date_filter = Q()
            if date_from and date_to:
                # Both dates specified: include None OR entries within range
                date_filter = Q(created_at__isnull=True) | (Q(created_at__date__gte=date_from) & Q(created_at__date__lte=date_to))
            elif date_from:
                # Only from date: include None OR entries >= date_from
                date_filter = Q(created_at__isnull=True) | Q(created_at__date__gte=date_from)
            elif date_to:
                # Only to date: include None OR entries <= date_to
                date_filter = Q(created_at__isnull=True) | Q(created_at__date__lte=date_to)
            queryset = queryset.filter(date_filter)
        if entry_type:
            queryset = queryset.filter(entry_type=entry_type)
        if search:
            queryset = queryset.filter(
                Q(customer__name__icontains=search) |
                Q(customer__phone__icontains=search) |
                Q(description__icontains=search) |
                Q(invoice__invoice_number__icontains=search)
            )
        
        # Order by created_at (None values will be sorted last)
        queryset = queryset.order_by('-created_at', '-id')
        serializer = LedgerEntrySerializer(queryset, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = LedgerEntrySerializer(data=request.data)
        if serializer.is_valid():
            # Handle custom date if provided, otherwise use current time
            from django.utils import timezone
            entry = serializer.save(created_by=request.user)
            # Set created_at if not provided (defaults to now)
            if not entry.created_at:
                entry.created_at = timezone.now()
                entry.save(update_fields=['created_at'])
            
            # Update customer credit_balance based on entry type
            if entry.customer:
                if entry.entry_type == 'credit':
                    entry.customer.credit_balance += entry.amount
                elif entry.entry_type == 'debit':
                    entry.customer.credit_balance -= entry.amount
                entry.customer.save()
            
            return Response(LedgerEntrySerializer(entry).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ledger_summary(request):
    """Get ledger summary: Total Credit, Total Debit, Number of Accounts (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
    store_id = request.query_params.get('store', None)
    invoice_status = request.query_params.get('invoice_status', None)
    
    # Base queryset - filter by store if provided (through invoice relationship)
    # Note: LedgerEntry doesn't have direct store field, but can filter via invoice__store
    # Include manual entries (without invoices) OR entries with invoices from the selected store
    base_queryset = LedgerEntry.objects.all()
    
    # Filter by invoice status if provided (only show entries from invoices with this status)
    if invoice_status:
        base_queryset = base_queryset.filter(invoice__status=invoice_status)
    
    if store_id:
        # Include entries that have invoices from the specified store OR manual entries (no invoice)
        # But if invoice_status is set, we only want entries with invoices (no manual entries)
        if invoice_status:
            base_queryset = base_queryset.filter(invoice__store_id=store_id)
        else:
            base_queryset = base_queryset.filter(
                Q(invoice__store_id=store_id) | Q(invoice__isnull=True)
            )
    
    total_credit = base_queryset.filter(entry_type='credit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    
    total_debit = base_queryset.filter(entry_type='debit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    
    # Count unique customers with ledger entries (filtered by store and invoice_status if provided)
    if store_id or invoice_status:
        num_accounts = Customer.objects.filter(
            ledger_entries__in=base_queryset
        ).distinct().count()
    else:
        num_accounts = Customer.objects.filter(ledger_entries__isnull=False).distinct().count()
    
    return Response({
        'total_credit': str(total_credit),
        'total_debit': str(total_debit),
        'num_accounts': num_accounts,
        'balance': str(total_credit - total_debit)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ledger_customer_detail(request, customer_id):
    """Get ledger entries for a specific customer with running balance (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
    customer = get_object_or_404(Customer, pk=customer_id)
    store_id = request.query_params.get('store', None)
    
    # Base queryset for this customer
    entries = LedgerEntry.objects.filter(customer=customer).select_related('customer', 'customer__customer_group', 'invoice', 'created_by')
    
    # Filter by store if provided (through invoice relationship)
    # Include manual entries (without invoices) OR entries with invoices from the selected store
    if store_id:
        entries = entries.filter(
            Q(invoice__store_id=store_id) | Q(invoice__isnull=True)
        )
    
    entries = entries.order_by('created_at')
    
    serializer = LedgerEntrySerializer(entries, many=True)
    entries_data = serializer.data
    
    # Calculate running balance
    running_balance = Decimal('0.00')
    for entry in entries_data:
        if entry['entry_type'] == 'credit':
            running_balance += Decimal(str(entry['amount']))
        else:
            running_balance -= Decimal(str(entry['amount']))
        entry['running_balance'] = str(running_balance)
    
    return Response({
        'customer': {
            'id': customer.id,
            'name': customer.name,
            'phone': customer.phone,
        },
        'entries': entries_data,
        'final_balance': str(running_balance)
    })


# Personal Customer views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def personal_customer_list_create(request):
    """List all personal customers or create a new personal customer"""
    if request.method == 'GET':
        queryset = PersonalCustomer.objects.all().order_by('name')
        search = request.query_params.get('search', None)
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(phone__icontains=search) | Q(email__icontains=search))
        serializer = PersonalCustomerSerializer(queryset, many=True)
        return Response(serializer.data)
    else:
        serializer = PersonalCustomerSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def personal_customer_detail(request, pk):
    """Retrieve, update or delete a personal customer"""
    customer = get_object_or_404(PersonalCustomer, pk=pk)
    
    if request.method == 'GET':
        serializer = PersonalCustomerSerializer(customer)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = PersonalCustomerSerializer(customer, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = PersonalCustomerSerializer(customer, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        customer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Personal Ledger views (Admin only)
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def personal_ledger_entry_list_create(request):
    """List all personal ledger entries or create a new entry (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access personal ledger'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        queryset = PersonalLedgerEntry.objects.select_related('customer', 'created_by').all()
        customer_id = request.query_params.get('customer', None)
        customer_group_id = request.query_params.get('customer_group', None)
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        entry_type = request.query_params.get('entry_type', None)
        search = request.query_params.get('search', None)
        store_id = request.query_params.get('store', None)
        
        # Note: Personal ledger doesn't have invoice/store relationship, but we keep store param for consistency
        # Store filtering is not applicable for personal ledger
        # Personal customers don't have customer groups
        
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)
        # Skip customer_group_id filter as personal customers don't have groups
        if date_from or date_to:
            from django.db.models import Q
            # Build date filter: include entries with None created_at OR entries within date range
            date_filter = Q()
            if date_from and date_to:
                # Both dates specified: include None OR entries within range
                date_filter = Q(created_at__isnull=True) | (Q(created_at__date__gte=date_from) & Q(created_at__date__lte=date_to))
            elif date_from:
                # Only from date: include None OR entries >= date_from
                date_filter = Q(created_at__isnull=True) | Q(created_at__date__gte=date_from)
            elif date_to:
                # Only to date: include None OR entries <= date_to
                date_filter = Q(created_at__isnull=True) | Q(created_at__date__lte=date_to)
            queryset = queryset.filter(date_filter)
        if entry_type:
            queryset = queryset.filter(entry_type=entry_type)
        if search:
            queryset = queryset.filter(
                Q(customer__name__icontains=search) |
                Q(customer__phone__icontains=search) |
                Q(description__icontains=search)
            )
        
        # Order by created_at (None values will be sorted last)
        queryset = queryset.order_by('-created_at', '-id')
        serializer = PersonalLedgerEntrySerializer(queryset, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = PersonalLedgerEntrySerializer(data=request.data)
        if serializer.is_valid():
            # Handle custom date if provided, otherwise use current time
            from django.utils import timezone
            entry = serializer.save(created_by=request.user)
            # Set created_at if not provided (defaults to now)
            if not entry.created_at:
                entry.created_at = timezone.now()
                entry.save(update_fields=['created_at'])
            
            # Update customer credit_balance based on entry type
            if entry.customer:
                if entry.entry_type == 'credit':
                    entry.customer.credit_balance += entry.amount
                elif entry.entry_type == 'debit':
                    entry.customer.credit_balance -= entry.amount
                entry.customer.save()
            
            return Response(PersonalLedgerEntrySerializer(entry).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def personal_ledger_summary(request):
    """Get personal ledger summary: Total Credit, Total Debit, Number of Accounts (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access personal ledger'}, status=status.HTTP_403_FORBIDDEN)
    store_id = request.query_params.get('store', None)
    
    # Base queryset - Personal ledger doesn't have store relationship
    # Store param is kept for API consistency but not used
    base_queryset = PersonalLedgerEntry.objects.all()
    
    total_credit = base_queryset.filter(entry_type='credit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    
    total_debit = base_queryset.filter(entry_type='debit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    
    # Count unique personal customers with personal ledger entries
    num_accounts = PersonalCustomer.objects.filter(personal_ledger_entries__isnull=False).distinct().count()
    
    return Response({
        'total_credit': str(total_credit),
        'total_debit': str(total_debit),
        'num_accounts': num_accounts,
        'balance': str(total_credit - total_debit)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def personal_ledger_customer_detail(request, customer_id):
    """Get personal ledger entries for a specific customer with running balance (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access personal ledger'}, status=status.HTTP_403_FORBIDDEN)
    customer = get_object_or_404(PersonalCustomer, pk=customer_id)
    store_id = request.query_params.get('store', None)
    
    # Base queryset for this customer
    entries = PersonalLedgerEntry.objects.filter(customer=customer).select_related('customer', 'created_by')
    
    # Store filtering is not applicable for personal ledger, but we keep param for consistency
    
    entries = entries.order_by('created_at')
    
    serializer = PersonalLedgerEntrySerializer(entries, many=True)
    entries_data = serializer.data
    
    # Calculate running balance
    running_balance = Decimal('0.00')
    for entry in entries_data:
        if entry['entry_type'] == 'credit':
            running_balance += Decimal(str(entry['amount']))
        else:
            running_balance -= Decimal(str(entry['amount']))
        entry['running_balance'] = str(running_balance)
    
    return Response({
        'customer': {
            'id': customer.id,
            'name': customer.name,
            'phone': customer.phone,
        },
        'entries': entries_data,
        'final_balance': str(running_balance)
    })


# Internal Ledger views (Admin only)
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def internal_customer_list_create(request):
    """List all internal customers or create a new internal customer (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == 'GET':
        search = request.query_params.get('search', None)
        queryset = InternalCustomer.objects.all()
        
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(phone__icontains=search) |
                Q(email__icontains=search)
            )
        
        queryset = queryset.order_by('name')
        serializer = InternalCustomerSerializer(queryset, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = InternalCustomerSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def internal_customer_detail(request, pk):
    """Retrieve, update or delete an internal customer (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    customer = get_object_or_404(InternalCustomer, pk=pk)
    
    if request.method == 'GET':
        serializer = InternalCustomerSerializer(customer)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = InternalCustomerSerializer(customer, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = InternalCustomerSerializer(customer, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        customer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def internal_ledger_entry_list_create(request):
    """List all internal ledger entries or create a new entry (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == 'GET':
        queryset = InternalLedgerEntry.objects.select_related('customer', 'created_by').all()
        customer_id = request.query_params.get('customer', None)
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        entry_type = request.query_params.get('entry_type', None)
        search = request.query_params.get('search', None)
        
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)
        if date_from or date_to:
            date_filter = Q()
            if date_from and date_to:
                date_filter = Q(created_at__isnull=True) | (Q(created_at__date__gte=date_from) & Q(created_at__date__lte=date_to))
            elif date_from:
                date_filter = Q(created_at__isnull=True) | Q(created_at__date__gte=date_from)
            elif date_to:
                date_filter = Q(created_at__isnull=True) | Q(created_at__date__lte=date_to)
            queryset = queryset.filter(date_filter)
        if entry_type:
            queryset = queryset.filter(entry_type=entry_type)
        if search:
            queryset = queryset.filter(
                Q(customer__name__icontains=search) |
                Q(customer__phone__icontains=search) |
                Q(description__icontains=search)
            )
        
        queryset = queryset.order_by('-created_at', '-id')
        serializer = InternalLedgerEntrySerializer(queryset, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = InternalLedgerEntrySerializer(data=request.data)
        if serializer.is_valid():
            from django.utils import timezone
            entry = serializer.save(created_by=request.user)
            if not entry.created_at:
                entry.created_at = timezone.now()
                entry.save(update_fields=['created_at'])
            
            # Update customer credit_balance based on entry type
            if entry.customer:
                if entry.entry_type == 'credit':
                    entry.customer.credit_balance += entry.amount
                elif entry.entry_type == 'debit':
                    entry.customer.credit_balance -= entry.amount
                entry.customer.save()
            
            return Response(InternalLedgerEntrySerializer(entry).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def internal_ledger_summary(request):
    """Get internal ledger summary: Total Credit, Total Debit, Number of Accounts (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    base_queryset = InternalLedgerEntry.objects.all()
    
    total_credit = base_queryset.filter(entry_type='credit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    
    total_debit = base_queryset.filter(entry_type='debit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    
    num_accounts = InternalCustomer.objects.filter(internal_ledger_entries__isnull=False).distinct().count()
    
    return Response({
        'total_credit': str(total_credit),
        'total_debit': str(total_debit),
        'num_accounts': num_accounts,
        'balance': str(total_credit - total_debit)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def internal_ledger_customer_detail(request, customer_id):
    """Get internal ledger entries for a specific customer with running balance (Admin only)"""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    customer = get_object_or_404(InternalCustomer, pk=customer_id)
    
    entries = InternalLedgerEntry.objects.filter(customer=customer).select_related('customer', 'created_by')
    entries = entries.order_by('created_at')
    
    serializer = InternalLedgerEntrySerializer(entries, many=True)
    entries_data = serializer.data
    
    # Calculate running balance
    running_balance = Decimal('0.00')
    for entry in entries_data:
        if entry['entry_type'] == 'credit':
            running_balance += Decimal(str(entry['amount']))
        else:
            running_balance -= Decimal(str(entry['amount']))
        entry['running_balance'] = str(running_balance)
    
    return Response({
        'customer': {
            'id': customer.id,
            'name': customer.name,
            'phone': customer.phone,
        },
        'entries': entries_data,
        'final_balance': str(running_balance)
    })
