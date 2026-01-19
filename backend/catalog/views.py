from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, Count
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
            annotated_barcode_count=Count('barcodes', filter=Q(barcodes__tag__in=['new', 'returned']) & ~Q(barcodes__purchase__status='draft'))
        ).all()
        
        # Use django-filter for filtering
        filterset = ProductFilter(request.query_params, queryset=queryset)
        queryset = filterset.qs
        
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

        context = {
            'request': request,
            'active_cart_barcodes': active_cart_barcodes,
            'active_cart_product_quantities': active_cart_product_quantities
        }
        
        paginator = Paginator(queryset, limit)
        page_obj = paginator.get_page(page)
        
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
        
        serializer = ProductSerializer(product)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def product_detail(request, pk):
    """Retrieve, update or delete a product"""
    product = get_object_or_404(Product, pk=pk)
    
    if request.method == 'GET':
        # Try cache first
        from backend.core.model_cache import get_cached_product, cache_product_data
        cached_data = get_cached_product(pk)
        if cached_data:
            return Response(cached_data)
        
        # Cache miss - fetch from database
        serializer = ProductSerializer(product)
        response_data = serializer.data
        
        # Cache the result
        cache_product_data(product)
        
        return Response(response_data)
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
            changes={'name': product_name, 'sku': product_sku}
        )
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


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def product_barcodes(request, pk):
    """Get or create barcodes for a product"""
    product = get_object_or_404(Product, pk=pk)
    
    if request.method == 'GET':
        # Get tag filter from query params
        tag_filter = request.query_params.get('tag', None)
        
        if tag_filter:
            # Filter by specific tag
            valid_tags = [choice[0] for choice in Barcode.TAG_CHOICES]
            if tag_filter in valid_tags:
                barcodes = product.barcodes.filter(tag=tag_filter)
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
                # Check if barcode with this SKU already exists
                existing = Barcode.objects.filter(barcode=product.sku).first()
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def product_generate_labels(request, pk):
    """Batch generate labels for all barcodes of a product - OPTIMIZED for shared hosting
    
    Uses sequential processing (no threading) for maximum compatibility with shared hosting.
    All optimizations (prefetching, bulk queries, faster compression) still apply.
    Always uses Azure Function for label generation (with automatic fallback to local if Azure fails).
    
    Request body (optional):
        purchase_id: Filter barcodes by purchase ID
    """
    product = get_object_or_404(Product, pk=pk)
    
    # Get purchase_id from request body if provided
    purchase_id = request.data.get('purchase_id', None)
    
    # Filter barcodes by product and optionally by purchase
    # OPTIMIZATION: Prefetch all related data upfront to avoid N+1 queries
    barcodes_query = product.barcodes.select_related('purchase', 'purchase__supplier').all()
    if purchase_id:
        try:
            purchase_id_int = int(purchase_id)
            barcodes_query = barcodes_query.filter(purchase_id=purchase_id_int)
        except (ValueError, TypeError):
            pass  # Invalid purchase_id, ignore filter
    
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
                    'barcode_value': data['barcode_value'],
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
                    'barcode_value': item['barcode_value'],
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
                    label_obj = item['label_obj']
                    label_obj.label_image = blob_url
                    if item['created']:
                        label_obj.save()
                    else:
                        label_obj.save(update_fields=['label_image'])
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
                    image_data_url = generate_label_image(
                        product_name=item['product_name'],
                        barcode_value=data['barcode_value'],
                        sku=data['barcode_value'],
                        vendor_name=data['vendor_name'],
                        purchase_date=data['purchase_date'],
                        serial_number=data['serial_number']
                    )
                    label_obj = item['label_obj']
                    label_obj.label_image = image_data_url
                    if item['created']:
                        label_obj.save()
                    else:
                        label_obj.save(update_fields=['label_image'])
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
                    image_data_url = generate_label_image(
                        product_name=item['product_name'],
                        barcode_value=data['barcode_value'],
                        sku=data['barcode_value'],
                        vendor_name=data['vendor_name'],
                        purchase_date=data['purchase_date'],
                        serial_number=data['serial_number']
                    )
                    label_obj = item['label_obj']
                    label_obj.label_image = image_data_url
                    if item['created']:
                        label_obj.save()
                    else:
                        label_obj.save(update_fields=['label_image'])
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
@permission_classes([IsAuthenticated])
def product_get_labels(request, pk):
    """Get existing labels for a product (without generating new ones)
    
    Query parameters:
        purchase_id: Optional. Filter barcodes by purchase ID
    """
    product = get_object_or_404(Product, pk=pk)
    
    # Get purchase_id from query parameters if provided
    purchase_id = request.query_params.get('purchase_id', None)
    
    # Filter barcodes by product and optionally by purchase
    barcodes_query = product.barcodes.all()
    if purchase_id:
        try:
            purchase_id_int = int(purchase_id)
            barcodes_query = barcodes_query.filter(purchase_id=purchase_id_int)
        except (ValueError, TypeError):
            pass  # Invalid purchase_id, ignore filter
    
    barcodes = barcodes_query
    
    # Get all existing labels for these barcodes
    # Valid labels can be: base64 data URL (data:image/...) or blob URL (https://...)
    labels = BarcodeLabel.objects.filter(
        barcode__in=barcodes
    ).exclude(
        label_image=''
    ).exclude(
        label_image__isnull=True
    ).filter(
        Q(label_image__startswith='data:image') | Q(label_image__startswith='https://')
    ).select_related('barcode')
    
    labels_list = []
    for label in labels:
        labels_list.append({
            'barcode_id': label.barcode.id,
            'barcode': label.barcode.barcode,
            'image': label.label_image,
            'newly_generated': False  # These are existing labels
        })
    
    return Response({
        'product_id': product.id,
        'product_name': product.name,
        'total_labels': len(labels_list),
        'labels': labels_list,
        'purchase_id': purchase_id
    }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def product_labels_status(request, pk):
    """Check if labels are already generated for a product
    
    Query parameters:
        purchase_id: Optional. Filter barcodes by purchase ID
    """
    product = get_object_or_404(Product, pk=pk)
    
    # Get purchase_id from query parameters if provided
    purchase_id = request.query_params.get('purchase_id', None)
    
    # Filter barcodes by product and optionally by purchase
    barcodes_query = product.barcodes.all()
    if purchase_id:
        try:
            purchase_id_int = int(purchase_id)
            barcodes_query = barcodes_query.filter(purchase_id=purchase_id_int)
        except (ValueError, TypeError):
            pass  # Invalid purchase_id, ignore filter
    
    barcodes = barcodes_query
    
    total_barcodes = barcodes.count()
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
    
    return Response({
        'product_id': product.id,
        'total_barcodes': total_barcodes,
        'generated_labels': generated_count,
        'all_generated': generated_count == total_barcodes and total_barcodes > 0,
        'needs_generation': generated_count < total_barcodes,
        'purchase_id': purchase_id
    }, status=status.HTTP_200_OK)


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
        # Still need to get invoice number
        from backend.pos.models import InvoiceItem
        sold_item = InvoiceItem.objects.filter(
            barcode=barcode_obj
        ).exclude(
            invoice__status='void'
        ).select_related('invoice').only('invoice__invoice_number').first()
        if sold_item:
            return True, sold_item.invoice.invoice_number
        return True, None
    
    # Check if assigned to a non-void invoice
    from backend.pos.models import InvoiceItem
    sold_item = InvoiceItem.objects.filter(
        barcode=barcode_obj
    ).exclude(
        invoice__status='void'
    ).select_related('invoice').only('invoice__invoice_number').first()
    
    if sold_item:
        return True, sold_item.invoice.invoice_number
    
    return False, None


# Helper function to build response for barcode lookup
def build_barcode_response(barcode_obj, product, logger, match_type='exact'):
    """Build standardized response for barcode lookup"""
    is_sold, sold_invoice = check_barcode_sold_status(barcode_obj)
    
    logger.info(f"Found product by barcode ({match_type}): {product.name} (Barcode: {barcode_obj.barcode}, Tag: {barcode_obj.tag})")
    serializer = ProductSerializer(product)
    response_data = serializer.data
    
    # Include the matched barcode and availability status
    # Prefer short_code if available (it's what users search for), otherwise use full barcode
    response_data['matched_barcode'] = barcode_obj.short_code or barcode_obj.barcode
    response_data['barcode_tag'] = barcode_obj.tag
    response_data['barcode_available'] = barcode_obj.tag in ['new', 'returned']
    
    # Get status message based on tag
    status_message, barcode_status = get_barcode_status_message(barcode_obj, sold_invoice)
    response_data['barcode_status'] = barcode_status
    response_data['barcode_status_message'] = status_message
    
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
        
        # Clean the barcode (trim whitespace, handle URL encoding, normalize)
        barcode_clean = unquote(str(barcode)).strip()
        
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
        
        # Check cache first (5 minute TTL for barcode lookups)
        cache_key = f'barcode_lookup:{barcode_clean}'
        cached_response = cache.get(cache_key)
        if cached_response:
            logger.debug(f"Cache hit for barcode: '{barcode_clean}'")
            response = Response(cached_response)
            # Add cache headers for browser-level caching (1 minute for barcode lookups)
            response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
            return response
        
        # Use centralized barcode search function from filters.py
        # This handles all flexible matching: normalized, prefix, exact, case-insensitive, contains
        # All barcode search logic is now centralized in filters.py for consistency
        # The function now uses cache internally for fast lookups
        barcode_obj = find_barcode_by_search_value(barcode_clean, logger)
        if barcode_obj:
            product = barcode_obj.product or (barcode_obj.variant.product if barcode_obj.variant else None)
            if product and product.is_active:
                logger.info(f"Found barcode match: '{barcode_clean}' -> '{barcode_obj.short_code or barcode_obj.barcode}'")
                response_data = build_barcode_response(barcode_obj, product, logger, 'flexible_match')
                # Cache the API response for 5 minutes (separate from barcode data cache)
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
        
        # Check if we should only search barcodes (skip SKU fallback)
        # This is important for POS scanning where we only want actual barcodes, not product SKUs
        barcode_only = request.query_params.get('barcode_only', 'false').lower() == 'true'
        
        # Strategy 3: Try exact match on Product SKU (fallback) - only if barcode_only is False
        if not barcode_only:
            # Try cache first
            from backend.core.model_cache import get_cached_product_by_sku, cache_product_data
            cached_product = get_cached_product_by_sku(barcode_clean)
            
            if cached_product:
                # Get full product object for serializer
                product = Product.objects.filter(
                    id=cached_product['id'],
                    is_active=True
                ).select_related('category', 'brand').first()
            else:
                # Cache miss - fetch from database
                product = Product.objects.filter(
                    sku=barcode_clean,
                    is_active=True
                ).exclude(sku__isnull=True).exclude(sku='').select_related('category', 'brand').first()
                
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
                
                # Check if product has a barcode with matching SKU and get its tag status
                product_barcode = product.barcodes.filter(barcode=barcode_clean).first()
                if product_barcode:
                    is_sold, sold_invoice = check_barcode_sold_status(product_barcode)
                    response_data['matched_barcode'] = product_barcode.barcode
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
            
            if cached_product:
                product = Product.objects.filter(
                    id=cached_product['id'],
                    is_active=True
                ).select_related('category', 'brand').first()
            else:
                # Cache miss - fetch from database
                product = Product.objects.filter(
                    sku__iexact=barcode_clean,
                    is_active=True
                ).exclude(sku__isnull=True).exclude(sku='').select_related('category', 'brand').first()
                
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
                
                # Check if product has a barcode with matching SKU and get its tag status
                product_barcode = product.barcodes.filter(barcode__iexact=barcode_clean).first()
                if product_barcode:
                    is_sold, sold_invoice = check_barcode_sold_status(product_barcode)
                    response_data['matched_barcode'] = product_barcode.barcode
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
        
                
                # Cache the response for 5 minutes
                cache.set(cache_key, response_data, 300)
                response = Response(response_data)
                response['Cache-Control'] = 'private, max-age=60, stale-while-revalidate=300'
                return response
        
        # Strategy 6: Removed barcode contains match - barcodes must be exact matches only
        # Barcode searches should always use exact matching via find_barcode_by_search_value()
        
        # Strategy 7: Try product name search as fallback (only if no barcode/SKU match found)
        # This allows users to search by product name if barcode/SKU doesn't match
        product = Product.objects.filter(
            name__icontains=barcode_clean,
            is_active=True
        ).first()
        
        if product:
            logger.info(f"Found product by name (fallback): {product.name}")
            serializer = ProductSerializer(product)
            response_data = serializer.data
            
            # Even though this is a name search fallback, check if the searched value exists as a barcode
            # If it does, include it so frontend can use the specific barcode
            searched_barcode_obj = Barcode.objects.filter(barcode=barcode_clean).first()
            if searched_barcode_obj and searched_barcode_obj.product_id == product.id:
                # The searched value is actually a barcode for this product
                from backend.pos.models import InvoiceItem
                sold_invoice = None
                if searched_barcode_obj.tag == 'sold':
                    sold_item = InvoiceItem.objects.filter(
                        barcode=searched_barcode_obj
                    ).exclude(
                        invoice__status='void'
                    ).select_related('invoice').first()
                    if sold_item:
                        sold_invoice = sold_item.invoice.invoice_number
                
                response_data['matched_barcode'] = searched_barcode_obj.barcode
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
    
    # Validate tag transitions
    # Only allow: 'unknown' -> 'returned'/'defective'
    # Only allow: 'returned'/'defective' -> 'new' (with confirmation)
    # Prevent: 'sold' -> any other tag (except through replacement which is handled separately)
    # Prevent: 'new' -> 'returned'/'defective' (must go through sold -> unknown first)
    
    if old_tag == 'sold' and new_tag != 'unknown':
        return Response({
            'error': 'Cannot change tag from "sold" directly. Use replacement process instead.'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if old_tag == 'new' and new_tag in ['returned', 'defective']:
        return Response({
            'error': 'Cannot change tag from "new" to "returned" or "defective". Product must be sold first.'
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
                if old_tag == 'sold' and new_tag != 'unknown':
                    errors.append(f'Barcode {barcode_obj.barcode}: Cannot change from "sold" directly')
                    continue
                
                if old_tag == 'new' and new_tag in ['returned', 'defective']:
                    errors.append(f'Barcode {barcode_obj.barcode}: Cannot change from "new" to "{new_tag}"')
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
    """Create a defective product move-out transaction with invoice"""
    from backend.locations.models import Store
    from backend.pos.models import Cart
    
    try:
        data = request.data
        store_id = data.get('store')
        reason = data.get('reason', 'defective')
        notes = data.get('notes', '')
        product_ids = data.get('product_ids', [])  # List of product IDs
        barcode_ids = data.get('barcode_ids', [])  # Optional: specific barcode IDs to move out
        
        if not store_id:
            return Response({'error': 'Store is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not product_ids:
            return Response({'error': 'At least one product must be selected'}, status=status.HTTP_400_BAD_REQUEST)
        
        store = get_object_or_404(Store, pk=store_id)
        
        # Generate move-out number
        move_out_number = f"DEF-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        
        # Get selected products and their defective barcodes
        products = Product.objects.filter(id__in=product_ids)
        total_loss = Decimal('0.00')
        total_items = 0
        items_to_create = []
        
        # Process each product to collect barcodes and calculate totals
        for product in products:
            # Get defective barcodes for this product
            if barcode_ids:
                # If specific barcodes provided, use those
                barcodes = Barcode.objects.filter(
                    id__in=barcode_ids,
                    product=product,
                    tag='defective'
                )
            else:
                # Get all defective barcodes for this product
                barcodes = Barcode.objects.filter(
                    product=product,
                    tag='defective'
                )
            
            # Track items for move-out record
            for barcode in barcodes:
                price = barcode.get_purchase_price()
                items_to_create.append({
                    'product': product,
                    'barcode': barcode,
                    'purchase_price': price
                })
                total_loss += price
                total_items += 1
        
        # Create invoice directly (no cart needed)
        invoice_number = f"DEF-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        # Ensure invoice number uniqueness
        while Invoice.objects.filter(invoice_number=invoice_number).exists():
            invoice_number = f"DEF-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        
        invoice = Invoice.objects.create(
            invoice_number=invoice_number,
            cart=None,  # No cart needed for move-out
            store=store,
            invoice_type='defective',  # Mark as defective invoice type
            status='void', 
            created_by=request.user
        )
        
        # Create invoice items directly and mark barcodes as sold
        # For tracked products, create one invoice item per barcode (each with quantity 1)
        # For non-tracked products, group by product and create one invoice item per product
        subtotal = Decimal('0.00')
        from backend.pos.models import InvoiceItem
        
        # Group items by product and track_inventory status
        items_by_product = {}
        for item_data in items_to_create:
            product = item_data['product']
            key = (product.id, product.track_inventory)
            if key not in items_by_product:
                items_by_product[key] = {
                    'product': product,
                    'barcodes': [],
                    'prices': []
                }
            items_by_product[key]['barcodes'].append(item_data['barcode'])
            items_by_product[key]['prices'].append(item_data['purchase_price'])
        
        # Create invoice items
        for (product_id, track_inventory), product_data in items_by_product.items():
            product = product_data['product']
            barcodes = product_data['barcodes']
            prices = product_data['prices']
            
            if track_inventory:
                # For tracked products, create one invoice item per barcode
                for barcode, price in zip(barcodes, prices):
                    invoice_item = InvoiceItem.objects.create(
                        invoice=invoice,
                        product=product,
                        variant=None,  # Move-out doesn't track variants
                        barcode=barcode,
                        quantity=Decimal('1.000'),  # Each barcode is quantity 1
                        unit_price=price,
                        manual_unit_price=price,
                        discount_amount=Decimal('0.00'),
                        tax_amount=Decimal('0.00'),
                        line_total=price
                    )
                    subtotal += price
                    
                    # Mark barcode as sold (they're being moved out)
                    barcode.tag = 'sold'
                    barcode.save(update_fields=['tag'])
            else:
                # For non-tracked products, create one invoice item with total quantity
                total_qty = Decimal(str(len(barcodes)))
                # Use average price or first price (all should be same for same product)
                unit_price = prices[0] if prices else Decimal('0.00')
                line_total = unit_price * total_qty
                
                invoice_item = InvoiceItem.objects.create(
                    invoice=invoice,
                    product=product,
                    variant=None,
                    barcode=None,  # Non-tracked products don't have individual barcodes
                    quantity=total_qty,
                    unit_price=unit_price,
                    manual_unit_price=unit_price,
                    discount_amount=Decimal('0.00'),
                    tax_amount=Decimal('0.00'),
                    line_total=line_total
                )
                subtotal += line_total
        
        # Update invoice totals
        invoice.subtotal = subtotal
        invoice.total = subtotal
        invoice.paid_amount = subtotal
        invoice.due_amount = Decimal('0.00')
        invoice.save()
        
        # Create move-out record
        move_out = DefectiveProductMoveOut.objects.create(
            move_out_number=move_out_number,
            store=store,
            invoice=invoice,
            reason=reason,
            notes=notes,
            total_loss=total_loss,
            total_items=total_items,
            created_by=request.user
        )
        
        # Create move-out items
        for item_data in items_to_create:
            DefectiveProductItem.objects.create(
                move_out=move_out,
                product=item_data['product'],
                barcode=item_data['barcode'],
                purchase_price=item_data['purchase_price']
            )
        
        # Audit log
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
                'total_loss': str(total_loss),
                'total_items': total_items,
            }
        )
        
        serializer = DefectiveProductMoveOutSerializer(move_out)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        return Response({
            'error': f'Failed to create move-out: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def defective_product_move_out_list(request):
    """List all defective product move-outs"""
    move_outs = DefectiveProductMoveOut.objects.select_related('store', 'invoice', 'created_by').prefetch_related('items').all()
    
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
            purchase__supplier_id=supplier_id
        ).values_list('product_id', flat=True).distinct()
        # Filter move-outs that have items with products from this supplier
        move_outs = move_outs.filter(items__product_id__in=supplier_product_ids).distinct()
    
    move_outs = move_outs.order_by('-created_at')
    
    serializer = DefectiveProductMoveOutSerializer(move_outs, many=True)
    return Response(serializer.data)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def defective_product_move_out_detail(request, pk):
    """Get details of a specific move-out or update total_adjustment"""
    move_out = get_object_or_404(DefectiveProductMoveOut.objects.select_related('store', 'invoice', 'created_by').prefetch_related('items'), pk=pk)
    
    if request.method == 'PATCH':
        # Only allow updating total_adjustment
        total_adjustment = request.data.get('total_adjustment')
        if total_adjustment is not None:
            try:
                move_out.total_adjustment = Decimal(str(total_adjustment))
                move_out.save(update_fields=['total_adjustment'])
            except (ValueError, InvalidOperation):
                return Response({
                    'error': 'Invalid total_adjustment value'
                }, status=status.HTTP_400_BAD_REQUEST)
        
        serializer = DefectiveProductMoveOutSerializer(move_out)
        return Response(serializer.data)
    
    # GET request
    serializer = DefectiveProductMoveOutSerializer(move_out)
    return Response(serializer.data)
