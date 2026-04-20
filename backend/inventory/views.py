from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import transaction
from django.db.models import Q, Sum, F
from django.utils import timezone
from django.shortcuts import get_object_or_404
from decimal import Decimal
import uuid
from .models import Stock, StockBatch, StockAdjustment, StockTransfer
from .serializers import (
    StockSerializer, StockBatchSerializer, StockAdjustmentSerializer,
    StockTransferReadSerializer, StockTransferCreateSerializer, StockTransferUpdateSerializer,
)
from .transfer_ops import generate_next_transfer_number, apply_stock_transfer_completion
from backend.catalog.models import Barcode
from backend.core.utils import create_audit_log
from backend.core.tenant_api import require_active_retailer, filter_for_retailer
from backend.tenants.models import Retailer


def _stock_queryset_for_retailer(retailer):
    return Stock.objects.filter(
        Q(store__retailer_id=retailer.id) | Q(warehouse__retailer_id=retailer.id)
    )


# Stock views (read-only)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_list(request):
    """List all stock entries with optional filtering"""
    retailer, err = require_active_retailer(request)
    if err:
        return err
    queryset = _stock_queryset_for_retailer(retailer)
    product_id = request.query_params.get('product_id', None)
    store_id = request.query_params.get('store_id', None)
    warehouse_id = request.query_params.get('warehouse_id', None)

    if product_id:
        queryset = queryset.filter(product_id=product_id)
    if store_id:
        queryset = queryset.filter(store_id=store_id)
    if warehouse_id:
        queryset = queryset.filter(warehouse_id=warehouse_id)

    serializer = StockSerializer(queryset, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_detail(request, pk):
    """Retrieve a stock entry"""
    retailer, err = require_active_retailer(request)
    if err:
        return err
    stock = get_object_or_404(_stock_queryset_for_retailer(retailer), pk=pk)
    serializer = StockSerializer(stock)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_low(request):
    """Get low stock items"""
    retailer, err = require_active_retailer(request)
    if err:
        return err
    stocks = (
        _stock_queryset_for_retailer(retailer)
        .filter(product__low_stock_threshold__gt=0)
        .filter(quantity__lte=F('product__low_stock_threshold'))
    )
    serializer = StockSerializer(stocks, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_out_of_stock(request):
    """Get out of stock items"""
    retailer, err = require_active_retailer(request)
    if err:
        return err
    stocks = _stock_queryset_for_retailer(retailer).filter(quantity=0)
    serializer = StockSerializer(stocks, many=True)
    return Response(serializer.data)


# StockBatch views (read-only)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_batch_list(request):
    """List all stock batches"""
    retailer, err = require_active_retailer(request)
    batches = StockBatch.objects.all()
    if not err and retailer:
        batches = batches.filter(product__retailer_id=retailer.id)
    serializer = StockBatchSerializer(batches, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_batch_detail(request, pk):
    """Retrieve a stock batch"""
    retailer, err = require_active_retailer(request)
    batch_filters = {'pk': pk}
    if not err and retailer:
        batch_filters['product__retailer_id'] = retailer.id
    batch = get_object_or_404(StockBatch, **batch_filters)
    serializer = StockBatchSerializer(batch)
    return Response(serializer.data)


# StockAdjustment views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def stock_adjustment_list_create(request):
    """List all stock adjustments or create a new adjustment"""
    retailer, err = require_active_retailer(request)
    if request.method == 'GET':
        adjustments = StockAdjustment.objects.all()
        if not err and retailer:
            adjustments = adjustments.filter(product__retailer_id=retailer.id)
        serializer = StockAdjustmentSerializer(adjustments, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = StockAdjustmentSerializer(data=request.data)
        if serializer.is_valid():
            product = serializer.validated_data.get('product')
            if not err and retailer and product and getattr(product, 'retailer_id', None) != retailer.id:
                return Response({'error': 'Product does not belong to your retailer.'}, status=status.HTTP_400_BAD_REQUEST)
            store = serializer.validated_data.get('store')
            warehouse = serializer.validated_data.get('warehouse')
            if not err and retailer and store and getattr(store, 'retailer_id', None) != retailer.id:
                return Response({'error': 'Store does not belong to your retailer.'}, status=status.HTTP_400_BAD_REQUEST)
            if not err and retailer and warehouse and getattr(warehouse, 'retailer_id', None) != retailer.id:
                return Response({'error': 'Warehouse does not belong to your retailer.'}, status=status.HTTP_400_BAD_REQUEST)
            adjustment = serializer.save(created_by=request.user)
            
            # Update or create Stock entry based on the adjustment
            stock, created = Stock.objects.get_or_create(
                product=adjustment.product,
                variant=adjustment.variant,
                store=adjustment.store,
                warehouse=adjustment.warehouse,
                defaults={'quantity': 0}
            )
            
            # Update stock quantity based on adjustment type
            if adjustment.adjustment_type == 'in':
                stock.quantity += adjustment.quantity
                # Generate barcodes for added quantity
                quantity_to_add = int(adjustment.quantity)
                if quantity_to_add > 0:
                    product_name = adjustment.product.name
                    base_name = product_name[:4].upper().replace(' ', '') if product_name else 'PRD'
                    timestamp = timezone.now().strftime('%Y%m%d')
                    
                    for i in range(quantity_to_add):
                        # Generate unique barcode for each item
                        unique_id = str(uuid.uuid4())[:8].upper()
                        barcode_value = f"{base_name}-{timestamp}-{unique_id}"
                        
                        # Ensure barcode uniqueness
                        # Use all_objects to include soft-deleted rows because DB unique
                        # constraints still apply to them.
                        while Barcode.all_objects.filter(barcode=barcode_value).exists():
                            unique_id = str(uuid.uuid4())[:8].upper()
                            barcode_value = f"{base_name}-{timestamp}-{unique_id}"
                        
                        # Generate unique short_code using category-based format
                        from backend.catalog.utils import generate_category_based_short_code
                        short_code = generate_category_based_short_code(adjustment.product)
                        
                        # Create barcode for this item
                        Barcode.objects.create(
                            retailer_id=(retailer.id if (not err and retailer) else None),
                            product=adjustment.product,
                            variant=adjustment.variant,
                            barcode=barcode_value,
                            short_code=short_code,
                            is_primary=False,
                            tag='new',  # Explicitly set tag to 'new' for fresh inventory items
                            current_store=adjustment.store,
                            current_warehouse=adjustment.warehouse,
                        )
            elif adjustment.adjustment_type == 'out':
                stock.quantity -= adjustment.quantity
                # Ensure quantity doesn't go below 0
                if stock.quantity < 0:
                    stock.quantity = 0
                # Remove barcodes when stock is removed (delete oldest barcodes first)
                quantity_to_remove = int(adjustment.quantity)
                if quantity_to_remove > 0:
                    # Get the IDs first, then delete (can't delete from sliced queryset)
                    barcode_ids = list(Barcode.objects.filter(
                        product=adjustment.product,
                        variant=adjustment.variant
                    ).order_by('created_at').values_list('id', flat=True)[:quantity_to_remove])
                    if barcode_ids:
                        Barcode.objects.filter(id__in=barcode_ids).delete()
            
            stock.save()
            
            # Create audit log for stock adjustment
            create_audit_log(
                request=request,
                action='stock_adjust',
                model_name='StockAdjustment',
                object_id=str(adjustment.id),
                object_name=adjustment.product.name if adjustment.product else 'Unknown Product',
                object_reference=adjustment.product.sku if adjustment.product else None,
                barcode=None,
                changes={
                    'product': adjustment.product.name if adjustment.product else None,
                    'adjustment_type': adjustment.adjustment_type,
                    'quantity': str(adjustment.quantity),
                    'reason': adjustment.reason,
                    'notes': adjustment.notes,
                    'new_stock_quantity': str(stock.quantity),
                }
            )
            
            return Response(StockAdjustmentSerializer(adjustment).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def stock_adjustment_detail(request, pk):
    """Retrieve, update or delete a stock adjustment"""
    retailer, err = require_active_retailer(request)
    adjustment_filters = {'pk': pk}
    if not err and retailer:
        adjustment_filters['product__retailer_id'] = retailer.id
    adjustment = get_object_or_404(StockAdjustment, **adjustment_filters)
    
    if request.method == 'GET':
        serializer = StockAdjustmentSerializer(adjustment)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = StockAdjustmentSerializer(adjustment, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = StockAdjustmentSerializer(adjustment, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        adjustment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _transfer_base_qs(retailer):
    return filter_for_retailer(
        StockTransfer.objects.select_related(
            'from_store', 'from_warehouse', 'to_store', 'to_warehouse'
        ).prefetch_related('items__product', 'items__variant'),
        retailer,
    )


# StockTransfer views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def stock_transfer_list_create(request):
    """List stock transfers for the active retailer or create a transfer with line items."""
    retailer, err = require_active_retailer(request)
    if err:
        return err

    if request.method == 'GET':
        transfers = _transfer_base_qs(retailer).order_by('-id')
        return Response(StockTransferReadSerializer(transfers, many=True).data)

    with transaction.atomic():
        Retailer.objects.select_for_update().get(pk=retailer.pk)
        transfer_number = generate_next_transfer_number(retailer)
        serializer = StockTransferCreateSerializer(data=request.data, context={'retailer': retailer})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        transfer = serializer.save(
            retailer=retailer,
            transfer_number=transfer_number,
            created_by=request.user,
            status='pending',
        )

    transfer = _transfer_base_qs(retailer).get(pk=transfer.pk)
    return Response(StockTransferReadSerializer(transfer).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def stock_transfer_detail(request, pk):
    """Retrieve, update notes/status, or delete a pending transfer."""
    retailer, err = require_active_retailer(request)
    if err:
        return err

    transfer = get_object_or_404(_transfer_base_qs(retailer), pk=pk)

    if request.method == 'GET':
        return Response(StockTransferReadSerializer(transfer).data)
    if request.method == 'PUT':
        serializer = StockTransferUpdateSerializer(transfer, data=request.data)
        if serializer.is_valid():
            serializer.save()
            transfer.refresh_from_db()
            transfer = _transfer_base_qs(retailer).get(pk=transfer.pk)
            return Response(StockTransferReadSerializer(transfer).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'PATCH':
        serializer = StockTransferUpdateSerializer(transfer, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            transfer.refresh_from_db()
            transfer = _transfer_base_qs(retailer).get(pk=transfer.pk)
            return Response(StockTransferReadSerializer(transfer).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    if transfer.status != 'pending':
        return Response(
            {'error': 'Only pending transfers can be deleted.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    transfer.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stock_transfer_complete(request, pk):
    """Apply stock movements and mark the transfer completed."""
    retailer, err = require_active_retailer(request)
    if err:
        return err

    try:
        with transaction.atomic():
            transfer = get_object_or_404(
                StockTransfer.objects.select_for_update(),
                pk=pk,
                retailer_id=retailer.id,
            )
            if transfer.status == 'completed':
                return Response(
                    {'error': 'Transfer is already completed.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if transfer.status == 'cancelled':
                return Response(
                    {'error': 'Cannot complete a cancelled transfer.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            apply_stock_transfer_completion(transfer)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    transfer = _transfer_base_qs(retailer).get(pk=pk)
    return Response(StockTransferReadSerializer(transfer).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def stock_transfer_cancel(request, pk):
    """Cancel a pending or in-transit transfer (no stock movement)."""
    retailer, err = require_active_retailer(request)
    if err:
        return err

    with transaction.atomic():
        transfer = get_object_or_404(
            StockTransfer.objects.select_for_update(),
            pk=pk,
            retailer_id=retailer.id,
        )
        if transfer.status == 'completed':
            return Response(
                {'error': 'Cannot cancel a completed transfer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if transfer.status == 'cancelled':
            return Response(StockTransferReadSerializer(transfer).data)
        transfer.status = 'cancelled'
        transfer.save(update_fields=['status', 'updated_at'])

    transfer = _transfer_base_qs(retailer).get(pk=pk)
    return Response(StockTransferReadSerializer(transfer).data)
