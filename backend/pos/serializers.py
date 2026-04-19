from decimal import Decimal
from rest_framework import serializers
from django.db.models import Q, F, Value, Case, When, Sum, DecimalField, ExpressionWrapper
from .models import POSSession, Cart, CartItem, Invoice, InvoiceItem, Payment, Return, ReturnItem, CreditNote, Exchange, Repair, Expenses


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
        """Return display labels (short_code or barcode) for each scanned barcode for UI.
        When context has 'sold_barcode_ids' (e.g. Active Carts Overview), barcodes already on paid/credit
        invoices are excluded so we don't show sold barcodes in stale carts."""
        from backend.catalog.models import Barcode
        if not obj.scanned_barcodes:
            return []
        sold_barcode_ids = self.context.get('sold_barcode_ids') or set()
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
                    # In overview context: do not show barcodes that are already on paid/credit invoice (stale cart)
                    if sold_barcode_ids and barcode_obj.id in sold_barcode_ids:
                        continue
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

        # For non-tracked products or when scanned_barcodes is empty, primary or single catalog barcode only
        if obj.product:
            from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

            product_barcode = single_barcode_for_untracked_product(obj.product)
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
        
        # For non-tracked products or when scanned_barcodes is empty, primary or single catalog barcode only
        if obj.product:
            from backend.catalog.barcode_resolution import single_barcode_for_untracked_product

            product_barcode = single_barcode_for_untracked_product(obj.product)
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
        snap = (getattr(obj, 'sold_barcode_value', None) or '').strip()
        return snap or None

    def get_barcode_full(self, obj):
        """Return the full barcode string."""
        if obj.barcode:
            return obj.barcode.barcode
        snap = (getattr(obj, 'sold_barcode_value', None) or '').strip()
        return snap or None

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
        fields = ['id', 'product', 'product_name', 'product_sku', 'product_brand_name', 'product_purchase_price', 'product_selling_price', 'product_can_go_below_purchase_price', 'product_track_inventory', 'variant', 'barcode', 'sold_barcode_value', 'barcode_value', 'barcode_full', 'barcode_id', 'quantity', 'unit_price', 'manual_unit_price', 'purchase_price', 'discount_amount', 'tax_amount', 'line_total', 'original_invoice', 'original_invoice_item', 'replacement_return_tag', 'accepted_return_price', 'original_sold_unit_price', 'original_sold_line_total', 'original_invoice_number', 'original_customer_name', 'replaced_quantity', 'replaced_at', 'replaced_by', 'available_quantity']


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'invoice', 'payment_method', 'amount', 'reference', 'notes', 'created_by', 'created_at']


class ExpenseSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    last_updated_by_username = serializers.CharField(source='last_updated_by.username', read_only=True)

    class Meta:
        model = Expenses
        fields = [
            'id',
            'expense_date',
            'expense_type',
            'lender_name',
            'borrower_name',
            'payment_choices_type',
            'expense_amount',
            'created_on',
            'created_by',
            'created_by_username',
            'last_updated_on',
            'last_updated_by',
            'last_updated_by_username',
        ]
        read_only_fields = ['created_on', 'created_by', 'last_updated_on', 'last_updated_by']


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
    display_total = serializers.SerializerMethodField()
    computed_total = serializers.SerializerMethodField()
    computed_paid = serializers.SerializerMethodField()

    customer = serializers.PrimaryKeyRelatedField(
        queryset=Invoice._meta.get_field('customer').related_model.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'cart', 'store', 'store_name', 'customer', 'customer_name', 'customer_group_name', 'status',
            'invoice_type', 'subtotal', 'discount_amount', 'tax_amount', 'total', 'display_total', 'computed_total', 'computed_paid', 'paid_amount', 'due_amount',
            'trade_in_credit', 'pos_trade_ins', 'exchange_snapshots',
            'is_replacement_return', 'replacement_mode', 'replacement_customer_warning', 'replacement_source_customers',
            'notes', 'repair', 'created_by', 'created_at', 'updated_at', 'pending_cleared_at',
            'is_edited', 'edited_on', 'items', 'payments'
        ]
        read_only_fields = ['pending_cleared_at']

    def get_display_total(self, obj):
        """
        Pending invoice amount for UI:
        - include ONLY unpriced items (no entered manual/unit price)
        - for unpriced items, fallback to purchase price
        """
        if obj.invoice_type != 'pending':
            return float(obj.total or Decimal('0.00'))

        effective_pending_purchase_price = Case(
            When(purchase_price__gt=0, then=F('purchase_price')),
            When(barcode__purchase_item__unit_price__isnull=False, then=F('barcode__purchase_item__unit_price')),
            default=Value(Decimal('0.00')),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )
        pending_item_amount_expr = ExpressionWrapper(
            F('quantity') * effective_pending_purchase_price,
            output_field=DecimalField(max_digits=18, decimal_places=2),
        )
        pending_total = InvoiceItem.objects.filter(
            invoice=obj,
            quantity__gt=0
        ).filter(
            Q(manual_unit_price__isnull=True) | Q(manual_unit_price__lte=0),
            Q(unit_price__isnull=True) | Q(unit_price__lte=0),
        ).aggregate(
            total=Sum(pending_item_amount_expr, output_field=DecimalField(max_digits=18, decimal_places=2))
        )['total'] or Decimal('0.00')

        return float(pending_total)

    def get_computed_total(self, obj):
        """
        Precomputed list value for Total column (Invoices and Repairs list pages).
        When annotations exist: _items_total_agg = sum(quantity * purchase_price) — always cost.
        Falls back per list profile when no items (e.g. repair_list uses display_total or total).
        """
        item_count = getattr(obj, '_items_count', None)
        if item_count is not None and int(item_count) > 0:
            return float(getattr(obj, '_items_total_agg', Decimal('0.00')) or Decimal('0.00'))

        amount_profile = self.context.get('amount_profile')
        if amount_profile == 'repair_list':
            return float(self.get_display_total(obj) or obj.total or Decimal('0.00'))
        # Invoices page intentionally showed 0 when items are absent.
        return 0.0

    def get_computed_paid(self, obj):
        """
        Precomputed list value for Paid column.
        Uses queryset annotations when available; falls back per list profile behavior.
        """
        item_count = getattr(obj, '_items_count', None)
        if item_count is not None and int(item_count) > 0:
            return float(getattr(obj, '_items_paid_agg', Decimal('0.00')) or Decimal('0.00'))

        amount_profile = self.context.get('amount_profile')
        if amount_profile == 'repair_list':
            paid_amount = obj.paid_amount or Decimal('0.00')
            if paid_amount > 0:
                return float(paid_amount)
        return float(obj.total or Decimal('0.00'))


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

