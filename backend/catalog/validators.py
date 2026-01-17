"""
Data validation and consistency checks for barcodes, labels, and stock
"""
from django.db.models import Sum, Q
from decimal import Decimal
from .models import Barcode, BarcodeLabel, Product
from backend.inventory.models import Stock


def validate_stock_barcode_consistency(product_id: int, store_id=None, warehouse_id=None):
    """
    Validate that stock quantity matches barcode count for a product.
    
    Args:
        product_id: Product ID to validate
        store_id: Optional store ID to filter by location
        warehouse_id: Optional warehouse ID to filter by location
    
    Returns:
        dict with validation results:
        {
            'is_consistent': bool,
            'stock_quantity': Decimal,
            'barcode_count': int,
            'difference': Decimal,
            'issues': list of issue descriptions
        }
    """
    try:
        product = Product.objects.get(id=product_id)
    except Product.DoesNotExist:
        return {
            'is_consistent': False,
            'stock_quantity': Decimal('0'),
            'barcode_count': 0,
            'difference': Decimal('0'),
            'issues': [f'Product {product_id} does not exist']
        }
    
    issues = []
    
    # Get stock quantity
    stock_query = Stock.objects.filter(product=product)
    if store_id:
        stock_query = stock_query.filter(store_id=store_id)
    if warehouse_id:
        stock_query = stock_query.filter(warehouse_id=warehouse_id)
    
    stock_quantity = stock_query.aggregate(
        total=Sum('quantity')
    )['total'] or Decimal('0')
    
    # Get barcode count (only 'new' barcodes count as available stock)
    barcode_query = Barcode.objects.filter(
        product=product,
        tag='new'  # Only count new barcodes as available stock
    )
    if store_id or warehouse_id:
        # Filter by purchase location if provided
        # Note: This is approximate since barcodes don't directly link to stores
        pass
    
    barcode_count = barcode_query.count()
    
    # For tracked products, barcode count should match stock
    if product.track_inventory:
        difference = abs(stock_quantity - Decimal(str(barcode_count)))
        is_consistent = difference <= Decimal('0.001')  # Allow small floating point differences
        
        if not is_consistent:
            if stock_quantity > barcode_count:
                issues.append(
                    f'Stock quantity ({stock_quantity}) exceeds available barcodes ({barcode_count}). '
                    f'Possible causes: barcodes deleted, stock adjusted manually, or data inconsistency.'
                )
            else:
                issues.append(
                    f'Barcode count ({barcode_count}) exceeds stock quantity ({stock_quantity}). '
                    f'Possible causes: stock not updated after purchase, or stock adjustment.'
                )
    else:
        # For non-tracked products, barcode count should be 1 (or 0 if not created)
        is_consistent = barcode_count <= 1
        if barcode_count > 1:
            issues.append(
                f'Non-tracked product has {barcode_count} barcodes. Should have 0 or 1.'
            )
    
    return {
        'is_consistent': is_consistent,
        'stock_quantity': stock_quantity,
        'barcode_count': barcode_count,
        'difference': abs(stock_quantity - Decimal(str(barcode_count))),
        'issues': issues
    }


def validate_label_generation_status(product_id: int):
    """
    Validate label generation status for a product.
    
    Returns:
        dict with validation results:
        {
            'all_labels_generated': bool,
            'total_barcodes': int,
            'generated_labels': int,
            'missing_labels': int,
            'invalid_labels': int,
            'issues': list
        }
    """
    try:
        product = Product.objects.get(id=product_id)
    except Product.DoesNotExist:
        return {
            'all_labels_generated': False,
            'total_barcodes': 0,
            'generated_labels': 0,
            'missing_labels': 0,
            'invalid_labels': 0,
            'issues': [f'Product {product_id} does not exist']
        }
    
    issues = []
    barcodes = product.barcodes.all()
    total_barcodes = barcodes.count()
    
    # Count generated labels
    generated_labels = BarcodeLabel.objects.filter(
        barcode__in=barcodes
    ).exclude(
        label_image=''
    ).exclude(
        label_image__isnull=True
    ).filter(
        label_image__startswith='data:image'
    ).count()
    
    # Count invalid labels (empty or malformed)
    invalid_labels = BarcodeLabel.objects.filter(
        barcode__in=barcodes
    ).exclude(
        label_image=''
    ).exclude(
        label_image__isnull=True
    ).exclude(
        label_image__startswith='data:image'
    ).count()
    
    missing_labels = total_barcodes - generated_labels - invalid_labels
    
    if missing_labels > 0:
        issues.append(f'{missing_labels} barcodes are missing labels')
    
    if invalid_labels > 0:
        issues.append(f'{invalid_labels} labels are invalid or corrupted')
    
    return {
        'all_labels_generated': generated_labels == total_barcodes and total_barcodes > 0,
        'total_barcodes': total_barcodes,
        'generated_labels': generated_labels,
        'missing_labels': missing_labels,
        'invalid_labels': invalid_labels,
        'issues': issues
    }


