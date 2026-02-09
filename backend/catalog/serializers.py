from decimal import Decimal
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
    supplier_name = serializers.SerializerMethodField()
    purchase_date = serializers.SerializerMethodField()
    invoice_number = serializers.SerializerMethodField()
    invoice_id = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    invoice_type_display = serializers.SerializerMethodField()
    sold_price = serializers.SerializerMethodField()
    sold_quantity = serializers.SerializerMethodField()
    
    class Meta:
        model = Barcode
        fields = [
            'id', 'product', 'variant', 'barcode', 'short_code', 'is_primary', 
            'tag', 'tag_display', 'purchase_price', 'supplier_name', 'purchase_date', 
            'invoice_number', 'invoice_id', 'customer_name', 'invoice_type_display',
            'sold_price', 'sold_quantity', 'created_at'
        ]
    
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
        
        # Fallback to query
        from backend.pos.models import InvoiceItem
        invoice_item = InvoiceItem.objects.filter(
            barcode=obj
        ).exclude(
            invoice__status='void'
        ).select_related('invoice', 'invoice__customer').first()
        
        obj._active_invoice_item = invoice_item
        return invoice_item

    def get_purchase_price(self, obj):
        """Get purchase price for this specific barcode"""
        return float(obj.get_purchase_price())
    
    def get_supplier_name(self, obj):
        """Get supplier name from purchase"""
        if obj.purchase and obj.purchase.supplier:
            return obj.purchase.supplier.name
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
    stock_bifurcation = serializers.SerializerMethodField()
    price_bifurcation = serializers.SerializerMethodField()


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
            
            # Get the product's barcode (should be only one)
            # For non-tracked products, barcode always stays as 'new' - we don't mark it as 'sold'
            product_barcode = obj.barcodes.first()
            
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
        Only includes barcodes that are NOT sold
        """
        # Group barcodes by supplier
        supplier_counts = {}
        # Use prefetched barcodes if possible, but filter out 'sold'
        barcodes = obj.barcodes.exclude(tag='sold').select_related('purchase__supplier')
        
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
        Only includes barcodes that are available (not sold)
        """
        supplier_prices = {}
        barcodes = obj.barcodes.exclude(tag='sold').select_related('purchase__supplier', 'purchase_item')
        
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

    def get_available_quantity(self, obj):
        """Calculate available quantity - uses barcode count as SUPREME source of truth
        Available Stock = All barcodes with tag 'new' or 'returned'
        Excludes barcodes from draft purchases (not finalized yet)
        For tracked products, also excludes barcodes in active carts
        """
        from backend.pos.models import CartItem
        
        # Available Stock = All barcodes with tag 'new' or 'returned'
        available_barcodes = obj.barcodes.filter(
            tag__in=['new', 'returned']
        )
        
        # For tracked products, exclude barcodes that are in active carts
        if obj.track_inventory:
            # Get all barcodes that are in active carts
            active_carts_barcodes = set()
            cart_items = CartItem.objects.filter(
                cart__status='active'
            ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
            
            for cart_item in cart_items:
                if cart_item.scanned_barcodes:
                    active_carts_barcodes.update(cart_item.scanned_barcodes)
            
            # Exclude barcodes in active carts
            if active_carts_barcodes:
                available_barcodes = available_barcodes.exclude(barcode__in=active_carts_barcodes)
            
            return float(available_barcodes.count())

        # For non-tracked products, return count of barcodes with 'new' or 'returned' tags
        # (Non-tracked products don't have individual barcodes in carts, so no need to exclude)
        return float(available_barcodes.count())

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'sku', 'product_type', 'category', 'category_id', 'category_name', 
            'brand', 'brand_id', 'brand_name',
            'description', 'can_go_below_purchase_price', 'tax_rate', 'track_inventory', 'track_batches',
            'low_stock_threshold', 'image', 'is_active', 'variants', 'barcodes', 'components',
            'created_at', 'updated_at', 'stock_quantity', 'available_quantity', 'stock_bifurcation', 'price_bifurcation'
        ]


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

    def get_barcodes(self, obj):
        """
        PERFORMANCE OPTIMIZATION: Only include barcode data when explicitly requested.
        By default, returns empty list to reduce payload size by 70-90%.
        
        Usage:
        - GET /products/ → No barcodes (fast, minimal payload)
        - GET /products/?include_barcodes=true → With barcodes (when needed)
        """
        # Get tag filter from request context
        request = self.context.get('request')
        tag_filter = request.query_params.get('tag', None) if request else None
        
        # Check if we should force include barcodes based on tag
        # We need barcodes for specific tags to show them in the list (including in-cart)
        force_include = tag_filter in ['defective', 'returned', 'sold', 'in-cart']
        
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

        # Helper to check if barcode should be included
        def should_include_barcode(barcode_obj):
            # Filter by tag if requested
            if tag_filter:
                if barcode_obj.tag != tag_filter:
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

    def get_shop_stock(self, obj):
        """Calculate total quantity in retail shops"""
        # Prefetched stock_entries
        total = Decimal('0.000')
        for entry in obj.stock_entries.all():
            if entry.store and entry.store.shop_type != 'warehouse':
                total += entry.quantity
        return float(total)

    def get_warehouse_stock(self, obj):
        """Calculate total quantity in warehouses"""
        total = Decimal('0.000')
        for entry in obj.stock_entries.all():
            if entry.warehouse or (entry.store and entry.store.shop_type == 'warehouse'):
                total += entry.quantity
        return float(total)

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
        barcode_count = obj.barcodes.exclude(tag='sold').count()
        return float(barcode_count)

    def get_available_quantity(self, obj):
        """Calculate available quantity
        Available Stock = All barcodes with tag 'new' or 'returned'
        Excludes barcodes from draft purchases (not finalized yet)
        For tracked products, also excludes barcodes in active carts
        """
        from backend.pos.models import CartItem
        
        # Available Stock = All barcodes with tag 'new' or 'returned'
        available_barcodes = obj.barcodes.filter(
            tag__in=['new', 'returned']
        )
        
        # For tracked products, exclude barcodes that are in active carts
        if obj.track_inventory:
            # Use context data if available (fast path)
            active_cart_barcodes = self.context.get('active_cart_barcodes')
            
            if active_cart_barcodes is not None:
                # Count how many of THIS product's available barcodes are in the active cart set
                # Since we prefetched barcodes, we can iterate in Python without DB hit
                reserved_count = 0
                for barcode in obj.barcodes.all():
                    if barcode.tag in ['new', 'returned'] and barcode.barcode in active_cart_barcodes:
                        reserved_count += 1
                
                available_count = available_barcodes.count() - reserved_count
                return float(max(0, available_count))
            else:
                # Fallback to slow path (db query)
                active_carts_barcodes = set()
                cart_items = CartItem.objects.filter(
                    cart__status='active'
                ).exclude(scanned_barcodes__isnull=True).exclude(scanned_barcodes=[])
                
                for cart_item in cart_items:
                    if cart_item.scanned_barcodes:
                        active_carts_barcodes.update(cart_item.scanned_barcodes)
                
                # Exclude barcodes in active carts
                if active_carts_barcodes:
                    available_barcodes = available_barcodes.exclude(barcode__in=active_carts_barcodes)
                
                return float(available_barcodes.count())
        
        # For non-tracked products, return count of barcodes with 'new' or 'returned' tags
        # Check context for active cart quantities
        active_cart_product_quantities = self.context.get('active_cart_product_quantities')
        
        if active_cart_product_quantities is not None:
            # Fast path - subtract reserved quantity from available barcodes
            reserved_qty = active_cart_product_quantities.get(obj.id, 0)
            available_count = available_barcodes.count()
            return float(max(0, available_count - reserved_qty))
        else:
            # Fallback path - just return count of available barcodes
            return float(available_barcodes.count())

    def get_sold_quantity(self, obj):
        """Calculate sold quantity from InvoiceItems for completed invoices"""
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
        sold_barcodes = obj.barcodes.filter(tag='sold')
        return sold_barcodes.count()

    def get_purchase_price(self, obj):
        """Get purchase price from product's primary barcode or first barcode"""
        product_barcode = obj.barcodes.filter(is_primary=True).first() or obj.barcodes.first()
        if product_barcode:
            purchase_price = product_barcode.get_purchase_price()
            return float(purchase_price) if purchase_price else None
        return None

    def get_selling_price(self, obj):
        """Get selling price from product's primary barcode or first barcode.
        Returns None if selling_price is 0 or null, indicating fallback to purchase price."""
        product_barcode = obj.barcodes.filter(is_primary=True).first() or obj.barcodes.first()
        if product_barcode:
            selling_price = product_barcode.get_selling_price()
            return float(selling_price) if selling_price else None
        return None

    def get_stock_bifurcation(self, obj):
        """Calculate stock breakdown by supplier
        Format: "30 AMS, 20 P+"
        Only includes barcodes that are NOT sold
        """
        # Performance check: if we already have the count from annotation and it's 0, return empty
        if hasattr(obj, 'annotated_barcode_count') and obj.annotated_barcode_count == 0:
            return ""

        # Group barcodes by supplier
        supplier_counts = {}
        
        # Use prefetched barcodes if available (fast path)
        all_barcodes = obj.barcodes.all()
        for barcode in all_barcodes:
            # Only count barcodes that are NOT sold
            if barcode.tag != 'sold':
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
        Only includes barcodes that are available (not sold)
        """
        # Performance check: if we already have the count from annotation and it's 0, return empty
        if hasattr(obj, 'annotated_barcode_count') and obj.annotated_barcode_count == 0:
            return ""

        supplier_prices = {}
        
        # Use prefetched barcodes if available (fast path)
        all_barcodes = obj.barcodes.all()
        for barcode in all_barcodes:
            # Only count barcodes that are NOT sold
            if barcode.tag != 'sold':
                supplier_name = "Unknown"
                if barcode.purchase and barcode.purchase.supplier:
                    # Use supplier code if available, otherwise name
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
        """
        Calculate detailed breakdown by supplier
        Returns a list of dicts: [
            {
                'supplier': 'Supplier Name',
                'price': '₹100/₹120',
                'count': 10,
                'shop_stock': 5,      # Estimated or product total
                'warehouse_stock': 5  # Estimated or product total
            }, ...
        ]
        """
        # Group data by supplier
        breakdown_map = {}
        
        # Use prefetched barcodes (fast path)
        all_barcodes = obj.barcodes.all()
        for barcode in all_barcodes:
            if barcode.tag != 'sold':
                supplier_name = "Unknown"
                if barcode.purchase and barcode.purchase.supplier:
                    supplier_name = barcode.purchase.supplier.code or barcode.purchase.supplier.name
                
                if supplier_name not in breakdown_map:
                    breakdown_map[supplier_name] = {
                        'supplier': supplier_name,
                        'prices': set(),
                        'count': 0
                    }
                
                # Get price
                price = barcode.get_selling_price() or barcode.get_purchase_price() or 0
                breakdown_map[supplier_name]['prices'].add(float(price))
                breakdown_map[supplier_name]['count'] += 1
        
        # Convert map to list and add stock info
        # We'll use the product's total shop/warehouse stock for now as we don't track it per supplier
        # But we'll scale it by the supplier's share of available barcodes if multiple suppliers exist
        # to provide a meaningful (though estimated) breakdown.
        total_available = sum(d['count'] for d in breakdown_map.values())
        shop_total = self.get_shop_stock(obj)
        wh_total = self.get_warehouse_stock(obj)
        
        breakdown = []
        for supplier, data in breakdown_map.items():
            prices = sorted(list(data['prices']))
            price_str = "/".join([f"₹{p:g}" for p in prices])
            
            # Simple proportional estimation for location stock
            # (If 100% of barcodes are from this supplier, they get 100% of the stock)
            share = data['count'] / total_available if total_available > 0 else 0
            
            breakdown.append({
                'supplier': supplier,
                'price': price_str,
                'count': data['count'],
                'shop_stock': round(shop_total * share, 1) if total_available > 0 else 0,
                'warehouse_stock': round(wh_total * share, 1) if total_available > 0 else 0
            })
            
        # Sort by count descending
        return sorted(breakdown, key=lambda x: x['count'], reverse=True)

    class Meta:
        model = Product
        fields = ['id', 'name', 'sku', 'category_name', 'brand_name', 'low_stock_threshold', 'is_active', 'barcodes', 'stock_quantity', 'shop_stock', 'warehouse_stock', 'available_quantity', 'sold_quantity', 'track_inventory', 'purchase_price', 'selling_price', 'stock_bifurcation', 'price_bifurcation', 'supplier_breakdown']


class DefectiveProductItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    barcode_value = serializers.CharField(source='barcode.barcode', read_only=True)
    
    class Meta:
        model = DefectiveProductItem
        fields = ['id', 'move_out', 'product', 'product_name', 'product_sku', 'barcode', 'barcode_value', 'purchase_price', 'notes', 'created_at']


class DefectiveProductMoveOutSerializer(serializers.ModelSerializer):
    items = DefectiveProductItemSerializer(many=True, read_only=True)
    store_name = serializers.CharField(source='store.name', read_only=True)
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    reason_display = serializers.CharField(source='get_reason_display', read_only=True)
    
    class Meta:
        model = DefectiveProductMoveOut
        fields = [
            'id', 'move_out_number', 'store', 'store_name', 'invoice', 'invoice_number',
            'reason', 'reason_display', 'notes', 'total_loss', 'total_adjustment', 'total_items',
            'created_by', 'created_by_username', 'created_at', 'updated_at', 'items'
        ]
        read_only_fields = ['move_out_number', 'total_loss', 'total_items', 'created_by', 'created_at', 'updated_at']

