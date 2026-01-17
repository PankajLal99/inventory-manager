from rest_framework import serializers
from .models import Store, Warehouse


class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = ['id', 'name', 'code', 'shop_type', 'address', 'phone', 'email', 'is_active', 'created_at', 'updated_at']


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ['id', 'name', 'code', 'address', 'phone', 'email', 'is_active', 'created_at', 'updated_at']

