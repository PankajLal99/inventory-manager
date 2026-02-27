from rest_framework import serializers
from .models import POSSession, Cart, CartItem, Invoice, InvoiceItem, Payment, Return, ReturnItem, CreditNote, Exchange, Repair


class CartItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_brand_name = serializers.SerializerMethodField()
    product_supplier_name = serializers.SerializerMethodField()
    product_purchase_price = serializers.SerializerMethodField()
    product_selling_price = serializers.SerializerMethodField()
    product_can_go_below_purchase_price = serializers.BooleanField(source='product.can_go_below_purchase_price', read_only=True)
    product_track_inventory = serializers.BooleanField(source='product.track_inventory', read_only=True)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    purchase_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    cart = serializers.PrimaryKeyRelatedField(read_only=True)
    scanned_barcodes = serializers.JSONField(required=False, allow_null=True)
    scanned_barcodes_display = serializers.SerializerMethodField()

    def get_product_brand_name(self, obj):
        """Get product brand name"""
        if obj.product and obj.product.brand:
            return obj.product.brand.name
        return None

    def get_product_supplier_name(self, obj):
        """Get supplier name from first scanned barcode's purchase (for same product, different supplier = separate rows)."""
        from backend.catalog.models import Barcode
        if not obj.scanned_barcodes:
            return None
        first_bc = str((obj.scanned_barcodes or [])[0] or '').strip().upper()
        if not first_bc:
            return None
        try:
            barcode_obj = None
            try:
                barcode_obj = Barcode.objects.get(barcode=first_bc)
            except Barcode.DoesNotExist:
                try:
                    barcode_obj = Barcode.objects.get(short_code=first_bc)
                except Barcode.DoesNotExist:
                    pass
            if barcode_obj and barcode_obj.purchase_item and barcode_obj.purchase_item.purchase and barcode_obj.purchase_item.purchase.supplier:
                return barcode_obj.purchase_item.purchase.supplier.name or barcode_obj.purchase_item.purchase.supplier.code
        except Exception:
            pass
        return None

    class Meta:
        model = CartItem
        fields = ['id', 'cart', 'product', 'product_name', 'product_sku', 'product_brand_name', 'product_supplier_name', 'product_purchase_price', 'product_selling_price', 'product_can_go_below_purchase_price', 'product_track_inventory', 'variant', 'quantity', 'unit_price', 'manual_unit_price', 'purchase_price', 'discount_amount', 'tax_amount', 'scanned_barcodes', 'scanned_barcodes_display']

    def get_scanned_barcodes_display(self, obj):
        """Return display labels (short_code or barcode) for each scanned barcode for UI."""
        from backend.catalog.models import Barcode
        if not obj.scanned_barcodes:
            return []
        result = []
        for barcode_str in obj.scanned_barcodes:
            if not barcode_str:
                result.append('')
                continue
            try:
                # Exact match only, standardized to .upper(): try barcode then short_code
                b_upper = str(barcode_str or '').strip().upper()
                barcode_obj = None
                try:
                    barcode_obj = Barcode.objects.get(barcode=b_upper)
                except Barcode.DoesNotExist:
                    try:
                        barcode_obj = Barcode.objects.get(short_code=b_upper)
                    except Barcode.DoesNotExist:
                        pass
                if barcode_obj:
                    result.append(barcode_obj.short_code or barcode_obj.barcode)
                else:
                    result.append(barcode_str)
            except Exception:
                result.append(barcode_str)
        return result

    def get_product_purchase_price(self, obj):
        """Get purchase price - use barcode-specific price if available; for custom products use item's purchase_price."""
        from backend.catalog.models import Barcode

        # For custom/other products: use cart item's stored purchase_price if set
        if obj.product and obj.product.name and obj.product.name.startswith('Other -'):
            if obj.purchase_price is not None and obj.purchase_price > 0:
                return float(obj.purchase_price)
            return 0.00

        # If cart item has scanned barcodes, use exact match standardized to .upper()
        if obj.scanned_barcodes and len(obj.scanned_barcodes) > 0:
            val = str(obj.scanned_barcodes[0] or '').strip().upper()
            try:
                first_barcode = Barcode.objects.get(barcode=val)
                return float(first_barcode.get_purchase_price())
            except Barcode.DoesNotExist:
                try:
                    first_barcode = Barcode.objects.get(short_code=val)
                    return float(first_barcode.get_purchase_price())
                except Barcode.DoesNotExist:
                    pass

        # For non-tracked products or when scanned_barcodes is empty, get barcode from product's first barcode
        if obj.product:
            product_barcode = obj.product.barcodes.first()
            if product_barcode:
                return float(product_barcode.get_purchase_price())

        # No barcode available - return 0.00 (purchase price validation will be skipped)
        return 0.00
    
    def get_product_selling_price(self, obj):
        """Get selling price - use barcode-specific selling price if available.
        Returns None if selling_price is 0 or null, indicating fallback to purchase price."""
        from backend.catalog.models import Barcode
        
        # If cart item has scanned barcodes, use the first barcode's selling price
        if obj.scanned_barcodes and len(obj.scanned_barcodes) > 0:
            try:
                first_barcode = Barcode.objects.get(barcode=obj.scanned_barcodes[0])
                selling_price = first_barcode.get_selling_price()
                return float(selling_price) if selling_price else None
            except Barcode.DoesNotExist:
                pass
        
        # For non-tracked products or when scanned_barcodes is empty, get barcode from product's first barcode
        if obj.product:
            product_barcode = obj.product.barcodes.first()
            if product_barcode:
                selling_price = product_barcode.get_selling_price()
                return float(selling_price) if selling_price else None
        
        # No barcode available - return None (will fall back to purchase price)
        return None

    def create(self, validated_data):
        # Do NOT auto-populate unit_price - it must be entered manually
        # Ensure cart is set - prefer from context (cart object) over validated_data (cart ID)
        cart = self.context.get('cart')
        if cart:
            validated_data['cart'] = cart
        elif 'cart' not in validated_data:
            # If neither context nor validated_data has cart, this is an error
            raise serializers.ValidationError({'cart': 'Cart is required'})
        
        return super().create(validated_data)


class CartSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    cart_number = serializers.CharField(read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_phone = serializers.CharField(source='customer.phone', read_only=True)

    customer = serializers.PrimaryKeyRelatedField(
        queryset=Cart._meta.get_field('customer').related_model.objects.all(),
        required=False,
        allow_null=True
    )

    class Meta:
        model = Cart
        fields = ['id', 'cart_number', 'store', 'customer', 'customer_name', 'customer_phone', 'status', 'invoice_type', 'session', 'created_by', 'created_at', 'updated_at', 'locked', 'items']


class CartOverviewSerializer(serializers.ModelSerializer):
    """Read-only serializer for active carts overview: user, locked, items."""
    items = CartItemSerializer(many=True, read_only=True)
    created_by_username = serializers.SerializerMethodField()
    store_name = serializers.CharField(source='store.name', read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True, allow_null=True)

    class Meta:
        model = Cart
        fields = [
            'id', 'cart_number', 'store', 'store_name', 'status', 'locked',
            'created_by', 'created_by_username', 'customer', 'customer_name',
            'created_at', 'updated_at', 'items',
        ]

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None


class InvoiceItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_brand_name = serializers.SerializerMethodField()
    product_purchase_price = serializers.SerializerMethodField()
    product_selling_price = serializers.SerializerMethodField()
    product_can_go_below_purchase_price = serializers.BooleanField(source='product.can_go_below_purchase_price', read_only=True)
    product_track_inventory = serializers.BooleanField(source='product.track_inventory', read_only=True)
    barcode_value = serializers.SerializerMethodField()  # Display: short_code or barcode for UI
    barcode_full = serializers.SerializerMethodField()
    barcode_id = serializers.IntegerField(source='barcode.id', read_only=True)
    available_quantity = serializers.SerializerMethodField()

    def get_barcode_value(self, obj):
        """Return short_code when available for display, else full barcode."""
        if obj.barcode:
            return obj.barcode.short_code or obj.barcode.barcode
        return None

    def get_barcode_full(self, obj):
        """Return the full barcode string."""
        if obj.barcode:
            return obj.barcode.barcode
        return None

    def get_available_quantity(self, obj):
        """Calculate available quantity for replacement (quantity - replaced_quantity)"""
        return float(obj.quantity - obj.replaced_quantity)

    def get_product_brand_name(self, obj):
        """Get product brand name"""
        if obj.product and obj.product.brand:
            return obj.product.brand.name
        return None

    def get_product_purchase_price(self, obj):
        """Get purchase price: for custom/other products use item's purchase_price; else from barcode."""
        if obj.product and obj.product.name and obj.product.name.startswith('Other -'):
            if obj.purchase_price is not None and obj.purchase_price > 0:
                return float(obj.purchase_price)
            return None
        if obj.barcode:
            purchase_price = obj.barcode.get_purchase_price()
            return float(purchase_price) if purchase_price else None
        return None

    def get_product_selling_price(self, obj):
        """Get selling price from barcode if available.
        Returns None if selling_price is 0 or null, indicating fallback to purchase price."""
        if obj.barcode:
            selling_price = obj.barcode.get_selling_price()
            return float(selling_price) if selling_price else None
        return None

    class Meta:
        model = InvoiceItem
        fields = ['id', 'product', 'product_name', 'product_sku', 'product_brand_name', 'product_purchase_price', 'product_selling_price', 'product_can_go_below_purchase_price', 'product_track_inventory', 'variant', 'barcode', 'barcode_value', 'barcode_full', 'barcode_id', 'quantity', 'unit_price', 'manual_unit_price', 'purchase_price', 'discount_amount', 'tax_amount', 'line_total', 'replaced_quantity', 'replaced_at', 'replaced_by', 'available_quantity']


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'invoice', 'payment_method', 'amount', 'reference', 'notes', 'created_by', 'created_at']


class RepairSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)
    customer_name = serializers.CharField(source='invoice.customer.name', read_only=True)
    store_name = serializers.CharField(source='invoice.store.name', read_only=True)

    class Meta:
        model = Repair
        fields = [
            'id', 'invoice', 'invoice_number', 'customer_name', 'store_name',
            'contact_no', 'model_name', 'description', 'booking_amount', 'status', 'barcode',
            'delivery_date', 'created_at', 'updated_at', 'updated_by'
        ]
        read_only_fields = ['barcode', 'created_at', 'updated_at']


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_group_name = serializers.CharField(source='customer.customer_group.name', read_only=True, allow_null=True)
    store_name = serializers.CharField(source='store.name', read_only=True)
    repair = RepairSerializer(read_only=True)

    customer = serializers.PrimaryKeyRelatedField(
        queryset=Invoice._meta.get_field('customer').related_model.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'cart', 'store', 'store_name', 'customer', 'customer_name', 'customer_group_name', 'status',
            'invoice_type', 'subtotal', 'discount_amount', 'tax_amount', 'total', 'paid_amount', 'due_amount',
            'notes', 'repair', 'created_by', 'created_at', 'updated_at', 'is_edited', 'edited_on', 'items', 'payments'
        ]


class ReturnItemSerializer(serializers.ModelSerializer):
    product_name = serializers.SerializerMethodField()
    product_sku = serializers.SerializerMethodField()
    product_brand_name = serializers.SerializerMethodField()
    barcode_value = serializers.SerializerMethodField()

    class Meta:
        model = ReturnItem
        fields = ['id', 'invoice_item', 'product', 'product_name', 'product_sku', 'product_brand_name', 'barcode_value', 'quantity', 'condition', 'refund_amount']

    def get_product_name(self, obj):
        if obj.product_name:
            return obj.product_name
        if obj.invoice_item and obj.invoice_item.product:
            return obj.invoice_item.product.name
        return "Unknown Product"

    def get_product_sku(self, obj):
        if obj.product_sku:
            return obj.product_sku
        if obj.invoice_item and obj.invoice_item.product:
            return obj.invoice_item.product.sku
        return ""

    def get_product_brand_name(self, obj):
        product = obj.product or (obj.invoice_item.product if obj.invoice_item else None)
        if product and product.brand:
            return product.brand.name
        return None

    def get_barcode_value(self, obj):
        """Return short_code when available for display, else full barcode."""
        barcode_obj = obj.barcode or (obj.invoice_item.barcode if obj.invoice_item else None)
        if barcode_obj:
            return barcode_obj.short_code or barcode_obj.barcode
        return None


class ReturnSerializer(serializers.ModelSerializer):
    items = ReturnItemSerializer(many=True, read_only=True)

    class Meta:
        model = Return
        fields = ['id', 'return_number', 'invoice', 'status', 'reason', 'notes', 'created_by', 'created_at', 'updated_at', 'items']


class CreditNoteSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source='return_obj.invoice.invoice_number', read_only=True)
    invoice_id = serializers.IntegerField(source='return_obj.invoice.id', read_only=True)
    customer_name = serializers.SerializerMethodField()
    return_number = serializers.CharField(source='return_obj.return_number', read_only=True)
    return_details = ReturnSerializer(source='return_obj', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)

    def get_customer_name(self, obj):
        if obj.return_obj and obj.return_obj.invoice and obj.return_obj.invoice.customer:
            return obj.return_obj.invoice.customer.name
        return None

    class Meta:
        model = CreditNote
        fields = ['id', 'credit_note_number', 'return_obj', 'return_number', 'invoice_id', 'invoice_number', 'customer_name', 'amount', 'quantity', 'notes', 'created_by', 'created_by_username', 'created_at', 'return_details']

class CreditNoteDetailSerializer(CreditNoteSerializer):
    """Credit note with nested return and return items for detail view."""
    return_obj = ReturnSerializer(read_only=True)

    class Meta(CreditNoteSerializer.Meta):
        fields = ['id', 'credit_note_number', 'return_obj', 'return_number', 'invoice_id', 'invoice_number', 'customer_name', 'amount', 'notes', 'created_by', 'created_by_username', 'created_at', 'return_details']


class POSSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = POSSession
        fields = ['id', 'session_number', 'store', 'user', 'status', 'opening_cash', 'closing_cash', 'opened_at', 'closed_at']

