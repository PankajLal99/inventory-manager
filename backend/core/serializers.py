from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.models import Group
from .models import User, Setting, AuditLog, CustomNavLink


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'phone', 'is_active', 'is_staff', 'is_superuser', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


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


def _parse_id_list(value):
    """Accept list, JSON string, or comma-separated ids from form/JSON body."""
    if value is None or value == '':
        return []
    if isinstance(value, list):
        items = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith('['):
            import json
            try:
                items = json.loads(text)
            except json.JSONDecodeError:
                items = [p.strip() for p in text.split(',') if p.strip()]
        else:
            items = [p.strip() for p in text.split(',') if p.strip()]
    else:
        items = [value]
    result = []
    for item in items:
        try:
            result.append(int(item))
        except (TypeError, ValueError):
            continue
    return result


class CustomNavLinkSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    user_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
    )
    group_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True,
    )
    users = serializers.SerializerMethodField()
    groups = serializers.SerializerMethodField()
    logo = serializers.ImageField(required=False, allow_null=True, write_only=True)

    class Meta:
        model = CustomNavLink
        fields = [
            'id', 'name', 'url', 'logo', 'logo_url',
            'user_ids', 'group_ids', 'users', 'groups',
            'sort_order', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'logo_url', 'users', 'groups']

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        try:
            url = obj.logo.url
        except Exception:
            return None
        if not url:
            return None
        if str(url).startswith(('http://', 'https://')):
            return url
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_users(self, obj):
        return [
            {'id': u.id, 'username': u.username}
            for u in obj.users.all().only('id', 'username')
        ]

    def get_groups(self, obj):
        return [
            {'id': g.id, 'name': g.name}
            for g in obj.groups.all().only('id', 'name')
        ]

    def to_internal_value(self, data):
        # Mutable copy for QueryDict / FormData
        if hasattr(data, 'lists'):
            mutable = {}
            for key in data.keys():
                values = data.getlist(key)
                mutable[key] = values[0] if len(values) == 1 else values
            data = mutable
        else:
            data = dict(data)

        if 'user_ids' in data:
            data['user_ids'] = _parse_id_list(data.get('user_ids'))
        if 'group_ids' in data:
            data['group_ids'] = _parse_id_list(data.get('group_ids'))

        # Checkbox / string booleans from FormData
        if 'is_active' in data and isinstance(data['is_active'], str):
            data['is_active'] = data['is_active'].lower() in ('1', 'true', 'yes', 'on')
        if 'sort_order' in data and data['sort_order'] == '':
            data.pop('sort_order')

        return super().to_internal_value(data)

    def create(self, validated_data):
        user_ids = validated_data.pop('user_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        link = CustomNavLink.objects.create(**validated_data)
        if user_ids is not None:
            link.users.set(User.objects.filter(id__in=user_ids))
        if group_ids is not None:
            link.groups.set(Group.objects.filter(id__in=group_ids))
        return link

    def update(self, instance, validated_data):
        user_ids = validated_data.pop('user_ids', None)
        group_ids = validated_data.pop('group_ids', None)
        logo = validated_data.pop('logo', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if logo is not None:
            instance.logo = logo
        instance.save()
        if user_ids is not None:
            instance.users.set(User.objects.filter(id__in=user_ids))
        if group_ids is not None:
            instance.groups.set(Group.objects.filter(id__in=group_ids))
        return instance


class CustomNavLinkMineSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()

    class Meta:
        model = CustomNavLink
        fields = ['id', 'name', 'url', 'logo_url', 'sort_order']

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        try:
            url = obj.logo.url
        except Exception:
            return None
        if not url:
            return None
        if str(url).startswith(('http://', 'https://')):
            return url
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(url)
        return url

