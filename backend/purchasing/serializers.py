from rest_framework import serializers
from .models import Purchase, PurchaseItem
from backend.catalog.utils import generate_category_based_short_code, get_prefix_for_product, get_max_number_for_prefix
from backend.core.cache_signals import (
    suspend_cache_signals, 
    suspend_cache_signals_decorator,
    invalidate_products_cache_manual,
    invalidate_purchases_cache_manual,
    invalidate_stock_cache_manual
)
from backend.core.utils import create_audit_log
import uuid


def generate_barcodes_for_purchase_item(purchase_item, quantity):
    """Generate barcodes for a purchase item. Always generates barcodes regardless of purchase status."""
    from backend.catalog.models import Barcode
    from decimal import Decimal
    
    product = purchase_item.product
    if not product:
        return
    
    quantity_int = int(quantity)
    if quantity_int <= 0:
        return
    
    base_name = product.name[:4].upper().replace(' ', '') if product.name else 'PRD'
    timestamp = purchase_item.purchase.purchase_date.strftime('%Y%m%d')
    
    created_barcodes = []
    
    if product.track_inventory:
        # Lock the product to prevent race conditions during serial generation
        # This ensures sequential serials even with rapid parallel requests
        from django.db import transaction
        
        # We need to be in a transaction to use select_for_update
        # The view/serializer usually wraps in strict atomic block? 
        # If not, we should ensure we have one, but nested atomic is tricky with locks.
        # Assuming the caller provides a transaction or we are in autocommit (which we shouldn't lock in).
        # Let's verify we are in a transaction or create one.
        
        # Find the highest serial number
        # Use select_for_update on the product to serialize generation for this product
        try:
            with transaction.atomic():
                _locked_product = product.__class__.objects.select_for_update().get(pk=product.pk)
                
                existing_barcodes_query = Barcode.objects.filter(product=product)
                if purchase_item.variant:
                    existing_barcodes_query = existing_barcodes_query.filter(variant=purchase_item.variant)
                else:
                    existing_barcodes_query = existing_barcodes_query.filter(variant__isnull=True)
                
                max_serial = -1
                for existing_barcode in existing_barcodes_query:
                    # Split barcode by '-' and get the serial number (third part, index 2)
                    parts = existing_barcode.barcode.split('-')
                    if len(parts) >= 3:
                        try:
                            # Serial number is the third part (index 2), ignore collision counters (index 3+)
                            # Validates that it's actually a number
                            serial_str = parts[2]
                            serial_num = int(serial_str)
                            max_serial = max(max_serial, serial_num)
                        except (ValueError, IndexError):
                            continue
                
                # Start from max_serial + 1
                start_serial = max_serial + 1 if max_serial >= 0 else 1
                
                # Get the starting number for short_code (to ensure sequential numbering)
                prefix = get_prefix_for_product(product)
                max_short_code_number = get_max_number_for_prefix(prefix)
                short_code_start = max_short_code_number + 1
                
                # Generate barcodes for each unit with incremental serial numbers
                for i in range(quantity_int):
                    # Use incremental serial number starting from the next available number
                    serial_number = str(start_serial + i).zfill(4)  # Format as 0000, 0001, 0002, etc.
                    barcode_value = f"{base_name}-{timestamp}-{serial_number}"
                    
                    # Ensure barcode uniqueness (in case of collision)
                    counter = 0
                    while Barcode.objects.filter(barcode=barcode_value).exists():
                        counter += 1
                        # If collision, append counter to make unique
                        barcode_value = f"{base_name}-{timestamp}-{serial_number}-{counter}"
                    
                    # Generate unique short_code using category-based format with sequential numbering
                    short_code = generate_category_based_short_code(product, start_number=short_code_start + i)
                    
                    # Create barcode linked to this purchase
                    barcode = Barcode.objects.create(
                        product=product,
                        variant=purchase_item.variant,
                        barcode=barcode_value,
                        short_code=short_code,
                        is_primary=(i == 0),  # First barcode is primary
                        tag='new',  # Fresh from purchase
                        purchase=purchase_item.purchase,
                        purchase_item=purchase_item
                    )
                    created_barcodes.append(barcode)
        except Exception as e:
            # Fallback if locking fails (shouldn't happen in standard DBs)
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error generating barcodes with lock: {e}")
            raise e
            
    else:
        # For non-tracked products, create single barcode if doesn't exist
        if not product.barcodes.filter(purchase_item=purchase_item).exists():
            # Find the highest serial number for this product (and variant) across all existing barcodes
            existing_barcodes_query = Barcode.objects.filter(product=product)
            if purchase_item.variant:
                existing_barcodes_query = existing_barcodes_query.filter(variant=purchase_item.variant)
            else:
                existing_barcodes_query = existing_barcodes_query.filter(variant__isnull=True)
            
            max_serial = -1
            for existing_barcode in existing_barcodes_query:
                # Split barcode by '-' and get the serial number (third part, index 2)
                parts = existing_barcode.barcode.split('-')
                if len(parts) >= 3:
                    try:
                        # Serial number is the third part (index 2), ignore collision counters (index 3+)
                        serial_str = parts[2]
                        serial_num = int(serial_str)
                        max_serial = max(max_serial, serial_num)
                    except (ValueError, IndexError):
                        # Skip if can't parse serial number
                        continue
            
            # Start from max_serial + 1 (or 1 if no existing barcodes)
            start_serial = max_serial + 1 if max_serial >= 0 else 1
            serial_number = str(start_serial).zfill(4)
            barcode_value = f"{base_name}-{timestamp}-{serial_number}"
            
            counter = 0
            while Barcode.objects.filter(barcode=barcode_value).exists():
                counter += 1
                barcode_value = f"{base_name}-{timestamp}-{serial_number}-{counter}"
            
            # Generate unique short_code using category-based format
            # For non-tracked products, we only create one barcode, so no need for sequential numbering
            short_code = generate_category_based_short_code(product)
            
            barcode = Barcode.objects.create(
                product=product,
                variant=purchase_item.variant,
                barcode=barcode_value,
                short_code=short_code,
                is_primary=True,
                tag='new',
                purchase=purchase_item.purchase,
                purchase_item=purchase_item
            )
            created_barcodes.append(barcode)
    
    # Auto-generate labels for newly created barcodes
    if created_barcodes:
        auto_generate_labels_for_barcodes(created_barcodes, product.name)


