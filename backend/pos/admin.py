from django.contrib import admin
from django.contrib.admin.filters import DateFieldListFilter
from django.db.models import Count
from django.urls import reverse
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
    readonly_fields = ['product', 'variant', 'quantity', 'unit_price', 'manual_unit_price', 'purchase_price', 'discount_amount', 'tax_amount']


@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = ['cart_number', 'store', 'customer', 'status', 'created_by', 'created_at']
    list_filter = ['status', 'store', 'created_at']
    search_fields = ['cart_number']
    ordering = ['-created_at']
    inlines = [CartItemInline]
    readonly_fields = ['created_at', 'updated_at']


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    readonly_fields = ['payment_method', 'amount', 'reference', 'created_by', 'created_at']

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.select_related('created_by', 'invoice')


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ['id', 'invoice', 'payment_method', 'amount', 'reference', 'created_by', 'created_at']
    list_filter = ['payment_method', 'created_at']
    search_fields = ['invoice__invoice_number', 'reference', 'notes']
    ordering = ['-created_at']
    readonly_fields = ['created_at']
    
    fieldsets = (
        ('Payment Information', {
            'fields': ('invoice', 'payment_method', 'amount', 'reference')
        }),
        ('Additional Details', {
            'fields': ('notes', 'created_by', 'created_at')
        }),
    )


@admin.register(InvoiceItem)
class InvoiceItemAdmin(admin.ModelAdmin):
    """Line items on their own admin page — avoids loading hundreds of inline form rows on Invoice (very slow)."""

    list_display = [
        'id',
        'invoice',
        'product',
        'variant',
        'quantity',
        'line_total',
        'sold_barcode_value',
        'barcode',
    ]
    search_fields = [
        'invoice__invoice_number',
        'product__name',
        'product__sku',
        'sold_barcode_value',
        'barcode__barcode',
    ]
    autocomplete_fields = ['invoice', 'product', 'variant', 'barcode']
    ordering = ['invoice_id', 'id']
    list_select_related = ('invoice', 'product', 'variant', 'barcode')
    show_full_result_count = False
    readonly_fields = [
        'invoice',
        'product',
        'variant',
        'barcode',
        'sold_barcode_value',
        'quantity',
        'unit_price',
        'manual_unit_price',
        'purchase_price',
        'discount_amount',
        'tax_amount',
        'line_total',
        'replaced_quantity',
        'replaced_at',
        'replaced_by',
    ]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.select_related('invoice', 'product', 'variant', 'barcode', 'replaced_by')


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = [
        'invoice_number',
        'store',
        'customer',
        'invoice_type',
        'status',
        'total',
        'paid_amount',
        'due_amount',
        'pending_cleared_at',
        'created_by',
        'created_at',
    ]
    list_filter = [
        'status',
        'invoice_type',
        'store',
        ('created_at', DateFieldListFilter),
        ('pending_cleared_at', DateFieldListFilter),
    ]
    search_fields = ['invoice_number', 'customer__name', 'customer__phone']
    ordering = ['-created_at']
    list_select_related = ('store', 'customer', 'created_by')
    show_full_result_count = False
    autocomplete_fields = ['cart', 'store', 'customer', 'created_by', 'voided_by', 'applied_promotions']
    # Line items are NOT inlined — each row is an extra form in the DOM + ORM; use InvoiceItem admin + link below.
    inlines = [PaymentInline]
    readonly_fields = [
        'created_at',
        'updated_at',
        'voided_at',
        'pending_cleared_at',
        'line_items_admin_link',
        'pos_trade_ins',
        'exchange_snapshots',
    ]

    fieldsets = (
        (
            None,
            {
                'fields': (
                    'invoice_number',
                    'cart',
                    'store',
                    'customer',
                    'status',
                    'invoice_type',
                ),
            },
        ),
        (
            'Amounts',
            {
                'fields': (
                    'subtotal',
                    'discount_amount',
                    'tax_amount',
                    'total',
                    'paid_amount',
                    'due_amount',
                    'trade_in_credit',
                ),
            },
        ),
        (
            'Line items',
            {
                'fields': ('line_items_admin_link',),
                'description': (
                    'Open the filtered list to view all rows for this invoice (fast). '
                    'Previously each line was an inline form here, which made this page very slow.'
                ),
            },
        ),
        (
            'Promotions',
            {'fields': ('applied_promotions',)},
        ),
        (
            'Trade-in / exchange payloads (JSON)',
            {
                'classes': ('collapse',),
                'fields': ('pos_trade_ins', 'exchange_snapshots'),
            },
        ),
        (
            'Pending / wholesale',
            {
                'fields': ('pending_cleared_at',),
                'description': (
                    'Set when a draft pending invoice is finalized (checkout to non-pending type, '
                    'or Move to Ledger). Used for reporting; read-only here.'
                ),
            },
        ),
        (
            'Void',
            {'fields': ('voided_at', 'voided_by')},
        ),
        (
            'Notes & edits',
            {'fields': ('notes', 'is_edited', 'edited_on')},
        ),
        (
            'Timestamps',
            {'fields': ('created_by', 'created_at', 'updated_at')},
        ),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.select_related('store', 'customer', 'created_by', 'voided_by', 'cart').annotate(
            _admin_line_item_count=Count('items', distinct=True),
        )

    @admin.display(description='Line items')
    def line_items_admin_link(self, obj):
        if not obj or not obj.pk:
            return '—'
        url = reverse('admin:pos_invoiceitem_changelist') + f'?invoice__id__exact={obj.pk}'
        n = getattr(obj, '_admin_line_item_count', None)
        label = f'View {n} line item(s) in admin' if n is not None else 'View line items in admin'
        return mark_safe(f'<a href="{url}">{label}</a>')


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
    list_display = ['barcode', 'customer_name', 'invoice', 'contact_no', 'model_name', 'status', 'booking_amount', 'has_label_image', 'delivery_date','created_at', 'updated_at']
    list_filter = ['status', 'created_at', 'updated_at']
    search_fields = ['barcode', 'invoice__invoice_number', 'invoice__customer__name', 'contact_no', 'model_name']
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

    def customer_name(self, obj):
        if obj.invoice and obj.invoice.customer:
            return obj.invoice.customer.name
        return '-'
    customer_name.short_description = 'Customer'
    
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
