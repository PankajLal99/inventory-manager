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


def _get_purchase_location_or_raise(purchase):
    if purchase.store_id:
        return purchase.store, None
    if purchase.warehouse_id:
        return None, purchase.warehouse
    raise serializers.ValidationError(
        {'detail': 'Purchase location is required. Set either store or warehouse.'}
    )


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
                
                # Use all_objects to include soft-deleted rows because DB unique
                # constraints still apply to them.
                existing_barcodes_query = Barcode.all_objects.filter(product=product)
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
                    while Barcode.all_objects.filter(barcode=barcode_value).exists():
                        counter += 1
                        # If collision, append counter to make unique
                        barcode_value = f"{base_name}-{timestamp}-{serial_number}-{counter}"
                    
                    # Generate unique short_code using category-based format with sequential numbering
                    short_code = generate_category_based_short_code(product, start_number=short_code_start + i)
                    
                    # Create barcode linked to this purchase
                    barcode = Barcode.objects.create(
                        retailer_id=purchase_item.purchase.retailer_id or product.retailer_id,
                        product=product,
                        variant=purchase_item.variant,
                        barcode=barcode_value,
                        short_code=short_code,
                        is_primary=(i == 0),  # First barcode is primary
                        tag='new',  # Fresh from purchase
                        purchase=purchase_item.purchase,
                        purchase_item=purchase_item,
                        current_store=purchase_item.purchase.store,
                        current_warehouse=purchase_item.purchase.warehouse,
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
            # Use all_objects to include soft-deleted rows because DB unique
            # constraints still apply to them.
            existing_barcodes_query = Barcode.all_objects.filter(product=product)
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
            while Barcode.all_objects.filter(barcode=barcode_value).exists():
                counter += 1
                barcode_value = f"{base_name}-{timestamp}-{serial_number}-{counter}"
            
            # Generate unique short_code using category-based format
            # For non-tracked products, we only create one barcode, so no need for sequential numbering
            short_code = generate_category_based_short_code(product)
            
            barcode = Barcode.objects.create(
                retailer_id=purchase_item.purchase.retailer_id or product.retailer_id,
                product=product,
                variant=purchase_item.variant,
                barcode=barcode_value,
                short_code=short_code,
                is_primary=True,
                tag='new',
                purchase=purchase_item.purchase,
                purchase_item=purchase_item,
                current_store=purchase_item.purchase.store,
                current_warehouse=purchase_item.purchase.warehouse,
            )
            created_barcodes.append(barcode)
    
    # Auto-generate labels for newly created barcodes
    if created_barcodes:
        auto_generate_labels_for_barcodes(created_barcodes, product.name)


def auto_generate_labels_for_barcodes(barcodes, product_name):
    """Auto-generate labels for barcodes (non-blocking, background thread)
    
    Spins off a background thread to handle label generation so the API response isn't delayed.
    Always tries Azure Function first (bulk), falls back to local generation if Azure fails.
    Skips entirely when DISABLE_BARCODE_LABEL_GENERATION is True (barcodes still created, no Azure/local labels).
    """
    from django.conf import settings
    if getattr(settings, 'DISABLE_BARCODE_LABEL_GENERATION', False):
        return
    import threading
    
    def _generate_labels_task(barcodes_list, prod_name):
        try:
            from backend.catalog.models import BarcodeLabel, Barcode
            from backend.catalog.label_generator import generate_label_image
            from django.db import transaction
            
            # Re-fetch barcodes to avoid detached instance issues in thread
            barcode_ids = [b.id for b in barcodes_list]
            barcodes = Barcode.objects.select_related('product__retailer', 'purchase_item').filter(id__in=barcode_ids)
            
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
                        # Get vendor name and purchase date/price from purchase
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

                        retailer_code = (
                            (getattr(getattr(barcode, 'product', None), 'retailer', None).code or '')
                            if getattr(getattr(barcode, 'product', None), 'retailer', None)
                            else ''
                        ).strip().upper()
                        if retailer_code != 'MT':
                            def _format_price(value):
                                try:
                                    from decimal import Decimal
                                    return f"₹{Decimal(str(value)).quantize(Decimal('0.00'))}"
                                except Exception:
                                    return f"₹{value}"

                            purchase_item = getattr(barcode, 'purchase_item', None)
                            if purchase_item is not None:
                                selling_price = getattr(purchase_item, 'selling_price', None)
                                if selling_price not in (None, 0, 0.0, '0', '0.0', '0.00'):
                                    purchase_date = _format_price(selling_price)
                                else:
                                    unit_price = getattr(purchase_item, 'unit_price', None)
                                    if unit_price is not None:
                                        purchase_date = _format_price(unit_price)
                        
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
                            'barcode_value': (barcode.short_code if hasattr(barcode, 'short_code') else None) or barcode.barcode,
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
                    retailer_blob_folder = ''
                    first_barcode = next(iter(barcodes), None)
                    if (
                        first_barcode
                        and getattr(first_barcode, 'product', None)
                        and getattr(first_barcode.product, 'retailer', None)
                        and hasattr(first_barcode.product.retailer, 'get_effective_blob_folder')
                    ):
                        retailer_blob_folder = first_barcode.product.retailer.get_effective_blob_folder()
                    # Queue all barcodes in one request
                    blob_urls = queue_bulk_label_generation_via_azure(
                        barcodes_to_queue,
                        blob_folder=retailer_blob_folder or None,
                    )
                    
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
            display_code = item.get('short_code') or item['barcode_value']
            image_data_url = generate_label_image(
                product_name=item['product_name'],
                barcode_value=display_code,
                sku=display_code,
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
    tax_rate_name = serializers.CharField(source='tax_rate.name', read_only=True)
    line_total = serializers.SerializerMethodField()
    sold_count = serializers.SerializerMethodField()
    printed = serializers.BooleanField(source='is_printed', read_only=True)

    class Meta:
        model = PurchaseItem
        fields = ['id', 'retailer', 'product', 'product_name', 'product_sku', 'product_track_inventory', 'variant', 'variant_name', 'variant_sku', 'quantity', 'shop_quantity', 'warehouse_quantity', 'unit_price', 'selling_price', 'tax_rate', 'tax_rate_name', 'gst_percent', 'gst_inclusive', 'line_total', 'sold_count', 'printed', 'printed_at']
    
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


def reconcile_purchase_item_shop_warehouse(old_quantity, new_quantity, old_shop, old_wh):
    """Keep shop_quantity + warehouse_quantity aligned with line quantity when qty is edited.

    Decrease: remove from warehouse first, then shop (same as trimming bulk before retail).
    Increase: add the delta to shop (matches new lines: shop_quantity=quantity, warehouse=0).
    If stored shop+warehouse does not match old quantity, normalize before applying the change.
    """
    from decimal import Decimal, ROUND_HALF_UP

    old_quantity = Decimal(str(old_quantity))
    new_quantity = Decimal(str(new_quantity))
    old_shop = Decimal(str(old_shop or 0))
    old_wh = Decimal(str(old_wh or 0))

    if new_quantity == old_quantity:
        return old_shop, old_wh

    alloc_sum = old_shop + old_wh
    if old_quantity > 0 and alloc_sum != old_quantity:
        if alloc_sum > 0:
            old_shop = (old_shop * old_quantity / alloc_sum).quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)
            old_wh = old_quantity - old_shop
        else:
            old_shop, old_wh = old_quantity, Decimal('0')

    if new_quantity < old_quantity:
        delta_down = old_quantity - new_quantity
        take_from_wh = min(delta_down, old_wh)
        new_wh = old_wh - take_from_wh
        new_shop = old_shop - (delta_down - take_from_wh)
        if new_shop < 0 or new_wh < 0:
            if old_quantity > 0:
                new_shop = (old_shop * new_quantity / old_quantity).quantize(
                    Decimal('0.001'), rounding=ROUND_HALF_UP
                )
                new_wh = new_quantity - new_shop
            else:
                new_shop, new_wh = new_quantity, Decimal('0')
        return new_shop, new_wh

    delta_up = new_quantity - old_quantity
    return old_shop + delta_up, old_wh


class PurchaseSerializer(serializers.ModelSerializer):
    items = PurchaseItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    purchase_number = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    subtotal = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()

    class Meta:
        model = Purchase
        # purchase_number is generated in create() when omitted. DRF's auto UniqueTogetherValidator
        # for (retailer, purchase_number) would otherwise treat omitted purchase_number as missing
        # and fail with "required" before create() runs. Uniqueness is still enforced by the DB
        # constraint (partial unique on non-empty purchase_number).
        validators = []
        fields = [
            'id', 'retailer', 'purchase_number', 'supplier', 'supplier_name', 'purchase_date',
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
            # Use all_objects to include soft-deleted rows because DB unique
            # constraints still apply to them.
            while Purchase.all_objects.filter(purchase_number=purchase_number).exists():
                purchase_number = f"PUR-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
            validated_data['purchase_number'] = purchase_number
        
        items_data = self.context.get('items_data', [])
        
        # Use suspended cache signals to prevent mass invalidation during loop
        # Use suspended cache signals to prevent mass invalidation during loop
        purchase = super().create(validated_data)

        if not purchase.retailer_id:
            rid = None
            if purchase.supplier_id:
                from backend.parties.models import Supplier
                sup = Supplier.objects.filter(pk=purchase.supplier_id).only('retailer_id').first()
                if sup:
                    rid = sup.retailer_id
            if not rid:
                request = self.context.get('request')
                if request and request.user.is_authenticated:
                    rid = getattr(request.user, 'retailer_id', None)
            if rid:
                purchase.retailer_id = rid
                purchase.save(update_fields=['retailer_id'])
        
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
                # Draft can have placeholder lines with quantity 0 (user will fill later)
                if quantity <= 0 and purchase.status != 'draft':
                    raise serializers.ValidationError({
                        'items': f'Quantity must be greater than 0. Got {quantity}.'
                    })
                if quantity < 0:
                    quantity = Decimal('0')

                # Validate product is required
                if not product_id:
                    raise serializers.ValidationError('Product is required for purchase item')
                
                # Convert IDs to model instances
                try:
                    product = Product.objects.get(id=product_id, retailer_id=purchase.retailer_id)
                except Product.DoesNotExist:
                    raise serializers.ValidationError(f'Product with id {product_id} does not exist')
                
                # Variant is optional - only look it up if variant_id is provided and not empty
                variant = None
                if variant_id and variant_id not in [None, '', 0, '0']:
                    try:
                        variant = ProductVariant.objects.get(id=variant_id, retailer_id=purchase.retailer_id)
                    except ProductVariant.DoesNotExist:
                        raise serializers.ValidationError(f'ProductVariant with id {variant_id} does not exist')
                
                # Create purchase item with model instances
                tax_rate_obj = product.tax_rate
                gst_percent = item_data.get('gst_percent', None)
                if gst_percent in (None, ''):
                    gst_percent = getattr(tax_rate_obj, 'rate', 0) or 0
                purchase_item = PurchaseItem.objects.create(
                    purchase=purchase,
                    product=product,
                    variant=variant,
                    quantity=quantity,
                    shop_quantity=quantity,  # 0 for draft placeholders
                    warehouse_quantity=Decimal('0.000'),
                    unit_price=item_data.get('unit_price', 0) or 0,
                    selling_price=item_data.get('selling_price', None),
                    tax_rate=tax_rate_obj,
                    gst_percent=gst_percent or 0,
                    gst_inclusive=bool(item_data.get('gst_inclusive', False)),
                )
                # Generate barcodes only when quantity > 0 (no-op for 0)
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
                    store, warehouse = _get_purchase_location_or_raise(purchase)
                    
                    if warehouse:
                        stock, _ = Stock.objects.get_or_create(
                            product=purchase_item.product,
                            variant=purchase_item.variant,
                            store=None,
                            warehouse=warehouse,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        old_stock = stock.quantity
                        stock.quantity += quantity
                        stock.save()
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
                                    'location': f"Warehouse: {warehouse.name}",
                                }
                            )
                    elif store and purchase_item.shop_quantity > 0:
                        stock, _ = Stock.objects.get_or_create(
                            product=purchase_item.product,
                            variant=purchase_item.variant,
                            store=store,
                            warehouse=None,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        old_stock = stock.quantity
                        stock.quantity += purchase_item.shop_quantity
                        stock.save()
                        
                        # Audit log
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
                                    'quantity_added': str(purchase_item.shop_quantity),
                                    'stock_before': str(old_stock),
                                    'stock_after': str(stock.quantity),
                                    'location': f"Shop: {store.name}",
                                }
                            )
                    # Optional split quantity can go to warehouse if both channels are used.
                    elif purchase_item.shop_quantity > 0:
                        raise serializers.ValidationError(
                            {'detail': 'shop_quantity requires purchase.store to be set.'}
                        )

                    if purchase_item.warehouse_quantity > 0:
                        if not warehouse:
                            raise serializers.ValidationError(
                                {'detail': 'warehouse_quantity requires purchase.warehouse to be set.'}
                            )
                        stock, _ = Stock.objects.get_or_create(
                            product=purchase_item.product,
                            variant=purchase_item.variant,
                            store=None,
                            warehouse=warehouse,
                            defaults={'quantity': Decimal('0.000')}
                        )
                        old_stock = stock.quantity
                        stock.quantity += purchase_item.warehouse_quantity
                        stock.save()
                        
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
                                    'quantity_added': str(purchase_item.warehouse_quantity),
                                    'stock_before': str(old_stock),
                                    'stock_after': str(stock.quantity),
                                    'location': f"Warehouse: {warehouse.name}",
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

                    incoming_sell = matching_new_item.get('selling_price', old_item.selling_price)
                    old_sell = old_item.selling_price
                    incoming_gst = matching_new_item.get('gst_percent', None)
                    if incoming_gst in (None, ''):
                        expected_gst = getattr(old_item.product.tax_rate, 'rate', old_item.gst_percent) if old_item.product else old_item.gst_percent
                    else:
                        expected_gst = Decimal(str(incoming_gst))
                    old_gst = Decimal(str(old_item.gst_percent or 0))
                    incoming_inclusive = bool(matching_new_item.get('gst_inclusive', old_item.gst_inclusive))
                    old_inclusive = bool(old_item.gst_inclusive)

                    # Check if any editable field changed
                    if (
                        new_quantity != old_quantity
                        or new_price != old_price
                        or incoming_sell != old_sell
                        or Decimal(str(expected_gst)) != old_gst
                        or incoming_inclusive != old_inclusive
                    ):
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
                    store, warehouse = _get_purchase_location_or_raise(instance)
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

                if new_quantity != old_quantity:
                    sh, wh = reconcile_purchase_item_shop_warehouse(
                        old_quantity,
                        new_quantity,
                        old_item.shop_quantity,
                        old_item.warehouse_quantity,
                    )
                    old_item.shop_quantity = sh
                    old_item.warehouse_quantity = wh
                
                # Update item fields
                old_item.quantity = new_quantity
                old_item.unit_price = new_price
                old_item.selling_price = item_data.get('selling_price', old_item.selling_price)
                # Keep item linked to product tax rate unless explicitly overridden via gst_percent.
                old_item.tax_rate = old_item.product.tax_rate if old_item.product else old_item.tax_rate
                incoming_gst = item_data.get('gst_percent', None)
                if incoming_gst in (None, ''):
                    old_item.gst_percent = getattr(old_item.tax_rate, 'rate', old_item.gst_percent) or old_item.gst_percent
                else:
                    old_item.gst_percent = incoming_gst
                old_item.gst_inclusive = bool(item_data.get('gst_inclusive', old_item.gst_inclusive))
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
                    store, warehouse = _get_purchase_location_or_raise(instance)
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
                        store, warehouse = _get_purchase_location_or_raise(instance)
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

            # Create new items and update stock
            for item_data in items_to_create:
                product_id = item_data.get('product')
                variant_id = item_data.get('variant')
                quantity = Decimal(str(item_data.get('quantity', 0)))
                # Draft can have placeholder lines with quantity 0
                if quantity <= 0 and new_status != 'draft':
                    raise serializers.ValidationError({
                        'items': f'Quantity must be greater than 0. Got {quantity}.'
                    })
                if quantity < 0:
                    quantity = Decimal('0')

                # Validate product is required
                if not product_id:
                    raise serializers.ValidationError('Product is required for purchase item')
                
                # Convert IDs to model instances
                try:
                    product = Product.objects.get(id=product_id, retailer_id=instance.retailer_id)
                except Product.DoesNotExist:
                    raise serializers.ValidationError(f'Product with id {product_id} does not exist')
                
                # Variant is optional - only look it up if variant_id is provided and not empty
                variant = None
                if variant_id and variant_id not in [None, '', 0, '0']:
                    try:
                        variant = ProductVariant.objects.get(id=variant_id, retailer_id=instance.retailer_id)
                    except ProductVariant.DoesNotExist:
                        raise serializers.ValidationError(f'ProductVariant with id {variant_id} does not exist')
                
                # Create purchase item with model instances
                tax_rate_obj = product.tax_rate
                gst_percent = item_data.get('gst_percent', None)
                if gst_percent in (None, ''):
                    gst_percent = getattr(tax_rate_obj, 'rate', 0) or 0
                purchase_item = PurchaseItem.objects.create(
                    purchase=instance,
                    product=product,
                    variant=variant,
                    quantity=quantity,
                    shop_quantity=quantity,
                    warehouse_quantity=Decimal('0.000'),
                    unit_price=item_data.get('unit_price', 0),
                    selling_price=item_data.get('selling_price', None),
                    tax_rate=tax_rate_obj,
                    gst_percent=gst_percent or 0,
                    gst_inclusive=bool(item_data.get('gst_inclusive', False)),
                )
                
                # Generate barcodes ONLY if they don't exist yet
                from backend.catalog.models import Barcode
                existing_barcodes = Barcode.objects.filter(purchase_item=purchase_item).count()
                if existing_barcodes == 0:
                    # No barcodes exist, generate them
                    generate_barcodes_for_purchase_item(purchase_item, quantity)
                
                # Only update stock when purchase status is 'finalized'
                if new_status == 'finalized':
                    store, warehouse = _get_purchase_location_or_raise(instance)
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
            
            with transaction.atomic():
                # Soft-delete barcodes for this purchase that are NOT protected (sold or in-cart)
                barcodes_to_delete = Barcode.objects.filter(
                    purchase=instance
                ).exclude(
                    tag__in=['sold', 'in-cart']  # Exclude protected barcodes (sold or in-cart) - they should be kept
                )
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
                            'barcodes_soft_deleted': deleted_count,
                            'note': 'Non-sold barcodes soft-deleted, product kept'
                        }
                    )
        
        # Handle status change to finalized (when items_data is None, just status change)
        if items_data is None and old_status != 'finalized' and new_status == 'finalized':
            # Update stock for all items when finalizing
            from backend.inventory.models import Stock
            from decimal import Decimal
            
            for item in instance.items.all():
                store, warehouse = _get_purchase_location_or_raise(instance)
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
