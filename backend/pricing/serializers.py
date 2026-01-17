from rest_framework import serializers
from .models import PriceList, PriceListItem, BulkPriceUpdateLog, Promotion


class PriceListItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = PriceListItem
        fields = ['id', 'product', 'product_name', 'variant', 'price']


class PriceListSerializer(serializers.ModelSerializer):
    items = PriceListItemSerializer(many=True, read_only=True)
    customer_group_name = serializers.CharField(source='customer_group.name', read_only=True)

    class Meta:
        model = PriceList
        fields = [
            'id', 'name', 'description', 'customer_group', 'customer_group_name', 'is_active',
            'valid_from', 'valid_to', 'created_at', 'updated_at', 'items'
        ]


class BulkPriceUpdateLogSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = BulkPriceUpdateLog
        fields = ['id', 'update_type', 'value', 'filters', 'affected_count', 'created_by', 'created_by_name', 'created_at']


class PromotionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Promotion
        fields = [
            'id', 'name', 'promotion_type', 'discount_type', 'discount_value', 'conditions',
            'applicable_products', 'applicable_categories', 'applicable_brands',
            'valid_from', 'valid_to', 'is_active', 'created_at', 'updated_at'
        ]

