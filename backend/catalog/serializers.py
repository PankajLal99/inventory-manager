from decimal import Decimal
from django.db.models import Sum
from rest_framework import serializers
from .models import Category, Brand, TaxRate, Product, ProductVariant, Barcode, ProductComponent, DefectiveProductMoveOut, DefectiveProductItem


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'parent', 'description', 'is_active', 'created_at', 'updated_at']


class BrandSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brand
        fields = ['id', 'name', 'description', 'is_active', 'created_at', 'updated_at']


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = ['id', 'name', 'rate', 'is_active', 'created_at', 'updated_at']


class ProductVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariant
        fields = ['id', 'product', 'name', 'sku', 'attributes', 'is_active', 'created_at', 'updated_at']


class BarcodeSerializer(serializers.ModelSerializer):
    tag_display = serializers.CharField(source='get_tag_display', read_only=True)
    purchase_price = serializers.SerializerMethodField()
    selling_price = serializers.SerializerMethodField()
    supplier_name = serializers.SerializerMethodField()
    supplier_id = serializers.SerializerMethodField()
    purchase_date = serializers.SerializerMethodField()
    invoice_number = serializers.SerializerMethodField()
    invoice_id = serializers.SerializerMethodField()
    invoice_date = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    invoice_type_display = serializers.SerializerMethodField()
    sold_price = serializers.SerializerMethodField()
    sold_quantity = serializers.SerializerMethodField()
    defective_move_out_info = serializers.SerializerMethodField()
    
    class Meta:
        model = Barcode
        fields = [
            'id', 'product', 'variant', 'barcode', 'short_code', 'is_primary', 
            'tag', 'tag_display', 'purchase_price', 'selling_price', 'supplier_name', 'supplier_id',
            'purchase_date', 
            'invoice_number', 'invoice_id', 'invoice_date', 'customer_name', 'invoice_type_display',
            'sold_price', 'sold_quantity', 'defective_move_out_info', 'created_at'
        ]

    def _serialize_defective_move_out(self, move_out):
        if not move_out:
            return None
        return {
            'moved_out': True,
            'move_out_id': move_out.id,
            'move_out_number': move_out.move_out_number,
            'reason': move_out.get_reason_display(),
            'notes': move_out.notes or '',
            'sent_date': str(move_out.sent_date) if move_out.sent_date else None,
        }

    def get_defective_move_out_info(self, obj):
        """Return move-out info if this defective barcode is on a move-out item."""
        if obj.tag != 'defective':
            return None
        # Use prefetched data when available (from optimized list view)
        cache = getattr(obj, '_prefetched_objects_cache', None)
        if cache is not None and 'defective_move_outs' in cache:
            items = cache['defective_move_outs']
            if items:
                return self._serialize_defective_move_out(items[0].move_out)
            return None
        move_out_item = obj.defective_move_outs.select_related('move_out').first()
        if not move_out_item:
            return None
        return self._serialize_defective_move_out(move_out_item.move_out)
    
    def _get_active_invoice_item(self, obj):
        """Helper to get the active (non-void) invoice item for this barcode"""
        if hasattr(obj, '_active_invoice_item'):
            return obj._active_invoice_item
            
        # Check prefetched invoice_items first
        if hasattr(obj, 'invoice_items'):
            for invoice_item in obj.invoice_items.all():
                if invoice_item.invoice and invoice_item.invoice.status != 'void':
                    obj._active_invoice_item = invoice_item
                    return invoice_item
        
        # Fallback: barcode should appear on at most one non-void line — use get(), not first()
        from backend.pos.models import InvoiceItem

        try:
            invoice_item = InvoiceItem.objects.filter(
                barcode=obj
            ).exclude(
                invoice__status='void'
            ).select_related('invoice', 'invoice__customer').get()
        except InvoiceItem.DoesNotExist:
            invoice_item = None
        except InvoiceItem.MultipleObjectsReturned:
            invoice_item = None

        obj._active_invoice_item = invoice_item
        return invoice_item

    def get_purchase_price(self, obj):
        """Get purchase price for this specific barcode"""
        return float(obj.get_purchase_price())

    def get_selling_price(self, obj):
        """Get selling price for this barcode (from purchase_item or None)."""
        val = obj.get_selling_price()
        return float(val) if val is not None else None

    def get_supplier_name(self, obj):
        """Get supplier name from purchase (path A or path B)"""
        if obj.purchase and obj.purchase.supplier:
            return obj.purchase.supplier.name
        if obj.purchase_item and obj.purchase_item.purchase and obj.purchase_item.purchase.supplier:
            return obj.purchase_item.purchase.supplier.name
        return None

    def get_supplier_id(self, obj):
        """Get supplier ID from purchase (path A or path B)"""
        if obj.purchase and obj.purchase.supplier:
            return obj.purchase.supplier_id
        if obj.purchase_item and obj.purchase_item.purchase and obj.purchase_item.purchase.supplier:
            return obj.purchase_item.purchase.supplier_id
        return None
    
    def get_purchase_date(self, obj):
        """Get purchase date"""
        if obj.purchase:
            return obj.purchase.purchase_date.strftime('%Y-%m-%d')
        return None
    
    def get_invoice_number(self, obj):
        """Get invoice number if barcode is sold"""
        item = self._get_active_invoice_item(obj)
        return item.invoice.invoice_number if item and item.invoice else None
    
    def get_invoice_id(self, obj):
        """Get invoice ID if barcode is sold"""
        item = self._get_active_invoice_item(obj)
        return item.invoice.id if item and item.invoice else None

    def get_invoice_date(self, obj):
        """Get invoice date if barcode is sold"""
        item = self._get_active_invoice_item(obj)
        if item and item.invoice and item.invoice.created_at:
            return item.invoice.created_at.isoformat()
        return None

    def get_customer_name(self, obj):
        """Get customer name if sold"""
        item = self._get_active_invoice_item(obj)
        if item and item.invoice and item.invoice.customer:
            return item.invoice.customer.name
        return "Walk-in Customer" if item and item.invoice else None

    def get_invoice_type_display(self, obj):
        """Get human-readable invoice type"""
        item = self._get_active_invoice_item(obj)
        if item and item.invoice:
            return item.invoice.get_invoice_type_display()
        return None

    def get_sold_price(self, obj):
        """Get the price it was sold at"""
        item = self._get_active_invoice_item(obj)
        if item:
            # line_total is (unit_price - discount + tax) * quantity
            # For barcodes, quantity is usually 1.000, but we should be safe
            return float(item.line_total / item.quantity) if item.quantity > 0 else 0
        return None

    def get_sold_quantity(self, obj):
        """Get the quantity sold (usually 1 for barcodes)"""
        item = self._get_active_invoice_item(obj)
        return float(item.quantity) if item else None


