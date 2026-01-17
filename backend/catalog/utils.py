"""
Utility functions for catalog operations
"""
from django.db.models import Max
from decimal import Decimal
from django.utils import timezone
import uuid
from backend.catalog.models import Barcode, Product


def generate_unique_sku(base_name=None):
    """Generate a unique SKU"""
    prefix = base_name[:4].upper().replace(' ', '') if base_name else 'PRD'
    timestamp = timezone.now().strftime('%Y%m%d')
    unique_id = str(uuid.uuid4())[:8].upper()
    sku = f"{prefix}-{timestamp}-{unique_id}"
    
    # Ensure uniqueness
    while Product.objects.filter(sku=sku).exists():
        unique_id = str(uuid.uuid4())[:8].upper()
        sku = f"{prefix}-{timestamp}-{unique_id}"
    
    return sku


def get_prefix_for_product(product):
    """Get 3-character prefix from category name or product name"""
    if product and product.category and product.category.name:
        # Use first 3 characters of category name (uppercase)
        category_name = product.category.name.upper().strip()
        if len(category_name) >= 3:
            return category_name[:3]
    
    # Fallback to product name if no category
    if product and product.name:
        product_name = product.name.upper().strip()
        if len(product_name) >= 3:
            return product_name[:3]
    
    # Last resort: use 'UNK' for unknown
    return 'UNK'


def get_max_number_for_prefix(prefix):
    """Get the maximum number already used for a given prefix"""
    # Find existing short_codes with this prefix
    existing_codes = Barcode.objects.filter(
        short_code__startswith=f'{prefix}-'
    ).exclude(short_code__isnull=True)
    
    if not existing_codes.exists():
        # No existing codes with this prefix, start with 0
        return 0
    
    # Extract numbers from existing codes
    max_number = 0
    for code in existing_codes.values_list('short_code', flat=True):
        try:
            # Format: PREFIX-NUMBER
            parts = code.split('-', 1)
            if len(parts) == 2:
                number_str = parts[1]
                # Try to parse as integer
                number = int(number_str)
                max_number = max(max_number, number)
        except (ValueError, IndexError):
            continue
    
    return max_number


def generate_category_based_short_code(product, start_number=None):
    """
    Generate a category-based short_code for a product.
    Format: PREFIX-NUMBER (e.g., HOU-56789)
    
    Args:
        product: Product instance
        start_number: Optional starting number (for sequential generation in loops).
                     If None, will query database for max number.
        
    Returns:
        A unique short_code string
    """
    if not product:
        return None
    
    # Get prefix (3 characters from category or product name)
    prefix = get_prefix_for_product(product)
    
    # Get the starting number
    if start_number is not None:
        # Use provided starting number
        next_number = start_number
    else:
        # Get the maximum number already used for this prefix
        max_number = get_max_number_for_prefix(prefix)
        # Next number is max_number + 1
        next_number = max_number + 1
    
    # Format: PREFIX-NUMBER (4-digit or 5-digit based on number)
    if next_number <= 9999:
        # Use 4-digit format
        short_code = f"{prefix}-{next_number:04d}"
    else:
        # Use 5-digit format
        short_code = f"{prefix}-{next_number:05d}"
    
    # Ensure uniqueness (shouldn't happen with sequential numbering, but safety check)
    original_short_code = short_code
    collision_counter = 0
    max_attempts = 10000
    
    while Barcode.objects.filter(short_code=short_code).exists():
        collision_counter += 1
        if collision_counter > max_attempts:
            # Fallback: use UUID suffix if too many collisions
            import uuid
            unique_suffix = str(uuid.uuid4())[:8]
            short_code = f"{original_short_code}-{unique_suffix}"
            break
        
        # Increment number and try again
        if start_number is not None:
            # Use the provided start_number as base
            next_number = start_number + collision_counter
        else:
            # Query database for max number
            max_number = get_max_number_for_prefix(prefix)
            next_number = max_number + 1 + collision_counter
        
        if next_number <= 9999:
            short_code = f"{prefix}-{next_number:04d}"
        else:
            short_code = f"{prefix}-{next_number:05d}"
    
    return short_code
