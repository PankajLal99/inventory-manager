from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Sum, Count, F, Case, When, Value, Subquery, OuterRef
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from datetime import date, datetime
from calendar import monthrange
from decimal import Decimal
from .models import Customer, CustomerGroup, Supplier, LedgerEntry, PersonalCustomer, PersonalLedgerEntry, InternalCustomer, InternalLedgerEntry, PaymentReminder
from .serializers import CustomerSerializer, CustomerGroupSerializer, SupplierSerializer, LedgerEntrySerializer, PersonalCustomerSerializer, PersonalLedgerEntrySerializer, InternalCustomerSerializer, InternalLedgerEntrySerializer, PaymentReminderSerializer


def _credit_invoice_plus_manual_payment_filter():
    """Credit-ledger view = invoices moved to ledger (status=credit) + manual received payments.
    Pending invoices do not affect ledger until user does 'Move to Ledger' (mark credit)."""
    return Q(invoice__status='credit') | Q(invoice__isnull=True, entry_type='credit')


def _exclude_repair_group_entries(queryset):
    """Exclude ledger entries belonging to customers in Repair group."""
    return queryset.filter(
        Q(customer__isnull=True) | ~Q(customer__customer_group__name__iexact='Repair')
    )


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


def is_retail_admin_user(user):
    """Retail managers: same app nav as Retail but elevated (e.g. Payments delete)."""
    return 'RetailAdmin' in set(user.groups.values_list('name', flat=True))


def can_view_manual_payments_ledger(user):
    """
    Whether a non-admin may GET /ledger/entries/?manual_only=true (Payments page).

    Must stay aligned with frontend nav for Payments (Admin, RetailAdmin, Retail).
    Admins use is_admin_user() and bypass this.
    """
    names = set(user.groups.values_list('name', flat=True))
    return bool(names & {'Retail', 'RetailAdmin'})


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


def _set_no_cache_headers(response):
    """Set headers so the response is not stored in browser disk or memory cache."""
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'


