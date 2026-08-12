import django_filters
import re
from django.db.models import Q, Count, Exists, OuterRef
from .models import Product, Barcode
from .barcode_resolution import clean_scanned_barcode
from backend.pos.models import InvoiceItem, CartItem
from backend.purchasing.models import PurchaseItem


def normalize_barcode_for_search(barcode_str: str) -> str:
    """
    Normalize barcode for flexible matching:
    - Remove hyphens, spaces, underscores
    - Remove leading zeros from numeric parts
    - Convert to uppercase
    
    Examples (old format):
    - "OPPO-0005" -> "OPPO5"
    - "FRAM-0004-33" -> "FRAM433"
    - "FRAM-0003-23-1" -> "FRAM3231"
    - "OPPO 0005" -> "OPPO5" (spaces supported)
    - "FRAM 0004 33" -> "FRAM433" (spaces supported)
    - "FRAM0003231" -> "FRAM3231"
    - "FRAM 0003 23 1" -> "FRAM3231" (spaces supported)
    
    Examples (new category-based format):
    - "HOU-56789" -> "HOU56789"
    - "HOU-0001" -> "HOU1" (leading zeros removed)
    - "HOU 56789" -> "HOU56789" (spaces supported)
    - "HOU56789" -> "HOU56789" (no separator)
    - "FRA-10000" -> "FRA10000" (5-digit numbers)
    """
    if not barcode_str:
        return ''
    
    # Remove hyphens, spaces, underscores - all separators are treated the same
    normalized = barcode_str.replace('-', '').replace(' ', '').replace('_', '').upper()
    
    # Remove leading zeros from numeric parts
    # Split into alphanumeric parts and process each
    parts = re.split(r'([A-Z]+)', normalized)
    result_parts = []
    
    for part in parts:
        if not part:
            continue
        if part.isdigit():
            # Remove leading zeros by converting to int and back to string
            result_parts.append(str(int(part)) if part else '')
        else:
            result_parts.append(part)
    
    return ''.join(result_parts)


def find_barcode_by_search_value(search_value: str, logger=None, skip_cache=False):
    """
    Find a Barcode by search value. EXACT match only — no .first(), no prefix/icontains/iexact.
    Priority: cache by id (unless skip_cache=True), then exact short_code (get), then exact barcode (get).
    Returns Barcode or None.
    skip_cache: if True, do not read from or write to barcode cache (use for invoice add to avoid stale matches).
    """
    if not search_value or not search_value.strip():
        return None
    
    barcode_clean = clean_scanned_barcode(search_value)
    
    # Cache: exact id lookup (use get, not first) — skip when skip_cache=True (e.g. invoice creation)
    if not skip_cache:
        try:
            from .barcode_cache import get_cached_barcode, get_cached_barcode_by_short_code

            cached_data = get_cached_barcode(barcode_clean)
            if cached_data:
                try:
                    barcode_obj = Barcode.objects.select_related(
                        'product', 'product__category', 'product__brand'
                    ).get(id=cached_data['id'])
                    if barcode_obj.product and barcode_obj.product.is_active:
                        if logger:
                            logger.debug(f"Cache hit for barcode: '{barcode_clean}' -> ID: {barcode_obj.id}")
                        return barcode_obj
                except Barcode.DoesNotExist:
                    pass

            cached_data = get_cached_barcode_by_short_code(barcode_clean)
            if cached_data:
                try:
                    barcode_obj = Barcode.objects.select_related(
                        'product', 'product__category', 'product__brand'
                    ).get(id=cached_data['id'])
                    if barcode_obj.product and barcode_obj.product.is_active:
                        if logger:
                            logger.debug(f"Cache hit for short_code: '{barcode_clean}' -> ID: {barcode_obj.id}")
                        return barcode_obj
                except Barcode.DoesNotExist:
                    pass
        except Exception as e:
            if logger:
                logger.warning(f"Cache lookup failed for '{barcode_clean}': {str(e)}")

    # EXACT match only: short_code then barcode. Use get(), never first().
    try:
        barcode_obj = Barcode.objects.filter(short_code=barcode_clean).select_related(
            'product', 'product__category', 'product__brand'
        ).get()
        if barcode_obj.product and barcode_obj.product.is_active:
            if not skip_cache:
                try:
                    from .barcode_cache import cache_barcode_data
                    cache_barcode_data(barcode_obj)
                except Exception:
                    pass
            return barcode_obj
    except (Barcode.DoesNotExist, Barcode.MultipleObjectsReturned):
        pass

    try:
        barcode_obj = Barcode.objects.filter(barcode=barcode_clean).select_related(
            'product', 'product__category', 'product__brand'
        ).get()
        if barcode_obj.product and barcode_obj.product.is_active:
            if not skip_cache:
                try:
                    from .barcode_cache import cache_barcode_data
                    cache_barcode_data(barcode_obj)
                except Exception:
                    pass
            return barcode_obj
    except (Barcode.DoesNotExist, Barcode.MultipleObjectsReturned):
        pass

    return None


