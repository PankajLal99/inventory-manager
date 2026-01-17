from rest_framework import serializers
from .models import Stock, StockBatch, StockAdjustment, StockTransfer, StockTransferItem
from backend.catalog.models import Product
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


class StockTransferSerializer(serializers.ModelSerializer):
    items = StockTransferItemSerializer(many=True, read_only=True)

    class Meta:
        model = StockTransfer
        fields = ['id', 'transfer_number', 'from_store', 'from_warehouse', 'to_store', 'to_warehouse', 'status', 'notes', 'created_by', 'created_at', 'updated_at', 'items']