def auto_generate_labels_for_barcodes(barcodes, product_name):
    """Auto-generate labels for barcodes (non-blocking, background thread)
    
    Spins off a background thread to handle label generation so the API response isn't delayed.
    Always tries Azure Function first (bulk), falls back to local generation if Azure fails.
    """
    import threading
    
    def _generate_labels_task(barcodes_list, prod_name):
        try:
            from backend.catalog.models import BarcodeLabel, Barcode
            from backend.catalog.label_generator import generate_label_image
            from django.db import transaction
            
            # Re-fetch barcodes to avoid detached instance issues in thread
            barcode_ids = [b.id for b in barcodes_list]
            barcodes = Barcode.objects.filter(id__in=barcode_ids)
            
            # Collect barcodes that need generation for bulk processing
            barcodes_to_queue = []
            barcode_label_map = {}  # Map barcode_id to label_obj and created flag
            
            for barcode in barcodes:
                try:
                    # Use a new connection for threading safety if needed, 
                    # but standard Django ORM usually handles new thread = new connection.
                    # We avoid select_for_update inside thread if possible, or handle transaction carefully.
                    
                    # Check if label exists without locking first
                    label_obj, created = BarcodeLabel.objects.get_or_create(
                        barcode=barcode,
                        defaults={'label_image': ''}
                    )
                    
                    # Only generate if label doesn't exist or is invalid
                    # Valid image can be: base64 data URL (data:image/...) or blob URL (https://...)
                    if created or not (label_obj.label_image and 
                                      len(label_obj.label_image.strip()) > 0 and
                                      (label_obj.label_image.startswith('data:image') or 
                                       label_obj.label_image.startswith('https://'))):
                        # Get vendor name and purchase date from purchase
                        vendor_name = None
                        purchase_date = None
                        if barcode.purchase_id:
                            # Use select_related to minimize queries
                            try:
                                barcode_with_purchase = Barcode.objects.select_related('purchase', 'purchase__supplier').get(pk=barcode.pk)
                                if barcode_with_purchase.purchase:
                                    if barcode_with_purchase.purchase.supplier:
                                        vendor_name = barcode_with_purchase.purchase.supplier.name
                                    purchase_date = barcode_with_purchase.purchase.purchase_date.strftime('%d-%m-%Y')
                            except Exception:
                                pass
                        
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
                        
                        # Collect for bulk processing
                        barcodes_to_queue.append({
                            'product_name': prod_name,
                            'barcode_value': barcode.barcode,
                            'short_code': barcode.short_code if hasattr(barcode, 'short_code') else None,
                            'barcode_id': barcode.id,
                            'vendor_name': vendor_name,
                            'purchase_date': purchase_date,
                            'serial_number': serial_number,
                        })
                        barcode_label_map[barcode.id] = {
                            'label_obj': label_obj,
                            'created': created
                        }
                except Exception as e:
                    # Skip individual barcode errors
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.warning(f"Auto-label generation prep failed for barcode {barcode.id}: {str(e)}")
                    continue
            
            # Bulk queue all barcodes that need generation via Azure Function
            if barcodes_to_queue:
                try:
                    from backend.catalog.azure_label_service import queue_bulk_label_generation_via_azure
                    # Queue all barcodes in one request
                    blob_urls = queue_bulk_label_generation_via_azure(barcodes_to_queue)
                    
                    # Save blob URLs to database
                    for item in barcodes_to_queue:
                        barcode_id = item['barcode_id']
                        blob_url = blob_urls.get(barcode_id)
                        label_info = barcode_label_map.get(barcode_id)
                        
                        if not label_info:
                            continue
                        
                        if blob_url:
                            label_info['label_obj'].label_image = blob_url
                            label_info['label_obj'].save(update_fields=['label_image'])
                        else:
                            # Azure fallback to local
                            _generate_local_fallback(item, label_info)
                except Exception as e:
                    # Bulk failure fallback
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.warning(f"Azure bulk label queuing failed: {str(e)}, falling back to local")
                    
                    for item in barcodes_to_queue:
                        label_info = barcode_label_map.get(item['barcode_id'])
                        if label_info:
                            _generate_local_fallback(item, label_info)
                            
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Background label generation task failed: {str(e)}")

    def _generate_local_fallback(item, label_info):
        try:
            from backend.catalog.label_generator import generate_label_image
            image_data_url = generate_label_image(
                product_name=item['product_name'],
                barcode_value=item['barcode_value'],
                sku=item['barcode_value'],
                vendor_name=item['vendor_name'],
                purchase_date=item['purchase_date'],
                serial_number=item['serial_number']
            )
            label_info['label_obj'].label_image = image_data_url
            label_info['label_obj'].save(update_fields=['label_image'])
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Local label generation failed for barcode {item['barcode_id']}: {str(e)}")

    # Start the background thread
    if barcodes:
        # We must convert QuerySet to list of IDs or objects to pass to thread safely if DB closes
        # Best to pass list of objects which are already in memory, 
        # but to be safe against DB cursor issues, we'll extract IDs inside or outside.
        # Here we pass the list of barcode objects (which are standard Python objects once evaluated)
        thread = threading.Thread(target=_generate_labels_task, args=(list(barcodes), product_name))
        thread.daemon = True # Daemon thread so it doesn't block program exit
        thread.start()


class PurchaseItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_track_inventory = serializers.BooleanField(source='product.track_inventory', read_only=True)
    variant_name = serializers.CharField(source='variant.name', read_only=True)
    variant_sku = serializers.CharField(source='variant.sku', read_only=True)
    line_total = serializers.SerializerMethodField()
    sold_count = serializers.SerializerMethodField()
    printed = serializers.BooleanField(source='is_printed', read_only=True)

    class Meta:
        model = PurchaseItem
        fields = ['id', 'product', 'product_name', 'product_sku', 'product_track_inventory', 'variant', 'variant_name', 'variant_sku', 'quantity', 'unit_price', 'selling_price', 'line_total', 'sold_count', 'printed', 'printed_at']
    
    def get_line_total(self, obj):
        return float(obj.get_line_total())
    
    def get_sold_count(self, obj):
        """Get count of sold barcodes for this purchase item"""
        from backend.catalog.models import Barcode
        if not obj or not hasattr(obj, 'product') or not obj.product:
            return 0
        if obj.product.track_inventory:
            # For tracked products, count barcodes with 'sold' tag
            # Use try-except to handle cases where purchase_item might not exist yet
            try:
                return Barcode.objects.filter(purchase_item=obj, tag='sold').count()
            except Exception:
                return 0
        else:
            # For non-tracked products, sold count is 0 (they don't have individual barcodes)
            return 0


