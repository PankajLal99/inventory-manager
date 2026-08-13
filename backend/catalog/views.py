from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from backend.core.permissions import IsAuthenticatedOrVendorPurchaseLabels
from django.db.models import Q, Count, Sum, OuterRef, Subquery, Value, DecimalField, Prefetch
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from decimal import Decimal, InvalidOperation
import uuid
import base64
import re
from urllib.parse import unquote
from .models import Category, Brand, TaxRate, Product, ProductVariant, Barcode, ProductComponent, BarcodeLabel, DefectiveProductMoveOut, DefectiveProductItem
from .filters import normalize_barcode_for_search, find_barcode_by_search_value
from .barcode_resolution import clean_scanned_barcode
from .serializers import (
    CategorySerializer, BrandSerializer, TaxRateSerializer, ProductSerializer,
    ProductListSerializer, ProductVariantSerializer, BarcodeSerializer, ProductComponentSerializer,
    DefectiveProductMoveOutSerializer, DefectiveProductItemSerializer
)
from .filters import ProductFilter
from backend.inventory.models import Stock
from backend.locations.models import Store, Warehouse
from backend.pos.models import InvoiceItem, Invoice
from backend.core.utils import create_audit_log
from .validators import run_comprehensive_data_check
from .utils import generate_unique_sku


def is_likely_sku(search_term):
    """Detect if search term is likely a SKU/barcode vs product name
    
    SKUs typically have:
    - Contains dashes or underscores
    - Alphanumeric pattern
    - Specific length patterns
    - Not just plain text words
    """
    if not search_term or len(search_term.strip()) < 3:
        return False
    
    search_clean = search_term.strip()
    
    # If contains dashes, underscores, or is mostly alphanumeric with numbers, likely SKU
    if '-' in search_clean or '_' in search_clean:
        return True
    
    # If it's mostly alphanumeric with numbers and has specific pattern, likely SKU
    # Pattern: mix of letters and numbers, or all uppercase alphanumeric
    if search_clean.isalnum() and any(c.isdigit() for c in search_clean) and len(search_clean) >= 5:
        return True
    
    # If it matches common SKU patterns (e.g., PRD-20240101-ABC12345)
    sku_pattern = re.compile(r'^[A-Z0-9]+[-_][A-Z0-9]+[-_][A-Z0-9]+', re.IGNORECASE)
    if sku_pattern.match(search_clean):
        return True
    
    return False


def generate_single_label(zpl_code: str):
    """Helper method to generate a single label from ZPL code - now uses local generator"""
    from .label_generator import generate_single_label as local_generate_label
    return local_generate_label(zpl_code)


def get_barcode_status_message(barcode_obj, sold_invoice=None):
    """Get human-readable status message based on barcode tag
    
    Args:
        barcode_obj: Barcode object (can be None)
        sold_invoice: Invoice number if barcode is sold (optional)
    
    Returns:
        tuple: (status_message, status)
    """
    if not barcode_obj:
        return 'Barcode not found', 'unknown'
    
    try:
        tag = barcode_obj.tag if barcode_obj else None
        
        if tag == 'new':
            return 'Available for sale', 'available'
        elif tag == 'sold':
            tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') and barcode_obj else 'Sold'
            if sold_invoice:
                return f'This item cannot be added as it is already {tag_display.lower()} (assigned to invoice {sold_invoice}).', 'sold'
            else:
                return f'This item cannot be added as it is already {tag_display.lower()}.', 'sold'
        elif tag == 'returned':
            tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') and barcode_obj else 'Returned'
            return f'This item cannot be added as it is already {tag_display.lower()}.', 'returned'
        elif tag == 'unknown':
            tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') and barcode_obj else 'Unknown'
            return f'This item cannot be added as it is already {tag_display.lower()}.', 'unknown'
        elif tag == 'defective':
            tag_display = barcode_obj.get_tag_display() if hasattr(barcode_obj, 'get_tag_display') and barcode_obj else 'Defective'
            return f'This item cannot be added as it is already {tag_display.lower()}.', 'defective'
        elif tag == 'in-cart':
            return 'In cart', 'in_cart'
        else:
            return 'This item cannot be added due to unknown status.', 'unknown'
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error getting barcode status message: {str(e)}", exc_info=True)
        return 'Error determining barcode status', 'unknown'


