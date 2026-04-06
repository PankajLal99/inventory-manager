from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from .models import User, Setting, AuditLog


class UserSerializer(serializers.ModelSerializer):
    retailer = serializers.SerializerMethodField(read_only=True)
    default_store = serializers.SerializerMethodField(read_only=True)
    assigned_stores = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'phone',
            'is_active', 'is_staff', 'is_superuser', 'retailer',
            'default_store', 'assigned_stores',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_retailer(self, obj):
        r = getattr(obj, 'retailer', None)
        if not r:
            return None
        return {'id': r.id, 'code': r.code, 'name': r.name}

    def get_default_store(self, obj):
        s = getattr(obj, 'default_store', None)
        if not s:
            return None
        return {
            'id': s.id,
            'name': s.name,
            'code': s.code,
            'shop_type': getattr(s, 'shop_type', 'retail'),
        }

    def get_assigned_stores(self, obj):
        qs = obj.assigned_stores.all().order_by('name')
        return [
            {
                'id': s.id,
                'name': s.name,
                'code': s.code,
                'shop_type': getattr(s, 'shop_type', 'retail'),
            }
            for s in qs
        ]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password_confirm', 'first_name', 'last_name', 'phone']

    def validate(self, attrs):
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password": "Passwords don't match"})
        return attrs

    def create(self, validated_data):
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        # Ensure user is active by default
        user = User.objects.create(**validated_data, is_active=True)
        user.set_password(password)
        user.save()
        return user


class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setting
        fields = ['id', 'key', 'value', 'description', 'updated_at']


class AuditLogSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = AuditLog
        fields = ['id', 'user', 'action', 'model_name', 'object_id', 'object_name', 
                  'object_reference', 'barcode', 'changes', 'ip_address', 'created_at']

