from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from .models import PriceList, PriceListItem, BulkPriceUpdateLog, Promotion
from .serializers import PriceListSerializer, PriceListItemSerializer, BulkPriceUpdateLogSerializer, PromotionSerializer


# PriceList views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def price_list_list_create(request):
    """List all price lists or create a new price list"""
    if request.method == 'GET':
        price_lists = PriceList.objects.all()
        serializer = PriceListSerializer(price_lists, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = PriceListSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def price_list_detail(request, pk):
    """Retrieve, update or delete a price list"""
    price_list = get_object_or_404(PriceList, pk=pk)
    
    if request.method == 'GET':
        serializer = PriceListSerializer(price_list)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = PriceListSerializer(price_list, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = PriceListSerializer(price_list, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        price_list.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def price_list_items(request, pk):
    """Get or create items for a price list"""
    price_list = get_object_or_404(PriceList, pk=pk)
    
    if request.method == 'GET':
        items = price_list.items.all()
        serializer = PriceListItemSerializer(items, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = PriceListItemSerializer(data={**request.data, 'price_list': price_list.id})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


# BulkPriceUpdate views
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bulk_price_update_preview(request):
    """Preview bulk price update"""
    filters = request.data.get('filters', {})
    update_type = request.data.get('update_type')
    value = request.data.get('value')
    # Implementation would filter products and show preview
    return Response({'message': 'Preview functionality to be implemented'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bulk_price_update_commit(request):
    """Commit bulk price update"""
    filters = request.data.get('filters', {})
    update_type = request.data.get('update_type')
    value = request.data.get('value')
    # Implementation would update prices and log
    log = BulkPriceUpdateLog.objects.create(
        update_type=update_type,
        value=value,
        filters=filters,
        affected_count=0,
        created_by=request.user
    )
    return Response(BulkPriceUpdateLogSerializer(log).data)


# Promotion views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def promotion_list_create(request):
    """List all promotions or create a new promotion"""
    if request.method == 'GET':
        promotions = Promotion.objects.all()
        serializer = PromotionSerializer(promotions, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = PromotionSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def promotion_detail(request, pk):
    """Retrieve, update or delete a promotion"""
    promotion = get_object_or_404(Promotion, pk=pk)
    
    if request.method == 'GET':
        serializer = PromotionSerializer(promotion)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = PromotionSerializer(promotion, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = PromotionSerializer(promotion, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        promotion.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def promotion_validate(request):
    """Validate promotions against cart"""
    cart_data = request.data.get('cart', {})
    # Implementation would check applicable promotions
    return Response({'applied_promotions': []})


# BulkPriceUpdateLog views (read-only)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def bulk_price_update_log_list(request):
    """List all bulk price update logs"""
    logs = BulkPriceUpdateLog.objects.all()
    serializer = BulkPriceUpdateLogSerializer(logs, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def bulk_price_update_log_detail(request, pk):
    """Retrieve a bulk price update log"""
    log = get_object_or_404(BulkPriceUpdateLog, pk=pk)
    serializer = BulkPriceUpdateLogSerializer(log)
    return Response(serializer.data)
