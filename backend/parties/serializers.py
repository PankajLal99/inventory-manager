from rest_framework import serializers
from decimal import Decimal
from backend.pos.models import Payment
from .models import Customer, CustomerGroup, Supplier, LedgerEntry, PersonalCustomer, PersonalLedgerEntry, InternalCustomer, InternalLedgerEntry, PaymentReminder


class CustomerGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerGroup
        fields = ['id', 'name', 'description', 'discount_percentage', 'is_active', 'created_at', 'updated_at']


class CustomerSerializer(serializers.ModelSerializer):
    customer_group_name = serializers.CharField(source='customer_group.name', read_only=True)

    class Meta:
        model = Customer
        fields = [
            'id', 'name', 'phone', 'email', 'address', 'customer_group', 'customer_group_name',
            'credit_limit', 'credit_balance', 'is_active', 'created_at', 'updated_at'
        ]


class SupplierSerializer(serializers.ModelSerializer):
    def validate_code(self, value):
        code = (value or '').strip()
        if not code:
            return code

        queryset = Supplier.objects.filter(code__iexact=code)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('Vendor code already exists. Please use a different code.')
        return code

    class Meta:
        model = Supplier
        fields = ['id', 'name', 'code', 'phone', 'email', 'address', 'contact_person', 'is_active', 'created_at', 'updated_at']


class LedgerEntrySerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_group_name = serializers.CharField(source='customer.customer_group.name', read_only=True)
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_at = serializers.DateTimeField(required=False, allow_null=True)  # Allow custom dates

    class Meta:
        model = LedgerEntry
        fields = [
            'id', 'customer', 'customer_name', 'customer_group_name', 'invoice', 'invoice_number',
            'entry_type', 'payment_mode', 'cash_amount', 'upi_amount', 'amount', 'quantity', 'description', 'is_sent', 'created_by', 'created_by_username', 'created_at'
        ]

    def validate(self, attrs):
        instance = getattr(self, 'instance', None)
        payment_mode = attrs.get('payment_mode', getattr(instance, 'payment_mode', 'other'))
        amount = attrs.get('amount', getattr(instance, 'amount', None))
        cash_amount = attrs.get('cash_amount', getattr(instance, 'cash_amount', None))
        upi_amount = attrs.get('upi_amount', getattr(instance, 'upi_amount', None))

        if payment_mode == 'mixed':
            if cash_amount is None or upi_amount is None:
                raise serializers.ValidationError('For mixed payment mode, both cash_amount and upi_amount are required.')
            if Decimal(str(cash_amount)) < Decimal('0.00') or Decimal(str(upi_amount)) < Decimal('0.00'):
                raise serializers.ValidationError('cash_amount and upi_amount cannot be negative.')
            if amount is None:
                raise serializers.ValidationError('Amount is required for mixed payment mode.')
            split_total = Decimal(str(cash_amount)) + Decimal(str(upi_amount))
            if split_total != Decimal(str(amount)):
                raise serializers.ValidationError('For mixed payment mode, cash_amount + upi_amount must match amount.')
        else:
            # Keep non-mixed entries clean; split values should not persist accidentally.
            attrs['cash_amount'] = None
            attrs['upi_amount'] = None

        return attrs


class PersonalCustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = PersonalCustomer
        fields = [
            'id', 'name', 'phone', 'email', 'address',
            'credit_balance', 'is_active', 'created_at', 'updated_at'
        ]


class PersonalLedgerEntrySerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_at = serializers.DateTimeField(required=False, allow_null=True)  # Allow custom dates

    class Meta:
        model = PersonalLedgerEntry
        fields = [
            'id', 'customer', 'customer_name',
            'entry_type', 'amount', 'description', 'created_by', 'created_by_username', 'created_at'
        ]


class InternalCustomerSerializer(serializers.ModelSerializer):
    customer_group_name = serializers.CharField(source='customer_group.name', read_only=True, allow_null=True)

    class Meta:
        model = InternalCustomer
        fields = [
            'id', 'name', 'phone', 'email', 'address',
            'customer_group', 'customer_group_name',
            'credit_balance', 'is_active', 'created_at', 'updated_at'
        ]


class InternalLedgerEntrySerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    created_at = serializers.DateTimeField(required=False, allow_null=True)  # Allow custom dates

    class Meta:
        model = InternalLedgerEntry
        fields = [
            'id', 'customer', 'customer_name',
            'entry_type', 'amount', 'description', 'created_by', 'created_by_username', 'created_at'
        ]


class PaymentReminderSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_group = serializers.IntegerField(source='customer.customer_group_id', read_only=True)
    customer_group_name = serializers.CharField(source='customer.customer_group.name', read_only=True, allow_null=True)
    settled_payment = serializers.PrimaryKeyRelatedField(queryset=Payment.objects.all(), required=False, allow_null=True)
    settled_payment_amount = serializers.CharField(source='settled_payment.amount', read_only=True)
    settled_payment_method = serializers.CharField(source='settled_payment.payment_method', read_only=True)

    class Meta:
        model = PaymentReminder
        fields = [
            'id', 'customer', 'customer_name', 'customer_group', 'customer_group_name',
            'due_date', 'due_amount', 'is_settled', 'settled_at',
            'settled_payment', 'settled_payment_amount', 'settled_payment_method',
            'created_at', 'updated_at'
        ]