# Category views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def category_list_create(request):
    """List all categories or create a new category"""
    if request.method == 'GET':
        categories = Category.objects.all()
        serializer = CategorySerializer(categories, many=True)
        return Response(serializer.data)
    else:
        serializer = CategorySerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def category_detail(request, pk):
    """Retrieve, update or delete a category"""
    category = get_object_or_404(Category, pk=pk)
    
    if request.method == 'GET':
        serializer = CategorySerializer(category)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = CategorySerializer(category, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = CategorySerializer(category, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        category.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Brand views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def brand_list_create(request):
    """List all brands or create a new brand"""
    if request.method == 'GET':
        brands = Brand.objects.all()
        serializer = BrandSerializer(brands, many=True)
        return Response(serializer.data)
    else:
        serializer = BrandSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def brand_detail(request, pk):
    """Retrieve, update or delete a brand"""
    brand = get_object_or_404(Brand, pk=pk)
    
    if request.method == 'GET':
        serializer = BrandSerializer(brand)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = BrandSerializer(brand, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = BrandSerializer(brand, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        brand.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# TaxRate views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def tax_rate_list_create(request):
    """List all tax rates or create a new tax rate"""
    if request.method == 'GET':
        tax_rates = TaxRate.objects.all()
        serializer = TaxRateSerializer(tax_rates, many=True)
        return Response(serializer.data)
    else:
        serializer = TaxRateSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def tax_rate_detail(request, pk):
    """Retrieve, update or delete a tax rate"""
    tax_rate = get_object_or_404(TaxRate, pk=pk)
    
    if request.method == 'GET':
        serializer = TaxRateSerializer(tax_rate)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = TaxRateSerializer(tax_rate, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = TaxRateSerializer(tax_rate, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        tax_rate.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Product views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def product_list_create(request):
    """List all products or create a new product"""
    if request.method == 'GET':
        # Optimize queryset with select_related and prefetch_related to avoid N+1 queries
        # Annotate with barcode count for performance (to avoid N+1 in serializer)
        queryset = Product.objects.select_related('brand', 'category').prefetch_related('barcodes').annotate(
            annotated_barcode_count=Count('barcodes', filter=~Q(barcodes__tag='sold'))
        ).all()
        
        # Use django-filter for filtering
        filterset = ProductFilter(request.query_params, queryset=queryset)
        queryset = filterset.qs
        
        # Exclude Other/Custom products (name starts with "Other -") when requested (e.g. Purchases, Products pages)
        if request.query_params.get('exclude_other_custom') in ('true', '1', 'yes'):
            queryset = queryset.exclude(name__startswith='Other -')
        
        # Filter: only products with warehouse stock > 0 (sum of PurchaseItem.warehouse_quantity for finalized purchases)
        if request.query_params.get('warehouse_qty_gt_zero') in ('true', '1', 'yes'):
            from backend.purchasing.models import PurchaseItem
            wh_subq = PurchaseItem.objects.filter(
                product_id=OuterRef('pk'),
                purchase__status='finalized',
                purchase__deleted_at__isnull=True,
            ).values('product_id').annotate(s=Sum('warehouse_quantity')).values('s')
            # Coalesce NULL (no purchase items) to 0 so we only keep products where sum > 0
            queryset = queryset.annotate(
                _wh_total=Coalesce(Subquery(wh_subq[:1]), Value(Decimal('0')), output_field=DecimalField())
            ).filter(_wh_total__gt=0)
        
        # Additional POS-specific filtering: Filter to only show products with available barcodes when search is present
        # This ensures POS only shows products that can actually be added to cart
        search = request.query_params.get('search', None)
        tag = request.query_params.get('tag', None)
        
        if search:
            # Additional POS-specific filtering: Filter to only show products with available barcodes
            # This ensures POS only shows products that can actually be added to cart
            # Get available barcodes (new or returned tag, not in carts, not sold)
            from backend.pos.models import CartItem
            
            available_barcodes = Barcode.objects.filter(tag__in=['new', 'returned'])
            
            # Exclude barcodes that are in active carts - optimized to avoid looping
            cart_items = CartItem.objects.filter(
                cart__status='active'
            ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
            
            # Flatten all scanned_barcodes from all cart items efficiently
            active_carts_barcodes = set()
            for cart_item in cart_items.only('scanned_barcodes'):
                if cart_item.scanned_barcodes:
                    active_carts_barcodes.update(cart_item.scanned_barcodes)
            
            if active_carts_barcodes:
                available_barcodes = available_barcodes.exclude(
                    barcode__in=active_carts_barcodes
                )
            
            # Exclude sold barcodes
            sold_barcode_ids = InvoiceItem.objects.filter(
                barcode__in=available_barcodes.values_list('id', flat=True)
            ).exclude(
                invoice__status='void'
            ).values_list('barcode_id', flat=True)
            
            available_barcode_product_ids = available_barcodes.exclude(
                id__in=sold_barcode_ids
            ).values_list('product_id', flat=True).distinct()
            
            # For non-tracked products, also check if product barcode has 'new' or 'returned' tag
            non_tracked_with_available_tag = Product.objects.filter(
                track_inventory=False,
                barcodes__tag__in=['new', 'returned']
            ).values_list('id', flat=True).distinct()
            
            # Combine: tracked products with available barcodes OR non-tracked products with 'new' or 'returned' tag barcode
            all_available_product_ids = set(available_barcode_product_ids) | set(non_tracked_with_available_tag)
            
            # If tag='new' is specified, also include products WITHOUT any barcodes (unpurchased products)
            if tag == 'new':
                # Get all products that have barcodes
                products_with_barcodes = Barcode.objects.values_list('product_id', flat=True).distinct()
                # Get products without barcodes (unpurchased)
                products_without_barcodes = Product.objects.exclude(
                    id__in=products_with_barcodes
                ).values_list('id', flat=True)
                # Add unpurchased products to the available list
                all_available_product_ids = all_available_product_ids | set(products_without_barcodes)
            
            # Filter queryset to only include products with available 'new' or 'returned' tag barcodes
            # (or products without barcodes if tag='new')
            queryset = queryset.filter(id__in=all_available_product_ids)
        
        # Additional stock filtering if needed (django-filter handles basic stock filters, but we may need this for complex cases)
        in_stock = request.query_params.get('in_stock', None)
        low_stock = request.query_params.get('low_stock', None)
        out_of_stock = request.query_params.get('out_of_stock', None)
        
        if in_stock == 'true' or low_stock == 'true' or out_of_stock == 'true':
            # Get all product IDs from queryset
            all_product_ids = list(queryset.values_list('id', flat=True))
            
            if not all_product_ids:
                queryset = queryset.none()  # No products, return empty queryset
            else:
                # Get all available barcodes for these products in bulk
                available_barcodes = Barcode.objects.filter(
                    product_id__in=all_product_ids,
                    tag__in=['new', 'returned']
                )
                
                # Get sold barcode IDs in bulk (barcodes assigned to non-void invoices)
                sold_barcode_ids = set(InvoiceItem.objects.filter(
                    barcode__in=available_barcodes.values_list('id', flat=True)
                ).exclude(
                    invoice__status='void'
                ).values_list('barcode_id', flat=True))
                
                # Exclude sold barcodes
                available_barcodes = available_barcodes.exclude(id__in=sold_barcode_ids)
                
                # Get active cart barcodes (reuse logic from above if not already computed)
                from backend.pos.models import CartItem
                cart_items = CartItem.objects.filter(
                    cart__status='active'
                ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
                
                active_carts_barcodes = set()
                for cart_item in cart_items.only('scanned_barcodes'):
                    if cart_item.scanned_barcodes:
                        active_carts_barcodes.update(cart_item.scanned_barcodes)
                
                if active_carts_barcodes:
                    available_barcodes = available_barcodes.exclude(barcode__in=active_carts_barcodes)
                
                # Get product IDs with their barcode counts in bulk
                # Use annotate to count barcodes per product
                product_barcode_counts = available_barcodes.values('product_id').annotate(
                    count=Count('id')
                )
                
                # Create a dict mapping product_id to barcode count
                barcode_count_map = {item['product_id']: item['count'] for item in product_barcode_counts}
                
                # Get products with low_stock_threshold in bulk
                products = Product.objects.filter(id__in=all_product_ids).only('id', 'low_stock_threshold')
                product_threshold_map = {p.id: (p.low_stock_threshold or 0) for p in products}
                
                # Filter products based on stock criteria
                product_ids_with_stock = []
                for product_id in all_product_ids:
                    available_count = barcode_count_map.get(product_id, 0)
                    low_stock_threshold = product_threshold_map.get(product_id, 0)
                    
                    # Apply filters
                    if in_stock == 'true' and available_count > 0:
                        product_ids_with_stock.append(product_id)
                    elif low_stock == 'true' and available_count > 0 and available_count <= low_stock_threshold:
                        product_ids_with_stock.append(product_id)
                    elif out_of_stock == 'true' and available_count == 0:
                        product_ids_with_stock.append(product_id)
                
                # Filter queryset to only include products that match stock criteria
                queryset = queryset.filter(id__in=product_ids_with_stock)
        
        # Note: Tag filtering is handled by django-filter ProductFilter

        # Order by latest product update (most recently created/updated first)
        queryset = queryset.order_by('-updated_at', '-created_at')
        # Products ordered by most recently updated, then by creation date (descending)
        
        # Pagination: limit 50 per page
        from django.core.paginator import Paginator
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 50))
        
        # Prepare context data for efficient serializer processing
        # Get all barcodes currently in active carts to avoid N+1 queries in serializer
        from backend.pos.models import CartItem
        active_cart_items = CartItem.objects.filter(cart__status='active')
        
        active_cart_barcodes = set()
        active_cart_product_quantities = {}
        
        for item in active_cart_items:
            # Collect barcodes for tracked items
            if item.scanned_barcodes:
                active_cart_barcodes.update(item.scanned_barcodes)
            
            # Collect quantities for non-tracked items
            if item.product_id:
                current_qty = active_cart_product_quantities.get(item.product_id, 0)
                try:
                    current_qty += float(item.quantity)
                except (ValueError, TypeError):
                    pass
                active_cart_product_quantities[item.product_id] = current_qty

        paginator = Paginator(queryset, limit)
        page_obj = paginator.get_page(page)

        moved_out_barcode_ids = set()
        if request.query_params.get('tag') == 'defective':
            page_product_ids = [p.id for p in page_obj.object_list if getattr(p, 'id', None)]
            if page_product_ids:
                moved_out_barcode_ids = set(
                    DefectiveProductItem.objects.filter(
                        barcode__product_id__in=page_product_ids
                    ).values_list('barcode_id', flat=True)
                )

        context = {
            'request': request,
            'active_cart_barcodes': active_cart_barcodes,
            'active_cart_product_quantities': active_cart_product_quantities,
            'moved_out_barcode_ids': moved_out_barcode_ids,
        }
        
        serializer = ProductListSerializer(page_obj, many=True, context=context)
        response = Response({
            'results': serializer.data,
            'count': paginator.count,
            'next': page_obj.next_page_number() if page_obj.has_next() else None,
            'previous': page_obj.previous_page_number() if page_obj.has_previous() else None,
            'page': page,
            'page_size': limit,
            'total_pages': paginator.num_pages,
        })
        # Add cache headers for browser-level caching
        # Use private cache since this is authenticated content
        # Max-age of 2 minutes for product lists (they change frequently)
        response['Cache-Control'] = 'private, max-age=120, stale-while-revalidate=300'
        return response
    else:  # POST
        serializer = ProductSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        validated_data = serializer.validated_data.copy()
        product_name = validated_data.get('name', 'Product')
        product_brand = validated_data.get('brand', None)
        
        # Find existing product by name AND brand, or create new
        # Products with same name but different brands should be separate products
        product_data = validated_data.copy()
        product_data.pop('sku', None)  # SKU is auto-generated
        product_data.pop('name', None)  # Name is passed separately
        
        # Check if product exists first (by name AND brand)
        try:
            # Build query: name must match, and brand must match (including None)
            query = Q(name=product_name)
            if product_brand:
                query &= Q(brand=product_brand)
            else:
                query &= Q(brand__isnull=True)
            
            product = Product.objects.get(query)
            product_created = False
        except Product.DoesNotExist:
            # Generate SKU before creating the product
            product_data['sku'] = generate_unique_sku(product_name)
            product = Product.objects.create(name=product_name, **product_data)
            product_created = True
        
        # Generate product-level SKU if it doesn't exist (for existing products)
        if not product.sku:
            product.sku = generate_unique_sku(product_name)
            product.save()
        
        # If product exists, update its properties (prices, etc.) but keep existing data
        if not product_created:
            # Update product fields if provided
            for key, value in product_data.items():
                if hasattr(product, key) and value is not None:
                    setattr(product, key, value)
            product.save()
        
        # Get track_inventory value from validated_data (defaults to True if not provided)
        track_inventory = validated_data.get('track_inventory', True)
        product.track_inventory = track_inventory
        product.save()
        
        # IMPORTANT: Products are created WITHOUT quantity or barcodes
        # Quantity and barcodes are ONLY created when products are PURCHASED
        # Stock is ONLY updated when purchases are made
        # This ensures proper inventory tracking from purchase to sale
        
        # Create audit log for product creation
        create_audit_log(
            request=request,
            action='create',
            model_name='Product',
            object_id=str(product.id),
            object_name=product.name,
            object_reference=product.sku,
            barcode=None,
            changes={'name': product.name, 'sku': product.sku, 'track_inventory': product.track_inventory}
        )
        
        # Invalidate product list cache AFTER transaction commits
        # This ensures the new product is in the database before cache is rebuilt
        from django.db import transaction
        from backend.core.cache_signals import invalidate_products_cache_manual
        
        def invalidate_cache():
            invalidate_products_cache_manual()
        
        transaction.on_commit(invalidate_cache)
        
        serializer = ProductSerializer(product)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def product_detail(request, pk):
    """Retrieve, update or delete a product"""
    if request.method == 'GET':
        # Prefetch for full ProductSerializer (barcodes, variants, components, stock)
        product_queryset = Product.objects.select_related('category', 'brand').prefetch_related(
            'stock_entries', 'stock_entries__store', 'stock_entries__warehouse',
            'barcodes', 'barcodes__purchase__supplier',
            'variants', 'components', 'components__component_product',
        )
        product = get_object_or_404(product_queryset, pk=pk)
    else:
        product = get_object_or_404(Product, pk=pk)
    
    if request.method == 'GET':
        # Always use full ProductSerializer - do NOT use get_cached_product here.
        # The product cache stores minimal data (no barcodes, variants, components, stock).
        # Product detail page needs full data; cache is for quick lookups (POS, barcode scan).
        serializer = ProductSerializer(product)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = ProductSerializer(product, data=request.data)
        if serializer.is_valid():
            # Track changes before save
            old_data = {
                'name': product.name,
                'sku': product.sku,
                'track_inventory': product.track_inventory,
            }
            serializer.save()
            # Track changes after save
            new_data = {
                'name': product.name,
                'sku': product.sku,
                'track_inventory': product.track_inventory,
            }
            changes = {k: {'old': old_data.get(k), 'new': new_data.get(k)} for k in old_data if old_data.get(k) != new_data.get(k)}
            create_audit_log(
                request=request,
                action='update',
                model_name='Product',
                object_id=str(product.id),
                object_name=product.name,
                object_reference=product.sku,
                barcode=None,
                changes=changes
            )
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = ProductSerializer(product, data=request.data, partial=True)
        if serializer.is_valid():
            # Track changes before save
            old_data = {
                'name': product.name,
                'sku': product.sku,
                'track_inventory': product.track_inventory,
            }
            serializer.save()
            # Track changes after save
            new_data = {
                'name': product.name,
                'sku': product.sku,
                'track_inventory': product.track_inventory,
            }
            changes = {k: {'old': old_data.get(k), 'new': new_data.get(k)} for k in old_data if old_data.get(k) != new_data.get(k)}
            if changes:
                create_audit_log(
                    request=request,
                    action='update',
                    model_name='Product',
                    object_id=str(product.id),
                    object_name=product.name,
                    object_reference=product.sku,
                    barcode=None,
                    changes=changes
                )
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        product_name = product.name
        product_sku = product.sku
        product_id = str(product.id)
        
        product.delete()
        create_audit_log(
            request=request,
            action='delete',
            model_name='Product',
            object_id=product_id,
            object_name=product_name,
            object_reference=product_sku,
            barcode=None,
            changes={
                'name': product_name,
                'sku': product_sku,
                'note': 'Product soft-deleted (row retained in DB, hidden from default API lists).',
            }
        )
        
        # Invalidate cache AFTER transaction commits
        from django.db import transaction
        from backend.core.cache_signals import invalidate_products_cache_manual
        
        def invalidate_cache():
            invalidate_products_cache_manual()
        
        transaction.on_commit(invalidate_cache)
        
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def product_variants(request, pk):
    """Get or create variants for a product"""
    product = get_object_or_404(Product, pk=pk)
    
    if request.method == 'GET':
        variants = product.variants.all()
        serializer = ProductVariantSerializer(variants, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = ProductVariantSerializer(data={**request.data, 'product': product.id})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def product_barcodes_full(request, pk):
    """Get all barcodes for a product, grouped by tag, with location. For product detail page only."""
    from backend.pos.models import InvoiceItem
    product = get_object_or_404(
        Product.objects.prefetch_related(
            'barcodes', 'barcodes__purchase', 'barcodes__purchase__store',
            'barcodes__purchase__warehouse', 'barcodes__purchase__supplier',
        ),
        pk=pk
    )
    sold_barcode_ids = list(product.barcodes.filter(tag='sold').values_list('id', flat=True))
    inv_items_by_barcode = {}
    if sold_barcode_ids:
        for ii in InvoiceItem.objects.filter(
            barcode_id__in=sold_barcode_ids
        ).exclude(invoice__status='void').select_related('invoice', 'invoice__customer'):
            inv_items_by_barcode[ii.barcode_id] = ii
    by_tag = {}
    tag_order = ['new', 'returned', 'in-cart', 'defective', 'unknown', 'sold']
    for tag in tag_order:
        by_tag[tag] = []
    for barcode in product.barcodes.all():
        tag = barcode.tag or 'unknown'
        if tag not in by_tag:
            by_tag[tag] = []
        location_parts = []
        if barcode.purchase:
            if barcode.purchase.store:
                location_parts.append(barcode.purchase.store.name)
            if barcode.purchase.warehouse:
                location_parts.append(barcode.purchase.warehouse.name)
        location = ', '.join(location_parts) if location_parts else '—'
        item = {
            'id': barcode.id,
            'barcode': barcode.barcode,
            'short_code': barcode.short_code,
            'tag': barcode.tag,
            'tag_display': barcode.get_tag_display(),
            'purchase_price': float(barcode.get_purchase_price()) if barcode.get_purchase_price() else None,
            'supplier_name': barcode.purchase.supplier.name if barcode.purchase and barcode.purchase.supplier else None,
            'purchase_date': barcode.purchase.purchase_date.strftime('%Y-%m-%d') if barcode.purchase else None,
            'location': location,
            'is_primary': barcode.is_primary,
        }
        if tag == 'sold':
            inv_item = inv_items_by_barcode.get(barcode.id)
            if inv_item:
                item['location'] = f"Invoice {inv_item.invoice.invoice_number}"
                if inv_item.invoice.customer:
                    item['location'] += f" ({inv_item.invoice.customer.name})"
                item['invoice_number'] = inv_item.invoice.invoice_number
                item['invoice_id'] = inv_item.invoice.id
                item['customer_name'] = inv_item.invoice.customer.name if inv_item.invoice.customer else 'Walk-in'
                item['sold_price'] = float(inv_item.line_total / inv_item.quantity) if inv_item.quantity else None
        by_tag[tag].append(item)
    return Response({'by_tag': by_tag, 'total': product.barcodes.count()})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def product_invoices(request, pk):
    """Get invoices that contain this product. For product detail page only.
    Query params: limit (default 20, max 100), offset (default 0).
    """
    from backend.pos.models import InvoiceItem, Invoice
    product = get_object_or_404(Product, pk=pk)
    try:
        limit = int(request.query_params.get('limit', 20))
    except (TypeError, ValueError):
        limit = 20
    try:
        offset = int(request.query_params.get('offset', 0))
    except (TypeError, ValueError):
        offset = 0
    limit = max(1, min(limit, 100))
    offset = max(0, offset)

    invoice_ids = InvoiceItem.objects.filter(product=product).values_list('invoice_id', flat=True).distinct()
    invoices_qs = Invoice.objects.filter(id__in=invoice_ids).exclude(
        status='void'
    ).select_related('store', 'customer').order_by('-created_at')
    total = invoices_qs.count()
    invoices = list(invoices_qs[offset : offset + limit])
    has_more = offset + len(invoices) < total
    data = []
    for inv in invoices:
        items_for_product = InvoiceItem.objects.filter(invoice=inv, product=product)
        qty = sum(float(i.quantity) for i in items_for_product)
        data.append({
            'id': inv.id,
            'invoice_number': inv.invoice_number,
            'status': inv.status,
            'invoice_type': inv.invoice_type,
            'total': float(inv.total),
            'customer_name': inv.customer.name if inv.customer else 'Walk-in',
            'store_name': inv.store.name if inv.store else None,
            'created_at': inv.created_at.isoformat() if inv.created_at else None,
            'product_quantity': qty,
        })
    return Response({
        'invoices': data,
        'total': total,
        'limit': limit,
        'offset': offset,
        'has_more': has_more,
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def product_barcodes(request, pk):
    """Get or create barcodes for a product"""
    product = get_object_or_404(Product, pk=pk)
    
    if request.method == 'GET':
        # Get tag filter from query params
        tag_filter = request.query_params.get('tag', None)
        
        if tag_filter == 'all':
            # Return all barcodes (no filtering)
            barcodes = product.barcodes.all()
        elif tag_filter:
            # Filter by specific tag
            valid_tags = [choice[0] for choice in Barcode.TAG_CHOICES]
            if tag_filter in valid_tags:
                barcodes = product.barcodes.filter(tag=tag_filter)
                # For 'sold': non-tracked products may appear in the sold filter via
                # invoice items while their barcodes keep a different tag. Fall back to
                # all barcodes so the View SKUs modal is never empty for these products.
                if tag_filter == 'sold' and not barcodes.exists():
                    barcodes = product.barcodes.all()
            else:
                # Invalid tag, return empty
                barcodes = product.barcodes.none()
        else:
            # Default behavior: exclude 'sold' tag (for backward compatibility)
            barcodes = product.barcodes.exclude(tag='sold')
        
        serializer = BarcodeSerializer(barcodes, many=True)
        return Response(serializer.data)
    else:  # POST
        serializer = BarcodeSerializer(data={**request.data, 'product': product.id})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def product_components(request, pk):
    """Get or update components for a product"""
    product = get_object_or_404(Product, pk=pk)
    
    if request.method == 'GET':
        components = product.components.all()
        serializer = ProductComponentSerializer(components, many=True)
        return Response(serializer.data)
    else:  # PUT
        # Delete existing and create new
        product.components.all().delete()
        components_data = request.data if isinstance(request.data, list) else [request.data]
        for comp_data in components_data:
            ProductComponent.objects.create(product=product, **comp_data)
        components = product.components.all()
        serializer = ProductComponentSerializer(components, many=True)
        return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def product_backfill_barcodes(request):
    """Backfill barcodes for products that don't have them"""
    # Get all products with SKU that don't have any barcodes
    all_products = Product.objects.filter(sku__isnull=False)
    products_without_barcodes = [p for p in all_products if not p.barcodes.exists()]
    
    created_count = 0
    skipped_count = 0
    
    for product in products_without_barcodes:
        if product.sku:
            try:
                # Check if barcode with this SKU already exists (exact match only)
                try:
                    existing = Barcode.objects.get(barcode=product.sku)
                except Barcode.DoesNotExist:
                    existing = None
                if existing:
                    # Link existing barcode to this product if not already linked
                    if not existing.product:
                        existing.product = product
                        existing.is_primary = True
                        existing.save()
                        created_count += 1
                    else:
                        skipped_count += 1
                else:
                    # Create new barcode
                    Barcode.objects.create(
                        product=product,
                        barcode=product.sku,
                        is_primary=True,
                        tag='new'  # Explicitly set tag to 'new' for backfilled barcodes
                    )
                    created_count += 1
            except Exception as e:
                skipped_count += 1
    
    return Response({
        'message': f'Backfilled barcodes: {created_count} created, {skipped_count} skipped',
        'created': created_count,
        'skipped': skipped_count
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def product_generate_label(request):
    """Generate label locally (legacy endpoint - accepts ZPL code for compatibility)"""
    zpl_code = request.data.get('zpl_code', '')
    
    if not zpl_code:
        return Response({'error': 'ZPL code is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        image_data_url = generate_single_label(zpl_code)
        return Response({'image': image_data_url}, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Label generation error: {error_trace}")
        return Response({
            'error': f'Failed to generate label: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _filter_product_barcodes_queryset(product, purchase_id=None, purchase_item_id=None):
    """Scope barcodes for label print/generate/status (prefer purchase_item_id)."""
    qs = product.barcodes.all()
    if purchase_item_id is not None:
        try:
            return qs.filter(purchase_item_id=int(purchase_item_id))
        except (ValueError, TypeError):
            return qs.none()
    if purchase_id is not None:
        try:
            pid = int(purchase_id)
            return qs.filter(Q(purchase_id=pid) | Q(purchase_item__purchase_id=pid))
        except (ValueError, TypeError):
            pass
    return qs


def _ensure_purchase_barcodes_for_product(product, purchase_id, purchase_item_id=None):
    """Ensure purchase-scoped barcodes exist before generating labels."""
    if not purchase_id and not purchase_item_id:
        return 0

    from backend.purchasing.models import PurchaseItem
    from backend.purchasing.serializers import generate_barcodes_for_purchase_item

    created_total = 0
    purchase_items = PurchaseItem.objects.select_related('purchase', 'product', 'variant')
    if purchase_item_id is not None:
        try:
            purchase_items = purchase_items.filter(pk=int(purchase_item_id), product=product)
        except (ValueError, TypeError):
            return 0
    elif purchase_id:
        try:
            purchase_id_int = int(purchase_id)
            purchase_items = purchase_items.filter(purchase_id=purchase_id_int, product=product)
        except (ValueError, TypeError):
            return 0
    else:
        return 0

    for purchase_item in purchase_items:
        try:
            # Existing rows for this purchase line (active rows only)
            existing_count = Barcode.objects.filter(purchase_item=purchase_item).count()
            try:
                expected_count = int(purchase_item.quantity or 0)
            except Exception:
                expected_count = 0

            if expected_count <= 0:
                continue

            # For tracked inventory we need one barcode per quantity.
            # For non-tracked products, generator itself keeps one representative barcode.
            qty_to_add = 0
            if purchase_item.product and purchase_item.product.track_inventory:
                qty_to_add = max(0, expected_count - existing_count)
            elif existing_count == 0:
                qty_to_add = 1

            if qty_to_add > 0:
                before_count = Barcode.objects.filter(purchase_item=purchase_item).count()
                generate_barcodes_for_purchase_item(purchase_item, qty_to_add)
                after_count = Barcode.objects.filter(purchase_item=purchase_item).count()
                created_total += max(0, after_count - before_count)
        except Exception:
            # Best effort backfill: label generation should still proceed for existing rows.
            continue

    return created_total


@api_view(['POST'])
@permission_classes([IsAuthenticatedOrVendorPurchaseLabels])
def product_generate_labels(request, pk):
    """Batch generate labels for all barcodes of a product - OPTIMIZED for shared hosting
    
    Uses sequential processing (no threading) for maximum compatibility with shared hosting.
    All optimizations (prefetching, bulk queries, faster compression) still apply.
    Always uses Azure Function for label generation (with automatic fallback to local if Azure fails).
    
    Request body (optional):
        purchase_id: Filter barcodes by purchase ID
    """
    product = get_object_or_404(Product, pk=pk)
    
    # Get purchase_id / purchase_item_id from request body if provided
    purchase_id = request.data.get('purchase_id', None)
    purchase_item_id = request.data.get('purchase_item_id', None)
    
    # If purchase-scoped request has missing rows, auto-create barcodes first.
    _ensure_purchase_barcodes_for_product(product, purchase_id, purchase_item_id)

    barcodes_query = _filter_product_barcodes_queryset(
        product, purchase_id, purchase_item_id
    ).select_related('purchase', 'purchase__supplier')
    
    barcodes = list(barcodes_query)
    
    if not barcodes:
        return Response({'error': 'No barcodes found for this product' + (f' in purchase {purchase_id}' if purchase_id else '')}, status=status.HTTP_400_BAD_REQUEST)
    
    # OPTIMIZATION: Prefetch existing labels in bulk to avoid individual queries
    existing_labels = {
        label.barcode_id: label 
        for label in BarcodeLabel.objects.filter(
            barcode_id__in=[b.id for b in barcodes]
        ).select_related('barcode')
    }
    
    # Generate ZPL code helper
    def escape_zpl(text: str) -> str:
        return text.replace('\\', '\\\\').replace('^', '\\^').replace('~', '\\~').replace('\n', ' ').replace('\r', '')
    
    def create_zpl(barcode_obj: Barcode, product_name: str) -> str:
        max_name_length = 30
        truncated_name = product_name[:max_name_length] + '...' if len(product_name) > max_name_length else product_name
        safe_name = escape_zpl(truncated_name)
        safe_barcode = escape_zpl(barcode_obj.barcode)
        
        # Get vendor name and purchase date
        vendor_name = ""
        purchase_date = ""
        if barcode_obj.purchase:
            if barcode_obj.purchase.supplier:
                vendor_name = barcode_obj.purchase.supplier.name[:20] if len(barcode_obj.purchase.supplier.name) > 20 else barcode_obj.purchase.supplier.name
            purchase_date = barcode_obj.purchase.purchase_date.strftime('%Y-%m-%d')
        
        safe_vendor = escape_zpl(vendor_name)
        safe_date = escape_zpl(purchase_date)
        
        # Extract serial number from barcode
        # For barcodes like "FALC-20260101-0022-1", extract "0022-1" (last two parts)
        serial_number = ""
        if barcode_obj.barcode:
            parts = barcode_obj.barcode.split('-')
            if len(parts) >= 4:
                # If 4+ parts, take last two parts (e.g., "0022-1")
                serial_number = '-'.join(parts[-2:])
            elif len(parts) >= 3:
                # If 3 parts, take last part
                serial_number = parts[-1]
        
        safe_serial = escape_zpl(serial_number)
        
        # First line: Vendor Name + Purchase Date
        first_line = f"{safe_vendor} {safe_date}".strip()
        if not first_line:
            first_line = safe_name  # Fallback to product name
        
        # Last line: Product Name + Serial Number
        last_line = safe_name
        if serial_number:
            last_line += f" #{safe_serial}"
        
        return f"""^XA
^CF0,18
^FO50,20^FD{first_line}^FS
^BY2,3,80
^FO50,50^BCN,80,Y,N,N
^FD{safe_barcode}^FS
^CF0,18
^FO50,140^FD{last_line}^FS
^XZ"""
    
    # Storage for results (sequential processing, no threading needed)
    generated_labels = []
    newly_generated = []
    errors = []
    barcodes_to_queue = []  # Collect barcodes for bulk Azure queue
    
    # OPTIMIZATION: Prepare data for all barcodes upfront (avoid queries in loop)
    barcode_data = {}
    for barcode in barcodes:
        vendor_name = None
        purchase_date = None
        if barcode.purchase:
            if barcode.purchase.supplier:
                vendor_name = barcode.purchase.supplier.name
            purchase_date = barcode.purchase.purchase_date.strftime('%d-%m-%Y')
        
        # Extract serial number from barcode
        # For barcodes like "FALC-20260101-0022-1", extract "0022-1" (last two parts)
        serial_number = None
        if barcode.barcode:
            parts = barcode.barcode.split('-')
            if len(parts) >= 4:
                # If 4+ parts, take last two parts (e.g., "0022-1")
                serial_number = '-'.join(parts[-2:])
            elif len(parts) >= 3:
                # If 3 parts, take last part
                serial_number = parts[-1]
        
        barcode_data[barcode.id] = {
            'vendor_name': vendor_name,
            'purchase_date': purchase_date,
            'serial_number': serial_number,
            'barcode_value': barcode.barcode,
            'short_code': barcode.short_code if hasattr(barcode, 'short_code') else None,
        }
    
    def process_barcode(barcode):
        """Process a single barcode - generate label if needed (optimized for shared hosting)"""
        try:
            # OPTIMIZATION: Check existing labels from prefetched dict (no DB query)
            label_obj = existing_labels.get(barcode.id)
            created = False
            needs_generation = False
            
            if not label_obj:
                # Label doesn't exist - needs generation
                created = True
                needs_generation = True
                label_obj = BarcodeLabel(barcode=barcode, label_image='')
            else:
                # Label exists - check if it has valid image
                # Valid image can be: base64 data URL (data:image/...) or blob URL (https://...)
                has_valid_image = (
                    label_obj.label_image and 
                    len(label_obj.label_image.strip()) > 0 and
                    (label_obj.label_image.startswith('data:image') or 
                     label_obj.label_image.startswith('https://'))
                )
                needs_generation = not has_valid_image
            
            if needs_generation:
                # Collect barcode data for bulk processing
                # We'll process all barcodes that need generation in a single bulk request
                data = barcode_data[barcode.id]
                barcodes_to_queue.append({
                    'product_name': product.name,
                    'barcode_value': data.get('short_code') or data['barcode_value'],
                    'short_code': data.get('short_code'),
                    'barcode_id': barcode.id,
                    'vendor_name': data['vendor_name'],
                    'purchase_date': data['purchase_date'],
                    'serial_number': data['serial_number'],
                    'label_obj': label_obj,
                    'created': created
                })
            else:
                # Label already exists with valid image - add to results immediately
                generated_labels.append({
                    'barcode_id': barcode.id,
                    'barcode': barcode.barcode,
                    'image': label_obj.label_image,
                    'newly_generated': False
                })
        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            errors.append({
                'barcode_id': barcode.id,
                'barcode': barcode.barcode,
                'error': str(e)
            })
    
    # OPTIMIZATION: Process sequentially (no threading support for shared hosting)
    # Sequential processing is safer and more reliable on shared hosting environments
    # All optimizations (prefetching, bulk queries, faster compression) still apply
    for barcode in barcodes:
        process_barcode(barcode)
    
    # Bulk queue all barcodes that need generation via Azure Function
    if barcodes_to_queue:
        try:
            from .azure_label_service import queue_bulk_label_generation_via_azure
            # Prepare bulk data (without label_obj references)
            bulk_data = []
            for item in barcodes_to_queue:
                bulk_data.append({
                    'product_name': item['product_name'],
                    'barcode_value': item.get('short_code') or item['barcode_value'],
                    'short_code': item.get('short_code'),
                    'barcode_id': item['barcode_id'],
                    'vendor_name': item['vendor_name'],
                    'purchase_date': item['purchase_date'],
                    'serial_number': item['serial_number'],
                })
            
            # Queue all barcodes in one request
            blob_urls = queue_bulk_label_generation_via_azure(bulk_data)
            
            # Save blob URLs to database
            for item in barcodes_to_queue:
                barcode_id = item['barcode_id']
                blob_url = blob_urls.get(barcode_id)
                
                if blob_url:
                    # Idempotent write to avoid unique-key races when another worker
                    # creates BarcodeLabel between precheck and save.
                    BarcodeLabel.objects.update_or_create(
                        barcode_id=barcode_id,
                        defaults={'label_image': blob_url},
                    )
                    newly_generated.append(barcode_id)
                    # Add to generated_labels after processing
                    generated_labels.append({
                        'barcode_id': barcode_id,
                        'barcode': item['barcode_value'],
                        'image': blob_url,
                        'newly_generated': True
                    })
                else:
                    # Azure not configured or failed, fallback to local generation
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.warning(f"Azure bulk queuing failed for barcode {barcode_id}, falling back to local generation")
                    
                    # Fallback to local generation
                    from .label_generator import generate_label_image
                    data = barcode_data[barcode_id]
                    display_code = item.get('short_code') or data['barcode_value']
                    image_data_url = generate_label_image(
                        product_name=item['product_name'],
                        barcode_value=display_code,
                        sku=display_code,
                        vendor_name=data['vendor_name'],
                        purchase_date=data['purchase_date'],
                        serial_number=data['serial_number']
                    )
                    BarcodeLabel.objects.update_or_create(
                        barcode_id=barcode_id,
                        defaults={'label_image': image_data_url},
                    )
                    newly_generated.append(barcode_id)
                    # Add to generated_labels after processing
                    generated_labels.append({
                        'barcode_id': barcode_id,
                        'barcode': item['barcode_value'],
                        'image': image_data_url,
                        'newly_generated': True
                    })
        except Exception as e:
            # If bulk queuing fails, fallback to local generation for all
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Azure bulk label queuing failed: {str(e)}, falling back to local generation for all barcodes")
            
            from .label_generator import generate_label_image
            for item in barcodes_to_queue:
                try:
                    data = barcode_data[item['barcode_id']]
                    display_code = item.get('short_code') or data['barcode_value']
                    image_data_url = generate_label_image(
                        product_name=item['product_name'],
                        barcode_value=display_code,
                        sku=display_code,
                        vendor_name=data['vendor_name'],
                        purchase_date=data['purchase_date'],
                        serial_number=data['serial_number']
                    )
                    BarcodeLabel.objects.update_or_create(
                        barcode_id=item['barcode_id'],
                        defaults={'label_image': image_data_url},
                    )
                    newly_generated.append(item['barcode_id'])
                    # Add to generated_labels after processing
                    generated_labels.append({
                        'barcode_id': item['barcode_id'],
                        'barcode': item['barcode_value'],
                        'image': image_data_url,
                        'newly_generated': True
                    })
                except Exception as e2:
                    errors.append({
                        'barcode_id': item['barcode_id'],
                        'barcode': data.get('barcode_value', ''),
                        'error': str(e2)
                    })
    
    return Response({
        'product_id': product.id,
        'product_name': product.name,
        'total_labels': len(generated_labels),
        'newly_generated': len(newly_generated),
        'already_existed': len(generated_labels) - len(newly_generated),
        'errors': len(errors),
        'labels': generated_labels,
        'error_details': errors if errors else None
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticatedOrVendorPurchaseLabels])
def product_get_labels(request, pk):
    """Get existing labels for a product (without generating new ones)
    
    Query parameters:
        purchase_id: Optional. Filter barcodes by purchase ID
        purchase_item_id: Optional. Filter barcodes by purchase line (preferred for print)
        printable_only: Optional. When true, excludes sold/defective tags
        exclude_tags: Optional CSV list of barcode tags to exclude (e.g. sold,defective)
    """
    product = get_object_or_404(Product, pk=pk)
    
    purchase_id = request.query_params.get('purchase_id', None)
    purchase_item_id = request.query_params.get('purchase_item_id', None)
    
    printable_only = str(request.query_params.get('printable_only', '')).lower() in ('1', 'true', 'yes', 'y')
    exclude_tags_raw = request.query_params.get('exclude_tags', None)

    # Default printable mode excludes sold/defective labels.
    if printable_only and not exclude_tags_raw:
        exclude_tags = ['sold', 'defective']
    else:
        exclude_tags = [
            tag.strip() for tag in (exclude_tags_raw or '').split(',') if tag and tag.strip()
        ]

    base_barcodes_query = _filter_product_barcodes_queryset(product, purchase_id, purchase_item_id)
    barcodes_query = base_barcodes_query

    if exclude_tags:
        barcodes_query = barcodes_query.exclude(tag__in=exclude_tags)

    barcodes_query = barcodes_query.order_by('short_code', 'id')
    
    barcodes = barcodes_query
    excluded_non_printable_count = 0
    if exclude_tags:
        excluded_non_printable_count = max(0, base_barcodes_query.count() - barcodes_query.count())
    
    # Get all existing labels for these barcodes
    # Valid labels can be: base64 data URL (data:image/...) or blob URL (https://...)
    labels = (
        BarcodeLabel.objects.filter(
            barcode__in=barcodes
        )
        .exclude(label_image='')
        .exclude(label_image__isnull=True)
        .filter(
            Q(label_image__startswith='data:image') | Q(label_image__startswith='https://')
        )
        .select_related('barcode')
        # Ensure deterministic ordering matching barcode short_code sequence
        .order_by('barcode__short_code', 'barcode__id')
    )
    
    labels_list = []
    for label in labels:
        labels_list.append({
            'barcode_id': label.barcode.id,
            'barcode': label.barcode.barcode,
            'barcode_tag': label.barcode.tag,
            'image': label.label_image,
            'newly_generated': False  # These are existing labels
        })
    
    return Response({
        'product_id': product.id,
        'product_name': product.name,
        'total_labels': len(labels_list),
        'labels': labels_list,
        'purchase_id': purchase_id,
        'purchase_item_id': purchase_item_id,
        'printable_only': printable_only,
        'exclude_tags': exclude_tags,
        'excluded_non_printable_count': excluded_non_printable_count,
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticatedOrVendorPurchaseLabels])
def product_labels_status(request, pk):
    """Check if labels are already generated for a product
    
    Query parameters:
        purchase_id: Optional. Filter barcodes by purchase ID
        purchase_item_id: Optional. Filter barcodes by purchase line (preferred)
    """
    product = get_object_or_404(Product, pk=pk)
    
    purchase_id = request.query_params.get('purchase_id', None)
    purchase_item_id = request.query_params.get('purchase_item_id', None)
    
    barcodes_query = _filter_product_barcodes_queryset(product, purchase_id, purchase_item_id)
    barcodes = barcodes_query
    printable_barcodes = barcodes.exclude(tag__in=['sold', 'defective'])

    total_barcodes = barcodes.count()
    total_printable_barcodes = printable_barcodes.count()
    excluded_non_printable_count = max(0, total_barcodes - total_printable_barcodes)

    # Check for valid labels: not empty, not null, and starts with data:image or https:// (blob URL)
    generated_count = BarcodeLabel.objects.filter(
        barcode__in=barcodes
    ).exclude(
        label_image=''
    ).exclude(
        label_image__isnull=True
    ).filter(
        Q(label_image__startswith='data:image') | Q(label_image__startswith='https://')
    ).count()

    generated_printable_count = BarcodeLabel.objects.filter(
        barcode__in=printable_barcodes
    ).exclude(
        label_image=''
    ).exclude(
        label_image__isnull=True
    ).filter(
        Q(label_image__startswith='data:image') | Q(label_image__startswith='https://')
    ).count()

    printable_all_generated = (
        generated_printable_count == total_printable_barcodes and total_printable_barcodes > 0
    )
    
    return Response({
        'product_id': product.id,
        'total_barcodes': total_barcodes,
        'generated_labels': generated_count,
        # Keep all_generated focused on printable labels for print UI behavior.
        'all_generated': printable_all_generated,
        'needs_generation': generated_printable_count < total_printable_barcodes,
        'total_printable_barcodes': total_printable_barcodes,
        'generated_printable_labels': generated_printable_count,
        'excluded_non_printable_count': excluded_non_printable_count,
        'purchase_id': purchase_id,
        'purchase_item_id': purchase_item_id,
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def product_regenerate_labels(request, pk):
    """Regenerate labels for a product via Azure API
    
    Request body:
        purchase_id: Optional. Filter barcodes by purchase ID
        purchase_item_id: Optional. Filter barcodes by purchase line (preferred)
    """
    from .azure_label_service import queue_bulk_label_generation_via_azure
    
    product = get_object_or_404(Product, pk=pk)
    
    purchase_id = request.data.get('purchase_id', None)
    purchase_item_id = request.data.get('purchase_item_id', None)
    
    _ensure_purchase_barcodes_for_product(product, purchase_id, purchase_item_id)

    barcodes_query = _filter_product_barcodes_queryset(
        product, purchase_id, purchase_item_id
    ).select_related('product', 'purchase', 'purchase__supplier')
    
    barcodes = list(barcodes_query)
    
    if not barcodes:
        return Response({
            'error': 'No barcodes found for this product',
            'message': 'The product has no barcodes to regenerate labels for.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Prepare barcode data for Azure API
    barcodes_data = []
    for barcode in barcodes:
        # Get vendor name and purchase date
        vendor_name = None
        purchase_date = None
        if barcode.purchase:
            if barcode.purchase.supplier:
                vendor_name = barcode.purchase.supplier.name
            purchase_date = barcode.purchase.purchase_date.strftime('%d-%m-%Y')
        
        # Extract serial number from barcode
        serial_number = None
        if barcode.barcode:
            parts = barcode.barcode.split('-')
            if len(parts) >= 4:
                serial_number = '-'.join(parts[-2:])
            elif len(parts) >= 3:
                serial_number = parts[-1]
        
        barcodes_data.append({
            'product_name': product.name,
            'barcode_value': (barcode.short_code if hasattr(barcode, 'short_code') else None) or barcode.barcode,
            'short_code': barcode.short_code if hasattr(barcode, 'short_code') else None,
            'barcode_id': barcode.id,
            'vendor_name': vendor_name,
            'purchase_date': purchase_date,
            'serial_number': serial_number,
        })
    
    # Queue regeneration via Azure API
    try:
        blob_urls = queue_bulk_label_generation_via_azure(barcodes_data)
        
        # Update label_image with blob URLs
        updated_count = 0
        for barcode in barcodes:
            if barcode.id in blob_urls:
                blob_url = blob_urls[barcode.id]
                if blob_url:
                    # Get or create BarcodeLabel
                    label_obj, created = BarcodeLabel.objects.get_or_create(barcode=barcode)
                    label_obj.label_image = blob_url
                    label_obj.save(update_fields=['label_image', 'updated_at'])
                    updated_count += 1
        
        return Response({
            'success': True,
            'product_id': product.id,
            'product_name': product.name,
            'total_barcodes': len(barcodes),
            'queued_for_regeneration': updated_count,
            'message': f'Successfully queued {updated_count} label(s) for regeneration. Labels will be generated by Azure Function.'
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        return Response({
            'error': 'Failed to regenerate labels',
            'message': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



# ProductVariant views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def product_variant_list_create(request):
    """List all product variants or create a new variant"""
    if request.method == 'GET':
        variants = ProductVariant.objects.all()
        serializer = ProductVariantSerializer(variants, many=True)
        return Response(serializer.data)
    else:
        serializer = ProductVariantSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def product_variant_detail(request, pk):
    """Retrieve, update or delete a product variant"""
    variant = get_object_or_404(ProductVariant, pk=pk)
    
    if request.method == 'GET':
        serializer = ProductVariantSerializer(variant)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = ProductVariantSerializer(variant, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = ProductVariantSerializer(variant, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        variant.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# Helper function to check if barcode is sold and get invoice info
def check_barcode_sold_status(barcode_obj):
    """Check if a barcode is sold and return (is_sold, sold_invoice_number)
    
    Optimized to use tag check first, then query if needed.
    """
    # Fast path: if tag is 'sold', it's definitely sold
    if barcode_obj.tag == 'sold':
        # Still need to get invoice number (one barcode -> at most one invoice item; use get, not first)
        from backend.pos.models import InvoiceItem
        try:
            sold_item = InvoiceItem.objects.filter(
                barcode=barcode_obj
            ).exclude(
                invoice__status='void'
            ).select_related('invoice').only('invoice__invoice_number').get()
            return True, sold_item.invoice.invoice_number
        except (InvoiceItem.DoesNotExist, InvoiceItem.MultipleObjectsReturned):
            return True, None

    # Check if assigned to a non-void invoice (one barcode -> at most one invoice item; use get, not first)
    from backend.pos.models import InvoiceItem
    try:
        sold_item = InvoiceItem.objects.filter(
            barcode=barcode_obj
        ).exclude(
            invoice__status='void'
        ).select_related('invoice').only('invoice__invoice_number').get()
        return True, sold_item.invoice.invoice_number
    except (InvoiceItem.DoesNotExist, InvoiceItem.MultipleObjectsReturned):
        pass

    return False, None


# Helper function to build response for barcode lookup
def build_barcode_response(barcode_obj, product, logger, match_type='exact'):
    """Build standardized response for barcode lookup"""
    # Fast-path for scanner-only flows: for non-sold tags we can skip InvoiceItem lookup.
    # This endpoint is called on each scan, so avoid extra joins unless needed.
    if barcode_obj.tag == 'sold':
        is_sold, sold_invoice = check_barcode_sold_status(barcode_obj)
    else:
        is_sold, sold_invoice = False, None
    
    logger.info(f"Found product by barcode ({match_type}): {product.name} (Barcode: {barcode_obj.barcode}, Tag: {barcode_obj.tag})")
    serializer = ProductSerializer(product)
    response_data = serializer.data
    
    # Include the matched barcode and availability status
    # matched_barcode: for display (prefer short_code if available)
    # canonical_barcode: always the DB barcode field - use this when adding to cart so cart stores exactly this
    # barcode_id: use when adding to invoice so the exact scanned barcode is assigned (not another one for same product)
    response_data['matched_barcode'] = barcode_obj.short_code or barcode_obj.barcode
    response_data['canonical_barcode'] = barcode_obj.barcode
    response_data['barcode_id'] = barcode_obj.id
    response_data['barcode_tag'] = barcode_obj.tag
    response_data['barcode_available'] = barcode_obj.tag in ['new', 'returned']
    
    # Get status message based on tag
    status_message, barcode_status = get_barcode_status_message(barcode_obj, sold_invoice)
    response_data['barcode_status'] = barcode_status
    response_data['barcode_status_message'] = status_message
    
    if is_sold and sold_invoice:
        response_data['sold_invoice'] = sold_invoice

    # Check if defective barcode has already been moved out
    if barcode_obj.tag == 'defective':
        # Include supplier info for defective barcodes
        supplier = None
        if barcode_obj.purchase and barcode_obj.purchase.supplier:
            supplier = barcode_obj.purchase.supplier
        elif hasattr(barcode_obj, 'purchase_item') and barcode_obj.purchase_item and barcode_obj.purchase_item.purchase and barcode_obj.purchase_item.purchase.supplier:
            supplier = barcode_obj.purchase_item.purchase.supplier
        if supplier:
            response_data['supplier_id'] = supplier.id
            response_data['supplier_name'] = supplier.name

        try:
            move_out_item = DefectiveProductItem.objects.select_related('move_out').filter(
                barcode=barcode_obj
            ).first()
            if move_out_item:
                move_out = move_out_item.move_out
                response_data['defective_moved_out'] = True
                response_data['defective_move_out_number'] = move_out.move_out_number
                response_data['defective_move_out_reason'] = move_out.get_reason_display()
                response_data['defective_move_out_notes'] = move_out.notes or ''
        except Exception:
            pass
    
    return response_data


def build_barcode_response_lightweight(barcode_obj, product, logger, match_type='exact'):
    """Build minimal response for high-frequency barcode_only scans."""
    logger.info(f"Found product by barcode ({match_type}, lightweight): {product.name} (Barcode: {barcode_obj.barcode}, Tag: {barcode_obj.tag})")

    stock_counts = product.barcodes.aggregate(
        stock_quantity=Count('id', filter=~Q(tag='sold')),
        available_quantity=Count('id', filter=Q(tag__in=['new', 'returned']))
    )

    selling_price = barcode_obj.get_selling_price() or barcode_obj.get_purchase_price() or Decimal('0')

    response_data = {
        'id': product.id,
        'name': product.name,
        'sku': getattr(product, 'sku', ''),
        'brand_name': product.brand.name if getattr(product, 'brand', None) else None,
        'category_name': product.category.name if getattr(product, 'category', None) else None,
        'product_type': getattr(product, 'product_type', 'standard'),
        'track_inventory': getattr(product, 'track_inventory', True),
        'low_stock_threshold': getattr(product, 'low_stock_threshold', 0),
        # Be defensive for mixed/legacy product schemas in lightweight scan path.
        'can_go_below_purchase_price': getattr(product, 'can_go_below_purchase_price', False),
        'tax_rate': getattr(product, 'tax_rate', 0),
        'selling_price': float(selling_price),
        # Keep shape close to ProductSerializer to avoid frontend regressions.
        'barcodes': [],
        'stock_quantity': float(stock_counts.get('stock_quantity') or 0),
        'available_quantity': float(stock_counts.get('available_quantity') or 0),
        'matched_barcode': barcode_obj.short_code or barcode_obj.barcode,
        'canonical_barcode': barcode_obj.barcode,
        'barcode_id': barcode_obj.id,
        'barcode_tag': barcode_obj.tag,
        'barcode_available': barcode_obj.tag in ['new', 'returned'],
    }

    status_message, barcode_status = get_barcode_status_message(barcode_obj, None)
    response_data['barcode_status'] = barcode_status
    response_data['barcode_status_message'] = status_message

    if barcode_obj.tag == 'sold':
        is_sold, sold_invoice = check_barcode_sold_status(barcode_obj)
        if is_sold and sold_invoice:
            response_data['sold_invoice'] = sold_invoice

    return response_data


# Barcode views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def barcode_list_create(request):
    """List all barcodes or create a new barcode"""
    if request.method == 'GET':
        barcodes = Barcode.objects.all()
        serializer = BarcodeSerializer(barcodes, many=True)
        return Response(serializer.data)
    else:
        serializer = BarcodeSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def barcode_detail(request, pk):
    """Retrieve, update or delete a barcode"""
    barcode = get_object_or_404(Barcode, pk=pk)
    
    if request.method == 'GET':
        serializer = BarcodeSerializer(barcode)
        return Response(serializer.data)
    elif request.method == 'PUT':
        serializer = BarcodeSerializer(barcode, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == 'PATCH':
        serializer = BarcodeSerializer(barcode, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    else:  # DELETE
        # Delete associated blob from Azure Storage before deleting barcode
        try:
            from backend.catalog.azure_label_service import delete_blob_from_azure
            delete_blob_from_azure(barcode.id)
        except Exception as e:
            # Log error but don't fail the deletion - blob cleanup is best effort
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Failed to delete blob from Azure Storage for barcode {barcode.id}: {str(e)}")
        
        barcode.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def barcode_by_barcode(request, barcode=None):
    """Look up product by barcode/SKU
    
    Can be called with:
    - Path parameter: /barcodes/by-barcode/{barcode}/
    - Query parameter: /barcodes/by-barcode/?barcode={barcode}
    """
    try:
        # Support both path parameter and query parameter
        if not barcode:
            barcode = request.query_params.get('barcode', None)
        
        if not barcode:
            return Response({'error': 'Barcode is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Clean and standardize: URL decode, strip scanner whitespace, uppercase
        barcode_clean = clean_scanned_barcode(unquote(str(barcode)))
        if not barcode_clean:
            return Response({'error': 'Barcode is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Check if we should only search barcodes (skip SKU fallback)
        barcode_only = request.query_params.get('barcode_only', 'false').lower() == 'true'
        # POS scanner optimization flag: return lightweight payload for high-frequency scans.
        # Keep normal behavior for all other callers.
        pos_scan = request.query_params.get('pos_scan', 'false').lower() == 'true'
        # Skip all cache (API response + barcode cache) when no_cache=true — use for invoice add to avoid stale matches
        no_cache = request.query_params.get('no_cache', 'false').lower() == 'true'

        # Reject reserved keywords that are barcode tags, not actual barcodes
        reserved_keywords = ['new', 'sold', 'returned', 'defective', 'unknown']
        if barcode_clean.lower() in reserved_keywords:
            return Response({
                'error': 'Invalid barcode',
                'searched': barcode_clean,
                'message': f'"{barcode_clean}" is a reserved keyword and cannot be used as a barcode search'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Debug: Log the search
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Looking up barcode/SKU: '{barcode_clean}'")
        
        # Check cache first (5 minute TTL for barcode lookups) — skip when no_cache=true (e.g. invoice creation)
        # Include mode in cache key. POS scan uses lightweight payload, others use full payload.
        cache_key = f'barcode_lookup:v3:{barcode_clean}:bo:{1 if barcode_only else 0}:ps:{1 if pos_scan else 0}'
        if not no_cache:
            cached_response = cache.get(cache_key)
            if cached_response:
                logger.debug(f"Cache hit for barcode: '{barcode_clean}'")
                response = Response(cached_response)
                # Add cache headers for browser-level caching (1 minute for barcode lookups)
                response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
                return response

        # Use centralized barcode search function from filters.py (skip_cache=no_cache for invoice add)
        # This handles all flexible matching: normalized, prefix, exact, case-insensitive, contains
        # All barcode search logic is now centralized in filters.py for consistency
        barcode_obj = find_barcode_by_search_value(barcode_clean, logger, skip_cache=no_cache)
        if barcode_obj:
            product = barcode_obj.product or (barcode_obj.variant.product if barcode_obj.variant else None)
            if product and product.is_active:
                logger.info(f"Found barcode match: '{barcode_clean}' -> '{barcode_obj.short_code or barcode_obj.barcode}'")
                if pos_scan:
                    response_data = build_barcode_response_lightweight(barcode_obj, product, logger, 'flexible_match')
                else:
                    response_data = build_barcode_response(barcode_obj, product, logger, 'flexible_match')
                # Cache the API response for 5 minutes (separate from barcode data cache) — skip when no_cache
                if not no_cache:
                    cache.set(cache_key, response_data, 300)
                response = Response(response_data)
                # Add cache headers for browser-level caching (1 minute for barcode lookups)
                response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
                return response
        
        # Keep the rest of the fallback logic below (SKU search, product name search, etc.)
        # This is for backward compatibility and fallback scenarios
        normalized_input = normalize_barcode_for_search(barcode_clean)  # Keep for fallback logic below
        
        # All barcode search logic is now handled by find_barcode_by_search_value() above
        # The rest below is for SKU and product name fallback searches
        

        
        # Strategy 3: Try exact match on Product SKU (fallback) - only if barcode_only is False
        if not barcode_only:
            # Try cache first
            from backend.core.model_cache import get_cached_product_by_sku, cache_product_data
            cached_product = get_cached_product_by_sku(barcode_clean)
            
            product = None
            if cached_product:
                # Get full product object for serializer (exact id — use get, not first)
                try:
                    product = Product.objects.select_related('category', 'brand').get(
                        id=cached_product['id'],
                        is_active=True
                    )
                except Product.DoesNotExist:
                    pass
            if product is None:
                # Cache miss - fetch from database (exact SKU — use get, not first)
                try:
                    product = Product.objects.exclude(sku__isnull=True).exclude(sku='').select_related(
                        'category', 'brand'
                    ).get(sku=barcode_clean, is_active=True)
                except (Product.DoesNotExist, Product.MultipleObjectsReturned):
                    product = None
                
                # Cache the result if found
                if product:
                    try:
                        cache_product_data(product)
                    except Exception:
                        pass  # Cache failure shouldn't break the lookup
            
            if product:
                logger.info(f"Found product by SKU (exact): {product.name} (SKU: {product.sku})")
                serializer = ProductSerializer(product)
                response_data = serializer.data
                
                # Exact match: product barcode with this value (get, not first)
                try:
                    product_barcode = product.barcodes.get(barcode=barcode_clean)
                except (Barcode.DoesNotExist, Barcode.MultipleObjectsReturned):
                    product_barcode = None
                if product_barcode:
                    is_sold, sold_invoice = check_barcode_sold_status(product_barcode)
                    response_data['matched_barcode'] = product_barcode.barcode
                    response_data['canonical_barcode'] = product_barcode.barcode
                    response_data['barcode_id'] = product_barcode.id
                    response_data['barcode_tag'] = product_barcode.tag
                    response_data['barcode_available'] = product_barcode.tag in ['new', 'returned']
                    
                    # Get status message based on tag
                    status_message, barcode_status = get_barcode_status_message(product_barcode, sold_invoice)
                    response_data['barcode_status'] = barcode_status
                    response_data['barcode_status_message'] = status_message
                    
                    if is_sold and sold_invoice:
                        response_data['sold_invoice'] = sold_invoice
                
                # Cache the response for 5 minutes
                cache.set(cache_key, response_data, 300)
                response = Response(response_data)
                # Add cache headers for browser-level caching (1 minute for barcode lookups)
                response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
                return response
            
            # Strategy 4: Try case-insensitive match on Product SKU
            # Try cache first (case-insensitive lookup)
            from backend.core.model_cache import get_cached_product_by_sku, cache_product_data
            cached_product = get_cached_product_by_sku(barcode_clean.upper()) or get_cached_product_by_sku(barcode_clean.lower())
            
            product = None
            if cached_product:
                try:
                    product = Product.objects.select_related('category', 'brand').get(
                        id=cached_product['id'],
                        is_active=True
                    )
                except Product.DoesNotExist:
                    pass
            if product is None:
                # Cache miss - fetch from database (exact SKU iexact — use get, not first)
                try:
                    product = Product.objects.exclude(sku__isnull=True).exclude(sku='').select_related(
                        'category', 'brand'
                    ).get(sku__iexact=barcode_clean, is_active=True)
                except (Product.DoesNotExist, Product.MultipleObjectsReturned):
                    product = None
                
                # Cache the result if found
                if product:
                    try:
                        cache_product_data(product)
                    except Exception:
                        pass  # Cache failure shouldn't break the lookup
            
            if product:
                logger.info(f"Found product by SKU (case-insensitive): {product.name} (SKU: {product.sku})")
                serializer = ProductSerializer(product)
                response_data = serializer.data
                
                # Exact match: product barcode with this value (get, not first)
                try:
                    product_barcode = product.barcodes.get(barcode=barcode_clean)
                except (Barcode.DoesNotExist, Barcode.MultipleObjectsReturned):
                    product_barcode = None
                if product_barcode:
                    is_sold, sold_invoice = check_barcode_sold_status(product_barcode)
                    response_data['matched_barcode'] = product_barcode.barcode
                    response_data['canonical_barcode'] = product_barcode.barcode
                    response_data['barcode_tag'] = product_barcode.tag
                    response_data['barcode_available'] = product_barcode.tag in ['new', 'returned']
                    
                    # Get status message based on tag
                    status_message, barcode_status = get_barcode_status_message(product_barcode, sold_invoice)
                    response_data['barcode_status'] = barcode_status
                    response_data['barcode_status_message'] = status_message
                    
                    if is_sold and sold_invoice:
                        response_data['sold_invoice'] = sold_invoice
                
                # Cache the response for 5 minutes
                cache.set(cache_key, response_data, 300)
                response = Response(response_data)
                # Add cache headers for browser-level caching (1 minute for barcode lookups)
                response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
                return response
        
        # Strategy 6: Removed barcode contains match - barcodes must be exact matches only
        # Barcode searches should always use exact matching via find_barcode_by_search_value()
        
        # Strategy 7: Try product name search as fallback (only if barcode_only is False)
        # When barcode_only=True (e.g. checkout modal short code scan), require exact barcode/short_code
        # match only — never return a product by name match, or the wrong item can be added (e.g. different invoice).
        # No .first(): only return a product when exactly one name match (get, not first).
        product = None
        if not barcode_only:
            name_qs = Product.objects.filter(
                name__icontains=barcode_clean,
                is_active=True
            )
            if name_qs.count() == 1:
                product = name_qs.get()
        
        if product:
            logger.info(f"Found product by name (fallback): {product.name}")
            serializer = ProductSerializer(product)
            response_data = serializer.data
            
            # Exact match: searched value as barcode or short_code (get, not first)
            searched_barcode_obj = None
            try:
                searched_barcode_obj = Barcode.objects.get(barcode=barcode_clean)
            except Barcode.DoesNotExist:
                try:
                    searched_barcode_obj = Barcode.objects.get(short_code=barcode_clean)
                except Barcode.DoesNotExist:
                    pass
            if searched_barcode_obj and searched_barcode_obj.product_id == product.id:
                # The searched value is actually a barcode for this product
                from backend.pos.models import InvoiceItem
                sold_invoice = None
                if searched_barcode_obj.tag == 'sold':
                    try:
                        sold_item = InvoiceItem.objects.filter(
                            barcode=searched_barcode_obj
                        ).exclude(
                            invoice__status='void'
                        ).select_related('invoice').get()
                        sold_invoice = sold_item.invoice.invoice_number
                    except (InvoiceItem.DoesNotExist, InvoiceItem.MultipleObjectsReturned):
                        sold_invoice = None
                
                response_data['matched_barcode'] = searched_barcode_obj.barcode
                response_data['canonical_barcode'] = searched_barcode_obj.barcode
                response_data['barcode_id'] = searched_barcode_obj.id
                response_data['barcode_tag'] = searched_barcode_obj.tag
                response_data['barcode_available'] = searched_barcode_obj.tag in ['new', 'returned']
                
                # Get status message based on tag
                status_message, barcode_status = get_barcode_status_message(searched_barcode_obj, sold_invoice)
                response_data['barcode_status'] = barcode_status
                response_data['barcode_status_message'] = status_message
                
                if sold_invoice:
                    response_data['sold_invoice'] = sold_invoice
            
            response = Response(response_data)
            # Add cache headers for browser-level caching (1 minute for barcode lookups)
            response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
            return response
        
        logger.warning(f"Barcode/SKU/Name not found: '{barcode_clean}' (tried: exact, case-insensitive, contains, name)")
        return Response({
            'error': 'Product not found',
            'searched': barcode_clean,
            'message': f'No product found with barcode, SKU, or name matching: {barcode_clean}'
        }, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Error searching for barcode '{barcode_clean if 'barcode_clean' in locals() else str(barcode)}': {str(e)}", exc_info=True)
        return Response({
            'error': 'Internal server error',
            'searched': barcode_clean if 'barcode_clean' in locals() else str(barcode) if barcode else 'unknown',
            'message': f'An error occurred while searching for barcode: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['PATCH', 'PUT'])
@permission_classes([IsAuthenticated])
def update_barcode_tag(request, barcode_id):
    """Update barcode tag with validation for allowed transitions"""
    from rest_framework import status
    from rest_framework.response import Response
    
    barcode_obj = get_object_or_404(Barcode, pk=barcode_id)
    new_tag = request.data.get('tag')
    
    if not new_tag:
        return Response({'error': 'Tag is required'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate tag value
    valid_tags = [choice[0] for choice in Barcode.TAG_CHOICES]
    if new_tag not in valid_tags:
        return Response({
            'error': f'Invalid tag. Must be one of: {", ".join(valid_tags)}'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    old_tag = barcode_obj.tag

    if new_tag == 'sold':
        return Response({
            'error': 'Cannot set barcode tag to "sold" manually. Complete a sale in POS instead.'
        }, status=status.HTTP_400_BAD_REQUEST)

    if new_tag == 'returned' and old_tag != 'unknown':
        return Response({
            'error': 'Cannot set barcode tag to "returned" manually. Mark returns from Unknown items or use POS replacement.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate tag transitions
    # Allow: 'new' -> 'defective' (write off fresh stock)
    # Allow: 'unknown' -> 'returned'/'defective'
    # Allow: 'returned'/'defective' -> 'new' (with confirmation)
    # Prevent: 'sold' -> any other tag (except through replacement which is handled separately)
    # Prevent: 'new' -> 'returned' (must go through sold -> unknown first)
    
    if old_tag == 'sold' and new_tag != 'unknown':
        return Response({
            'error': 'Cannot change tag from "sold" directly. Use replacement process instead.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if old_tag == 'new' and new_tag == 'returned':
        return Response({
            'error': 'Cannot change tag from "new" to "returned". Product must be sold first.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if old_tag == 'unknown' and new_tag not in ['returned', 'defective']:
        return Response({
            'error': 'Can only change tag from "unknown" to "returned" or "defective"'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if old_tag in ['returned', 'defective'] and new_tag == 'new':
        # This requires confirmation - check if confirmed flag is present
        confirmed = request.data.get('confirmed', False)
        if not confirmed:
            return Response({
                'error': 'Confirmation required',
                'message': 'Are you sure you want to add this product back to inventory?',
                'requires_confirmation': True,
                'old_tag': old_tag,
                'new_tag': new_tag
            }, status=status.HTTP_400_BAD_REQUEST)
    
    # Update tag
    barcode_obj.tag = new_tag
    barcode_obj.save()
    
    # Create audit log for tag change
    action_map = {
        'returned': 'return',
        'defective': 'delete',  # Marking as defective removes from inventory
        'new': 'update',  # Re-adding to inventory
    }
    audit_action = action_map.get(new_tag, 'update')
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
        }
    )
    
    return Response({
        'message': f'Barcode tag updated from "{old_tag}" to "{new_tag}"',
        'barcode': {
            'id': barcode_obj.id,
            'barcode': barcode_obj.barcode,
            'tag': barcode_obj.tag,
            'product_id': barcode_obj.product.id if barcode_obj.product else None,
            'product_name': barcode_obj.product.name if barcode_obj.product else None,
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def bulk_update_barcode_tags(request):
    """Bulk update barcode tags with validation and invoice updates"""
    from rest_framework import status
    from rest_framework.response import Response
    from django.db import transaction
    
    barcode_ids = request.data.get('barcode_ids', [])
    new_tag = request.data.get('tag')
    confirmed = request.data.get('confirmed', False)
    
    if not barcode_ids or not isinstance(barcode_ids, list):
        return Response({
            'error': 'barcode_ids array is required'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if not new_tag:
        return Response({
            'error': 'Tag is required'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate tag value
    valid_tags = [choice[0] for choice in Barcode.TAG_CHOICES]
    if new_tag not in valid_tags:
        return Response({
            'error': f'Invalid tag. Must be one of: {", ".join(valid_tags)}'
        }, status=status.HTTP_400_BAD_REQUEST)

    if new_tag == 'sold':
        return Response({
            'error': 'Cannot set barcode tag to "sold" manually. Complete a sale in POS instead.'
        }, status=status.HTTP_400_BAD_REQUEST)

    if new_tag == 'returned':
        # Bulk unknown->returned is allowed per barcode below; reject upfront if none are unknown.
        unknown_ids = set(
            Barcode.objects.filter(pk__in=barcode_ids, tag='unknown').values_list('pk', flat=True)
        )
        if not unknown_ids:
            return Response({
                'error': 'Cannot set barcode tag to "returned" manually. Mark returns from Unknown items or use POS replacement.'
            }, status=status.HTTP_400_BAD_REQUEST)
    
    updated_barcodes = []
    errors = []
    requires_confirmation = False
    updated_invoices = set()
    
    with transaction.atomic():
        for barcode_id in barcode_ids:
            try:
                barcode_obj = Barcode.objects.select_for_update().get(pk=barcode_id)
                old_tag = barcode_obj.tag
                
                # Validate transitions (same rules as single update)
                if new_tag == 'returned' and old_tag != 'unknown':
                    errors.append(
                        f'Barcode {barcode_obj.barcode}: Cannot set to "returned" (must be Unknown first)'
                    )
                    continue

                if old_tag == 'sold' and new_tag != 'unknown':
                    errors.append(f'Barcode {barcode_obj.barcode}: Cannot change from "sold" directly')
                    continue
                
                if old_tag == 'new' and new_tag == 'returned':
                    errors.append(f'Barcode {barcode_obj.barcode}: Cannot change from "new" to "returned"')
                    continue
                
                if old_tag == 'unknown' and new_tag not in ['returned', 'defective']:
                    errors.append(f'Barcode {barcode_obj.barcode}: Can only change from "unknown" to "returned" or "defective"')
                    continue
                
                if old_tag in ['returned', 'defective'] and new_tag == 'new':
                    if not confirmed:
                        requires_confirmation = True
                        continue
                
                # If changing from 'unknown' to 'returned' or 'defective', update invoice items if they exist
                # Note: Invoice items are optional - items can be marked as returned/defective even if not sold
                invoice_item_updated = False
                if old_tag == 'unknown' and new_tag in ['returned', 'defective']:
                    # Find all invoice items that reference this barcode (if any)
                    invoice_items = InvoiceItem.objects.filter(
                        barcode=barcode_obj
                    ).select_related('invoice')
                    
                    # Only update invoice items if they exist - this is optional
                    if invoice_items.exists():
                        for invoice_item in invoice_items:
                            invoice = invoice_item.invoice
                        
                        # Only update if invoice is completed (not void, draft, or pending)
                        if invoice.status in ['void', 'draft'] or invoice.invoice_type == 'pending':
                            continue  # Skip draft/pending/void invoices
                        
                        # Check if already fully returned
                        if invoice_item.replaced_quantity >= invoice_item.quantity:
                                # Skip this invoice item but continue processing others
                            continue
                        
                        # Update replaced_quantity to match the quantity if not already updated
                        # For tracked products, each barcode = 1 unit
                        if invoice_item.replaced_quantity < invoice_item.quantity:
                            # Increment replaced_quantity by 1 (since each barcode = 1 unit)
                            invoice_item.replaced_quantity += Decimal('1.000')
                            if not invoice_item.replaced_at:
                                invoice_item.replaced_at = timezone.now()
                            if not invoice_item.replaced_by:
                                invoice_item.replaced_by = request.user
                            invoice_item.save()
                            updated_invoices.add(invoice.id)
                            invoice_item_updated = True
                    
                    # Allow tag update even if no invoice items exist - items can be marked as returned/defective
                    # without being sold (e.g., found items, manual tagging, etc.)
                
                # Update tag only if validation passed
                barcode_obj.tag = new_tag
                barcode_obj.save()
                
                # Create audit log for tag change
                action_map = {
                    'returned': 'return',
                    'defective': 'delete',  # Marking as defective removes from inventory
                    'new': 'update',  # Re-adding to inventory
                }
                audit_action = action_map.get(new_tag, 'update')
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
                    }
                )
                
                updated_barcodes.append({
                    'id': barcode_obj.id,
                    'barcode': barcode_obj.barcode,
                    'old_tag': old_tag,
                    'new_tag': new_tag
                })
                
            except Barcode.DoesNotExist:
                errors.append(f'Barcode ID {barcode_id} not found')
            except Exception as e:
                errors.append(f'Error updating barcode {barcode_id}: {str(e)}')
        
        # Recalculate totals for all affected invoices
        if updated_invoices:
            from backend.pos.views import update_invoice_totals
            for invoice_id in updated_invoices:
                try:
                    invoice = Invoice.objects.get(pk=invoice_id)
                    update_invoice_totals(invoice)
                except Invoice.DoesNotExist:
                    pass
                except Exception as e:
                    errors.append(f'Error updating invoice {invoice_id}: {str(e)}')
    
    
    if requires_confirmation:
        return Response({
            'error': 'Confirmation required',
            'message': 'Are you sure you want to add these products back to inventory?',
            'requires_confirmation': True,
            'barcode_count': len(barcode_ids),
            'new_tag': new_tag
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Invalidate products list cache significantly changed
    from backend.core.cache_utils import invalidate_products_cache
    try:
        invalidate_products_cache()
    except Exception as e:
        # Don't fail the request if cache clearing fails
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Failed to invalidate products cache: {str(e)}")

    response_data = {
        'message': f'Updated {len(updated_barcodes)} barcode(s)',
        'updated_barcodes': updated_barcodes,
        'invoices_updated': len(updated_invoices),
        'errors': errors if errors else None
    }
    
    return Response(response_data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def data_validation_check(request):
    """Run comprehensive data validation checks"""
    try:
        results = run_comprehensive_data_check()
        return Response(results, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Data validation error: {error_trace}")
        return Response({
            'error': f'Failed to run data validation: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def defective_product_move_out(request):
    """Create defective product move-out transactions, one invoice per supplier.

    Groups all selected barcodes by their purchase supplier and creates a separate
    move-out record + invoice for each supplier. Barcodes with no linked purchase
    are grouped together under a single 'No Supplier' move-out.
    """
    from collections import defaultdict
    from backend.locations.models import Store
    from backend.pos.models import InvoiceItem

    try:
        data = request.data
        store_id = data.get('store')
        reason = data.get('reason', 'defective')
        notes = data.get('notes', '')
        product_ids = data.get('product_ids', [])
        barcode_ids = data.get('barcode_ids', [])

        if not store_id:
            return Response({'error': 'Store is required'}, status=status.HTTP_400_BAD_REQUEST)

        if not product_ids:
            return Response({'error': 'At least one product must be selected'}, status=status.HTTP_400_BAD_REQUEST)

        store = get_object_or_404(Store, pk=store_id)

        # ----------------------------------------------------------------
        # 1. Resolve supplier for every selected defective barcode in ONE
        #    flat query — no N+1, no heavy multi-join select_related.
        #    We coalesce two paths:
        #      a) barcode.purchase -> supplier  (legacy direct link)
        #      b) barcode.purchase_item -> purchase -> supplier  (normal flow)
        # ----------------------------------------------------------------
        barcode_filter = dict(tag='defective', product_id__in=product_ids)
        if barcode_ids:
            barcode_filter['id__in'] = barcode_ids

        supplier_rows = Barcode.objects.filter(**barcode_filter).values(
            'id', 'product_id',
            # path (a)
            'purchase__supplier_id',
            'purchase__supplier__name',
            # path (b)
            'purchase_item__purchase__supplier_id',
            'purchase_item__purchase__supplier__name',
            # purchase_price via purchase_item
            'purchase_item__unit_price',
        )

        # Build a quick lookup: barcode_id -> {supplier_id, supplier_name, purchase_price}
        barcode_supplier_map = {}
        for row in supplier_rows:
            sid   = row['purchase__supplier_id'] or row['purchase_item__purchase__supplier_id']
            sname = row['purchase__supplier__name'] or row['purchase_item__purchase__supplier__name'] or 'No Supplier'
            price = row['purchase_item__unit_price'] or Decimal('0.00')
            barcode_supplier_map[row['id']] = {
                'product_id':    row['product_id'],
                'supplier_id':   sid,
                'supplier_name': sname,
                'purchase_price': Decimal(str(price)),
            }

        # ----------------------------------------------------------------
        # 2. Fetch the actual Barcode model objects needed for invoice
        #    creation (only the fields we write; minimal select_related).
        # ----------------------------------------------------------------
        barcode_objs = {
            b.id: b
            for b in Barcode.objects.filter(**barcode_filter).select_related('product')
        }

        products = Product.objects.filter(id__in=product_ids).in_bulk()  # {id: product}

        items_to_create = []
        for bid, info in barcode_supplier_map.items():
            barcode = barcode_objs.get(bid)
            product = products.get(info['product_id'])
            if not barcode or not product:
                continue
            items_to_create.append({
                'product':       product,
                'barcode':       barcode,
                'purchase_price': info['purchase_price'],
                'supplier_id':   info['supplier_id'],
                'supplier_name': info['supplier_name'],
            })

        if not items_to_create:
            return Response(
                {'error': 'No defective barcodes found for the selected products'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Group items by supplier — one invoice + move-out per supplier
        items_by_supplier = defaultdict(list)
        for item in items_to_create:
            items_by_supplier[item['supplier_id']].append(item)

        created_move_outs = []

        for supplier_id, supplier_items in items_by_supplier.items():
            supplier_name = supplier_items[0]['supplier_name']
            group_total_loss = sum(item['purchase_price'] for item in supplier_items)
            group_total_items = len(supplier_items)

            # Unique move-out number
            move_out_number = f"DEF-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Unique invoice number
            invoice_number = f"DEF-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            while Invoice.objects.filter(invoice_number=invoice_number).exists():
                invoice_number = f"DEF-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Resolve/create a Customer record for supplier display so move-out
            # invoices consistently carry a linked customer.
            from backend.parties.models import Customer as PartyCustomer
            invoice_customer = None
            if supplier_name and supplier_name != 'No Supplier':
                invoice_customer = PartyCustomer.objects.filter(name__iexact=supplier_name).first()
                if not invoice_customer:
                    try:
                        invoice_customer = PartyCustomer.objects.create(name=supplier_name)
                    except Exception:
                        # Handle possible concurrent create/unique race safely.
                        invoice_customer = PartyCustomer.objects.filter(name__iexact=supplier_name).first()

            invoice = Invoice.objects.create(
                invoice_number=invoice_number,
                cart=None,
                store=store,
                customer=invoice_customer,
                invoice_type='defective',
                status='void',
                created_by=request.user
            )

            subtotal = Decimal('0.00')

            # Group items within supplier by product (to handle tracked vs non-tracked)
            items_by_product = {}
            for item_data in supplier_items:
                product = item_data['product']
                key = (product.id, product.track_inventory)
                if key not in items_by_product:
                    items_by_product[key] = {'product': product, 'barcodes': [], 'prices': []}
                items_by_product[key]['barcodes'].append(item_data['barcode'])
                items_by_product[key]['prices'].append(item_data['purchase_price'])

            for (product_id, track_inventory), product_data in items_by_product.items():
                product = product_data['product']
                barcodes = product_data['barcodes']
                prices = product_data['prices']

                if track_inventory:
                    for barcode, price in zip(barcodes, prices):
                        InvoiceItem.objects.create(
                            invoice=invoice,
                            product=product,
                            variant=None,
                            barcode=barcode,
                            sold_barcode_value=barcode.barcode or '',
                            quantity=Decimal('1.000'),
                            unit_price=price,
                            manual_unit_price=price,
                            discount_amount=Decimal('0.00'),
                            tax_amount=Decimal('0.00'),
                            line_total=price
                        )
                        subtotal += price
                        # Keep barcode as 'defective' — move-out is NOT a sale.
                        # The DefectiveProductItem link tracks which barcodes were moved out.
                else:
                    total_qty = Decimal(str(len(barcodes)))
                    unit_price = prices[0] if prices else Decimal('0.00')
                    line_total = unit_price * total_qty
                    InvoiceItem.objects.create(
                        invoice=invoice,
                        product=product,
                        variant=None,
                        barcode=None,
                        quantity=total_qty,
                        unit_price=unit_price,
                        manual_unit_price=unit_price,
                        discount_amount=Decimal('0.00'),
                        tax_amount=Decimal('0.00'),
                        line_total=line_total
                    )
                    subtotal += line_total

            invoice.subtotal = subtotal
            invoice.total = subtotal
            invoice.paid_amount = subtotal
            invoice.due_amount = Decimal('0.00')
            invoice.save()

            # Build notes with supplier label
            move_out_notes = f"[Supplier: {supplier_name}] {notes}".strip() if notes else f"Supplier: {supplier_name}"

            move_out = DefectiveProductMoveOut.objects.create(
                move_out_number=move_out_number,
                store=store,
                invoice=invoice,
                reason=reason,
                notes=move_out_notes,
                total_loss=group_total_loss,
                total_items=group_total_items,
                created_by=request.user
            )

            for item_data in supplier_items:
                DefectiveProductItem.objects.create(
                    move_out=move_out,
                    product=item_data['product'],
                    barcode=item_data['barcode'],
                    purchase_price=item_data['purchase_price']
                )

            create_audit_log(
                request=request,
                action='defective_move_out_create',
                model_name='DefectiveProductMoveOut',
                object_id=str(move_out.id),
                object_name=f"Move Out {move_out.move_out_number}",
                object_reference=move_out.move_out_number,
                barcode=None,
                changes={
                    'move_out_number': move_out.move_out_number,
                    'store': store.name,
                    'invoice': invoice.invoice_number,
                    'supplier': supplier_name,
                    'total_loss': str(group_total_loss),
                    'total_items': group_total_items,
                }
            )

            created_move_outs.append(move_out)

        serializer = DefectiveProductMoveOutSerializer(created_move_outs, many=True, context={'include_items': True})
        first = created_move_outs[0]
        return Response({
            'move_outs': serializer.data,
            'total_move_outs': len(created_move_outs),
            # Top-level fields kept for backward compatibility
            'move_out_number': first.move_out_number,
            'invoice_number': first.invoice.invoice_number if first.invoice else None,
            'invoice': first.invoice.id if first.invoice else None,
        }, status=status.HTTP_201_CREATED)

    except Exception as e:
        return Response({
            'error': f'Failed to create move-out: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def defective_product_move_out_list(request):
    """List all defective product move-outs"""
    move_outs = DefectiveProductMoveOut.objects.select_related(
        'store', 'invoice', 'invoice__customer', 'created_by'
    ).all()
    
    # Apply filters
    store_id = request.query_params.get('store', None)
    if store_id:
        move_outs = move_outs.filter(store_id=store_id)
    
    date_from = request.query_params.get('date_from', None)
    if date_from:
        move_outs = move_outs.filter(created_at__date__gte=date_from)
    
    date_to = request.query_params.get('date_to', None)
    if date_to:
        move_outs = move_outs.filter(created_at__date__lte=date_to)
    
    # Filter by brand through items -> product -> brand
    brand_id = request.query_params.get('brand', None)
    if brand_id:
        move_outs = move_outs.filter(items__product__brand_id=brand_id).distinct()
    
    # Filter by category through items -> product -> category
    category_id = request.query_params.get('category', None)
    if category_id:
        move_outs = move_outs.filter(items__product__category_id=category_id).distinct()
    
    # Filter by supplier through items -> product -> purchase_item -> purchase -> supplier
    supplier_id = request.query_params.get('supplier', None)
    if supplier_id:
        from backend.purchasing.models import PurchaseItem
        # Get product IDs that were purchased from this supplier
        supplier_product_ids = PurchaseItem.objects.filter(
            purchase__supplier_id=supplier_id,
            purchase__deleted_at__isnull=True,
        ).values_list('product_id', flat=True).distinct()
        # Filter move-outs that have items with products from this supplier
        move_outs = move_outs.filter(items__product_id__in=supplier_product_ids).distinct()

    has_adjustment = str(request.query_params.get('has_adjustment', '')).lower()
    if has_adjustment in ('1', 'true', 'yes'):
        move_outs = move_outs.filter(total_adjustment__gt=0, invoice__isnull=False)
    elif has_adjustment in ('0', 'false', 'no'):
        move_outs = move_outs.exclude(total_adjustment__gt=0)
    
    move_outs = move_outs.order_by('-created_at')
    
    serializer = DefectiveProductMoveOutSerializer(move_outs, many=True, context={'include_items': False})
    return Response(serializer.data)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def defective_product_move_out_detail(request, pk):
    """Get details of a specific move-out, update total_adjustment, or delete it.

    Deleting a move-out also deletes its items and the linked invoice (if any).
    Barcodes stay tagged defective so they can be moved out again.
    """
    if request.method == 'DELETE':
        from django.db import transaction
        with transaction.atomic():
            move_out = get_object_or_404(
                DefectiveProductMoveOut.objects.select_for_update(),
                pk=pk,
            )
            invoice = move_out.invoice
            create_audit_log(
                request=request,
                action='delete',
                model_name='DefectiveProductMoveOut',
                object_id=str(move_out.id),
                object_name=f"Move Out {move_out.move_out_number}",
                object_reference=move_out.move_out_number,
                barcode=None,
                changes={
                    'move_out_number': move_out.move_out_number,
                    'invoice_number': invoice.invoice_number if invoice else None,
                    'total_items': move_out.total_items,
                },
            )
            move_out.delete()
            if invoice is not None:
                invoice.delete()
        from backend.core.cache_signals import invalidate_products_cache_manual
        invalidate_products_cache_manual()
        return Response(status=status.HTTP_204_NO_CONTENT)

    move_out = get_object_or_404(
        DefectiveProductMoveOut.objects.select_related(
            'store', 'invoice', 'invoice__customer', 'created_by'
        ).prefetch_related(
            Prefetch('items', queryset=DefectiveProductItem.objects.select_related('product', 'barcode')),
        ),
        pk=pk,
    )
    
    if request.method == 'PATCH':
        update_fields = []
        total_adjustment = request.data.get('total_adjustment')
        if total_adjustment is not None:
            try:
                move_out.total_adjustment = Decimal(str(total_adjustment))
                update_fields.append('total_adjustment')
            except (ValueError, InvalidOperation):
                return Response({
                    'error': 'Invalid total_adjustment value'
                }, status=status.HTTP_400_BAD_REQUEST)

        if 'notes' in request.data:
            notes = request.data.get('notes')
            move_out.notes = '' if notes is None else str(notes)
            update_fields.append('notes')

        if 'sent_date' in request.data:
            raw_sent = request.data.get('sent_date')
            if raw_sent in (None, ''):
                move_out.sent_date = None
                update_fields.append('sent_date')
            else:
                from datetime import datetime
                try:
                    move_out.sent_date = datetime.strptime(str(raw_sent)[:10], '%Y-%m-%d').date()
                    update_fields.append('sent_date')
                except ValueError:
                    return Response({
                        'error': 'Invalid sent_date. Use YYYY-MM-DD.'
                    }, status=status.HTTP_400_BAD_REQUEST)

        if update_fields:
            move_out.save(update_fields=update_fields)
        
        serializer = DefectiveProductMoveOutSerializer(move_out, context={'include_items': True})
        return Response(serializer.data)
    
    # GET request
    serializer = DefectiveProductMoveOutSerializer(move_out, context={'include_items': True})
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def defective_product_move_out_add_items(request, pk):
    """Add barcode items to an existing defective move-out.

    Expects: { barcode_ids: [...], product_ids: [...] }
    Each barcode must be tag='defective' and not already in any move-out.
    Updates the linked invoice with new InvoiceItem rows and recalculates totals.
    """
    from backend.pos.models import InvoiceItem
    from django.db import transaction

    move_out = get_object_or_404(
        DefectiveProductMoveOut.objects.select_related('store', 'invoice'),
        pk=pk,
    )

    barcode_ids = request.data.get('barcode_ids', [])
    product_ids = request.data.get('product_ids', [])

    if not barcode_ids:
        return Response({'error': 'No barcodes provided'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        with transaction.atomic():
            # Lock the move-out to prevent concurrent modifications
            move_out = DefectiveProductMoveOut.objects.select_for_update().get(pk=move_out.pk)

            # Resolve barcodes
            barcodes = Barcode.objects.filter(
                id__in=barcode_ids,
                tag='defective',
                product_id__in=product_ids,
            ).select_related('product', 'purchase', 'purchase__supplier',
                             'purchase_item', 'purchase_item__purchase')

            if not barcodes.exists():
                return Response({'error': 'No valid defective barcodes found'}, status=status.HTTP_400_BAD_REQUEST)

            # Exclude barcodes already in ANY move-out
            already_moved = set(
                DefectiveProductItem.objects.filter(
                    barcode_id__in=barcode_ids,
                ).values_list('barcode_id', flat=True)
            )

            new_barcodes = [b for b in barcodes if b.id not in already_moved]
            if not new_barcodes:
                return Response({'error': 'All selected barcodes are already in a move-out'},
                                status=status.HTTP_400_BAD_REQUEST)

            added_loss = Decimal('0.00')
            invoice = move_out.invoice

            for barcode in new_barcodes:
                # Determine purchase price
                price = Decimal('0.00')
                if barcode.purchase_item:
                    price = barcode.purchase_item.unit_price or Decimal('0.00')

                # Create DefectiveProductItem
                DefectiveProductItem.objects.create(
                    move_out=move_out,
                    product=barcode.product,
                    barcode=barcode,
                    purchase_price=price,
                )

                # Add InvoiceItem if invoice exists
                if invoice and barcode.product.track_inventory:
                    InvoiceItem.objects.create(
                        invoice=invoice,
                        product=barcode.product,
                        variant=None,
                        barcode=barcode,
                        sold_barcode_value=barcode.barcode or '',
                        quantity=Decimal('1.000'),
                        unit_price=price,
                        manual_unit_price=price,
                        discount_amount=Decimal('0.00'),
                        tax_amount=Decimal('0.00'),
                        line_total=price,
                    )

                added_loss += price

            # Update move-out totals
            move_out.total_loss = move_out.total_loss + added_loss
            move_out.total_items = move_out.total_items + len(new_barcodes)
            move_out.save(update_fields=['total_loss', 'total_items'])

            # Update invoice totals
            if invoice:
                invoice.subtotal = invoice.subtotal + added_loss
                invoice.total = invoice.total + added_loss
                invoice.paid_amount = invoice.total
                invoice.due_amount = Decimal('0.00')
                invoice.save(update_fields=['subtotal', 'total', 'paid_amount', 'due_amount'])

            create_audit_log(
                request=request,
                action='defective_move_out_add_items',
                model_name='DefectiveProductMoveOut',
                object_id=str(move_out.id),
                object_name=f"Move Out {move_out.move_out_number}",
                object_reference=move_out.move_out_number,
                barcode=None,
                changes={
                    'added_barcodes': len(new_barcodes),
                    'added_loss': str(added_loss),
                    'new_total_items': move_out.total_items,
                    'new_total_loss': str(move_out.total_loss),
                }
            )

        # Re-fetch for serialization
        move_out.refresh_from_db()
        serializer = DefectiveProductMoveOutSerializer(move_out, context={'include_items': True})
        return Response({
            'move_out': serializer.data,
            'added_items': len(new_barcodes),
            'skipped_already_moved': len(already_moved & set(barcode_ids)),
        }, status=status.HTTP_200_OK)

    except Exception as e:
        return Response(
            {'error': f'Failed to add items to move-out: {str(e)}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
