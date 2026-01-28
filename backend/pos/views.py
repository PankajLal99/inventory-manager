from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import F, Q
from decimal import Decimal, InvalidOperation
import uuid
from .models import POSSession, Cart, CartItem, Invoice, InvoiceItem, Payment, Return, ReturnItem, CreditNote, Repair
from backend.catalog.models import Barcode, Product, ProductVariant
from backend.inventory.models import Stock
from backend.core.utils import create_audit_log
from .serializers import (
    POSSessionSerializer, CartSerializer, CartItemSerializer, InvoiceSerializer,
    InvoiceItemSerializer, PaymentSerializer, ReturnSerializer, CreditNoteSerializer, RepairSerializer
)
from backend.catalog.label_generator import generate_label_image


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
    ).select_related('customer', 'store', 'created_by', 'repair').prefetch_related('items', 'payments').order_by('-created_at')
    
    # Filter by repair status if provided
    repair_status = request.query_params.get('repair_status', None)
    if repair_status:
        queryset = queryset.filter(repair__status=repair_status)
    
    # Search by repair barcode if provided
    repair_barcode = request.query_params.get('repair_barcode', None)
    if repair_barcode:
        queryset = queryset.filter(repair__barcode__icontains=repair_barcode)
    
    # Search by invoice number
    invoice_number = request.query_params.get('invoice_number', None)
    if invoice_number:
        queryset = queryset.filter(invoice_number__icontains=invoice_number)
    
    # Pagination
    from django.core.paginator import Paginator
    page = int(request.query_params.get('page', 1))
    limit = int(request.query_params.get('limit', 50))
    
    paginator = Paginator(queryset, limit)
    page_obj = paginator.get_page(page)
    
    serializer = InvoiceSerializer(page_obj, many=True)
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
    
    # Validate status
    valid_statuses = ['received', 'work_in_progress', 'done', 'delivered']
    if new_status not in valid_statuses:
        return Response(
            {'error': f'repair_status must be one of: {", ".join(valid_statuses)}'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Prevent marking as "done" (completed) if invoice is not paid or credit
    if new_status == 'done':
        invoice = repair.invoice
        if invoice.status not in ['paid', 'credit', 'partial']:
            return Response(
                {
                    'error': 'Cannot mark repair as completed',
                    'message': f'Invoice must be marked as Paid, Credit, or Partially Paid before marking repair as Completed. Current invoice status: {invoice.get_status_display()}'
                },
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

        repair_data = [{
            'product_name': display_name[:50],  # Tracking ID + Work Desc
            'barcode_value': repair_barcode.split('-')[-1],       # AMOUNT AS BARCODE
            'short_code': None,                  # Only one of barcode_value or short_code
            'barcode_id': repair.id,
            'vendor_name': f"{customer_name[:20]} | {repair.model_name}" if customer_name else repair.model_name,
            'purchase_date': created_date,
            'serial_number': contact_no[:10] if contact_no else None,
            'font_size_text':'15',
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
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def cart_list_create(request):
    """List all carts or create a new cart"""
    if request.method == 'GET':
        # If active parameter is provided, return active carts for current user
        if request.query_params.get('active') == 'true':
            # Return all active carts for the user, not just one
            active_carts = Cart.objects.filter(
                created_by=request.user,
                status='active'
            ).order_by('-updated_at')
            
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
        serializer = CartSerializer(data=request.data)
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
    
    # For DELETE, ensure user can only delete their own carts
    if request.method == 'DELETE':
        if cart.created_by != request.user:
            return Response(
                {'error': 'Permission denied', 'detail': 'You can only delete your own carts'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Release all SKUs/barcodes from scanned_barcodes back to available inventory
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
                    try:
                        barcode_obj = Barcode.objects.get(barcode=barcode_value)
                        # Restore from 'in-cart' or 'sold' back to 'new' when cart is deleted
                        old_tag = barcode_obj.tag
                        if barcode_obj.tag in ['in-cart', 'sold']:
                            barcode_obj.tag = 'new'
                            barcode_obj.save(update_fields=['tag'])
                            
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
        serializer = CartSerializer(cart, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cart_items(request, pk):
    """Add item to cart - prevents duplicate items"""
    cart = get_object_or_404(Cart, pk=pk)
    
    # Check if this is a custom product (borrowed product not in inventory)
    custom_product_name = request.data.get('custom_product_name')
    if custom_product_name:
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
        item_data = request.data.copy()
        item_data['product'] = product_id
        item_data['scanned_barcodes'] = []  # Empty list for custom products
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
    
    # Check if an existing cart item with the same product and variant exists
    existing_item = None
    variant_id = variant_id if variant_id else None
    
    if variant_id:
        existing_item = CartItem.objects.filter(
            cart=cart,
            product_id=product_id,
            variant_id=variant_id
        ).first()
    else:
        existing_item = CartItem.objects.filter(
            cart=cart,
            product_id=product_id,
            variant__isnull=True
        ).first()
    
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
                # Check selling_price first, then fall back to purchase_price
                selling_price = None
                purchase_price = Decimal('0.00')
                # For non-tracked products, use product_barcode (already retrieved above)
                if product_barcode:
                    selling_price = product_barcode.get_selling_price()
                    purchase_price = product_barcode.get_purchase_price()
                
                # Use selling_price if available and > 0, otherwise use purchase_price
                min_price = selling_price if selling_price and selling_price > Decimal('0.00') else purchase_price
                can_go_below = product.can_go_below_purchase_price
                price_type = 'selling price' if (selling_price and selling_price > Decimal('0.00')) else 'purchase price'

                # If can_go_below_purchase_price is False, price cannot be below min_price
                # IMPORTANT: If min_price is 0, it means purchase price couldn't be retrieved - this should not happen for valid products
                # For safety, if min_price is 0 and can_go_below is False, we should still validate (treat as error case)
                if not can_go_below and sale_price_decimal > 0:
                    if min_price > 0 and sale_price_decimal < min_price:
                        return Response({
                            'error': f'Sale price (₹{sale_price_decimal}) cannot be less than {price_type} (₹{min_price})',
                            'message': f'Sale price cannot be less than {price_type} of ₹{min_price}',
                            'purchase_price': str(purchase_price),
                            'sale_price': str(sale_price_decimal)
                        }, status=status.HTTP_400_BAD_REQUEST)
                    elif min_price == 0:
                        # Purchase price is 0 - this shouldn't happen for valid products, but block the sale as a safety measure
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
    scanned_value_str = str(scanned_value).strip() if scanned_value else None
    
    # Check if this barcode is already sold (assigned to an invoice item)
    # Allow 'new' and 'returned' tags to be added to cart - they are available for sale
    if scanned_value_str:
        # Try to find the barcode object - check BOTH barcode and short_code
        try:
            barcode_obj = Barcode.objects.filter(
                Q(barcode=scanned_value_str) | Q(short_code=scanned_value_str)
            ).first()
            
            if not barcode_obj:
                raise Barcode.DoesNotExist
            
            # Allow 'new' and 'returned' tags - they are available for sale
            if barcode_obj.tag in ['new', 'returned']:
                # These tags are available, continue processing
                pass
            elif barcode_obj.tag == 'sold':
                # Check which invoice it's assigned to
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
                # Barcode is already in another cart - block adding to this cart
                return Response({
                    'error': 'Item already in cart',
                    'message': f'Barcode/SKU {scanned_value_str} is already in another cart and cannot be added to this cart.'
                }, status=status.HTTP_400_BAD_REQUEST)
            else:
                # For other tags (defective, unknown), block them
                tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') else barcode_obj.tag
                return Response({
                    'error': 'Item not available',
                    'message': f'Barcode/SKU {scanned_value_str} has tag "{tag_display}" and cannot be added to cart. Only items with "new" or "returned" tags can be sold.'
                }, status=status.HTTP_400_BAD_REQUEST)
        except Barcode.DoesNotExist:
            # Barcode not found in database - might be SKU or a new barcode
            # For SKU-based products without barcodes, we can't track individual items
            # So we allow them to be scanned multiple times
            pass
    
    # Get or find an available barcode for this product
    # If barcode is provided, verify it belongs to this product and is available
    barcode_obj = None
    barcode_value_to_use = None
    
    if scanned_value_str:
        # Try to find the barcode object - check BOTH barcode and short_code
        try:
            barcode_obj = Barcode.objects.get(
                Q(barcode=scanned_value_str) | Q(short_code=scanned_value_str)
            )

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
            all_active_carts = Cart.objects.filter(status='active')
            all_cart_items = CartItem.objects.filter(cart__in=all_active_carts)
            for item in all_cart_items:
                if item.scanned_barcodes and scanned_value_str in item.scanned_barcodes:
                    return Response({
                        'error': 'This barcode/SKU has already been scanned',
                        'message': 'Item with this barcode/SKU is already in another cart'
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
            
            # Block if barcode is already in another cart
            if barcode_obj.tag == 'in-cart':
                return Response({
                    'error': 'Barcode is not available',
                    'message': f'Barcode {scanned_value_str} is already in another cart and cannot be added to this cart.',
                    'current_tag': barcode_obj.tag
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
    
    # If no barcode provided or not found, find an available barcode for this product
    if not barcode_obj:
        # Get all barcodes already in ALL active carts (to avoid duplicates across carts)
        all_active_carts = Cart.objects.filter(status='active')
        all_cart_items_all_carts = CartItem.objects.filter(cart__in=all_active_carts)
        cart_barcodes = set()
        for item in all_cart_items_all_carts:
            if item.scanned_barcodes:
                cart_barcodes.update(item.scanned_barcodes)
        
        # Find available barcodes (new, not sold, not in any active cart, from finalized purchases)
        available_barcodes = Barcode.objects.filter(
            product=product,
            variant_id=variant_id if variant_id else None,
            tag='new',  # Only new barcodes
            purchase_item__purchase__status='finalized'  # Only from finalized purchases
        ).exclude(
            barcode__in=cart_barcodes
        )
        
        # Exclude barcodes that are already sold
        sold_barcode_ids = InvoiceItem.objects.filter(
            barcode__in=available_barcodes.values_list('id', flat=True)
        ).exclude(
            invoice__status='void'
        ).values_list('barcode_id', flat=True)
        
        available_barcodes = available_barcodes.exclude(id__in=sold_barcode_ids)
        
        # Get a random available barcode (order by random)
        barcode_obj = available_barcodes.order_by('?').first()
        
        if barcode_obj:
            barcode_value_to_use = barcode_obj.barcode
        else:
            # No available barcodes
            return Response({
                'error': 'No available items for this product',
                'message': 'All items of this product have been sold or are already in cart'
            }, status=status.HTTP_400_BAD_REQUEST)
    
    # If existing item found, add the barcode to it and increment quantity
    if existing_item:
        # Add barcode to the list if not already present
        if not existing_item.scanned_barcodes:
            existing_item.scanned_barcodes = []
            
        if barcode_value_to_use and barcode_value_to_use not in existing_item.scanned_barcodes:
            with transaction.atomic():
                existing_item.scanned_barcodes.append(barcode_value_to_use)
                existing_item.quantity = Decimal(len(existing_item.scanned_barcodes))
                existing_item.save(update_fields=['scanned_barcodes', 'quantity'])
                
                # Mark barcode as 'in-cart' when added to cart
                if barcode_obj and barcode_obj.tag in ['new', 'returned']:
                    barcode_obj.tag = 'in-cart'
                    barcode_obj.save(update_fields=['tag'])
                
                # Update stock quantity when tracked item barcode is added to existing cart item
                # Use helper function to reduce duplication (always reduces by 1 for tracked products)
                if cart.store and barcode_obj:
                    reduce_stock_for_cart_item(product, variant_id, cart.store, Decimal('1.000'))
            
            # Audit log: Item barcode added to existing cart item (tracked inventory)
            barcode_str = barcode_value_to_use if barcode_value_to_use else None
            create_audit_log(
                request=request,
                action='cart_add',
                model_name='CartItem',
                object_id=str(existing_item.id),
                object_name=f"{product.name}",
                object_reference=f"Cart #{cart.cart_number or cart.id}",
                barcode=barcode_str,
                changes={
                    'product_id': product.id,
                    'product_name': product.name,
                    'product_sku': product.sku,
                    'barcode_added': barcode_str,
                    'new_quantity': str(existing_item.quantity),
                    'unit_price': str(existing_item.unit_price),
                    'cart_id': cart.id,
                    'cart_number': cart.cart_number,
                    'action': 'barcode_added_to_existing_item',
                }
            )
            
            serializer = CartItemSerializer(existing_item)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            # Barcode already in this item
            serializer = CartItemSerializer(existing_item)
            return Response(serializer.data, status=status.HTTP_200_OK)
    
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
            # Check selling_price first, then fall back to purchase_price
            selling_price = None
            purchase_price = Decimal('0.00')
            if barcode_obj:
                selling_price = barcode_obj.get_selling_price()
                purchase_price = barcode_obj.get_purchase_price()
            elif product.track_inventory:
                # Fallback for tracked products if barcode_obj is None (edge case): Get barcode from product's first barcode
                product_barcode = product.barcodes.first()
                if product_barcode:
                    selling_price = product_barcode.get_selling_price()
                    purchase_price = product_barcode.get_purchase_price()
            
            # Use selling_price if available and > 0, otherwise use purchase_price
            min_price = selling_price if selling_price and selling_price > Decimal('0.00') else purchase_price
            can_go_below = product.can_go_below_purchase_price
            price_type = 'selling price' if (selling_price and selling_price > Decimal('0.00')) else 'purchase price'

            # If can_go_below_purchase_price is False, price cannot be below min_price
            # IMPORTANT: If min_price is 0, it means purchase price couldn't be retrieved - this should not happen for valid products
            # For safety, if min_price is 0 and can_go_below is False, we should still validate (treat as error case)
            if not can_go_below and sale_price_decimal > 0:
                if min_price > 0 and sale_price_decimal < min_price:
                    return Response({
                        'error': f'Sale price (₹{sale_price_decimal}) cannot be less than {price_type} (₹{min_price})',
                        'message': f'Sale price cannot be less than {price_type} of ₹{min_price}',
                        'purchase_price': str(purchase_price),
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
                elif min_price == 0:
                    # Purchase price is 0 - this shouldn't happen for valid products, but block the sale as a safety measure
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
        
        # Handle barcodes for tracked inventory items - restore from 'in-cart' or 'sold' to 'new'
        if cart_item.product.track_inventory and cart_item.scanned_barcodes:
            for barcode_value in cart_item.scanned_barcodes:
                if not barcode_value:
                    continue
                try:
                    barcode_obj = Barcode.objects.get(barcode=barcode_value)
                    # Restore from 'in-cart' or 'sold' back to 'new' when cart item is deleted
                    old_tag = barcode_obj.tag
                    if barcode_obj.tag in ['in-cart', 'sold']:
                        barcode_obj.tag = 'new'
                        barcode_obj.save(update_fields=['tag'])
                        
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
                # Find next available barcode for this product
                # Check across ALL active carts
                all_active_carts = Cart.objects.filter(status='active')
                all_cart_items_all_carts = CartItem.objects.filter(cart__in=all_active_carts)
                cart_barcodes = set()
                for item in all_cart_items_all_carts:
                    if item.scanned_barcodes:
                        cart_barcodes.update(item.scanned_barcodes)
                
                # Find available barcodes (new, not sold, not in any active cart)
                available_barcodes = Barcode.objects.filter(
                    product=cart_item.product,
                    variant=cart_item.variant,
                    tag='new'
                ).exclude(
                    barcode__in=cart_barcodes
                )
                
                # Exclude barcodes that are already sold
                sold_barcode_ids = InvoiceItem.objects.filter(
                    barcode__in=available_barcodes.values_list('id', flat=True)
                ).exclude(
                    invoice__status='void'
                ).values_list('barcode_id', flat=True)
                
                available_barcodes = available_barcodes.exclude(id__in=sold_barcode_ids)
                next_barcode = available_barcodes.order_by('?').first()
                
                if not next_barcode:
                    return Response({
                        'error': 'No available items',
                        'message': 'No more available SKUs for this product'
                    }, status=status.HTTP_400_BAD_REQUEST)
                
                # Add barcode to list
                if next_barcode.barcode not in cart_item.scanned_barcodes:
                    cart_item.scanned_barcodes.append(next_barcode.barcode)
                    cart_item.quantity = Decimal(len(cart_item.scanned_barcodes))
                    cart_item.save(update_fields=['scanned_barcodes', 'quantity'])
            
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
            # Check selling_price first, then fall back to purchase_price
            selling_price = None
            purchase_price = Decimal('0.00')
            if cart_item.scanned_barcodes and len(cart_item.scanned_barcodes) > 0:
                # For tracked products: Get selling_price and purchase_price from first barcode (all barcodes in item should have same price)
                try:
                    first_barcode = Barcode.objects.get(barcode=cart_item.scanned_barcodes[0])
                    selling_price = first_barcode.get_selling_price()
                    purchase_price = first_barcode.get_purchase_price()
                except Barcode.DoesNotExist:
                    # Barcode not found - fallback to product's first barcode for tracked products
                    if cart_item.product.track_inventory:
                        product_barcode = cart_item.product.barcodes.first()
                        if product_barcode:
                            selling_price = product_barcode.get_selling_price()
                            purchase_price = product_barcode.get_purchase_price()
            elif not cart_item.product.track_inventory:
                # For non-tracked products: Get barcode from product's first barcode
                product_barcode = cart_item.product.barcodes.first()
                if product_barcode:
                    selling_price = product_barcode.get_selling_price()
                    purchase_price = product_barcode.get_purchase_price()
            elif cart_item.product.track_inventory:
                # For tracked products with no scanned_barcodes (edge case): Get barcode from product's first barcode
                product_barcode = cart_item.product.barcodes.first()
                if product_barcode:
                    selling_price = product_barcode.get_selling_price()
                    purchase_price = product_barcode.get_purchase_price()
            
            # Use selling_price if available and > 0, otherwise use purchase_price
            min_price = selling_price if selling_price and selling_price > Decimal('0.00') else purchase_price
            can_go_below = cart_item.product.can_go_below_purchase_price
            price_type = 'selling price' if (selling_price and selling_price > Decimal('0.00')) else 'purchase price'

            # If can_go_below_purchase_price is False, price cannot be below min_price
            # IMPORTANT: If min_price is 0, it means purchase price couldn't be retrieved - this should not happen for valid products
            # For safety, if min_price is 0 and can_go_below is False, we should still validate (treat as error case)
            if not can_go_below and sale_price_decimal > 0:
                if min_price > 0 and sale_price_decimal < min_price:
                    return Response({
                        'error': f'Sale price (₹{sale_price_decimal}) cannot be less than {price_type} (₹{min_price})',
                        'message': f'Sale price cannot be less than {price_type} of ₹{min_price}',
                        'purchase_price': str(purchase_price),
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
                elif min_price == 0:
                    # Purchase price is 0 - this shouldn't happen for valid products, but block the sale as a safety measure
                    return Response({
                        'error': 'Purchase price not available',
                        'message': 'Cannot determine purchase price for this product. Please ensure the product has been purchased and has a valid purchase price.',
                        'purchase_price': '0.00',
                        'sale_price': str(sale_price_decimal)
                    }, status=status.HTTP_400_BAD_REQUEST)
        except (ValueError, TypeError) as e:
            # Log the error for debugging but let serializer handle validation
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
                    # Get purchase price for validation
                    selling_price = None
                    purchase_price = Decimal('0.00')
                    if cart_item.scanned_barcodes and len(cart_item.scanned_barcodes) > 0:
                        try:
                            first_barcode = Barcode.objects.get(barcode=cart_item.scanned_barcodes[0])
                            selling_price = first_barcode.get_selling_price()
                            purchase_price = first_barcode.get_purchase_price()
                        except Barcode.DoesNotExist:
                            if cart_item.product.track_inventory:
                                product_barcode = cart_item.product.barcodes.first()
                                if product_barcode:
                                    selling_price = product_barcode.get_selling_price()
                                    purchase_price = product_barcode.get_purchase_price()
                    elif not cart_item.product.track_inventory:
                        product_barcode = cart_item.product.barcodes.first()
                        if product_barcode:
                            selling_price = product_barcode.get_selling_price()
                            purchase_price = product_barcode.get_purchase_price()
                    elif cart_item.product.track_inventory:
                        product_barcode = cart_item.product.barcodes.first()
                        if product_barcode:
                            selling_price = product_barcode.get_selling_price()
                            purchase_price = product_barcode.get_purchase_price()
                    
                    min_price = selling_price if selling_price and selling_price > Decimal('0.00') else purchase_price
                    can_go_below = cart_item.product.can_go_below_purchase_price
                    price_type = 'selling price' if (selling_price and selling_price > Decimal('0.00')) else 'purchase price'
                    
                    if not can_go_below and min_price > 0 and final_price_decimal < min_price:
                        return Response({
                            'error': f'Sale price (₹{final_price_decimal}) cannot be less than {price_type} (₹{min_price})',
                            'message': f'Sale price cannot be less than {price_type} of ₹{min_price}',
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
    try:
        cart_item = CartItem.objects.get(id=item_id, cart=cart)
    except CartItem.DoesNotExist:
        return Response({'error': 'Cart item not found'}, status=status.HTTP_404_NOT_FOUND)
    
    barcode_to_remove = request.data.get('barcode')
    if not barcode_to_remove:
        return Response({'error': 'Barcode is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if barcode exists in scanned_barcodes
    if not cart_item.scanned_barcodes or barcode_to_remove not in cart_item.scanned_barcodes:
        return Response({'error': 'Barcode not found in cart item'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Remove the barcode from scanned_barcodes
    cart_item.scanned_barcodes.remove(barcode_to_remove)
    cart_item.quantity = Decimal(len(cart_item.scanned_barcodes))
    
    # If quantity becomes 0, delete the cart item
    if cart_item.quantity == 0:
        cart_item.delete()
        return Response({'message': 'Cart item removed', 'deleted': True}, status=status.HTTP_200_OK)
    
    cart_item.save(update_fields=['scanned_barcodes', 'quantity'])
    
    # Release the barcode back to available inventory - restore from 'in-cart' or 'sold' to 'new'
    try:
        barcode_obj = Barcode.objects.get(barcode=barcode_to_remove)
        old_tag = barcode_obj.tag
        if barcode_obj.tag in ['in-cart', 'sold']:
            # Restore to 'new' (default) - could be enhanced to remember original state
            barcode_obj.tag = 'new'
            barcode_obj.save(update_fields=['tag'])
            
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
                    'context': 'cart_item_sku_removed',
                }
            )
    except Barcode.DoesNotExist:
        pass  # Barcode doesn't exist, skip
    
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
def cart_checkout(request, pk):
    """Checkout a cart - create invoice with invoice_type and update stock"""
    cart = get_object_or_404(Cart, pk=pk)
    
    # Determine if it's a repair shop first to allow empty carts for bookings
    is_repair_shop = False
    if cart.store:
        cart.store.refresh_from_db()
        shop_type = cart.store.shop_type.lower() if cart.store.shop_type else None
        is_repair_shop = (shop_type == 'repair')
    
    # Empty cart check - allow empty carts ONLY for repair shops (bookings)
    if not cart.items.exists() and not is_repair_shop:
        return Response({'error': 'Cart is empty'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Get invoice_type from request or use cart's invoice_type
    invoice_type = request.data.get('invoice_type', cart.invoice_type or 'cash')
    customer_id = request.data.get('customer', cart.customer_id if cart.customer else None)
    
    # For mixed payments, get split amounts
    cash_amount = request.data.get('cash_amount', None)
    upi_amount = request.data.get('upi_amount', None)
    
    # Validate split payments for mixed type
    if invoice_type == 'mixed':
        if cash_amount is None or upi_amount is None:
            return Response({
                'error': 'Both cash_amount and upi_amount are required for mixed payment type'
            }, status=status.HTTP_400_BAD_REQUEST)
        cash_amount = Decimal(str(cash_amount))
        upi_amount = Decimal(str(upi_amount))
        total_split = cash_amount + upi_amount
        # Will validate against invoice.total later after calculation
    
    # For Cash/UPI/Mixed invoices, validate that all items have prices
    if invoice_type in ['cash', 'upi', 'mixed']:
        items_without_price = []
        for item in cart.items.all():
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
    
    # Debug logging to help diagnose issues
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Checkout: cart_id={cart.id}, store_id={cart.store.id if cart.store else None}, "
                f"store_name={cart.store.name if cart.store else None}, "
                f"shop_type={cart.store.shop_type if cart.store else None}, "
                f"is_repair_shop={is_repair_shop}, invoice_type={invoice_type}")
    
    # For repair shops, validate repair fields regardless of invoice_type
    # Only validate if shop_type is explicitly 'repair' (case-insensitive)
    # Also check if repair data is being sent (frontend might have switched stores)
    repair_contact_no = request.data.get('repair_contact_no', '').strip()
    repair_model_name = request.data.get('repair_model_name', '').strip()
    repair_description = request.data.get('repair_description', '').strip()
    repair_booking_amount = request.data.get('repair_booking_amount', None)
    
    # Only treat as repair shop if:
    # 1. Store shop_type is 'repair' AND repair data is provided, OR
    # 2. Repair data is explicitly provided (even if store type doesn't match - user might have switched stores)
    has_repair_data = bool(repair_contact_no or repair_model_name)
    
    # If repair data is provided but store is not repair shop, log warning but allow it
    # (This handles cases where user switched stores but frontend still sends repair data)
    if has_repair_data and not is_repair_shop:
        logger.warning(f"Repair data provided but cart store (id={cart.store.id if cart.store else None}, shop_type={shop_type}) is not repair shop. Allowing checkout but will not create Repair record.")
    
    # Only require repair fields if store is actually a repair shop
    # If store is NOT a repair shop, ignore any repair data that might be sent (user might have switched stores)
    if is_repair_shop:
        # Store is a repair shop - require repair fields
        if not repair_contact_no:
            return Response({
                'error': 'repair_contact_no is required for repair shop invoices',
                'message': 'Contact number is required for repair orders'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        if not repair_model_name:
            return Response({
                'error': 'repair_model_name is required for repair shop invoices',
                'message': 'Model name is required for repair orders'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate booking amount if provided (for repair shops only)
        if repair_booking_amount:
            try:
                booking_amount_decimal = Decimal(str(repair_booking_amount))
                if booking_amount_decimal < 0:
                    return Response({
                        'error': 'repair_booking_amount cannot be negative',
                        'message': 'Booking amount must be a positive number'
                    }, status=status.HTTP_400_BAD_REQUEST)
            except (ValueError, TypeError, InvalidOperation):
                return Response({
                    'error': 'Invalid repair_booking_amount format',
                    'message': 'Booking amount must be a valid number'
                }, status=status.HTTP_400_BAD_REQUEST)
    elif has_repair_data:
        # Repair data provided but store is not repair shop - ignore it (user might have switched stores)
        # Log warning but don't require repair fields for non-repair stores
        logger.warning(f"Repair data provided for non-repair store (cart_id={cart.id}, store_id={cart.store.id if cart.store else None}, shop_type={shop_type}). Ignoring repair data and allowing checkout.")
        # Clear repair data so it's not used
        repair_contact_no = ''
        repair_model_name = ''
        repair_booking_amount = None
    
    # Generate invoice number
    invoice_number = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    while Invoice.objects.filter(invoice_number=invoice_number).exists():
        invoice_number = f"INV-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    
    # Create invoice within transaction to ensure atomicity
    with transaction.atomic():
        invoice = Invoice.objects.create(
            invoice_number=invoice_number,
            cart=cart,
            store=cart.store,
            customer_id=customer_id,
            invoice_type=invoice_type,
            status='draft',
            created_by=request.user
        )
        
        # Create Repair record if it's a repair shop (regardless of invoice_type)
        # Only create if store is actually a repair shop (don't create for retail stores even if repair data is sent)
        if is_repair_shop:
            # Get repair-specific fields (already validated above)
            # These are already extracted earlier in the function
            
            # Parse booking amount (already validated above)
            booking_amount_decimal = None
            if repair_booking_amount:
                booking_amount_decimal = Decimal(str(repair_booking_amount))
            
            # Generate repair barcode
            repair_barcode = f"REP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            while Repair.objects.filter(barcode=repair_barcode).exists():
                repair_barcode = f"REP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            
            # Create Repair record (within same transaction as invoice)
            Repair.objects.create(
                invoice=invoice,
                contact_no=repair_contact_no,
                model_name=repair_model_name,
                description=repair_description,
                booking_amount=booking_amount_decimal,
                status='received',
                barcode=repair_barcode
            )
    
    # Calculate totals
    subtotal = Decimal('0.00')
    discount_total = Decimal('0.00')
    tax_total = Decimal('0.00')
    
    # Create invoice items and update stock
    for cart_item in cart.items.all():
        # Validate quantity to prevent division errors
        if cart_item.quantity <= Decimal('0.000'):
            continue  # Skip items with zero or negative quantity
        
        effective_price = cart_item.manual_unit_price or cart_item.unit_price or Decimal('0.00')
        
        # Calculate per-unit discount and tax safely
        per_unit_discount = Decimal('0.00')
        per_unit_tax = Decimal('0.00')
        if cart_item.quantity > Decimal('0.000'):
            per_unit_discount = cart_item.discount_amount / cart_item.quantity
            per_unit_tax = cart_item.tax_amount / cart_item.quantity
        
        unit_line_total = effective_price - per_unit_discount + per_unit_tax
        
        # Handle non-tracked products differently (no barcodes needed)
        if not cart_item.product.track_inventory:
            # For non-tracked products, create a single invoice item with the full quantity
            line_total = unit_line_total * cart_item.quantity
            
            invoice_item = InvoiceItem.objects.create(
                invoice=invoice,
                product=cart_item.product,
                variant=cart_item.variant,
                barcode=None,  # No barcode for non-tracked products
                quantity=cart_item.quantity,
                unit_price=cart_item.unit_price,
                manual_unit_price=cart_item.manual_unit_price,
                discount_amount=cart_item.discount_amount,
                tax_amount=cart_item.tax_amount,
                line_total=line_total
            )
            
            # Audit log: Invoice item created (non-tracked)
            create_audit_log(
                request=request,
                action='invoice_create',
                model_name='InvoiceItem',
                object_id=str(invoice_item.id),
                object_name=f"{cart_item.product.name} (Invoice {invoice.invoice_number})",
                object_reference=invoice.invoice_number,
                barcode=None,
                changes={
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'product_id': cart_item.product.id,
                    'product_name': cart_item.product.name,
                    'product_sku': cart_item.product.sku,
                    'quantity': str(cart_item.quantity),
                    'unit_price': str(cart_item.unit_price),
                    'line_total': str(line_total),
                    'track_inventory': False,
                }
            )
            
            subtotal += line_total
            discount_total += invoice_item.discount_amount
            tax_total += invoice_item.tax_amount
            
            # Stock was already decremented when item was added to cart
            # No need to decrement again on checkout for any invoice type
            # Stock will remain decremented (already sold/reserved)
            
            # For non-tracked products, we do NOT mark the barcode as 'sold'
            # The barcode stays as 'new' and sold quantity is tracked via InvoiceItems
            # This allows the product to remain visible and available quantity is tracked via Stock
            
            continue  # Skip barcode logic for non-tracked products
        
        # For tracked products, handle barcodes
        # IMPORTANT: Use the exact barcodes from scanned_barcodes - these are the ones the user scanned
        barcodes_to_assign = []
        if cart_item.scanned_barcodes and len(cart_item.scanned_barcodes) > 0:
            # Use all the scanned barcodes from the list - these are the exact barcodes the user scanned
            # This ensures we use the exact barcode that was scanned, not a random one
            for scanned_barcode_value in cart_item.scanned_barcodes:
                try:
                    barcode_obj = Barcode.objects.get(barcode=scanned_barcode_value)
                    # IMPORTANT: Use the exact barcode that was scanned
                    # Only block if tag is 'sold' and it's currently assigned to an active invoice
                    # 'returned' barcodes can be sold again even if they were in a previous invoice
                    if barcode_obj.tag == 'sold':
                        sold_item = InvoiceItem.objects.filter(
                            barcode=barcode_obj
                        ).exclude(
                            invoice__status='void'
                        ).first()
                        if sold_item:
                            # Skip this barcode - it's already sold and in an active invoice
                            continue
                    # Allow 'new', 'returned', and 'in-cart' tags - use the exact barcode that was scanned
                    # 'in-cart' tags are expected during checkout (barcodes already in cart)
                    # Don't check for previous invoice assignments for 'returned' tags - they can be resold
                    if barcode_obj.tag in ['new', 'returned', 'in-cart']:
                        barcodes_to_assign.append(barcode_obj)
                except Barcode.DoesNotExist:
                    # Barcode not found - this shouldn't happen if it was scanned correctly
                    pass
        
        # Only find additional barcodes if we don't have enough from scanned_barcodes
        # This should rarely happen since scanned_barcodes should contain all needed barcodes
        quantity_needed = int(cart_item.quantity)
        if len(barcodes_to_assign) < quantity_needed:
            # Get all barcodes already assigned in this checkout
            assigned_barcode_ids = [b.id for b in barcodes_to_assign]
            
            # Find available barcodes - allow 'new', 'returned', and 'in-cart' tags
            # 'in-cart' tags are expected during checkout (barcodes already in cart)
            barcode_query = Barcode.objects.filter(
                product=cart_item.product,
                variant=cart_item.variant,
                tag__in=['new', 'returned', 'in-cart']  # Allow new, returned, and in-cart barcodes
            ).exclude(
                id__in=assigned_barcode_ids
            )
            
            # Exclude barcodes already sold
            sold_barcode_ids = InvoiceItem.objects.filter(
                barcode__in=barcode_query.values_list('id', flat=True)
            ).exclude(
                invoice__status='void'
            ).values_list('barcode_id', flat=True)
            
            barcode_query = barcode_query.exclude(id__in=sold_barcode_ids)
            
            # Get next available barcode
            next_barcode = barcode_query.first()
            if next_barcode:
                barcodes_to_assign.append(next_barcode)
            else:
                # No more available barcodes
                break
        
        if len(barcodes_to_assign) == 0:
            # No barcodes available
            continue
        
        # For tracked products, create one invoice item per barcode (each with quantity 1)
        for i, barcode_obj in enumerate(barcodes_to_assign):
            # Calculate line total for this single item
            line_total = unit_line_total
        
            invoice_item = InvoiceItem.objects.create(
                invoice=invoice,
                product=cart_item.product,
                variant=cart_item.variant,
                barcode=barcode_obj,  # Assign the barcode
                quantity=Decimal('1.000'),  # Each invoice item is quantity 1
                unit_price=cart_item.unit_price,
                manual_unit_price=cart_item.manual_unit_price,
                discount_amount=per_unit_discount,  # Proportional discount (already calculated safely)
                tax_amount=per_unit_tax,  # Proportional tax (already calculated safely)
                line_total=line_total
            )
            
            # Mark barcode as sold when assigned to invoice item
            # Mark as 'sold' for all invoice types (including pending) since the item is now in an invoice
            # Once an item is in an invoice, it should be considered sold regardless of payment status
            barcode_obj.tag = 'sold'
            barcode_obj.save(update_fields=['tag'])
            
            # Audit log: Invoice item created (tracked with barcode)
            create_audit_log(
                request=request,
                action='invoice_create',
                model_name='InvoiceItem',
                object_id=str(invoice_item.id),
                object_name=f"{cart_item.product.name} (Invoice {invoice.invoice_number})",
                object_reference=invoice.invoice_number,
                barcode=barcode_obj.barcode,
                changes={
                    'invoice_id': invoice.id,
                    'invoice_number': invoice.invoice_number,
                    'product_id': cart_item.product.id,
                    'product_name': cart_item.product.name,
                    'product_sku': cart_item.product.sku,
                    'barcode': barcode_obj.barcode,
                    'barcode_tag': barcode_obj.tag,
                    'quantity': '1.000',
                    'unit_price': str(cart_item.unit_price),
                    'line_total': str(line_total),
                    'track_inventory': True,
                }
            )
        
            subtotal += line_total
            discount_total += invoice_item.discount_amount
            tax_total += invoice_item.tax_amount
        
        # Stock reduction logic:
        # - For non-tracked products: Stock was already decremented when added to cart
        # - For tracked products: Stock is now also decremented when added to cart (to prevent double-booking)
        # So we don't need to reduce stock again at checkout for either type
        # Stock reduction happens at cart addition time to ensure items are reserved immediately
        
        # Note: Stock was already reduced when items were added to cart,
        # so we don't reduce it again here to avoid double-reduction
        # Audit logs for stock removal are already created in cart_add operation
    
    # Update invoice totals
    invoice.subtotal = subtotal
    invoice.discount_amount = discount_total
    invoice.tax_amount = tax_total
    invoice.total = subtotal - discount_total + tax_total
    
    # Set payment status based on invoice_type
    if invoice_type == 'pending':
        invoice.status = 'draft'
        invoice.due_amount = invoice.total
        invoice.paid_amount = Decimal('0.00')
    elif invoice_type == 'mixed':
        # Validate split payments match total
        if cash_amount + upi_amount != invoice.total:
            invoice.delete()  # Clean up invoice if validation fails
            return Response({
                'error': f'Split payment amounts (₹{cash_amount + upi_amount}) do not match invoice total (₹{invoice.total})'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        invoice.status = 'paid'
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        
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
    else:  # cash or upi (both are paid)
        invoice.status = 'paid'
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        
        # Create Payment record
        from backend.pos.models import Payment
        Payment.objects.create(
            invoice=invoice,
            payment_method=invoice_type,  # 'cash' or 'upi'
            amount=invoice.total,
            created_by=request.user
        )
    
    invoice.save()
    
    # Create ledger entry if customer exists
    if invoice.customer:
        from backend.parties.models import LedgerEntry
        if invoice_type == 'pending':
            # Pending invoice: Customer owes us (DEBIT entry)
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='debit',
                amount=invoice.total,
                description=f'Invoice {invoice.invoice_number} ({invoice_type.upper()})',
                created_by=request.user,
                created_at=invoice.created_at or timezone.now()
            )
            # Update customer credit_balance
            invoice.customer.credit_balance -= entry.amount
            invoice.customer.save()
        else:  # cash, upi, or mixed (all are paid)
            # Paid invoice: Customer paid us (CREDIT entry - money received)
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=invoice.total,
                description=f'Invoice {invoice.invoice_number} ({invoice_type.upper()})',
                created_by=request.user,
                created_at=invoice.created_at or timezone.now()
            )
            # Update customer credit_balance
            invoice.customer.credit_balance += entry.amount
            invoice.customer.save()
    
    # Update cart status
    cart.status = 'completed'
    cart.save()
    
    # Audit log: Cart checked out
    items_summary = [f"{item.product.name} x{item.quantity}" for item in invoice.items.all()]
    create_audit_log(
        request=request,
        action='cart_checkout',
        model_name='Cart',
        object_id=str(cart.id),
        object_name=f"Cart #{cart.cart_number or cart.id}",
        object_reference=f"Invoice {invoice.invoice_number}",
        barcode=None,
        changes={
            'cart_id': cart.id,
            'cart_number': cart.cart_number,
            'invoice_id': invoice.id,
            'invoice_number': invoice.invoice_number,
            'invoice_type': invoice_type,
            'items_count': invoice.items.count(),
            'items': items_summary,
            'total': str(invoice.total),
            'customer': invoice.customer.name if invoice.customer else None,
        }
    )
    
    serializer = InvoiceSerializer(invoice)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


# Invoice views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def invoice_list_create(request):
    """List all invoices or create a new invoice"""
    if request.method == 'GET':
        queryset = Invoice.objects.select_related('customer', 'store', 'created_by').prefetch_related('items', 'payments').all()
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
            queryset = queryset.filter(invoice_number__icontains=search)
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

        queryset = queryset.order_by('-created_at')
        
        # Pagination: limit 50 per page
        from django.core.paginator import Paginator
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 50))
        
        paginator = Paginator(queryset, limit)
        page_obj = paginator.get_page(page)
        
        serializer = InvoiceSerializer(page_obj, many=True)
        return Response({
            'results': serializer.data,
            'count': paginator.count,
            'next': page_obj.next_page_number() if page_obj.has_next() else None,
            'previous': page_obj.previous_page_number() if page_obj.has_previous() else None,
            'page': page,
            'page_size': limit,
            'total_pages': paginator.num_pages,
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
        allowed_fields_for_all = {'invoice_type', 'store'}  # Fields that can be edited for any invoice
        
        # If updating only invoice_type and/or store, allow it for any invoice
        # Otherwise, only allow editing draft pending invoices
        if not update_fields.issubset(allowed_fields_for_all):
            # Updating other fields - only allow for draft pending invoices
            if invoice.status != 'draft' or invoice.invoice_type != 'pending':
                return Response(
                    {'error': 'Only draft pending invoices can be edited. You can only edit invoice_type and store for other invoices.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Track changes for audit log
        old_invoice_type = invoice.invoice_type
        old_store = invoice.store_id if invoice.store else None
        
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
            
            # If invoice_type changed to 'pending', reset status and payment fields
            if invoice_type_changed and invoice.invoice_type == 'pending':
                invoice.status = 'draft'
                invoice.paid_amount = Decimal('0.00')
                invoice.due_amount = Decimal('0.00')
                invoice.save()
            
            if invoice_type_changed or not update_fields.issubset(allowed_fields_for_all):
                update_invoice_totals(invoice)
                invoice.refresh_from_db()
            
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
            # Track status change if invoice_type changed to pending
            if invoice_type_changed and invoice.invoice_type == 'pending' and old_status != invoice.status:
                changes['status'] = {'old': old_status, 'new': invoice.status}
                changes['paid_amount'] = {'old': str(old_paid_amount), 'new': '0.00'}
                changes['due_amount'] = {'old': str(old_due_amount), 'new': '0.00'}
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
        
        # Reverse stock changes if requested and invoice was not draft
        if restore_stock and invoice.status != 'draft' and invoice.store:
            for item in invoice.items.all():
                # Reverse stock for both tracked and non-tracked products
                stock, created = Stock.objects.get_or_create(
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_payments(request, pk):
    """Add payment to invoice"""
    invoice = get_object_or_404(Invoice, pk=pk)
    serializer = PaymentSerializer(data={**request.data, 'invoice': invoice.id})
    if serializer.is_valid():
        payment = serializer.save(created_by=request.user)
        
        # Update invoice paid amount
        old_paid = invoice.paid_amount or Decimal('0.00')
        invoice.paid_amount = old_paid + payment.amount
        invoice.due_amount = invoice.total - invoice.paid_amount
        
        # Update invoice status
        old_status = invoice.status
        if invoice.due_amount <= Decimal('0.00'):
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
    if new_invoice_type not in ['cash', 'upi', 'pending', 'mixed']:
        return Response(
            {'error': 'Invalid invoice_type. Must be cash, upi, pending, or mixed'},
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
    if new_invoice_type in ['cash', 'upi', 'mixed']:
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
            # Get selling_price first, then fall back to purchase_price
            selling_price = None
            purchase_price = Decimal('0.00')
            if item.barcode:
                # For tracked products: Get price from item's barcode
                selling_price = item.barcode.get_selling_price()
                purchase_price = item.barcode.get_purchase_price()
            elif not item.product.track_inventory:
                # For non-tracked products: Get barcode from product's first barcode
                product_barcode = item.product.barcodes.first()
                if product_barcode:
                    selling_price = product_barcode.get_selling_price()
                    purchase_price = product_barcode.get_purchase_price()
            
            # Use selling_price if available and > 0, otherwise use purchase_price
            min_price = selling_price if selling_price and selling_price > Decimal('0.00') else purchase_price
            can_go_below = item.product.can_go_below_purchase_price
            price_type = 'selling price' if (selling_price and selling_price > Decimal('0.00')) else 'purchase price'
            
            # Validate price threshold if product doesn't allow going below purchase/selling price
            if not can_go_below and min_price > 0 and effective_price < min_price:
                price_validation_errors.append({
                    'id': item.id,
                    'product_name': item.product.name,
                    'product_sku': item.product.sku,
                    'sale_price': str(effective_price),
                    'min_price': str(min_price),
                    'price_type': price_type
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
    if new_invoice_type in ['cash', 'upi', 'mixed']:
        for item in invoice.items.all():
            if invoice.store:
                if item.product.track_inventory:
                    # For tracked products, stock needs to be decremented per barcode (quantity 1 per barcode)
                    stock, created = Stock.objects.get_or_create(
                        product=item.product,
                        variant=item.variant,
                        store=invoice.store,
                        defaults={'quantity': Decimal('0.000')}
                    )
                    stock.quantity = max(Decimal('0.000'), stock.quantity - item.quantity)
                    stock.save()
                # For non-tracked products, stock was already decremented when item was added to cart/invoice
                # No need to decrement again here
            
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
        # Don't update invoice_type (keep it as pending)
        # Don't update stock or mark barcodes as sold (already handled above - skipped for pending)
        invoice.status = 'draft'
        invoice.paid_amount = Decimal('0.00')
        invoice.due_amount = invoice.total
        invoice.save()
    elif new_invoice_type == 'mixed':
        # Validate split payments match total
        if cash_amount + upi_amount != invoice.total:
            return Response({
                'error': f'Split payment amounts (₹{cash_amount + upi_amount}) do not match invoice total (₹{invoice.total})'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Actually checkout - update invoice type, mark as paid, update stock
        # Stock and barcodes already updated above
        invoice.invoice_type = new_invoice_type
        invoice.status = 'paid'
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        invoice.save()
        
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
        # For cash/upi: Actually checkout - update invoice type, mark as paid, update stock
        # Stock and barcodes already updated above (lines 1934-1960)
        invoice.invoice_type = new_invoice_type
        invoice.status = 'paid'
        invoice.paid_amount = invoice.total
        invoice.due_amount = Decimal('0.00')
        invoice.save()
        
        # Create Payment record
        from backend.pos.models import Payment
        Payment.objects.create(
            invoice=invoice,
            payment_method=new_invoice_type,  # 'cash' or 'upi'
            amount=invoice.total,
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
        # Find the original debit entry for this pending invoice
        original_entry = LedgerEntry.objects.filter(
            invoice=invoice,
            entry_type='debit'
        ).first()
        
        if original_entry:
            # Reverse the debit entry (credit it back)
            reverse_entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=original_entry.amount,
                description=f'Reversed pending entry for Invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=timezone.now()
            )
            invoice.customer.credit_balance += reverse_entry.amount
        
        # Create new ledger entry based on invoice type
        if new_invoice_type in ['cash', 'upi', 'mixed']:
            # Paid invoice: Customer paid us (CREDIT entry - money received)
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=invoice.total,
                description=f'Invoice {invoice.invoice_number} ({new_invoice_type.upper()}) (checked out from pending)',
                created_by=request.user,
                created_at=invoice.created_at or timezone.now()
            )
            invoice.customer.credit_balance += entry.amount
        # For pending invoices, keep the original debit entry (already reversed above)
        
        invoice.customer.save()
    
    serializer = InvoiceSerializer(invoice)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invoice_mark_credit(request, pk):
    """Mark an invoice as credit and create ledger entry"""
    from django.db import transaction
    
    # Use transaction to ensure atomicity
    with transaction.atomic():
        # Use select_for_update to prevent race conditions
        invoice = Invoice.objects.select_for_update().get(pk=pk)
        
            # Only allow marking draft pending invoices as credit
        if invoice.status != 'draft' or invoice.invoice_type != 'pending':
            return Response(
                {'error': 'Only draft pending invoices can be marked as credit'},
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
        
        # Update invoice status to credit FIRST (before recalculating totals)
        # This ensures update_invoice_totals calculates correctly
        old_status = invoice.status
        invoice.status = 'credit'
        invoice.invoice_type = 'pending'  # Keep as pending type
        # Save the status change immediately
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
        invoice.due_amount = invoice.total  # Customer owes the full amount
        invoice.paid_amount = Decimal('0.00')
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
            
            # Calculate net balance from existing entries to reverse
            net_balance_to_reverse = Decimal('0.00')
            for entry in existing_entries:
                if entry.entry_type == 'debit':
                    net_balance_to_reverse -= entry.amount
                else:  # credit
                    net_balance_to_reverse += entry.amount
            
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
    
    # Only allow adding items to draft invoices (credit or pending)
    if invoice.status != 'draft' or invoice.invoice_type != 'pending':
        return Response(
            {'error': 'Items can only be added to draft credit or pending invoices'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # For pending invoices, set prices to 0
    item_data = request.data.copy()
    if invoice.invoice_type == 'pending':
        item_data['unit_price'] = Decimal('0.00')
        item_data['manual_unit_price'] = None
        item_data['discount_amount'] = Decimal('0.00')
        item_data['tax_amount'] = Decimal('0.00')
    
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
            
            # Get the first available barcode
            barcode_obj = available_barcodes.first()
            
            if barcode_obj:
                item.barcode = barcode_obj
                # Mark barcode as sold when assigned to invoice item
                # Mark as 'sold' for all invoice types (including pending) since the item is now in an invoice
                # Once an item is in an invoice, it should be considered sold regardless of payment status
                old_tag = barcode_obj.tag
                barcode_obj.tag = 'sold'
                barcode_obj.save(update_fields=['tag'])
                item.save()
                
                # Audit log: Barcode tag changed (new -> sold)
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
        
        return Response(InvoiceItemSerializer(updated_item).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def update_invoice_totals(invoice):
    """Helper function to recalculate invoice totals"""
    items = invoice.items.all()
    
    # For pending invoices, totals should always be 0
    if invoice.invoice_type == 'pending' and invoice.status == 'draft':
        invoice.subtotal = Decimal('0.00')
        invoice.total = Decimal('0.00')
        invoice.due_amount = Decimal('0.00')
    else:
        subtotal = sum(item.line_total for item in items)
        invoice.subtotal = subtotal
        invoice.total = subtotal - invoice.discount_amount + invoice.tax_amount
        invoice.due_amount = invoice.total - invoice.paid_amount
    
    invoice.save()


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
    """Retrieve a credit note"""
    credit_note = get_object_or_404(
        CreditNote.objects.select_related(
            'return_obj', 'return_obj__invoice', 'return_obj__invoice__customer', 'created_by'
        ),
        pk=pk
    )
    serializer = CreditNoteSerializer(credit_note)
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
            try:
                barcode_obj = Barcode.objects.get(barcode=barcode_value)
                product = barcode_obj.product
            except Barcode.DoesNotExist:
                pass
        
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
                
                # Also search by barcode if no results
                if not invoice_items_by_sku.exists():
                    invoice_items_by_sku = InvoiceItem.objects.filter(
                        barcode__barcode__iexact=sku_clean
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
    
    try:
        barcode_obj = Barcode.objects.get(barcode=barcode_value)
    except Barcode.DoesNotExist:
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
    
    # Validate invoice is not void, draft, or pending
    # Replacement is only eligible for items marked 'sold' (from completed invoices)
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process replacement for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if invoice.status == 'draft' or invoice.invoice_type == 'pending':
        return Response({
            'error': 'Cannot process replacement for draft/pending invoice',
            'message': 'Replacement is only eligible for items from completed invoices (not draft/pending).'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Find new barcode for replacement product
    new_barcode = None
    scanned_barcode = request.data.get('scanned_barcode')  # Get the exact barcode scanned/searched
    
    if new_product:
        # Only allow barcodes with tag='new' or tag='returned' (available inventory)
        if scanned_barcode:
            # Try to find the exact barcode that was scanned
            # Check both barcode and short_code fields
            from django.db.models import Q
            
            try:
                # First try: exact match with product, variant, and available tags
                # Match either barcode OR short_code
                new_barcode = Barcode.objects.get(
                    Q(barcode=scanned_barcode) | Q(short_code=scanned_barcode),
                    product=new_product,
                    variant=invoice_item.variant,
                    tag__in=['new', 'returned']  # Only available inventory
                )
            except Barcode.DoesNotExist:
                # Second try: exact match without variant constraint
                try:
                    new_barcode = Barcode.objects.get(
                        Q(barcode=scanned_barcode) | Q(short_code=scanned_barcode),
                        product=new_product,
                        tag__in=['new', 'returned']  # Only available inventory
                    )
                except Barcode.DoesNotExist:
                    # Exact barcode not found or not available
                    return Response({
                        'error': f'Barcode {scanned_barcode} not found or not available for sale',
                        'message': f'The barcode {scanned_barcode} is either not found, already sold, or not in available inventory (must be tagged as "new" or "returned").'
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
    
    # Validate invoice is not void, draft, or pending
    # Replacement is only eligible for items marked 'sold' (from completed invoices)
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process return for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if invoice.status == 'draft' or invoice.invoice_type == 'pending':
        return Response({
            'error': 'Cannot process return for draft/pending invoice',
            'message': 'Replacement is only eligible for items from completed invoices (not draft/pending).'
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
    
    # Validate invoice is not void, draft, or pending
    # Replacement is only eligible for items marked 'sold' (from completed invoices)
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process defective marking for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if invoice.status == 'draft' or invoice.invoice_type == 'pending':
        return Response({
            'error': 'Cannot process defective marking for draft/pending invoice',
            'message': 'Replacement is only eligible for items from completed invoices (not draft/pending).'
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
            status__in=['void', 'draft']
        ).exclude(
            invoice_type='pending'
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
    """Find invoice by barcode/SKU or invoice number for replacement - returns full invoice with all items"""
    barcode_value = request.data.get('barcode')
    sku = request.data.get('sku')
    invoice_number = request.data.get('invoice_number')
    
    # If invoice_number is provided, search by invoice number first
    if invoice_number:
        invoice_number_clean = str(invoice_number).strip()
        try:
            # Try exact match first - only exclude void (allow draft/pending for Return to Stock)
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
    
    search_value_clean = str(search_value).strip()
    
    try:
        # Try to find invoice item by barcode (for tracked products)
        # First try with 'sold' tag (preferred for replacement) - case-insensitive search
        invoice_items = InvoiceItem.objects.filter(
            barcode__barcode__iexact=search_value_clean,
            barcode__tag='sold'  # Only items with 'sold' tag can be replaced
        ).exclude(
            invoice__status__in=['void', 'draft']
        ).exclude(
            invoice__invoice_type='pending'
        ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')
        
        # If not found with 'sold' tag, try without tag restriction (for Return to Stock scenarios)
        # Still exclude draft/pending invoices - case-insensitive search
        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                barcode__barcode__iexact=search_value_clean
            ).exclude(
                invoice__status__in=['void', 'draft']
            ).exclude(
                invoice__invoice_type='pending'
            ).select_related('invoice', 'product', 'barcode', 'invoice__store', 'invoice__customer')
        
        # If not found by barcode, try by product SKU (for non-tracked products)
        if not invoice_items.exists():
            invoice_items = InvoiceItem.objects.filter(
                product__sku__iexact=search_value_clean
            ).exclude(
                invoice__status__in=['void', 'draft']
            ).exclude(
                invoice__invoice_type='pending'
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
                invoice__status__in=['void', 'draft']
            ).exclude(
                invoice__invoice_type='pending'
            ).select_related('invoice', 'product', 'variant', 'barcode', 'invoice__store', 'invoice__customer')
        
        if not invoice_items.exists():
            return Response({
                'error': 'No invoice found for this barcode/SKU',
                'message': f'No sold items found with barcode/SKU: {search_value_clean}. Replacement is only eligible for items from completed invoices (not draft/pending).'
            }, status=status.HTTP_404_NOT_FOUND)
        
        # Get the most recent invoice (or first one if multiple)
        invoice_item = invoice_items.order_by('-invoice__created_at').first()
        invoice = invoice_item.invoice
        
        # Double-check invoice is not draft/pending
        if invoice.status == 'draft' or invoice.invoice_type == 'pending':
            return Response({
                'error': 'Invoice is in draft/pending state',
                'message': 'Replacement is only eligible for items from completed invoices (not draft/pending).'
            }, status=status.HTTP_400_BAD_REQUEST)
        
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
        
        # Return full invoice with all items
        serializer = InvoiceSerializer(invoice)
        return Response({
            'invoice': serializer.data,
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
def process_replacement(request, invoice_id):
    """Process replacement - mark items as unknown and remove/reduce items from invoice"""
    invoice = get_object_or_404(Invoice, pk=invoice_id)
    
    # Validate invoice is not void, draft, or pending
    # Replacement is only eligible for items marked 'sold' (from completed invoices)
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process replacement for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if invoice.status == 'draft' or invoice.invoice_type == 'pending':
        return Response({
            'error': 'Cannot process replacement for draft/pending invoice',
            'message': 'Replacement is only eligible for items from completed invoices (not draft/pending).'
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
    
    # Validate invoice is not void, draft, or pending
    if invoice.status == 'void':
        return Response({
            'error': 'Cannot process credit note replacement for void invoice'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if invoice.status == 'draft' or invoice.invoice_type == 'pending':
        return Response({
            'error': 'Cannot process credit note replacement for draft/pending invoice',
            'message': 'Credit note replacement is only eligible for items from completed invoices (not draft/pending).'
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
                    'barcode_id': barcode_obj.id if barcode_obj else None,
                    'barcode': barcode_obj.barcode if barcode_obj else None,
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
                    'barcode_id': barcode_obj.id if barcode_obj else None,
                    'barcode': barcode_obj.barcode if barcode_obj else None,
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
                            variant=invoice_item.variant,
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
                    reference=f'REFUND-CN-{invoice.invoice_number}',
                    notes=f'Refund for credit note replacement (Credit Amount: {total_credit_amount}). Original payment method: {refund_payment_method}',
                    created_by=request.user
                )
                
                # Audit log: Refund payment created
                create_audit_log(
                    request=request,
                    action='payment_refund',
                    model_name='Payment',
                    object_id=str(refund_payment.id),
                    object_name=f"Refund Payment for Credit Note Replacement - Invoice {invoice.invoice_number}",
                    object_reference=invoice.invoice_number,
                    barcode=None,
                    changes={
                        'payment_id': refund_payment.id,
                        'invoice_id': invoice.id,
                        'invoice_number': invoice.invoice_number,
                        'refund_amount': str(excess_payment),
                        'credit_note_amount': str(total_credit_amount),
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
            # Try to get the invoice item if it still exists (partial replacement)
            try:
                invoice_item = InvoiceItem.objects.get(id=item_data['item_id'])
            except InvoiceItem.DoesNotExist:
                # Item was deleted (full replacement), skip ReturnItem creation
                continue
            
            ReturnItem.objects.create(
                return_obj=return_obj,
                invoice_item=invoice_item,
                quantity=Decimal(item_data['quantity']),
                condition='returned',
                refund_amount=Decimal(item_data['credit_amount'])
            )
        
        # Generate credit note number
        credit_note_number = f"CN-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        while CreditNote.objects.filter(credit_note_number=credit_note_number).exists():
            credit_note_number = f"CN-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        
        # Create credit note
        credit_note = CreditNote.objects.create(
            return_obj=return_obj,
            credit_note_number=credit_note_number,
            amount=total_credit_amount,
            notes=notes or f'Credit note for replacement of items from invoice {invoice.invoice_number}',
            created_by=request.user
        )
        
        # Create ledger entry for credit note (CREDIT - refunding customer)
        if invoice.customer and total_credit_amount > 0:
            from backend.parties.models import LedgerEntry
            entry = LedgerEntry.objects.create(
                customer=invoice.customer,
                invoice=invoice,
                entry_type='credit',
                amount=total_credit_amount,
                description=f'Credit note {credit_note_number} for replacement of items from Invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=timezone.now()
            )
            # Update customer credit_balance
            invoice.customer.credit_balance += entry.amount
            invoice.customer.save()
        
        # Audit log: Credit note replacement
        create_audit_log(
            request=request,
            action='replacement_credit_note',
            model_name='CreditNote',
            object_id=str(credit_note.id),
            object_name=f"Credit Note {credit_note_number}",
            object_reference=invoice.invoice_number,
            barcode=None,
            changes={
                'invoice_id': invoice.id,
                'invoice_number': invoice.invoice_number,
                'credit_note_number': credit_note_number,
                'credit_amount': str(total_credit_amount),
                'items_count': len(replaced_items),
                'notes': notes,
            }
        )
    
    # Return updated invoice and credit note
    serializer = InvoiceSerializer(invoice)
    return Response({
        'message': 'Credit note replacement processed successfully',
        'invoice': serializer.data,
        'credit_note': CreditNoteSerializer(credit_note).data,
        'replaced_items': replaced_items,
        'total_credit_amount': str(total_credit_amount)
    })
