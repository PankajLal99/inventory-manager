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
from backend.core.tenant_api import require_active_retailer

logger = logging.getLogger('backend.locations')


def _has_access_permission(user, codename: str) -> bool:
    from backend.core.access import merge_store_role_permissions, permissions_from_django_groups

    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    groups = list(user.groups.values_list('name', flat=True))
    base = permissions_from_django_groups(groups, user)
    effective = merge_store_role_permissions(user, base)
    return codename in effective


def get_shop_types_for_user(user):
    """
    SaaS mode: do not derive store visibility from static group names.
    Store visibility is controlled by tenant + assigned_stores + role permissions.
    Returning None means "no shop_type restriction here".
    """
    return None


# Store views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def store_list_create(request):
    """List all stores or create a new store (create requires admin)"""
    try:
        retailer, tenant_err = require_active_retailer(request)
        if tenant_err:
            return tenant_err
        if request.method == 'GET':
            logger.info(f"User {request.user.username} requested store list")

            # Filter stores based on user groups
            shop_types = get_shop_types_for_user(request.user)

            # Create cache key based on user groups and explicit store assignments
            user_groups_key = 'all' if shop_types is None else '-'.join(sorted(shop_types))
            assigned_ids = list(
                request.user.assigned_stores.filter(retailer_id=retailer.id).values_list('id', flat=True)
            )
            assignment_key = (
                'all'
                if not assigned_ids
                else 'as-' + '-'.join(str(i) for i in sorted(assigned_ids))
            )
            from backend.core.model_cache import get_store_list_cache_key, STORE_LIST_CACHE_TTL

            # Try cache first
            cache_key = get_store_list_cache_key(
                user_groups_key, retailer_id=retailer.id, assignment_key=assignment_key
            )
            cached_data = cache.get(cache_key)
            if cached_data:
                logger.debug(f"Cache hit for store list (groups: {user_groups_key})")
                return Response(cached_data)

            # Cache miss - fetch from database (always scoped to tenant)
            base = Store.objects.filter(is_active=True, retailer_id=retailer.id)
            if shop_types is None:
                stores = base
                logger.debug(f"Admin user - returning all active stores for retailer {retailer.id}")
            else:
                stores = base.filter(shop_type__in=shop_types)
                logger.debug(f"Filtering stores by shop_types: {shop_types}")

            if assigned_ids:
                stores = stores.filter(id__in=assigned_ids)
                logger.debug(f"Filtering stores by user assignment: {assigned_ids}")
            
            serializer = StoreSerializer(stores, many=True)
            response_data = serializer.data
            
            # Cache the result
            cache.set(cache_key, response_data, STORE_LIST_CACHE_TTL)
            logger.debug(f"Cached store list (groups: {user_groups_key}), returning {len(response_data)} stores")
            
            return Response(response_data)
        else:
            if not _has_access_permission(request.user, 'feature.store_management'):
                logger.warning(f"User {request.user.username} attempted to create store without admin privileges")
                return Response({'error': 'Only administrators can create stores'}, status=status.HTTP_403_FORBIDDEN)
            
            logger.info(f"User {request.user.username} creating store with data: {request.data}")
            serializer = StoreSerializer(data=request.data)
            if serializer.is_valid():
                try:
                    store = serializer.save(retailer_id=retailer.id)
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
        retailer, tenant_err = require_active_retailer(request)
        if tenant_err:
            return tenant_err
        store = get_object_or_404(Store, pk=pk, retailer_id=retailer.id)
        
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
        
        if not _has_access_permission(request.user, 'feature.store_management'):
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
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    if request.method == 'GET':
        warehouses = Warehouse.objects.filter(retailer_id=retailer.id)
        serializer = WarehouseSerializer(warehouses, many=True)
        return Response(serializer.data)
    else:
        if not _has_access_permission(request.user, 'feature.store_management'):
            return Response({'error': 'Only administrators can create warehouses'}, status=status.HTTP_403_FORBIDDEN)
        serializer = WarehouseSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(retailer_id=retailer.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def warehouse_detail(request, pk):
    """Retrieve, update or delete a warehouse"""
    retailer, tenant_err = require_active_retailer(request)
    if tenant_err:
        return tenant_err
    warehouse = get_object_or_404(Warehouse, pk=pk, retailer_id=retailer.id)
    
    if request.method == 'GET':
        serializer = WarehouseSerializer(warehouse)
        return Response(serializer.data)
    elif request.method == 'PUT':
        if not _has_access_permission(request.user, 'feature.store_management'):
            return Response({'error': 'Only administrators can modify warehouses'}, status=status.HTTP_403_FORBIDDEN)
        serializer = WarehouseSerializer(warehouse, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        if not _has_access_permission(request.user, 'feature.store_management'):
            return Response({'error': 'Only administrators can modify warehouses'}, status=status.HTTP_403_FORBIDDEN)
        serializer = WarehouseSerializer(warehouse, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        if not _has_access_permission(request.user, 'feature.store_management'):
            return Response({'error': 'Only administrators can delete warehouses'}, status=status.HTTP_403_FORBIDDEN)
        warehouse.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
