from django.contrib import admin
from django.utils.safestring import mark_safe
from .models import Category, Brand, TaxRate, Product, ProductVariant, Barcode, ProductComponent, DefectiveProductMoveOut, DefectiveProductItem, BarcodeLabel


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'parent', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name']
    ordering = ['name']


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ['name', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name']
    ordering = ['name']


@admin.register(TaxRate)
class TaxRateAdmin(admin.ModelAdmin):
    list_display = ['name', 'rate', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name']
    ordering = ['name']


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ['name', 'sku', 'category', 'brand', 'is_active', 'created_at']
    list_filter = ['is_active', 'product_type', 'category', 'brand', 'created_at']
    search_fields = ['name', 'sku', 'description']
    ordering = ['name']
    readonly_fields = ['created_at', 'updated_at']


@admin.register(ProductVariant)
class ProductVariantAdmin(admin.ModelAdmin):
    list_display = ['product', 'name', 'sku', 'is_active']
    list_filter = ['is_active', 'product']
    search_fields = ['name', 'sku', 'product__name']
    ordering = ['product', 'name']


@admin.register(Barcode)
class BarcodeAdmin(admin.ModelAdmin):
    list_display = ['barcode', 'short_code', 'product', 'variant', 'tag', 'is_primary', 'created_at']
    list_filter = ['is_primary', 'tag', 'created_at']
    search_fields = ['barcode', 'short_code', 'product__name']
    ordering = ['-created_at']
    readonly_fields = ['short_code']  # Make short_code read-only in admin (auto-generated)


@admin.register(BarcodeLabel)
class BarcodeLabelAdmin(admin.ModelAdmin):
    list_display = ['barcode', 'product_name', 'barcode_value', 'short_code', 'has_label_image', 'generated_at', 'updated_at']
    list_filter = ['generated_at', 'updated_at']
    search_fields = ['barcode__barcode', 'barcode__short_code', 'barcode__product__name']
    ordering = ['-generated_at']
    readonly_fields = ['barcode', 'label_image_url', 'label_image_preview', 'generated_at', 'updated_at']
    actions = ['regenerate_labels']
    
    fieldsets = (
        ('Barcode Information', {
            'fields': ('barcode',)
        }),
        ('Label Image', {
            'fields': ('label_image_url', 'label_image_preview',)
        }),
        ('Timestamps', {
            'fields': ('generated_at', 'updated_at')
        }),
    )
    
    def product_name(self, obj):
        """Display product name from barcode"""
        return obj.barcode.product.name if obj.barcode and obj.barcode.product else '-'
    product_name.short_description = 'Product'
    product_name.admin_order_field = 'barcode__product__name'
    
    def barcode_value(self, obj):
        """Display barcode value"""
        return obj.barcode.barcode if obj.barcode else '-'
    barcode_value.short_description = 'Barcode'
    barcode_value.admin_order_field = 'barcode__barcode'
    
    def short_code(self, obj):
        """Display short code"""
        return obj.barcode.short_code if obj.barcode and obj.barcode.short_code else '-'
    short_code.short_description = 'Short Code'
    short_code.admin_order_field = 'barcode__short_code'
    
    def has_label_image(self, obj):
        """Check if label image exists"""
        if not obj.label_image:
            return 'No Image'
        if obj.label_image.startswith('data:image'):
            return 'Base64 Image'
        elif obj.label_image.startswith('https://'):
            return 'Blob URL'
        return 'Unknown Format'
    has_label_image.short_description = 'Image Status'
    
    def label_image_url(self, obj):
        """Display label image URL"""
        if not obj.label_image:
            return 'No label image URL available'
        
        # For base64 images, show preview with full URL in a textarea for easy copying
        if obj.label_image.startswith('data:image'):
            url_length = len(obj.label_image)
            preview_text = obj.label_image[:150] + '...' if url_length > 150 else obj.label_image
            html = f'''
            <div style="background: #f5f5f5; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                <div style="margin-bottom: 8px; font-weight: bold; color: #666;">Base64 Image URL ({url_length:,} characters):</div>
                <textarea readonly style="width: 100%; min-height: 80px; font-family: monospace; font-size: 10px; padding: 6px; border: 1px solid #ccc; border-radius: 3px; resize: vertical; background: white;" onclick="this.select();">{obj.label_image}</textarea>
                <div style="margin-top: 4px; font-size: 10px; color: #666;">Click to select all, then copy (Ctrl+C / Cmd+C)</div>
            </div>
            '''
            return mark_safe(html)
        
        # For blob URLs, show full URL with clickable link
        elif obj.label_image.startswith('https://'):
            html = f'''
            <div style="background: #f5f5f5; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                <div style="margin-bottom: 8px; font-weight: bold; color: #666;">Blob Storage URL:</div>
                <div style="word-break: break-all; font-family: monospace; font-size: 11px; background: white; padding: 8px; border: 1px solid #ccc; border-radius: 3px;">
                    <a href="{obj.label_image}" target="_blank" rel="noopener noreferrer" style="color: #0066cc; text-decoration: none;">{obj.label_image}</a>
                </div>
                <div style="margin-top: 4px; font-size: 10px; color: #666;">Click to open in new tab</div>
            </div>
            '''
            return mark_safe(html)
        
        # For other formats, show as-is
        html = f'''
        <div style="background: #f5f5f5; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
            <div style="word-break: break-all; font-family: monospace; font-size: 11px; background: white; padding: 8px; border: 1px solid #ccc; border-radius: 3px;">
                {obj.label_image}
            </div>
        </div>
        '''
        return mark_safe(html)
    label_image_url.short_description = 'Label Image URL'
    
    def label_image_preview(self, obj):
        """Display label image preview"""
        if not obj.label_image:
            return 'No label image available'
        
        # Handle base64 images
        if obj.label_image.startswith('data:image'):
            html = f'<img src="{obj.label_image}" alt="Label Preview" style="max-width: 400px; max-height: 200px; border: 1px solid #ddd; padding: 5px;" />'
            return mark_safe(html)
        
        # Handle blob URLs
        elif obj.label_image.startswith('https://'):
            html = f'<img src="{obj.label_image}" alt="Label Preview" style="max-width: 400px; max-height: 200px; border: 1px solid #ddd; padding: 5px;" onerror="this.parentElement.innerHTML=\'<p style=\\\'color: red;\\\'>Failed to load image. URL may have expired.</p>\';" />'
            return mark_safe(html)
        
        return 'Invalid image format'
    label_image_preview.short_description = 'Label Preview'
    
    def regenerate_labels(self, request, queryset):
        """Admin action to regenerate labels for selected barcodes via Azure API"""
        from .azure_label_service import queue_bulk_label_generation_via_azure
        from .models import Barcode
        from django.utils import timezone
        
        # Prepare barcode data for Azure API
        barcodes_data = []
        processed_count = 0
        
        for label_obj in queryset.select_related('barcode', 'barcode__product', 'barcode__purchase', 'barcode__purchase__supplier'):
            if not label_obj.barcode:
                continue
            
            barcode = label_obj.barcode
            product = barcode.product
            
            if not product:
                continue
            
            # Get vendor name and purchase date
            vendor_name = None
            purchase_date = None
            if barcode.purchase:
                if barcode.purchase.supplier:
                    vendor_name = barcode.purchase.supplier.name
                purchase_date = barcode.purchase.purchase_date.strftime('%d-%m-%Y')
            
            # Extract serial number from barcode
            # For barcodes like "FALC-20260101-0022-1", extract "0022-1" (last two parts)
            serial_number = None
            if barcode.barcode:
                parts = barcode.barcode.split('-')
                if len(parts) >= 4:
                    # If 4+ parts, take last two parts (e.g., "0022-1")
                    serial_number = '-'.join(parts[-2:])
                elif len(parts) >= 3:
                    # If 3 parts, take last part
                    serial_number = parts[-1]
            
            # Prepare data for Azure API
            barcodes_data.append({
                'product_name': product.name,
                'barcode_value': barcode.barcode,
                'short_code': barcode.short_code if hasattr(barcode, 'short_code') else None,
                'barcode_id': barcode.id,
                'vendor_name': vendor_name,
                'purchase_date': purchase_date,
                'serial_number': serial_number,
            })
        
        if not barcodes_data:
            self.message_user(request, "No valid barcodes found to regenerate.", level='warning')
            return
        
        # Queue regeneration via Azure API
        try:
            blob_urls = queue_bulk_label_generation_via_azure(barcodes_data)
            
            # Update label_image with blob URLs
            updated_count = 0
            for label_obj in queryset.select_related('barcode'):
                if label_obj.barcode and label_obj.barcode.id in blob_urls:
                    blob_url = blob_urls[label_obj.barcode.id]
                    if blob_url:
                        label_obj.label_image = blob_url
                        label_obj.save(update_fields=['label_image', 'updated_at'])
                        updated_count += 1
            
            if updated_count > 0:
                self.message_user(
                    request,
                    f"Successfully queued regeneration for {updated_count} label(s). Labels will be generated by Azure Function and URLs will be updated automatically.",
                    level='success'
                )
            else:
                self.message_user(
                    request,
                    f"Queued {len(barcodes_data)} label(s) for regeneration, but blob URLs were not returned. Check Azure Function configuration.",
                    level='warning'
                )
        except Exception as e:
            self.message_user(
                request,
                f"Error regenerating labels: {str(e)}",
                level='error'
            )
    
    regenerate_labels.short_description = "Regenerate labels via Azure API"


@admin.register(ProductComponent)
class ProductComponentAdmin(admin.ModelAdmin):
    list_display = ['product', 'component_product', 'quantity', 'created_at']
    list_filter = ['product']
    search_fields = ['product__name', 'component_product__name']
    ordering = ['product']


@admin.register(DefectiveProductMoveOut)
class DefectiveProductMoveOutAdmin(admin.ModelAdmin):
    list_display = ['move_out_number', 'store', 'invoice', 'reason', 'total_loss', 'total_items', 'created_by', 'created_at']
    list_filter = ['reason', 'created_at', 'store']
    search_fields = ['move_out_number', 'store__name', 'invoice__invoice_number']
    ordering = ['-created_at']
    readonly_fields = ['move_out_number', 'total_loss', 'total_items', 'created_at', 'updated_at']


@admin.register(DefectiveProductItem)
class DefectiveProductItemAdmin(admin.ModelAdmin):
    list_display = ['move_out', 'product', 'barcode', 'purchase_price', 'created_at']
    list_filter = ['move_out', 'created_at']
    search_fields = ['product__name', 'barcode__barcode', 'move_out__move_out_number']
    ordering = ['-created_at']