def validate_purchase_barcodes(purchase_id: int):
    """
    Validate barcodes for a purchase.
    
    Returns:
        dict with validation results
    """
    from backend.purchasing.models import Purchase, PurchaseItem
    
    try:
        purchase = Purchase.objects.get(id=purchase_id)
    except Purchase.DoesNotExist:
        return {
            'is_valid': False,
            'issues': [f'Purchase {purchase_id} does not exist']
        }
    
    issues = []
    items = purchase.items.all()
    
    for item in items:
        expected_barcode_count = int(item.quantity) if item.product.track_inventory else 1
        actual_barcode_count = Barcode.objects.filter(purchase_item=item).count()
        
        if actual_barcode_count != expected_barcode_count:
            issues.append(
                f'Item {item.product.name}: Expected {expected_barcode_count} barcodes, '
                f'found {actual_barcode_count}'
            )
    
    return {
        'is_valid': len(issues) == 0,
        'issues': issues
    }


def run_comprehensive_data_check():
    """
    Run comprehensive data validation checks across the system.
    
    Returns:
        dict with all validation results
    """
    results = {
        'products_checked': 0,
        'products_with_issues': 0,
        'stock_barcode_issues': [],
        'label_generation_issues': [],
        'purchase_issues': [],
        'summary': {}
    }
    
    # Check all products
    products = Product.objects.all()
    results['products_checked'] = products.count()
    
    stock_issues_count = 0
    label_issues_count = 0
    
    for product in products:
        # Check stock-barcode consistency
        stock_check = validate_stock_barcode_consistency(product.id)
        if not stock_check['is_consistent']:
            stock_issues_count += 1
            results['stock_barcode_issues'].append({
                'product_id': product.id,
                'product_name': product.name,
                'issues': stock_check['issues'],
                'stock_quantity': str(stock_check['stock_quantity']),
                'barcode_count': stock_check['barcode_count']
            })
        
        # Check label generation
        label_check = validate_label_generation_status(product.id)
        if not label_check['all_labels_generated'] and label_check['total_barcodes'] > 0:
            label_issues_count += 1
            results['label_generation_issues'].append({
                'product_id': product.id,
                'product_name': product.name,
                'issues': label_check['issues'],
                'total_barcodes': label_check['total_barcodes'],
                'generated_labels': label_check['generated_labels']
            })
    
    results['products_with_issues'] = len(set(
        [issue['product_id'] for issue in results['stock_barcode_issues']] +
        [issue['product_id'] for issue in results['label_generation_issues']]
    ))
    
    # Check purchases
    from backend.purchasing.models import Purchase
    purchases = Purchase.objects.filter(status='finalized')
    purchase_issues_count = 0
    
    for purchase in purchases:
        purchase_check = validate_purchase_barcodes(purchase.id)
        if not purchase_check['is_valid']:
            purchase_issues_count += 1
            results['purchase_issues'].append({
                'purchase_id': purchase.id,
                'purchase_number': purchase.purchase_number,
                'issues': purchase_check['issues']
            })
    
    results['summary'] = {
        'total_products': results['products_checked'],
        'products_with_stock_issues': stock_issues_count,
        'products_with_label_issues': label_issues_count,
        'purchases_with_issues': purchase_issues_count,
        'total_issues': (
            len(results['stock_barcode_issues']) +
            len(results['label_generation_issues']) +
            len(results['purchase_issues'])
        )
    }
    
    return results