class ProductFilter(django_filters.FilterSet):
    """Advanced filter for Product model using django-filter"""
    
    # Basic search - searches across name, SKU, description, brand, category
    search = django_filters.CharFilter(method='filter_search', label='Search')
    
    # Direct field filters
    category = django_filters.NumberFilter(field_name='category_id', lookup_expr='exact')
    brand = django_filters.NumberFilter(field_name='brand_id', lookup_expr='exact')
    active = django_filters.CharFilter(method='filter_active', label='Active')
    barcode = django_filters.CharFilter(method='filter_barcode', label='Barcode')
    
    # Supplier filter (through purchase items)
    supplier = django_filters.NumberFilter(method='filter_supplier', label='Supplier ID')
    
    # Stock status filters
    in_stock = django_filters.CharFilter(method='filter_in_stock', label='In Stock')
    low_stock = django_filters.CharFilter(method='filter_low_stock', label='Low Stock')
    out_of_stock = django_filters.CharFilter(method='filter_out_of_stock', label='Out of Stock')
    
    # Barcode tag filter
    tag = django_filters.CharFilter(method='filter_tag', label='Barcode Tag')
    
    class Meta:
        model = Product
        fields = ['search', 'category', 'brand', 'supplier', 'active', 'barcode', 
                  'in_stock', 'low_stock', 'out_of_stock', 'tag']
    
    def filter_search(self, queryset, name, value):
        """Advanced search across multiple fields
        
        Supports two modes via 'search_mode' query parameter:
        - 'name_only': Search only in product names
        - 'all' (default): Search in names, SKUs, descriptions, brands, categories, and barcodes
        
        For multi-word searches, matches products where:
        1. The full search string appears as a substring (e.g., "FRAME A33" in "FRAME OPPO A33")
        2. All words appear anywhere in the name (in any order)
        3. Words can be part of larger words (e.g., "A33" matches "OPPO A33")
        """
        if not value:
            return queryset
        
        search = value.strip().upper()
        if not search:
            return queryset
        
        # Get search mode from request data (passed via query params)
        # Access the request data from the filter's data attribute
        request_data = getattr(self, 'data', {})
        if isinstance(request_data, dict):
            search_mode = request_data.get('search_mode', 'all')
        else:
            # If data is a QueryDict (from Django request), use get method
            search_mode = request_data.get('search_mode', ['all'])[0] if hasattr(request_data, 'get') else 'all'
        
        if search_mode == 'name_only':
            # Search only in product names - TOP PRIORITY
            # For multi-word searches, match products where ALL words appear in the name
            # Words can be anywhere in the name, in any order, and can be part of larger words
            
            search_words = [w.strip() for w in search.split() if w.strip()]
            
            if not search_words:
                return queryset
            
            if len(search_words) > 1:
                # Multi-word search: "FRAME A33" should match "FRAME OPPO A33 OLD BLACK"
                # Build a query where the name contains ALL search words
                # Start with first word, then AND with each subsequent word
                combined_query = Q(name__icontains=search_words[0])
                for word in search_words[1:]:
                    if word:  # Skip empty words
                        combined_query = combined_query & Q(name__icontains=word)
                
                queryset = queryset.filter(combined_query).distinct()
            else:
                # Single word search
                queryset = queryset.filter(Q(name__icontains=search_words[0])).distinct()
        else:
            # Search across all fields (default behavior)
            # Always search product names, SKUs, descriptions, brands, and categories
            # For barcodes: use exact matching (normalized to upper)
            # For short_code: can use icontains for flexible matching
            barcode_matches = Barcode.objects.filter(
                Q(barcode=search) |  # Exact match for barcode (normalized)
                Q(short_code=search) | Q(short_code__iexact=search) | Q(short_code__icontains=search),
                tag__in=['new', 'returned']
            ).values_list('product_id', flat=True).distinct()
            
            # Check for exact SKU matches
            exact_sku_product_ids = Product.objects.filter(
                sku=search,
                is_active=True
            ).exclude(sku__isnull=True).exclude(sku='').values_list('id', flat=True)
            
            # Handle multi-word search
            # Priority: 1) Name, 2) Brand/Category, 3) SKU/Description/Barcode
            search_words = [w.strip() for w in search.split() if w.strip()]
            
            if not search_words:
                return queryset
                
            if len(search_words) > 1:
                # Multi-word search - check if any word matches a category or brand
                from .models import Category, Brand
                
                # Check for category matches (exact and partial - case-insensitive)
                # First try exact matches
                category_q_exact = Q()
                for word in search_words:
                    category_q_exact = category_q_exact | Q(name__iexact=word)
                matching_categories_exact = Category.objects.filter(category_q_exact)
                
                # Also check for partial matches (word is a prefix/substring of category name)
                # Only for words that are at least 3 characters (to avoid too many false matches)
                category_q_partial = Q()
                for word in search_words:
                    if len(word) >= 3:
                        category_q_partial = category_q_partial | Q(name__icontains=word)
                matching_categories_partial = Category.objects.filter(category_q_partial).exclude(
                    id__in=matching_categories_exact.values_list('id', flat=True)
                )
                
                # Combine exact and partial matches
                matching_categories = matching_categories_exact | matching_categories_partial
                matching_category_ids = matching_categories.values_list('id', flat=True)
                
                # Check for brand matches (exact and partial - case-insensitive)
                brand_q_exact = Q()
                for word in search_words:
                    brand_q_exact = brand_q_exact | Q(name__iexact=word)
                matching_brands_exact = Brand.objects.filter(brand_q_exact)
                
                # Also check for partial matches
                brand_q_partial = Q()
                for word in search_words:
                    if len(word) >= 3:
                        brand_q_partial = brand_q_partial | Q(name__icontains=word)
                matching_brands_partial = Brand.objects.filter(brand_q_partial).exclude(
                    id__in=matching_brands_exact.values_list('id', flat=True)
                )
                
                # Combine exact and partial matches
                matching_brands = matching_brands_exact | matching_brands_partial
                matching_brand_ids = matching_brands.values_list('id', flat=True)
                
                # Find which words matched categories/brands (exact or partial)
                category_words = set()
                brand_words = set()
                
                if matching_category_ids:
                    categories = Category.objects.filter(id__in=matching_category_ids)
                    for cat in categories:
                        cat_name_upper = cat.name.upper()
                        for word in search_words:
                            word_upper = word.upper()
                            # Exact match
                            if word_upper == cat_name_upper:
                                category_words.add(word)
                            # Partial match (word is substring of category name, at least 3 chars)
                            elif len(word) >= 3 and word_upper in cat_name_upper:
                                category_words.add(word)
                
                if matching_brand_ids:
                    brands = Brand.objects.filter(id__in=matching_brand_ids)
                    for brand in brands:
                        brand_name_upper = brand.name.upper()
                        for word in search_words:
                            word_upper = word.upper()
                            # Exact match
                            if word_upper == brand_name_upper:
                                brand_words.add(word)
                            # Partial match (word is substring of brand name, at least 3 chars)
                            elif len(word) >= 3 and word_upper in brand_name_upper:
                                brand_words.add(word)
                
                # Get remaining words (not matched to category/brand)
                remaining_words = [w for w in search_words if w not in category_words and w not in brand_words]
                
                # Build query for remaining words in name
                remaining_words_query = None
                if remaining_words:
                    remaining_words_query = Q(name__icontains=remaining_words[0])
                    for word in remaining_words[1:]:
                        if word:
                            remaining_words_query = remaining_words_query & Q(name__icontains=word)
                
                # Build query for ALL words in name (including category/brand words)
                all_words_in_name_query = Q(name__icontains=search_words[0])
                for word in search_words[1:]:
                    if word:
                        all_words_in_name_query = all_words_in_name_query & Q(name__icontains=word)
                
                # Build the combined query
                combined_query = Q()
                
                # If we have category matches, filter by category and require remaining words in name
                if category_words:
                    category_query = Q(category_id__in=matching_category_ids)
                    if remaining_words_query:
                        category_query = category_query & remaining_words_query
                    combined_query = combined_query | category_query
                
                # If we have brand matches, filter by brand and require remaining words in name
                if brand_words:
                    brand_query = Q(brand_id__in=matching_brand_ids)
                    if remaining_words_query:
                        brand_query = brand_query & remaining_words_query
                    combined_query = combined_query | brand_query
                
                # Always include: all words in name (regardless of category/brand match)
                combined_query = combined_query | all_words_in_name_query
                
                # Also include full string matches in other fields
                combined_query = combined_query | (
                    Q(name__icontains=search) |
                    Q(sku__icontains=search) |
                    Q(description__icontains=search) |
                    Q(id__in=exact_sku_product_ids) |
                    Q(id__in=barcode_matches)
                )
                
                queryset = queryset.filter(combined_query).distinct()
            else:
                # Single word search - search across all fields
                queryset = queryset.filter(
                    Q(name__icontains=search) | 
                    Q(brand__name__icontains=search) |
                    Q(category__name__icontains=search) |
                    Q(sku__icontains=search) |
                    Q(description__icontains=search) |
                    Q(id__in=exact_sku_product_ids) |
                    Q(id__in=barcode_matches)
                ).distinct()
        
        return queryset
    
    def filter_active(self, queryset, name, value):
        """Filter by active status (handles string 'true'/'false')"""
        if value is None or value == '':
            return queryset
        if isinstance(value, str):
            is_active = value.lower() == 'true'
        else:
            is_active = bool(value)
        return queryset.filter(is_active=is_active)
    
    def filter_barcode(self, queryset, name, value):
        """Filter by barcode or short_code — exact match only (no .first(), no iexact/icontains)."""
        if not value:
            return queryset
        value = str(value).strip().upper()
        return queryset.filter(
            Q(barcodes__barcode=value) | Q(barcodes__short_code=value)
        ).distinct()
    
    def filter_supplier(self, queryset, name, value):
        """Filter products by supplier through purchase items"""
        if not value:
            return queryset
        supplier_product_ids = PurchaseItem.objects.filter(
            purchase__supplier_id=value,
            purchase__deleted_at__isnull=True,
        ).values_list('product_id', flat=True).distinct()
        return queryset.filter(id__in=supplier_product_ids)
    
    def filter_in_stock(self, queryset, name, value):
        """Filter products that are in stock"""
        if value is None or value == '':
            return queryset
        
        # Handle string 'true'/'false'
        if isinstance(value, str):
            should_filter = value.lower() == 'true'
        else:
            should_filter = bool(value)
        
        if should_filter:
            # Get products with available barcodes
            available_barcodes = self._get_available_barcodes()
            product_ids_with_stock = available_barcodes.values('product_id').annotate(
                count=Count('id')
            ).filter(count__gt=0).values_list('product_id', flat=True)
            
            return queryset.filter(id__in=product_ids_with_stock)
        return queryset
    
    def filter_low_stock(self, queryset, name, value):
        """Filter products that are low in stock"""
        if value is None or value == '':
            return queryset
        
        # Handle string 'true'/'false'
        if isinstance(value, str):
            should_filter = value.lower() == 'true'
        else:
            should_filter = bool(value)
        
        if should_filter:
            # Get products with available barcodes
            available_barcodes = self._get_available_barcodes()
            product_barcode_counts = available_barcodes.values('product_id').annotate(
                count=Count('id')
            )
            
            # Get products with their low_stock_threshold
            products = Product.objects.filter(
                id__in=[item['product_id'] for item in product_barcode_counts]
            ).only('id', 'low_stock_threshold')
            
            product_threshold_map = {p.id: (p.low_stock_threshold or 0) for p in products}
            
            # Filter products where count > 0 and count <= threshold
            product_ids_low_stock = []
            for item in product_barcode_counts:
                product_id = item['product_id']
                available_count = item['count']
                low_stock_threshold = product_threshold_map.get(product_id, 0)
                
                if available_count > 0 and available_count <= low_stock_threshold:
                    product_ids_low_stock.append(product_id)
            
            return queryset.filter(id__in=product_ids_low_stock)
        return queryset
    
    def filter_out_of_stock(self, queryset, name, value):
        """Filter products that are out of stock"""
        if value is None or value == '':
            return queryset
        
        # Handle string 'true'/'false'
        if isinstance(value, str):
            should_filter = value.lower() == 'true'
        else:
            should_filter = bool(value)
        
        if should_filter:
            # Get products with available barcodes
            available_barcodes = self._get_available_barcodes()
            product_ids_with_stock = available_barcodes.values('product_id').annotate(
                count=Count('id')
            ).filter(count__gt=0).values_list('product_id', flat=True)
            
            # Return products NOT in the list of products with stock
            return queryset.exclude(id__in=product_ids_with_stock)
        return queryset
    
    def filter_tag(self, queryset, name, value):
        """Filter by barcode tag
        
        OPTIMIZATION: Use Q objects and annotate instead of set operations
        This avoids loading all IDs into memory and lets the database handle it
        """
        if not value:
            return queryset
        
        valid_tags = [choice[0] for choice in Barcode.TAG_CHOICES]
        if value not in valid_tags:
            return queryset
        
        if value == 'sold':
            # For 'sold' tag: tracked products with 'sold' barcodes OR non-tracked products with sold InvoiceItems
            # OPTIMIZATION: Use id__in subqueries to avoid Cartesian product explosion with annotate(Count)
            sold_barcode_product_ids = Barcode.objects.filter(tag='sold').values('product_id')
            
            sold_invoice_product_ids = InvoiceItem.objects.filter(
                product__track_inventory=False,
                invoice__status__in=['paid', 'credit', 'partial'],
                invoice__invoice_type__in=['cash', 'upi']
            ).exclude(invoice__status='void').values('product_id')
            
            return queryset.filter(
                Q(id__in=sold_barcode_product_ids) |
                Q(id__in=sold_invoice_product_ids)
            )
        elif value == 'new':
            # For 'new' tag: products with 'new' barcodes OR products without any barcodes
            # OPTIMIZATION: Use Exists() subqueries - most efficient for large datasets
            # Exists() generates optimized SQL with EXISTS clause instead of IN
            
            # Subquery: Check if product has any "normal" barcode (new, returned, sold, or in-cart)
            # This ensures products don't disappear when sold out or when they only have returns
            has_normal_barcode = Barcode.objects.filter(
                product_id=OuterRef('pk'),
                tag__in=['new', 'returned', 'sold', 'in-cart']
            )
            
            # Subquery: Check if product has ANY barcodes at all
            has_any_barcode = Barcode.objects.filter(
                product_id=OuterRef('pk')
            )
            
            # Filter: Products with normal barcodes OR no barcodes at all
            return queryset.filter(
                Q(Exists(has_normal_barcode)) | ~Q(Exists(has_any_barcode))
            ).distinct()
        else:
            # For other tags: filter by barcode tag using Q object (more efficient)
            return queryset.filter(barcodes__tag=value).distinct()
    
    def _is_likely_sku(self, search_term):
        """Detect if search term is likely a SKU/barcode vs product name
        
        Be more conservative - only treat as SKU if it has clear SKU patterns.
        Short alphanumeric strings like "Y03" should be treated as product name searches.
        """
        if not search_term:
            return False
        
        # SKUs typically have dashes, underscores, or are alphanumeric patterns
        has_separator = '-' in search_term or '_' in search_term
        is_alphanumeric = search_term.replace('-', '').replace('_', '').replace(' ', '').isalnum()
        is_short = len(search_term) <= 20
        
        # Only treat as SKU if it has separators (dash/underscore) - this is a strong SKU indicator
        # Examples: "ABC-123", "PROD_001" are SKUs
        if has_separator and is_alphanumeric and is_short:
            return True
        
        # Very short (3 chars or less) alphanumeric strings without separators are likely SKUs
        # Examples: "ABC", "123" 
        if len(search_term) <= 3 and is_alphanumeric and not ' ' in search_term:
            return True
        
        # Don't treat longer alphanumeric strings without separators as SKUs
        # "Y03" should search product names, not just barcodes
        # Only treat as SKU if it's very short (3 chars or less) OR has separators
        
        return False
    
    def _get_available_barcodes(self):
        """Get available barcodes (new or returned, not in carts, not sold)"""
        available_barcodes = Barcode.objects.filter(tag__in=['new', 'returned'])
        
        # Exclude barcodes in active carts
        cart_items = CartItem.objects.filter(
            cart__status='active'
        ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
        
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
        
        available_barcodes = available_barcodes.exclude(id__in=sold_barcode_ids)
        
        return available_barcodes