class ProductComponentSerializer(serializers.ModelSerializer):
    component_product_name = serializers.CharField(source='component_product.name', read_only=True)

    class Meta:
        model = ProductComponent
        fields = ['id', 'component_product', 'component_product_name', 'quantity', 'created_at']


class ProductSerializer(serializers.ModelSerializer):
    variants = ProductVariantSerializer(many=True, read_only=True)
    barcodes = serializers.SerializerMethodField()
    components = ProductComponentSerializer(many=True, read_only=True)
    
    # For reading: return full nested objects
    category = CategorySerializer(read_only=True)
    brand = BrandSerializer(read_only=True)
    
    # For writing: accept integer IDs
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(),
        source='category',
        write_only=True,
        required=False,
        allow_null=True
    )
    brand_id = serializers.PrimaryKeyRelatedField(
        queryset=Brand.objects.all(),
        source='brand',
        write_only=True,
        required=False,
        allow_null=True
    )
    
    category_name = serializers.CharField(source='category.name', read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    sku = serializers.CharField(read_only=True)
    stock_quantity = serializers.SerializerMethodField()
    available_quantity = serializers.SerializerMethodField()
    shop_stock = serializers.SerializerMethodField()
    warehouse_stock = serializers.SerializerMethodField()
    stock_bifurcation = serializers.SerializerMethodField()
    price_bifurcation = serializers.SerializerMethodField()
    supplier_breakdown = serializers.SerializerMethodField()

    def get_stock_quantity(self, obj):
        """Calculate total stock quantity from barcodes - SUPREME SOURCE OF TRUTH
        Total Stock = All Barcodes count of product (regardless of tag)
        Excludes sold barcodes
        """
        # Count ALL barcodes, excluding sold
        barcode_count = obj.barcodes.exclude(tag='sold').count()
        return float(barcode_count)

    def get_barcodes(self, obj):
        # Only return barcodes that are not sold and not in active carts
        from backend.pos.models import CartItem
        
        # For non-tracked inventory products, we need special handling
        if not obj.track_inventory:
            # Get total quantity in all active carts for this product
            cart_items = CartItem.objects.filter(
                cart__status='active',
                product=obj
            )
            total_cart_quantity = sum(
                Decimal(str(item.quantity)) for item in cart_items
            )
            
            # Non-tracked: at most one representative barcode (primary, or exactly one row)
            from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

            product_barcode = single_barcode_for_untracked_product(obj)
            
            # If barcode exists and total cart quantity is less than 1, return the barcode
            # Otherwise, return empty list (all quantity is in carts)
            if product_barcode and total_cart_quantity < Decimal('1'):
                return [BarcodeSerializer(product_barcode).data]
            else:
                return []
        
        # For tracked inventory products, filter by tag
        # Include 'new' and 'returned' tags (both are available for sale)
        # Exclude 'in-cart' tags automatically - they're already reserved
        barcodes = obj.barcodes.filter(
            tag__in=['new', 'returned']
        )
        return BarcodeSerializer(barcodes, many=True).data

    def get_stock_bifurcation(self, obj):
        """Calculate stock breakdown by supplier
        Format: "30 AMS, 20 P+"
        Only includes available barcodes (new+returned)
        """
        # Group barcodes by supplier
        supplier_counts = {}
        # Only count available barcodes (new+returned)
        barcodes = obj.barcodes.filter(tag__in=['new', 'returned']).select_related('purchase__supplier')
        
        for barcode in barcodes:
            supplier_name = "Unknown"
            if barcode.purchase and barcode.purchase.supplier:
                # Use supplier code if available, otherwise name
                supplier_name = barcode.purchase.supplier.code or barcode.purchase.supplier.name
            
            supplier_counts[supplier_name] = supplier_counts.get(supplier_name, 0) + 1
            
        if not supplier_counts:
            return ""
            
        # Sort by count descending
        sorted_counts = sorted(supplier_counts.items(), key=lambda x: x[1], reverse=True)
        return ", ".join([f"{count} {name}" for name, count in sorted_counts])

    def get_price_bifurcation(self, obj):
        """Calculate price breakdown by supplier
        Format: "AMS: ₹100, P+: ₹120"
        Only includes available barcodes (new+returned)
        """
        supplier_prices = {}
        barcodes = obj.barcodes.filter(tag__in=['new', 'returned']).select_related('purchase__supplier', 'purchase_item')
        
        for barcode in barcodes:
            supplier_name = "Unknown"
            if barcode.purchase and barcode.purchase.supplier:
                supplier_name = barcode.purchase.supplier.code or barcode.purchase.supplier.name
            
            # Use selling_price if available and > 0, otherwise purchase_price
            price = barcode.get_selling_price() or barcode.get_purchase_price() or 0
            price_val = float(price)
            
            if supplier_name not in supplier_prices:
                supplier_prices[supplier_name] = set()
            supplier_prices[supplier_name].add(price_val)
            
        if not supplier_prices:
            return ""
            
        parts = []
        # Sort suppliers by name for consistency
        for supplier in sorted(supplier_prices.keys()):
            prices = sorted(list(supplier_prices[supplier]))
            price_str = "/".join([f"₹{p:g}" for p in prices])
            parts.append(f"{supplier}: {price_str}")
            
        return ", ".join(parts)

    def _shop_stock(self, obj):
        """Quantity in shop (store where shop_type != 'warehouse'). Used to cap available_quantity."""
        total = Decimal('0.000')
        for entry in obj.stock_entries.all():
            if entry.store and entry.store.shop_type != 'warehouse':
                total += entry.quantity
        return float(total)

    def _warehouse_stock(self, obj):
        """Quantity in warehouse. Used for fallback when no distribution data."""
        total = Decimal('0.000')
        for entry in obj.stock_entries.all():
            if entry.warehouse or (entry.store and entry.store.shop_type == 'warehouse'):
                total += entry.quantity
        return float(total)

    def get_available_quantity(self, obj):
        """Available to sell = barcode count with tag 'new' or 'returned'.
        Single source of truth: count of barcodes available for sale.
        """
        available_count = obj.barcodes.filter(tag__in=['new', 'returned']).count()
        return float(max(0, available_count))

    def get_shop_stock(self, obj):
        """Available in shop from purchase view = sum of (shop_quantity - sold) so it ties to supplier breakdown."""
        breakdown = _get_supplier_breakdown_for_product(obj, exclude_fully_zero_rows=False)
        return int(round(sum(b['shop_barcode_count'] for b in breakdown)))

    def get_warehouse_stock(self, obj):
        """Warehouse from purchase view so it ties to supplier breakdown."""
        breakdown = _get_supplier_breakdown_for_product(obj, exclude_fully_zero_rows=False)
        return int(round(sum(b['warehouse_stock'] for b in breakdown)))

    def get_supplier_breakdown(self, obj):
        """Breakdown for display.
        Default: hide rows where both shop and warehouse available are zero. If include_zero_shop_rows=true, show those too.
        """
        request = self.context.get('request')
        include_zero = False
        if request:
            include_zero = str(request.query_params.get('include_zero_shop_rows', '')).lower() in ('1', 'true', 'yes', 'y')
        return _get_supplier_breakdown_for_product(obj, exclude_fully_zero_rows=not include_zero)

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'sku', 'product_type', 'category', 'category_id', 'category_name', 
            'brand', 'brand_id', 'brand_name',
            'description', 'can_go_below_purchase_price', 'tax_rate', 'track_inventory', 'track_batches',
            'low_stock_threshold', 'image', 'is_active', 'variants', 'barcodes', 'components',
            'created_at', 'updated_at', 'stock_quantity', 'available_quantity', 'shop_stock', 'warehouse_stock',
            'stock_bifurcation', 'price_bifurcation', 'supplier_breakdown'
        ]


