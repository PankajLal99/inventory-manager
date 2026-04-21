from rest_framework import serializers
from django.db.models import Q
from .models import Stock, StockBatch, StockAdjustment, StockTransfer, StockTransferItem
from backend.catalog.models import Product, ProductVariant, Barcode
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
        fields = ['id', 'retailer', 'product', 'variant', 'store', 'warehouse', 'batch_number', 'expiry_date', 'quantity', 'created_at']


class StockAdjustmentSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = StockAdjustment
        fields = ['id', 'retailer', 'adjustment_type', 'product', 'product_name', 'variant', 'store', 'warehouse', 'quantity', 'reason', 'notes', 'created_by', 'created_at']


class StockTransferItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = StockTransferItem
        fields = ['id', 'product', 'product_name', 'variant', 'quantity', 'received_quantity', 'selected_barcodes']


class StockTransferLineSerializer(serializers.ModelSerializer):
    """Writable line for create payload."""
    selected_barcodes = serializers.ListField(
        child=serializers.CharField(max_length=100),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = StockTransferItem
        fields = ['product', 'variant', 'quantity', 'selected_barcodes']

    def validate_quantity(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Quantity must be positive.')
        return value

    def validate_selected_barcodes(self, value):
        normalized = []
        seen = set()
        for raw in value or []:
            token = str(raw or '').strip().upper()
            if not token:
                continue
            if token in seen:
                raise serializers.ValidationError(f'Duplicate barcode in line: {token}')
            seen.add(token)
            normalized.append(token)
        return normalized

    def validate(self, attrs):
        attrs = super().validate(attrs)
        quantity = attrs.get('quantity')
        product = attrs.get('product')
        retailer = self.context.get('retailer')
        selected = attrs.get('selected_barcodes') or []
        if quantity != quantity.to_integral_value():
            raise serializers.ValidationError(
                {'quantity': 'Quantity must be a whole number when transferring barcode/serial tracked stock.'}
            )
        if not selected:
            raise serializers.ValidationError({'selected_barcodes': 'Provide barcode/serial values for this line.'})
        if int(quantity) != len(selected):
            raise serializers.ValidationError(
                {'selected_barcodes': 'Count of barcode/serial values must match quantity.'}
            )
        if retailer is None:
            return attrs

        barcode_qs = Barcode.all_objects.filter(
            retailer_id=retailer.id,
            product_id=product.id,
            tag__in=['new', 'returned'],
        ).filter(Q(barcode__in=selected) | Q(short_code__in=selected)).values_list('barcode', 'short_code')
        existing = set()
        for barcode_value, short_code in barcode_qs:
            if barcode_value:
                existing.add(str(barcode_value).upper())
            if short_code:
                existing.add(str(short_code).upper())
        missing = [code for code in selected if code not in existing]
        if missing:
            raise serializers.ValidationError(
                {'selected_barcodes': f'Invalid/unavailable barcode(s): {", ".join(missing)}'}
            )
        return attrs

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        retailer = self.context.get('retailer')
        if retailer is not None:
            self.fields['product'].queryset = Product.objects.filter(retailer_id=retailer.id)
            self.fields['variant'].queryset = ProductVariant.objects.filter(product__retailer_id=retailer.id)


class StockTransferReadSerializer(serializers.ModelSerializer):
    """Response-only payload for stock transfers (list/detail/complete). Not used for POST bodies."""
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
        # Mark model fields read-only so DRF does not attach UniqueTogetherValidator for
        # (retailer, transfer_number) on a serializer that is never meant to validate creates.
        read_only_fields = [
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
        ]


class StockTransferCreateSerializer(serializers.ModelSerializer):
    items = StockTransferLineSerializer(many=True)

    class Meta:
        model = StockTransfer
        fields = ['from_store', 'from_warehouse', 'to_store', 'to_warehouse', 'notes', 'items']

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('At least one line item is required.')
        seen = set()
        duplicates = set()
        for row in value:
            for code in row.get('selected_barcodes') or []:
                if code in seen:
                    duplicates.add(code)
                seen.add(code)
        if duplicates:
            joined = ', '.join(sorted(duplicates))
            raise serializers.ValidationError(f'Barcode/serial values repeated across lines: {joined}')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        retailer = self.context.get('retailer')
        if retailer is None:
            return attrs
        from_store = attrs.get('from_store')
        from_warehouse = attrs.get('from_warehouse')
        source_filter = {}
        if from_store is not None:
            source_filter['current_store_id'] = from_store.id
        elif from_warehouse is not None:
            source_filter['current_warehouse_id'] = from_warehouse.id
        for row in attrs.get('items') or []:
            selected = row.get('selected_barcodes') or []
            if not selected:
                continue
            found = set(
                Barcode.all_objects.filter(
                    retailer_id=retailer.id,
                    product_id=row['product'].id,
                    tag__in=['new', 'returned'],
                    **source_filter,
                ).filter(Q(barcode__in=selected) | Q(short_code__in=selected)).values_list('barcode', 'short_code')
            )
            resolved = set()
            for barcode_value, short_code in found:
                if barcode_value:
                    resolved.add(str(barcode_value).upper())
                if short_code:
                    resolved.add(str(short_code).upper())
            missing = [code for code in selected if code not in resolved]
            if missing:
                raise serializers.ValidationError(
                    {
                        'items': (
                            f'Selected barcode/serial not present at source location for '
                            f'product {row["product"].id}: {", ".join(missing)}'
                        )
                    }
                )
        return attrs

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
