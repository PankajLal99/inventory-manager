from decimal import Decimal

from rest_framework import serializers

from backend.parties.models import CustomerGroup

from .models import (
    CreditCart,
    CreditCartItem,
    CreditCustomer,
    CreditInvoice,
    CreditInvoiceItem,
    CreditLedgerEntry,
    CreditPayment,
    CreditProduct,
    CreditReturn,
    CreditReturnItem,
)


def _whole_qty(value):
    """Serialize qty as int when it is a whole number (avoids '3.000' in API/UI)."""
    if value is None:
        return value
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    if d == d.to_integral_value():
        return int(d)
    return float(d)


class CreditCustomerSerializer(serializers.ModelSerializer):
    linked_customer_name = serializers.CharField(source='linked_customer.name', read_only=True, allow_null=True)
    customer_group_name = serializers.CharField(source='customer_group.name', read_only=True, allow_null=True)

    class Meta:
        model = CreditCustomer
        fields = [
            'id', 'name', 'phone', 'email', 'address',
            'linked_customer', 'linked_customer_name',
            'customer_group', 'customer_group_name',
            'balance', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['balance', 'created_at', 'updated_at']

    def create(self, validated_data):
        if not validated_data.get('customer_group'):
            group, _ = CustomerGroup.objects.get_or_create(
                name='Credit',
                defaults={
                    'description': 'POS Credit customers',
                    'discount_percentage': Decimal('0.00'),
                    'is_active': True,
                },
            )
            validated_data['customer_group'] = group
        return super().create(validated_data)


class CreditProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditProduct
        fields = [
            'id', 'name', 'sku', 'unit_price', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class CreditCartItemSerializer(serializers.ModelSerializer):
    product_display_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditCartItem
        fields = [
            'id', 'cart', 'product', 'credit_product', 'product_name',
            'product_display_name', 'quantity', 'unit_price', 'line_total',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['line_total', 'created_at', 'updated_at']

    def get_product_display_name(self, obj):
        if obj.product_name:
            return obj.product_name
        if obj.product_id and obj.product:
            return obj.product.name
        if obj.credit_product_id and obj.credit_product:
            return obj.credit_product.name
        return ''

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['quantity'] = _whole_qty(instance.quantity)
        return data


class CreditCartSerializer(serializers.ModelSerializer):
    items = CreditCartItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True, allow_null=True)
    store_name = serializers.CharField(source='store.name', read_only=True, allow_null=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = CreditCart
        fields = [
            'id', 'cart_number', 'store', 'store_name', 'customer', 'customer_name',
            'status', 'locked', 'created_by', 'created_at', 'updated_at', 'items', 'total',
        ]
        read_only_fields = ['cart_number', 'status', 'created_by', 'created_at', 'updated_at']

    def get_total(self, obj):
        return sum((item.line_total for item in obj.items.all()), Decimal('0.00'))


class CreditInvoiceItemSerializer(serializers.ModelSerializer):
    returnable_quantity = serializers.SerializerMethodField()

    class Meta:
        model = CreditInvoiceItem
        fields = [
            'id', 'invoice', 'product', 'credit_product', 'product_name',
            'quantity', 'unit_price', 'line_total', 'returned_quantity', 'returnable_quantity',
        ]

    def get_returnable_quantity(self, obj):
        return _whole_qty(obj.returnable_quantity)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['quantity'] = _whole_qty(instance.quantity)
        data['returned_quantity'] = _whole_qty(instance.returned_quantity)
        return data


class CreditInvoiceSerializer(serializers.ModelSerializer):
    items = CreditInvoiceItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True, allow_null=True)
    customer_phone = serializers.CharField(source='customer.phone', read_only=True, allow_null=True)
    customer_group_id = serializers.IntegerField(source='customer.customer_group_id', read_only=True, allow_null=True)
    customer_group_name = serializers.CharField(source='customer.customer_group.name', read_only=True, allow_null=True)
    store_name = serializers.CharField(source='store.name', read_only=True, allow_null=True)
    created_by_name = serializers.SerializerMethodField()
    customer_balance = serializers.SerializerMethodField()
    previous_balance = serializers.SerializerMethodField()

    class Meta:
        model = CreditInvoice
        fields = [
            'id', 'invoice_number', 'cart', 'store', 'store_name',
            'customer', 'customer_name', 'customer_phone',
            'customer_group_id', 'customer_group_name',
            'status', 'subtotal', 'discount_amount', 'tax_amount', 'total',
            'customer_balance', 'previous_balance',
            'notes', 'created_by', 'created_by_name', 'created_at', 'updated_at',
            'voided_at', 'voided_by', 'items',
        ]
        read_only_fields = [
            'invoice_number', 'status', 'subtotal', 'discount_amount', 'tax_amount',
            'total', 'created_by', 'created_at', 'updated_at', 'voided_at', 'voided_by',
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_customer_balance(self, obj):
        if not obj.customer_id:
            return Decimal('0')
        return obj.customer.balance or Decimal('0')

    def get_previous_balance(self, obj):
        if not obj.customer_id:
            return Decimal('0')
        bal = obj.customer.balance or Decimal('0')
        total = obj.total or Decimal('0')
        if obj.status == 'open':
            return bal - total
        return bal


class CreditReturnItemSerializer(serializers.ModelSerializer):
    invoice_number = serializers.SerializerMethodField()

    class Meta:
        model = CreditReturnItem
        fields = [
            'id', 'credit_return', 'invoice_item', 'invoice_number',
            'product', 'credit_product',
            'product_name', 'quantity', 'unit_price', 'line_total',
        ]

    def get_invoice_number(self, obj):
        if obj.invoice_item_id and obj.invoice_item and obj.invoice_item.invoice_id:
            return obj.invoice_item.invoice.invoice_number
        return None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['quantity'] = _whole_qty(instance.quantity)
        return data


class CreditReturnSerializer(serializers.ModelSerializer):
    items = CreditReturnItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source='customer.name', read_only=True, allow_null=True)
    customer_phone = serializers.CharField(source='customer.phone', read_only=True, allow_null=True)
    customer_group_name = serializers.CharField(
        source='customer.customer_group.name', read_only=True, allow_null=True
    )
    store_name = serializers.CharField(source='store.name', read_only=True, allow_null=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditReturn
        fields = [
            'id', 'return_number', 'store', 'store_name', 'customer', 'customer_name',
            'customer_phone', 'customer_group_name',
            'status', 'total', 'notes', 'created_by', 'created_by_name',
            'created_at', 'updated_at', 'items',
        ]
        read_only_fields = [
            'return_number', 'status', 'total', 'created_by', 'created_at', 'updated_at',
        ]

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class CreditPaymentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True, allow_null=True)
    payment_method_display = serializers.CharField(source='get_payment_method_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditPayment
        fields = [
            'id', 'customer', 'customer_name', 'payment_method', 'payment_method_display',
            'amount', 'cash_amount', 'upi_amount', 'notes', 'paid_at',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class CreditLedgerEntrySerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True, allow_null=True)
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True, allow_null=True)
    return_number = serializers.CharField(source='credit_return.return_number', read_only=True, allow_null=True)
    payment_method = serializers.CharField(source='payment.payment_method', read_only=True, allow_null=True)
    txn_type = serializers.SerializerMethodField()
    vch_no = serializers.SerializerMethodField()
    particulars = serializers.SerializerMethodField()
    narration = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditLedgerEntry
        fields = [
            'id', 'customer', 'customer_name', 'invoice', 'invoice_number',
            'credit_return', 'return_number',
            'payment', 'payment_method',
            'entry_type', 'amount', 'description',
            'txn_type', 'vch_no', 'particulars', 'narration',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_txn_type(self, obj):
        if obj.payment_id:
            return 'payment'
        if obj.credit_return_id:
            return 'return'
        if obj.invoice_id:
            return 'sale'
        return 'adjustment'

    def get_vch_no(self, obj):
        if obj.invoice_id and obj.invoice:
            return obj.invoice.invoice_number
        if obj.credit_return_id and obj.credit_return:
            return obj.credit_return.return_number
        if obj.payment_id:
            return f'PAY-{obj.payment_id}'
        return f'ADJ-{obj.id}'

    def get_particulars(self, obj):
        if obj.payment_id:
            method = (obj.payment.payment_method if obj.payment else '') or ''
            labels = {'cash': 'Cr Cash', 'upi': 'Cr UPI', 'mixed': 'Cr Cash+UPI'}
            return labels.get(method, 'Cr Payment')
        if obj.credit_return_id:
            return 'Cr Return'
        if obj.entry_type == 'credit' and obj.invoice_id:
            return 'Cr Void Sale'
        if not obj.invoice_id and not obj.payment_id and not obj.credit_return_id:
            return 'Dr Adjustment' if obj.entry_type == 'debit' else 'Cr Adjustment'
        return 'Dr Sales'

    def get_narration(self, obj):
        if obj.payment_id and obj.payment:
            parts = []
            method = obj.payment.payment_method
            if method == 'mixed':
                parts.append(f'Cash {obj.payment.cash_amount} + UPI {obj.payment.upi_amount}')
            if obj.payment.notes:
                parts.append(obj.payment.notes)
            return ' · '.join(parts) if parts else (obj.description or '')
        return obj.description or ''


class SoldCreditProductSerializer(serializers.Serializer):
    """A returnable sale line from a customer's open credit invoices."""
    invoice_item_id = serializers.IntegerField()
    invoice_id = serializers.IntegerField()
    invoice_number = serializers.CharField()
    product_name = serializers.CharField()
    catalog_product_id = serializers.IntegerField(allow_null=True)
    credit_product_id = serializers.IntegerField(allow_null=True)
    sold_unit_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    sold_quantity = serializers.DecimalField(max_digits=10, decimal_places=3)
    returned_quantity = serializers.DecimalField(max_digits=10, decimal_places=3)
    returnable_quantity = serializers.DecimalField(max_digits=10, decimal_places=3)
    sold_at = serializers.DateTimeField()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        for key in ('sold_quantity', 'returned_quantity', 'returnable_quantity'):
            if key in data and data[key] is not None:
                data[key] = _whole_qty(data[key])
        return data


class MergedCustomerSearchSerializer(serializers.Serializer):
    """Unified search hit for credit POS customer picker."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    phone = serializers.CharField(allow_null=True, required=False)
    email = serializers.CharField(allow_blank=True, required=False)
    source = serializers.ChoiceField(choices=['credit', 'parties'])
    credit_customer_id = serializers.IntegerField(allow_null=True, required=False)
    parties_customer_id = serializers.IntegerField(allow_null=True, required=False)
    balance = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    customer_group_id = serializers.IntegerField(allow_null=True, required=False)
    customer_group_name = serializers.CharField(allow_blank=True, required=False)


class MergedProductSearchSerializer(serializers.Serializer):
    """Unified search hit for credit POS product picker (identity only — no prices/costs)."""
    id = serializers.IntegerField()
    name = serializers.CharField()
    sku = serializers.CharField(allow_null=True, required=False)
    source = serializers.ChoiceField(choices=['catalog', 'credit'])
    catalog_product_id = serializers.IntegerField(allow_null=True, required=False)
    credit_product_id = serializers.IntegerField(allow_null=True, required=False)
