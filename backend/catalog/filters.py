import django_filters
import re
from django.db.models import Q, Count, Exists, OuterRef
from .models import Product, Barcode
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


def find_barcode_by_search_value(search_value: str, logger=None):
    """
    Find a Barcode object by search value.
    This centralizes all barcode search logic from filters.py.
    
    IMPORTANT: 
    - barcode field: must always be exact matches (no icontains/contains)
    - short_code field: can use icontains for flexible matching
    
    Priority:
    1. Check cache for exact barcode match
    2. Check cache for exact short_code match
    3. Exact normalized match on short_code (flexible)
    4. Exact normalized match on full barcode (flexible)
    5. Exact match on short_code
    6. Exact match on full barcode
    7. Case-insensitive match on short_code
    8. Case-insensitive match on full barcode
    9. Prefix matching (normalized and original)
    10. Contains match on short_code only (not barcode)
    
    Returns:
        Barcode object or None if not found
    """
    if not search_value or not search_value.strip():
        return None
    
    barcode_clean = search_value.strip()
    
    # PRIORITY 0: Check cache first for fast retrieval
    try:
        from .barcode_cache import get_cached_barcode, get_cached_barcode_by_short_code
        
        # Try cache lookup by barcode
        cached_data = get_cached_barcode(barcode_clean)
        if cached_data:
            # Get the actual Barcode object from cache data
            barcode_obj = Barcode.objects.filter(id=cached_data['id']).select_related(
                'product', 'product__category', 'product__brand'
            ).first()
            if barcode_obj:
                product = barcode_obj.product
                if product and product.is_active:
                    if logger:
                        logger.debug(f"Cache hit for barcode: '{barcode_clean}' -> ID: {barcode_obj.id}")
                    return barcode_obj
        
        # Try cache lookup by short_code
        cached_data = get_cached_barcode_by_short_code(barcode_clean)
        if cached_data:
            barcode_obj = Barcode.objects.filter(id=cached_data['id']).select_related(
                'product', 'product__category', 'product__brand'
            ).first()
            if barcode_obj:
                product = barcode_obj.product
                if product and product.is_active:
                    if logger:
                        logger.debug(f"Cache hit for short_code: '{barcode_clean}' -> ID: {barcode_obj.id}")
                    return barcode_obj
    except Exception as e:
        # If cache fails, continue with database lookup
        if logger:
            logger.warning(f"Cache lookup failed for '{barcode_clean}': {str(e)}")
    
    normalized_input = normalize_barcode_for_search(barcode_clean)
    
    # PRIORITY 1: Flexible normalized matching (highest priority)
    if normalized_input and len(normalized_input) >= 3:
        prefix_match = re.match(r'^([A-Z]+)', normalized_input)
        if prefix_match:
            prefix = prefix_match.group(1)
            # Get candidates by prefix
            candidate_barcodes = Barcode.objects.filter(
                Q(short_code__istartswith=prefix) | Q(barcode__istartswith=prefix)
            ).filter(
                Q(short_code__isnull=False) | Q(barcode__isnull=False)
            ).exclude(
                Q(short_code='') & Q(barcode='')
            ).select_related(
                'product', 'product__category', 'product__brand'
            ).distinct()[:200]
            
            if logger:
                logger.debug(f"Searching {candidate_barcodes.count()} candidate barcodes with prefix '{prefix}' for normalized input '{normalized_input}'")
            
            # Try exact normalized match first
            for barcode_obj in candidate_barcodes:
                # Check short_code first
                if barcode_obj.short_code:
                    normalized_short_code = normalize_barcode_for_search(barcode_obj.short_code)
                    if normalized_short_code == normalized_input:
                        # Check if product is active before returning
                        product = barcode_obj.product
                        if product and product.is_active:
                            if logger:
                                logger.debug(f"Found exact normalized match: short_code='{barcode_obj.short_code}' -> '{normalized_short_code}'")
                            # Cache the result for future lookups
                            try:
                                from .barcode_cache import cache_barcode_data
                                cache_barcode_data(barcode_obj)
                            except Exception:
                                pass  # Cache failure shouldn't break the lookup
                            return barcode_obj
                
                # Check full barcode
                if barcode_obj.barcode:
                    normalized_barcode = normalize_barcode_for_search(barcode_obj.barcode)
                    if normalized_barcode == normalized_input:
                        # Check if product is active before returning
                        product = barcode_obj.product
                        if product and product.is_active:
                            if logger:
                                logger.debug(f"Found exact normalized match: barcode='{barcode_obj.barcode}' -> '{normalized_barcode}'")
                            # Cache the result for future lookups
                            try:
                                from .barcode_cache import cache_barcode_data
                                cache_barcode_data(barcode_obj)
                            except Exception:
                                pass  # Cache failure shouldn't break the lookup
                            return barcode_obj
            
            # Try prefix matching if exact match didn't work
            input_no_separators = barcode_clean.replace('-', '').replace(' ', '').replace('_', '').upper()
            for barcode_obj in candidate_barcodes:
                if barcode_obj.short_code:
                    normalized_short_code = normalize_barcode_for_search(barcode_obj.short_code)
                    short_code_no_separators = barcode_obj.short_code.replace('-', '').replace(' ', '').replace('_', '').upper()
                    
                    # Prefix match on original (no separators)
                    if short_code_no_separators.startswith(input_no_separators) and len(input_no_separators) >= 3:
                        product = barcode_obj.product
                        if product and product.is_active:
                            return barcode_obj
                    
                    # Prefix match on normalized
                    if normalized_short_code.startswith(normalized_input) and len(normalized_short_code) - len(normalized_input) <= 2:
                        product = barcode_obj.product
                        if product and product.is_active:
                            return barcode_obj
                
                if barcode_obj.barcode:
                    normalized_barcode = normalize_barcode_for_search(barcode_obj.barcode)
                    barcode_no_separators = barcode_obj.barcode.replace('-', '').replace(' ', '').replace('_', '').upper()
                    
                    if barcode_no_separators.startswith(input_no_separators) and len(input_no_separators) >= 3:
                        product = barcode_obj.product
                        if product and product.is_active:
                            return barcode_obj
                    
                    if normalized_barcode.startswith(normalized_input) and len(normalized_barcode) - len(normalized_input) <= 2:
                        product = barcode_obj.product
                        if product and product.is_active:
                            return barcode_obj
            
            # FALLBACK: If prefix search didn't find a match, try direct search by normalized value
            # This is more efficient than scanning through thousands of candidates
            # We'll search for barcodes where the normalized short_code or barcode matches
            # Since we can't do normalized matching in SQL, we'll use a more targeted approach:
            # 1. Try to extract numeric parts from normalized input to narrow down
            # 2. Search for barcodes that might match based on pattern
            
            # Extract numeric suffix from normalized input (e.g., "1261" from "FRAM1261")
            numeric_suffix_match = re.search(r'(\d+)$', normalized_input)
            if numeric_suffix_match:
                numeric_suffix = numeric_suffix_match.group(1)
                # Search for barcodes with numeric pattern
                # Use icontains for short_code, but exact matching for barcode
                numeric_candidates = Barcode.objects.filter(
                    Q(short_code__icontains=numeric_suffix) | Q(barcode__endswith=numeric_suffix)
                ).filter(
                    Q(short_code__istartswith=prefix) | Q(barcode__istartswith=prefix)
                ).filter(
                    Q(short_code__isnull=False) | Q(barcode__isnull=False)
                ).exclude(
                    Q(short_code='') & Q(barcode='')
                ).select_related(
                    'product', 'product__category', 'product__brand'
                ).distinct()[:1000]  # Still limit but more targeted
                
                if logger:
                    logger.debug(f"Trying numeric-pattern search with '{numeric_suffix}' for prefix '{prefix}'")
                
                # Check normalized matches
                for barcode_obj in numeric_candidates:
                    if barcode_obj.short_code:
                        normalized_short_code = normalize_barcode_for_search(barcode_obj.short_code)
                        if normalized_short_code == normalized_input:
                            product = barcode_obj.product
                            if product and product.is_active:
                                if logger:
                                    logger.debug(f"Found exact normalized match in numeric search: short_code='{barcode_obj.short_code}' -> '{normalized_short_code}'")
                                return barcode_obj
                    
                    if barcode_obj.barcode:
                        normalized_barcode = normalize_barcode_for_search(barcode_obj.barcode)
                        if normalized_barcode == normalized_input:
                            product = barcode_obj.product
                            if product and product.is_active:
                                if logger:
                                    logger.debug(f"Found exact normalized match in numeric search: barcode='{barcode_obj.barcode}' -> '{normalized_barcode}'")
                                return barcode_obj
            
            # Last resort: broader search - use icontains for short_code, istartswith for barcode
            if logger:
                logger.debug(f"Trying broader search with icontains for short_code, exact prefix for barcode")
            
            broader_candidates = Barcode.objects.filter(
                Q(short_code__icontains=prefix) | Q(barcode__istartswith=prefix)
            ).filter(
                Q(short_code__isnull=False) | Q(barcode__isnull=False)
            ).exclude(
                Q(short_code='') & Q(barcode='')
            ).select_related(
                'product', 'product__category', 'product__brand'
            ).distinct()[:2000]  # Increased limit significantly
            
            # Try exact normalized match in broader search
            for barcode_obj in broader_candidates:
                if barcode_obj.short_code:
                    normalized_short_code = normalize_barcode_for_search(barcode_obj.short_code)
                    if normalized_short_code == normalized_input:
                        product = barcode_obj.product
                        if product and product.is_active:
                            if logger:
                                logger.debug(f"Found exact normalized match in broader search: short_code='{barcode_obj.short_code}' -> '{normalized_short_code}'")
                            return barcode_obj
                
                if barcode_obj.barcode:
                    normalized_barcode = normalize_barcode_for_search(barcode_obj.barcode)
                    if normalized_barcode == normalized_input:
                        product = barcode_obj.product
                        if product and product.is_active:
                            if logger:
                                logger.debug(f"Found exact normalized match in broader search: barcode='{barcode_obj.barcode}' -> '{normalized_barcode}'")
                            return barcode_obj
    
    # PRIORITY 2: Exact match on short_code
    barcode_obj = Barcode.objects.filter(short_code=barcode_clean).select_related(
        'product', 'product__category', 'product__brand'
    ).first()
    if barcode_obj:
        product = barcode_obj.product
        if product and product.is_active:
            # Cache the result for future lookups
            try:
                from .barcode_cache import cache_barcode_data
                cache_barcode_data(barcode_obj)
            except Exception:
                pass  # Cache failure shouldn't break the lookup
            return barcode_obj
    
    # PRIORITY 3: Exact match on full barcode
    barcode_obj = Barcode.objects.filter(barcode=barcode_clean).select_related(
        'product', 'product__category', 'product__brand'
    ).first()
    if barcode_obj:
        product = barcode_obj.product
        if product and product.is_active:
            # Cache the result for future lookups
            try:
                from .barcode_cache import cache_barcode_data
                cache_barcode_data(barcode_obj)
            except Exception:
                pass  # Cache failure shouldn't break the lookup
            return barcode_obj
    
    # PRIORITY 4: Case-insensitive match on short_code ONLY (barcode must be exact)
    barcode_obj = Barcode.objects.filter(short_code__iexact=barcode_clean).select_related(
        'product', 'product__category', 'product__brand'
    ).first()
    if barcode_obj:
        product = barcode_obj.product
        if product and product.is_active:
            # Cache the result for future lookups
            try:
                from .barcode_cache import cache_barcode_data
                cache_barcode_data(barcode_obj)
            except Exception:
                pass  # Cache failure shouldn't break the lookup
            return barcode_obj
    
    # PRIORITY 5: Contains match for short_code only (not for barcode)
    # short_code can use icontains, but barcode must be exact
    if len(barcode_clean) >= 3:
        barcode_obj = Barcode.objects.filter(
            short_code__icontains=barcode_clean
        ).select_related('product').first()
        if barcode_obj:
            product = barcode_obj.product
            if product and product.is_active:
                # Cache the result for future lookups
                try:
                    from .barcode_cache import cache_barcode_data
                    cache_barcode_data(barcode_obj)
                except Exception:
                    pass  # Cache failure shouldn't break the lookup
                return barcode_obj
    
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
        """Filter by barcode or short_code
        
        IMPORTANT: barcode field uses EXACT case-sensitive matching only
        short_code field can use flexible matching (iexact, icontains)
        """
        if not value:
            return queryset
        
        # Normalize input for flexible matching
        value = value.upper()
        normalized_input = normalize_barcode_for_search(value)
        
        # Try exact matches first (most efficient)
        # barcode: exact matching (normalized)
        # short_code: exact match
        queryset_exact = queryset.filter(
            Q(barcodes__barcode=value) | Q(barcodes__short_code=value)
        ).distinct()
        
        if queryset_exact.exists():
            return queryset_exact
        
        # Try case-insensitive match on short_code ONLY (not barcode)
        queryset_iexact = queryset.filter(
            Q(barcodes__short_code__iexact=value)
        ).distinct()
        
        if queryset_iexact.exists():
            return queryset_iexact
        
        # If normalized input is meaningful, try flexible matching on short_code
        if normalized_input and len(normalized_input) >= 3:
            # Get all products with barcodes that have short_code
            # We'll do normalized matching in Python for flexibility
            products_with_matching_short_code = []
            barcodes_with_short_code = Barcode.objects.filter(
                short_code__isnull=False
            ).exclude(short_code='').select_related('product')
            
            # Extract prefix for initial filtering
            prefix_match = re.match(r'^([A-Z]+)', normalized_input)
            if prefix_match:
                prefix = prefix_match.group(1)
                barcodes_with_short_code = barcodes_with_short_code.filter(
                    short_code__istartswith=prefix
                )[:100]  # Limit for performance
            
            for barcode_obj in barcodes_with_short_code:
                if barcode_obj.short_code and barcode_obj.product:
                    normalized_short_code = normalize_barcode_for_search(barcode_obj.short_code)
                    if normalized_short_code == normalized_input:
                        products_with_matching_short_code.append(barcode_obj.product_id)
            
            if products_with_matching_short_code:
                return queryset.filter(id__in=products_with_matching_short_code).distinct()
        
        # Fallback: try icontains for short_code only (not for barcode)
        # barcode field must be exact match, but short_code can use contains
        queryset_short_code_contains = queryset.filter(
            barcodes__short_code__icontains=value
        ).distinct()
        
        if queryset_short_code_contains.exists():
            return queryset_short_code_contains
        
        # No match found
        return queryset.none()
    
    def filter_supplier(self, queryset, name, value):
        """Filter products by supplier through purchase items"""
        if not value:
            return queryset
        supplier_product_ids = PurchaseItem.objects.filter(
            purchase__supplier_id=value
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
            # Use Q objects for efficient OR query
            return queryset.filter(
                Q(barcodes__tag='sold') |
                Q(
                    track_inventory=False,
                    invoice_items__invoice__status__in=['paid', 'credit', 'partial'],
                    invoice_items__invoice__invoice_type__in=['cash', 'upi']
                ) & ~Q(invoice_items__invoice__status='void')
            ).distinct()
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
