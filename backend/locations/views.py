import logging
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.shortcuts import get_object_or_404
from django.db import IntegrityError
from django.core.cache import cache
from .models import Store, Warehouse
from .serializers import StoreSerializer, WarehouseSerializer

logger = logging.getLogger('backend.locations')


def get_shop_types_for_user(user):
    """
    Map user groups to shop_types they can access.
    Returns a list of shop_type values or None (for Admin - all stores).
    
    Mapping:
    - Retail/RetailAdmin → 'retail'
    - Wholesale/WholesaleAdmin → 'wholesale'
    - Repair → 'repair'
    - Admin → None (all stores)
    """
    user_groups = user.groups.values_list('name', flat=True)
    user_group_names = list(user_groups)
    
    # Admin group sees all stores
    if 'Admin' in user_group_names:
        return None
    
    # Map groups to shop_types
    shop_types = []
    
    if 'Retail' in user_group_names or 'RetailAdmin' in user_group_names:
        shop_types.append('retail')
        # Retail group users also have access to Repair stores
        shop_types.append('repair')
    
    if 'Wholesale' in user_group_names or 'WholesaleAdmin' in user_group_names:
        shop_types.append('wholesale')
    
    # Check for Repair group (if it exists)
    # Note: You may need to create a RepairAdmin group if needed
    if 'Repair' in user_group_names:
        shop_types.append('repair')
    
    # If user is superuser/staff but not in any application group, return all
    if not shop_types and (user.is_superuser or user.is_staff):
        return None
    
    return shop_types if shop_types else None


# Store views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def store_list_create(request):
    """List all stores or create a new store (create requires admin)"""
    try:
        if request.method == 'GET':
            logger.info(f"User {request.user.username} requested store list")
            
            # Filter stores based on user groups
            shop_types = get_shop_types_for_user(request.user)
            
            # Create cache key based on user groups
            user_groups_key = 'all' if shop_types is None else '-'.join(sorted(shop_types))
            from backend.core.model_cache import get_store_list_cache_key, STORE_LIST_CACHE_TTL
            
            # Try cache first
            cache_key = get_store_list_cache_key(user_groups_key)
            cached_data = cache.get(cache_key)
            if cached_data:
                logger.debug(f"Cache hit for store list (groups: {user_groups_key})")
                return Response(cached_data)
            
            # Cache miss - fetch from database
            if shop_types is None:
                # Admin or superuser/staff without groups - return all active stores
                stores = Store.objects.filter(is_active=True)
                logger.debug(f"Admin user - returning all active stores")
            else:
                # Filter by shop_type and is_active
                stores = Store.objects.filter(shop_type__in=shop_types, is_active=True)
                logger.debug(f"Filtering stores by shop_types: {shop_types}")
            
            serializer = StoreSerializer(stores, many=True)
            response_data = serializer.data
            
            # Cache the result
            cache.set(cache_key, response_data, STORE_LIST_CACHE_TTL)
            logger.debug(f"Cached store list (groups: {user_groups_key}), returning {len(response_data)} stores")
            
            return Response(response_data)
        else:
            # Only admins can create stores
            is_admin = (request.user.is_superuser or request.user.is_staff or 
                       request.user.groups.filter(name__in=['Admin', 'RetailAdmin', 'WholesaleAdmin']).exists())
            
            if not is_admin:
                logger.warning(f"User {request.user.username} attempted to create store without admin privileges")
                return Response({'error': 'Only administrators can create stores'}, status=status.HTTP_403_FORBIDDEN)
            
            logger.info(f"User {request.user.username} creating store with data: {request.data}")
            serializer = StoreSerializer(data=request.data)
            if serializer.is_valid():
                try:
                    store = serializer.save()
                    logger.info(f"Store '{store.name}' created successfully by {request.user.username}")
                    return Response(serializer.data, status=status.HTTP_201_CREATED)
                except IntegrityError as e:
                    error_msg = str(e)
                    logger.error(f"IntegrityError creating store: {error_msg}", exc_info=True)
                    if 'unique constraint' in error_msg.lower() or 'UNIQUE constraint' in error_msg:
                        return Response({'error': 'A store with this code already exists'}, status=status.HTTP_400_BAD_REQUEST)
                    return Response({'error': 'Database error occurred while creating store'}, status=status.HTTP_400_BAD_REQUEST)
                except Exception as e:
                    logger.error(f"Unexpected error creating store: {str(e)}", exc_info=True)
                    return Response({'error': f'Error creating store: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            logger.warning(f"Store creation validation failed: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        logger.error(f"Unexpected error in store_list_create: {str(e)}", exc_info=True)
        return Response({'error': 'An unexpected error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def store_detail(request, pk):
    """Retrieve, update or delete a store (update/delete requires admin)"""
    try:
        store = get_object_or_404(Store, pk=pk)
        
        if request.method == 'GET':
            logger.debug(f"User {request.user.username} retrieved store {pk}")
            
            # Try cache first
            from backend.core.model_cache import get_cached_store, cache_store_data
            cached_data = get_cached_store(pk)
            if cached_data:
                return Response(cached_data)
            
            # Cache miss - fetch from database
            serializer = StoreSerializer(store)
            response_data = serializer.data
            
            # Cache the result
            cache_store_data(store)
            
            return Response(response_data)
        
        # Only admins can update or delete stores
        is_admin = (request.user.is_superuser or request.user.is_staff or 
                   request.user.groups.filter(name__in=['Admin', 'RetailAdmin', 'WholesaleAdmin']).exists())
        
        if not is_admin:
            logger.warning(f"User {request.user.username} attempted to modify store {pk} without admin privileges")
            return Response({'error': 'Only administrators can modify stores'}, status=status.HTTP_403_FORBIDDEN)
        
        if request.method == 'PUT':
            logger.info(f"User {request.user.username} updating store {pk} with data: {request.data}")
            serializer = StoreSerializer(store, data=request.data)
            if serializer.is_valid():
                serializer.save()
                logger.info(f"Store {pk} updated successfully")
                return Response(serializer.data)
            logger.warning(f"Store update validation failed: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        elif request.method == 'PATCH':
            logger.info(f"User {request.user.username} patching store {pk} with data: {request.data}")
            serializer = StoreSerializer(store, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                logger.info(f"Store {pk} patched successfully")
                return Response(serializer.data)
            logger.warning(f"Store patch validation failed: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        else:  # DELETE
            logger.info(f"User {request.user.username} deleting store {pk} ({store.name})")
            store.delete()
            logger.info(f"Store {pk} deleted successfully")
            return Response(status=status.HTTP_204_NO_CONTENT)
    except Store.DoesNotExist:
        logger.warning(f"Store {pk} not found")
        return Response({'error': 'Store not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f"Unexpected error in store_detail for pk {pk}: {str(e)}", exc_info=True)
        return Response({'error': 'An unexpected error occurred'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Warehouse views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def warehouse_list_create(request):
    """List all warehouses or create a new warehouse"""
    if request.method == 'GET':
        warehouses = Warehouse.objects.all()
        serializer = WarehouseSerializer(warehouses, many=True)
        return Response(serializer.data)
    else:
        serializer = WarehouseSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def warehouse_detail(request, pk):
    """Retrieve, update or delete a warehouse"""
    warehouse = get_object_or_404(Warehouse, pk=pk)
    
    if request.method == 'GET':
        serializer = WarehouseSerializer(warehouse)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = WarehouseSerializer(warehouse, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = WarehouseSerializer(warehouse, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        warehouse.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
