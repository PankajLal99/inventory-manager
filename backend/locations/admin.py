from django.contrib import admin
from django.utils.html import format_html
from django.conf import settings
from .models import Store, Warehouse


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = ['name', 'code', 'phone', 'email', 'is_active', 'self_checkout_url_link', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'code', 'email']
    ordering = ['name']

    def _get_self_checkout_url(self, obj):
        """Generate the self-checkout URL for this store."""
        if not obj.retailer:
            return None
        base_url = settings.SELF_CHECKOUT_BASE_URL
        return f"{base_url}/self-checkout?retailer={obj.retailer.code}&store={obj.id}"

    def self_checkout_url_link(self, obj):
        """Display a copy-to-clipboard link for the self-checkout URL."""
        url = self._get_self_checkout_url(obj)
        if not url:
            return format_html('<span style="color: red;">No retailer</span>')
        
        return format_html(
            '''<a href="javascript:void(0)" 
                  onclick="navigator.clipboard.writeText('{}'); alert('URL copied to clipboard!');"
                  style="padding: 5px 10px; background: #417690; color: white; 
                         text-decoration: none; border-radius: 3px; display: inline-block;">
                  Copy URL
               </a>''',
            url
        )
    
    self_checkout_url_link.short_description = 'Self-Checkout URL'


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    list_display = ['name', 'code', 'phone', 'email', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'code', 'email']
    ordering = ['name']