# Customer views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def customer_list_create(request):
    """List all customers or create a new customer"""
    if request.method == 'GET':
        search = request.query_params.get('search', None)
        customer_group = request.query_params.get('customer_group', None)
        exclude_group = request.query_params.get('exclude_group', None)
        exclude_group_name = request.query_params.get('exclude_group_name', None)
        
        # Try cache first
        from backend.core.model_cache import get_customer_list_cache_key, CUSTOMER_LIST_CACHE_TTL
        # Incorporate exclude_group into cache key
        cache_key = (
            f"{get_customer_list_cache_key(search or '', customer_group or '')}"
            f"_excl_{exclude_group or ''}_excl_name_{(exclude_group_name or '').strip().lower()}"
        )
        cached_data = cache.get(cache_key)
        if cached_data:
            response = Response(cached_data)
            _set_no_cache_headers(response)
            return response
        
        # Cache miss - fetch from database
        queryset = Customer.objects.all().order_by('-created_at')
        if search:
            search_clean = search.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(phone__icontains=search) |
                Q(phone__icontains=search_clean) |
                Q(email__icontains=search)
            )
        if customer_group:
            queryset = queryset.filter(customer_group_id=customer_group)
        if exclude_group:
            queryset = queryset.exclude(customer_group_id=exclude_group)
        if exclude_group_name:
            queryset = queryset.exclude(customer_group__name__iexact=exclude_group_name.strip())
        queryset = queryset[:100]  # Limit results for search performance
        serializer = CustomerSerializer(queryset, many=True)
        response_data = serializer.data
        
        # Cache the result
        cache.set(cache_key, response_data, CUSTOMER_LIST_CACHE_TTL)
        
        response = Response(response_data)
        _set_no_cache_headers(response)
        return response
    else:
        serializer = CustomerSerializer(data=request.data)
        if serializer.is_valid():
            customer = serializer.save()
            from backend.core.model_cache import invalidate_customer_cache
            invalidate_customer_cache(customer)  # clears list cache so new customer appears
            # Ledger account is auto-created implicitly through the model relationship
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
            from backend.core.model_cache import invalidate_customer_cache
            invalidate_customer_cache(customer)  # clears detail + list cache
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = CustomerSerializer(customer, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            from backend.core.model_cache import invalidate_customer_cache
            invalidate_customer_cache(customer)  # clears detail + list cache
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        from backend.core.model_cache import invalidate_customer_cache
        invalidate_customer_cache(customer)
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


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def payment_reminder_list_create(request):
    """List payment reminders or create a new reminder."""
    if request.method == 'GET':
        queryset = PaymentReminder.objects.select_related('customer', 'customer__customer_group').all()
        search = request.query_params.get('search')
        customer_group = request.query_params.get('customer_group')
        customer_id = request.query_params.get('customer')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        month = request.query_params.get('month')
        include_settled = request.query_params.get('include_settled', 'false').lower() == 'true'

        if not include_settled:
            queryset = queryset.filter(is_settled=False)

        if search:
            queryset = queryset.filter(
                Q(customer__name__icontains=search) |
                Q(customer__phone__icontains=search) |
                Q(customer__email__icontains=search)
            )
        if customer_group:
            queryset = queryset.filter(customer__customer_group_id=customer_group)
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)
        if date_from:
            queryset = queryset.filter(due_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(due_date__lte=date_to)
        if month:
            try:
                month_start = datetime.strptime(f"{month}-01", "%Y-%m-%d").date()
                month_end = date(month_start.year, month_start.month, monthrange(month_start.year, month_start.month)[1])
                queryset = queryset.filter(due_date__gte=month_start, due_date__lte=month_end)
            except ValueError:
                return Response({'error': 'Invalid month format. Use YYYY-MM.'}, status=status.HTTP_400_BAD_REQUEST)

        queryset = queryset.order_by('due_date', 'customer__name')
        serializer = PaymentReminderSerializer(queryset, many=True)
        return Response(serializer.data)

    else:
        serializer = PaymentReminderSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def payment_reminder_detail(request, reminder_id):
    """Retrieve, update, or delete a payment reminder."""
    reminder = get_object_or_404(PaymentReminder, pk=reminder_id)
    if request.method == 'GET':
        return Response(PaymentReminderSerializer(reminder).data)
    if request.method == 'PATCH':
        serializer = PaymentReminderSerializer(reminder, data=request.data, partial=True)
        if serializer.is_valid():
            updated_reminder = serializer.save()
            if updated_reminder.is_settled and not updated_reminder.settled_at:
                from django.utils import timezone
                updated_reminder.settled_at = timezone.now()
                updated_reminder.save(update_fields=['settled_at'])
            if not updated_reminder.is_settled and (updated_reminder.settled_at or updated_reminder.settled_payment_id):
                updated_reminder.settled_at = None
                updated_reminder.settled_payment = None
                updated_reminder.save(update_fields=['settled_at', 'settled_payment'])
            return Response(PaymentReminderSerializer(updated_reminder).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    reminder.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_reminder_calendar(request):
    """Calendar data for payment reminders with customer/date/group filters."""
    month_param = request.query_params.get('month')
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    search = request.query_params.get('search')
    customer_group = request.query_params.get('customer_group')

    today = date.today()
    if month_param:
        try:
            month_start = datetime.strptime(f"{month_param}-01", "%Y-%m-%d").date()
        except ValueError:
            return Response({'error': 'Invalid month format. Use YYYY-MM.'}, status=status.HTTP_400_BAD_REQUEST)
    else:
        month_start = date(today.year, today.month, 1)

    month_end = date(month_start.year, month_start.month, monthrange(month_start.year, month_start.month)[1])
    visible_start = month_start
    visible_end = month_end

    if date_from:
        try:
            from_date = datetime.strptime(date_from, "%Y-%m-%d").date()
        except ValueError:
            return Response({'error': 'Invalid date_from format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
        if from_date > visible_start:
            visible_start = from_date

    if date_to:
        try:
            to_date = datetime.strptime(date_to, "%Y-%m-%d").date()
        except ValueError:
            return Response({'error': 'Invalid date_to format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
        if to_date < visible_end:
            visible_end = to_date

    if visible_start > visible_end:
        return Response({'error': 'date_from cannot be greater than date_to.'}, status=status.HTTP_400_BAD_REQUEST)

    customers_qs = Customer.objects.select_related('customer_group').all()
    if search:
        customers_qs = customers_qs.filter(
            Q(name__icontains=search) |
            Q(phone__icontains=search) |
            Q(email__icontains=search)
        )
    if customer_group:
        customers_qs = customers_qs.filter(customer_group_id=customer_group)

    # Match Ledger (Vyapaar) "Credit Only" behavior:
    # use only credit-invoice ledger entries and compute due as debit - credit.
    ledger_grouped = LedgerEntry.objects.filter(
        customer__in=customers_qs,
        customer__isnull=False,
    ).filter(
        _credit_invoice_plus_manual_payment_filter()
    ).values('customer').annotate(
        total_credit=Sum(Case(When(entry_type='credit', then=F('amount')), default=Value(Decimal('0.00')))),
        total_debit=Sum(Case(When(entry_type='debit', then=F('amount')), default=Value(Decimal('0.00')))),
    )

    outstanding_by_customer = {}
    eligible_customer_ids = []
    for row in ledger_grouped:
        total_credit = row.get('total_credit') or Decimal('0.00')
        total_debit = row.get('total_debit') or Decimal('0.00')
        outstanding = total_debit - total_credit
        if outstanding > 0:
            customer_id = row['customer']
            eligible_customer_ids.append(customer_id)
            outstanding_by_customer[customer_id] = outstanding

    customers_qs = customers_qs.filter(id__in=eligible_customer_ids).order_by('name')

    reminders_qs = PaymentReminder.objects.select_related('customer', 'customer__customer_group').filter(
        customer__in=customers_qs,
        due_date__gte=visible_start,
        due_date__lte=visible_end,
        is_settled=False,
    )

    reminders = list(reminders_qs)
    reminders_by_customer = {}
    for reminder in reminders:
        key = reminder.customer_id
        due_key = reminder.due_date.isoformat()
        if key not in reminders_by_customer:
            reminders_by_customer[key] = {}
        outstanding_amount = outstanding_by_customer.get(key, Decimal('0.00'))
        if outstanding_amount <= 0:
            continue
        existing = reminders_by_customer[key].get(due_key, Decimal('0.00'))
        # Show outstanding ledger amount on each due date cell.
        reminders_by_customer[key][due_key] = outstanding_amount if outstanding_amount > existing else existing

    # If customer has ledger outstanding but no reminder in visible range,
    # place the amount on a fallback day so it is visible in calendar.
    fallback_day = today if visible_start <= today <= visible_end else visible_start
    fallback_day_key = fallback_day.isoformat()
    for customer_id in eligible_customer_ids:
        if outstanding_by_customer.get(customer_id, Decimal('0.00')) <= 0:
            continue
        customer_days = reminders_by_customer.setdefault(customer_id, {})
        if customer_days:
            continue
        customer_days[fallback_day_key] = outstanding_by_customer[customer_id]

    days = []
    cursor = visible_start
    while cursor <= visible_end:
        days.append(cursor.isoformat())
        cursor = cursor.fromordinal(cursor.toordinal() + 1)

    customers = []
    total_due = Decimal('0.00')
    for customer in customers_qs:
        daily_totals = reminders_by_customer.get(customer.id, {})
        customer_total = outstanding_by_customer.get(customer.id, Decimal('0.00'))
        total_due += customer_total
        customers.append({
            'id': customer.id,
            'name': customer.name,
            'customer_group': customer.customer_group_id,
            'customer_group_name': customer.customer_group.name if customer.customer_group else '',
            'daily_totals': {k: str(v) for k, v in daily_totals.items()},
            'total_due': str(customer_total),
        })

    reminder_data = PaymentReminderSerializer(reminders, many=True).data
    return Response({
        'month': month_start.strftime('%Y-%m'),
        'month_start': visible_start.isoformat(),
        'month_end': visible_end.isoformat(),
        'calendar_month_start': month_start.isoformat(),
        'calendar_month_end': month_end.isoformat(),
        'days': days,
        'total_due': str(total_due),
        'customers_count': len(customers),
        'customers': customers,
        'reminders': reminder_data,
    })


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


def _ledger_entries_base_queryset(request):
    """Build base LedgerEntry queryset from request query params (same filters as list view)."""
    queryset = _exclude_repair_group_entries(LedgerEntry.objects.all())
    customer_id = request.query_params.get('customer', None)
    customer_group_id = request.query_params.get('customer_group', None)
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    entry_type = request.query_params.get('entry_type', None)
    payment_mode = request.query_params.get('payment_mode', None)
    search = request.query_params.get('search', None)
    store_id = request.query_params.get('store', None)
    invoice_status = request.query_params.get('invoice_status', None)
    manual_only = (request.query_params.get('manual_only') or '').strip().lower() in {'1', 'true', 'yes'}

    # Ledger views should include:
    # - all invoice-linked entries
    # - manual entries only when marked as sent
    # Payments page passes manual_only=true and needs unsent rows visible there.
    if not manual_only:
        queryset = queryset.filter(
            Q(invoice__isnull=False) | Q(invoice__isnull=True, is_sent=True)
        )

    if invoice_status:
        if invoice_status == 'credit':
            queryset = queryset.filter(_credit_invoice_plus_manual_payment_filter())
        else:
            queryset = queryset.filter(invoice__status=invoice_status)
    if store_id:
        queryset = queryset.filter(
            Q(invoice__store_id=store_id) | Q(invoice__isnull=True)
        )
    if customer_id:
        queryset = queryset.filter(customer_id=customer_id)
    if customer_group_id:
        queryset = queryset.filter(customer__customer_group_id=customer_group_id)
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
    if payment_mode:
        queryset = queryset.filter(payment_mode=payment_mode)
    if manual_only:
        queryset = queryset.filter(invoice__isnull=True)
    if search:
        queryset = queryset.filter(
            Q(customer__name__icontains=search) |
            Q(customer__phone__icontains=search) |
            Q(description__icontains=search) |
            Q(invoice__invoice_number__icontains=search)
        )
    return queryset


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ledger_by_customer(request):
    """Get ledger entries aggregated by customer (Admin only). Returns one row per customer with totals.
    Use this for credit-only view to avoid loading all entries; supports same filters as entries list."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
    base = _ledger_entries_base_queryset(request)
    latest_desc = base.filter(customer_id=OuterRef('customer')).order_by('-created_at', '-id').values('description')[:1]
    grouped = base.values('customer', 'customer__name', 'customer__customer_group__name').annotate(
        total_credit=Sum(Case(When(entry_type='credit', then=F('amount')), default=Value(Decimal('0')))),
        total_debit=Sum(Case(When(entry_type='debit', then=F('amount')), default=Value(Decimal('0')))),
        entry_count=Count('id'),
        latest_description=Subquery(latest_desc)
    ).order_by('customer__name')
    out = []
    for row in grouped:
        total_credit = row['total_credit'] or Decimal('0.00')
        total_debit = row['total_debit'] or Decimal('0.00')
        net = total_credit - total_debit
        out.append({
            'customer_id': row['customer'],
            'customer_name': row['customer__name'] or 'Anonymous',
            'customer_group_name': row['customer__customer_group__name'] or '',
            'total_credit': str(total_credit),
            'total_debit': str(total_debit),
            'net_amount': str(net),
            'entry_count': row['entry_count'],
            'latest_description': row['latest_description'] or '',
        })
    return Response(out)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def ledger_entry_list_create(request):
    """List ledger entries; create is Admin-only.

    Non-admin users are allowed read-only access ONLY for manual payments view
    (`manual_only=true`), which is used by the Payments page.
    """
    is_admin = is_admin_user(request.user)
    if not is_admin:
        if request.method != 'GET':
            return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
        manual_only = (request.query_params.get('manual_only') or '').strip().lower() in {'1', 'true', 'yes'}
        if not manual_only:
            return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
        if not can_view_manual_payments_ledger(request.user):
            return Response({'error': 'You do not have permission to view manual payments'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        queryset = _exclude_repair_group_entries(
            LedgerEntry.objects.select_related('customer', 'customer__customer_group', 'invoice', 'created_by').all()
        )
        customer_id = request.query_params.get('customer', None)
        customer_group_id = request.query_params.get('customer_group', None)
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        entry_type = request.query_params.get('entry_type', None)
        payment_mode = request.query_params.get('payment_mode', None)
        search = request.query_params.get('search', None)
        store_id = request.query_params.get('store', None)
        invoice_status = request.query_params.get('invoice_status', None)
        manual_only = (request.query_params.get('manual_only') or '').strip().lower() in {'1', 'true', 'yes'}

        # For ledger screens (manual_only=false), show only sent manual entries.
        if not manual_only:
            queryset = queryset.filter(
                Q(invoice__isnull=False) | Q(invoice__isnull=True, is_sent=True)
            )
        
        # Filter by invoice status if provided (only show entries from invoices with this status)
        if invoice_status:
            if invoice_status == 'credit':
                queryset = queryset.filter(_credit_invoice_plus_manual_payment_filter())
            else:
                queryset = queryset.filter(invoice__status=invoice_status)
        
        # Filter by store if provided (through invoice relationship)
        if store_id:
            queryset = queryset.filter(
                Q(invoice__store_id=store_id) | Q(invoice__isnull=True)
            )
        
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)
        if customer_group_id:
            queryset = queryset.filter(customer__customer_group_id=customer_group_id)
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
        if payment_mode:
            queryset = queryset.filter(payment_mode=payment_mode)
        if manual_only:
            queryset = queryset.filter(invoice__isnull=True)
        if search:
            queryset = queryset.filter(
                Q(customer__name__icontains=search) |
                Q(customer__phone__icontains=search) |
                Q(description__icontains=search) |
                Q(invoice__invoice_number__icontains=search)
            )
        
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
            
            # Manual entries should affect ledger only when sent is checked.
            # Invoice-linked entries always affect ledger balance.
            if _entry_affects_customer_balance(entry):
                _apply_ledger_entry_balance(entry)
            
            return Response(LedgerEntrySerializer(entry).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def _reverse_ledger_entry_balance(entry):
    """Reverse the effect of a ledger entry on customer credit_balance."""
    if entry.customer:
        if entry.entry_type == 'credit':
            entry.customer.credit_balance -= entry.amount
        elif entry.entry_type == 'debit':
            entry.customer.credit_balance += entry.amount
        entry.customer.save()


def _apply_ledger_entry_balance(entry):
    """Apply the effect of a ledger entry on customer credit_balance."""
    if entry.customer:
        if entry.entry_type == 'credit':
            entry.customer.credit_balance += entry.amount
        elif entry.entry_type == 'debit':
            entry.customer.credit_balance -= entry.amount
        entry.customer.save()


def _entry_affects_customer_balance(entry):
    """Invoice entries always count; manual entries count only when sent."""
    if entry.invoice_id is not None:
        return True
    return bool(entry.is_sent)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def ledger_entry_retrieve_update_destroy(request, entry_id):
    """Retrieve, update or delete a ledger entry (Admin only; RetailAdmin may GET/PATCH/DELETE manual entries only)."""
    entry = get_object_or_404(_exclude_repair_group_entries(LedgerEntry.objects.all()), pk=entry_id)
    is_admin = is_admin_user(request.user)
    retail_admin_manual = (
        not is_admin
        and is_retail_admin_user(request.user)
        and entry.invoice_id is None
    )
    if not is_admin and not retail_admin_manual:
        return Response({'error': 'Only Admin users can edit/delete ledger entries'}, status=status.HTTP_403_FORBIDDEN)
    if request.method == 'GET':
        serializer = LedgerEntrySerializer(entry)
        return Response(serializer.data)
    if request.method == 'PATCH':
        # Reverse/apply only when entry participates in customer balance.
        old_affects_balance = _entry_affects_customer_balance(entry)
        if old_affects_balance:
            _reverse_ledger_entry_balance(entry)
        partial_data = request.data
        allowed = {'entry_type', 'payment_mode', 'cash_amount', 'upi_amount', 'amount', 'description', 'created_at', 'is_sent'}
        update_data = {k: v for k, v in partial_data.items() if k in allowed}
        serializer = LedgerEntrySerializer(entry, data=update_data, partial=True)
        if serializer.is_valid():
            entry = serializer.save()
            if _entry_affects_customer_balance(entry):
                _apply_ledger_entry_balance(entry)
            return Response(LedgerEntrySerializer(entry).data)
        if old_affects_balance:
            _apply_ledger_entry_balance(entry)  # Restore on validation error
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        if _entry_affects_customer_balance(entry):
            _reverse_ledger_entry_balance(entry)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
    base_queryset = _exclude_repair_group_entries(LedgerEntry.objects.all()).filter(
        Q(invoice__isnull=False) | Q(invoice__isnull=True, is_sent=True)
    )
    
    # Filter by invoice status if provided (only show entries from invoices with this status)
    if invoice_status:
        if invoice_status == 'credit':
            base_queryset = base_queryset.filter(_credit_invoice_plus_manual_payment_filter())
        else:
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
    """Get ledger entries for a specific customer with running balance (Admin only).
    Query params: store, date_from, date_to, entry_type, search, invoice_status (e.g. 'credit')."""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
    customer = get_object_or_404(
        Customer.objects.exclude(customer_group__name__iexact='Repair'),
        pk=customer_id
    )
    store_id = request.query_params.get('store', None)
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    entry_type = request.query_params.get('entry_type', None)
    search = request.query_params.get('search', None)
    invoice_status = request.query_params.get('invoice_status', None)
    
    # Base queryset for this customer
    entries = LedgerEntry.objects.filter(customer=customer).filter(
        Q(invoice__isnull=False) | Q(invoice__isnull=True, is_sent=True)
    ).select_related('customer', 'customer__customer_group', 'invoice', 'created_by')
    
    # Filter by invoice status if provided (e.g. only entries from invoices with status='credit')
    if invoice_status:
        if invoice_status == 'credit':
            entries = entries.filter(_credit_invoice_plus_manual_payment_filter())
        else:
            entries = entries.filter(invoice__status=invoice_status)
    
    # Filter by store if provided (through invoice relationship)
    if store_id:
        entries = entries.filter(
            Q(invoice__store_id=store_id) | Q(invoice__isnull=True)
        )
    if date_from or date_to:
        date_filter = Q()
        if date_from and date_to:
            date_filter = Q(created_at__isnull=True) | (Q(created_at__date__gte=date_from) & Q(created_at__date__lte=date_to))
        elif date_from:
            date_filter = Q(created_at__isnull=True) | Q(created_at__date__gte=date_from)
        elif date_to:
            date_filter = Q(created_at__isnull=True) | Q(created_at__date__lte=date_to)
        entries = entries.filter(date_filter)
    if entry_type:
        entries = entries.filter(entry_type=entry_type)
    if search:
        entries = entries.filter(
            Q(description__icontains=search) | Q(invoice__invoice_number__icontains=search)
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
    
    from backend.pos.models import Invoice, InvoiceItem
    pending_invoices = Invoice.objects.filter(
        customer=customer,
        invoice_type='pending',
    ).exclude(
        status='void'
    )
    if store_id:
        pending_invoices = pending_invoices.filter(store_id=store_id)
    if date_from:
        pending_invoices = pending_invoices.filter(created_at__date__gte=date_from)
    if date_to:
        pending_invoices = pending_invoices.filter(created_at__date__lte=date_to)
    pending_total = Decimal('0.00')
    for inv in pending_invoices:
        invoice_total = inv.total or Decimal('0.00')
        if invoice_total > 0:
            pending_total += invoice_total
            continue

        # Fallback when invoice total is missing/zero:
        # sum product purchase value = qty * COALESCE(barcode.purchase_item.unit_price, invoice_item.purchase_price, 0)
        item_total = InvoiceItem.objects.filter(invoice=inv).aggregate(
            total=Sum(
                Case(
                    When(
                        barcode__purchase_item__unit_price__isnull=False,
                        then=F('barcode__purchase_item__unit_price') * F('quantity'),
                    ),
                    When(
                        purchase_price__isnull=False,
                        then=F('purchase_price') * F('quantity'),
                    ),
                    default=Value(Decimal('0.00')),
                )
            )
        )['total'] or Decimal('0.00')
        pending_total += item_total

    return Response({
        'customer': {
            'id': customer.id,
            'name': customer.name,
            'phone': customer.phone,
        },
        'entries': entries_data,
        'final_balance': str(running_balance),
        'pending_invoice_total': str(pending_total),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def ledger_customer_invoice_items_by_category(request, customer_id):
    """Get count of invoice items (products sold) by category for a ledger customer (Admin only).
    Query params: store (optional), categories (optional comma-separated category ids),
    date_from (optional YYYY-MM-DD), date_to (optional YYYY-MM-DD).
    When categories are provided, returns total_count and by_category for those categories only."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access ledger'}, status=status.HTTP_403_FORBIDDEN)
    from backend.pos.models import InvoiceItem

    customer = get_object_or_404(Customer, pk=customer_id)
    store_id = request.query_params.get('store', None)
    categories_param = request.query_params.get('categories', None)
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    category_ids = None
    if categories_param:
        try:
            category_ids = [int(x.strip()) for x in categories_param.split(',') if x.strip()]
        except ValueError:
            pass

    # Invoice items for this customer's invoices (exclude void)
    qs = InvoiceItem.objects.filter(
        invoice__customer=customer
    ).exclude(
        invoice__status='void'
    ).select_related('product', 'product__category')

    if store_id:
        qs = qs.filter(invoice__store_id=store_id)

    if date_from:
        qs = qs.filter(invoice__created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(invoice__created_at__date__lte=date_to)

    if category_ids is not None and len(category_ids) > 0:
        qs = qs.filter(product__category_id__in=category_ids)

    # Total count = sum of quantities
    total_result = qs.aggregate(total=Sum('quantity'))
    total_count = int(total_result['total'] or 0)

    # By category: group by category
    by_category_qs = qs.values('product__category_id', 'product__category__name').annotate(
        count=Sum('quantity')
    ).order_by('product__category__name')

    by_category = []
    for row in by_category_qs:
        cat_id = row['product__category_id']
        cat_name = row['product__category__name'] or 'Uncategorized'
        by_category.append({
            'id': cat_id,
            'name': cat_name,
            'count': int(row['count'] or 0),
        })

    return Response({
        'total_count': total_count,
        'by_category': by_category,
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


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def personal_ledger_entry_retrieve_update_destroy(request, entry_id):
    """Retrieve, update or delete a personal ledger entry (Admin only)."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can edit/delete personal ledger entries'}, status=status.HTTP_403_FORBIDDEN)
    entry = get_object_or_404(PersonalLedgerEntry, pk=entry_id)
    if request.method == 'GET':
        serializer = PersonalLedgerEntrySerializer(entry)
        return Response(serializer.data)
    if request.method == 'PATCH':
        _reverse_ledger_entry_balance(entry)
        partial_data = request.data
        allowed = {'entry_type', 'amount', 'description', 'created_at'}
        update_data = {k: v for k, v in partial_data.items() if k in allowed}
        serializer = PersonalLedgerEntrySerializer(entry, data=update_data, partial=True)
        if serializer.is_valid():
            entry = serializer.save()
            _apply_ledger_entry_balance(entry)
            return Response(PersonalLedgerEntrySerializer(entry).data)
        _apply_ledger_entry_balance(entry)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        _reverse_ledger_entry_balance(entry)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
    """Get personal ledger entries for a specific customer with running balance (Admin only).
    Query params: date_from, date_to, entry_type, search."""
    # Check Admin permission
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access personal ledger'}, status=status.HTTP_403_FORBIDDEN)
    customer = get_object_or_404(PersonalCustomer, pk=customer_id)
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    entry_type = request.query_params.get('entry_type', None)
    search = request.query_params.get('search', None)
    
    entries = PersonalLedgerEntry.objects.filter(customer=customer).select_related('customer', 'created_by')
    
    if date_from or date_to:
        date_filter = Q()
        if date_from and date_to:
            date_filter = Q(created_at__isnull=True) | (Q(created_at__date__gte=date_from) & Q(created_at__date__lte=date_to))
        elif date_from:
            date_filter = Q(created_at__isnull=True) | Q(created_at__date__gte=date_from)
        elif date_to:
            date_filter = Q(created_at__isnull=True) | Q(created_at__date__lte=date_to)
        entries = entries.filter(date_filter)
    if entry_type:
        entries = entries.filter(entry_type=entry_type)
    if search:
        entries = entries.filter(Q(description__icontains=search))
    
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


# Internal Ledger views (Admin only) - show customers whose name contains "MT SHOP"
INTERNAL_LEDGER_GROUP_NAME = 'MTSHOP'
INTERNAL_LEDGER_NAME_CONTAINS = 'MT SHOP'


def _get_mtshop_group():
    """Return CustomerGroup with name MTSHOP, or None if it does not exist."""
    return CustomerGroup.objects.filter(name=INTERNAL_LEDGER_GROUP_NAME).first()


def _internal_ledger_customer_filter():
    """Q filter for customers included in internal ledger (name contains MT SHOP)."""
    return Q(customer__name__icontains=INTERNAL_LEDGER_NAME_CONTAINS)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def internal_customer_list_create(request):
    """List Customers in MTSHOP group or create one (Admin only). Uses Customer model only."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == 'GET':
        search = request.query_params.get('search', None)
        mtshop = _get_mtshop_group()
        if not mtshop:
            return Response([])
        queryset = Customer.objects.filter(customer_group=mtshop)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(phone__icontains=search) |
                Q(email__icontains=search)
            )
        queryset = queryset.order_by('name')
        serializer = CustomerSerializer(queryset, many=True)
        return Response(serializer.data)
    else:  # POST
        mtshop = _get_mtshop_group()
        if not mtshop:
            return Response(
                {'error': f'Customer group "{INTERNAL_LEDGER_GROUP_NAME}" does not exist. Create it first.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        data = dict(request.data)
        if not data.get('customer_group'):
            data['customer_group'] = mtshop.id
        serializer = CustomerSerializer(data=data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def internal_customer_detail(request, pk):
    """Retrieve, update or delete a Customer in MTSHOP group (Admin only). Uses Customer model only."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    mtshop = _get_mtshop_group()
    if not mtshop:
        return Response({'error': 'MTSHOP group not found'}, status=status.HTTP_404_NOT_FOUND)
    customer = get_object_or_404(Customer, pk=pk, customer_group=mtshop)
    
    if request.method == 'GET':
        serializer = CustomerSerializer(customer)
        return Response(serializer.data)
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


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def internal_ledger_entry_list_create(request):
    """List internal ledger entries for MTSHOP customers only, or create a new entry (Admin only)."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == 'GET':
        queryset = InternalLedgerEntry.objects.select_related('customer', 'created_by').filter(
            _internal_ledger_customer_filter()
        )
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
            customer = serializer.validated_data.get('customer')
            if customer and INTERNAL_LEDGER_NAME_CONTAINS.upper() not in (customer.name or '').upper():
                return Response(
                    {'error': f'Customer name must contain "{INTERNAL_LEDGER_NAME_CONTAINS}" for internal ledger.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
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


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def internal_ledger_entry_retrieve_update_destroy(request, entry_id):
    """Retrieve, update or delete an internal ledger entry for MTSHOP customers only (Admin only)."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can edit/delete internal ledger entries'}, status=status.HTTP_403_FORBIDDEN)
    entry = get_object_or_404(InternalLedgerEntry, pk=entry_id)
    if entry.customer and INTERNAL_LEDGER_NAME_CONTAINS.upper() not in (entry.customer.name or '').upper():
        return Response({'error': 'Entry not in internal ledger (customer name must contain MT SHOP).'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        serializer = InternalLedgerEntrySerializer(entry)
        return Response(serializer.data)
    if request.method == 'PATCH':
        _reverse_ledger_entry_balance(entry)
        partial_data = request.data
        allowed = {'entry_type', 'amount', 'description', 'created_at'}
        update_data = {k: v for k, v in partial_data.items() if k in allowed}
        serializer = InternalLedgerEntrySerializer(entry, data=update_data, partial=True)
        if serializer.is_valid():
            entry = serializer.save()
            _apply_ledger_entry_balance(entry)
            return Response(InternalLedgerEntrySerializer(entry).data)
        _apply_ledger_entry_balance(entry)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        _reverse_ledger_entry_balance(entry)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def internal_ledger_summary(request):
    """Get internal ledger summary for customers whose name contains MT SHOP (Admin only).
    Optional query param entry_type=credit for credit-only totals."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    base_queryset = InternalLedgerEntry.objects.filter(_internal_ledger_customer_filter())
    entry_type_filter = request.query_params.get('entry_type', None)
    if entry_type_filter:
        base_queryset = base_queryset.filter(entry_type=entry_type_filter)
    total_credit = base_queryset.filter(entry_type='credit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    total_debit = base_queryset.filter(entry_type='debit').aggregate(
        total=Sum('amount')
    )['total'] or Decimal('0.00')
    num_accounts = Customer.objects.filter(
        name__icontains=INTERNAL_LEDGER_NAME_CONTAINS,
        internal_ledger_entries__isnull=False
    ).distinct().count()
    if entry_type_filter == 'credit':
        num_accounts = base_queryset.filter(customer__isnull=False).values('customer').distinct().count()
    return Response({
        'total_credit': str(total_credit),
        'total_debit': str(total_debit),
        'num_accounts': num_accounts,
        'balance': str(total_credit - total_debit)
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def internal_ledger_customer_detail(request, customer_id):
    """Get internal ledger entries for a specific customer (name must contain MT SHOP) with running balance (Admin only).
    Query params: date_from, date_to, entry_type, search."""
    if not is_admin_user(request.user):
        return Response({'error': 'Only Admin users can access internal ledger'}, status=status.HTTP_403_FORBIDDEN)
    customer = get_object_or_404(Customer, pk=customer_id)
    if INTERNAL_LEDGER_NAME_CONTAINS.upper() not in (customer.name or '').upper():
        return Response({'error': 'Customer name must contain MT SHOP for internal ledger.'}, status=status.HTTP_404_NOT_FOUND)
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    entry_type = request.query_params.get('entry_type', None)
    search = request.query_params.get('search', None)
    
    entries = InternalLedgerEntry.objects.filter(customer=customer).select_related('customer', 'created_by')
    
    if date_from or date_to:
        date_filter = Q()
        if date_from and date_to:
            date_filter = Q(created_at__isnull=True) | (Q(created_at__date__gte=date_from) & Q(created_at__date__lte=date_to))
        elif date_from:
            date_filter = Q(created_at__isnull=True) | Q(created_at__date__gte=date_from)
        elif date_to:
            date_filter = Q(created_at__isnull=True) | Q(created_at__date__lte=date_to)
        entries = entries.filter(date_filter)
    if entry_type:
        entries = entries.filter(entry_type=entry_type)
    if search:
        entries = entries.filter(
            Q(description__icontains=search) | Q(customer__name__icontains=search) | Q(customer__phone__icontains=search)
        )
    
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