class PurchaseSerializer(serializers.ModelSerializer):
    items = PurchaseItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    purchase_number = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    subtotal = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()

    class Meta:
        model = Purchase
        fields = [
            'id', 'purchase_number', 'supplier', 'supplier_name', 'purchase_date', 
            'bill_number', 'status', 'store', 'warehouse', 'notes', 'created_by', 'created_at', 'updated_at', 
            'items', 'subtotal', 'total'
        ]
    
    def get_subtotal(self, obj):
        return float(obj.get_subtotal())
    
    def get_total(self, obj):
        return float(obj.get_total())
    
    @suspend_cache_signals_decorator
    def create(self, validated_data):
        # Check if this is a vendor purchase (from vendor_purchases endpoint)
        # Vendor purchases should always be draft
        # Admin/user purchases can be finalized immediately
        is_vendor_purchase = self.context.get('is_vendor_purchase', False)
        
        if is_vendor_purchase:
            # Force vendor purchases to be draft
            validated_data['status'] = 'draft'
        else:
            # For admin/user purchases, use the status from request or default to 'finalized'
            # This allows admin to create finalized purchases directly
            if 'status' not in validated_data:
                validated_data['status'] = 'finalized'  # Default to finalized for admin/user purchases
        
        # Auto-generate purchase_number if not provided
        if not validated_data.get('purchase_number'):
            from django.utils import timezone
            import uuid
            purchase_number = f"PUR-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            # Ensure uniqueness
            while Purchase.objects.filter(purchase_number=purchase_number).exists():
                purchase_number = f"PUR-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            validated_data['purchase_number'] = purchase_number
        
        items_data = self.context.get('items_data', [])
        
        # Use suspended cache signals to prevent mass invalidation during loop
        # Use suspended cache signals to prevent mass invalidation during loop
        purchase = super().create(validated_data)
        
        # Safety check: Only enforce draft for vendor purchases
        if is_vendor_purchase and purchase.status != 'draft':
            purchase.status = 'draft'
            purchase.save(update_fields=['status'])

        # Create items if provided
        if items_data:
            from backend.catalog.models import Barcode, Product, ProductVariant
            from decimal import Decimal
            
            for item_data in items_data:
                product_id = item_data.get('product')
                variant_id = item_data.get('variant')
                quantity = Decimal(str(item_data.get('quantity', 0)))
                
                # Validate quantity is positive
                if quantity <= 0:
                    raise serializers.ValidationError({
                        'items': f'Quantity must be greater than 0. Got {quantity}.'
                    })
                
                # Validate product is required
                if not product_id:
                    raise serializers.ValidationError('Product is required for purchase item')
                
                # Convert IDs to model instances
                try:
                    product = Product.objects.get(id=product_id)
                except Product.DoesNotExist:
                    raise serializers.ValidationError(f'Product with id {product_id} does not exist')
                
                # Variant is optional - only look it up if variant_id is provided and not empty
                variant = None
                if variant_id and variant_id not in [None, '', 0, '0']:
                    try:
                        variant = ProductVariant.objects.get(id=variant_id)
                    except ProductVariant.DoesNotExist:
                        raise serializers.ValidationError(f'ProductVariant with id {variant_id} does not exist')
                
                # Create purchase item with model instances
                purchase_item = PurchaseItem.objects.create(
                    purchase=purchase,
                    product=product,
                    variant=variant,
                    quantity=quantity,
                    unit_price=item_data.get('unit_price', 0),
                    selling_price=item_data.get('selling_price', None)
                )
                
                # Always generate barcodes (even in draft)
                generate_barcodes_for_purchase_item(purchase_item, quantity)
                
                # CRITICAL: Only update stock when purchase status is 'finalized'
                # Stock should NEVER be affected for draft purchases
                # Double-check status before updating stock
                if purchase.status == 'finalized':
                    # Refresh from DB to ensure we have the latest status
                    purchase.refresh_from_db()
                    if purchase.status != 'finalized':
                        # Status changed, skip stock update
                        continue
                    from backend.inventory.models import Stock
                    
                    # Use purchase's store/warehouse, or fallback to first available
                    store = purchase.store
                    warehouse = purchase.warehouse
                    if not store and not warehouse:
                        from backend.locations.models import Store, Warehouse
                        store = Store.objects.filter(is_active=True).first()
                        warehouse = Warehouse.objects.filter(is_active=True).first() if not store else None
                    
                    # Ensure at least one location exists
                    if not store and not warehouse:
                        raise serializers.ValidationError('Purchase must have a store or warehouse, or at least one location must exist in the system')
                    
                    # Create or update stock entry
                    stock, stock_created = Stock.objects.get_or_create(
                        product=purchase_item.product,
                        variant=purchase_item.variant,
                        store=store,
                        warehouse=warehouse,
                        defaults={'quantity': Decimal('0.000')}
                    )
                    
                    # Add purchased quantity to stock
                    old_stock = stock.quantity
                    stock.quantity += quantity
                    stock.save()
                    
                    # Audit log: Stock added from purchase (per item)
                    request = self.context.get('request')
                    if request:
                        create_audit_log(
                            request=request,
                            action='stock_purchase',
                            model_name='Stock',
                            object_id=str(stock.id),
                            object_name=purchase_item.product.name,
                            object_reference=purchase.purchase_number,
                            barcode=None,
                            changes={
                                'purchase_id': purchase.id,
                                'purchase_number': purchase.purchase_number,
                                'product_id': purchase_item.product.id,
                                'product_name': purchase_item.product.name,
                                'product_sku': purchase_item.product.sku,
                                'quantity_added': str(quantity),
                                'stock_before': str(old_stock),
                                'stock_after': str(stock.quantity),
                                'unit_price': str(purchase_item.unit_price),
                                'location': store.name if store else (warehouse.name if warehouse else None),
                            }
                        )
        
        # Create audit log for purchase creation
            request = self.context.get('request')
            if request:
                items_summary = [f"{item.product.name if item.product else 'Unknown'} x{item.quantity}" for item in purchase.items.all()]
                create_audit_log(
                    request=request,
                    action='create',
                    model_name='Purchase',
                    object_id=str(purchase.id),
                    object_name=f"Purchase {purchase.purchase_number}",
                    object_reference=purchase.purchase_number,
                    barcode=None,
                    changes={
                        'purchase_number': purchase.purchase_number,
                        'supplier': purchase.supplier.name if purchase.supplier else None,
                        'purchase_date': str(purchase.purchase_date),
                        'items_count': purchase.items.count(),
                        'items': items_summary,
                        'total': str(purchase.get_total()),
                    }
                )
        
        # Manually invalidate cache once after all operations
        invalidate_purchases_cache_manual()
        invalidate_products_cache_manual()
        # Only invalidate stock if we potentially touched it (e.g. status finalized)
        if purchase.status == 'finalized':
            invalidate_stock_cache_manual()
            
        return purchase
    
    @suspend_cache_signals_decorator
    def update(self, instance, validated_data):
        items_data = self.context.get('items_data', None)
        
        # Store old status and items for validation and stock reversal
        old_status = instance.status
        old_items = list(instance.items.all()) if items_data is not None else []
        
        # Update purchase fields
        instance = super().update(instance, validated_data)
        new_status = instance.status
        
        # Update items if provided
        if items_data is not None:
            from backend.inventory.models import Stock
            from backend.catalog.models import Product, ProductVariant, Barcode
            from decimal import Decimal
            
            # Create a map of old items by (product_id, variant_id) for comparison
            old_items_map = {}
            for old_item in old_items:
                key = (old_item.product.id, old_item.variant.id if old_item.variant else None)
                old_items_map[key] = old_item
            
            # Validate new quantities against sold barcodes BEFORE making any changes
            for item_data in items_data:
                product_id = item_data.get('product')
                variant_id = item_data.get('variant')
                new_quantity = Decimal(str(item_data.get('quantity', 0)))
                
                if not product_id:
                    continue  # Will be validated later
                
                # Find matching old item
                key = (product_id, variant_id if variant_id and variant_id not in [None, '', 0, '0'] else None)
                old_item = old_items_map.get(key)
                
                if old_item:
                    # Check if quantity is being reduced
                    if new_quantity < old_item.quantity:
                        # Count sold barcodes for this purchase item
                        sold_barcodes_count = Barcode.objects.filter(
                            purchase_item=old_item,
                            tag='sold'
                        ).count()
                        
                        # Validate: new quantity cannot be less than sold count
                        if new_quantity < Decimal(str(sold_barcodes_count)):
                            raise serializers.ValidationError({
                                'items': f'Cannot reduce quantity for {old_item.product.name} below {sold_barcodes_count} because {sold_barcodes_count} items have already been sold. Minimum allowed quantity is {sold_barcodes_count}.'
                            })
            
            items_to_update = []  # Items that need quantity/price updates
            items_to_create = []  # New items to create
            items_to_delete = []  # Items to delete
            items_to_preserve = []  # Items that haven't changed (preserve barcodes)
            
            # Build map of new items by (product_id, variant_id)
            new_items_map = {}
            for item_data in items_data:
                product_id = item_data.get('product')
                variant_id = item_data.get('variant')
                key = (product_id, variant_id if variant_id and variant_id not in [None, '', 0, '0'] else None)
                new_items_map[key] = item_data
            
            # Categorize old items
            for old_item in old_items:
                key = (old_item.product.id, old_item.variant.id if old_item.variant else None)
                matching_new_item = new_items_map.get(key)
                
                if matching_new_item:
                    new_quantity = Decimal(str(matching_new_item.get('quantity', 0)))
                    old_quantity = old_item.quantity
                    new_price = Decimal(str(matching_new_item.get('unit_price', old_item.unit_price)))
                    old_price = old_item.unit_price
                    
                    # Check if quantity or price changed
                    if new_quantity != old_quantity or new_price != old_price:
                        items_to_update.append((old_item, matching_new_item))
                    else:
                        # Nothing changed, preserve the item and its barcodes
                        items_to_preserve.append(old_item)
                else:
                    # Item is being removed completely
                    items_to_delete.append(old_item)
            
            # Find new items that don't match any old items
            for item_data in items_data:
                product_id = item_data.get('product')
                variant_id = item_data.get('variant')
                key = (product_id, variant_id if variant_id and variant_id not in [None, '', 0, '0'] else None)
                if key not in [((old_item.product.id, old_item.variant.id if old_item.variant else None)) for old_item in old_items]:
                    items_to_create.append(item_data)
            
            # Update stock for preserved items when finalizing (they already have barcodes)
            if new_status == 'finalized' and old_status != 'finalized':
                for old_item in items_to_preserve:
                    store = instance.store
                    warehouse = instance.warehouse
                    if not store and not warehouse:
                        from backend.locations.models import Store, Warehouse
                        store = Store.objects.filter(is_active=True).first()
                        warehouse = Warehouse.objects.filter(is_active=True).first() if not store else None
                    
                    if store or warehouse:
                        stock, stock_created = Stock.objects.get_or_create(
                            product=old_item.product,
                            variant=old_item.variant,
                            store=store,
                            warehouse=warehouse,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        # Add the quantity to stock (only if not already finalized)
                        stock.quantity += old_item.quantity
                        stock.save()
                        
                        # Audit log
                        request = self.context.get('request')
                        if request:
                            create_audit_log(
                                request=request,
                                action='stock_purchase',
                                model_name='Stock',
                                object_id=str(stock.id),
                                object_name=old_item.product.name,
                                object_reference=instance.purchase_number,
                                barcode=None,
                                changes={
                                    'purchase_id': instance.id,
                                    'purchase_number': instance.purchase_number,
                                    'product_id': old_item.product.id,
                                    'product_name': old_item.product.name,
                                    'product_sku': old_item.product.sku,
                                    'quantity_added': str(old_item.quantity),
                                    'stock_before': str(stock.quantity - old_item.quantity),
                                    'stock_after': str(stock.quantity),
                                    'unit_price': str(old_item.unit_price),
                                    'location': store.name if store else (warehouse.name if warehouse else None),
                                }
                            )

            # --- HANDLE UPDATED ITEMS (In-Place Update) ---
            # Instead of deleting and recreating, we update the existing PurchaseItem
            # This preserves the ID and the link to existing barcodes
            
            for old_item, item_data in items_to_update:
                old_quantity = old_item.quantity
                new_quantity = Decimal(str(item_data.get('quantity', 0)))
                new_price = Decimal(str(item_data.get('unit_price', old_item.unit_price)))
                
                # Update item fields
                old_item.quantity = new_quantity
                old_item.unit_price = new_price
                old_item.selling_price = item_data.get('selling_price', old_item.selling_price)
                old_item.save()
                
                # Handle barcodes if quantity changed
                if new_quantity != old_quantity:
                    if new_quantity < old_quantity:
                        # Quantity decreased: Remove excess unsold barcodes
                        # We need to remove (old_quantity - new_quantity) barcodes
                        # Prioritize deleting 'new' or 'unknown' barcodes, keep 'sold'/'in-cart'
                        
                        qty_to_remove = int(old_quantity - new_quantity)
                        
                        # Find deletable barcodes (not sold/in-cart)
                        deletable_barcodes = Barcode.objects.filter(
                            purchase_item=old_item
                        ).exclude(
                            tag__in=['sold', 'in-cart']
                        ).order_by('-created_at') # Remove newest first
                        
                        # Make sure we don't try to delete more than available
                        count_to_delete = min(qty_to_remove, deletable_barcodes.count())
                        
                        if count_to_delete > 0:
                            barcodes_to_delete = deletable_barcodes[:count_to_delete]
                            barcode_ids = list(barcodes_to_delete.values_list('id', flat=True))
                            
                            # Delete blobs (fire and forget)
                            try:
                                from backend.catalog.azure_label_service import delete_blobs_for_barcodes
                                delete_blobs_for_barcodes(barcode_ids)
                            except Exception:
                                pass
                            
                            # Delete barcodes
                            Barcode.objects.filter(id__in=barcode_ids).delete()
                            
                    elif new_quantity > old_quantity:
                        # Quantity increased: Generate more barcodes for the difference
                        qty_to_add = new_quantity - old_quantity
                        if qty_to_add > 0:
                            generate_barcodes_for_purchase_item(old_item, qty_to_add)

                # --- Handle Stock Updates for Updated Items ---
                
                # Case 1: Status changed Draft -> Finalized
                if old_status != 'finalized' and new_status == 'finalized':
                    # Add FULL new quantity to stock
                    store = instance.store
                    warehouse = instance.warehouse
                    if not store and not warehouse:
                        from backend.locations.models import Store, Warehouse
                        store = Store.objects.filter(is_active=True).first()
                        warehouse = Warehouse.objects.filter(is_active=True).first() if not store else None
                    
                    if store or warehouse:
                        stock, _ = Stock.objects.get_or_create(
                             product=old_item.product,
                             variant=old_item.variant,
                             store=store,
                             warehouse=warehouse,
                             defaults={'quantity': Decimal('0.000')}
                        )
                        stock.quantity += new_quantity
                        stock.save()

                # Case 2: Status Finalized -> Finalized (Quantity changed)
                elif old_status == 'finalized' and new_status == 'finalized':
                    if new_quantity != old_quantity:
                        diff = new_quantity - old_quantity
                        store = instance.store
                        warehouse = instance.warehouse
                        if not store and not warehouse:
                            from backend.locations.models import Store, Warehouse
                            store = Store.objects.filter(is_active=True).first()
                            warehouse = Warehouse.objects.filter(is_active=True).first() if not store else None
                        
                        if store or warehouse:
                            stock, _ = Stock.objects.get_or_create(
                                 product=old_item.product,
                                 variant=old_item.variant,
                                 store=store,
                                 warehouse=warehouse,
                                 defaults={'quantity': Decimal('0.000')}
                            )
                            stock.quantity += diff
                            # Ensure stock doesn't go negative
                            if stock.quantity < 0:
                                stock.quantity = Decimal('0.000') 
                            stock.save()

            # --- HANDLE DELETED ITEMS ---
            for old_item in items_to_delete:
                # Delete all non-sold barcodes
                barcodes_to_delete = Barcode.objects.filter(
                    purchase_item=old_item
                ).exclude(tag__in=['sold', 'in-cart'])
                
                barcode_ids = list(barcodes_to_delete.values_list('id', flat=True))
                
                if barcode_ids:
                    try:
                        from backend.catalog.azure_label_service import delete_blobs_for_barcodes
                        delete_blobs_for_barcodes(barcode_ids)
                    except Exception:
                        pass
                
                barcodes_to_delete.delete()
                
                # Delete the item itself
                old_item.delete()
            
            # --- HANDLE STOCK UPDATES (Re-calculation) ---
            # If purchase was finalized (either before or now), we need to adjust stock
            # Easiest way: If finalized, fully reverse old stock (for updated items) and add new stock?
            # Or calculate difference?
            # Existing logic did "Reverse all old, Add all new".
            
            # Let's stick to the difference approach for cleaner audit logs if possible, 
            # OR replicate the "Reverse Old, Add New" pattern but per item.
            
            # --- HANDLE DELETED ITEMS ---
            for old_item in items_to_delete:
                # Delete all non-sold barcodes
                barcodes_to_delete = Barcode.objects.filter(
                    purchase_item=old_item
                ).exclude(tag__in=['sold', 'in-cart'])
                
                barcode_ids = list(barcodes_to_delete.values_list('id', flat=True))
                
                if barcode_ids:
                    try:
                        from backend.catalog.azure_label_service import delete_blobs_for_barcodes
                        delete_blobs_for_barcodes(barcode_ids)
                    except Exception:
                        pass
                
                barcodes_to_delete.delete()
                old_item.delete()

            # Create new items and update stock
            for item_data in items_to_create:
                product_id = item_data.get('product')
                variant_id = item_data.get('variant')
                quantity = Decimal(str(item_data.get('quantity', 0)))
                
                # Validate quantity is positive
                if quantity <= 0:
                    raise serializers.ValidationError({
                        'items': f'Quantity must be greater than 0. Got {quantity}.'
                    })
                
                # Validate product is required
                if not product_id:
                    raise serializers.ValidationError('Product is required for purchase item')
                
                # Convert IDs to model instances
                try:
                    product = Product.objects.get(id=product_id)
                except Product.DoesNotExist:
                    raise serializers.ValidationError(f'Product with id {product_id} does not exist')
                
                # Variant is optional - only look it up if variant_id is provided and not empty
                variant = None
                if variant_id and variant_id not in [None, '', 0, '0']:
                    try:
                        variant = ProductVariant.objects.get(id=variant_id)
                    except ProductVariant.DoesNotExist:
                        raise serializers.ValidationError(f'ProductVariant with id {variant_id} does not exist')
                
                # Create purchase item with model instances
                purchase_item = PurchaseItem.objects.create(
                    purchase=instance,
                    product=product,
                    variant=variant,
                    quantity=quantity,
                    unit_price=item_data.get('unit_price', 0),
                    selling_price=item_data.get('selling_price', None)
                )
                
                # Generate barcodes ONLY if they don't exist yet
                from backend.catalog.models import Barcode
                existing_barcodes = Barcode.objects.filter(purchase_item=purchase_item).count()
                if existing_barcodes == 0:
                    # No barcodes exist, generate them
                    generate_barcodes_for_purchase_item(purchase_item, quantity)
                
                # Only update stock when purchase status is 'finalized'
                if new_status == 'finalized':
                    store = instance.store
                    warehouse = instance.warehouse
                    if not store and not warehouse:
                        from backend.locations.models import Store, Warehouse
                        store = Store.objects.filter(is_active=True).first()
                        warehouse = Warehouse.objects.filter(is_active=True).first() if not store else None
                    
                    if store or warehouse:
                        # Count actual barcodes created for this purchase item
                        actual_barcode_count = Barcode.objects.filter(
                            purchase_item=purchase_item,
                            tag='new'
                        ).count()
                        
                        stock, stock_created = Stock.objects.get_or_create(
                            product=purchase_item.product,
                            variant=purchase_item.variant,
                            store=store,
                            warehouse=warehouse,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        # Add the actual barcode count to stock (not quantity, to match reality)
                        stock.quantity += Decimal(str(actual_barcode_count))
                        stock.save()
                        
                        # Audit log: Stock added from purchase (per item)
                        request = self.context.get('request')
                        if request:
                            create_audit_log(
                                request=request,
                                action='stock_purchase',
                                model_name='Stock',
                                object_id=str(stock.id),
                                object_name=purchase_item.product.name,
                                object_reference=instance.purchase_number,
                                barcode=None,
                                changes={
                                    'purchase_id': instance.id,
                                    'purchase_number': instance.purchase_number,
                                    'product_id': purchase_item.product.id,
                                    'product_name': purchase_item.product.name,
                                    'product_sku': purchase_item.product.sku,
                                    'quantity_added': str(quantity),
                                    'stock_before': str(stock.quantity - quantity),
                                    'stock_after': str(stock.quantity),
                                    'unit_price': str(purchase_item.unit_price),
                                    'location': store.name if store else (warehouse.name if warehouse else None),
                                }
                            )
        
        # Handle status change to cancelled - delete non-sold barcodes, keep product
        if old_status != 'cancelled' and new_status == 'cancelled':
            from backend.catalog.models import Barcode
            from django.db import transaction
            from django.db.models import Q
            
            with transaction.atomic():
                # Delete all barcodes for this purchase that are NOT protected (sold or in-cart)
                # Only delete barcodes with tags: 'new', 'returned', 'defective', 'unknown', or null
                # Keep protected barcodes (sold or in-cart - they should not be deleted)
                # Get barcode IDs before deletion for blob cleanup
                barcodes_to_delete = Barcode.objects.filter(
                    purchase=instance
                ).exclude(
                    tag__in=['sold', 'in-cart']  # Exclude protected barcodes (sold or in-cart) - they should be kept
                )
                barcode_ids = list(barcodes_to_delete.values_list('id', flat=True))
                
                # Delete associated blobs from Azure Storage before deleting barcodes
                if barcode_ids:
                    try:
                        from backend.catalog.azure_label_service import delete_blobs_for_barcodes
                        delete_blobs_for_barcodes(barcode_ids)
                    except Exception as e:
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.warning(f"Failed to delete blobs from Azure Storage: {str(e)}")
                
                # Use Q objects to combine conditions
                deleted_count = barcodes_to_delete.delete()[0]
                
                # Create audit log
                request = self.context.get('request')
                if request:
                    create_audit_log(
                        request=request,
                        action='cancel',
                        model_name='Purchase',
                        object_id=str(instance.id),
                        object_name=f"Purchase {instance.purchase_number}",
                        object_reference=instance.purchase_number,
                        barcode=None,
                        changes={
                            'purchase_number': instance.purchase_number,
                            'status': 'cancelled',
                            'barcodes_deleted': deleted_count,
                            'note': 'Non-sold barcodes deleted, product kept'
                        }
                    )
        
        # Handle status change to finalized (when items_data is None, just status change)
        if items_data is None and old_status != 'finalized' and new_status == 'finalized':
            # Update stock for all items when finalizing
            from backend.inventory.models import Stock
            from decimal import Decimal
            
            for item in instance.items.all():
                store = instance.store
                warehouse = instance.warehouse
                if not store and not warehouse:
                    from backend.locations.models import Store, Warehouse
                    store = Store.objects.filter(is_active=True).first()
                    warehouse = Warehouse.objects.filter(is_active=True).first() if not store else None
                
                if store or warehouse:
                    stock, _ = Stock.objects.get_or_create(
                        product=item.product,
                        variant=item.variant,
                        store=store,
                        warehouse=warehouse,
                        defaults={'quantity': Decimal('0.000')}
                    )
                    stock.quantity += item.quantity
                    stock.save()
                    
                    # Audit log
                    request = self.context.get('request')
                    if request:
                        create_audit_log(
                            request=request,
                            action='stock_purchase',
                            model_name='Stock',
                            object_id=str(stock.id),
                            object_name=item.product.name,
                            object_reference=instance.purchase_number,
                            barcode=None,
                            changes={
                                'purchase_id': instance.id,
                                'purchase_number': instance.purchase_number,
                                'product_id': item.product.id,
                                'product_name': item.product.name,
                                'quantity_added': str(item.quantity),
                                'stock_before': str(stock.quantity - item.quantity),
                                'stock_after': str(stock.quantity),
                                'unit_price': str(item.unit_price),
                            }
                        )
        
        # Create audit log for purchase update
        request = self.context.get('request')
        if request:
            items_summary = [f"{item.product.name if item.product else 'Unknown'} x{item.quantity}" for item in instance.items.all()]
            create_audit_log(
                request=request,
                action='update',
                model_name='Purchase',
                object_id=str(instance.id),
                object_name=f"Purchase {instance.purchase_number}",
                object_reference=instance.purchase_number,
                barcode=None,
                changes={
                    'purchase_number': instance.purchase_number,
                    'supplier': instance.supplier.name if instance.supplier else None,
                    'purchase_date': str(instance.purchase_date),
                    'items_count': instance.items.count(),
                    'items': items_summary,
                    'total': str(instance.get_total()),
                    'status': new_status,
                }
            )
        
        # Manually invalidate cache once after all operations
        invalidate_purchases_cache_manual()
        invalidate_products_cache_manual()
        if new_status == 'finalized' or old_status == 'finalized':
            invalidate_stock_cache_manual()

        return instance
