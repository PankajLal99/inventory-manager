from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.shortcuts import get_object_or_404
from .models import Purchase, PurchaseItem
from .serializers import PurchaseSerializer, PurchaseItemSerializer
from backend.core.utils import create_audit_log
from backend.inventory.models import Stock
from decimal import Decimal


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def purchase_list_create(request):
    """List all purchases or create a new purchase"""
    if request.method == 'GET':
        queryset = Purchase.objects.all().prefetch_related('items', 'items__product')
        
        # Filters
        supplier = request.query_params.get('supplier', None)
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        status_filter = request.query_params.get('status', None)

        if supplier:
            queryset = queryset.filter(supplier_id=supplier)
        if date_from:
            queryset = queryset.filter(purchase_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(purchase_date__lte=date_to)
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Order by latest purchase creation (most recently created first)
        queryset = queryset.order_by('-id', '-created_at')
        
        # Pagination
        from django.core.paginator import Paginator
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 15))
        
        paginator = Paginator(queryset, limit)
        page_obj = paginator.get_page(page)
        
        serializer = PurchaseSerializer(page_obj, many=True)
        response = Response({
            'results': serializer.data,
            'count': paginator.count,
            'next': page_obj.next_page_number() if page_obj.has_next() else None,
            'previous': page_obj.previous_page_number() if page_obj.has_previous() else None,
            'page': page,
            'page_size': limit,
            'total_pages': paginator.num_pages,
        })
        # Reduced cache time + must-revalidate for fresh data
        # Frontend React Query will handle caching better
        response['Cache-Control'] = 'private, max-age=10, must-revalidate'
        
        # Add timestamp to help with cache busting
        from django.utils import timezone
        response['X-Data-Version'] = timezone.now().isoformat()
        
        return response
    else:  # POST
        data = request.data.copy()
        items_data = data.pop('items', [])
        
        serializer = PurchaseSerializer(
            data=data,
            context={'items_data': items_data, 'request': request, 'is_vendor_purchase': False}
        )
        if serializer.is_valid():
            purchase = serializer.save(created_by=request.user)
            return Response(PurchaseSerializer(purchase).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def purchase_detail(request, pk):
    """Retrieve, update or delete a purchase"""
    purchase = get_object_or_404(Purchase.objects.prefetch_related('items', 'items__product'), pk=pk)
    
    if request.method == 'GET':
        serializer = PurchaseSerializer(purchase)
        return Response(serializer.data)
    elif request.method == 'PUT':
        data = request.data.copy()
        items_data = data.pop('items', None)
        
        serializer = PurchaseSerializer(
            purchase, 
            data=data,
            context={'items_data': items_data, 'request': request, 'is_vendor_purchase': False}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        data = request.data.copy()
        items_data = data.pop('items', None)
        
        serializer = PurchaseSerializer(
            purchase, 
            data=data, 
            partial=True,
            context={'items_data': items_data, 'request': request, 'is_vendor_purchase': False}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        from backend.catalog.models import Barcode, BarcodeLabel
        from django.db import transaction
        
        purchase_number = purchase.purchase_number
        purchase_id = str(purchase.id)
        
        # Get barcode IDs before transaction for blob deletion after response
        barcodes_to_delete = Barcode.objects.filter(
            purchase=purchase
        ).exclude(tag='sold')
        blob_deletion_ids = list(barcodes_to_delete.values_list('id', flat=True))
        
        with transaction.atomic():
            # Delete all barcodes associated with this purchase (except sold ones)
            # Sold barcodes should be kept as they're already in invoices
            barcodes_to_delete = Barcode.objects.filter(
                purchase=purchase
            ).exclude(tag='sold').select_related('product', 'variant')  # Keep sold barcodes, load related for audit logs
            
            # Get barcode details before deletion for audit logs
            barcode_details = list(barcodes_to_delete.values(
                'id', 'barcode', 'product_id', 'product__name', 'product__sku', 'variant_id'
            ))
            
            # Get barcode IDs before deletion for label cleanup
            barcode_ids = [b['id'] for b in barcode_details]
            
            # Delete associated labels first
            if barcode_ids:
                BarcodeLabel.objects.filter(barcode_id__in=barcode_ids).delete()
            
            # Create audit logs for each barcode deletion BEFORE deleting them
            for barcode_detail in barcode_details:
                create_audit_log(
                    request=request,
                    action='delete',
                    model_name='Barcode',
                    object_id=str(barcode_detail['id']),
                    object_name=barcode_detail['product__name'] or 'Unknown Product',
                    object_reference=barcode_detail['product__sku'] or None,
                    barcode=barcode_detail['barcode'],
                    changes={
                        'barcode': barcode_detail['barcode'],
                        'product_id': barcode_detail['product_id'],
                        'product_name': barcode_detail['product__name'],
                        'product_sku': barcode_detail['product__sku'],
                        'variant_id': barcode_detail['variant_id'],
                        'purchase_id': purchase_id,
                        'purchase_number': purchase_number,
                        'reason': 'Purchase deleted - non-sold barcodes removed'
                    }
                )
            
            # Delete non-sold barcodes
            deleted_barcode_count = barcodes_to_delete.delete()[0]
            
            # Get purchase items count and details BEFORE deletion (for audit logs)
            purchase_items = list(purchase.items.select_related('product', 'variant').all())
            purchase_items_count = len(purchase_items)
            
            # Update Stock model ONLY if purchase was finalized (stock was actually added)
            # Draft purchases never added stock, so no need to reverse
            from backend.inventory.models import Stock
            from decimal import Decimal
            
            # Only reverse stock if purchase was finalized and has a location (store/warehouse)
            if purchase.status == 'finalized' and (purchase.store or purchase.warehouse):
                # Process all purchase items to reverse stock
                for item in purchase_items:
                    # Try to get existing stock entry (don't create if it doesn't exist)
                    # If stock doesn't exist, it means stock was never added or already removed
                    try:
                        stock = Stock.objects.get(
                            product=item.product,
                            variant=item.variant,
                            store=purchase.store,
                            warehouse=purchase.warehouse
                        )
                        
                        # Reverse the stock addition (subtract quantity)
                        quantity_to_remove = Decimal(str(item.quantity))
                        old_stock_quantity = stock.quantity
                        
                        if stock.quantity >= quantity_to_remove:
                            stock.quantity -= quantity_to_remove
                        else:
                            # If stock is less than quantity, set to 0 (shouldn't happen, but safety check)
                            stock.quantity = Decimal('0')
                        stock.save()
                        
                        # Create audit log for stock adjustment
                        create_audit_log(
                            request=request,
                            action='stock_adjust',
                            model_name='Stock',
                            object_id=str(stock.id),
                            object_name=item.product.name if item.product else 'Unknown Product',
                            object_reference=item.product.sku if item.product else None,
                            barcode=None,
                            changes={
                                'product_id': item.product.id if item.product else None,
                                'product_name': item.product.name if item.product else None,
                                'product_sku': item.product.sku if item.product else None,
                                'variant_id': item.variant.id if item.variant else None,
                                'adjustment_type': 'out',
                                'quantity': str(quantity_to_remove),
                                'reason': 'Purchase deleted - stock reversed',
                                'purchase_id': purchase_id,
                                'purchase_number': purchase_number,
                                'old_stock_quantity': str(old_stock_quantity),
                                'new_stock_quantity': str(stock.quantity),
                            }
                        )
                    except Stock.DoesNotExist:
                        # Stock entry doesn't exist - this means stock was never added or already removed
                        # This can happen if:
                        # 1. Purchase was finalized but stock update failed
                        # 2. Stock was already manually adjusted/removed
                        # 3. Purchase items were modified after finalization
                        # Just log it but don't fail
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.warning(
                            f"Stock entry not found when deleting purchase {purchase_number} "
                            f"for product {item.product.name if item.product else 'Unknown'} "
                            f"(ID: {item.product.id if item.product else None}). "
                            f"Stock may have never been added or already removed."
                        )
                        # Still create an audit log to track this
                        create_audit_log(
                            request=request,
                            action='stock_adjust',
                            model_name='Stock',
                            object_id=f'purchase_{purchase_id}_item_{item.id}',
                            object_name=item.product.name if item.product else 'Unknown Product',
                            object_reference=item.product.sku if item.product else None,
                            barcode=None,
                            changes={
                                'product_id': item.product.id if item.product else None,
                                'product_name': item.product.name if item.product else None,
                                'product_sku': item.product.sku if item.product else None,
                                'variant_id': item.variant.id if item.variant else None,
                                'adjustment_type': 'out',
                                'quantity': str(item.quantity),
                                'reason': 'Purchase deleted - stock reversal attempted but stock entry not found',
                                'purchase_id': purchase_id,
                                'purchase_number': purchase_number,
                                'note': 'Stock entry did not exist - may have never been added or already removed',
                            }
                        )
            
            # Now delete the purchase (this will cascade delete PurchaseItems)
            purchase.delete()
            
            # Create audit log for purchase deletion
            create_audit_log(
                request=request,
                action='delete',
                model_name='Purchase',
                object_id=purchase_id,
                object_name=f"Purchase {purchase_number}",
                object_reference=purchase_number,
                barcode=None,
                changes={
                    'purchase_number': purchase_number,
                    'barcodes_deleted': deleted_barcode_count,
                    'purchase_items_count': purchase_items_count,
                    'purchase_status': purchase.status,
                    'note': 'Purchase deleted along with non-sold barcodes, purchase items' + (', and stock reversed' if purchase.status == 'finalized' and (purchase.store or purchase.warehouse) else '') + '. Products were not deleted.'
                }
            )
        
        # Fire-and-forget: Delete blobs from Azure Storage (non-blocking, errors suppressed)
        # This runs after transaction but doesn't block the response
        if blob_deletion_ids:
            # Call deletion directly - all errors are caught internally, won't block or raise
            try:
                from backend.catalog.azure_label_service import delete_blobs_for_barcodes
                # Call directly - function handles all errors internally
                delete_blobs_for_barcodes(blob_deletion_ids)
            except Exception:
                # Silently ignore - blob cleanup is best effort, don't log or raise
                pass
        
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def purchase_items(request, pk):
    """Get, create, update or delete items for a purchase"""
    purchase = get_object_or_404(Purchase, pk=pk)
    
    if request.method == 'GET':
        items = purchase.items.all().select_related('product')
        serializer = PurchaseItemSerializer(items, many=True)
        return Response(serializer.data)
    elif request.method == 'POST':
        # Create new item
        serializer = PurchaseItemSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(purchase=purchase)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PUT':
        # Replace all items
        items_data = request.data if isinstance(request.data, list) else [request.data]
        purchase.items.all().delete()
        created_items = []
        for item_data in items_data:
            serializer = PurchaseItemSerializer(data=item_data)
            if serializer.is_valid():
                item = serializer.save(purchase=purchase)
                created_items.append(item)
            else:
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response(PurchaseItemSerializer(created_items, many=True).data)
    elif request.method == 'PATCH':
        # Update existing items
        items_data = request.data if isinstance(request.data, list) else [request.data]
        for item_data in items_data:
            item_id = item_data.get('id')
            if item_id:
                item = get_object_or_404(PurchaseItem, id=item_id, purchase=purchase)
                serializer = PurchaseItemSerializer(item, data=item_data, partial=True)
                if serializer.is_valid():
                    serializer.save()
                else:
                    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response({'status': 'updated'})
    else:  # DELETE
        item_id = request.query_params.get('item_id')
        if item_id:
            item = get_object_or_404(PurchaseItem, id=item_id, purchase=purchase)
            item.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({'error': 'item_id required'}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])  # Public endpoint for vendors
def vendor_purchases(request):
    """Public endpoint for vendors to view and create their purchases"""
    from backend.core.utils import create_audit_log
    
    supplier_id = request.query_params.get('supplier', None)
    
    if not supplier_id:
        return Response({'error': 'supplier parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == 'GET':
        queryset = Purchase.objects.filter(supplier_id=supplier_id).prefetch_related('items', 'items__product')
        
        # Optional filters
        date_from = request.query_params.get('date_from', None)
        date_to = request.query_params.get('date_to', None)
        status_filter = request.query_params.get('status', None)
        
        if date_from:
            queryset = queryset.filter(purchase_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(purchase_date__lte=date_to)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        serializer = PurchaseSerializer(queryset, many=True)
        
        # Audit log for vendor viewing purchases
        try:
            from backend.parties.models import Supplier
            supplier = Supplier.objects.get(id=supplier_id)
            create_audit_log(
                request=request,
                action='vendor_view_purchases',
                model_name='Purchase',
                object_id=None,
                object_name=f"Vendor purchases list - {supplier.name}",
                object_reference=f"supplier_{supplier_id}",
                barcode=None,
                changes={
                    'supplier_id': supplier_id,
                    'supplier_name': supplier.name,
                    'action': 'view_purchases_list',
                    'filters': {
                        'date_from': date_from,
                        'date_to': date_to,
                        'status': status_filter
                    }
                }
            )
        except Exception:
            pass  # Don't fail if audit log fails
        
        return Response(serializer.data)
    else:  # POST
        data = request.data.copy()
        items_data = data.pop('items', [])
        
        # Ensure supplier matches URL parameter
        data['supplier'] = supplier_id
        # Always create as draft
        data['status'] = 'draft'
        
        serializer = PurchaseSerializer(
            data=data,
            context={'items_data': items_data, 'request': request, 'is_vendor_purchase': True}
        )
        if serializer.is_valid():
            purchase = serializer.save()  # No created_by for vendor purchases
            
            # Audit log for vendor purchase creation
            try:
                from backend.parties.models import Supplier
                supplier = Supplier.objects.get(id=supplier_id)
                items_summary = [f"{item.product.name if item.product else 'Unknown'} x{item.quantity}" for item in purchase.items.all()]
                create_audit_log(
                    request=request,
                    action='vendor_create_purchase',
                    model_name='Purchase',
                    object_id=str(purchase.id),
                    object_name=f"Purchase {purchase.purchase_number}",
                    object_reference=purchase.purchase_number,
                    barcode=None,
                    changes={
                        'supplier_id': supplier_id,
                        'supplier_name': supplier.name,
                        'purchase_number': purchase.purchase_number,
                        'purchase_date': str(purchase.purchase_date),
                        'items_count': purchase.items.count(),
                        'items': items_summary,
                        'total': str(purchase.get_total()),
                        'created_by': 'vendor',
                        'ip_address': request.META.get('REMOTE_ADDR', 'unknown')
                    }
                )
            except Exception:
                pass  # Don't fail if audit log fails
            
            return Response(PurchaseSerializer(purchase).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PATCH'])
@permission_classes([AllowAny])  # Public endpoint for vendors
def vendor_purchase_detail(request, pk):
    """Public endpoint for vendors to view and update their purchases"""
    supplier_id = request.query_params.get('supplier', None)
    
    if not supplier_id:
        return Response({'error': 'supplier parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    purchase = get_object_or_404(
        Purchase.objects.prefetch_related('items', 'items__product'),
        pk=pk,
        supplier_id=supplier_id
    )
    
    # Vendors can only edit draft purchases
    if request.method == 'PATCH' and purchase.status != 'draft':
        return Response(
            {'error': 'Cannot edit purchase that is not in draft status'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    if request.method == 'GET':
        serializer = PurchaseSerializer(purchase)
        return Response(serializer.data)
    else:  # PATCH
        data = request.data.copy()
        items_data = data.pop('items', None)
        
        # Prevent status change from vendor endpoint
        if 'status' in data:
            data.pop('status')
        
        serializer = PurchaseSerializer(
            purchase,
            data=data,
            partial=True,
            context={'items_data': items_data, 'request': request, 'is_vendor_purchase': True}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])  # Only authenticated admins can finalize
def purchase_finalize(request, pk):
    """Finalize a purchase - updates inventory and changes status to finalized"""
    purchase = get_object_or_404(Purchase.objects.prefetch_related('items', 'items__product'), pk=pk)
    
    if purchase.status != 'draft':
        return Response(
            {'error': f'Cannot finalize purchase with status {purchase.status}. Only draft purchases can be finalized.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Get adjusted items from request (admin can adjust quantities/prices)
    items_data = request.data.get('items', None)
    
    # Prepare update data
    update_data = {'status': 'finalized'}
    
    # If items are provided, validate and include them
    if items_data:
        # Validate quantities are positive
        for item_data in items_data:
            quantity = Decimal(str(item_data.get('quantity', 0)))
            if quantity <= 0:
                return Response(
                    {'error': f'Quantity must be greater than 0 for all items'},
                    status=status.HTTP_400_BAD_REQUEST
                )
    
    # Update purchase through serializer (will handle stock updates when status changes to finalized)
    serializer = PurchaseSerializer(
        purchase,
        data=update_data,
        partial=True,
        context={'items_data': items_data, 'request': request, 'is_vendor_purchase': False}
    )
    if serializer.is_valid():
        purchase = serializer.save()
    else:
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    # Create audit log for finalization
    create_audit_log(
        request=request,
        action='finalize',
        model_name='Purchase',
        object_id=str(purchase.id),
        object_name=f"Purchase {purchase.purchase_number}",
        object_reference=purchase.purchase_number,
        barcode=None,
        changes={
            'purchase_number': purchase.purchase_number,
            'status': 'finalized',
            'finalized_by': request.user.username if request.user else None,
            }
        )
    
    return Response(PurchaseSerializer(purchase).data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])  # Vendors can cancel their own drafts
def vendor_purchase_cancel(request, pk):
    """Cancel a draft purchase (vendor endpoint) - deletes non-sold barcodes, keeps product"""
    from backend.catalog.models import Barcode
    from django.db import transaction
    
    supplier_id = request.query_params.get('supplier', None)
    
    if not supplier_id:
        return Response({'error': 'supplier parameter is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    purchase = get_object_or_404(Purchase.objects.prefetch_related('items', 'items__product'), pk=pk, supplier_id=supplier_id)
    
    if purchase.status != 'draft':
        return Response(
            {'error': 'Can only cancel draft purchases'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Get barcode IDs before deletion for blob cleanup (outside transaction)
    barcodes_to_delete = Barcode.objects.filter(
        purchase=purchase
    ).exclude(
        tag='sold'  # Exclude sold barcodes - they should be kept
    )
    barcode_ids = list(barcodes_to_delete.values_list('id', flat=True))
    
    with transaction.atomic():
        # Delete all barcodes for this purchase that are NOT sold
        # Keep 'sold' barcodes (they should not be deleted)
        # Use exclude to keep sold barcodes and delete everything else
        deleted_count = barcodes_to_delete.delete()[0]
        
        # Update purchase status to cancelled
        purchase.status = 'cancelled'
        purchase.save()
        
        # Create audit log
        create_audit_log(
            request=request,
            action='cancel',
            model_name='Purchase',
            object_id=str(purchase.id),
            object_name=f"Purchase {purchase.purchase_number}",
            object_reference=purchase.purchase_number,
            barcode=None,
            changes={
                'purchase_number': purchase.purchase_number,
                'status': 'cancelled',
                'barcodes_deleted': deleted_count,
                'note': 'Non-sold barcodes deleted, product kept'
            }
        )
    
    # Fire-and-forget: Delete blobs from Azure Storage (non-blocking, errors suppressed)
    if barcode_ids:
        # Call deletion directly - all errors are caught internally, won't block or raise
        try:
            from backend.catalog.azure_label_service import delete_blobs_for_barcodes
            # Call directly - function handles all errors internally
            delete_blobs_for_barcodes(barcode_ids)
        except Exception:
            # Silently ignore - blob cleanup is best effort, don't log or raise
            pass
    
    return Response(PurchaseSerializer(purchase).data, status=status.HTTP_200_OK)
