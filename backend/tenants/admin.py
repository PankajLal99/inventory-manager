from django.contrib import admin
from .models import Retailer


@admin.register(Retailer)
class RetailerAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'is_active', 'primary_store_id', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('code', 'name')
