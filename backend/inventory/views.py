from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Sum, F
from django.utils import timezone
from django.shortcuts import get_object_or_404
from decimal import Decimal
import uuid
from .models import Stock, StockBatch, StockAdjustment, StockTransfer, StockTransferItem
from .serializers import (
    StockSerializer, StockBatchSerializer, StockAdjustmentSerializer,
    StockTransferSerializer, StockTransferItemSerializer
)
from backend.catalog.models import Barcode
from backend.core.utils import create_audit_log


# Stock views (read-only)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_list(request):
    """List all stock entries with optional filtering"""
    queryset = Stock.objects.all()
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
    stock = get_object_or_404(Stock, pk=pk)
    serializer = StockSerializer(stock)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_low(request):
    """Get low stock items"""
    stocks = Stock.objects.filter(
        product__low_stock_threshold__gt=0
    ).filter(
        quantity__lte=F('product__low_stock_threshold')
    )
    serializer = StockSerializer(stocks, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_out_of_stock(request):
    """Get out of stock items"""
    stocks = Stock.objects.filter(quantity=0)
    serializer = StockSerializer(stocks, many=True)
    return Response(serializer.data)


# StockBatch views (read-only)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_batch_list(request):
    """List all stock batches"""
    batches = StockBatch.objects.all()
    serializer = StockBatchSerializer(batches, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def stock_batch_detail(request, pk):
    """Retrieve a stock batch"""
    batch = get_object_or_404(StockBatch, pk=pk)
    serializer = StockBatchSerializer(batch)
    return Response(serializer.data)


# StockAdjustment views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def stock_adjustment_list_create(request):
    """List all stock adjustments or create a new adjustment"""
    if request.method == 'GET':
        adjustments = StockAdjustment.objects.all()
        serializer = StockAdjustmentSerializer(adjustments, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = StockAdjustmentSerializer(data=request.data)
        if serializer.is_valid():
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
                        while Barcode.objects.filter(barcode=barcode_value).exists():
                            unique_id = str(uuid.uuid4())[:8].upper()
                            barcode_value = f"{base_name}-{timestamp}-{unique_id}"
                        
                        # Generate unique short_code using category-based format
                        from backend.catalog.utils import generate_category_based_short_code
                        short_code = generate_category_based_short_code(adjustment.product)
                        
                        # Create barcode for this item
                        Barcode.objects.create(
                            product=adjustment.product,
                            variant=adjustment.variant,
                            barcode=barcode_value,
                            short_code=short_code,
                            is_primary=False,
                            tag='new'  # Explicitly set tag to 'new' for fresh inventory items
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
    adjustment = get_object_or_404(StockAdjustment, pk=pk)
    
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


# StockTransfer views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def stock_transfer_list_create(request):
    """List all stock transfers or create a new transfer"""
    if request.method == 'GET':
        transfers = StockTransfer.objects.all()
        serializer = StockTransferSerializer(transfers, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = StockTransferSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(created_by=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def stock_transfer_detail(request, pk):
    """Retrieve, update or delete a stock transfer"""
    transfer = get_object_or_404(StockTransfer, pk=pk)
    
    if request.method == 'GET':
        serializer = StockTransferSerializer(transfer)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = StockTransferSerializer(transfer, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = StockTransferSerializer(transfer, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        transfer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
