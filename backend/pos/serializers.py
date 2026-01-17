from rest_framework import serializers
from .models import POSSession, Cart, CartItem, Invoice, InvoiceItem, Payment, Return, ReturnItem, CreditNote, Exchange, Repair


class CartItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_brand_name = serializers.SerializerMethodField()
    product_purchase_price = serializers.SerializerMethodField()
    product_selling_price = serializers.SerializerMethodField()
    product_can_go_below_purchase_price = serializers.BooleanField(source='product.can_go_below_purchase_price', read_only=True)
    product_track_inventory = serializers.BooleanField(source='product.track_inventory', read_only=True)
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    cart = serializers.PrimaryKeyRelatedField(read_only=True)
    scanned_barcodes = serializers.JSONField(required=False, allow_null=True)

    def get_product_brand_name(self, obj):
        """Get product brand name"""
        if obj.product and obj.product.brand:
            return obj.product.brand.name
        return None

    class Meta:
        model = CartItem
        fields = ['id', 'cart', 'product', 'product_name', 'product_sku', 'product_brand_name', 'product_purchase_price', 'product_selling_price', 'product_can_go_below_purchase_price', 'product_track_inventory', 'variant', 'quantity', 'unit_price', 'manual_unit_price', 'discount_amount', 'tax_amount', 'scanned_barcodes']
    
    def get_product_purchase_price(self, obj):
        """Get purchase price - use barcode-specific price if available"""
        from backend.catalog.models import Barcode
        
        # If cart item has scanned barcodes, use the first barcode's purchase price
        if obj.scanned_barcodes and len(obj.scanned_barcodes) > 0:
            try:
                first_barcode = Barcode.objects.get(barcode=obj.scanned_barcodes[0])
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

    class Meta:
        model = Cart
        fields = ['id', 'cart_number', 'store', 'customer', 'customer_name', 'customer_phone', 'status', 'invoice_type', 'session', 'created_by', 'created_at', 'updated_at', 'items']


class InvoiceItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_brand_name = serializers.SerializerMethodField()
    product_purchase_price = serializers.SerializerMethodField()
    product_selling_price = serializers.SerializerMethodField()
    product_can_go_below_purchase_price = serializers.BooleanField(source='product.can_go_below_purchase_price', read_only=True)
    product_track_inventory = serializers.BooleanField(source='product.track_inventory', read_only=True)
    barcode_value = serializers.CharField(source='barcode.barcode', read_only=True)
    barcode_id = serializers.IntegerField(source='barcode.id', read_only=True)
    available_quantity = serializers.SerializerMethodField()

    def get_available_quantity(self, obj):
        """Calculate available quantity for replacement (quantity - replaced_quantity)"""
        return float(obj.quantity - obj.replaced_quantity)

    def get_product_brand_name(self, obj):
        """Get product brand name"""
        if obj.product and obj.product.brand:
            return obj.product.brand.name
        return None

    def get_product_purchase_price(self, obj):
        """Get purchase price from barcode if available"""
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
        fields = ['id', 'product', 'product_name', 'product_sku', 'product_brand_name', 'product_purchase_price', 'product_selling_price', 'product_can_go_below_purchase_price', 'product_track_inventory', 'variant', 'barcode', 'barcode_value', 'barcode_id', 'quantity', 'unit_price', 'manual_unit_price', 'discount_amount', 'tax_amount', 'line_total', 'replaced_quantity', 'replaced_at', 'replaced_by', 'available_quantity']


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
            'contact_no', 'model_name', 'booking_amount', 'status', 'barcode',
            'created_at', 'updated_at', 'updated_by'
        ]
        read_only_fields = ['barcode', 'created_at', 'updated_at']


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    store_name = serializers.CharField(source='store.name', read_only=True)
    repair = RepairSerializer(read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'cart', 'store', 'store_name', 'customer', 'customer_name', 'status',
            'invoice_type', 'subtotal', 'discount_amount', 'tax_amount', 'total', 'paid_amount', 'due_amount',
            'notes', 'repair', 'created_by', 'created_at', 'updated_at', 'items', 'payments'
        ]


class ReturnItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReturnItem
        fields = ['id', 'invoice_item', 'quantity', 'condition', 'refund_amount']


class ReturnSerializer(serializers.ModelSerializer):
    items = ReturnItemSerializer(many=True, read_only=True)

    class Meta:
        model = Return
        fields = ['id', 'return_number', 'invoice', 'status', 'reason', 'notes', 'created_by', 'created_at', 'updated_at', 'items']


class CreditNoteSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source='return_obj.invoice.invoice_number', read_only=True)
    invoice_id = serializers.IntegerField(source='return_obj.invoice.id', read_only=True)
    customer_name = serializers.CharField(source='return_obj.invoice.customer.name', read_only=True)
    return_number = serializers.CharField(source='return_obj.return_number', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    
    class Meta:
        model = CreditNote
        fields = ['id', 'credit_note_number', 'return_obj', 'return_number', 'invoice_id', 'invoice_number', 'customer_name', 'amount', 'notes', 'created_by', 'created_by_username', 'created_at']


class POSSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = POSSession
        fields = ['id', 'session_number', 'store', 'user', 'status', 'opening_cash', 'closing_cash', 'opened_at', 'closed_at']

