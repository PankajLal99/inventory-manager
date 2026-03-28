from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import F, Q, Sum, Count, Case, When, Value, DecimalField, ExpressionWrapper
from django.db.models.functions import TruncDate, Coalesce
from django.conf import settings
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from collections import Counter
import uuid
from .models import POSSession, Cart, CartItem, Invoice, InvoiceItem, Payment, Return, ReturnItem, CreditNote, Repair, Expenses
from backend.catalog.models import Barcode, Product, ProductVariant
from backend.catalog.barcode_cache import invalidate_barcode_cache
from backend.inventory.models import Stock
from backend.core.utils import create_audit_log
from backend.parties.internal_ledger_utils import (
    create_internal_ledger_entry_if_mtshop,
    reverse_internal_ledger_entries_for_ledger_entries,
)
from .serializers import (
    POSSessionSerializer, CartSerializer, CartOverviewSerializer, CartItemSerializer, InvoiceSerializer,
    InvoiceItemSerializer, PaymentSerializer, ReturnSerializer, CreditNoteSerializer, CreditNoteDetailSerializer, RepairSerializer, ExpenseSerializer
)
from backend.catalog.label_generator import generate_label_image


def _get_barcode_supplier_id(barcode_obj):
    """Return supplier_id for a barcode (from its purchase), or None if no purchase."""
    if not barcode_obj:
        return None
    if barcode_obj.purchase_item and barcode_obj.purchase_item.purchase_id:
        return barcode_obj.purchase_item.purchase.supplier_id
    if getattr(barcode_obj, 'purchase_id', None):
        return barcode_obj.purchase.supplier_id if barcode_obj.purchase else None
    return None


def _with_invoice_amount_annotations(queryset):
    """
    Annotate invoices with DB-side per-invoice totals used by list pages.
    - _items_total_agg: Total column = sum of (quantity * purchase_price) — always purchase/cost.
    - _items_paid_agg: Paid column = sold line totals/rates.
    """
    money_field = DecimalField(max_digits=18, decimal_places=2)
    purchase_rate = Case(
        # For custom/other products, checkout stores purchase_price on invoice item.
        When(items__purchase_price__gt=0, then=F('items__purchase_price')),
        # For barcode-backed items, use linked purchase item unit price.
        When(items__barcode__purchase_item__unit_price__isnull=False, then=F('items__barcode__purchase_item__unit_price')),
        default=Value(Decimal('0.00')),
        output_field=money_field,
    )
    # Total column uses purchase price only (cost), not selling price.
    item_total_expr = ExpressionWrapper(
        F('items__quantity') * purchase_rate,
        output_field=money_field,
    )
    item_paid_rate = Case(
        When(items__manual_unit_price__gt=0, then=F('items__manual_unit_price')),
        default=F('items__unit_price'),
        output_field=money_field,
    )
    item_paid_expr = Case(
        When(items__line_total__gt=0, then=F('items__line_total')),
        default=ExpressionWrapper(F('items__quantity') * item_paid_rate, output_field=money_field),
        output_field=money_field,
    )
    return queryset.annotate(
        _items_count=Count('items', distinct=True),
        _items_total_agg=Coalesce(
            Sum(item_total_expr, output_field=money_field),
            Value(Decimal('0.00')),
            output_field=money_field,
        ),
        _items_paid_agg=Coalesce(
            Sum(item_paid_expr, output_field=money_field),
            Value(Decimal('0.00')),
            output_field=money_field,
        ),
    )


def annotate_invoice_list_profit(queryset, profile='invoice_list'):
    """
    Per-invoice (computed_paid - computed_total) matching InvoiceSerializer list behavior.

    profile='invoice_list': matches Invoices page (non-repair). No items -> Total 0, Paid -> total.
    profile='repair_list': matches Repairs page. No items -> Total from pending/total fallback like serializer.
    """
    money_field = DecimalField(max_digits=18, decimal_places=2)
    qs = _with_invoice_amount_annotations(queryset)
    if profile == 'repair_list':
        zero_items_profit = ExpressionWrapper(
            Case(
                When(paid_amount__gt=0, then=F('paid_amount')),
                default=F('total'),
                output_field=money_field,
            )
            - Case(
                When(invoice_type='pending', then=Value(Decimal('0.00'))),
                default=F('total'),
                output_field=money_field,
            ),
            output_field=money_field,
        )
    else:
        zero_items_profit = ExpressionWrapper(
            Case(
                When(paid_amount__gt=0, then=F('paid_amount')),
                default=F('total'),
                output_field=money_field,
            )
            - Value(Decimal('0.00')),
            output_field=money_field,
        )
    return qs.annotate(
        _list_profit=Case(
            When(
                _items_count__gt=0,
                then=ExpressionWrapper(
                    F('_items_paid_agg') - F('_items_total_agg'),
                    output_field=money_field,
                ),
            ),
            default=zero_items_profit,
            output_field=money_field,
        )
    )


