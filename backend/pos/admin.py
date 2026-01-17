from django.contrib import admin
from django.utils.safestring import mark_safe
from .models import (
    POSSession, Cart, CartItem, Invoice, InvoiceItem, Payment,
    Return, ReturnItem, CreditNote, Exchange, Repair
)


@admin.register(POSSession)
class POSSessionAdmin(admin.ModelAdmin):
    list_display = ['session_number', 'store', 'user', 'status', 'opening_cash', 'closing_cash', 'opened_at', 'closed_at']
    list_filter = ['status', 'store', 'opened_at']
    search_fields = ['session_number']
    ordering = ['-opened_at']
    readonly_fields = ['opened_at', 'closed_at']


class CartItemInline(admin.TabularInline):
    model = CartItem
    extra = 0
    readonly_fields = ['product', 'variant', 'quantity', 'unit_price', 'discount_amount', 'tax_amount']


@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = ['cart_number', 'store', 'customer', 'status', 'created_by', 'created_at']
    list_filter = ['status', 'store', 'created_at']
    search_fields = ['cart_number']
    ordering = ['-created_at']
    inlines = [CartItemInline]
    readonly_fields = ['created_at', 'updated_at']


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 0
    readonly_fields = ['product', 'variant', 'quantity', 'unit_price', 'discount_amount', 'tax_amount', 'line_total']


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ['payment_method', 'amount', 'reference', 'created_by', 'created_at']


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['invoice_number', 'store', 'customer', 'status', 'total', 'paid_amount', 'due_amount', 'created_by', 'created_at']
    list_filter = ['status', 'store', 'created_at']
    search_fields = ['invoice_number']
    ordering = ['-created_at']
    inlines = [InvoiceItemInline, PaymentInline]
    readonly_fields = ['created_at', 'updated_at', 'voided_at']


class ReturnItemInline(admin.TabularInline):
    model = ReturnItem
    extra = 0


@admin.register(Return)
class ReturnAdmin(admin.ModelAdmin):
    list_display = ['return_number', 'invoice', 'status', 'created_by', 'created_at']
    list_filter = ['status', 'created_at']
    search_fields = ['return_number']
    ordering = ['-created_at']
    inlines = [ReturnItemInline]
    readonly_fields = ['created_at', 'updated_at']


@admin.register(CreditNote)
class CreditNoteAdmin(admin.ModelAdmin):
    list_display = ['credit_note_number', 'return_obj', 'amount', 'created_by', 'created_at']
    list_filter = ['created_at']
    search_fields = ['credit_note_number']
    ordering = ['-created_at']
    readonly_fields = ['created_at']


@admin.register(Exchange)
class ExchangeAdmin(admin.ModelAdmin):
    list_display = ['exchange_number', 'invoice', 'return_obj', 'created_by', 'created_at']
    list_filter = ['created_at']
    search_fields = ['exchange_number']
    ordering = ['-created_at']
    readonly_fields = ['created_at']


@admin.register(Repair)
class RepairAdmin(admin.ModelAdmin):
    list_display = ['barcode', 'invoice', 'contact_no', 'model_name', 'status', 'booking_amount', 'has_label_image', 'created_at', 'updated_at']
    list_filter = ['status', 'created_at', 'updated_at']
    search_fields = ['barcode', 'invoice__invoice_number', 'contact_no', 'model_name']
    readonly_fields = ['barcode', 'label_image_url', 'label_image_preview', 'created_at', 'updated_at']
    
    fieldsets = (
        ('Repair Information', {
            'fields': ('invoice', 'contact_no', 'model_name', 'booking_amount', 'status', 'barcode', 'updated_by')
        }),
        ('Label Image', {
            'fields': ('label_image_url', 'label_image_preview',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
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