def _get_supplier_breakdown_for_product(obj, exclude_fully_zero_rows=False):
    """
    One row per purchase batch (PurchaseItem). Warehouse/Shop from that item; Shop Qty = available
    (shop_quantity - sold - in-cart) for that batch. Ordered by purchase date (newest first), then supplier name.
    If exclude_fully_zero_rows=True, omit rows where both shop and warehouse available qty are <= 0.
    """
    from backend.purchasing.models import PurchaseItem
    from django.db.models import Count

    items = (
        PurchaseItem.objects.filter(
            product=obj,
            purchase__status='finalized',
            purchase__deleted_at__isnull=True,
        )
        .select_related('purchase__supplier')
        .order_by(
            '-purchase__purchase_date',
            '-purchase__created_at',
            '-purchase__id',
            '-id',
        )
    )
    # Old behavior: derive shop availability from allocation math.
    # "used" means sold, defective, or currently in-cart from that purchase item.
    used_per_item = dict(
        obj.barcodes.filter(
            tag__in=['sold', 'defective', 'in-cart'],
            purchase_item_id__isnull=False
        )
        .values('purchase_item')
        .annotate(count=Count('id'))
        .values_list('purchase_item', 'count')
    )

    breakdown = []
    for item in items:
        whse_allocated = float(item.warehouse_quantity)
        shop_allocated = float(item.shop_quantity)
        used = float(used_per_item.get(item.id, 0))
        # Sales/cart only come from shop; warehouse items aren't sold at POS.
        shop_available = float(max(0, shop_allocated - used))
        whse_available = whse_allocated
        if shop_allocated == 0 and whse_allocated == 0 and shop_available == 0:
            continue
        if exclude_fully_zero_rows and shop_available <= 0 and whse_available <= 0:
            continue
        supplier_name = "Unknown"
        if item.purchase and item.purchase.supplier:
            supplier_name = item.purchase.supplier.code or item.purchase.supplier.name
        price_val = float(item.unit_price) if item.unit_price else 0
        price_str = f"₹{price_val:g}" if price_val else "—"
        selling_price_val = float(item.selling_price) if item.selling_price else 0
        selling_price_str = f"₹{selling_price_val:g}" if selling_price_val else "—"
        purchase_date_obj = item.purchase.purchase_date if item.purchase else None
        purchase_date = purchase_date_obj.strftime('%d-%m-%Y') if purchase_date_obj else None
        breakdown.append({
            'supplier': supplier_name,
            'price': price_str,
            'purchase_price_value': price_val,
            'selling_price': selling_price_str,
            'selling_price_value': selling_price_val,
            'shop_stock': shop_allocated,
            'warehouse_stock': whse_allocated,
            'shop_barcode_count': shop_available,
            'warehouse_available': whse_available,
            'purchase_date': purchase_date,
            'purchase_date_iso': purchase_date_obj.isoformat() if purchase_date_obj else None,
            'purchase_item_id': item.id,
        })
    breakdown.sort(
        key=lambda row: (row.get('purchase_date_iso') or '', row.get('purchase_item_id') or 0),
        reverse=True,
    )
    return breakdown


class ProductListSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    barcodes = serializers.SerializerMethodField()
    stock_quantity = serializers.SerializerMethodField()
    available_quantity = serializers.SerializerMethodField()
    sold_quantity = serializers.SerializerMethodField()
    supplier_breakdown = serializers.SerializerMethodField()
    shop_stock = serializers.SerializerMethodField()
    warehouse_stock = serializers.SerializerMethodField()
    stock_bifurcation = serializers.SerializerMethodField()
    price_bifurcation = serializers.SerializerMethodField()
    purchase_price = serializers.SerializerMethodField()
    selling_price = serializers.SerializerMethodField()

    def _get_tag_filter(self):
        """Get the current tag filter from request context."""
        request = self.context.get('request')
        return request.query_params.get('tag', None) if request else None

    def _is_lite(self):
        """Products page list: skip unused breakdown/price fields."""
        request = self.context.get('request')
        if not request:
            return False
        return str(request.query_params.get('lite', '')).lower() in ('true', '1', 'yes')

    def _include_prices(self):
        """PDF export needs prices/breakdown even when the list is in lite mode."""
        request = self.context.get('request')
        if not request:
            return False
        return str(request.query_params.get('include_prices', '')).lower() in ('true', '1', 'yes')

    def _needs_barcode_details(self):
        """Whether this tag filter requires individual barcode objects in the list.
        'sold' only needs an aggregate count; individual barcodes are fetched
        by the View SKU modal via a separate endpoint."""
        tag = self._get_tag_filter()
        return tag in ['defective', 'returned', 'unknown', 'in-cart']

    def _get_supplier_breakdown_cached(self, obj, exclude_fully_zero_rows=False):
        """
        Product search displays supplier stock/price breakdown in several fields.
        Cache it per product instance so serialization does not repeat the same
        PurchaseItem/barcode aggregation for shop stock, warehouse stock, prices,
        and the visible breakdown table.
        """
        cache = getattr(obj, '_supplier_breakdown_cache', None)
        if cache is None:
            cache = {}
            setattr(obj, '_supplier_breakdown_cache', cache)

        key = bool(exclude_fully_zero_rows)
        if key not in cache:
            cache[key] = _get_supplier_breakdown_for_product(
                obj,
                exclude_fully_zero_rows=exclude_fully_zero_rows,
            )
        return cache[key]

    def _get_prefetched_barcodes(self, obj):
        cache = getattr(obj, '_prefetched_objects_cache', {})
        return cache.get('barcodes')

    def get_barcodes(self, obj):
        """
        PERFORMANCE OPTIMIZATION: Only include barcode data when explicitly requested.
        By default, returns empty list to reduce payload size by 70-90%.
        
        Usage:
        - GET /products/ → No barcodes (fast, minimal payload)
        - GET /products/?include_barcodes=true → With barcodes (when needed)
        """
        request = self.context.get('request')
        tag_filter = request.query_params.get('tag', None) if request else None

        if self._is_lite():
            lite_map = self.context.get('lite_barcodes_by_product')
            if isinstance(lite_map, dict):
                return lite_map.get(obj.id, [])
            return []

        force_include = self._needs_barcode_details()
        
        # OPTIMIZATION: Check if barcodes should be included in response
        # Default to 'false' for better performance (smaller payload)
        include_barcodes = request.query_params.get('include_barcodes', 'false') if request else 'false'
        
        if include_barcodes.lower() != 'true' and not force_include:
            # Skip barcode serialization for better performance
            return []
        
        # Get active cart data from context (fast path)
        active_cart_barcodes = self.context.get('active_cart_barcodes', set())
        
        # If context is missing (fallback), use DB check (slow path)
        if 'active_cart_barcodes' not in self.context:
            from backend.pos.models import CartItem
            active_cart_barcodes = set()
            cart_items = CartItem.objects.filter(
                cart__status='active'
            ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
            for cart_item in cart_items:
                if cart_item.scanned_barcodes:
                    active_cart_barcodes.update(cart_item.scanned_barcodes)

        # Defective barcodes already linked to any move-out should not be shown
        # in the selectable defective list.
        moved_out_barcode_ids = self.context.get('moved_out_barcode_ids')
        if moved_out_barcode_ids is None and tag_filter == 'defective':
            moved_out_barcode_ids = set(
                DefectiveProductItem.objects.filter(
                    barcode__product=obj
                ).values_list('barcode_id', flat=True)
            )

        # Helper to check if barcode should be included
        def should_include_barcode(barcode_obj):
            # Filter by tag if requested
            if tag_filter:
                if barcode_obj.tag != tag_filter:
                    return False
                # For defective list, hide already moved-out barcodes.
                if tag_filter == 'defective' and moved_out_barcode_ids and barcode_obj.id in moved_out_barcode_ids:
                    return False
                return True
            
            # Default behavior (no tag filter):
            # Include 'new' and 'returned'
            if barcode_obj.tag in ['new', 'returned']:
                return True
            
            return False

        # Helper to check if barcode is in cart
        def is_in_cart(barcode_value):
            return barcode_value in active_cart_barcodes

        # Process barcodes in Python
        filtered_barcodes = []
        all_barcodes = obj.barcodes.all() # Uses prefetch cache
        
        # Special handling for non-tracked inventory
        if not obj.track_inventory:
             # Find first valid barcode
             # For non-tracked, we mainly need one barcode to show
            valid_barcode = all_barcodes[0] if all_barcodes else None
            
            if valid_barcode:
                # Check if "all stock" is in carts 
                # (Logic from original: total_cart_quantity < 1)
                # This is hard to do perfectly without queries, but strictly speaking 
                # non-tracked items don't really have specific "barcodes" that get reserved.
                # If we have a valid barcode, return it.
                return [BarcodeSerializer(valid_barcode).data]
            return []

        # Standard processing for tracked inventory
        for barcode in all_barcodes:
            if should_include_barcode(barcode):
                # If not filtering by specific tag, explicitly exclude in-cart items
                # (If filtering by tag, usually we want to see them if tag matches, 
                # but 'new'/'returned' implies available for sale, so exclude in-cart)
                if not tag_filter and is_in_cart(barcode.barcode):
                    continue
                
                filtered_barcodes.append(barcode)
        
        return BarcodeSerializer(filtered_barcodes, many=True).data

    def _get_new_returned_count(self, obj):
        """Count of barcodes with tag 'new' or 'returned' (available to sell)."""
        tag = self._get_tag_filter()
        if hasattr(obj, 'annotated_barcode_count') and tag in (None, 'new'):
            return float(obj.annotated_barcode_count)
        prefetched_barcodes = self._get_prefetched_barcodes(obj)
        if prefetched_barcodes is not None:
            return float(sum(1 for barcode in prefetched_barcodes if barcode.tag in ['new', 'returned']))
        return float(obj.barcodes.filter(tag__in=['new', 'returned']).count())

    def _get_shop_from_purchase(self, obj):
        """Shop qty from purchase only: sum of PurchaseItem.shop_quantity (no addition/subtraction)."""
        from backend.purchasing.models import PurchaseItem
        total = PurchaseItem.objects.filter(
            product=obj,
            purchase__status='finalized',
            purchase__deleted_at__isnull=True,
        ).aggregate(s=Sum('shop_quantity'))['s']
        return float(total or 0)

    def _get_warehouse_from_purchase(self, obj):
        """Warehouse qty from purchase only: sum of PurchaseItem.warehouse_quantity (no addition/subtraction)."""
        breakdown = self._get_supplier_breakdown_cached(obj, exclude_fully_zero_rows=False)
        return float(sum(row.get('warehouse_stock') or 0 for row in breakdown))

    def get_available_quantity(self, obj):
        """Available in shop view: (new+returned barcodes) minus warehouse qty from finalized purchases (floored at 0)."""
        nr = self._get_new_returned_count(obj)
        if self._is_lite():
            warehouse_map = self.context.get('warehouse_qty_by_product') or {}
            wh = float(warehouse_map.get(obj.id, 0) or 0)
            return float(max(0, nr - wh))
        wh = self._get_warehouse_from_purchase(obj)
        return float(max(0, nr - wh))

    def get_shop_stock(self, obj):
        """Shop available = sum of shop_barcode_count from supplier breakdown (accounts for sales)."""
        if self._is_lite() and not self._include_prices():
            return 0.0
        breakdown = self._get_supplier_breakdown_cached(obj, exclude_fully_zero_rows=False)
        return float(sum(b['shop_barcode_count'] for b in breakdown))

    def get_warehouse_stock(self, obj):
        """Warehouse available = sum of warehouse_available from supplier breakdown (accounts for sales)."""
        if self._is_lite() and not self._include_prices():
            warehouse_map = self.context.get('warehouse_qty_by_product') or {}
            return float(warehouse_map.get(obj.id, 0) or 0)
        breakdown = self._get_supplier_breakdown_cached(obj, exclude_fully_zero_rows=False)
        return float(sum(b.get('warehouse_available', b['warehouse_stock']) for b in breakdown))

    def get_stock_quantity(self, obj):
        """Calculate total stock quantity from barcodes - SUPREME SOURCE OF TRUTH
        Total Stock = All Barcodes count of product (regardless of tag)
        Uses annotated count if available to avoid N+1 queries
        """
        # Use annotated count if available (from list view)
        # Note: annotated count should count ALL barcodes, not just new/returned
        if hasattr(obj, 'annotated_barcode_count'):
            return float(obj.annotated_barcode_count)
            
        # Fallback for other views
        # Count ALL barcodes, excluding sold
        prefetched_barcodes = self._get_prefetched_barcodes(obj)
        if prefetched_barcodes is not None:
            return float(sum(1 for barcode in prefetched_barcodes if barcode.tag != 'sold'))

        barcode_count = obj.barcodes.exclude(tag='sold').count()
        return float(barcode_count)

    def get_sold_quantity(self, obj):
        """Calculate sold quantity from InvoiceItems for completed invoices"""
        # When viewing sold filter, annotated_barcode_count already has the sold count
        tag = self._get_tag_filter()
        if tag == 'sold' and hasattr(obj, 'annotated_barcode_count'):
            return int(obj.annotated_barcode_count)
        if self._is_lite() and tag != 'sold':
            return 0

        from backend.pos.models import InvoiceItem
        
        # For non-tracked inventory products, sum quantities from InvoiceItems
        if not obj.track_inventory:
            # Sum quantities from all InvoiceItems for this product in completed invoices
            invoice_items = InvoiceItem.objects.filter(
                product=obj,
                invoice__status__in=['paid', 'credit', 'partial'],
                invoice__invoice_type__in=['sale', 'credit']
            ).exclude(invoice__status='void')
            
            total_sold = sum(
                Decimal(str(item.quantity)) for item in invoice_items
            )
            return float(total_sold)
        
        # For tracked inventory products, count barcodes with 'sold' tag
        prefetched_barcodes = self._get_prefetched_barcodes(obj)
        if prefetched_barcodes is not None:
            return sum(1 for barcode in prefetched_barcodes if barcode.tag == 'sold')

        sold_barcodes = obj.barcodes.filter(tag='sold')
        return sold_barcodes.count()

    def get_purchase_price(self, obj):
        """Get purchase price from product's primary barcode or first barcode"""
        if not self._include_prices() and (self._is_lite() or self._get_tag_filter() == 'sold'):
            return None
        from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

        product_barcode = single_barcode_for_untracked_product(obj)
        if product_barcode:
            purchase_price = product_barcode.get_purchase_price()
            return float(purchase_price) if purchase_price else None

        # Fallback for tracked products / empty barcode payloads in search:
        # derive a representative purchase price from supplier breakdown rows.
        breakdown = self._get_supplier_breakdown_cached(obj, exclude_fully_zero_rows=False)
        max_purchase = 0.0
        for row in breakdown:
            value = float(row.get('purchase_price_value') or 0)
            if value > max_purchase:
                max_purchase = value
        if max_purchase > 0:
            return max_purchase
        return None

    def get_selling_price(self, obj):
        """Get selling price from product's primary barcode or first barcode.
        Returns None if selling_price is 0 or null, indicating fallback to purchase price."""
        if not self._include_prices() and (self._is_lite() or self._get_tag_filter() == 'sold'):
            return None
        from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

        product_barcode = single_barcode_for_untracked_product(obj)
        if product_barcode:
            selling_price = product_barcode.get_selling_price()
            return float(selling_price) if selling_price else None

        # Fallback for tracked products / empty barcode payloads in search:
        # prefer max selling price from supplier rows, then purchase price row value.
        breakdown = self._get_supplier_breakdown_cached(obj, exclude_fully_zero_rows=False)
        max_selling = 0.0
        max_purchase = 0.0
        for row in breakdown:
            selling_value = float(row.get('selling_price_value') or 0)
            purchase_value = float(row.get('purchase_price_value') or 0)
            if selling_value > max_selling:
                max_selling = selling_value
            if purchase_value > max_purchase:
                max_purchase = purchase_value
        if max_selling > 0:
            return max_selling
        if max_purchase > 0:
            return max_purchase
        return None

    def get_stock_bifurcation(self, obj):
        """Stock breakdown by supplier - AVAILABLE only (new+returned). Unknown/defective NOT counted."""
        if not self._include_prices() and (self._is_lite() or self._get_tag_filter() not in (None, 'new')):
            return ""
        if hasattr(obj, 'annotated_barcode_count') and obj.annotated_barcode_count == 0:
            return ""

        supplier_counts = {}
        all_barcodes = obj.barcodes.all()
        for barcode in all_barcodes:
            if barcode.tag in ['new', 'returned']:
                supplier_name = "Unknown"
                if barcode.purchase and barcode.purchase.supplier:
                    supplier_name = barcode.purchase.supplier.code or barcode.purchase.supplier.name
                supplier_counts[supplier_name] = supplier_counts.get(supplier_name, 0) + 1

        if not supplier_counts:
            return ""
            
        # Sort by count descending
        sorted_counts = sorted(supplier_counts.items(), key=lambda x: x[1], reverse=True)
        return ", ".join([f"{count} {name}" for name, count in sorted_counts])

    def get_price_bifurcation(self, obj):
        """Price breakdown by supplier - AVAILABLE only (new+returned). Unknown/defective NOT included."""
        if not self._include_prices() and (self._is_lite() or self._get_tag_filter() not in (None, 'new')):
            return ""
        if hasattr(obj, 'annotated_barcode_count') and obj.annotated_barcode_count == 0:
            return ""

        supplier_prices = {}
        all_barcodes = obj.barcodes.all()
        for barcode in all_barcodes:
            # Only include AVAILABLE (new+returned)
            if barcode.tag in ['new', 'returned']:
                supplier_name = "Unknown"
                if barcode.purchase and barcode.purchase.supplier:
                    supplier_name = barcode.purchase.supplier.code or barcode.purchase.supplier.name
                
                # Use selling_price if available and > 0, otherwise purchase_price
                price = barcode.get_selling_price() or barcode.get_purchase_price() or 0
                price_val = float(price)
                
                if supplier_name not in supplier_prices:
                    supplier_prices[supplier_name] = set()
                supplier_prices[supplier_name].add(price_val)
            
        if not supplier_prices:
            return ""
            
        parts = []
        # Sort suppliers by name for consistency
        for supplier in sorted(supplier_prices.keys()):
            prices = sorted(list(supplier_prices[supplier]))
            price_str = "/".join([f"₹{p:g}" for p in prices])
            parts.append(f"{supplier}: {price_str}")
            
        return ", ".join(parts)

    def get_supplier_breakdown(self, obj):
        if not self._include_prices() and (self._is_lite() or self._get_tag_filter() not in (None, 'new')):
            return []
        request = self.context.get('request')
        include_zero = False
        if request:
            include_zero = str(request.query_params.get('include_zero_shop_rows', '')).lower() in ('1', 'true', 'yes', 'y')
        return self._get_supplier_breakdown_cached(obj, exclude_fully_zero_rows=not include_zero)

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'sku', 'category_name', 'brand_name', 'low_stock_threshold', 'is_active', 'image',
            'barcodes', 'stock_quantity', 'shop_stock', 'warehouse_stock', 'available_quantity', 'sold_quantity',
            'track_inventory', 'purchase_price', 'selling_price', 'stock_bifurcation', 'price_bifurcation', 'supplier_breakdown',
        ]


class DefectiveProductItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    barcode_value = serializers.CharField(source='barcode.barcode', read_only=True)
    
    class Meta:
        model = DefectiveProductItem
        fields = ['id', 'move_out', 'product', 'product_name', 'product_sku', 'barcode', 'barcode_value', 'purchase_price', 'notes', 'created_at']


class DefectiveProductMoveOutSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    store_name = serializers.CharField(source='store.name', read_only=True)
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)
    customer_name = serializers.CharField(source='invoice.customer.name', read_only=True, default=None)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    reason_display = serializers.CharField(source='get_reason_display', read_only=True)

    def get_items(self, obj):
        if not self.context.get('include_items'):
            return []
        items = obj.items.all()
        return DefectiveProductItemSerializer(items, many=True).data
    
    class Meta:
        model = DefectiveProductMoveOut
        fields = [
            'id', 'move_out_number', 'store', 'store_name', 'invoice', 'invoice_number',
            'customer_name', 'reason', 'reason_display', 'notes', 'sent_date', 'total_loss', 'total_adjustment',
            'total_items', 'created_by', 'created_by_username', 'created_at', 'updated_at', 'items'
        ]
        read_only_fields = ['move_out_number', 'total_loss', 'total_items', 'created_by', 'created_at', 'updated_at']

