from rest_framework import serializers
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
            'entry_type', 'amount', 'quantity', 'description', 'created_by', 'created_by_username', 'created_at'
        ]


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