def filter_repair_invoices_by_list_date(queryset, date_from, date_to):
    """Same date logic as repair_invoices_list (created_at OR repair.updated_at OR delivery_date)."""
    if date_from and date_to:
        return queryset.filter(
            Q(created_at__date__gte=date_from, created_at__date__lte=date_to)
            | Q(repair__updated_at__date__gte=date_from, repair__updated_at__date__lte=date_to)
            | Q(repair__delivery_date__gte=date_from, repair__delivery_date__lte=date_to)
        )
    if date_from:
        return queryset.filter(
            Q(created_at__date__gte=date_from)
            | Q(repair__updated_at__date__gte=date_from)
            | Q(repair__delivery_date__gte=date_from)
        )
    if date_to:
        return queryset.filter(
            Q(created_at__date__lte=date_to)
            | Q(repair__updated_at__date__lte=date_to)
            | Q(repair__delivery_date__lte=date_to)
        )
    return queryset


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def repair_invoices_list(request):
    """List all repair invoices (invoices from Repair shops with Repair records)"""
    from backend.locations.models import Store
    
    # Filter invoices from Repair shops (lowercase as per model) that have Repair records
    repair_stores = Store.objects.filter(shop_type='repair', is_active=True)
    queryset = Invoice.objects.filter(
        store__in=repair_stores,
        repair__isnull=False  # Only invoices with Repair records
    ).select_related('customer', 'store', 'created_by', 'repair').prefetch_related('items', 'items__barcode', 'payments')

    ordering_param = request.query_params.get('ordering', '-repair__updated_at')
    if ordering_param == 'created_at':
        queryset = queryset.order_by('created_at')
    else:
        queryset = queryset.order_by(ordering_param, '-created_at')

    # Filter by store only if it's a repair store (otherwise we'd filter to retail and get 0 repairs)
    store_id = request.query_params.get('store', None)
    if store_id:
        try:
            sid = int(store_id)
            if repair_stores.filter(id=sid).exists():
                queryset = queryset.filter(store_id=sid)
        except (ValueError, TypeError):
            pass

    # Filter by date range if provided (match repair date OR delivery date)
    date_from = request.query_params.get('date_from', None)
    date_to = request.query_params.get('date_to', None)
    if date_from and date_to:
        queryset = queryset.filter(
            Q(created_at__date__gte=date_from, created_at__date__lte=date_to)
            | Q(repair__updated_at__date__gte=date_from, repair__updated_at__date__lte=date_to)
            | Q(repair__delivery_date__gte=date_from, repair__delivery_date__lte=date_to)
        )
    elif date_from:
        queryset = queryset.filter(
            Q(created_at__date__gte=date_from)
            | Q(repair__updated_at__date__gte=date_from)
            | Q(repair__delivery_date__gte=date_from)
        )
    elif date_to:
        queryset = queryset.filter(
            Q(created_at__date__lte=date_to)
            | Q(repair__updated_at__date__lte=date_to)
            | Q(repair__delivery_date__lte=date_to)
        )

    # Filter by repair status if provided
    repair_status = request.query_params.get('repair_status', None)
    if repair_status:
        queryset = queryset.filter(repair__status=repair_status)
    
    # Search by repair barcode if provided
    repair_barcode = request.query_params.get('repair_barcode', None)
    if repair_barcode:
        queryset = queryset.filter(repair__barcode__icontains=repair_barcode)
    
    # Search by invoice number, customer name, repair contact, model, or barcode
    search = request.query_params.get('search', None)
    invoice_number = request.query_params.get('invoice_number', None)
    if search:
        queryset = queryset.filter(
            Q(invoice_number__icontains=search)
            | Q(customer__name__icontains=search)
            | Q(repair__contact_no__icontains=search)
            | Q(repair__model_name__icontains=search)
            | Q(repair__barcode__icontains=search)
        )
    elif invoice_number:
        queryset = queryset.filter(invoice_number__icontains=invoice_number)

    queryset = _with_invoice_amount_annotations(queryset)
    
    unpaginated_param = str(request.query_params.get('unpaginated', '')).strip().lower()
    force_unpaginated = unpaginated_param in ('1', 'true', 'yes')

    has_active_filters = any([
        date_from,
        date_to,
        repair_status,
        repair_barcode,
        search,
        invoice_number,
    ])

    # Default view stays paginated; filtered or explicitly unpaginated view returns full result set.
    if has_active_filters or force_unpaginated:
        serializer = InvoiceSerializer(
            queryset,
            many=True,
            context={'amount_profile': 'repair_list'},
        )
        return Response({
            'results': serializer.data,
            'count': len(serializer.data),
            'next': None,
            'previous': None,
            'page': 1,
            'page_size': None,
            'total_pages': 1,
        })

    # Pagination
    from django.core.paginator import Paginator
    page = int(request.query_params.get('page', 1))
    limit = int(request.query_params.get('limit', 50))
    
    paginator = Paginator(queryset, limit)
    page_obj = paginator.get_page(page)
    
    serializer = InvoiceSerializer(
        page_obj,
        many=True,
        context={'amount_profile': 'repair_list'},
    )
    return Response({
        'results': serializer.data,
        'count': paginator.count,
        'next': page_obj.next_page_number() if page_obj.has_next() else None,
        'previous': page_obj.previous_page_number() if page_obj.has_previous() else None,
        'page': page,
        'page_size': limit,
        'total_pages': paginator.num_pages,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def repair_status_choices(request):
    """Return repair status choices from the Repair model for use in dropdowns."""
    choices = [{'value': value, 'label': label} for value, label in Repair.STATUS_CHOICES]
    return Response(choices)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def repair_device_models(request):
    """Return distinct device model names from Repair records, optionally filtered by search."""
    search = (request.query_params.get('search') or '').strip()
    qs = Repair.objects.all().order_by('model_name')
    if search:
        qs = qs.filter(model_name__icontains=search)
    models = list(qs.values_list('model_name', flat=True).distinct()[:50])
    return Response({'models': models})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def find_repair_invoice_by_barcode(request):
    """Find repair invoice by repair barcode"""
    repair_barcode = request.query_params.get('repair_barcode', '').strip()
    
    if not repair_barcode:
        return Response({'error': 'repair_barcode parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        repair = Repair.objects.select_related('invoice', 'invoice__customer', 'invoice__store', 'invoice__created_by').prefetch_related('invoice__items', 'invoice__payments').get(
            barcode=repair_barcode
        )
        serializer = InvoiceSerializer(repair.invoice)
        return Response(serializer.data)
    except Repair.DoesNotExist:
        return Response({'error': 'Repair invoice not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_repair_status(request, pk):
    """Update repair status"""
    repair = get_object_or_404(Repair, invoice_id=pk)
    
    new_status = request.data.get('repair_status', None)
    if not new_status:
        return Response(
            {'error': 'repair_status is required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Validate status against model choices
    valid_statuses = [value for value, _ in Repair.STATUS_CHOICES]
    if new_status not in valid_statuses:
        return Response(
            {'error': f'repair_status must be one of: {", ".join(valid_statuses)}'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    old_status = repair.status
    repair.status = new_status
    repair.updated_by = request.user
    repair.save()
    
    # Audit log
    create_audit_log(
        request=request,
        action='repair_status_update',
        model_name='Repair',
        object_id=str(repair.id),
        object_name=f"Repair {repair.barcode}",
        object_reference=repair.barcode,
        barcode=repair.barcode,
        changes={
            'repair_status': {'old': old_status, 'new': new_status},
        }
    )
    
    serializer = RepairSerializer(repair)
    return Response(serializer.data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_repair(request, pk):
    """Update repair registration details (contact_no, model_name, description, booking_amount, delivery_date)."""
    repair = get_object_or_404(Repair, invoice_id=pk)
    allowed = ('contact_no', 'model_name', 'description', 'booking_amount', 'delivery_date')
    for key in allowed:
        if key in request.data:
            value = request.data[key]
            if key == 'booking_amount':
                if value is None or value == '':
                    setattr(repair, key, None)
                else:
                    try:
                        setattr(repair, key, Decimal(str(value)))
                    except (InvalidOperation, TypeError):
                        pass
            elif key == 'delivery_date':
                if value is None or value == '':
                    setattr(repair, key, None)
                else:
                    from datetime import datetime
                    try:
                        setattr(repair, key, datetime.strptime(value, '%Y-%m-%d').date())
                    except (ValueError, TypeError):
                        pass
            else:
                setattr(repair, key, value if value is not None else '')
    repair.updated_by = request.user
    repair.save()
    create_audit_log(
        request=request,
        action='repair_update',
        model_name='Repair',
        object_id=str(repair.id),
        object_name=f"Repair {repair.barcode}",
        object_reference=repair.barcode,
        barcode=repair.barcode,
    )
    serializer = RepairSerializer(repair)
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def generate_repair_label(request, pk):
    """Generate barcode label for a repair invoice using Azure Function (with fallback to local)"""
    from django.utils import timezone
    import logging
    
    logger = logging.getLogger(__name__)
    
    repair = get_object_or_404(Repair, invoice_id=pk)
    invoice = repair.invoice
    
    # Check if label already exists and is valid (same logic as products)
    # Valid image can be: base64 data URL (data:image/...) or blob URL (https://...)
    has_valid_image = (
        repair.label_image and 
        len(repair.label_image.strip()) > 0 and
        (repair.label_image.startswith('data:image') or 
         repair.label_image.startswith('https://'))
    )
    
    if has_valid_image:
        # If it's a blob URL, verify it's accessible (not 404)
        if repair.label_image.startswith('https://'):
            try:
                import requests
                # Check if URL is accessible (HEAD request is faster than GET)
                response = requests.head(repair.label_image, timeout=5, allow_redirects=True)
                if response.status_code == 404:
                    # URL returns 404 - need to regenerate
                    logger.warning(f"Repair label URL returns 404 for repair {repair.id}, regenerating...")
                    has_valid_image = False
                    # Clear the invalid URL so we regenerate
                    repair.label_image = ''
                    repair.save(update_fields=['label_image', 'updated_at'])
                elif response.status_code != 200:
                    # Other error (403, 500, etc.) - log but try to regenerate
                    logger.warning(f"Repair label URL returns {response.status_code} for repair {repair.id}, regenerating...")
                    has_valid_image = False
                    repair.label_image = ''
                    repair.save(update_fields=['label_image', 'updated_at'])
            except requests.exceptions.RequestException as e:
                # Network error or timeout - log but try to regenerate
                logger.warning(f"Failed to verify repair label URL for repair {repair.id}: {str(e)}, regenerating...")
                has_valid_image = False
                repair.label_image = ''
                repair.save(update_fields=['label_image', 'updated_at'])
        
        # If image is still valid (base64 or verified blob URL), return it
        if has_valid_image:
            return Response({
                'success': True,
                'label': {
                    'barcode': repair.barcode,
                    'image': repair.label_image,
                    'invoice_number': invoice.invoice_number,
                    'repair_id': repair.id
                }
            })
    
    # Get repair information
    repair_barcode = repair.barcode
    invoice_number = invoice.invoice_number
    customer_name = invoice.customer.name if invoice.customer else 'Walk-in Customer'
    model_name = repair.model_name
    contact_no = repair.contact_no
    
    # Format date to dd-mm-yyyy (same format as products)
    created_date = repair.created_at.strftime('%d-%m-%Y') if repair.created_at else ''
    
    # Create label text - use phone number and model name (not invoice number)
    label_name = model_name[:10]
    
    # Try Azure Function first (same as products)
    try:
        from backend.catalog.azure_label_service import queue_bulk_label_generation_via_azure, construct_blob_url
        
        # Prepare data in the same format as products
        # Logic: User requested amount in barcode_value.
        # We pack tracking ID and Work Desc into product_name.
        
        amount_value = str(repair.booking_amount) if repair.booking_amount else "0.00"
        display_name = f"Rs.{amount_value} | {repair.description[:30]}"
        repair_short_code = (repair_barcode.split('-')[-1] if repair_barcode else '').strip()

        repair_data = [{
            'product_name': display_name[:50],  # Tracking ID + Work Desc
            'barcode_value': repair_short_code,
            'short_code': repair_short_code or None,
            'barcode_id': repair.id,
            'vendor_name': f"{customer_name[:20]} | {repair.model_name}" if customer_name else repair.model_name,
            'purchase_date': created_date,
            'serial_number': contact_no[:10] if contact_no else None,
            'font_size_text':'18',
            'barcode_type':'repair'
        }]
        
        # Queue via Azure Function (returns blob URLs immediately)
        blob_urls = queue_bulk_label_generation_via_azure(repair_data)
        blob_url = blob_urls.get(repair.id)
        
        if blob_url:
            # Azure queued successfully - save blob URL to repair model
            # Note: Azure Function will generate the label asynchronously
            # The blob URL will be available once Azure processes it
            repair.label_image = blob_url
            repair.save(update_fields=['label_image', 'updated_at'])
            
            return Response({
                'success': True,
                'label': {
                    'barcode': repair_barcode,
                    'image': blob_url,  # Return blob URL (same as products)
                    'invoice_number': invoice_number,
                    'repair_id': repair.id
                }
            })
        else:
            # Azure not configured or failed - fallback to local generation
            logger.warning(f"Azure label generation not available for repair {repair.id}, falling back to local generation")
            raise Exception("Azure not configured")
            
    except Exception as azure_error:
        # Fallback to local generation (same as products)
        logger.info(f"Falling back to local label generation for repair {repair.id}: {str(azure_error)}")
        return Response(
            {'error': 'Failed to generate label', 'message': str(azure_error)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


def reduce_stock_for_cart_item(product, variant_id, store, quantity_to_reduce):
    """Helper function to reduce stock when item is added to cart
    
    Args:
        product: Product instance
        variant_id: Variant ID or None
        store: Store instance
        quantity_to_reduce: Decimal amount to reduce stock by
    
    Returns:
        None (updates stock in place)
    """
    if not store:
        return
    
    stock, created = Stock.objects.get_or_create(
        product=product,
        variant_id=variant_id if variant_id else None,
        store=store,
        defaults={'quantity': Decimal('0.000')}
    )
    # Use F() to ensure atomic decrement - prevents race conditions
    Stock.objects.filter(id=stock.id).update(
        quantity=F('quantity') - quantity_to_reduce
    )
    # Refresh from DB to get updated value
    stock.refresh_from_db()
    # Ensure quantity doesn't go below 0
    if stock.quantity < 0:
        stock.quantity = Decimal('0.000')
        stock.save()


def get_available_stock_for_product(product, variant=None):
    """Helper function to get available stock quantity for a product (non-tracked inventory)
    
    IMPORTANT: For non-tracked inventory products, stock is decremented when items are added to cart.
    So the stock quantity itself IS the available quantity - we don't need to subtract cart quantities.
    """
    # Get total stock quantity for this product (sum across all stores/warehouses)
    # For non-tracked products, stock is decremented when items are added to cart,
    # so the stock quantity itself represents the available quantity
    stock_query = Stock.objects.filter(product=product)
    if variant:
        stock_query = stock_query.filter(variant=variant)
    else:
        stock_query = stock_query.filter(variant__isnull=True)
    
    total_stock_quantity = sum(
        Decimal(str(entry.quantity)) for entry in stock_query
    )
    
    # Return the stock quantity directly - it already accounts for items in carts
    # because stock is decremented when items are added to cart
    return max(Decimal('0.000'), total_stock_quantity)


def validate_barcode_for_pos(barcode_obj):
    """Validate barcode can be added to POS - must have tag='new' or 'returned'
    
    Returns:
        tuple: (is_valid: bool, error_message: str or None)
    """
    if not barcode_obj:
        return False, 'Barcode not found'
    if barcode_obj.tag not in ['new', 'returned']:
        tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') else barcode_obj.tag
        return False, f'This item cannot be added as it is already {tag_display.lower()}.'
    return True, None


def validate_barcode_for_replacement(barcode_obj):
    """Validate barcode can be replaced - must have tag='sold'
    
    Returns:
        tuple: (is_valid: bool, error_message: str or None)
    """
    if not barcode_obj:
        return False, 'Barcode not found'
    if barcode_obj.tag != 'sold':
        tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') else barcode_obj.tag
        return False, f'Barcode has tag "{tag_display}" but must be "sold" for replacement. Only items with "sold" tag can be replaced.'
    return True, None


# POSSession views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def pos_session_list_create(request):
    """List all POS sessions or create a new session"""
    if request.method == 'GET':
        sessions = POSSession.objects.all()
        serializer = POSSessionSerializer(sessions, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = POSSessionSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def pos_session_detail(request, pk):
    """Retrieve, update or delete a POS session"""
    session = get_object_or_404(POSSession, pk=pk)
    
    if request.method == 'GET':
        serializer = POSSessionSerializer(session)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = POSSessionSerializer(session, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = POSSessionSerializer(session, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        session.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def pos_session_close(request, pk):
    """Close a POS session"""
    session = get_object_or_404(POSSession, pk=pk)
    session.status = 'closed'
    session.closing_cash = request.data.get('closing_cash', session.opening_cash)
    session.closed_at = timezone.now()
    session.save()
    return Response(POSSessionSerializer(session).data)


# Cart views
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def active_carts_overview(request):
    """List all active and held carts (read-only overview): which user, locked, items. Includes EDIT-* (invoice edit) carts.
    Barcodes that are already on a paid/credit invoice are excluded from display (stale cart data)."""
    carts = Cart.objects.filter(
        status__in=['active', 'held']
    ).select_related('store', 'customer', 'created_by').prefetch_related('items', 'items__product', 'items__variant').order_by('-updated_at')
    store_id = request.query_params.get('store')
    if store_id:
        try:
            carts = carts.filter(store_id=int(store_id))
        except ValueError:
            pass
    # Barcode IDs that are already on paid/credit invoices — don't show them in overview (they're sold, cart is stale)
    from backend.pos.models import InvoiceItem
    from backend.catalog.models import Barcode
    sold_barcode_ids = set(
        InvoiceItem.objects.filter(
            invoice__status__in=['paid', 'credit']
        ).exclude(barcode_id__isnull=True).values_list('barcode_id', flat=True).distinct()
    )
    serializer = CartOverviewSerializer(carts, many=True, context={'sold_barcode_ids': sold_barcode_ids})
    # Expose sold barcode display values (all string forms) so the frontend can filter consistently
    sold_barcode_display_values = []
    if sold_barcode_ids:
        seen = set()
        for short_code, barcode in Barcode.objects.filter(id__in=sold_barcode_ids).values_list('short_code', 'barcode'):
            for val in ((short_code or '').strip(), (barcode or '').strip()):
                if val and val not in seen:
                    seen.add(val)
                    sold_barcode_display_values.append(val)
    return Response({
        'carts': serializer.data,
        'sold_barcode_display_values': sold_barcode_display_values,
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def cart_list_create(request):
    """List all carts or create a new cart"""
    if request.method == 'GET':
        # If active parameter is provided, return active carts for current user
        if request.query_params.get('active') == 'true':
            # Return all active carts for the user, excluding invoice-edit carts (EDIT-* / edit-*)
            active_carts = Cart.objects.filter(
                created_by=request.user,
                status='active'
            ).exclude(cart_number__istartswith='edit-').order_by('-updated_at')
            
            # If 'single' parameter is true, return only the most recent one (backward compatibility)
            if request.query_params.get('single') == 'true':
                active_cart = active_carts.first()
                if active_cart:
                    serializer = CartSerializer(active_cart)
                    return Response(serializer.data)
                return Response({'detail': 'No active cart found'}, status=status.HTTP_404_NOT_FOUND)
            
            # Return all active carts
            serializer = CartSerializer(active_carts, many=True)
            return Response(serializer.data)
        
        carts = Cart.objects.all()
        serializer = CartSerializer(carts, many=True)
        return Response(serializer.data)
    else:  # POST
        customer_id = request.data.get('customer')
        if customer_id:
            # Check if active cart already exists for this customer
            existing_cart = Cart.objects.filter(
                customer_id=customer_id,
                status='active',
                created_by=request.user
            ).exclude(cart_number__istartswith='edit-').first()
            
            if existing_cart:
                # Return existing cart instead of creating new one
                return Response(CartSerializer(existing_cart).data, status=status.HTTP_200_OK)

        # Prepare data for serializer
        data = request.data.copy()
        
        # Default invoice_type to 'pending' for Wholesale users if not provided
        if 'invoice_type' not in data:
            is_wholesale = request.user.groups.filter(name__in=['Wholesale', 'WholesaleAdmin']).exists()
            if is_wholesale:
                data['invoice_type'] = 'pending'
        
        serializer = CartSerializer(data=data)
        if serializer.is_valid():
            # Auto-generate cart_number if not provided
            validated_data = serializer.validated_data.copy()
            if not validated_data.get('cart_number'):
                cart_number = f"CART-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
                # Ensure uniqueness
                while Cart.objects.filter(cart_number=cart_number).exists():
                    cart_number = f"CART-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
                validated_data['cart_number'] = cart_number
            cart = serializer.save(created_by=request.user, **validated_data)
            return Response(CartSerializer(cart).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def cart_detail(request, pk):
    """Retrieve, update or delete a cart"""
    try:
        cart = Cart.objects.get(pk=pk)
    except Cart.DoesNotExist:
        return Response(
            {'error': 'Cart not found', 'detail': f'Cart with id {pk} does not exist'},
            status=status.HTTP_404_NOT_FOUND
        )
    
    # For DELETE: allow if user owns the cart or is in Super group
    if request.method == 'DELETE':
        is_super = request.user.groups.filter(name='Super').exists()
        if cart.created_by != request.user and not is_super:
            return Response(
                {'error': 'Permission denied', 'detail': 'You can only delete your own carts'},
                status=status.HTTP_403_FORBIDDEN
            )
        if getattr(cart, 'locked', False):
            return Response(
                {'error': 'Cart is locked.', 'detail': 'Unlock the cart before closing or discarding it.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Barcodes already on paid/credit invoices must stay 'sold' — do not revert them when discarding
        sold_barcode_ids = set(
            InvoiceItem.objects.filter(
                invoice__status__in=['paid', 'credit']
            ).exclude(barcode_id__isnull=True).values_list('barcode_id', flat=True).distinct()
        )
        # Release all SKUs/barcodes from scanned_barcodes back to available inventory (except those already sold)
        # Also restore stock for non-tracked inventory items
        for cart_item in cart.items.all():
            # Restore stock for non-tracked inventory items
            if not cart_item.product.track_inventory and cart.store:
                stock, created = Stock.objects.get_or_create(
                    product=cart_item.product,
                    variant=cart_item.variant,
                    store=cart.store,
                    defaults={'quantity': Decimal('0.000')}
                )
                stock.quantity += cart_item.quantity
                stock.save()
            
            # Handle barcodes for tracked inventory items - restore from 'in-cart' or 'sold' to 'new'
            if cart_item.scanned_barcodes:
                for barcode_value in cart_item.scanned_barcodes:
                    if not barcode_value:
                        continue
                    b_upper = str(barcode_value).strip().upper()
                    try:
                        try:
                            barcode_obj = Barcode.objects.get(barcode=b_upper)
                        except Barcode.DoesNotExist:
                            barcode_obj = Barcode.objects.get(short_code=b_upper)
                        # Do not revert barcodes that are on a paid/credit invoice — they stay 'sold'
                        if barcode_obj.id in sold_barcode_ids:
                            continue
                        # Restore from 'in-cart' or 'sold' back to 'new' when cart is deleted
                        old_tag = barcode_obj.tag
                        if barcode_obj.tag in ['in-cart', 'sold']:
                            barcode_obj.tag = 'new'
                            barcode_obj.save(update_fields=['tag'])
                            invalidate_barcode_cache(barcode_obj)  # so next byBarcode() returns fresh data
                            # Audit log: Barcode tag changed (in-cart/sold -> new)
                            create_audit_log(
                                request=request,
                                action='barcode_tag_change',
                                model_name='Barcode',
                                object_id=str(barcode_obj.id),
                                object_name=cart_item.product.name,
                                object_reference=f"Cart #{cart.cart_number or cart.id}",
                                barcode=barcode_obj.barcode,
                                changes={
                                    'tag': {'old': old_tag, 'new': 'new'},
                                    'barcode': barcode_obj.barcode,
                                    'product_id': cart_item.product.id,
                                    'product_name': cart_item.product.name,
                                    'cart_id': cart.id,
                                    'cart_number': cart.cart_number,
                                    'context': 'cart_deleted',
                                }
                            )
                    except Barcode.DoesNotExist:
                        pass  # Barcode doesn't exist, skip
        
        cart.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    
    if request.method == 'GET':
        serializer = CartSerializer(cart)
        return Response(serializer.data)
    elif request.method == 'PUT':
        # Ensure user can only update their own carts
        if cart.created_by != request.user:
            return Response(
                {'error': 'Permission denied', 'detail': 'You can only update your own carts'},
                status=status.HTTP_403_FORBIDDEN
            )
        serializer = CartSerializer(cart, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        # Ensure user can only update their own carts
        if cart.created_by != request.user:
            return Response(
                {'error': 'Permission denied', 'detail': 'You can only update your own carts'},
                status=status.HTTP_403_FORBIDDEN
            )
        # When assigning a customer, ensure they don't already have another active cart (one cart per customer)
        new_customer_id = request.data.get('customer')
        if new_customer_id is not None:
            existing_cart = Cart.objects.filter(
                customer_id=new_customer_id,
                status='active',
                created_by=request.user
            ).exclude(pk=cart.pk).exclude(cart_number__istartswith='edit-').first()
            if existing_cart:
                return Response(
                    {
                        'error': 'This customer already has an active cart. Switch to it to continue.',
                        'existing_cart_id': existing_cart.id,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
        serializer = CartSerializer(cart, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def cart_items(request, pk):
    """Add item to cart - prevents duplicate items"""
    cart = get_object_or_404(Cart.objects.select_for_update(), pk=pk)
    if getattr(cart, 'locked', False):
        return Response(
            {'error': 'Cart is locked.', 'detail': 'Unlock the cart to add items.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Check if this is a custom product (borrowed product not in inventory)
    custom_product_name = request.data.get('custom_product_name')
    if custom_product_name:
        # Purchase price is optional on add; user can enter it inline in the cart (cost field)
        raw_purchase = request.data.get('purchase_price')
        purchase_price = None
        if raw_purchase is not None and raw_purchase != '':
            try:
                purchase_price = Decimal(str(raw_purchase))
                if purchase_price < 0:
                    return Response(
                        {'error': 'Purchase price cannot be negative.', 'purchase_price': ['Must be zero or greater.']},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if purchase_price == 0:
                    purchase_price = None
            except (TypeError, ValueError, Exception):
                return Response(
                    {'error': 'Purchase price must be a valid number.', 'purchase_price': ['Enter a valid number.']},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Handle custom product - create or get product with "Other - <Name>" format
        from backend.catalog.utils import generate_unique_sku

        product_name = f"Other - {custom_product_name.strip()}"

        # Check if product already exists
        try:
            product = Product.objects.get(name=product_name)
        except Product.DoesNotExist:
            # Create new custom product
            product = Product.objects.create(
                name=product_name,
                sku=generate_unique_sku(product_name),
                track_inventory=False,  # No inventory tracking for custom products
                can_go_below_purchase_price=True,  # Allow any price
                is_active=True
            )
            
            # Create audit log for custom product creation
            create_audit_log(
                request=request,
                action='create',
                model_name='Product',
                object_id=str(product.id),
                object_name=product.name,
                object_reference=product.sku,
                barcode=None,
                changes={'name': product.name, 'sku': product.sku, 'track_inventory': False, 'custom_product': True}
            )
        
        # For custom products, skip all validations and add directly to cart
        product_id = product.id
        variant_id = None
        
        # Get invoice type and sale price
        invoice_type = cart.invoice_type
        manual_unit_price = request.data.get('manual_unit_price')
        unit_price = request.data.get('unit_price')
        if 'manual_unit_price' in request.data:
            sale_price = manual_unit_price
        else:
            sale_price = unit_price
        
        # Check if existing cart item with same product exists
        existing_item = CartItem.objects.filter(
            cart=cart,
            product_id=product_id,
            variant__isnull=True
        ).first()
        
        requested_quantity = Decimal(str(request.data.get('quantity', 1)))
        
        # If existing item found, increment quantity
        if existing_item:
            with transaction.atomic():
                existing_item.quantity += requested_quantity
                existing_item.save(update_fields=['quantity'])
            
            # Audit log: Item quantity updated in cart (custom product)
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(existing_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=None,
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity_added': str(requested_quantity),
                    'new_quantity': str(existing_item.quantity),
                    'unit_price': str(existing_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                    'action': 'quantity_incremented',
                    'custom_product': True,
                }
            )
            
            serializer = CartItemSerializer(existing_item)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
        # Create new item for custom product (no barcodes, no stock validation)
        # purchase_price can be set later inline in cart; unit_price = cost when set, else 0
        item_data = request.data.copy()
        item_data['product'] = product_id
        item_data['scanned_barcodes'] = []  # Empty list for custom products
        item_data['purchase_price'] = purchase_price  # Optional; user can enter in cart inline
        item_data['unit_price'] = purchase_price if purchase_price is not None else Decimal('0.00')
        item_data.pop('custom_product_name', None)  # Remove custom_product_name from item_data
        
        serializer = CartItemSerializer(
            data=item_data,
            context={'cart': cart, 'request': request}
        )
        if serializer.is_valid():
            with transaction.atomic():
                cart_item = serializer.save()
            
            # Audit log: Custom product added to cart
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(cart_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=None,
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity': str(requested_quantity),
                    'unit_price': str(cart_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                    'custom_product': True,
                }
            )
            
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if item with same product and variant already exists
    product_id = request.data.get('product')
    variant_id = request.data.get('variant')
    
    # Validate product_id is provided
    if not product_id:
        return Response({'error': 'Product is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Get the product first
    product = get_object_or_404(Product, pk=product_id)
    
    # Check if this is a custom product (name starts with "Other -")
    # Custom products bypass all barcode and stock validations
    is_custom_product = product.name and product.name.startswith('Other -')
    
    # Get invoice type and sale price for validation (used for both tracked and non-tracked products)
    invoice_type = cart.invoice_type
    manual_unit_price = request.data.get('manual_unit_price')
    unit_price = request.data.get('unit_price')
    # Check if manual_unit_price is explicitly provided (even if 0 or None)
    # Use 'in' check to distinguish between None (not provided) and 0/None (explicitly set)
    if 'manual_unit_price' in request.data:
        sale_price = manual_unit_price
    else:
        sale_price = unit_price
    
    # Get ALL existing cart items for this product+variant (there may be multiple from different suppliers)
    variant_id = variant_id if variant_id else None
    
    if variant_id:
        existing_items = list(CartItem.objects.select_for_update().filter(
            cart=cart,
            product_id=product_id,
            variant_id=variant_id
        ))
    else:
        existing_items = list(CartItem.objects.select_for_update().filter(
            cart=cart,
            product_id=product_id,
            variant__isnull=True
        ))
    existing_item = existing_items[0] if existing_items else None
    
    # Get invoice type and sale price for validation (used for both tracked and non-tracked products)
    invoice_type = cart.invoice_type
    manual_unit_price = request.data.get('manual_unit_price')
    unit_price = request.data.get('unit_price')
    # Check if manual_unit_price is explicitly provided (even if 0 or None)
    # Use 'in' check to distinguish between None (not provided) and 0/None (explicitly set)
    if 'manual_unit_price' in request.data:
        sale_price = manual_unit_price
    else:
        sale_price = unit_price
    
    # Handle non-tracked inventory products differently
    if not product.track_inventory:
        # For custom products (with "Other -" prefix), skip all validations
        if is_custom_product:
            # Custom products don't need barcodes or stock validation
            requested_quantity = Decimal(str(request.data.get('quantity', 1)))
            
            # If existing item found, increment quantity (no stock update needed)
            if existing_item:
                with transaction.atomic():
                    existing_item.quantity += requested_quantity
                    existing_item.save(update_fields=['quantity'])
                
                # Audit log: Item quantity updated in cart (custom product)
                create_audit_log(
                    request=request,
                    action='cart_add',
                    model_name='CartItem',
                    object_id=str(existing_item.id),
                    object_name=f"{product.name}",
                    object_reference=f"Cart #{cart.cart_number or cart.id}",
                    barcode=None,
                    changes={
                        'product_id': product.id,
                        'product_name': product.name,
                        'product_sku': product.sku,
                        'quantity_added': str(requested_quantity),
                        'new_quantity': str(existing_item.quantity),
                        'unit_price': str(existing_item.unit_price),
                        'cart_id': cart.id,
                        'cart_number': cart.cart_number,
                        'action': 'quantity_incremented',
                        'custom_product': True,
                    }
                )
                
                serializer = CartItemSerializer(existing_item)
                return Response(serializer.data, status=status.HTTP_200_OK)
            
            # Create new item for custom product (no barcodes, no stock validation)
            item_data = request.data.copy()
            item_data['scanned_barcodes'] = []  # Empty list for custom products
            
            serializer = CartItemSerializer(
                data=item_data,
                context={'cart': cart, 'request': request}
            )
            if serializer.is_valid():
                with transaction.atomic():
                    cart_item = serializer.save()
                
                # Audit log: Custom product added to cart
                create_audit_log(
                    request=request,
                    action='cart_add',
                    model_name='CartItem',
                    object_id=str(cart_item.id),
                    object_name=f"{product.name}",
                    object_reference=f"Cart #{cart.cart_number or cart.id}",
                    barcode=None,
                    changes={
                        'product_id': product.id,
                        'product_name': product.name,
                        'product_sku': product.sku,
                        'quantity': str(requested_quantity),
                        'unit_price': str(cart_item.unit_price),
                        'cart_id': cart.id,
                        'cart_number': cart.cart_number,
                        'custom_product': True,
                    }
                )
                
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # For regular non-tracked products, strictly validate that product barcode has 'new' tag
        product_barcode = product.barcodes.first()
        if not product_barcode:
            return Response({
                'error': 'Product not available',
                'message': 'This product has no barcode and cannot be added to cart.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if product has been purchased (barcode must have purchase_item)
        if not product_barcode.purchase_item:
            return Response({
                'error': 'Product not purchased',
                'message': f'This product ({product.name}) has not been purchased yet. Please create a purchase order first before selling this item.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if purchase is finalized (stock is only created when purchase is finalized)
        if product_barcode.purchase_item:
            purchase = product_barcode.purchase_item.purchase
            if purchase and purchase.status != 'finalized':
                return Response({
                    'error': 'Product not available',
                    'message': f'This product ({product.name}) is from a purchase order that has not been finalized yet. Please finalize the purchase order before selling this item.'
                }, status=status.HTTP_400_BAD_REQUEST)
        
        # Strict validation: only 'new' tag barcodes can be added to POS
        is_valid, error_msg = validate_barcode_for_pos(product_barcode)
        if not is_valid:
            return Response({
                'error': 'Product not available',
                'message': error_msg or 'This product is not available for sale. Only products with "new" tag can be added to cart.',
                'current_tag': product_barcode.tag
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # For non-tracked products, use stock quantity instead of barcodes
        requested_quantity = Decimal(str(request.data.get('quantity', 1)))
        
        # Check available stock (stock is only created when purchase is finalized)
        available_stock = get_available_stock_for_product(product, variant_id)
        
        # If existing item, calculate total quantity after adding
        if existing_item:
            new_total_quantity = existing_item.quantity + requested_quantity
        else:
            new_total_quantity = requested_quantity
        
        # Check if we have enough stock
        if available_stock < new_total_quantity:
            return Response({
                'error': 'Insufficient stock',
                'message': f'Available stock: {available_stock}, Requested: {new_total_quantity}'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # If existing item found, increment quantity
        if existing_item:
            with transaction.atomic():
                existing_item.quantity += requested_quantity
                existing_item.save(update_fields=['quantity'])
                
                # Update stock quantity when item is added to cart
                # Use F() expression to ensure atomic update and prevent double decrement
                if cart.store:
                    stock, created = Stock.objects.get_or_create(
                        product=product,
                        variant_id=variant_id if variant_id else None,
                        store=cart.store,
                        defaults={'quantity': Decimal('0.000')}
                    )
                    # Use F() to ensure atomic decrement - prevents race conditions
                    Stock.objects.filter(id=stock.id).update(
                        quantity=F('quantity') - requested_quantity
                    )
                    # Refresh from DB to get updated value
                    stock.refresh_from_db()
                    # Ensure quantity doesn't go below 0
                    if stock.quantity < 0:
                        stock.quantity = Decimal('0.000')
                        stock.save()
            
            # Audit log: Item quantity updated in cart (non-tracked inventory)
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(existing_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=None,  # Non-tracked products don't have barcodes
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity_added': str(requested_quantity),
                    'new_quantity': str(existing_item.quantity),
                    'unit_price': str(existing_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                    'action': 'quantity_incremented',
                }
            )
            
            serializer = CartItemSerializer(existing_item)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
        # No existing item - create new one (no barcodes needed)
        # Validate selling price or purchase price vs sale price (exception for PENDING invoice type)
        # Only validate if it's not a PENDING invoice and sale price is provided
        if invoice_type != 'pending' and sale_price:
            try:
                sale_price_decimal = Decimal(str(sale_price))
                # Use purchase_price as the floor — selling at cost (break even) is allowed
                purchase_price = Decimal('0.00')
                if product_barcode:
                    purchase_price = product_barcode.get_purchase_price()
                
                min_price = purchase_price
                can_go_below = product.can_go_below_purchase_price

                if not can_go_below and sale_price_decimal > 0:
                    if min_price > 0 and sale_price_decimal < min_price:
                        return Response({
                            'error': f'Sale price (₹{sale_price_decimal}) cannot be less than purchase price (₹{min_price})',
                            'message': f'Sale price cannot be less than purchase price of ₹{min_price}',
                            'purchase_price': str(purchase_price),
                            'sale_price': str(sale_price_decimal)
                        }, status=status.HTTP_400_BAD_REQUEST)
                    elif min_price == 0:
                        return Response({
                            'error': 'Purchase price not available',
                            'message': 'Cannot determine purchase price for this product. Please ensure the product has been purchased and has a valid purchase price.',
                            'purchase_price': '0.00',
                            'sale_price': str(sale_price_decimal)
                        }, status=status.HTTP_400_BAD_REQUEST)
            except (ValueError, TypeError):
                pass  # Invalid price format, let serializer handle it
        
        # Create new item without barcodes
        item_data = request.data.copy()
        item_data['scanned_barcodes'] = []  # Empty list for non-tracked products
        
        serializer = CartItemSerializer(
            data=item_data,
            context={'cart': cart, 'request': request}
        )
        if serializer.is_valid():
            with transaction.atomic():
                cart_item = serializer.save()
                
                # Update stock quantity when item is added to cart
                # Use helper function to reduce duplication
                reduce_stock_for_cart_item(product, variant_id, cart.store, requested_quantity)
            
            # Audit log: Item added to cart
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(cart_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=None,  # Non-tracked products don't have barcodes
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity': str(requested_quantity),
                    'unit_price': str(cart_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                }
            )
            
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    # For tracked inventory products, use barcode-based logic
    # But first, check if this is a custom product - if so, handle it specially
    if is_custom_product:
        # Custom products don't need barcodes - add directly to cart
        requested_quantity = Decimal(str(request.data.get('quantity', 1)))
        
        # If existing item found, increment quantity (no barcode/stock validation)
        if existing_item:
            with transaction.atomic():
                existing_item.quantity += requested_quantity
                existing_item.save(update_fields=['quantity'])
            
            # Audit log: Item quantity updated in cart (custom product)
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(existing_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=None,
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity_added': str(requested_quantity),
                    'new_quantity': str(existing_item.quantity),
                    'unit_price': str(existing_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                    'action': 'quantity_incremented',
                    'custom_product': True,
                }
            )
            
            serializer = CartItemSerializer(existing_item)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
        # Create new item for custom product (no barcodes needed)
        item_data = request.data.copy()
        item_data['scanned_barcodes'] = []  # Empty list for custom products
        
        serializer = CartItemSerializer(
            data=item_data,
            context={'cart': cart, 'request': request}
        )
        if serializer.is_valid():
            with transaction.atomic():
                cart_item = serializer.save()
            
            # Audit log: Custom product added to cart
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(cart_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=None,
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity': str(requested_quantity),
                    'unit_price': str(cart_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                    'custom_product': True,
                }
            )
            
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    # Get the barcode/SKU being scanned
    barcode_value = request.data.get('barcode') or request.data.get('barcode_value')
    sku_value = request.data.get('sku')
    scanned_value = barcode_value or sku_value
    scanned_value_str = str(scanned_value).strip().upper() if scanned_value else None
    
    # Check if this barcode is already sold (assigned to an invoice item)
    # Allow 'new' and 'returned' tags to be added to cart - they are available for sale
    if scanned_value_str:
        barcode_obj = None
        try:
            try:
                barcode_obj = Barcode.objects.get(barcode=scanned_value_str)
            except Barcode.DoesNotExist:
                barcode_obj = Barcode.objects.get(short_code=scanned_value_str)
        except Barcode.DoesNotExist:
            pass
        if barcode_obj:
            # Allow 'new' and 'returned' tags - they are available for sale
            if barcode_obj.tag in ['new', 'returned']:
                pass
            elif barcode_obj.tag == 'sold':
                sold_item = InvoiceItem.objects.filter(
                    barcode=barcode_obj
                ).exclude(
                    invoice__status='void'
                ).first()
                invoice_info = f' and is assigned to invoice {sold_item.invoice.invoice_number}' if sold_item else ''
                return Response({
                    'error': 'This item has already been sold',
                    'message': f'Barcode/SKU {scanned_value_str} has already been sold{invoice_info}. It is not available in inventory.'
                }, status=status.HTTP_400_BAD_REQUEST)
            elif barcode_obj.tag == 'in-cart':
                # Check if barcode is in the current cart (not another cart)
                full_barcode = barcode_obj.barcode
                in_current_cart = CartItem.objects.filter(
                    cart=cart,
                    scanned_barcodes__contains=[full_barcode]
                ).first()
                if in_current_cart:
                    serializer = CartItemSerializer(in_current_cart)
                    data = dict(serializer.data)
                    data['message'] = 'Item already in this cart'
                    return Response(data, status=status.HTTP_200_OK)
                other_item = CartItem.objects.filter(
                    scanned_barcodes__contains=[full_barcode]
                ).exclude(cart=cart).select_related('cart').first()
                other_cart_id = other_item.cart_id if other_item else None
                other_cart_number = other_item.cart.cart_number if other_item and other_item.cart else None
                cart_info = f' (Cart #{other_cart_number or other_cart_id})' if (other_cart_number or other_cart_id) else ''
                return Response({
                    'error': 'Item already in cart',
                    'message': f'Barcode/SKU {scanned_value_str} is already in another cart{cart_info} and cannot be added to this cart.',
                    'other_cart_id': other_cart_id,
                    'other_cart_number': other_cart_number,
                }, status=status.HTTP_400_BAD_REQUEST)
            else:
                tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') else barcode_obj.tag
                return Response({
                    'error': 'Item not available',
                    'message': f'Barcode/SKU {scanned_value_str} has tag "{tag_display}" and cannot be added to cart. Only items with "new" or "returned" tags can be sold.'
                }, status=status.HTTP_400_BAD_REQUEST)

    # Get or find an available barcode for this product
    # If barcode is provided, verify it belongs to this product and is available
    barcode_obj = None
    barcode_value_to_use = None
    
    if scanned_value_str:
        # Exact match only: try barcode then short_code (scanned_value_str already .upper())
        try:
            try:
                barcode_obj = Barcode.objects.get(barcode=scanned_value_str)
            except Barcode.DoesNotExist:
                barcode_obj = Barcode.objects.get(short_code=scanned_value_str)

            # Verify this barcode belongs to the product being added
            if barcode_obj.product_id != product_id:
                return Response({
                    'error': 'Barcode does not match product',
                    'message': f'Barcode {scanned_value_str} does not belong to the selected product'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Verify variant matches if variant is specified
            if variant_id:
                if barcode_obj.variant_id != variant_id:
                    return Response({
                        'error': 'Barcode does not match variant',
                        'message': f'Barcode {scanned_value_str} does not belong to the selected variant'
                    }, status=status.HTTP_400_BAD_REQUEST)
            elif barcode_obj.variant_id is not None:
                return Response({
                    'error': 'Barcode does not match variant',
                    'message': f'Barcode {scanned_value_str} belongs to a variant, but no variant was selected'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Check if barcode is already in any cart item across ALL active carts
            # Use barcode_obj.barcode (full barcode) for the check so short_code requests still match
            # (cart stores full barcode in scanned_barcodes)
            full_barcode = barcode_obj.barcode
            all_active_carts = Cart.objects.filter(status='active')
            all_cart_items = CartItem.objects.filter(cart__in=all_active_carts).select_related('cart')
            for item in all_cart_items:
                if item.scanned_barcodes and (full_barcode in item.scanned_barcodes or scanned_value_str in item.scanned_barcodes):
                    # Item is in a cart - distinguish current cart vs another cart
                    if item.cart_id == cart.id:
                        # Already in THIS cart - return success so frontend doesn't show error
                        serializer = CartItemSerializer(item)
                        data = dict(serializer.data)
                        data['message'] = 'Item already in this cart'
                        return Response(data, status=status.HTTP_200_OK)
                    other_cart_number = item.cart.cart_number if item.cart else None
                    cart_info = f' (Cart #{other_cart_number or item.cart_id})' if (other_cart_number or item.cart_id) else ''
                    return Response({
                        'error': 'This barcode/SKU has already been scanned',
                        'message': f'Item with this barcode/SKU is already in another cart{cart_info}',
                        'other_cart_id': item.cart_id,
                        'other_cart_number': other_cart_number,
                    }, status=status.HTTP_400_BAD_REQUEST)
            
            # Strict validation: only 'new' or 'returned' tag barcodes can be added to POS
            is_valid, error_msg = validate_barcode_for_pos(barcode_obj)
            if not is_valid:
                return Response({
                    'error': 'Barcode is not available',
                    'message': error_msg or f'Barcode {scanned_value_str} cannot be added to cart.',
                    'current_tag': barcode_obj.tag
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Check if already sold - only block if tag is 'sold'
            if barcode_obj.tag == 'sold':
                sold_item = InvoiceItem.objects.filter(
                    barcode=barcode_obj
                ).exclude(
                    invoice__status='void'
                ).first()
                
                if sold_item:
                    return Response({
                        'error': 'Barcode already sold',
                        'message': f'Barcode {scanned_value_str} is already assigned to invoice {sold_item.invoice.invoice_number}'
                    }, status=status.HTTP_400_BAD_REQUEST)
            
            # Block if barcode is already in another cart (tag says in-cart but not in current cart)
            if barcode_obj.tag == 'in-cart':
                other_item = CartItem.objects.filter(
                    scanned_barcodes__contains=[barcode_obj.barcode]
                ).exclude(cart=cart).select_related('cart').first()
                other_cart_id = other_item.cart_id if other_item else None
                other_cart_number = other_item.cart.cart_number if other_item and other_item.cart else None
                cart_info = f' (Cart #{other_cart_number or other_cart_id})' if (other_cart_number or other_cart_id) else ''
                return Response({
                    'error': 'Barcode is not available',
                    'message': f'Barcode {scanned_value_str} is already in another cart{cart_info} and cannot be added to this cart.',
                    'current_tag': barcode_obj.tag,
                    'other_cart_id': other_cart_id,
                    'other_cart_number': other_cart_number,
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # ALWAYS use the actual barcode string from the database object
            # This ensures that if the user scanned a short_code (e.g. GLA-123), we store the full barcode (e.g. OCA-...)
            barcode_value_to_use = barcode_obj.barcode
        except Barcode.DoesNotExist:
            # STRICT MODE: If a specific barcode/SKU was scanned but not found, 
            # DO NOT fall back to assigning a random available unit.
            # This prevents incorrect item assignment.
            return Response({
                'error': 'Item not found',
                'message': f'Scanned item "{scanned_value_str}" does not exist in the database. Please check the barcode.'
            }, status=status.HTTP_404_NOT_FOUND)
    
    # If no barcode provided or not found, STRICTLY REQUIRE a scanned barcode for tracked products
    if not barcode_obj:
        return Response({
            'error': 'Barcode required',
            'message': f'This is a tracked product ({product.name}). You MUST physically scan a barcode to add it to the cart.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Find the right existing cart item to merge into (same product + same supplier).
    # When multiple rows exist for the same product (different suppliers), we must
    # check ALL of them — not just .first() — to find the correct merge target.
    if existing_items:
        new_supplier_id = _get_barcode_supplier_id(barcode_obj) if barcode_obj else None
        merge_target = None

        for candidate in existing_items:
            if not (candidate.scanned_barcodes or []):
                merge_target = candidate
                break
            first_bc = str((candidate.scanned_barcodes or [])[0] or '').strip().upper()
            if not first_bc:
                merge_target = candidate
                break
            first_barcode_obj = None
            try:
                first_barcode_obj = Barcode.objects.get(barcode=first_bc)
            except Barcode.DoesNotExist:
                try:
                    first_barcode_obj = Barcode.objects.get(short_code=first_bc)
                except Barcode.DoesNotExist:
                    pass
            candidate_supplier_id = _get_barcode_supplier_id(first_barcode_obj) if first_barcode_obj else None
            if new_supplier_id is None or candidate_supplier_id is None or new_supplier_id == candidate_supplier_id:
                merge_target = candidate
                break

        if merge_target:
            if not merge_target.scanned_barcodes:
                merge_target.scanned_barcodes = []

            if barcode_value_to_use and barcode_value_to_use not in merge_target.scanned_barcodes:
                merge_target.scanned_barcodes.append(barcode_value_to_use)
                merge_target.quantity = Decimal(len(merge_target.scanned_barcodes))
                merge_target.save(update_fields=['scanned_barcodes', 'quantity'])

                if barcode_obj and barcode_obj.tag in ['new', 'returned']:
                    barcode_obj.tag = 'in-cart'
                    barcode_obj.save(update_fields=['tag'])

                if cart.store and barcode_obj:
                    reduce_stock_for_cart_item(product, variant_id, cart.store, Decimal('1.000'))

                barcode_str = barcode_value_to_use if barcode_value_to_use else None
                create_audit_log(
                    request=request,
                    action='cart_add',
                    model_name='CartItem',
                    object_id=str(merge_target.id),
                    object_name=f"{product.name}",
                    object_reference=f"Cart #{cart.cart_number or cart.id}",
                    barcode=barcode_str,
                    changes={
                        'product_id': product.id,
                        'product_name': product.name,
                        'product_sku': product.sku,
                        'barcode_added': barcode_str,
                        'new_quantity': str(merge_target.quantity),
                        'unit_price': str(merge_target.unit_price),
                        'cart_id': cart.id,
                        'cart_number': cart.cart_number,
                        'action': 'barcode_added_to_existing_item',
                    }
                )
                serializer = CartItemSerializer(merge_target)
                return Response(serializer.data, status=status.HTTP_200_OK)
            else:
                serializer = CartItemSerializer(merge_target)
                return Response(serializer.data, status=status.HTTP_200_OK)
        # No merge target found (all existing rows are from different suppliers) — fall through to create new cart line
    
    # No existing item - create new one
    
    # Check if product has been purchased (barcode must have purchase_item)
    if barcode_obj and not barcode_obj.purchase_item:
        return Response({
            'error': 'Product not purchased',
            'message': f'This product ({product.name}) has not been purchased yet. Please create a purchase order first before selling this item.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if purchase is finalized (stock is only created when purchase is finalized)
    # For tracked products, check the barcode's purchase status
    if barcode_obj and barcode_obj.purchase_item:
        purchase = barcode_obj.purchase_item.purchase
        if purchase and purchase.status != 'finalized':
            return Response({
                'error': 'Product not available',
                'message': f'This product ({product.name}) is from a purchase order that has not been finalized yet. Please finalize the purchase order before selling this item.'
            }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate selling price or purchase price vs sale price (exception for PENDING invoice type)
    # invoice_type and sale_price are already defined at the top of the function
    # Only validate if it's not a PENDING invoice and sale price is provided (and not None)
    if invoice_type != 'pending' and sale_price is not None:
        try:
            sale_price_decimal = Decimal(str(sale_price))
            # Use purchase_price as the floor — selling at cost (break even) is allowed
            purchase_price = Decimal('0.00')
            if barcode_obj:
                purchase_price = barcode_obj.get_purchase_price()
            elif product.track_inventory:
                product_barcode = product.barcodes.first()
                if product_barcode:
                    purchase_price = product_barcode.get_purchase_price()
            
            min_price = purchase_price
            can_go_below = product.can_go_below_purchase_price

            if not can_go_below and sale_price_decimal > 0:
                if min_price > 0 and sale_price_decimal < min_price:
                    return Response({
                        'error': f'Sale price (₹{sale_price_decimal}) cannot be less than purchase price (₹{min_price})',
                        'message': f'Sale price cannot be less than purchase price of ₹{min_price}',
                        'purchase_price': str(purchase_price),
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
                elif min_price == 0:
                    return Response({
                        'error': 'Purchase price not available',
                        'message': 'Cannot determine purchase price for this product. Please ensure the product has been purchased and has a valid purchase price.',
                        'purchase_price': '0.00',
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
        except (ValueError, TypeError):
            pass  # Invalid price format, let serializer handle it
    
    # Create new item with the assigned barcode
    # Prepare data with scanned_barcodes
    item_data = request.data.copy()
    if barcode_value_to_use:
        item_data['scanned_barcodes'] = [barcode_value_to_use]
    
    serializer = CartItemSerializer(
        data=item_data,
        context={'cart': cart, 'request': request}
    )
    if serializer.is_valid():
        with transaction.atomic():
            # Explicitly pass scanned_barcodes to save() to ensure it's saved correctly
            # This overrides any potential issues with request.data.copy() or QueryDict handling
            save_kwargs = {}
            if barcode_value_to_use:
                save_kwargs['scanned_barcodes'] = [barcode_value_to_use]
            
            cart_item = serializer.save(**save_kwargs)
            
            # Mark barcode as 'in-cart' when added to cart
            if barcode_obj and barcode_obj.tag in ['new', 'returned']:
                barcode_obj.tag = 'in-cart'
                barcode_obj.save(update_fields=['tag'])
            
            # Update stock quantity when tracked item is added to cart
            # Use helper function to reduce duplication (always reduces by 1 for tracked products)
            if cart.store and barcode_obj:
                reduce_stock_for_cart_item(product, variant_id, cart.store, Decimal('1.000'))
        
        # Audit log: Item added to cart (tracked inventory)
        barcode_str = barcode_value_to_use if barcode_value_to_use else None
        create_audit_log(
            request=request,
            action='cart_add',
            model_name='CartItem',
            object_id=str(cart_item.id),
            object_name=f"{product.name}",
            object_reference=f"Cart #{cart.cart_number or cart.id}",
            barcode=barcode_str,
            changes={
                'product_id': product.id,
                'product_name': product.name,
                'product_sku': product.sku,
                'quantity': str(cart_item.quantity),
                'unit_price': str(cart_item.unit_price),
                'cart_id': cart.id,
                'cart_number': cart.cart_number,
                'barcode': barcode_str,
            }
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PATCH', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def cart_item_update(request, pk, item_id):
    """Update or delete a cart item"""
    cart = get_object_or_404(Cart, pk=pk)
    if getattr(cart, 'locked', False):
        return Response(
            {'error': 'Cart is locked.', 'detail': 'Unlock the cart to edit items.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        cart_item = CartItem.objects.get(id=item_id, cart=cart)
    except CartItem.DoesNotExist:
        return Response({'error': 'Cart item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == 'DELETE':
        # Restore stock when cart item is deleted
        # For both tracked and non-tracked products, stock was reduced when added to cart
        # So we need to restore it when removed
        if cart.store:
            if cart_item.product.track_inventory:
                # For tracked products, restore stock per barcode (1 per barcode)
                if cart_item.scanned_barcodes:
                    for barcode_value in cart_item.scanned_barcodes:
                        stock, created = Stock.objects.get_or_create(
                            product=cart_item.product,
                            variant=cart_item.variant,
                            store=cart.store,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        # Use F() to ensure atomic increment
                        Stock.objects.filter(id=stock.id).update(
                            quantity=F('quantity') + Decimal('1.000')
                        )
                        stock.refresh_from_db()
            else:
                # For non-tracked products, restore stock by quantity
                stock, created = Stock.objects.get_or_create(
                    product=cart_item.product,
                    variant=cart_item.variant,
                    store=cart.store,
                    defaults={'quantity': Decimal('0.000')}
                )
                stock.quantity += cart_item.quantity
                stock.save()
        
        # Handle barcodes for tracked inventory items - restore from 'in-cart' to 'new' only if not on paid/credit invoice
        if cart_item.product.track_inventory and cart_item.scanned_barcodes:
            sold_barcode_ids_item = set(
                InvoiceItem.objects.filter(
                    invoice__status__in=['paid', 'credit']
                ).exclude(barcode_id__isnull=True).values_list('barcode_id', flat=True).distinct()
            )
            for barcode_value in cart_item.scanned_barcodes:
                if not barcode_value:
                    continue
                b_upper = str(barcode_value).strip().upper()
                try:
                    try:
                        barcode_obj = Barcode.objects.get(barcode=b_upper)
                    except Barcode.DoesNotExist:
                        barcode_obj = Barcode.objects.get(short_code=b_upper)
                    # Do not revert barcodes that are on a paid/credit invoice — they stay 'sold'
                    if barcode_obj.id in sold_barcode_ids_item:
                        continue
                    # Restore from 'in-cart' or 'sold' back to 'new' when cart item is deleted
                    old_tag = barcode_obj.tag
                    if barcode_obj.tag in ['in-cart', 'sold']:
                        barcode_obj.tag = 'new'
                        barcode_obj.save(update_fields=['tag'])
                        invalidate_barcode_cache(barcode_obj)  # so next byBarcode() returns fresh data
                        # Audit log: Barcode tag changed (in-cart/sold -> new)
                        create_audit_log(
                            request=request,
                            action='barcode_tag_change',
                            model_name='Barcode',
                            object_id=str(barcode_obj.id),
                            object_name=cart_item.product.name,
                            object_reference=f"Cart #{cart.cart_number or cart.id}",
                            barcode=barcode_obj.barcode,
                            changes={
                                'tag': {'old': old_tag, 'new': 'new'},
                                'barcode': barcode_obj.barcode,
                                'product_id': cart_item.product.id,
                                'product_name': cart_item.product.name,
                                'cart_id': cart.id,
                                'cart_number': cart.cart_number,
                                'context': 'cart_item_removed',
                            }
                        )
                except Barcode.DoesNotExist:
                    pass  # Barcode doesn't exist, skip
        
        # Audit log: Item removed from cart
        # For tracked products, include all barcodes separated by comma
        barcodes_list = [b for b in cart_item.scanned_barcodes if b] if cart_item.scanned_barcodes else []
        barcode_display = ', '.join(barcodes_list) if barcodes_list else None
        
        create_audit_log(
            request=request,
            action='cart_remove',
            model_name='CartItem',
            object_id=str(cart_item.id),
            object_name=f"{cart_item.product.name}",
            object_reference=f"Cart #{cart.cart_number or cart.id}",
            barcode=barcode_display,  # All barcodes separated by comma
            changes={
                'product_id': cart_item.product.id,
                'product_name': cart_item.product.name,
                'product_sku': cart_item.product.sku,
                'quantity': str(cart_item.quantity),
                'cart_id': cart.id,
                'cart_number': cart.cart_number,
                'barcodes': barcodes_list,  # Include full list in changes for reference
                'barcode_count': len(barcodes_list),
            }
        )
        
        cart_item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    
    # Handle increment/decrement operations
    action = request.data.get('action')
    if action in ['increment', 'decrement']:
        track_inventory = cart_item.product.track_inventory
        # Check if this is a custom product (name starts with "Other -")
        is_custom_product = cart_item.product.name and cart_item.product.name.startswith('Other -')
        
        if not track_inventory:
            # For products without inventory tracking, check stock availability before incrementing
            # But skip all stock checks for custom products
            if action == 'increment':
                # For custom products, skip stock validation
                if not is_custom_product:
                    # Check available stock
                    available_stock = get_available_stock_for_product(cart_item.product, cart_item.variant)
                    # Check if stock is exhausted (only prevent incrementing when stock is 0 or less)
                    if available_stock <= Decimal('0.000'):
                        return Response({
                            'error': 'Insufficient stock',
                            'message': f'Product is out of stock. Available stock: {available_stock}'
                        }, status=status.HTTP_400_BAD_REQUEST)
                
                with transaction.atomic():
                    cart_item.quantity += Decimal('1.000')
                    cart_item.save(update_fields=['quantity'])
                    
                    # Update stock when quantity is incremented (skip for custom products)
                    # Use F() expression to ensure atomic update and prevent double decrement
                    if cart.store and not is_custom_product:
                        stock, created = Stock.objects.get_or_create(
                            product=cart_item.product,
                            variant=cart_item.variant,
                            store=cart.store,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        # Use F() to ensure atomic decrement - prevents race conditions
                        Stock.objects.filter(id=stock.id).update(
                            quantity=F('quantity') - Decimal('1.000')
                        )
                        # Refresh from DB to get updated value
                        stock.refresh_from_db()
                        # Ensure quantity doesn't go below 0
                        if stock.quantity < 0:
                            stock.quantity = Decimal('0.000')
                            stock.save()
            elif action == 'decrement':
                if cart_item.quantity > Decimal('1.000'):
                    cart_item.quantity -= Decimal('1.000')
                    cart_item.save(update_fields=['quantity'])
                    
                    # Restore stock when quantity is decremented (skip for custom products)
                    # Use F() expression to ensure atomic update
                    if cart.store and not is_custom_product:
                        stock, created = Stock.objects.get_or_create(
                            product=cart_item.product,
                            variant=cart_item.variant,
                            store=cart.store,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        # Use F() to ensure atomic increment
                        Stock.objects.filter(id=stock.id).update(
                            quantity=F('quantity') + Decimal('1.000')
                        )
                        stock.refresh_from_db()
                else:
                    # If quantity becomes 0, delete the item
                    # Restore stock before deleting (skip for custom products)
                    if cart.store and not is_custom_product:
                        stock, created = Stock.objects.get_or_create(
                            product=cart_item.product,
                            variant=cart_item.variant,
                            store=cart.store,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        stock.quantity += cart_item.quantity
                        stock.save()
                    
                    cart_item.delete()
                    return Response(status=status.HTTP_204_NO_CONTENT)
        else:
            # For products with inventory tracking, manage individual SKUs
            if not cart_item.scanned_barcodes:
                cart_item.scanned_barcodes = []
            
            if action == 'increment':
                # For tracked products, we enforce physical scanning.
                # Auto-assigning a random barcode leads to inventory mismatches (Audit anomalies).
                return Response({
                    'error': 'Scanning Required',
                    'message': f'Product "{cart_item.product.name}" requires active scanning. Please scan the barcode instead of using the manual increment button.'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            elif action == 'decrement':
                # Remove last barcode from list
                if len(cart_item.scanned_barcodes) > 0:
                    cart_item.scanned_barcodes.pop()
                    cart_item.quantity = Decimal(len(cart_item.scanned_barcodes))
                    if cart_item.quantity == 0:
                        # If quantity becomes 0, delete the item
                        cart_item.delete()
                        return Response(status=status.HTTP_204_NO_CONTENT)
                    cart_item.save(update_fields=['scanned_barcodes', 'quantity'])
                else:
                    return Response({
                        'error': 'Cannot decrement',
                        'message': 'Item quantity is already 0'
                    }, status=status.HTTP_400_BAD_REQUEST)
        
        serializer = CartItemSerializer(cart_item)
        return Response(serializer.data)
    
    # Validate selling price or purchase price vs sale price (exception for PENDING invoice type)
    invoice_type = cart.invoice_type
    manual_unit_price = request.data.get('manual_unit_price')
    unit_price = request.data.get('unit_price')
    # Check if manual_unit_price is explicitly provided (even if 0 or None)
    # Use 'in' check to distinguish between None (not provided) and 0/None (explicitly set)
    if 'manual_unit_price' in request.data:
        sale_price = manual_unit_price
    elif 'unit_price' in request.data:
        sale_price = unit_price
    else:
        sale_price = None

    # Only validate if it's not a PENDING invoice and sale price is provided (and not None)
    if invoice_type != 'pending' and sale_price is not None:
        try:
            sale_price_decimal = Decimal(str(sale_price))
            # Use purchase_price as the floor — selling at cost (break even) is allowed
            purchase_price = Decimal('0.00')
            if cart_item.product.name and cart_item.product.name.startswith('Other -') and cart_item.purchase_price is not None and cart_item.purchase_price > 0:
                purchase_price = cart_item.purchase_price
            elif cart_item.scanned_barcodes and len(cart_item.scanned_barcodes) > 0:
                try:
                    b_upper = str(cart_item.scanned_barcodes[0] or '').strip().upper()
                    try:
                        first_barcode = Barcode.objects.get(barcode=b_upper)
                    except Barcode.DoesNotExist:
                        first_barcode = Barcode.objects.get(short_code=b_upper)
                    purchase_price = first_barcode.get_purchase_price()
                except Barcode.DoesNotExist:
                    if cart_item.product.track_inventory:
                        product_barcode = cart_item.product.barcodes.first()
                        if product_barcode:
                            purchase_price = product_barcode.get_purchase_price()
            elif not cart_item.product.track_inventory:
                product_barcode = cart_item.product.barcodes.first()
                if product_barcode:
                    purchase_price = product_barcode.get_purchase_price()
            elif cart_item.product.track_inventory:
                product_barcode = cart_item.product.barcodes.first()
                if product_barcode:
                    purchase_price = product_barcode.get_purchase_price()
            
            min_price = purchase_price
            can_go_below = cart_item.product.can_go_below_purchase_price

            if not can_go_below and sale_price_decimal > 0:
                if min_price > 0 and sale_price_decimal < min_price:
                    return Response({
                        'error': f'Sale price (₹{sale_price_decimal}) cannot be less than purchase price (₹{min_price})',
                        'message': f'Sale price cannot be less than purchase price of ₹{min_price}',
                        'purchase_price': str(purchase_price),
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
                elif min_price == 0:
                    return Response({
                        'error': 'Purchase price not available',
                        'message': 'Cannot determine purchase price for this product. Please ensure the product has been purchased and has a valid purchase price.',
                        'purchase_price': '0.00',
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
        except (ValueError, TypeError) as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f'Price validation error for cart_item {cart_item.id}: {str(e)}')
            pass  # Invalid price format, let serializer handle it
    
    # PATCH or PUT
    serializer = CartItemSerializer(
        cart_item,
        data=request.data,
        partial=True,
        context={'cart': cart, 'request': request}
    )
    if serializer.is_valid():
        # Double-check validation after serializer validation passes
        # This ensures we catch any edge cases where validation was skipped
        updated_manual_price = serializer.validated_data.get('manual_unit_price')
        updated_unit_price = serializer.validated_data.get('unit_price')
        final_sale_price = updated_manual_price if updated_manual_price is not None else updated_unit_price
        
        # If a price is being set, validate it one more time before saving
        if final_sale_price is not None and cart.invoice_type != 'pending':
            try:
                final_price_decimal = Decimal(str(final_sale_price))
                if final_price_decimal > 0:
                    purchase_price = Decimal('0.00')
                    if cart_item.product.name and cart_item.product.name.startswith('Other -') and cart_item.purchase_price is not None and cart_item.purchase_price > 0:
                        purchase_price = cart_item.purchase_price
                    elif cart_item.scanned_barcodes and len(cart_item.scanned_barcodes) > 0:
                        try:
                            b_upper = str(cart_item.scanned_barcodes[0] or '').strip().upper()
                            try:
                                first_barcode = Barcode.objects.get(barcode=b_upper)
                            except Barcode.DoesNotExist:
                                first_barcode = Barcode.objects.get(short_code=b_upper)
                            purchase_price = first_barcode.get_purchase_price()
                        except Barcode.DoesNotExist:
                            if cart_item.product.track_inventory:
                                product_barcode = cart_item.product.barcodes.first()
                                if product_barcode:
                                    purchase_price = product_barcode.get_purchase_price()
                    elif not cart_item.product.track_inventory:
                        product_barcode = cart_item.product.barcodes.first()
                        if product_barcode:
                            purchase_price = product_barcode.get_purchase_price()
                    elif cart_item.product.track_inventory:
                        product_barcode = cart_item.product.barcodes.first()
                        if product_barcode:
                            purchase_price = product_barcode.get_purchase_price()
                    
                    min_price = purchase_price
                    can_go_below = cart_item.product.can_go_below_purchase_price
                    if not can_go_below and min_price > 0 and final_price_decimal < min_price:
                        return Response({
                            'error': f'Sale price (₹{final_price_decimal}) cannot be less than purchase price (₹{min_price})',
                            'message': f'Sale price cannot be less than purchase price of ₹{min_price}',
                            'purchase_price': str(purchase_price),
                            'sale_price': str(final_price_decimal)
                        }, status=status.HTTP_400_BAD_REQUEST)
            except (ValueError, TypeError):
                pass  # Invalid format, let it through (serializer will handle)
        
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cart_item_remove_sku(request, pk, item_id):
    """Remove a specific SKU/barcode from a cart item"""
    cart = get_object_or_404(Cart, pk=pk)
    if getattr(cart, 'locked', False):
        return Response(
            {'error': 'Cart is locked.', 'detail': 'Unlock the cart to edit items.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        cart_item = CartItem.objects.get(id=item_id, cart=cart)
    except CartItem.DoesNotExist:
        return Response({'error': 'Cart item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    barcode_to_remove = request.data.get('barcode')
    if not barcode_to_remove:
        return Response({'error': 'Barcode is required'}, status=status.HTTP_400_BAD_REQUEST)
    b_upper = str(barcode_to_remove).strip().upper()
    # Match in scanned_barcodes by normalized (uppercase) value
    scanned_upper = [str(x).strip().upper() for x in (cart_item.scanned_barcodes or []) if x]
    if not cart_item.scanned_barcodes or b_upper not in scanned_upper:
        return Response({'error': 'Barcode not found in cart item'}, status=status.HTTP_400_BAD_REQUEST)
    # Remove the matching entry (same value, may differ by case)
    to_remove = next((x for x in cart_item.scanned_barcodes if str(x).strip().upper() == b_upper), None)
    if to_remove is not None:
        cart_item.scanned_barcodes.remove(to_remove)
    cart_item.quantity = Decimal(len(cart_item.scanned_barcodes))
    
    # Update stock quantity when tracked item barcode is removed
    if cart.store:
        stock, created = Stock.objects.get_or_create(
            product=cart_item.product,
            variant=cart_item.variant,
            store=cart.store,
            defaults={'quantity': Decimal('0.000')}
        )
        # Use F() to ensure atomic increment - stock is returned to inventory
        Stock.objects.filter(id=stock.id).update(
            quantity=F('quantity') + Decimal('1.000')
        )

    # Release the removed barcode back to available inventory (restore tag to 'new') only if not on paid/credit invoice
    try:
        try:
            barcode_obj = Barcode.objects.get(barcode=b_upper)
        except Barcode.DoesNotExist:
            barcode_obj = Barcode.objects.get(short_code=b_upper)
        # Do not revert barcodes that are on a paid/credit invoice — they stay 'sold'
        on_paid_or_credit = InvoiceItem.objects.filter(
            invoice__status__in=['paid', 'credit'],
            barcode_id=barcode_obj.id,
        ).exists()
        if not on_paid_or_credit:
            old_tag = barcode_obj.tag
            if barcode_obj.tag in ['in-cart', 'sold']:
                barcode_obj.tag = 'new'
                barcode_obj.save(update_fields=['tag'])
                # Invalidate catalog barcode lookup cache so next byBarcode() returns fresh data (not stale "in-cart")
                invalidate_barcode_cache(barcode_obj)
                create_audit_log(
                    request=request,
                    action='barcode_tag_change',
                    model_name='Barcode',
                    object_id=str(barcode_obj.id),
                    object_name=cart_item.product.name,
                    object_reference=f"Cart #{cart.cart_number or cart.id}",
                    barcode=barcode_obj.barcode,
                    changes={
                        'tag': {'old': old_tag, 'new': 'new'},
                        'barcode': barcode_obj.barcode,
                        'product_id': cart_item.product.id,
                        'product_name': cart_item.product.name,
                        'cart_id': cart.id,
                        'cart_number': cart.cart_number,
                        'context': 'cart_item_sku_removed',
                    }
                )
    except Barcode.DoesNotExist:
        pass  # Barcode doesn't exist, skip

    # If quantity becomes 0, delete the cart item (barcode tag already restored above)
    if cart_item.quantity == 0:
        cart_item.delete()
        return Response({'message': 'Cart item removed', 'deleted': True}, status=status.HTTP_200_OK)

    cart_item.save(update_fields=['scanned_barcodes', 'quantity'])
    serializer = CartItemSerializer(cart_item)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cart_hold(request, pk):
    """Hold a cart"""
    cart = get_object_or_404(Cart, pk=pk)
    cart.status = 'held'
    cart.save()
    return Response({'status': 'held'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cart_unhold(request, pk):
    """Unhold a cart"""
    cart = get_object_or_404(Cart, pk=pk)
    cart.status = 'active'
    cart.save()
    return Response({'status': 'active'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@transaction.atomic
def cart_checkout(request, pk):
    """
    Checkout a cart - create invoice and update stock with row-level locking.
    Uses @transaction.atomic for full integrity.
    """
    try:
        # Use select_for_update() to lock the cart row and prevent concurrent checkouts.
        # This is the PRIMARY protection against race conditions.
        cart = Cart.objects.select_for_update().get(pk=pk)
    except Cart.DoesNotExist:
        return Response({'error': 'Cart not found'}, status=status.HTTP_404_NOT_FOUND)
    
    # 1. Prevent double-checkout: If another request already settled this cart, block this one.
    if cart.status == 'completed':
        return Response(
            {'error': 'Cart already checked out. This cart has already been completed.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        # 2. Determine shop type
        is_repair_shop = False
        if cart.store:
            cart.store.refresh_from_db()
            shop_type = (cart.store.shop_type or '').lower()
            is_repair_shop = (shop_type == 'repair')
        
        # 3. Validation: Empty Cart
        if not cart.items.exists() and not is_repair_shop:
            return Response({'error': 'Cart is empty'}, status=status.HTTP_400_BAD_REQUEST)

        # 4. Extract and Validate Input
        invoice_type = request.data.get('invoice_type', cart.invoice_type or 'cash')
        customer_id = request.data.get('customer', cart.customer_id if cart.customer else None)
        created_at_raw = request.data.get('created_at') or request.data.get('createdAt')
        repair_contact_no = ''
        repair_model_name = ''

        # For repair stores, model is mandatory.
        # Without this guard, checkout could succeed without creating a Repair record.
        if is_repair_shop:
            repair_contact_no = str(request.data.get('repair_contact_no', '')).strip()
            repair_model_name = str(request.data.get('repair_model_name', '')).strip()
            if not repair_model_name:
                return Response(
                    {
                        'error': 'Repair model name is required for repair checkout',
                        'missing_fields': ['repair_model_name'],
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Optional POS-provided invoice datetime: always use when client sends a valid value.
        created_at_override = None
        if created_at_raw not in (None, ''):
            raw_str = str(created_at_raw).strip()
            if raw_str.endswith('Z'):
                raw_str = raw_str[:-1] + '+00:00'
            parsed_created_at = parse_datetime(raw_str)
            if parsed_created_at is None:
                return Response({'error': 'Invalid created_at datetime format'}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(parsed_created_at):
                parsed_created_at = timezone.make_aware(parsed_created_at, timezone.get_current_timezone())
            created_at_override = parsed_created_at
        
        # Mixed payment validation
        cash_amount = Decimal(str(request.data.get('cash_amount', '0'))) if invoice_type == 'mixed' else Decimal('0')
        upi_amount = Decimal(str(request.data.get('upi_amount', '0'))) if invoice_type == 'mixed' else Decimal('0')
        if invoice_type == 'mixed' and (not request.data.get('cash_amount') or not request.data.get('upi_amount')):
             return Response({'error': 'Both cash_amount and upi_amount required for mixed type'}, status=status.HTTP_400_BAD_REQUEST)

        # 5. Inventory Pre-Check (Efficiency)
        tracked_items = cart.items.select_related('product').filter(product__track_inventory=True)
        for ci in tracked_items:
            qty_needed = int(ci.quantity)
            if qty_needed <= 0:
                continue
            scanned = ci.scanned_barcodes or []
            
            # Check if scanned barcodes are still available (not sold)
            available_count = Barcode.objects.filter(
                barcode__in=scanned, product=ci.product
            ).exclude(tag='sold').count()
            
            if available_count < qty_needed:
                 return Response({
                    'error': 'Inventory Mismatch',
                    'message': f'Product "{ci.product.name}" requires {qty_needed} scans, but only {available_count} available barcodes were found.'
                }, status=status.HTTP_400_BAD_REQUEST)

        # 6. Validate that all items have a selling price for sale/credit invoices
        # This prevents invoices being created with line_total = 0 when the UI shows a price
        if invoice_type in ['cash', 'upi', 'mixed', 'credit']:
            items_without_price = []
            for ci in cart.items.select_related('product').all():
                if ci.quantity <= 0:
                    continue
                effective_price = ci.manual_unit_price or ci.unit_price
                if not effective_price or effective_price <= Decimal('0.00'):
                    items_without_price.append({
                        'product_name': ci.product.name if ci.product else 'Unknown product',
                        'product_sku': ci.product.sku if ci.product else '',
                    })
            if items_without_price:
                return Response({
                    'error': 'All items must have a selling price before checkout',
                    'message': f'{len(items_without_price)} item(s) are missing prices. Please enter a price for every item before completing the sale.',
                    'items_without_price': items_without_price,
                }, status=status.HTTP_400_BAD_REQUEST)

        # 7. Generate Invoice Number (Unique)
        invoice_number = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        while Invoice.objects.filter(invoice_number=invoice_number).exists():
            invoice_number = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

        # 8. Create Invoice (created_at from POS when provided, else server now)
        invoice = Invoice.objects.create(
            invoice_number=invoice_number,
            cart=cart, store=cart.store,
            customer_id=customer_id,
            invoice_type=invoice_type,
            status='draft',
            created_by=request.user,
            created_at=created_at_override if created_at_override is not None else timezone.now(),
        )

        # 9. Handle Repairs
        if is_repair_shop:
            repair_barcode = f"REP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            booking_amt = request.data.get('repair_booking_amount')
            booking_amt_decimal = Decimal(str(booking_amt)) if booking_amt else Decimal('0.00')
            Repair.objects.create(
                invoice=invoice,
                contact_no=repair_contact_no,
                model_name=repair_model_name,
                description=request.data.get('repair_description', ''),
                booking_amount=booking_amt_decimal if booking_amt_decimal > 0 else None,
                status='received',
                barcode=repair_barcode
            )

            # Booking amount is stored on repair metadata only.
            # Do not auto-create a payment row at registration time.

        # 10. Process Items
        subtotal = Decimal('0.00')
        discount_total = Decimal('0.00')
        tax_total = Decimal('0.00')
        items_added = 0

        for ci in cart.items.all():
            if ci.quantity <= 0: continue
            
            up = ci.manual_unit_price or ci.unit_price or Decimal('0.00')
            pd = ci.discount_amount / ci.quantity if ci.quantity > 0 else Decimal('0.00')
            pt = ci.tax_amount / ci.quantity if ci.quantity > 0 else Decimal('0.00')
            line_unit_total = up - pd + pt

            if not ci.product.track_inventory:
                line_total = line_unit_total * ci.quantity
                InvoiceItem.objects.create(
                    invoice=invoice, product=ci.product, variant=ci.variant,
                    quantity=ci.quantity, unit_price=ci.unit_price,
                    manual_unit_price=ci.manual_unit_price,
                    discount_amount=ci.discount_amount, tax_amount=ci.tax_amount,
                    line_total=line_total,
                    purchase_price=ci.purchase_price,
                )
                subtotal += line_total
                discount_total += ci.discount_amount
                tax_total += ci.tax_amount
                items_added += 1
            else:
                scanned = ci.scanned_barcodes or []
                # ATOMIC CHECK: Lock barcodes and verify availability inside transaction
                barcodes_qs = Barcode.objects.select_for_update().filter(
                    barcode__in=scanned, 
                    product=ci.product
                ).exclude(tag='sold')[:int(ci.quantity)]
                
                barcodes_list = list(barcodes_qs)
                if len(barcodes_list) < int(ci.quantity):
                    raise ValueError(f"Insufficient available barcodes for {ci.product.name}. Required {int(ci.quantity)}, found {len(barcodes_list)}.")
                
                for b_obj in barcodes_list:
                    InvoiceItem.objects.create(
                        invoice=invoice, product=ci.product, variant=ci.variant,
                        barcode=b_obj, quantity=Decimal('1.000'),
                        unit_price=ci.unit_price, manual_unit_price=ci.manual_unit_price,
                        discount_amount=pd, tax_amount=pt,
                        line_total=line_unit_total
                    )
                    b_obj.tag = 'sold'
                    b_obj.save(update_fields=['tag'])
                    invalidate_barcode_cache(b_obj)
                    
                    subtotal += line_unit_total
                    discount_total += pd
                    tax_total += pt
                    items_added += 1

        if items_added == 0 and not is_repair_shop:
            transaction.set_rollback(True)
            return Response({
                'error': 'Empty cart',
                'message': 'Cannot checkout: No valid items found in cart.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # 10. Finalize Totals & Payments
        invoice.subtotal = subtotal
        invoice.discount_amount = discount_total
        invoice.tax_amount = tax_total
        invoice.total = subtotal - discount_total + tax_total

        if invoice_type == 'pending':
            invoice.status = 'draft'
            # Calculate paid_amount based on actual payments (e.g. repair booking)
            invoice.paid_amount = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
            invoice.due_amount = invoice.total - invoice.paid_amount
        elif invoice_type == 'credit':
            invoice.status = 'credit'
            invoice.paid_amount = Decimal('0.00')
            invoice.due_amount = invoice.total
        elif invoice_type == 'mixed':
            if (cash_amount + upi_amount) != invoice.total:
                transaction.set_rollback(True)
                return Response({
                    'error': 'Payment mismatch',
                    'message': f'Split payment total mismatch: expected {invoice.total}, got {cash_amount + upi_amount}'
                }, status=status.HTTP_400_BAD_REQUEST)
            invoice.status = 'paid'
            invoice.paid_amount = invoice.total
            invoice.due_amount = Decimal('0.00')
            from backend.pos.models import Payment
            Payment.objects.create(invoice=invoice, payment_method='cash', amount=cash_amount, created_by=request.user)
            Payment.objects.create(invoice=invoice, payment_method='upi', amount=upi_amount, created_by=request.user)
        else: # cash/upi
            invoice.status = 'paid'
            invoice.paid_amount = invoice.total
            invoice.due_amount = Decimal('0.00')
            from backend.pos.models import Payment
            Payment.objects.create(invoice=invoice, payment_method=invoice_type, amount=invoice.total, created_by=request.user)
        
        invoice.save()

        # 11. Ledger
        if invoice.customer and invoice_type in ['pending', 'credit']:
            from backend.parties.models import LedgerEntry
            # Calculate total quantity for ledger
            total_qty = invoice.items.aggregate(total=Sum('quantity'))['total'] or Decimal('0.000')
            LedgerEntry.objects.create(
                customer=invoice.customer, invoice=invoice, entry_type='debit',
                amount=invoice.total, quantity=total_qty,
                description=f'Invoice {invoice.invoice_number} ({invoice_type.upper()})',
                created_by=request.user,
                created_at=timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, 'debit', invoice.total,
                f'Invoice {invoice.invoice_number} ({invoice_type.upper()})',
                request.user, timezone.now()
            )
            invoice.customer.credit_balance -= invoice.total
            invoice.customer.save()

        # 12. Settle Cart
        cart.status = 'completed'
        cart.save()

        # 13. Audit Log
        create_audit_log(
            request=request,
            action='cart_checkout',
            model_name='Invoice',
            object_id=str(invoice.id),
            object_name=f"Invoice {invoice.invoice_number}",
            object_reference=invoice.invoice_number,
            changes={
                'cart_id': cart.id,
                'invoice_type': invoice_type,
                'total': str(invoice.total),
                'items_count': items_added
            }
        )

        serializer = InvoiceSerializer(invoice)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    except ValueError as e:
        transaction.set_rollback(True)
        return Response({'error': 'Inventory Mismatch', 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        transaction.set_rollback(True)
        import traceback
        return Response({
            'error': 'Checkout Failed', 
            'message': str(e),
            'traceback': traceback.format_exc() if settings.DEBUG else None
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Invoice views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def invoice_list_create(request):
    """List all invoices or create a new invoice"""
    if request.method == 'GET':
        queryset = Invoice.objects.select_related('customer', 'store', 'created_by').prefetch_related('items', 'items__barcode', 'payments').all()
        date = request.query_params.get('date', None)
        store = request.query_params.get('store', None)
        customer = request.query_params.get('customer', None)
        status_filter = request.query_params.get('status', None)
        invoice_type_filter = request.query_params.get('invoice_type', None)
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        search = request.query_params.get('search', None)

        if date:
            queryset = queryset.filter(created_at__date=date)
        if search:
            queryset = queryset.filter(
                Q(invoice_number__icontains=search) | Q(customer__name__icontains=search)
            )
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        if store:
            queryset = queryset.filter(store_id=store)
        if customer:
            queryset = queryset.filter(customer_id=customer)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if invoice_type_filter:
            queryset = queryset.filter(invoice_type=invoice_type_filter)
        
        # Exclude defective invoices from regular invoice list (they appear in defective move-outs page)
        # Only exclude if not explicitly filtering by defective type
        if invoice_type_filter != 'defective':
            queryset = queryset.exclude(invoice_type='defective')

        # Exclude repair invoices (they appear on the Repairs page only)
        queryset = queryset.filter(repair__isnull=True)

        queryset = _with_invoice_amount_annotations(queryset)

        # In filtered mode, return all matching invoices without date-based pagination.
        # Default (unfiltered) mode keeps one-day-per-page behavior.
        has_active_filters = any([
            invoice_type_filter,
            date,
            search,
            date_from,
            date_to,
            store,
            customer,
            status_filter,
        ])

        if has_active_filters:
            order_by = 'created_at'
            queryset = queryset.order_by(order_by)
            serializer = InvoiceSerializer(
                queryset,
                many=True,
                context={'amount_profile': 'invoice_list'},
            )
            return Response({
                'results': serializer.data,
                'count': len(serializer.data),
                'next': None,
                'previous': None,
                'page': 1,
                'page_size': None,
                'total_pages': 1,
                'page_date': None,
            })

        ordering_param = request.query_params.get('ordering', '-created_at')
        if ordering_param == 'created_at':
            order_by = 'created_at'
            dates_order = 'day'
        else:
            order_by = '-created_at'
            dates_order = '-day'
        queryset = queryset.order_by(order_by)

        # Date-based pagination: each page = one day. Page 1 = oldest day when ordering asc, else most recent day.
        page = max(1, int(request.query_params.get('page', 1)))
        dates_qs = queryset.annotate(day=TruncDate('created_at')).values_list('day', flat=True).distinct().order_by(dates_order)
        dates_list = list(dates_qs)
        total_pages = len(dates_list) or 1
        page = min(page, total_pages)
        page_date = None
        if dates_list and 1 <= page <= len(dates_list):
            page_date = dates_list[page - 1]
            queryset = queryset.filter(created_at__date=page_date)

        serializer = InvoiceSerializer(
            queryset,
            many=True,
            context={'amount_profile': 'invoice_list'},
        )
        return Response({
            'results': serializer.data,
            'count': len(serializer.data),
            'next': page + 1 if page < total_pages else None,
            'previous': page - 1 if page > 1 else None,
            'page': page,
            'page_size': None,
            'total_pages': total_pages,
            'page_date': page_date.isoformat() if page_date else None,
        })
    else:  # POST
        serializer = InvoiceSerializer(data=request.data)
        if serializer.is_valid():
            invoice = serializer.save(created_by=request.user)
            
            # Audit log: Invoice created
            create_audit_log(
                request=request,
                action='invoice_create',
                model_name='Invoice',
                object_id=str(invoice.id),
                object_name=f"Invoice {invoice.invoice_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'invoice_number': invoice.invoice_number,
                    'invoice_type': invoice.invoice_type,
                    'status': invoice.status,
                    'total': str(invoice.total),
                    'customer': invoice.customer.name if invoice.customer else None,
                    'store': invoice.store.name if invoice.store else None,
                }
            )
            
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def invoice_detail(request, pk):
    """Retrieve, update or delete an invoice"""
    invoice = get_object_or_404(Invoice, pk=pk)
    
    if request.method == 'GET':
        serializer = InvoiceSerializer(invoice)
        return Response(serializer.data)
    elif request.method == 'PUT':
        # Only allow editing draft invoices (pending type)
        if invoice.status != 'draft' or invoice.invoice_type != 'pending':
            return Response(
                {'error': 'Only draft pending invoices can be edited'},
                status=status.HTTP_400_BAD_REQUEST
            )
        serializer = InvoiceSerializer(invoice, data=request.data)
        if serializer.is_valid():
            old_total = invoice.total
            serializer.save()
            # Recalculate totals after update
            update_invoice_totals(invoice)
            invoice.refresh_from_db()
            invoice.is_edited = True
            invoice.edited_on = timezone.now()
            invoice.save(update_fields=['is_edited', 'edited_on'])
            
            # Audit log: Invoice updated
            create_audit_log(
                request=request,
                action='invoice_update',
                model_name='Invoice',
                object_id=str(invoice.id),
                object_name=f"Invoice {invoice.invoice_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'invoice_number': invoice.invoice_number,
                    'invoice_type': invoice.invoice_type,
                    'status': invoice.status,
                    'total': {'old': str(old_total), 'new': str(invoice.total)},
                    'customer': invoice.customer.name if invoice.customer else None,
                }
            )
            
            return Response(InvoiceSerializer(invoice).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        # Check what fields are being updated
        update_fields = set(request.data.keys())
        allowed_fields_for_all = {'invoice_type', 'store', 'customer'}  # Fields that can be edited for any invoice
        
        # If updating only invoice_type, store, and/or customer, allow it for any invoice
        # Otherwise, only allow editing draft pending invoices
        if not update_fields.issubset(allowed_fields_for_all):
            # Updating other fields - only allow for draft pending invoices
            if invoice.status != 'draft' or invoice.invoice_type != 'pending':
                return Response(
                    {'error': 'Only draft pending invoices can be edited. You can only edit invoice_type, store, and customer for other invoices.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Track changes for audit log
        old_invoice_type = invoice.invoice_type
        old_store = invoice.store_id if invoice.store else None
        old_customer_id = invoice.customer_id
        old_customer_name = invoice.customer.name if invoice.customer else None
        
        serializer = InvoiceSerializer(invoice, data=request.data, partial=True)
        if serializer.is_valid():
            old_total = invoice.total
            old_invoice_type_for_recalc = invoice.invoice_type
            old_status = invoice.status
            old_paid_amount = invoice.paid_amount
            old_due_amount = invoice.due_amount
            serializer.save()
            
            # Always recalculate totals if invoice_type changed (totals depend on invoice_type)
            # Also recalculate if other fields changed (not just invoice_type/store)
            invoice.refresh_from_db()  # Refresh to get updated invoice_type
            invoice_type_changed = 'invoice_type' in request.data and old_invoice_type_for_recalc != invoice.invoice_type
            
            # If invoice_type changed to 'pending', delete payments and reset status/amounts
            if invoice_type_changed and invoice.invoice_type == 'pending':
                invoice.payments.all().delete()
                invoice.status = 'draft'
                invoice.paid_amount = Decimal('0.00')
                invoice.due_amount = invoice.total
                invoice.save()

            # If invoice_type changed to cash/upi/mixed, set status to paid (fully paid)
            if invoice_type_changed and invoice.invoice_type in ('cash', 'upi', 'mixed'):
                invoice.status = 'paid'
                invoice.paid_amount = invoice.total
                invoice.due_amount = Decimal('0.00')
                invoice.save()
            
            if invoice_type_changed or not update_fields.issubset(allowed_fields_for_all):
                update_invoice_totals(invoice)
                invoice.refresh_from_db()

            # When invoice_type changed to 'pending', remove this invoice from the ledger until "Move to Ledger" (mark credit).
            # Pending is draft; ledger is only updated when user explicitly moves to ledger.
            if invoice_type_changed and invoice.invoice_type == 'pending' and invoice.customer:
                from backend.parties.models import LedgerEntry
                existing_entries = LedgerEntry.objects.filter(invoice=invoice)
                net_reversal = Decimal('0.00')
                for e in existing_entries:
                    if e.entry_type == 'debit':
                        net_reversal += e.amount
                    else:
                        net_reversal -= e.amount
                reverse_internal_ledger_entries_for_ledger_entries(
                    existing_entries, request.user, 'Invoice type change'
                )
                existing_entries.delete()
                invoice.customer.credit_balance += net_reversal
                invoice.customer.save(update_fields=['credit_balance'])

            # When invoice_type changed to cash/upi/mixed (paid), update ledger: remove debt entry and add payment (credit)
            # so customer.credit_balance and ledger match (payments received via Ledger/Payments page also add credit entries)
            if invoice_type_changed and invoice.invoice_type in ('cash', 'upi', 'mixed') and invoice.customer:
                from backend.parties.models import LedgerEntry
                existing_entries = LedgerEntry.objects.filter(invoice=invoice)
                net_reversal = Decimal('0.00')
                for e in existing_entries:
                    if e.entry_type == 'debit':
                        net_reversal += e.amount
                    else:
                        net_reversal -= e.amount
                reverse_internal_ledger_entries_for_ledger_entries(
                    existing_entries, request.user, 'Invoice type change (settlement)'
                )
                existing_entries.delete()
                invoice.customer.credit_balance += net_reversal
                total_qty = invoice.items.aggregate(total=Sum('quantity'))['total'] or Decimal('0.000')
                LedgerEntry.objects.create(
                    customer=invoice.customer,
                    invoice=invoice,
                    entry_type='credit',
                    amount=invoice.total,
                    quantity=total_qty,
                    description=f'Invoice {invoice.invoice_number} ({invoice.invoice_type.upper()}) (Settlement)',
                    created_by=request.user,
                    created_at=timezone.now(),
                )
                create_internal_ledger_entry_if_mtshop(
                    invoice.customer, 'credit', invoice.total,
                    f'Invoice {invoice.invoice_number} ({invoice.invoice_type.upper()}) (Settlement)',
                    request.user, timezone.now()
                )
                invoice.customer.credit_balance += invoice.total
                invoice.customer.save(update_fields=['credit_balance'])

            # When invoice_type is updated, set the latest payment's payment_method to match
            if invoice_type_changed and invoice.invoice_type in ('cash', 'upi', 'mixed'):
                latest_payment = invoice.payments.order_by('-created_at').first()
                if latest_payment:
                    payment_method = 'cash' if invoice.invoice_type == 'cash' else 'upi' if invoice.invoice_type == 'upi' else 'other'
                    if latest_payment.payment_method != payment_method:
                        latest_payment.payment_method = payment_method
                        latest_payment.save(update_fields=['payment_method'])
            
            # Build changes dict for audit log
            changes = {}
            if 'invoice_type' in request.data and old_invoice_type != invoice.invoice_type:
                changes['invoice_type'] = {'old': old_invoice_type, 'new': invoice.invoice_type}
            if 'store' in request.data:
                new_store_id = invoice.store_id if invoice.store else None
                if old_store != new_store_id:
                    changes['store'] = {
                        'old': str(old_store) if old_store else None,
                        'new': str(new_store_id) if new_store_id else None
                    }
            if 'customer' in request.data and old_customer_id != (invoice.customer_id or None):
                new_customer_name = invoice.customer.name if invoice.customer else None
                changes['customer'] = {
                    'old': str(old_customer_id) if old_customer_id else None,
                    'old_name': old_customer_name,
                    'new': str(invoice.customer_id) if invoice.customer_id else None,
                    'new_name': new_customer_name,
                }
            # Track status change if invoice_type changed to pending
            if invoice_type_changed and invoice.invoice_type == 'pending' and old_status != invoice.status:
                changes['status'] = {'old': old_status, 'new': invoice.status}
                changes['paid_amount'] = {'old': str(old_paid_amount), 'new': '0.00'}
                changes['due_amount'] = {'old': str(old_due_amount), 'new': '0.00'}
            # Track status change when invoice_type changed to cash/upi/mixed (status -> paid)
            if invoice_type_changed and invoice.invoice_type in ('cash', 'upi', 'mixed') and old_status != invoice.status:
                changes['status'] = {'old': old_status, 'new': invoice.status}
                changes['paid_amount'] = {'old': str(old_paid_amount), 'new': str(invoice.paid_amount)}
                changes['due_amount'] = {'old': str(old_due_amount), 'new': str(invoice.due_amount)}
            # Include total changes if totals were recalculated
            if invoice_type_changed or not update_fields.issubset(allowed_fields_for_all):
                changes['total'] = {'old': str(old_total), 'new': str(invoice.total)}
            
            # Audit log: Invoice updated
            create_audit_log(
                request=request,
                action='invoice_update',
                model_name='Invoice',
                object_id=str(invoice.id),
                object_name=f"Invoice {invoice.invoice_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'invoice_number': invoice.invoice_number,
                    'invoice_type': invoice.invoice_type,
                    'status': invoice.status,
                    **changes
                }
            )
            invoice.is_edited = True
            invoice.edited_on = timezone.now()
            invoice.save(update_fields=['is_edited', 'edited_on'])
            
            return Response(InvoiceSerializer(invoice).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        # Allow deleting draft invoices and void invoices
        # For other invoices, require explicit confirmation via query parameter
        force = request.query_params.get('force', 'false').lower() == 'true'
        restore_stock = request.query_params.get('restore_stock', 'true').lower() == 'true'
        
        if invoice.status not in ['draft', 'void']:
            # For non-draft, non-void invoices, check if deletion is explicitly requested
            if not force:
                return Response(
                    {'error': 'Cannot delete non-draft, non-void invoices without force parameter. Add ?force=true to confirm deletion.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Wrap all mutations in a single atomic transaction to prevent partial state
        with transaction.atomic():
            # Re-fetch invoice with lock to prevent concurrent modifications
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)

            # Reverse stock changes if requested and invoice was not draft
            if restore_stock and invoice.status != 'draft' and invoice.store:
                for item in invoice.items.all():
                    # Reverse stock for both tracked and non-tracked products
                    # Use select_for_update to prevent concurrent stock modifications
                    stock, created = Stock.objects.select_for_update().get_or_create(
                        product=item.product,
                        variant=item.variant,
                        store=invoice.store,
                        defaults={'quantity': Decimal('0.000')}
                    )
                    stock.quantity += item.quantity
                    stock.save()
            
            # Unmark barcodes as sold (change back to 'new') when restore_stock is true
            # This applies to ALL invoices when items are returned to stock
            if restore_stock:
                for item in invoice.items.all():
                    if item.barcode:
                        # Mark tracked product barcode as 'new' (fresh)
                        old_tag = item.barcode.tag
                        item.barcode.tag = 'new'
                        item.barcode.save(update_fields=['tag'])
                        invalidate_barcode_cache(item.barcode)
                        
                        # Audit log: Barcode tag changed (sold -> new)
                        create_audit_log(
                            request=request,
                            action='barcode_tag_change',
                            model_name='Barcode',
                            object_id=str(item.barcode.id),
                            object_name=item.product.name,
                            object_reference=invoice.invoice_number,
                            barcode=item.barcode.barcode,
                            changes={
                                'tag': {'old': old_tag, 'new': 'new'},
                                'barcode': item.barcode.barcode,
                                'product_id': item.product.id,
                                'product_name': item.product.name,
                                'invoice_id': invoice.id,
                                'invoice_number': invoice.invoice_number,
                                'context': 'invoice_deleted_stock_restored',
                            }
                        )
                    elif not item.product.track_inventory:
                        # For non-tracked products, restore product barcode to 'new'
                        product_barcode = item.product.barcodes.first()
                        if product_barcode:
                            old_tag = product_barcode.tag
                            product_barcode.tag = 'new'
                            product_barcode.save(update_fields=['tag'])
                            invalidate_barcode_cache(product_barcode)
                            
                            # Audit log: Product barcode tag changed
                            create_audit_log(
                                request=request,
                                action='barcode_tag_change',
                                model_name='Barcode',
                                object_id=str(product_barcode.id),
                                object_name=item.product.name,
                                object_reference=invoice.invoice_number,
                                barcode=product_barcode.barcode,
                                changes={
                                    'tag': {'old': old_tag, 'new': 'new'},
                                    'barcode': product_barcode.barcode,
                                    'product_id': item.product.id,
                                    'product_name': item.product.name,
                                    'invoice_id': invoice.id,
                                    'invoice_number': invoice.invoice_number,
                                    'context': 'invoice_deleted_stock_restored',
                                }
                            )
            
            # Reverse ledger entries if customer exists (always reverse ledger entries)
            if invoice.customer:
                from backend.parties.models import LedgerEntry
                # Find all ledger entries for this invoice
                ledger_entries = LedgerEntry.objects.filter(invoice=invoice)
                reverse_internal_ledger_entries_for_ledger_entries(
                    ledger_entries, request.user, 'Invoice deleted'
                )
                for entry in ledger_entries:
                    # Reverse the entry (if debit, credit it back; if credit, debit it back)
                    reverse_type = 'credit' if entry.entry_type == 'debit' else 'debit'
                    reverse_amount = entry.amount
                    
                    # Update customer credit_balance
                    if entry.entry_type == 'debit':
                        # Original was debit (customer owes), so credit it back (customer paid)
                        invoice.customer.credit_balance += reverse_amount
                    else:
                        # Original was credit (customer paid), so debit it back (customer owes)
                        invoice.customer.credit_balance -= reverse_amount
                    
                    invoice.customer.save()
                
                # Delete all ledger entries for this invoice
                ledger_entries.delete()
            
            # Audit log: Invoice deleted
            invoice_number = invoice.invoice_number
            invoice_id = str(invoice.id)
            items_summary = [f"{item.product.name} x{item.quantity}" for item in invoice.items.all()]
            
            # Delete the invoice (this will cascade delete invoice items and payments)
            invoice.delete()
            
            create_audit_log(
                request=request,
                action='delete',
                model_name='Invoice',
                object_id=invoice_id,
                object_name=f"Invoice {invoice_number}",
                object_reference=invoice_number,
                barcode=None,
                changes={
                    'invoice_number': invoice_number,
                    'items_count': len(items_summary),
                    'items': items_summary,
                    'total': str(invoice.total),
                    'status': invoice.status,
                }
            )
        
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST', 'PATCH'])
@permission_classes([IsAuthenticated])
def invoice_payments(request, pk):
    """Add payment to invoice or update an existing payment."""
    invoice = get_object_or_404(Invoice, pk=pk)
    if request.method == 'PATCH':
        payment_id = request.data.get('payment_id')
        if not payment_id:
            return Response(
                {'error': 'payment_id is required to update a payment'},
                status=status.HTTP_400_BAD_REQUEST
            )

        payment = get_object_or_404(Payment, pk=payment_id, invoice=invoice)
        old_amount = payment.amount or Decimal('0.00')
        old_method = payment.payment_method
        old_reference = payment.reference
        old_notes = payment.notes
        old_paid_amount = invoice.paid_amount or Decimal('0.00')
        old_due_amount = invoice.due_amount or Decimal('0.00')
        old_status = invoice.status

        serializer = PaymentSerializer(payment, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        payment.refresh_from_db()

        # Keep invoice summary fields in sync with edited payment amount.
        invoice.paid_amount = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
        invoice.due_amount = invoice.total - invoice.paid_amount
        if invoice.status == 'credit' or invoice.invoice_type in ('pending', 'credit'):
            # Invoices moved to ledger should remain credit while dues are settled.
            invoice.status = 'credit'
        elif invoice.due_amount <= Decimal('0.00'):
            invoice.status = 'paid'
        elif invoice.paid_amount > Decimal('0.00'):
            invoice.status = 'partial'
        else:
            invoice.status = 'draft'
        invoice.save(update_fields=['paid_amount', 'due_amount', 'status'])

        amount_delta = payment.amount - old_amount
        if invoice.customer and amount_delta != Decimal('0.00'):
            from backend.parties.models import LedgerEntry
            entry_type = 'credit' if amount_delta > Decimal('0.00') else 'debit'
            LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type=entry_type,
                amount=abs(amount_delta),
                description=f'Payment adjustment for Invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, entry_type, abs(amount_delta),
                f'Payment adjustment for Invoice {invoice.invoice_number}',
                request.user, timezone.now()
            )
            # Credit entry increases balance, debit entry decreases it.
            invoice.customer.credit_balance += amount_delta
            invoice.customer.save(update_fields=['credit_balance'])

        create_audit_log(
            request=request,
            action='payment_update',
            model_name='Payment',
            object_id=str(payment.id),
            object_name=f"Payment for Invoice {invoice.invoice_number}",
            object_reference=invoice.invoice_number,
            barcode=None,
            changes={
                'payment_id': payment.id,
                'invoice_id': invoice.id,
                'amount': {'old': str(old_amount), 'new': str(payment.amount)},
                'payment_method': {'old': old_method, 'new': payment.payment_method},
                'reference': {'old': old_reference, 'new': payment.reference},
                'notes': {'old': old_notes, 'new': payment.notes},
                'invoice_status': {'old': old_status, 'new': invoice.status},
                'paid_amount': {'old': str(old_paid_amount), 'new': str(invoice.paid_amount)},
                'due_amount': {'old': str(old_due_amount), 'new': str(invoice.due_amount)},
            }
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    serializer = PaymentSerializer(data={**request.data, 'invoice': invoice.id})
    if serializer.is_valid():
        payment = serializer.save(created_by=request.user)
        
        # Update invoice paid amount
        old_paid = invoice.paid_amount or Decimal('0.00')
        invoice.paid_amount = old_paid + payment.amount
        invoice.due_amount = invoice.total - invoice.paid_amount
        
        # Update invoice status
        old_status = invoice.status
        if invoice.status == 'credit' or invoice.invoice_type in ('pending', 'credit'):
            # Invoices moved to ledger should remain credit while dues are settled.
            invoice.status = 'credit'
        elif invoice.due_amount <= Decimal('0.00'):
            invoice.status = 'paid'
        elif invoice.paid_amount > Decimal('0.00'):
            invoice.status = 'partial'
        invoice.save()
        
        # Audit log: Payment added
        create_audit_log(
            request=request,
            action='payment_add',
            model_name='Payment',
            object_id=str(payment.id),
            object_name=f"Payment for Invoice {invoice.invoice_number}",
            object_reference=invoice.invoice_number,
            barcode=None,
            changes={
                'payment_id': payment.id,
                'invoice_id': invoice.id,
                'invoice_number': invoice.invoice_number,
                'amount': str(payment.amount),
                'payment_method': payment.payment_method,
                'invoice_status': {'old': old_status, 'new': invoice.status},
                'paid_amount': {'old': str(old_paid), 'new': str(invoice.paid_amount)},
                'due_amount': str(invoice.due_amount),
            }
        )
        
        # Create ledger entry for payment (CREDIT - customer paying their debt)
        if invoice.customer:
            from backend.parties.models import LedgerEntry
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=payment.amount,
                description=f'Payment for Invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, 'credit', payment.amount,
                f'Payment for Invoice {invoice.invoice_number}',
                request.user, timezone.now()
            )
            # Update customer credit_balance
            invoice.customer.credit_balance += entry.amount
            invoice.customer.save()
        
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_void(request, pk):
    """Void an invoice"""
    invoice = get_object_or_404(Invoice, pk=pk)
    invoice.status = 'void'
    invoice.voided_at = timezone.now()
    invoice.voided_by = request.user
    invoice.save()
    
    # Audit log: Invoice voided
    items_summary = [f"{item.product.name} x{item.quantity}" for item in invoice.items.all()]
    create_audit_log(
        request=request,
        action='invoice_void',
        model_name='Invoice',
        object_id=str(invoice.id),
        object_name=f"Invoice {invoice.invoice_number}",
        object_reference=invoice.invoice_number,
        barcode=None,
        changes={
            'invoice_number': invoice.invoice_number,
            'invoice_type': invoice.invoice_type,
            'total': str(invoice.total),
            'items_count': invoice.items.count(),
            'items': items_summary,
            'customer': invoice.customer.name if invoice.customer else None,
        }
    )
    
    return Response({'status': 'voided'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_checkout(request, pk):
    """Checkout a pending invoice - convert to sale/credit/pending invoice and update stock"""
    invoice = get_object_or_404(Invoice, pk=pk)

    # If invoice is already paid, return success with message (idempotent)
    if invoice.status == 'paid' or (invoice.status == 'partial' and invoice.due_amount <= Decimal('0.00')):
        return Response(
            {'message': 'Invoice already checked out'},
            status=status.HTTP_200_OK
        )

    # Only allow checkout for pending draft invoices
    if invoice.invoice_type != 'pending' or invoice.status != 'draft':
        return Response(
            {'error': 'Only draft pending invoices can be checked out'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    if not invoice.items.exists():
        return Response({'error': 'Invoice has no items'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Get new invoice type from request (default to 'pending' for draft saving)
    new_invoice_type = request.data.get('invoice_type', 'pending')
    if new_invoice_type not in ['cash', 'upi', 'pending', 'mixed', 'credit']:
        return Response(
            {'error': 'Invalid invoice_type. Must be cash, upi, pending, mixed, or credit'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # For mixed payments, get split amounts
    cash_amount = request.data.get('cash_amount', None)
    upi_amount = request.data.get('upi_amount', None)
    
    # Validate split payments for mixed type
    if new_invoice_type == 'mixed':
        if cash_amount is None or upi_amount is None:
            return Response({
                'error': 'Both cash_amount and upi_amount are required for mixed payment type'
            }, status=status.HTTP_400_BAD_REQUEST)
        cash_amount = Decimal(str(cash_amount))
        upi_amount = Decimal(str(upi_amount))
    
    # Allow updating item prices and quantities from request data if provided
    # This allows manual price entry and quantity changes during checkout
    items_data = request.data.get('items', [])
    if items_data:
        for item_data in items_data:
            item_id = item_data.get('id')
            if item_id:
                try:
                    item = invoice.items.get(id=item_id)
                    # Update quantity if provided
                    if 'quantity' in item_data:
                        new_quantity = Decimal(str(item_data['quantity']))
                        if new_quantity <= 0:
                            # Delete item if quantity is 0 or negative
                            item.delete()
                            continue
                        item.quantity = new_quantity
                    # Update prices if provided
                    if 'unit_price' in item_data:
                        item.unit_price = Decimal(str(item_data['unit_price']))
                    if 'manual_unit_price' in item_data:
                        item.manual_unit_price = Decimal(str(item_data['manual_unit_price'])) if item_data['manual_unit_price'] else None
                    if 'purchase_price' in item_data:
                        raw = item_data['purchase_price']
                        try:
                            val = Decimal(str(raw)) if raw not in (None, '') else None
                            item.purchase_price = val if val is not None and val > 0 else None
                        except (TypeError, ValueError):
                            item.purchase_price = None
                    if 'discount_amount' in item_data:
                        item.discount_amount = Decimal(str(item_data['discount_amount']))
                    if 'tax_amount' in item_data:
                        item.tax_amount = Decimal(str(item_data['tax_amount']))
                    
                    # Recalculate line_total
                    price = item.manual_unit_price or item.unit_price
                    item.line_total = item.quantity * price - item.discount_amount + item.tax_amount
                    item.save()
                except InvoiceItem.DoesNotExist:
                    pass
    
    # For Sale/Credit invoices, validate that all items have prices
    if new_invoice_type in ['cash', 'upi', 'mixed', 'credit']:
        items_without_price = []
        for item in invoice.items.all():
            effective_price = item.manual_unit_price or item.unit_price
            if not effective_price or effective_price == 0:
                items_without_price.append({
                    'id': item.id,
                    'product_name': item.product.name,
                    'product_sku': item.product.sku
                })
        
        if items_without_price:
            return Response({
                'error': 'All items must have a selling price for Sale/Credit invoices',
                'message': f'{len(items_without_price)} item(s) are missing prices',
                'items_without_price': items_without_price
            }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate price threshold for all invoice types (including pending/draft)
    # Check if sale price is below purchase/selling price threshold
    price_validation_errors = []
    for item in invoice.items.all():
        effective_price = item.manual_unit_price or item.unit_price
        # Only validate if price is set and greater than 0
        if effective_price and effective_price > 0:
            # Use purchase_price as the floor — selling at cost (break even) is allowed
            purchase_price = Decimal('0.00')
            if item.product.name and item.product.name.startswith('Other -') and item.purchase_price is not None and item.purchase_price > 0:
                purchase_price = item.purchase_price
            elif item.barcode:
                purchase_price = item.barcode.get_purchase_price()
            elif not item.product.track_inventory:
                product_barcode = item.product.barcodes.first()
                if product_barcode:
                    purchase_price = product_barcode.get_purchase_price()
            
            min_price = purchase_price
            can_go_below = item.product.can_go_below_purchase_price
            
            if not can_go_below and min_price > 0 and effective_price < min_price:
                price_validation_errors.append({
                    'id': item.id,
                    'product_name': item.product.name,
                    'product_sku': item.product.sku,
                    'sale_price': str(effective_price),
                    'min_price': str(min_price),
                    'price_type': 'purchase price'
                })
    
    if price_validation_errors:
        error_messages = [
            f"{err['product_name']} (SKU: {err['product_sku']}): Sale price (₹{err['sale_price']}) cannot be less than {err['price_type']} (₹{err['min_price']})"
            for err in price_validation_errors
        ]
        return Response({
            'error': 'Price validation failed',
            'message': '\n'.join(error_messages),
            'price_validation_errors': price_validation_errors
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Update stock for all items (decrease stock as items are being sold)
    # Update stock for SALE and CREDIT invoices (not PENDING)
    # For non-tracked products: Stock was already decremented when item was added to cart/invoice
    # For tracked products: Stock needs to be decremented per barcode
    # Also mark barcodes as sold (for tracked products only)
    # Update stock for all items (ONLY for tracked items if they weren't already marked as sold)
    # Actually, stock for BOTH tracked and non-tracked items should be deducted when added to cart.
    # So we should NOT deduct stock again here in invoice_checkout.
    # The only thing we need to do is ensure the Barcode tag is set to 'sold'.
    if new_invoice_type in ['cash', 'upi', 'mixed', 'credit']:
        for item in invoice.items.all():
            # Mark barcode as sold when checking out as sale/credit invoice
            if item.barcode:
                # For tracked products: mark the item's barcode as 'sold'
                item.barcode.tag = 'sold'
                item.barcode.save()
            elif not item.product.track_inventory:
                # For non-tracked products: mark the product's barcode as 'sold'
                product_barcode = item.product.barcodes.first()
                if product_barcode and product_barcode.tag == 'new':
                    product_barcode.tag = 'sold'
                    product_barcode.save()
    # Now recalculate invoice totals with actual prices
    update_invoice_totals(invoice)
    invoice.refresh_from_db()
    
    # Handle checkout based on invoice type
    old_invoice_type = invoice.invoice_type
    old_status = invoice.status
    
    if new_invoice_type == 'pending':
        # For pending: Just save prices, keep as draft, don't checkout
        invoice.status = 'draft'
        # Calculate paid_amount based on actual payments (e.g. repair booking)
        invoice.paid_amount = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
        invoice.due_amount = invoice.total - invoice.paid_amount
        invoice.save()
    elif new_invoice_type == 'credit':
        invoice.invoice_type = new_invoice_type
        invoice.status = 'credit'
        invoice.paid_amount = Decimal('0.00')
        invoice.due_amount = invoice.total
        invoice.save()

        if invoice.customer:
            from backend.parties.models import LedgerEntry
            total_qty = invoice.items.aggregate(total=Sum('quantity'))['total'] or Decimal('0.000')
            LedgerEntry.objects.create(
                customer=invoice.customer, invoice=invoice, entry_type='debit',
                amount=invoice.total, quantity=total_qty,
                description=f'Invoice {invoice.invoice_number} (CREDIT)',
                created_by=request.user,
                created_at=timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, 'debit', invoice.total,
                f'Invoice {invoice.invoice_number} (CREDIT)',
                request.user, timezone.now()
            )
            invoice.customer.credit_balance -= invoice.total
            invoice.customer.save()
    elif new_invoice_type == 'mixed':
        # Validate split payments match total
        if cash_amount + upi_amount != invoice.total:
            return Response({
                'error': f'Split payment amounts (₹{cash_amount + upi_amount}) do not match invoice total (₹{invoice.total})'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Actually checkout - update invoice type, mark as paid, update stock
        invoice.invoice_type = new_invoice_type
        invoice.status = 'paid'
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        invoice.save()
        
        # In mixed mode, we assume the amounts provided ARE the final split.
        # We should delete old payments for this invoice to avoid duplication in mixed mode
        # as the user explicitly provided the full split now.
        invoice.payments.all().delete()
        
        # Create Payment records for split payments
        from backend.pos.models import Payment
        Payment.objects.create(
            invoice=invoice,
            payment_method='cash',
            amount=cash_amount,
            created_by=request.user
        )
        Payment.objects.create(
            invoice=invoice,
            payment_method='upi',
            amount=upi_amount,
            created_by=request.user
        )
    else:
        # Calculate remaining due to avoid duplicating payments (e.g. if booking amount exists)
        current_paid = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
        remaining_due = invoice.total - current_paid
        
        # For cash/upi: Actually checkout - update invoice type, mark as paid, update stock
        invoice.invoice_type = new_invoice_type
        invoice.status = 'paid'
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        invoice.save()
        
        # Create Payment record ONLY for the remaining balance
        if remaining_due > 0:
            from backend.pos.models import Payment
            Payment.objects.create(
                invoice=invoice,
                payment_method=new_invoice_type,  # 'cash' or 'upi'
                amount=remaining_due,
                notes=f'Final payment for {new_invoice_type.upper()} checkout',
                created_by=request.user
            )
    
    # Audit log: Invoice checkout (pending to paid conversion)
    items_summary = [f"{item.product.name} x{item.quantity}" for item in invoice.items.all()]
    create_audit_log(
        request=request,
        action='invoice_checkout',
        model_name='Invoice',
        object_id=str(invoice.id),
        object_name=f"Invoice {invoice.invoice_number}",
        object_reference=invoice.invoice_number,
        barcode=None,
        changes={
            'invoice_number': invoice.invoice_number,
            'invoice_type': {'old': old_invoice_type, 'new': new_invoice_type},
            'status': {'old': old_status, 'new': invoice.status},
            'total': str(invoice.total),
            'paid_amount': str(invoice.paid_amount),
            'items_count': invoice.items.count(),
            'items': items_summary,
            'customer': invoice.customer.name if invoice.customer else None,
        }
    )
    
    # Update ledger entry if customer exists
    if invoice.customer:
        from backend.parties.models import LedgerEntry

        # Calculate total quantity for ledger (Sum imported at top of file)
        total_qty = invoice.items.aggregate(total=Sum('quantity'))['total'] or Decimal('0.000')
        
        # 1. Calculate net effect of existing entries for this invoice to reverse it
        existing_entries = LedgerEntry.objects.filter(invoice=invoice)
        # ... reversal logic remains same ...
        net_reversal = Decimal('0.00')
        for e in existing_entries:
            if e.entry_type == 'debit':
                net_reversal += e.amount # Re-add what was subtracted
            else:
                net_reversal -= e.amount # Subtract what was added
        
        # 2. Reverse internal ledger for deleted entries, then delete and update balance
        reverse_internal_ledger_entries_for_ledger_entries(
            existing_entries, request.user, 'Invoice type change'
        )
        existing_entries.delete()
        invoice.customer.credit_balance += net_reversal
        
        # 3. Create fresh entries based on the new state
        entry_debit = LedgerEntry.objects.create(
            customer=invoice.customer,
            invoice=invoice,
            entry_type='debit',
            amount=invoice.total,
            quantity=total_qty,
            description=f'Invoice {invoice.invoice_number} ({new_invoice_type.upper()}) (Purchase)',
            created_by=request.user,
            created_at=invoice.created_at or timezone.now()
        )
        create_internal_ledger_entry_if_mtshop(
            invoice.customer, 'debit', invoice.total,
            f'Invoice {invoice.invoice_number} ({new_invoice_type.upper()}) (Purchase)',
            request.user, invoice.created_at or timezone.now()
        )
        invoice.customer.credit_balance -= entry_debit.amount
        
        # IF it's now paid, create a CREDIT entry (Payment)
        if new_invoice_type in ['cash', 'upi', 'mixed']:
            entry_credit = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=invoice.total,
                quantity=total_qty,
                description=f'Invoice {invoice.invoice_number} ({new_invoice_type.upper()}) (Settlement)',
                created_by=request.user,
                created_at=timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, 'credit', invoice.total,
                f'Invoice {invoice.invoice_number} ({new_invoice_type.upper()}) (Settlement)',
                request.user, timezone.now()
            )
            invoice.customer.credit_balance += entry_credit.amount
            
        invoice.customer.save()
    
    # If this invoice is linked to a repair: optionally update delivery_date from request; auto-set status when received
    try:
        repair = invoice.repair
        if repair:
            if 'delivery_date' in request.data:
                v = request.data.get('delivery_date')
                if v is None or v == '':
                    repair.delivery_date = None
                else:
                    try:
                        from datetime import datetime
                        repair.delivery_date = datetime.strptime(str(v).strip()[:10], '%Y-%m-%d').date()
                    except (ValueError, TypeError):
                        pass
            if invoice.items.exists() and repair.status == 'received':
                repair.status = 'work_in_progress'
            repair.save()
    except Repair.DoesNotExist:
        pass
    
    serializer = InvoiceSerializer(invoice)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_edit(request, pk):
    """Create an edit cart from an invoice so user can modify items. All invoice types/statuses allowed except void."""
    invoice = get_object_or_404(Invoice.objects.select_related('store', 'customer'), pk=pk)
    if invoice.status == 'void':
        return Response(
            {'error': 'Void invoices cannot be edited'},
            status=status.HTTP_400_BAD_REQUEST
        )
    cart_number = f'EDIT-{uuid.uuid4().hex[:8]}'
    while Cart.objects.filter(cart_number=cart_number).exists():
        cart_number = f'EDIT-{uuid.uuid4().hex[:8]}'
    cart = Cart.objects.create(
        cart_number=cart_number,
        store=invoice.store,
        customer=invoice.customer,
        created_by=request.user,
        invoice_type=invoice.invoice_type,
        status='active'
    )
    for inv_item in invoice.items.select_related('product', 'variant', 'barcode').all():
        scanned = [inv_item.barcode.barcode] if inv_item.barcode else []
        CartItem.objects.create(
            cart=cart,
            product=inv_item.product,
            variant=inv_item.variant,
            quantity=inv_item.quantity,
            unit_price=inv_item.unit_price,
            manual_unit_price=inv_item.manual_unit_price,
            purchase_price=inv_item.purchase_price,
            discount_amount=inv_item.discount_amount,
            tax_amount=inv_item.tax_amount,
            scanned_barcodes=scanned
        )
    create_audit_log(
        request=request,
        action='invoice_edit',
        model_name='Invoice',
        object_id=str(invoice.id),
        object_name=f"Invoice {invoice.invoice_number}",
        object_reference=invoice.invoice_number,
        barcode=None,
        changes={'invoice_number': invoice.invoice_number, 'cart_id': cart.id},
    )
    return Response({'cart_id': cart.id}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_update(request, pk):
    """Update invoice from an edit cart: replace items and recalc totals."""
    invoice = get_object_or_404(Invoice.objects.select_related('store'), pk=pk)
    cart_id = request.data.get('cart_id')
    if not cart_id:
        return Response({'error': 'cart_id is required'}, status=status.HTTP_400_BAD_REQUEST)
    cart = get_object_or_404(Cart, pk=cart_id)
    if invoice.status == 'void':
        return Response(
            {'error': 'Void invoices cannot be updated'},
            status=status.HTTP_400_BAD_REQUEST
        )
    # Capture old line items for audit log (before we delete them)
    old_items_for_audit = []
    for inv_item in invoice.items.select_related('product').all():
        old_items_for_audit.append({
            'product_id': inv_item.product_id,
            'product_name': inv_item.product.name if inv_item.product else None,
            'quantity': str(inv_item.quantity),
            'unit_price': str(inv_item.manual_unit_price or inv_item.unit_price or '0'),
        })
    new_items_for_audit = []

    # Barcode values that remain in the edit cart (will be re-assigned to invoice); do not revert these to 'new'
    barcodes_staying = set()
    for ci in cart.items.all():
        if ci.scanned_barcodes:
            barcodes_staying.update(ci.scanned_barcodes)

    with transaction.atomic():
        for inv_item in list(invoice.items.select_related('barcode').all()):
            # Restore stock when deleting old items (since cart_update will deduct them again)
            if invoice.store:
                stock, created = Stock.objects.get_or_create(
                    product=inv_item.product,
                    variant=inv_item.variant,
                    store=invoice.store,
                    defaults={'quantity': Decimal('0.000')}
                )
                Stock.objects.filter(id=stock.id).update(
                    quantity=F('quantity') + inv_item.quantity
                )

            # Only revert to 'new' barcodes that are being removed (not in the edit cart)
            if inv_item.barcode and inv_item.barcode.barcode not in barcodes_staying:
                inv_item.barcode.tag = 'new'
                inv_item.barcode.save(update_fields=['tag'])
            
            inv_item.delete()
        sold_barcode_ids_inv = set(
            InvoiceItem.objects.exclude(invoice__status='void')
            .exclude(barcode_id__isnull=True)
            .values_list('barcode_id', flat=True)
        )
        subtotal = Decimal('0.00')
        discount_total = Decimal('0.00')
        tax_total = Decimal('0.00')
        for cart_item in cart.items.select_related('product', 'variant').all():
            if cart_item.quantity <= Decimal('0.000'):
                continue
            effective_price = cart_item.manual_unit_price or cart_item.unit_price or Decimal('0.00')
            per_unit_discount = cart_item.discount_amount / cart_item.quantity if cart_item.quantity > 0 else Decimal('0.00')
            per_unit_tax = cart_item.tax_amount / cart_item.quantity if cart_item.quantity > 0 else Decimal('0.00')
            unit_line_total = effective_price - per_unit_discount + per_unit_tax
            # Custom products ("Other - ...") and non-tracked products: no barcode required
            is_custom_or_non_tracked = (
                not cart_item.product.track_inventory
                or (cart_item.product.name and cart_item.product.name.startswith('Other -'))
            )
            if is_custom_or_non_tracked:
                line_total = unit_line_total * cart_item.quantity
                InvoiceItem.objects.create(
                    invoice=invoice,
                    product=cart_item.product,
                    variant=cart_item.variant,
                    barcode=None,
                    quantity=cart_item.quantity,
                    unit_price=cart_item.unit_price,
                    manual_unit_price=cart_item.manual_unit_price,
                    discount_amount=cart_item.discount_amount,
                    tax_amount=cart_item.tax_amount,
                    line_total=line_total,
                    purchase_price=cart_item.purchase_price,
                )
                # Deduct stock for the new item in non-tracked mode
                if invoice.store:
                    reduce_stock_for_cart_item(cart_item.product, cart_item.variant_id, invoice.store, cart_item.quantity)
                new_items_for_audit.append({
                    'product_id': cart_item.product_id,
                    'product_name': cart_item.product.name if cart_item.product else None,
                    'quantity': str(cart_item.quantity),
                    'unit_price': str(cart_item.manual_unit_price or cart_item.unit_price or '0'),
                })
                subtotal += line_total
                discount_total += cart_item.discount_amount
                tax_total += cart_item.tax_amount
                continue
            scanned = list(cart_item.scanned_barcodes) if cart_item.scanned_barcodes else []
            barcodes_to_assign = list(
                Barcode.objects.filter(product=cart_item.product, barcode__in=scanned)
            ) if scanned else []
            barcodes_to_assign = [
                b for b in barcodes_to_assign
                if b.tag in ('new', 'returned', 'in-cart') or (b.tag == 'sold' and b.id not in sold_barcode_ids_inv)
            ]
            # STRICT MODE: ONLY use the exact barcodes from scanned_barcodes
            # If the number of scanned barcodes does not match the quantity requested, return an error
            # This prevents "auto-assigning" random barcodes that weren't actually scanned.
            quantity_needed = int(cart_item.quantity)
            if len(barcodes_to_assign) < quantity_needed:
                return Response({
                    'error': 'Incomplete barcode scans',
                    'message': f'Product "{cart_item.product.name}" requires {quantity_needed} scans, but only {len(barcodes_to_assign)} valid barcodes were scanned.'
                }, status=status.HTTP_400_BAD_REQUEST)
            elif len(barcodes_to_assign) > quantity_needed:
                 barcodes_to_assign = barcodes_to_assign[:quantity_needed]
            for barcode_obj in barcodes_to_assign:
                line_total = unit_line_total
                inv_item = InvoiceItem.objects.create(
                    invoice=invoice,
                    product=cart_item.product,
                    variant=cart_item.variant,
                    barcode=barcode_obj,
                    quantity=Decimal('1.000'),
                    unit_price=cart_item.unit_price,
                    manual_unit_price=cart_item.manual_unit_price,
                    discount_amount=per_unit_discount,
                    tax_amount=per_unit_tax,
                    line_total=line_total,
                    purchase_price=cart_item.purchase_price,
                )
                # Deduct stock for the new barcode in tracked mode
                if invoice.store:
                    reduce_stock_for_cart_item(cart_item.product, cart_item.variant_id, invoice.store, Decimal('1.000'))
                barcode_obj.tag = 'sold'
                barcode_obj.save(update_fields=['tag'])
                subtotal += line_total
                discount_total += inv_item.discount_amount
                tax_total += inv_item.tax_amount
            # One audit entry per product line (tracked: multiple barcode rows = one line)
            new_items_for_audit.append({
                'product_id': cart_item.product_id,
                'product_name': cart_item.product.name if cart_item.product else None,
                'quantity': str(cart_item.quantity),
                'unit_price': str(cart_item.manual_unit_price or cart_item.unit_price or '0'),
            })
        invoice.subtotal = subtotal
        invoice.discount_amount = discount_total
        invoice.tax_amount = tax_total
        invoice.total = subtotal - discount_total + tax_total

        # Keep payment rows and invoice summary in sync after item edits.
        if invoice.invoice_type in ('cash', 'upi', 'mixed') and invoice.status in ('paid', 'partial'):
            synced_paid_amount = sync_invoice_payments_to_total(invoice)
            if synced_paid_amount > Decimal('0.00'):
                invoice.paid_amount = synced_paid_amount

        invoice.due_amount = invoice.total - invoice.paid_amount
        invoice.status = 'paid' if invoice.due_amount <= Decimal('0.00') else 'partial'
        invoice.save()
    # Do not call update_invoice_totals here: for draft pending it would zero totals;
    # we have already set subtotal/total/due_amount from the new items above.
    invoice.refresh_from_db()

    # Delete the edit cart so it does not appear on POS
    cart.delete()

    invoice.is_edited = True
    invoice.edited_on = timezone.now()
    invoice.save(update_fields=['is_edited', 'edited_on'])

    create_audit_log(
        request=request,
        action='invoice_update',
        model_name='Invoice',
        object_id=str(invoice.id),
        object_name=f"Invoice {invoice.invoice_number}",
        object_reference=invoice.invoice_number,
        barcode=None,
        changes={
            'invoice_number': invoice.invoice_number,
            'cart_id': cart_id,
            'total': str(invoice.total),
            'old_items': old_items_for_audit,
            'new_items': new_items_for_audit,
        }
    )
    return Response(InvoiceSerializer(invoice).data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_mark_credit(request, pk):
    """Mark an invoice as credit and create ledger entry"""
    from django.db import transaction
    
    # Use transaction to ensure atomicity
    with transaction.atomic():
        # Use select_for_update to prevent race conditions
        invoice = Invoice.objects.select_for_update().get(pk=pk)
        
            # Allow: draft pending/credit (convert or save and move), or paid cash/upi/mixed (move to ledger / mark as credit)
        draft_ok = invoice.status == 'draft' and invoice.invoice_type in ('pending', 'credit')
        paid_ok = invoice.status == 'paid' and invoice.invoice_type in ('cash', 'upi', 'mixed')
        if not (draft_ok or paid_ok):
            return Response(
                {'error': 'Only draft pending, draft credit, or paid (cash/upi/mixed) invoices can be marked as credit'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not invoice.items.exists():
            return Response({'error': 'Invoice has no items'}, status=status.HTTP_400_BAD_REQUEST)
    
        # Allow updating item prices and quantities from request data if provided
        # This allows manual price entry from the checkout modal
        items_data = request.data.get('items', [])
        if items_data:
            for item_data in items_data:
                item_id = item_data.get('id')
                if item_id:
                    try:
                        item = invoice.items.get(id=item_id)
                        # Update quantity if provided
                        if 'quantity' in item_data:
                            new_quantity = Decimal(str(item_data['quantity']))
                            if new_quantity <= 0:
                                # Delete item if quantity is 0 or negative
                                item.delete()
                                continue
                            item.quantity = new_quantity
                        # Update prices if provided
                        if 'unit_price' in item_data:
                            item.unit_price = Decimal(str(item_data['unit_price']))
                        if 'manual_unit_price' in item_data:
                            item.manual_unit_price = Decimal(str(item_data['manual_unit_price'])) if item_data['manual_unit_price'] else None
                        if 'discount_amount' in item_data:
                            item.discount_amount = Decimal(str(item_data['discount_amount']))
                        if 'tax_amount' in item_data:
                            item.tax_amount = Decimal(str(item_data['tax_amount']))
                        if 'purchase_price' in item_data:
                            raw = item_data['purchase_price']
                            try:
                                val = Decimal(str(raw)) if raw not in (None, '') else None
                                item.purchase_price = val if val is not None and val > 0 else None
                            except (TypeError, ValueError):
                                item.purchase_price = None
                        
                        # Recalculate line_total
                        price = item.manual_unit_price or item.unit_price
                        item.line_total = item.quantity * price - item.discount_amount + item.tax_amount
                        item.save()
                    except InvoiceItem.DoesNotExist:
                        pass
        
        # Validate that all items have prices
        items_without_price = []
        for item in invoice.items.all():
            effective_price = item.manual_unit_price or item.unit_price
            if not effective_price or effective_price == 0:
                items_without_price.append({
                    'id': item.id,
                    'product_name': item.product.name,
                    'product_sku': item.product.sku
                })
        
        if items_without_price:
            return Response({
                'error': 'All items must have a selling price to mark invoice as credit',
                'message': f'{len(items_without_price)} item(s) are missing prices',
                'items_without_price': items_without_price
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate invoice has a customer
        if not invoice.customer:
            return Response(
                {'error': 'Invoice must have a customer assigned to mark as credit'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # If this invoice is linked to a repair: optionally update delivery_date from request (same as checkout)
        try:
            repair = invoice.repair
            if repair:
                if 'delivery_date' in request.data:
                    v = request.data.get('delivery_date')
                    if v is None or v == '':
                        repair.delivery_date = None
                    else:
                        try:
                            from datetime import datetime
                            repair.delivery_date = datetime.strptime(str(v).strip()[:10], '%Y-%m-%d').date()
                        except (ValueError, TypeError):
                            pass
                if invoice.items.exists() and repair.status == 'received':
                    repair.status = 'work_in_progress'
                repair.save()
        except Repair.DoesNotExist:
            pass
        
        # Update invoice status and type to credit (before recalculating totals)
        # This ensures update_invoice_totals calculates correctly and type matches status
        old_status = invoice.status
        invoice.status = 'credit'
        invoice.invoice_type = 'credit'
        # Save the status/type change immediately
        invoice.save()
        
        # Now recalculate invoice totals (status is 'credit', so it will calculate from items)
        update_invoice_totals(invoice)
        invoice.refresh_from_db()
        
        # Ensure status is still 'credit' after refresh (should be, but double-check)
        if invoice.status != 'credit':
            invoice.status = 'credit'
            invoice.save()
            invoice.refresh_from_db()
        
        # Validate invoice total is greater than 0
        if invoice.total <= 0:
            # If total is 0, revert status change
            invoice.status = old_status
            invoice.save()
            return Response(
                {'error': 'Invoice total must be greater than 0 to mark as credit'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Set due_amount and paid_amount
        # Calculate paid_amount based on actual payments
        invoice.paid_amount = invoice.payments.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
        invoice.due_amount = invoice.total - invoice.paid_amount
        # Ensure status remains 'credit' when saving final values
        invoice.status = 'credit'
        invoice.save()
        
        # Final refresh to ensure all fields are current
        invoice.refresh_from_db()
        
        # Final verification - if status is not credit, something went wrong
        if invoice.status != 'credit':
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Invoice {invoice.invoice_number} status is {invoice.status} after mark_credit, expected credit')
            invoice.status = 'credit'
            invoice.save()
            invoice.refresh_from_db()
        
        # Create or update ledger entry (customer is guaranteed to exist at this point)
        try:
            from backend.parties.models import LedgerEntry
            # Get all existing ledger entries for this invoice
            existing_entries = LedgerEntry.objects.filter(invoice=invoice)
            
            # Calculate net balance to reverse from existing entries
            # If we had a Debit of 1000 (which subtracted 1000 from balance), we should ADD 1000 to reverse it.
            # If we had a Credit of 1000 (which added 1000 to balance), we should SUBTRACT 1000 to reverse it.
            net_balance_to_reverse = Decimal('0.00')
            for entry in existing_entries:
                if entry.entry_type == 'debit':
                    net_balance_to_reverse += entry.amount
                else:  # credit
                    net_balance_to_reverse -= entry.amount
            
            # Mirror reversals to internal ledger (MT SHOP customers) before deleting main ledger entries
            reverse_internal_ledger_entries_for_ledger_entries(
                existing_entries, request.user, 'Mark as credit (replace entries)'
            )
            # Delete all existing entries for this invoice
            # We'll create a single clean DEBIT entry for the credit invoice
            existing_entries.delete()
            
            # Reverse the net balance effect on customer credit_balance
            invoice.customer.credit_balance += net_balance_to_reverse
            
            # Create a single DEBIT entry for the credit invoice
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='debit',
                amount=invoice.total,
                description=f'Credit Invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=invoice.created_at or timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, 'debit', invoice.total,
                f'Credit Invoice {invoice.invoice_number}',
                request.user, invoice.created_at or timezone.now()
            )
            # Update customer credit_balance (debit means customer owes more)
            invoice.customer.credit_balance -= entry.amount
            invoice.customer.save()
            
            # Final verification: Ensure invoice status is 'credit' and ledger entry exists
            invoice.refresh_from_db()
            if invoice.status != 'credit':
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f'Invoice {invoice.invoice_number} status is {invoice.status} after creating ledger entry, forcing to credit')
                invoice.status = 'credit'
                invoice.save()
            
            # Verify ledger entry was created
            verify_entry = LedgerEntry.objects.filter(invoice=invoice, entry_type='debit').first()
            if not verify_entry:
                import logging
                logger = logging.getLogger(__name__)
                logger.error(f'Ledger entry not found for invoice {invoice.invoice_number} after creation')
                return Response(
                    {'error': 'Failed to create ledger entry - entry not found after creation'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
        except Exception as e:
            # Log the error and return a proper error response
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Error creating ledger entry for invoice {invoice.invoice_number}: {str(e)}')
            import traceback
            logger.error(traceback.format_exc())
            return Response(
                {'error': f'Failed to create ledger entry: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        # Final refresh to get the absolute latest state from database
        invoice.refresh_from_db()
        
        # One last check - if status is not credit, force it
        if invoice.status != 'credit':
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Invoice {invoice.invoice_number} status is {invoice.status} before returning response, forcing to credit')
            invoice.status = 'credit'
            invoice.save()
            invoice.refresh_from_db()
        
        # Audit log
        create_audit_log(
            request=request,
            action='invoice_mark_credit',
            model_name='Invoice',
            object_id=str(invoice.id),
            object_name=f"Invoice {invoice.invoice_number}",
            object_reference=invoice.invoice_number,
            barcode=None,
            changes={
                'invoice_number': invoice.invoice_number,
                'status': {'old': 'draft', 'new': 'credit'},
                'invoice_type': invoice.invoice_type,
                'total': str(invoice.total),
                'due_amount': str(invoice.due_amount),
                'customer': invoice.customer.name if invoice.customer else None,
            }
        )
        
        # Return the invoice with updated status
        serializer = InvoiceSerializer(invoice)
        response_data = serializer.data
        # Ensure status is 'credit' in the response
        response_data['status'] = 'credit'
        return Response(response_data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_return(request, pk):
    """Create return for an invoice"""
    invoice = get_object_or_404(Invoice, pk=pk)
    # Create return
    return Response({'message': 'Return functionality to be implemented'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_exchange(request, pk):
    """Create exchange for an invoice"""
    invoice = get_object_or_404(Invoice, pk=pk)
    # Create exchange
    return Response({'message': 'Exchange functionality to be implemented'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_items(request, pk):
    """Add item to invoice"""
    invoice = get_object_or_404(Invoice, pk=pk)
    
    # Only restrict for void invoices - allow adding items to non-void
    # (pending/credit/other) invoices so they can be edited.
    if invoice.status == 'void':
        return Response(
            {'error': 'Items cannot be added to void invoices'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    item_data = request.data.copy()
    custom_product_name = item_data.get('custom_product_name')
    if custom_product_name:
        from backend.catalog.utils import generate_unique_sku
        product_name = f"Other - {custom_product_name.strip()}"
        try:
            product = Product.objects.get(name=product_name)
        except Product.DoesNotExist:
            product = Product.objects.create(
                name=product_name,
                sku=generate_unique_sku(product_name),
                track_inventory=False,
                can_go_below_purchase_price=True,
                is_active=True
            )
            create_audit_log(
                request=request,
                action='create',
                model_name='Product',
                object_id=str(product.id),
                object_name=product.name,
                object_reference=product.sku,
                barcode=None,
                changes={'name': product.name, 'sku': product.sku, 'track_inventory': False, 'custom_product': True}
            )
        item_data['product'] = product.id
        item_data.pop('custom_product_name', None)
    
    # For pending invoices, set prices to 0
    if invoice.invoice_type == 'pending':
        item_data['unit_price'] = Decimal('0.00')
        item_data['manual_unit_price'] = None
        item_data['discount_amount'] = Decimal('0.00')
        item_data['tax_amount'] = Decimal('0.00')
    
    # Resolve barcode from request: barcode_id (FK) or raw barcode string.
    # After this block, item_data['barcode'] is either a valid Barcode PK (int) or absent.
    requested_barcode_id = request.data.get('barcode_id') or item_data.get('barcode_id')
    raw_barcode_value = request.data.get('barcode') or item_data.get('barcode')

    # Remove keys that the serializer doesn't understand (it expects 'barcode' as FK int)
    item_data.pop('barcode_id', None)
    item_data.pop('barcode', None)

    resolved_barcode_obj = None

    if requested_barcode_id:
        try:
            resolved_barcode_obj = Barcode.objects.get(pk=requested_barcode_id)
        except (Barcode.DoesNotExist, ValueError, TypeError):
            pass

    if not resolved_barcode_obj and raw_barcode_value:
        barcode_clean = str(raw_barcode_value).strip().upper()
        try:
            resolved_barcode_obj = Barcode.objects.get(barcode=barcode_clean)
        except Barcode.DoesNotExist:
            try:
                resolved_barcode_obj = Barcode.objects.get(short_code=barcode_clean)
            except Barcode.DoesNotExist:
                pass
        if not resolved_barcode_obj:
            return Response(
                {'error': f'Barcode "{barcode_clean}" not found.'},
                status=status.HTTP_404_NOT_FOUND
            )

    if resolved_barcode_obj and item_data.get('product'):
        product_id = item_data.get('product')
        if resolved_barcode_obj.product_id != product_id:
            return Response(
                {'error': 'Barcode does not belong to this product.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if resolved_barcode_obj.tag not in ['new', 'returned']:
            return Response(
                {'error': 'This barcode is not available (already sold or in use).'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if invoice.items.filter(barcode=resolved_barcode_obj).exists():
            return Response(
                {'error': 'This barcode is already on this invoice.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if InvoiceItem.objects.filter(barcode=resolved_barcode_obj).exclude(
            invoice__status='void'
        ).exclude(invoice=invoice).exists():
            return Response(
                {'error': 'This barcode is already sold on another invoice.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        item_data['barcode'] = resolved_barcode_obj.id
    
    serializer = InvoiceItemSerializer(data=item_data)
    if serializer.is_valid():
        item = serializer.save(invoice=invoice)
        
        # For pending invoices, ensure prices are 0
        if invoice.invoice_type == 'pending':
            item.unit_price = Decimal('0.00')
            item.manual_unit_price = None
            item.discount_amount = Decimal('0.00')
            item.tax_amount = Decimal('0.00')
        
        # Calculate line_total
        quantity = item.quantity
        price = item.manual_unit_price or item.unit_price
        item.line_total = quantity * price - item.discount_amount + item.tax_amount
        item.save()
        
        # Find and assign barcode for this item (if quantity is 1)
        # Mark barcodes as sold when assigned to invoice items (same as cart_checkout)
        if item.quantity == Decimal('1.000') and not item.barcode:
            # Get all barcodes already in this invoice (to avoid duplicates)
            invoice_barcodes = set()
            for inv_item in invoice.items.exclude(id=item.id):
                if inv_item.barcode:
                    invoice_barcodes.add(inv_item.barcode.barcode)
            
            # Find available barcodes (new, not sold, not in invoice)
            available_barcodes = Barcode.objects.filter(
                product=item.product,
                variant=item.variant,
                tag='new'  # Only new barcodes
            ).exclude(
                barcode__in=invoice_barcodes
            )
            
            # Exclude barcodes that are already sold
            sold_barcode_ids = InvoiceItem.objects.filter(
                barcode__in=available_barcodes.values_list('id', flat=True)
            ).exclude(
                invoice__status='void'
            ).exclude(
                invoice__invoice_type='pending',
                invoice__status='draft'
            ).values_list('barcode_id', flat=True)
            
            available_barcodes = available_barcodes.exclude(id__in=sold_barcode_ids)
            
            # Never guess when multiple barcodes exist: require client to send barcode_id (exact scan/selection).
            available_count = available_barcodes.count()
            if available_count > 1:
                item.delete()  # Remove the item we just created so invoice stays consistent
                return Response(
                    {
                        'error': 'Multiple barcodes available for this product.',
                        'message': 'Please scan or search by short code/barcode so the exact unit is assigned. Do not add by product only when multiple units exist.',
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
            if available_count == 1:
                barcode_obj = available_barcodes.get()
            else:
                barcode_obj = None
            
            if barcode_obj:
                item.barcode = barcode_obj
                item.save()
                old_tag = barcode_obj.tag
                barcode_obj.tag = 'sold'
                barcode_obj.save(update_fields=['tag'])
                create_audit_log(
                    request=request,
                    action='barcode_tag_change',
                    model_name='Barcode',
                    object_id=str(barcode_obj.id),
                    object_name=item.product.name,
                    object_reference=invoice.invoice_number,
                    barcode=barcode_obj.barcode,
                    changes={
                        'tag': {'old': old_tag, 'new': 'sold'},
                        'barcode': barcode_obj.barcode,
                        'product_id': item.product.id,
                        'product_name': item.product.name,
                        'invoice_id': invoice.id,
                        'invoice_number': invoice.invoice_number,
                        'context': 'invoice_item_added',
                    }
                )
        elif item.quantity == Decimal('1.000') and item.barcode:
            # Barcode was passed from frontend (exact scan) — mark as sold
            barcode_obj = item.barcode
            if barcode_obj.tag in ['new', 'returned']:
                old_tag = barcode_obj.tag
                barcode_obj.tag = 'sold'
                barcode_obj.save(update_fields=['tag'])
                create_audit_log(
                    request=request,
                    action='barcode_tag_change',
                    model_name='Barcode',
                    object_id=str(barcode_obj.id),
                    object_name=item.product.name,
                    object_reference=invoice.invoice_number,
                    barcode=barcode_obj.barcode,
                    changes={
                        'tag': {'old': old_tag, 'new': 'sold'},
                        'barcode': barcode_obj.barcode,
                        'product_id': item.product.id,
                        'product_name': item.product.name,
                        'invoice_id': invoice.id,
                        'invoice_number': invoice.invoice_number,
                        'context': 'invoice_item_added',
                    }
                )
        
        # Update invoice totals
        update_invoice_totals(invoice)
        
        # If this invoice is linked to a repair, auto-set status to work_in_progress when first product is added (was received)
        try:
            repair = invoice.repair
            if repair and repair.status == 'received':
                repair.status = 'work_in_progress'
                repair.save(update_fields=['status'])
        except Repair.DoesNotExist:
            pass
        
        # Don't decrease stock for draft invoices - stock will be updated on checkout
        
        return Response(InvoiceItemSerializer(item).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def invoice_item_detail(request, pk, item_id):
    """Update or delete invoice item"""
    invoice = get_object_or_404(Invoice, pk=pk)
    
    # Only allow editing items in draft invoices (credit or pending)
    if invoice.status != 'draft' or invoice.invoice_type not in ['pending', 'credit']:
        return Response(
            {'error': 'Items can only be edited in draft credit or pending invoices'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        item = InvoiceItem.objects.get(id=item_id, invoice=invoice)
    except InvoiceItem.DoesNotExist:
        return Response({'error': 'Invoice item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    old_quantity = item.quantity
    
    if request.method == 'DELETE':
        # Mark barcode as 'new' when item is removed from invoice
        # This allows the barcode to be available for sale again
        if item.barcode:
            old_tag = item.barcode.tag
            item.barcode.tag = 'new'
            item.barcode.save(update_fields=['tag'])
            
            # Audit log: Barcode tag changed (sold -> new)
            create_audit_log(
                request=request,
                action='barcode_tag_change',
                model_name='Barcode',
                object_id=str(item.barcode.id),
                object_name=item.product.name,
                object_reference=invoice.invoice_number,
                barcode=item.barcode.barcode,
                changes={
                    'tag': {'old': old_tag, 'new': 'new'},
                    'barcode': item.barcode.barcode,
                    'product_id': item.product.id,
                    'product_name': item.product.name,
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'context': 'invoice_item_removed',
                }
            )
        
        # Don't update stock for draft invoices - stock hasn't been decreased yet
        item.delete()
        
        # Update invoice totals
        update_invoice_totals(invoice)
        invoice.is_edited = True
        invoice.edited_on = timezone.now()
        invoice.save(update_fields=['is_edited', 'edited_on'])
        
        return Response(status=status.HTTP_204_NO_CONTENT)
    
    # PATCH - Update item
    # For pending invoices, allow price updates
    update_data = request.data.copy()
    
    serializer = InvoiceItemSerializer(item, data=update_data, partial=True)
    if serializer.is_valid():
        updated_item = serializer.save()
        
        # Calculate line_total
        quantity = updated_item.quantity
        price = updated_item.manual_unit_price or updated_item.unit_price
        updated_item.line_total = quantity * price - updated_item.discount_amount + updated_item.tax_amount
        updated_item.save()
        
        # Don't update stock for draft invoices - stock will be updated on checkout
        
        # Update invoice totals
        update_invoice_totals(invoice)
        invoice.is_edited = True
        invoice.edited_on = timezone.now()
        invoice.save(update_fields=['is_edited', 'edited_on'])
        
        return Response(InvoiceItemSerializer(updated_item).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def update_invoice_totals(invoice):
    """Helper function to recalculate invoice totals"""
    items = invoice.items.all()
    
    subtotal = sum(item.line_total for item in items)
    invoice.subtotal = subtotal
    invoice.total = subtotal - invoice.discount_amount + invoice.tax_amount
    invoice.due_amount = invoice.total - invoice.paid_amount
    
    invoice.save()


def sync_invoice_payments_to_total(invoice):
    """Scale non-refund payment rows to match invoice.total exactly."""
    sale_payments = list(
        invoice.payments.exclude(payment_method='refund').order_by('created_at', 'id')
    )
    if not sale_payments:
        return Decimal('0.00')

    old_total = sum((payment.amount for payment in sale_payments), Decimal('0.00'))
    target_total = (invoice.total or Decimal('0.00')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if old_total <= Decimal('0.00'):
        # Fallback: set the first row to the full amount and zero out the rest.
        first_payment, *remaining_payments = sale_payments
        if first_payment.amount != target_total:
            first_payment.amount = target_total
            first_payment.save(update_fields=['amount'])
        for payment in remaining_payments:
            if payment.amount != Decimal('0.00'):
                payment.amount = Decimal('0.00')
                payment.save(update_fields=['amount'])
        return target_total

    running_total = Decimal('0.00')
    for payment in sale_payments[:-1]:
        scaled_amount = (
            payment.amount * target_total / old_total
        ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        running_total += scaled_amount
        if payment.amount != scaled_amount:
            payment.amount = scaled_amount
            payment.save(update_fields=['amount'])

    last_payment = sale_payments[-1]
    last_amount = (target_total - running_total).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    if last_payment.amount != last_amount:
        last_payment.amount = last_amount
        last_payment.save(update_fields=['amount'])

    return target_total


# Credit Note views
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_note_list(request):
    """List all credit notes"""
    credit_notes = CreditNote.objects.select_related(
        'return_obj', 'return_obj__invoice', 'return_obj__invoice__customer', 'created_by'
    ).order_by('-created_at')
    
    # Optional filtering
    invoice_id = request.query_params.get('invoice_id')
    if invoice_id:
        credit_notes = credit_notes.filter(return_obj__invoice_id=invoice_id)
    
    customer_id = request.query_params.get('customer_id')
    if customer_id:
        credit_notes = credit_notes.filter(return_obj__invoice__customer_id=customer_id)
    
    serializer = CreditNoteSerializer(credit_notes, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_note_detail(request, pk):
    """Retrieve a credit note with nested return and items."""
    from django.db.models import Prefetch
    credit_note = get_object_or_404(
        CreditNote.objects.select_related(
            'return_obj', 'return_obj__invoice', 'return_obj__invoice__customer', 'created_by'
        ).prefetch_related(
            Prefetch(
                'return_obj__items',
                queryset=ReturnItem.objects.select_related(
                    'product', 'product__brand', 'barcode',
                    'invoice_item', 'invoice_item__product', 'invoice_item__product__brand'
                )
            )
        ),
        pk=pk
    )
    serializer = CreditNoteDetailSerializer(credit_note)
    return Response(serializer.data)


# Return views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def return_list_create(request):
    """List all returns or create a new return"""
    if request.method == 'GET':
        returns = Return.objects.all()
        serializer = ReturnSerializer(returns, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = ReturnSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(created_by=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def return_detail(request, pk):
    """Retrieve, update or delete a return"""
    return_obj = get_object_or_404(Return, pk=pk)
    
    if request.method == 'GET':
        serializer = ReturnSerializer(return_obj)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = ReturnSerializer(return_obj, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = ReturnSerializer(return_obj, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        return_obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def expense_list_create(request):
    """List all expenses or create a new expense."""
    if request.method == 'GET':
        if not request.user.groups.filter(name='Super').exists():
            return Response({'error': 'Only Super group can view expense listings.'}, status=status.HTTP_403_FORBIDDEN)

        queryset = Expenses.objects.select_related('created_by', 'last_updated_by').order_by('-expense_date', '-created_on')
        search = (request.query_params.get('search') or '').strip()
        payment_type = (request.query_params.get('payment_type') or '').strip().upper()
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        if search:
            queryset = queryset.filter(
                Q(expense_type__icontains=search)
                | Q(lender_name__icontains=search)
                | Q(borrower_name__icontains=search)
            )
        if payment_type in {'CASH', 'ONLINE'}:
            queryset = queryset.filter(payment_choices_type=payment_type)
        if date_from:
            queryset = queryset.filter(expense_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(expense_date__lte=date_to)

        serializer = ExpenseSerializer(queryset, many=True)
        return Response(serializer.data)

    serializer = ExpenseSerializer(data=request.data)
    if serializer.is_valid():
        expense = serializer.save(created_by=request.user, last_updated_by=request.user)
        return Response(ExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def expense_type_suggestions(request):
    """Return distinct expense types for autocomplete suggestions."""
    if not request.user.groups.filter(name='Super').exists():
        return Response({'results': []})

    q = (request.query_params.get('q') or '').strip()
    queryset = Expenses.objects.exclude(expense_type__isnull=True).exclude(expense_type__exact='')
    if q:
        queryset = queryset.filter(expense_type__icontains=q)

    suggestions = list(
        queryset.order_by('expense_type').values_list('expense_type', flat=True).distinct()[:10]
    )
    return Response({'results': suggestions})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def expense_borrower_suggestions(request):
    """Return distinct borrower names for autocomplete suggestions."""
    if not request.user.groups.filter(name='Super').exists():
        return Response({'results': []})

    q = (request.query_params.get('q') or '').strip()
    queryset = Expenses.objects.exclude(borrower_name__isnull=True).exclude(borrower_name__exact='')
    if q:
        queryset = queryset.filter(borrower_name__icontains=q)

    suggestions = list(
        queryset.order_by('borrower_name').values_list('borrower_name', flat=True).distinct()[:10]
    )
    return Response({'results': suggestions})


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def expense_detail(request, pk):
    """Retrieve, update, or delete an expense."""
    if request.method == 'GET' and not request.user.groups.filter(name='Super').exists():
        return Response({'error': 'Only Super group can view expense listings.'}, status=status.HTTP_403_FORBIDDEN)

    expense = get_object_or_404(Expenses.objects.select_related('created_by', 'last_updated_by'), pk=pk)

    if request.method == 'GET':
        serializer = ExpenseSerializer(expense)
        return Response(serializer.data)

    if request.method == 'DELETE':
        expense.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    partial = request.method == 'PATCH'
    serializer = ExpenseSerializer(expense, data=request.data, partial=partial)
    if serializer.is_valid():
        serializer.save(last_updated_by=request.user)
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def return_credit_note(request, pk):
    """Create credit note for a return"""
    return_obj = get_object_or_404(Return, pk=pk)
    amount = request.data.get('amount', 0)
    credit_note = CreditNote.objects.create(
        return_obj=return_obj,
        amount=amount,
        created_by=request.user
    )
    return Response(CreditNoteSerializer(credit_note).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def return_refund(request, pk):
    """Process refund for a return"""
    return_obj = get_object_or_404(Return, pk=pk)
    # Process refund
    return Response({'message': 'Refund functionality to be implemented'})


# Replacement Module views
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_check(request):
    """Check if a product/barcode is replaceable (was sold) - searches by SKU in invoice items"""
    try:
        barcode_value = request.data.get('barcode')
        sku = request.data.get('sku')
        product_id = request.data.get('product_id')
        
        # If barcode_value is provided but no sku, use barcode_value as sku too
        if barcode_value and not sku:
            sku = barcode_value
        
        if not barcode_value and not sku and not product_id:
            return Response({'error': 'Barcode, SKU, or product ID is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Try to find product by barcode, SKU, or ID
        product = None
        barcode_obj = None
        
        if barcode_value:
            barcode_clean = str(barcode_value).strip().upper()
            barcode_obj = None
            try:
                barcode_obj = Barcode.objects.select_related('product').get(barcode=barcode_clean)
            except Barcode.DoesNotExist:
                try:
                    barcode_obj = Barcode.objects.select_related('product').get(short_code=barcode_clean)
                except Barcode.DoesNotExist:
                    pass
            if barcode_obj:
                product = barcode_obj.product

        # Search for invoice items by SKU first (even if product not found in catalog)
        # This is the key: search invoice items directly by SKU or by barcode
        invoice_items_by_sku = None
        if sku:
            try:
                # Search invoice items by product SKU (case-insensitive, trim whitespace)
                sku_clean = sku.strip()
                invoice_items_by_sku = InvoiceItem.objects.filter(
                    product__sku__iexact=sku_clean
                ).exclude(
                    product__sku__isnull=True
                ).exclude(
                    product__sku=''
                ).select_related('product', 'invoice', 'invoice__store', 'invoice__customer', 'barcode')
                
                # Exact match on barcode if no results by SKU (standardize to .upper())
                if not invoice_items_by_sku.exists():
                    invoice_items_by_sku = InvoiceItem.objects.filter(
                        barcode__barcode=sku_clean.upper()
                    ).exclude(
                        barcode__isnull=True
                    ).select_related('product', 'invoice', 'invoice__store', 'invoice__customer', 'barcode')
                
                if invoice_items_by_sku.exists():
                    # Get product from first invoice item
                    first_item = invoice_items_by_sku.first()
                    product = first_item.product
                    # Get barcode if available
                    if first_item.barcode and not barcode_obj:
                        barcode_obj = first_item.barcode
            except Exception as e:
                # Log error but continue
                import logging
                logger = logging.getLogger(__name__)
                logger.error(f'Error searching invoice items by SKU: {str(e)}')
                import traceback
                logger.error(traceback.format_exc())
        
        # If still no product, try to find in catalog
        if not product and sku:
            # Try cache first
            from backend.core.model_cache import get_cached_product_by_sku, cache_product_data
            sku_clean = sku.strip()
            cached_product = get_cached_product_by_sku(sku_clean.upper()) or get_cached_product_by_sku(sku_clean.lower())
            
            if cached_product:
                try:
                    product = Product.objects.get(id=cached_product['id'], is_active=True)
                except Product.DoesNotExist:
                    product = None
            else:
                # Cache miss - fetch from database
                try:
                    product = Product.objects.get(sku__iexact=sku_clean, is_active=True)
                    # Cache the result
                    try:
                        cache_product_data(product)
                    except Exception:
                        pass
                except Product.DoesNotExist:
                    # Try cache first for variant SKU
                    from backend.core.model_cache import get_cached_product_by_variant_sku, cache_product_variant_sku
                    cached_variant = get_cached_product_by_variant_sku(sku_clean.upper()) or get_cached_product_by_variant_sku(sku_clean.lower())
                    
                    if cached_variant:
                        try:
                            product = Product.objects.get(id=cached_variant['product_id'], is_active=True)
                        except Product.DoesNotExist:
                            product = None
                    else:
                        # Cache miss - fetch from database
                        try:
                            variant = ProductVariant.objects.get(sku__iexact=sku_clean)
                            product = variant.product
                            if product:
                                try:
                                    cache_product_data(product)
                                    cache_product_variant_sku(variant)
                                except Exception:
                                    pass
                        except ProductVariant.DoesNotExist:
                            pass
                except Product.MultipleObjectsReturned:
                    # If multiple products with same SKU (shouldn't happen but handle it)
                    product = Product.objects.filter(sku__iexact=sku_clean, is_active=True).first()
                    if product:
                        try:
                            cache_product_data(product)
                        except Exception:
                            pass
        
        if not product and product_id:
            try:
                product = Product.objects.get(pk=product_id)
            except Product.DoesNotExist:
                pass
        
        # Check if product exists in any invoice items
        invoice_items = None
        if invoice_items_by_sku and invoice_items_by_sku.exists():
            invoice_items = invoice_items_by_sku
        elif product:
            invoice_items = InvoiceItem.objects.filter(product=product).select_related('product', 'invoice', 'invoice__store', 'invoice__customer', 'barcode')
            if barcode_obj:
                # Also check variant if barcode has variant
                if barcode_obj.variant:
                    invoice_items = invoice_items.filter(variant=barcode_obj.variant)
        
        if invoice_items and invoice_items.exists():
            # Get the most recent invoice item (or first one)
            invoice_item = invoice_items.order_by('-invoice__created_at').first()
            invoice = invoice_item.invoice
            
            # Ensure we have product info
            if not product:
                product = invoice_item.product
            
            # Get barcode from invoice item if not already set
            if not barcode_obj and invoice_item.barcode:
                barcode_obj = invoice_item.barcode
            
            return Response({
                'replaceable': True,
                'message': 'Product is replaceable',
                'product': {
                    'id': product.id,
                    'name': product.name,
                    'sku': product.sku,
                },
                'barcode': barcode_obj.barcode if barcode_obj else None,
                'barcode_id': barcode_obj.id if barcode_obj else None,
                'invoice_item': {
                    'id': invoice_item.id,
                    'quantity': str(invoice_item.quantity),
                    'unit_price': str(invoice_item.unit_price),
                    'line_total': str(invoice_item.line_total),
                    'barcode_id': invoice_item.barcode.id if invoice_item.barcode else None,
                    'barcode': invoice_item.barcode.barcode if invoice_item.barcode else None,
                },
                'invoice': {
                    'id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'created_at': invoice.created_at.isoformat(),
                    'store_name': invoice.store.name if invoice.store else None,
                    'customer_name': invoice.customer.name if invoice.customer else None,
                },
                'invoice_count': invoice_items.count(),
            })
        else:
            return Response({
                'replaceable': False,
                'message': 'Cannot be replaced (unsold or theft product)',
                'product': {
                    'id': product.id,
                    'name': product.name,
                    'sku': product.sku,
                } if product else None
            })
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f'Error in replacement_check: {str(e)}', exc_info=True)
        return Response({
            'error': f'Error checking product: {str(e)}',
            'replaceable': False,
            'message': 'Failed to check product'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_create(request):
    """Create a replacement entry - mark barcode as UNKNOWN (don't update inventory)"""
    barcode_value = request.data.get('barcode')
    
    if not barcode_value:
        return Response({'error': 'Barcode is required'}, status=status.HTTP_400_BAD_REQUEST)

    # Standardize and exact match: try barcode then short_code (never .first())
    barcode_clean = str(barcode_value).strip().upper()
    barcode_obj = None
    try:
        barcode_obj = Barcode.objects.get(barcode=barcode_clean)
    except Barcode.DoesNotExist:
        try:
            barcode_obj = Barcode.objects.get(short_code=barcode_clean)
        except Barcode.DoesNotExist:
            pass
    if not barcode_obj:
        return Response({'error': 'Barcode not found'}, status=status.HTTP_404_NOT_FOUND)

    # Mark barcode as UNKNOWN - don't update inventory
    old_tag = barcode_obj.tag
    barcode_obj.tag = 'unknown'
    barcode_obj.save()
    
    # Audit log: Replacement created
    create_audit_log(
        request=request,
        action='replacement_create',
        model_name='Barcode',
        object_id=str(barcode_obj.id),
        object_name=barcode_obj.product.name if barcode_obj.product else 'Unknown Product',
        object_reference=barcode_obj.product.sku if barcode_obj.product else None,
        barcode=barcode_obj.barcode,
        changes={
            'tag': {'old': old_tag, 'new': 'unknown'},
            'barcode': barcode_obj.barcode,
            'product_id': barcode_obj.product.id if barcode_obj.product else None,
            'product_name': barcode_obj.product.name if barcode_obj.product else None,
            'reason': 'Replacement initiated - marked as unknown',
        }
    )
    
    return Response({
        'message': 'Product marked as returned (UNKNOWN tag)',
        'barcode': barcode_obj.barcode,
        'tag': barcode_obj.tag,
        'product': {
            'id': barcode_obj.product.id if barcode_obj.product else None,
            'name': barcode_obj.product.name if barcode_obj.product else None,
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_update_tag(request, barcode_id):
    """Update barcode tag (RETURNED/DEFECTIVE) and handle inventory accordingly"""
    barcode_obj = get_object_or_404(Barcode, pk=barcode_id)
    new_tag = request.data.get('tag')
    store_id = request.data.get('store_id')
    
    if new_tag not in ['returned', 'defective']:
        return Response({'error': 'Tag must be "returned" or "defective"'}, status=status.HTTP_400_BAD_REQUEST)
    
    old_tag = barcode_obj.tag
    barcode_obj.tag = new_tag
    barcode_obj.save()
    
    # Audit log: Barcode tag updated (replacement)
    create_audit_log(
        request=request,
        action='barcode_tag_change',
        model_name='Barcode',
        object_id=str(barcode_obj.id),
        object_name=barcode_obj.product.name if barcode_obj.product else 'Unknown Product',
        object_reference=barcode_obj.product.sku if barcode_obj.product else None,
        barcode=barcode_obj.barcode,
        changes={
            'tag': {'old': old_tag, 'new': new_tag},
            'barcode': barcode_obj.barcode,
            'product_id': barcode_obj.product.id if barcode_obj.product else None,
            'product_name': barcode_obj.product.name if barcode_obj.product else None,
            'context': 'replacement_update_tag',
        }
    )
    
    # Handle inventory based on tag
    if new_tag == 'returned' and old_tag == 'unknown':
        # CASE 1: Working returned product - add to inventory
        if store_id and barcode_obj.product:
            try:
                from backend.locations.models import Store
                store = Store.objects.get(pk=store_id)
                stock, created = Stock.objects.get_or_create(
                    product=barcode_obj.product,
                    variant=barcode_obj.variant,
                    store=store,
                    defaults={'quantity': Decimal('1.000')}
                )
                if not created:
                    stock.quantity += Decimal('1.000')
                    stock.save()
            except Exception as e:
                return Response({
                    'message': f'Tag updated to RETURNED, but inventory update failed: {str(e)}',
                    'tag': barcode_obj.tag
                }, status=status.HTTP_200_OK)
    # CASE 2: Defective - don't update inventory (already handled by not incrementing)
    
    return Response({
        'message': f'Tag updated to {new_tag.upper()}',
        'barcode': barcode_obj.barcode,
        'tag': barcode_obj.tag,
        'inventory_updated': new_tag == 'returned'
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_reserve_barcode(request):
    """Reserve/release replacement barcode by toggling tag to/from in-cart."""
    barcode_id = request.data.get('barcode_id')
    action = (request.data.get('action') or 'reserve').strip().lower()
    restore_tag = (request.data.get('restore_tag') or 'new').strip().lower()

    if not barcode_id:
        return Response({'error': 'barcode_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    if action not in ['reserve', 'release']:
        return Response({'error': 'action must be "reserve" or "release"'}, status=status.HTTP_400_BAD_REQUEST)

    if restore_tag not in ['new', 'returned']:
        restore_tag = 'new'

    with transaction.atomic():
        try:
            # Lock only Barcode row here; select_related on nullable FK can generate
            # an outer join that PostgreSQL rejects with FOR UPDATE.
            barcode_obj = Barcode.objects.select_for_update().get(pk=barcode_id)
        except Barcode.DoesNotExist:
            return Response({'error': 'Barcode not found'}, status=status.HTTP_404_NOT_FOUND)

        old_tag = barcode_obj.tag

        if action == 'reserve':
            if old_tag not in ['new', 'returned']:
                return Response({
                    'error': f'Barcode is not available for replacement (current tag: {old_tag})',
                    'barcode_tag': old_tag,
                }, status=status.HTTP_400_BAD_REQUEST)
            barcode_obj.tag = 'in-cart'
            barcode_obj.save(update_fields=['tag'])
            create_audit_log(
                request=request,
                action='barcode_tag_change',
                model_name='Barcode',
                object_id=str(barcode_obj.id),
                object_name=barcode_obj.product.name if barcode_obj.product else 'Unknown Product',
                object_reference=barcode_obj.product.sku if barcode_obj.product else None,
                barcode=barcode_obj.barcode,
                changes={
                    'tag': {'old': old_tag, 'new': 'in-cart'},
                    'context': 'replacement_reserve_barcode',
                }
            )
            return Response({
                'message': 'Barcode reserved for replacement',
                'barcode_id': barcode_obj.id,
                'barcode': barcode_obj.barcode,
                'tag': barcode_obj.tag,
                'previous_tag': old_tag,
            })

        # action == 'release'
        if old_tag == 'in-cart':
            barcode_obj.tag = restore_tag
            barcode_obj.save(update_fields=['tag'])
            create_audit_log(
                request=request,
                action='barcode_tag_change',
                model_name='Barcode',
                object_id=str(barcode_obj.id),
                object_name=barcode_obj.product.name if barcode_obj.product else 'Unknown Product',
                object_reference=barcode_obj.product.sku if barcode_obj.product else None,
                barcode=barcode_obj.barcode,
                changes={
                    'tag': {'old': old_tag, 'new': restore_tag},
                    'context': 'replacement_release_barcode',
                }
            )
            return Response({
                'message': 'Barcode released from replacement cart',
                'barcode_id': barcode_obj.id,
                'barcode': barcode_obj.barcode,
                'tag': barcode_obj.tag,
            })

        return Response({
            'message': 'Barcode already released',
            'barcode_id': barcode_obj.id,
            'barcode': barcode_obj.barcode,
            'tag': barcode_obj.tag,
        })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_replace(request):
    """Replace a sold item with another item - update invoice and inventory"""
    invoice_item_id = request.data.get('invoice_item_id')
    new_product_id = request.data.get('new_product_id')
    store_id = request.data.get('store_id')
    new_unit_price = request.data.get('new_unit_price')  # Optional: new price for replacement product
    manual_unit_price = request.data.get('manual_unit_price')  # Optional: manual override price
    return_tag = request.data.get('return_tag', 'unknown')  # Optional: tag for returned item (returned, defective, unknown)
    
    if not invoice_item_id or not new_product_id:
        return Response({'error': 'Invoice item ID and new product ID are required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        invoice_item = InvoiceItem.objects.select_related('product', 'invoice', 'invoice__store').get(pk=invoice_item_id)
    except InvoiceItem.DoesNotExist:
        return Response({'error': 'Invoice item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        new_product = Product.objects.get(pk=new_product_id)
    except Product.DoesNotExist:
        return Response({'error': 'New product not found'}, status=status.HTTP_404_NOT_FOUND)
    
    old_product = invoice_item.product
    old_barcode = invoice_item.barcode
    invoice = invoice_item.invoice
    
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process replacement for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Find new barcode for replacement product
    new_barcode = None
    scanned_barcode = request.data.get('scanned_barcode')  # Get the exact barcode scanned/searched
    
    if new_product:
        # Only allow barcodes that are available or reserved for this flow
        if scanned_barcode:
            from django.db.models import Q
            scanned_clean = str(scanned_barcode).strip().upper()
            # Exact match only: try barcode then short_code (never .first())
            try:
                new_barcode = Barcode.objects.get(
                    barcode=scanned_clean,
                    product=new_product,
                    variant=invoice_item.variant,
                    tag__in=['new', 'returned', 'in-cart']
                )
            except Barcode.DoesNotExist:
                try:
                    new_barcode = Barcode.objects.get(
                        short_code=scanned_clean,
                        product=new_product,
                        variant=invoice_item.variant,
                        tag__in=['new', 'returned', 'in-cart']
                    )
                except Barcode.DoesNotExist:
                    try:
                        new_barcode = Barcode.objects.get(
                            barcode=scanned_clean,
                            product=new_product,
                            tag__in=['new', 'returned', 'in-cart']
                        )
                    except Barcode.DoesNotExist:
                        try:
                            new_barcode = Barcode.objects.get(
                                short_code=scanned_clean,
                                product=new_product,
                                tag__in=['new', 'returned', 'in-cart']
                            )
                        except Barcode.DoesNotExist:
                            # Exact barcode not found or not available
                            return Response({
                                'error': f'Barcode {scanned_barcode} not found or not available for sale',
                                'message': f'The barcode {scanned_barcode} is either not found, already sold, or not reserved/available for replacement (must be tagged as "new", "returned", or "in-cart").'
                            }, status=status.HTTP_400_BAD_REQUEST)
        else:
            # No scanned barcode provided - this should not happen in normal flow
            return Response({
                'error': 'No barcode specified for replacement product',
                'message': 'Please scan or search for a specific barcode to use for replacement.'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Mark new barcode as sold
        if new_barcode:
            new_tag_old = new_barcode.tag
            new_barcode.tag = 'sold'
            new_barcode.save()
            
            # Audit log: New barcode tag changed (unknown -> sold)
            create_audit_log(
                request=request,
                action='barcode_tag_change',
                model_name='Barcode',
                object_id=str(new_barcode.id),
                object_name=new_product.name,
                object_reference=invoice.invoice_number,
                barcode=new_barcode.barcode,
                changes={
                    'tag': {'old': new_tag_old, 'new': 'sold'},
                    'barcode': new_barcode.barcode,
                    'product_id': new_product.id,
                    'product_name': new_product.name,
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'context': 'replacement_replace_new',
                    'scanned_barcode': scanned_barcode,  # Track which barcode was scanned
                }
            )
    
    # Save old values before updating
    old_unit_price = invoice_item.manual_unit_price or invoice_item.unit_price
    old_line_total = invoice_item.line_total
    old_total = invoice.total
    
    # Update invoice item to new product and new barcode
    invoice_item.product = new_product
    invoice_item.barcode = new_barcode
    
    # Handle price adjustment
    # Check if manual_unit_price is explicitly provided (even if 0)
    if 'manual_unit_price' in request.data:
        # Manual price override provided
        if manual_unit_price is not None:
            invoice_item.manual_unit_price = Decimal(str(manual_unit_price))
            invoice_item.unit_price = Decimal(str(manual_unit_price))  # Also update unit_price
        else:
            invoice_item.manual_unit_price = None
    elif new_unit_price is not None:
        # New unit price provided (use as manual_unit_price)
        invoice_item.manual_unit_price = Decimal(str(new_unit_price))
        invoice_item.unit_price = Decimal(str(new_unit_price))
    # else: Keep original price - don't change unless explicitly requested
    
    # Recalculate line_total
    effective_price = invoice_item.manual_unit_price or invoice_item.unit_price
    invoice_item.line_total = invoice_item.quantity * effective_price - invoice_item.discount_amount + invoice_item.tax_amount
    invoice_item.save()
    
    # Update invoice totals
    update_invoice_totals(invoice)
    invoice.refresh_from_db()
    
    # Adjust paid_amount if invoice was fully paid and price changed
    # If paid_amount exceeds the new total, reduce it proportionally
    if invoice.paid_amount > invoice.total:
        # Calculate the refund amount (excess payment)
        excess_payment = invoice.paid_amount - invoice.total
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        
        # Create a refund Payment record to track the refund
        if excess_payment > 0:
            # Get the most recent payment method to use for refund (or default to 'cash')
            last_payment = invoice.payments.order_by('-created_at').first()
            refund_payment_method = last_payment.payment_method if last_payment else 'cash'
            
            # Create refund payment record
            refund_payment = Payment.objects.create(
                invoice=invoice,
                payment_method='refund',  # Use 'refund' payment method for clarity
                amount=-excess_payment,  # Negative amount to indicate refund
                reference=f'REFUND-REPLACE-{invoice.invoice_number}',
                notes=f'Refund for product replacement (Price difference: {old_total} -> {invoice.total}). Original payment method: {refund_payment_method}',
                created_by=request.user
            )
            
            # Audit log: Refund payment created
            create_audit_log(
                request=request,
                action='payment_refund',
                model_name='Payment',
                object_id=str(refund_payment.id),
                object_name=f"Refund Payment for Product Replacement - Invoice {invoice.invoice_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'payment_id': refund_payment.id,
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'refund_amount': str(excess_payment),
                    'old_total': str(old_total),
                    'new_total': str(invoice.total),
                    'payment_method': refund_payment_method,
                }
            )
    else:
        # Recalculate due_amount based on new total
        invoice.due_amount = invoice.total - invoice.paid_amount
    
    # Update invoice status based on payment
    if invoice.due_amount <= Decimal('0.00'):
        invoice.status = 'paid'
    elif invoice.paid_amount > Decimal('0.00'):
        invoice.status = 'partial'
    else:
        invoice.status = 'draft'
    
    invoice.save()
    
    # Calculate price difference for ledger entry
    new_total = invoice.total
    price_difference = new_total - old_total
    
    # Return old barcode back to inventory (mark as 'unknown' and add to stock)
    if old_barcode:
        old_tag = old_barcode.tag
        old_barcode.tag = return_tag
        old_barcode.save()
        
        # Audit log: Old barcode tag changed (sold -> unknown)
        create_audit_log(
            request=request,
            action='barcode_tag_change',
            model_name='Barcode',
            object_id=str(old_barcode.id),
            object_name=old_product.name,
            object_reference=invoice.invoice_number,
            barcode=old_barcode.barcode,
            changes={
                'tag': {'old': old_tag, 'new': return_tag},
                'barcode': old_barcode.barcode,
                'product_id': old_product.id,
                'product_name': old_product.name,
                'invoice_id': invoice.id,
                'invoice_number': invoice.invoice_number,
                'context': 'replacement_replace_old',
            }
        )
    
    # Add old product back to inventory (if track_inventory is enabled)
    if old_product.track_inventory and store_id and invoice.store:
        try:
            from backend.locations.models import Store
            store = Store.objects.get(pk=store_id) if store_id else invoice.store
            stock, created = Stock.objects.get_or_create(
                product=old_product,
                variant=invoice_item.variant,
                store=store,
                defaults={'quantity': Decimal('0.000')}
            )
            stock.quantity += Decimal('1.000')  # Add back the returned item
            stock.save()
        except Exception as e:
            # Log error but don't fail the replacement
            print(f'Error updating inventory for old product: {str(e)}')
    
    # Remove new product from inventory (if track_inventory is enabled)
    if new_product.track_inventory and invoice.store and new_barcode:
        try:
            # Mark new barcode as sold (we could add a 'sold' tag, but for now just update stock)
            stock, created = Stock.objects.get_or_create(
                product=new_product,
                variant=invoice_item.variant,
                store=invoice.store,
                defaults={'quantity': Decimal('0.000')}
            )
            stock.quantity = max(Decimal('0.000'), stock.quantity - invoice_item.quantity)
            stock.save()
        except Exception as e:
            print(f'Error updating inventory for new product: {str(e)}')
    
    # Create ledger entry for replacement if price difference exists
    if invoice.customer and price_difference != 0:
        from backend.parties.models import LedgerEntry
        entry_type = 'credit' if price_difference < 0 else 'debit'
        entry = LedgerEntry.objects.create(
            customer=invoice.customer,
            invoice=invoice,
            entry_type=entry_type,
            amount=abs(price_difference),
            created_at=timezone.now(),
            description=f'Replacement adjustment for Invoice {invoice.invoice_number}',
            created_by=request.user
        )
        create_internal_ledger_entry_if_mtshop(
            invoice.customer, entry_type, abs(price_difference),
            f'Replacement adjustment for Invoice {invoice.invoice_number}',
            request.user, timezone.now()
        )
        # Update customer credit_balance
        if entry_type == 'credit':
            invoice.customer.credit_balance += entry.amount
        else:
            invoice.customer.credit_balance -= entry.amount
        invoice.customer.save()
    
    # Audit log: Item replaced
    create_audit_log(
        request=request,
        action='replacement_replace',
        model_name='InvoiceItem',
        object_id=str(invoice_item.id),
        object_name=f"{new_product.name} (replaced {old_product.name})",
        object_reference=invoice.invoice_number,
        barcode=new_barcode.barcode if new_barcode else None,
        changes={
            'invoice_id': invoice.id,
            'invoice_number': invoice.invoice_number,
            'old_product_id': old_product.id,
            'old_product_name': old_product.name,
            'old_barcode': old_barcode.barcode if old_barcode else None,
            'new_product_id': new_product.id,
            'new_product_name': new_product.name,
            'new_barcode': new_barcode.barcode if new_barcode else None,
            'price_difference': str(price_difference),
            'old_total': str(old_total),
            'new_total': str(new_total),
        }
    )
    
    return Response({
        'message': 'Item replaced successfully',
        'invoice_item': InvoiceItemSerializer(invoice_item).data,
        'invoice': InvoiceSerializer(invoice).data,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_return(request):
    """Return a sold item - remove from invoice and add back to inventory"""
    invoice_item_id = request.data.get('invoice_item_id')
    store_id = request.data.get('store_id')
    return_quantity = request.data.get('quantity', None)  # Optional: return partial quantity
    return_tag = request.data.get('return_tag', 'unknown')  # Optional: tag for returned item (returned, defective, unknown)
    
    if not invoice_item_id:
        return Response({'error': 'Invoice item ID is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        invoice_item = InvoiceItem.objects.select_related('product', 'invoice', 'invoice__store').get(pk=invoice_item_id)
    except InvoiceItem.DoesNotExist:
        return Response({'error': 'Invoice item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    invoice = invoice_item.invoice
    
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process return for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    product = invoice_item.product
    variant = invoice_item.variant  # Save variant before potential deletion
    barcode_obj = invoice_item.barcode  # Save barcode before potential deletion
    
    # Strict validation: only items with 'sold' tag can be returned
    if product.track_inventory and barcode_obj:
        is_valid, error_msg = validate_barcode_for_replacement(barcode_obj)
        if not is_valid:
            return Response({
                'error': 'Item not eligible for return',
                'message': error_msg or 'This item cannot be returned because its barcode does not have "sold" tag.'
            }, status=status.HTTP_400_BAD_REQUEST)
    elif not product.track_inventory:
        product_barcode = product.barcodes.first()
        if product_barcode:
            is_valid, error_msg = validate_barcode_for_replacement(product_barcode)
            if not is_valid:
                return Response({
                    'error': 'Item not eligible for return',
                    'message': error_msg or 'This item cannot be returned because the product barcode does not have "sold" tag.'
                }, status=status.HTTP_400_BAD_REQUEST)
    
    return_qty = Decimal(str(return_quantity)) if return_quantity else invoice_item.quantity
    
    # Save original values before modification
    original_quantity = invoice_item.quantity
    original_line_total = invoice_item.line_total
    original_unit_price = invoice_item.manual_unit_price or invoice_item.unit_price
    
    # Calculate refund amount before modifying/deleting item
    # Calculate proportional refund based on quantity
    if original_quantity > 0:
        refund_amount = (original_line_total / original_quantity) * return_qty
    else:
        refund_amount = Decimal('0.00')
    
    # Validate return quantity
    if return_qty > original_quantity:
        return Response({'error': 'Return quantity cannot exceed sold quantity'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Update invoice item quantity or remove if full return
    if return_qty >= original_quantity:
        # Full return - remove item from invoice
        invoice_item.delete()
        item_deleted = True
    else:
        # Partial return - reduce quantity
        invoice_item.quantity -= return_qty
        invoice_item.line_total = invoice_item.quantity * original_unit_price - invoice_item.discount_amount + invoice_item.tax_amount
        invoice_item.save()
        item_deleted = False
    
    # Update invoice totals
    update_invoice_totals(invoice)
    invoice.refresh_from_db()
    
    # Adjust paid_amount if invoice was fully paid and items were returned
    # If paid_amount exceeds the new total, reduce it proportionally
    if invoice.paid_amount > invoice.total:
        # Calculate the refund amount (excess payment)
        excess_payment = invoice.paid_amount - invoice.total
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        
        # Create a refund Payment record to track the refund
        if excess_payment > 0:
            # Get the most recent payment method to use for refund (or default to 'cash')
            last_payment = invoice.payments.order_by('-created_at').first()
            refund_payment_method = last_payment.payment_method if last_payment else 'cash'
            
            # Create refund payment record
            refund_payment = Payment.objects.create(
                invoice=invoice,
                payment_method='refund',  # Use 'refund' payment method for clarity
                amount=-excess_payment,  # Negative amount to indicate refund
                reference=f'REFUND-{invoice.invoice_number}',
                notes=f'Refund for returned items (Qty: {return_qty}). Original payment method: {refund_payment_method}',
                created_by=request.user
            )
            
            # If there's a customer, create a refund ledger entry
            if invoice.customer:
                from backend.parties.models import LedgerEntry
                refund_entry = LedgerEntry.objects.create(
                    customer=invoice.customer,
                    invoice=invoice,
                    entry_type='credit',
                    amount=excess_payment,
                    description=f'Refund for returned items from Invoice {invoice.invoice_number} (Qty: {return_qty})',
                    created_by=request.user,
                    created_at=timezone.now()
                )
                create_internal_ledger_entry_if_mtshop(
                    invoice.customer, 'credit', excess_payment,
                    f'Refund for returned items from Invoice {invoice.invoice_number} (Qty: {return_qty})',
                    request.user, timezone.now()
                )
                # Update customer credit_balance
                invoice.customer.credit_balance += refund_entry.amount
                invoice.customer.save()

            # Audit log: Refund payment created
            create_audit_log(
                request=request,
                action='payment_refund',
                model_name='Payment',
                object_id=str(refund_payment.id),
                object_name=f"Refund Payment for Invoice {invoice.invoice_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'payment_id': refund_payment.id,
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'refund_amount': str(excess_payment),
                    'payment_method': refund_payment_method,
                    'return_quantity': str(return_qty),
                }
            )
    else:
        # Recalculate due_amount based on new total
        invoice.due_amount = invoice.total - invoice.paid_amount
    
    # Update invoice status based on payment
    if invoice.due_amount <= Decimal('0.00'):
        invoice.status = 'paid'
    elif invoice.paid_amount > Decimal('0.00'):
        invoice.status = 'partial'
    else:
        invoice.status = 'draft'
    
    invoice.save()
    
    # Return barcode back to inventory (use provided return_tag)
    if barcode_obj:
        barcode_obj.tag = return_tag
        barcode_obj.save()
    
    # Add product back to inventory (if track_inventory is enabled)
    if product.track_inventory:
        try:
            from backend.locations.models import Store
            store = Store.objects.get(pk=store_id) if store_id else invoice.store
            if store:
                stock, created = Stock.objects.get_or_create(
                    product=product,
                    variant=variant,
                    store=store,
                    defaults={'quantity': Decimal('0.000')}
                )
                stock.quantity += return_qty
                stock.save()
        except Exception as e:
            print(f'Error updating inventory: {str(e)}')
    
    # Audit log: Item returned
    create_audit_log(
        request=request,
        action='replacement_return',
        model_name='InvoiceItem',
        object_id=str(invoice_item.id) if not item_deleted else 'deleted',
        object_name=f"{product.name} (returned)",
        object_reference=invoice.invoice_number,
        barcode=barcode_obj.barcode if barcode_obj else None,
        changes={
            'tag': return_tag,
            'invoice_id': invoice.id,
            'invoice_number': invoice.invoice_number,
            'product_id': product.id,
            'product_name': product.name,
            'product_sku': product.sku,
            'barcode': barcode_obj.barcode if barcode_obj else None,
            'return_quantity': str(return_qty),
            'original_quantity': str(original_quantity),
            'refund_amount': str(refund_amount),
            'item_deleted': item_deleted,
            'barcode_tag': 'returned',
        }
    )
    
    return Response({
        'message': 'Item returned successfully',
        'invoice': InvoiceSerializer(invoice).data,
        'returned_quantity': str(return_qty),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_defective(request):
    """Mark a sold item as defective - remove from invoice, don't add to inventory"""
    invoice_item_id = request.data.get('invoice_item_id')
    return_quantity = request.data.get('quantity', None)  # Optional: return partial quantity
    
    if not invoice_item_id:
        return Response({'error': 'Invoice item ID is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        invoice_item = InvoiceItem.objects.select_related('product', 'invoice').get(pk=invoice_item_id)
    except InvoiceItem.DoesNotExist:
        return Response({'error': 'Invoice item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    invoice = invoice_item.invoice
    
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process defective marking for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    barcode_obj = invoice_item.barcode  # Save barcode before potential deletion
    
    # Strict validation: only items with 'sold' tag can be marked as defective
    product = invoice_item.product
    if product.track_inventory and barcode_obj:
        is_valid, error_msg = validate_barcode_for_replacement(barcode_obj)
        if not is_valid:
            return Response({
                'error': 'Item not eligible for defective marking',
                'message': error_msg or 'This item cannot be marked as defective because its barcode does not have "sold" tag.'
            }, status=status.HTTP_400_BAD_REQUEST)
    elif not product.track_inventory:
        product_barcode = product.barcodes.first()
        if product_barcode:
            is_valid, error_msg = validate_barcode_for_replacement(product_barcode)
            if not is_valid:
                return Response({
                    'error': 'Item not eligible for defective marking',
                    'message': error_msg or 'This item cannot be marked as defective because the product barcode does not have "sold" tag.'
                }, status=status.HTTP_400_BAD_REQUEST)
    
    return_qty = Decimal(str(return_quantity)) if return_quantity else invoice_item.quantity
    
    # Validate return quantity
    if return_qty > invoice_item.quantity:
        return Response({'error': 'Return quantity cannot exceed sold quantity'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Update invoice item quantity or remove if full return
    if return_qty >= invoice_item.quantity:
        # Full return - remove item from invoice
        invoice_item.delete()
    else:
        # Partial return - reduce quantity
        invoice_item.quantity -= return_qty
        invoice_item.line_total = invoice_item.quantity * (invoice_item.manual_unit_price or invoice_item.unit_price) - invoice_item.discount_amount + invoice_item.tax_amount
        invoice_item.save()
    
    # Update invoice totals
    update_invoice_totals(invoice)
    invoice.refresh_from_db()
    
    # Adjust paid_amount if invoice was fully paid and items were removed
    # If paid_amount exceeds the new total, reduce it proportionally
    if invoice.paid_amount > invoice.total:
        # Calculate the refund amount (excess payment)
        excess_payment = invoice.paid_amount - invoice.total
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        
        # Create a refund Payment record to track the refund
        if excess_payment > 0:
            # Get the most recent payment method to use for refund (or default to 'cash')
            last_payment = invoice.payments.order_by('-created_at').first()
            refund_payment_method = last_payment.payment_method if last_payment else 'cash'
            
            # Create refund payment record
            refund_payment = Payment.objects.create(
                invoice=invoice,
                payment_method='refund',  # Use 'refund' payment method for clarity
                amount=-excess_payment,  # Negative amount to indicate refund
                reference=f'REFUND-DEFECTIVE-{invoice.invoice_number}',
                notes=f'Refund for defective items (Qty: {return_qty}). Original payment method: {refund_payment_method}',
                created_by=request.user
            )
            
            # Audit log: Refund payment created
            create_audit_log(
                request=request,
                action='payment_refund',
                model_name='Payment',
                object_id=str(refund_payment.id),
                object_name=f"Refund Payment for Defective Items - Invoice {invoice.invoice_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'payment_id': refund_payment.id,
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'refund_amount': str(excess_payment),
                    'payment_method': refund_payment_method,
                    'defective_quantity': str(return_qty),
                }
            )
    else:
        # Recalculate due_amount based on new total
        invoice.due_amount = invoice.total - invoice.paid_amount
    
    # Update invoice status based on payment
    if invoice.due_amount <= Decimal('0.00'):
        invoice.status = 'paid'
    elif invoice.paid_amount > Decimal('0.00'):
        invoice.status = 'partial'
    else:
        invoice.status = 'draft'
    
    invoice.save()
    
    # Mark barcode as defective (don't add back to inventory)
    if barcode_obj:
        barcode_obj.tag = 'defective'
        barcode_obj.save()
    
    # Note: For defective items, we don't add back to inventory
    
    # Audit log: Item marked as defective
    create_audit_log(
        request=request,
        action='replacement_defective',
        model_name='InvoiceItem',
        object_id=str(invoice_item.id) if return_qty < invoice_item.quantity else 'deleted',
        object_name=f"{product.name} (defective)",
        object_reference=invoice.invoice_number,
        barcode=barcode_obj.barcode if barcode_obj else None,
        changes={
            'invoice_id': invoice.id,
            'invoice_number': invoice.invoice_number,
            'product_id': product.id,
            'product_name': product.name,
            'product_sku': product.sku,
            'barcode': barcode_obj.barcode if barcode_obj else None,
            'defective_quantity': str(return_qty),
            'barcode_tag': 'defective',
            'note': 'Item marked as defective - not added back to inventory',
        }
    )
    
    return Response({
        'message': 'Item marked as defective and removed from invoice',
        'invoice': InvoiceSerializer(invoice).data,
        'defective_quantity': str(return_qty),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_invoices_by_number(request):
    """Search invoices by partial invoice number - returns list of matching invoices"""
    search = request.query_params.get('search', '').strip()
    
    if not search:
        return Response({'invoices': []})
    
    try:
        invoices = Invoice.objects.filter(
            invoice_number__icontains=search
        ).exclude(
            status='void'
        ).exclude(
            invoice_type='defective'
        ).select_related('store', 'customer', 'created_by').prefetch_related('items', 'items__product', 'items__barcode').order_by('-created_at')[:10]  # Limit to 10 results
        
        serializer = InvoiceSerializer(invoices, many=True)
        return Response({
            'invoices': serializer.data
        })
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f'Error searching invoices: {str(e)}', exc_info=True)
        return Response({
            'error': f'Error searching invoices: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def find_invoice_by_barcode(request):
    """Find invoice by barcode/SKU or invoice number for replacement.
    When found by barcode/SKU: returns invoice with only line items matching that barcode/SKU.
    When found by invoice_number: returns full invoice with all items."""
    barcode_value = request.data.get('barcode')
    sku = request.data.get('sku')
    invoice_number = request.data.get('invoice_number')
    
    # If invoice_number is provided, search by invoice number first
    if invoice_number:
        invoice_number_clean = str(invoice_number).strip()
        try:
            # Try exact match first - only exclude void
            invoice = Invoice.objects.filter(
                invoice_number__iexact=invoice_number_clean
            ).exclude(
                status='void'
            ).select_related('store', 'customer', 'created_by').prefetch_related('items', 'items__product', 'items__barcode').order_by('-created_at').first()
            
            # If not found, try contains match
            if not invoice:
                invoice = Invoice.objects.filter(
                    invoice_number__icontains=invoice_number_clean
                ).exclude(
                    status='void'
                ).select_related('store', 'customer', 'created_by').prefetch_related('items', 'items__product', 'items__barcode').order_by('-created_at').first()
            
            if invoice:
                serializer = InvoiceSerializer(invoice)
                return Response({
                    'invoice': serializer.data,
                    'found_by': 'invoice_number',
                    'search_value': invoice_number_clean
                })
            # If invoice number search fails, fall through to try as barcode/SKU
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Error finding invoice by invoice number: {str(e)}', exc_info=True)
            # Fall through to try as barcode/SKU instead of returning error
    
    # If invoice_number was provided but not found, try using it as barcode/SKU
    if invoice_number and not barcode_value and not sku:
        search_value = invoice_number
    elif not barcode_value and not sku:
        return Response({'error': 'Barcode, SKU, or invoice number is required'}, status=status.HTTP_400_BAD_REQUEST)
    else:
        search_value = barcode_value or sku
    
    search_value_clean = str(search_value).strip().upper()
    
    try:
        # Exact match only: try barcode then short_code (standardized to .upper())
        invoice_items = InvoiceItem.objects.filter(
            barcode__barcode=search_value_clean,
            barcode__tag='sold'
        ).exclude(
            invoice__status='void'
        ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')

        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                barcode__short_code=search_value_clean,
                barcode__tag='sold'
            ).exclude(
                invoice__status='void'
            ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')

        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                barcode__barcode=search_value_clean
            ).exclude(
                invoice__status='void'
            ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')

        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                barcode__short_code=search_value_clean
            ).exclude(
                invoice__status='void'
            ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')
        
        # If not found by barcode, try by product SKU (for non-tracked products)
        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                product__sku__iexact=search_value_clean
            ).exclude(
                invoice__status='void'
            ).exclude(
                product__sku__isnull=True
            ).exclude(
                product__sku=''
            ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')
        
        # If still not found, try by variant SKU
        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                variant__sku__iexact=search_value_clean
            ).exclude(
                invoice__status='void'
            ).select_related('invoice', 'product', 'variant', 'barcode', 'invoice__store', 'invoice__customer')
        
        if not invoice_items.exists():
            return Response({
                'error': 'No invoice found for this barcode/SKU',
                'message': f'No sold items found with barcode/SKU: {search_value_clean}.'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Get the most recent invoice (or first one if multiple)
        invoice_item = invoice_items.order_by('-invoice__created_at').first()
        invoice = invoice_item.invoice
        
        # Validate barcode tag for replacement eligibility
        # For tracked products: barcode must have 'sold' tag
        if invoice_item.product.track_inventory and invoice_item.barcode:
            is_valid, error_msg = validate_barcode_for_replacement(invoice_item.barcode)
            if not is_valid:
                return Response({
                    'error': 'Item not eligible for replacement',
                    'message': error_msg or 'This item cannot be replaced because its barcode does not have "sold" tag.'
                }, status=status.HTTP_400_BAD_REQUEST)
        # For non-tracked products: product barcode must have 'sold' tag
        elif not invoice_item.product.track_inventory:
            product_barcode = invoice_item.product.barcodes.first()
            if product_barcode:
                is_valid, error_msg = validate_barcode_for_replacement(product_barcode)
                if not is_valid:
                    return Response({
                        'error': 'Item not eligible for replacement',
                        'message': error_msg or 'This item cannot be replaced because the product barcode does not have "sold" tag.'
                    }, status=status.HTTP_400_BAD_REQUEST)
        
        # Return invoice with only items matching the searched barcode/SKU (not all items on invoice)
        matching_items = invoice_items.filter(invoice=invoice).order_by('id')
        serializer = InvoiceSerializer(invoice)
        invoice_data = dict(serializer.data)
        invoice_data['items'] = InvoiceItemSerializer(matching_items, many=True).data
        return Response({
            'invoice': invoice_data,
            'found_by': 'barcode' if barcode_value else 'sku',
            'search_value': search_value_clean
        })
        
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f'Error finding invoice by barcode/SKU: {str(e)}', exc_info=True)
        return Response({
            'error': f'Error finding invoice: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bulk_barcodes_check(request):
    """Check bulk barcodes for credit note: resolve each to sold invoice item, ensure single customer.
    Returns status per barcode and valid=True only if all found, all sold, and exactly one customer."""
    barcodes_raw = request.data.get('barcodes')
    if barcodes_raw is None:
        return Response({'error': 'barcodes array is required'}, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(barcodes_raw, str):
        # Allow string: split by newlines and spaces
        barcodes_raw = [s.strip() for s in barcodes_raw.replace('\r\n', '\n').split() if s.strip()]
    if not isinstance(barcodes_raw, list):
        return Response({'error': 'barcodes must be a list or a string'}, status=status.HTTP_400_BAD_REQUEST)
    # Dedupe, trim, and standardize to uppercase for lookup
    seen = set()
    barcode_strings = []
    for b in barcodes_raw:
        val = (b or '').strip().upper()
        if val and val not in seen:
            seen.add(val)
            barcode_strings.append(val)

    if not barcode_strings:
        return Response({
            'valid': False,
            'error': 'no_barcodes',
            'customers': [],
            'processable': [],
            'skipped': [],
        })

    invoice_items_qs = InvoiceItem.objects.filter(
        Q(barcode__barcode__isnull=False) | Q(barcode__short_code__isnull=False)
    ).exclude(
        invoice__status='void'
    ).select_related('invoice', 'product', 'barcode', 'invoice__customer')

    results = []  # sold items with customer info
    not_found = []  # barcode strings with no eligible invoice item
    invalid_tag = []  # list of {'barcode': str, 'tag': str} for not-sold
    fresh_processable = []  # barcodes currently tagged as "new" (can be marked defective in bulk flow)
    customer_names = {}

    for barcode_str in barcode_strings:
        # Exact match only: try barcode then short_code
        barcode_obj = None
        try:
            barcode_obj = Barcode.objects.get(barcode=barcode_str)
        except Barcode.DoesNotExist:
            try:
                barcode_obj = Barcode.objects.get(short_code=barcode_str)
            except Barcode.DoesNotExist:
                pass

        # Fresh barcodes can be directly marked as defective in replacement bulk flow,
        # even when they are not linked to any eligible invoice item.
        if barcode_obj and barcode_obj.tag == 'new':
            fresh_processable.append({
                'barcode': barcode_str,
                'barcode_id': barcode_obj.id,
                'barcode_full': barcode_obj.barcode,
                'short_code': barcode_obj.short_code,
                'tag': barcode_obj.tag,
                'product_name': barcode_obj.product.name if barcode_obj.product else 'N/A',
            })
            continue

        items = invoice_items_qs.filter(barcode__barcode=barcode_str).order_by('-invoice__created_at')
        if not items.exists():
            items = invoice_items_qs.filter(barcode__short_code=barcode_str).order_by('-invoice__created_at')
        item = items.first()  # one invoice item per barcode (pick most recent if multiple)

        if not item:
            not_found.append(barcode_str)
            continue

        barcode_obj = item.barcode
        tag = barcode_obj.tag if barcode_obj else None

        if tag != 'sold':
            invalid_tag.append({'barcode': barcode_str, 'tag': tag or 'unknown'})
            continue

        cust = item.invoice.customer
        cust_id = cust.id if cust else None
        cust_name = cust.name if cust else (getattr(cust, 'name', None) or 'N/A')
        if cust_id:
            customer_names[cust_id] = cust_name

        barcode_full = barcode_obj.barcode if barcode_obj else None
        short_code = getattr(barcode_obj, 'short_code', None) if barcode_obj else None
        results.append({
            'barcode': barcode_str,
            'barcode_full': barcode_full,
            'short_code': short_code,
            'tag': tag,
            'invoice_id': item.invoice_id,
            'invoice_number': item.invoice.invoice_number,
            'item_id': item.id,
            'product_name': item.product.name if item.product else 'N/A',
            'customer_id': cust_id,
            'customer_name': cust_name,
        })

    # Build skipped list: not_found (with current_tag if barcode exists in DB), not_sold, different_customer
    skipped = []
    for b in not_found:
        # Exact match only: try barcode then short_code (get, not first)
        row = None
        try:
            obj = Barcode.objects.get(barcode=b)
            row = {'tag': obj.tag, 'barcode': obj.barcode, 'short_code': obj.short_code}
        except Barcode.DoesNotExist:
            try:
                obj = Barcode.objects.get(short_code=b)
                row = {'tag': obj.tag, 'barcode': obj.barcode, 'short_code': obj.short_code}
            except Barcode.DoesNotExist:
                pass
        skipped.append({
            'barcode': b,
            'barcode_full': row['barcode'] if row else None,
            'short_code': row['short_code'] if row else None,
            'reason': 'not_found',
            'current_tag': row['tag'] if row else None,
        })
    for entry in invalid_tag:
        row = None
        try:
            obj = Barcode.objects.get(barcode=entry['barcode'])
            row = {'barcode': obj.barcode, 'short_code': obj.short_code}
        except Barcode.DoesNotExist:
            try:
                obj = Barcode.objects.get(short_code=entry['barcode'])
                row = {'barcode': obj.barcode, 'short_code': obj.short_code}
            except Barcode.DoesNotExist:
                pass
        skipped.append({
            'barcode': entry['barcode'],
            'barcode_full': row['barcode'] if row else None,
            'short_code': row['short_code'] if row else None,
            'reason': 'not_sold',
            'current_tag': entry['tag'],
        })

    # Among sold (results), pick largest single-customer group as processable; rest go to skipped (different_customer)
    if results:
        cust_counts = Counter(r['customer_id'] for r in results)
        # Use largest group; if tie, pick first by id
        chosen_cust_id = max(cust_counts.keys(), key=lambda c: (cust_counts[c], c))
        processable = [r for r in results if r['customer_id'] == chosen_cust_id]
        for r in results:
            if r['customer_id'] != chosen_cust_id:
                skipped.append({
                    'barcode': r['barcode'],
                    'barcode_full': r.get('barcode_full'),
                    'short_code': r.get('short_code'),
                    'reason': 'different_customer',
                    'current_tag': r.get('tag', 'sold'),
                })
    else:
        processable = []

    valid = len(processable) > 0 or len(fresh_processable) > 0
    customers_list = [{'id': cid, 'name': customer_names.get(cid, 'N/A')} for cid in sorted(customer_names.keys())]

    return Response({
        'valid': valid,
        'error': None if valid else 'none_processable',
        'customers': customers_list,
        'processable': processable,
        'fresh_processable': fresh_processable,
        'skipped': skipped,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bulk_barcodes_check_pos(request):
    """Check bulk barcodes for POS add-to-cart. Only barcodes with tag 'new' or 'returned'
    (and not already in a cart) can be added. Returns addable and skipped lists."""
    barcodes_raw = request.data.get('barcodes')
    if barcodes_raw is None:
        return Response({'error': 'barcodes array is required'}, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(barcodes_raw, str):
        barcodes_raw = [s.strip() for s in barcodes_raw.replace('\r\n', '\n').split() if s.strip()]
    if not isinstance(barcodes_raw, list):
        return Response({'error': 'barcodes must be a list or a string'}, status=status.HTTP_400_BAD_REQUEST)
    seen = set()
    barcode_strings = []
    for b in barcodes_raw:
        val = (b or '').strip().upper()
        if val and val not in seen:
            seen.add(val)
            barcode_strings.append(val)
    if not barcode_strings:
        return Response({
            'addable': [],
            'skipped': [],
        })

    addable = []
    skipped = []
    # All active carts' scanned_barcodes for "in other cart" check
    all_scanned = set()
    for item in CartItem.objects.filter(cart__status='active').exclude(scanned_barcodes=[]):
        if item.scanned_barcodes:
            all_scanned.update(item.scanned_barcodes)

    for barcode_str in barcode_strings:
        # Exact match only: try barcode then short_code (get, not first)
        barcode_obj = None
        try:
            barcode_obj = Barcode.objects.select_related('product', 'variant').get(barcode=barcode_str)
        except Barcode.DoesNotExist:
            try:
                barcode_obj = Barcode.objects.select_related('product', 'variant').get(short_code=barcode_str)
            except Barcode.DoesNotExist:
                pass

        if not barcode_obj:
            skipped.append({
                'barcode': barcode_str,
                'barcode_full': None,
                'short_code': None,
                'reason': 'not_found',
                'current_tag': None,
            })
            continue

        tag = barcode_obj.tag
        barcode_full = barcode_obj.barcode
        short_code = getattr(barcode_obj, 'short_code', None)

        if tag not in ['new', 'returned']:
            skipped.append({
                'barcode': barcode_str,
                'barcode_full': barcode_full,
                'short_code': short_code,
                'reason': 'not_available',
                'current_tag': tag,
            })
            continue
        if barcode_full in all_scanned:
            skipped.append({
                'barcode': barcode_str,
                'barcode_full': barcode_full,
                'short_code': short_code,
                'reason': 'in_other_cart',
                'current_tag': tag,
            })
            continue

        # Skip if product not purchased / purchase not finalized (same as add-item)
        if not barcode_obj.purchase_item:
            skipped.append({
                'barcode': barcode_str,
                'barcode_full': barcode_full,
                'short_code': short_code,
                'reason': 'not_available',
                'current_tag': tag,
            })
            continue
        purchase = barcode_obj.purchase_item.purchase if barcode_obj.purchase_item else None
        if purchase and purchase.status != 'finalized':
            skipped.append({
                'barcode': barcode_str,
                'barcode_full': barcode_full,
                'short_code': short_code,
                'reason': 'not_available',
                'current_tag': tag,
            })
            continue

        product = barcode_obj.product
        addable.append({
            'barcode': barcode_full,
            'barcode_full': barcode_full,
            'short_code': short_code,
            'product_id': product.id if product else None,
            'variant_id': barcode_obj.variant_id,
            'product_name': product.name if product else 'N/A',
        })

    return Response({
        'addable': addable,
        'skipped': skipped,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def process_replacement(request, invoice_id):
    """Process replacement - mark items as unknown and remove/reduce items from invoice"""
    invoice = get_object_or_404(Invoice, pk=invoice_id)
    
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process replacement for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    items_to_replace = request.data.get('items_to_replace', [])
    
    if not items_to_replace or not isinstance(items_to_replace, list):
        return Response({
            'error': 'items_to_replace array is required'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    replaced_items = []
    errors = []
    
    with transaction.atomic():
        for item_data in items_to_replace:
            item_id = item_data.get('item_id')
            quantity = Decimal(str(item_data.get('quantity', 0)))
            
            if not item_id or quantity <= Decimal('0'):
                errors.append(f'Invalid item_id or quantity for item: {item_id}')
                continue
            
            try:
                invoice_item = InvoiceItem.objects.select_related('product', 'barcode').get(
                    id=item_id,
                    invoice=invoice
                )
            except InvoiceItem.DoesNotExist:
                errors.append(f'Invoice item {item_id} not found')
                continue
            
            # Validate quantity doesn't exceed available quantity
            # Check against current quantity (accounting for any previous replacements)
            available_qty = invoice_item.quantity - invoice_item.replaced_quantity
            if quantity > available_qty:
                errors.append(f'Replacement quantity {quantity} exceeds available quantity {available_qty} for item {item_id}')
                continue
            
            # Save barcode info before potential deletion
            barcode_obj = invoice_item.barcode
            barcode_id = barcode_obj.id if barcode_obj else None
            barcode_value = barcode_obj.barcode if barcode_obj else None
            
            # Strict validation: only items with 'sold' tag can be replaced
            if invoice_item.product.track_inventory and barcode_obj:
                is_valid, error_msg = validate_barcode_for_replacement(barcode_obj)
                if not is_valid:
                    errors.append(f'Invoice item {item_id}: {error_msg}')
                    continue
                
                # Mark barcode as 'unknown' after validation
                old_tag = barcode_obj.tag
                barcode_obj.tag = 'unknown'
                barcode_obj.save()
                tag_updated = True
                
                # Audit log: Replacement created (marked as unknown)
                create_audit_log(
                    request=request,
                    action='replacement_create',
                    model_name='Barcode',
                    object_id=str(barcode_obj.id),
                    object_name=invoice_item.product.name,
                    object_reference=invoice.invoice_number,
                    barcode=barcode_obj.barcode,
                    changes={
                        'tag': {'old': old_tag, 'new': 'unknown'},
                        'barcode': barcode_obj.barcode,
                        'product_id': invoice_item.product.id,
                        'product_name': invoice_item.product.name,
                        'invoice_id': invoice.id,
                        'invoice_number': invoice.invoice_number,
                        'invoice_item_id': invoice_item.id,
                        'quantity': str(quantity),
                        'reason': 'Replacement initiated - marked as unknown',
                    }
                )
            else:
                # For non-tracked products: validate and mark product barcode as 'unknown' if all quantity is being replaced
                if not invoice_item.product.track_inventory:
                    product_barcode = invoice_item.product.barcodes.first()
                    if product_barcode:
                        # Check if this replacement will result in all quantity being replaced
                        remaining_after_replacement = invoice_item.quantity - invoice_item.replaced_quantity - quantity
                        if remaining_after_replacement <= Decimal('0'):
                            # Strict validation: only 'sold' tag barcodes can be replaced
                            is_valid, error_msg = validate_barcode_for_replacement(product_barcode)
                            if not is_valid:
                                errors.append(f'Invoice item {item_id}: {error_msg}')
                                continue
                            
                            # Mark barcode as 'unknown' after validation
                            old_tag = product_barcode.tag
                            product_barcode.tag = 'unknown'
                            product_barcode.save()
                            tag_updated = True
                            
                            # Audit log: Replacement created (marked as unknown) - non-tracked
                            create_audit_log(
                                request=request,
                                action='replacement_create',
                                model_name='Barcode',
                                object_id=str(product_barcode.id),
                                object_name=invoice_item.product.name,
                                object_reference=invoice.invoice_number,
                                barcode=product_barcode.barcode,
                                changes={
                                    'tag': {'old': old_tag, 'new': 'unknown'},
                                    'barcode': product_barcode.barcode,
                                    'product_id': invoice_item.product.id,
                                    'product_name': invoice_item.product.name,
                                    'invoice_id': invoice.id,
                                    'invoice_number': invoice.invoice_number,
                                    'invoice_item_id': invoice_item.id,
                                    'quantity': str(quantity),
                                    'reason': 'Replacement initiated - marked as unknown (non-tracked)',
                                }
                            )
                        else:
                            tag_updated = False
                    else:
                        errors.append(f'Invoice item {item_id}: Product has no barcode')
                        continue
                else:
                    tag_updated = False
            
            # Save original values before modification
            original_quantity = invoice_item.quantity
            original_discount_amount = invoice_item.discount_amount
            original_tax_amount = invoice_item.tax_amount
            unit_price = invoice_item.manual_unit_price or invoice_item.unit_price
            
            # Update replaced_quantity for tracking purposes
            invoice_item.replaced_quantity += quantity
            invoice_item.replaced_at = timezone.now()
            invoice_item.replaced_by = request.user
            
            # Determine if this is a full or partial replacement
            total_replaced = invoice_item.replaced_quantity
            
            if total_replaced >= original_quantity:
                # Full replacement - delete the invoice item
                replaced_items.append({
                    'item_id': invoice_item.id,
                    'barcode_id': barcode_id,
                    'barcode': barcode_value,
                    'quantity': str(quantity),
                    'tag_updated': tag_updated,
                    'action': 'deleted'
                })
                invoice_item.delete()
            else:
                # Partial replacement - reduce quantity and recalculate line_total
                remaining_quantity = original_quantity - total_replaced
                invoice_item.quantity = remaining_quantity
                
                # Proportionally adjust discount and tax for remaining quantity
                if original_quantity > Decimal('0'):
                    # Calculate proportional discount and tax
                    quantity_ratio = remaining_quantity / original_quantity
                    invoice_item.discount_amount = original_discount_amount * quantity_ratio
                    invoice_item.tax_amount = original_tax_amount * quantity_ratio
                else:
                    # Fallback if original_quantity is 0 (shouldn't happen)
                    invoice_item.discount_amount = Decimal('0.00')
                    invoice_item.tax_amount = Decimal('0.00')
                
                # Recalculate line_total for remaining quantity
                invoice_item.line_total = remaining_quantity * unit_price - invoice_item.discount_amount + invoice_item.tax_amount
                
                invoice_item.save()
                replaced_items.append({
                    'item_id': invoice_item.id,
                    'barcode_id': barcode_id,
                    'barcode': barcode_value,
                    'quantity': str(quantity),
                    'tag_updated': tag_updated,
                    'action': 'reduced',
                    'remaining_quantity': str(remaining_quantity)
                })
        
        if errors:
            return Response({
                'error': 'Some items failed to process',
                'errors': errors,
                'replaced_items': replaced_items
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Update invoice totals after all items are processed
        update_invoice_totals(invoice)
        invoice.refresh_from_db()
        
        # Adjust paid_amount if invoice was fully paid and items were removed
        # If paid_amount exceeds the new total, reduce it proportionally
        if invoice.paid_amount > invoice.total:
            # Calculate the refund amount (excess payment)
            excess_payment = invoice.paid_amount - invoice.total
            invoice.paid_amount = invoice.total
            invoice.due_amount = Decimal('0.00')
            
            # Create a refund Payment record to track the refund
            if excess_payment > 0:
                # Get the most recent payment method to use for refund (or default to 'cash')
                last_payment = invoice.payments.order_by('-created_at').first()
                refund_payment_method = last_payment.payment_method if last_payment else 'cash'
                
                # Create refund payment record
                refund_payment = Payment.objects.create(
                    invoice=invoice,
                    payment_method='refund',  # Use 'refund' payment method for clarity
                    amount=-excess_payment,  # Negative amount to indicate refund
                    reference=f'REFUND-PROCESS-{invoice.invoice_number}',
                    notes=f'Refund for processed replacement (Items removed/reduced). Original payment method: {refund_payment_method}',
                    created_by=request.user
                )
                
                # Audit log: Refund payment created
                create_audit_log(
                    request=request,
                    action='payment_refund',
                    model_name='Payment',
                    object_id=str(refund_payment.id),
                    object_name=f"Refund Payment for Processed Replacement - Invoice {invoice.invoice_number}",
                    object_reference=invoice.invoice_number,
                    barcode=None,
                    changes={
                        'payment_id': refund_payment.id,
                        'invoice_id': invoice.id,
                        'invoice_number': invoice.invoice_number,
                        'refund_amount': str(excess_payment),
                        'payment_method': refund_payment_method,
                        'replaced_items_count': len(replaced_items),
                    }
                )
        else:
            # Recalculate due_amount based on new total
            invoice.due_amount = invoice.total - invoice.paid_amount
        
        # Update invoice status based on payment
        if invoice.due_amount <= Decimal('0.00'):
            invoice.status = 'paid'
        elif invoice.paid_amount > Decimal('0.00'):
            invoice.status = 'partial'
        else:
            invoice.status = 'draft'
        
        invoice.save()
    
    # Return updated invoice
    serializer = InvoiceSerializer(invoice)
    return Response({
        'message': 'Replacement processed successfully',
        'invoice': serializer.data,
        'replaced_items': replaced_items
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def replacement_credit_note(request, invoice_id):
    """Process replacement with credit note - remove items from invoice, add to stock, create credit note"""
    invoice = get_object_or_404(Invoice, pk=invoice_id)
    
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process credit note replacement for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    items_to_replace = request.data.get('items_to_replace', [])
    store_id = request.data.get('store_id')
    notes = request.data.get('notes', '')
    
    if not items_to_replace or not isinstance(items_to_replace, list):
        return Response({
            'error': 'items_to_replace array is required'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    replaced_items = []
    errors = []
    total_credit_amount = Decimal('0.00')
    
    with transaction.atomic():
        for item_data in items_to_replace:
            item_id = item_data.get('item_id')
            quantity = Decimal(str(item_data.get('quantity', 0)))
            
            if not item_id or quantity <= Decimal('0'):
                errors.append(f'Invalid item_id or quantity for item: {item_id}')
                continue
            
            try:
                invoice_item = InvoiceItem.objects.select_related('product', 'barcode').get(
                    id=item_id,
                    invoice=invoice
                )
            except InvoiceItem.DoesNotExist:
                errors.append(f'Invoice item {item_id} not found')
                continue
            
            # Validate quantity doesn't exceed available quantity
            available_qty = invoice_item.quantity - invoice_item.replaced_quantity
            if quantity > available_qty:
                errors.append(f'Replacement quantity {quantity} exceeds available quantity {available_qty} for item {item_id}')
                continue
            
            # Strict validation: only items with 'sold' tag can be replaced
            product = invoice_item.product
            barcode_obj = invoice_item.barcode
            
            if product.track_inventory and barcode_obj:
                is_valid, error_msg = validate_barcode_for_replacement(barcode_obj)
                if not is_valid:
                    errors.append(f'Invoice item {item_id}: {error_msg}')
                    continue
            elif not product.track_inventory:
                product_barcode = product.barcodes.first()
                if product_barcode:
                    is_valid, error_msg = validate_barcode_for_replacement(product_barcode)
                    if not is_valid:
                        errors.append(f'Invoice item {item_id}: {error_msg}')
                        continue
            
            # Calculate credit amount (proportional to quantity)
            original_quantity = invoice_item.quantity
            original_line_total = invoice_item.line_total
            if original_quantity > Decimal('0'):
                credit_amount = (original_line_total / original_quantity) * quantity
            else:
                credit_amount = Decimal('0.00')
            
            total_credit_amount += credit_amount
            
            # Save original values
            original_quantity = invoice_item.quantity
            original_discount_amount = invoice_item.discount_amount
            original_tax_amount = invoice_item.tax_amount
            unit_price = invoice_item.manual_unit_price or invoice_item.unit_price
            
            # Update replaced_quantity for tracking
            invoice_item.replaced_quantity += quantity
            invoice_item.replaced_at = timezone.now()
            invoice_item.replaced_by = request.user
            
            # Determine if this is a full or partial replacement
            total_replaced = invoice_item.replaced_quantity
            
            if total_replaced >= original_quantity:
                # Full replacement - delete the invoice item
                replaced_items.append({
                    'item_id': invoice_item.id,
                    'product_id': product.id,
                    'variant_id': invoice_item.variant.id if invoice_item.variant else None,
                    'barcode_id': barcode_obj.id if barcode_obj else None,
                    'barcode': barcode_obj.barcode if barcode_obj else None,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity': str(quantity),
                    'credit_amount': str(credit_amount),
                    'action': 'deleted'
                })
                invoice_item.delete()
            else:
                # Partial replacement - reduce quantity and recalculate line_total
                remaining_quantity = original_quantity - total_replaced
                invoice_item.quantity = remaining_quantity
                
                # Proportionally adjust discount and tax for remaining quantity
                if original_quantity > Decimal('0'):
                    quantity_ratio = remaining_quantity / original_quantity
                    invoice_item.discount_amount = original_discount_amount * quantity_ratio
                    invoice_item.tax_amount = original_tax_amount * quantity_ratio
                else:
                    invoice_item.discount_amount = Decimal('0.00')
                    invoice_item.tax_amount = Decimal('0.00')
                
                # Recalculate line_total for remaining quantity
                invoice_item.line_total = remaining_quantity * unit_price - invoice_item.discount_amount + invoice_item.tax_amount
                invoice_item.save()
                replaced_items.append({
                    'item_id': invoice_item.id,
                    'product_id': product.id,
                    'variant_id': invoice_item.variant.id if invoice_item.variant else None,
                    'barcode_id': barcode_obj.id if barcode_obj else None,
                    'barcode': barcode_obj.barcode if barcode_obj else None,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'quantity': str(quantity),
                    'credit_amount': str(credit_amount),
                    'action': 'reduced',
                    'remaining_quantity': str(remaining_quantity)
                })
            
            # Return barcode back to inventory (use provided status or default unknown)
            if barcode_obj:
                old_tag = barcode_obj.tag
                barcode_obj.tag = item_data.get('status', 'unknown')
                barcode_obj.save()
                
                # Audit log: Barcode tag changed (sold -> updated status)
                create_audit_log(
                    request=request,
                    action='barcode_tag_change',
                    model_name='Barcode',
                    object_id=str(barcode_obj.id),
                    object_name=product.name,
                    object_reference=invoice.invoice_number,
                    barcode=barcode_obj.barcode,
                    changes={
                        'tag': {'old': old_tag, 'new': barcode_obj.tag},
                        'barcode': barcode_obj.barcode,
                        'product_id': product.id,
                        'product_name': product.name,
                        'invoice_id': invoice.id,
                        'invoice_number': invoice.invoice_number,
                        'invoice_item_id': invoice_item.id if total_replaced < original_quantity else 'deleted',
                        'quantity': str(quantity),
                        'reason': f'Credit note replacement - marked as {barcode_obj.tag}',
                    }
                )
            
            # Add product back to inventory (if track_inventory is enabled)
            if product.track_inventory:
                try:
                    from backend.locations.models import Store
                    store = Store.objects.get(pk=store_id) if store_id else invoice.store
                    if store:
                        stock, created = Stock.objects.get_or_create(
                            product=product,
                            variant__isnull=True,
                            store=store,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        stock.quantity += quantity
                        stock.save()
                except Exception as e:
                    errors.append(f'Error updating inventory for item {item_id}: {str(e)}')
        
        if errors:
            return Response({
                'error': 'Some items failed to process',
                'errors': errors,
                'replaced_items': replaced_items
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Update invoice totals after all items are processed
        update_invoice_totals(invoice)
        invoice.refresh_from_db()

        # IMPORTANT: Calculate the ACTUAL credit amount (overpayment)
        # If they paid more than the new total, the excess is the credit
        # If they haven't paid fully, the return just reduces their due amount
        actual_credit_amount = max(Decimal('0.00'), invoice.paid_amount - invoice.total)
        
        if actual_credit_amount > 0:
            # Shift the excess payment to credit note
            # This balances the invoice (paid_amount matches total)
            invoice.paid_amount = invoice.total
            invoice.due_amount = Decimal('0.00')
            invoice.status = 'paid'
            invoice.save()
        else:
            # Recalculate due_amount based on new total
            invoice.due_amount = invoice.total - invoice.paid_amount
            # Update invoice status
            if invoice.due_amount <= Decimal('0.00'):
                invoice.status = 'paid'
            elif invoice.paid_amount > Decimal('0.00'):
                invoice.status = 'partial'
            else:
                invoice.status = 'draft'
            invoice.save()
        
        # Create Return object for credit note
        from .models import Return, ReturnItem
        # Generate return number
        return_number = f"RET-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        while Return.objects.filter(return_number=return_number).exists():
            return_number = f"RET-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        
        return_obj = Return.objects.create(
            invoice=invoice,
            return_number=return_number,
            status='completed',
            reason='Credit note replacement',
            notes=notes or 'Credit note replacement',
            created_by=request.user
        )
        
        # Create ReturnItems for tracking
        for item_data in replaced_items:
            # Capture all info from item_data directly to prevent data loss even if invoice_item was deleted
            ReturnItem.objects.create(
                return_obj=return_obj,
                # Link to invoice_item ONLY if it still exists (partial replacement)
                invoice_item_id=item_data['item_id'] if item_data['action'] != 'deleted' else None,
                product_id=item_data['product_id'],
                variant_id=item_data['variant_id'],
                barcode_id=item_data['barcode_id'],
                product_name=item_data['product_name'],
                product_sku=item_data['product_sku'],
                quantity=Decimal(item_data['quantity']),
                condition='returned',
                refund_amount=Decimal(item_data['credit_amount'])
            )
        
        # Total quantity for credit note (sum of quantities of replaced items)
        total_replaced_qty = sum(Decimal(item['quantity']) for item in replaced_items)

        # Create credit note only if there is an actual credit amount OR if there are items returned (to track quantity)
        # But per USER request, "Fix zero-amount bug" implies we might want to avoid zero amount if it's purely monetary.
        # However, "Add quantity tracking to CreditNote" implies it can be used for quantity.
        # Let's create it if there's EITHER amount > 0 OR quantity > 0.
        credit_note = None
        if actual_credit_amount > 0 or total_replaced_qty > 0:
            credit_note_number = f"CN-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            while CreditNote.objects.filter(credit_note_number=credit_note_number).exists():
                credit_note_number = f"CN-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            
            # Create credit note
            credit_note = CreditNote.objects.create(
                return_obj=return_obj,
                credit_note_number=credit_note_number,
                amount=actual_credit_amount,
                quantity=total_replaced_qty,
                notes=notes or f'Credit note for replacement of items from invoice {invoice.invoice_number}',
                created_by=request.user
            )
        
        # Create ledger entry for credit note (CREDIT - refunding customer)
        if invoice.customer and actual_credit_amount > 0 and credit_note:
            from backend.parties.models import LedgerEntry
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=actual_credit_amount,
                quantity=total_replaced_qty,
                description=f'Credit note {credit_note.credit_note_number} for replacement of items from Invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=timezone.now()
            )
            create_internal_ledger_entry_if_mtshop(
                invoice.customer, 'credit', actual_credit_amount,
                f'Credit note {credit_note.credit_note_number} for replacement of items from Invoice {invoice.invoice_number}',
                request.user, timezone.now()
            )
            # Update customer credit_balance
            invoice.customer.credit_balance += entry.amount
            invoice.customer.save()
        
        # Audit log: Credit note replacement
        if credit_note:
            create_audit_log(
                request=request,
                action='replacement_credit_note',
                model_name='CreditNote',
                object_id=str(credit_note.id),
                object_name=f"Credit Note {credit_note.credit_note_number}",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'credit_note_number': credit_note.credit_note_number,
                    'credit_amount': str(actual_credit_amount),
                    'quantity': str(total_replaced_qty),
                    'items_count': len(replaced_items),
                    'notes': notes,
                }
            )
    
    # Return updated invoice and credit note
    serializer = InvoiceSerializer(invoice)
    return Response({
        'message': 'Credit note replacement processed successfully',
        'invoice': serializer.data,
        'credit_note': CreditNoteSerializer(credit_note).data if credit_note else None,
        'replaced_items': replaced_items,
        'actual_credit_amount': str(actual_credit_amount),
        'total_replaced_qty': str(total_replaced_qty)
    })