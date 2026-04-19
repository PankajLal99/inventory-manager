from rest_framework import serializers
from .models import Stock, StockBatch, StockAdjustment, StockTransfer, StockTransferItem
from backend.catalog.models import Product, ProductVariant
from backend.catalog.serializers import ProductSerializer, ProductVariantSerializer


class StockSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
    product_id = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all(), source='product', write_only=True)
    variant = ProductVariantSerializer(read_only=True)
    store_name = serializers.CharField(source='store.name', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)

    class Meta:
        model = Stock
        fields = ['id', 'product', 'product_id', 'variant', 'store', 'store_name', 'warehouse', 'warehouse_name', 'quantity', 'reserved_quantity', 'updated_at']


class StockBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockBatch
        fields = ['id', 'product', 'variant', 'store', 'warehouse', 'batch_number', 'expiry_date', 'quantity', 'created_at']


class StockAdjustmentSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = StockAdjustment
        fields = ['id', 'adjustment_type', 'product', 'product_name', 'variant', 'store', 'warehouse', 'quantity', 'reason', 'notes', 'created_by', 'created_at']


class StockTransferItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = StockTransferItem
        fields = ['id', 'product', 'product_name', 'variant', 'quantity', 'received_quantity']


class StockTransferLineSerializer(serializers.ModelSerializer):
    """Writable line for create payload."""

    class Meta:
        model = StockTransferItem
        fields = ['product', 'variant', 'quantity']

    def validate_quantity(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Quantity must be positive.')
        return value

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        retailer = self.context.get('retailer')
        if retailer is not None:
            self.fields['product'].queryset = Product.objects.filter(retailer_id=retailer.id)
            self.fields['variant'].queryset = ProductVariant.objects.filter(product__retailer_id=retailer.id)


class StockTransferReadSerializer(serializers.ModelSerializer):
    items = StockTransferItemSerializer(many=True, read_only=True)

    class Meta:
        model = StockTransfer
        fields = [
            'id',
            'retailer',
            'transfer_number',
            'from_store',
            'from_warehouse',
            'to_store',
            'to_warehouse',
            'status',
            'notes',
            'created_by',
            'created_at',
            'updated_at',
            'items',
        ]


class StockTransferCreateSerializer(serializers.ModelSerializer):
    items = StockTransferLineSerializer(many=True)

    class Meta:
        model = StockTransfer
        fields = ['from_store', 'from_warehouse', 'to_store', 'to_warehouse', 'notes', 'items']

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('At least one line item is required.')
        return value

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        retailer = self.context.get('retailer')
        if retailer is not None:
            from backend.locations.models import Store, Warehouse

            self.fields['from_store'].queryset = Store.objects.filter(retailer_id=retailer.id, is_active=True)
            self.fields['from_warehouse'].queryset = Warehouse.objects.filter(retailer_id=retailer.id, is_active=True)
            self.fields['to_store'].queryset = Store.objects.filter(retailer_id=retailer.id, is_active=True)
            self.fields['to_warehouse'].queryset = Warehouse.objects.filter(retailer_id=retailer.id, is_active=True)

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        transfer = StockTransfer.objects.create(**validated_data)
        for row in items_data:
            StockTransferItem.objects.create(transfer=transfer, **row)
        return transfer


class StockTransferUpdateSerializer(serializers.ModelSerializer):
    """PATCH: notes and status (pending / in_transit / cancelled only via cancel endpoint preferred)."""

    class Meta:
        model = StockTransfer
        fields = ['notes', 'status']

    def validate_status(self, value):
        instance = self.instance
        if instance and instance.status == 'completed':
            raise serializers.ValidationError('Cannot change status of a completed transfer.')
        if instance and instance.status == 'cancelled':
            raise serializers.ValidationError('Cannot change status of a cancelled transfer.')
        if value == 'completed':
            raise serializers.ValidationError('Use the complete action to mark a transfer completed.')
        if value not in ('pending', 'in_transit', 'cancelled'):
            raise serializers.ValidationError('Invalid status for update.')
        return value
