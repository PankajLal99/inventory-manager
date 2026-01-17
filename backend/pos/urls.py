from django.urls import path
from .views import (
    pos_session_list_create, pos_session_detail, pos_session_close,
    cart_list_create, cart_detail, cart_items, cart_item_update, cart_item_remove_sku,
    cart_hold, cart_unhold, cart_checkout,
    invoice_list_create, invoice_detail, invoice_payments, invoice_void,
    invoice_checkout, invoice_mark_credit, invoice_return, invoice_exchange, invoice_items, invoice_item_detail,
    return_list_create, return_detail, return_credit_note, return_refund,
    credit_note_list, credit_note_detail,
    replacement_check, replacement_create, replacement_update_tag,
    replacement_replace, replacement_return, replacement_defective,
    find_invoice_by_barcode, process_replacement, search_invoices_by_number,
    replacement_credit_note,
    repair_invoices_list, find_repair_invoice_by_barcode, update_repair_status, generate_repair_label
)

urlpatterns = [
    # POSSession endpoints
    path('pos/sessions/', pos_session_list_create, name='pos-session-list-create'),
    path('pos/sessions/<int:pk>/', pos_session_detail, name='pos-session-detail'),
    path('pos/sessions/<int:pk>/close/', pos_session_close, name='pos-session-close'),
    
    # Cart endpoints
    path('pos/carts/', cart_list_create, name='cart-list-create'),
    path('pos/carts/<int:pk>/', cart_detail, name='cart-detail'),
    path('pos/carts/<int:pk>/items/', cart_items, name='cart-items'),
    path('pos/carts/<int:pk>/items/<int:item_id>/', cart_item_update, name='cart-item-update'),
    path('pos/carts/<int:pk>/items/<int:item_id>/remove-sku/', cart_item_remove_sku, name='cart-item-remove-sku'),
    path('pos/carts/<int:pk>/hold/', cart_hold, name='cart-hold'),
    path('pos/carts/<int:pk>/unhold/', cart_unhold, name='cart-unhold'),
    path('pos/carts/<int:pk>/checkout/', cart_checkout, name='cart-checkout'),
    
    # Invoice endpoints
    path('pos/invoices/', invoice_list_create, name='invoice-list-create'),
    path('pos/invoices/<int:pk>/', invoice_detail, name='invoice-detail'),
    path('pos/invoices/<int:pk>/items/', invoice_items, name='invoice-items'),
    path('pos/invoices/<int:pk>/items/<int:item_id>/', invoice_item_detail, name='invoice-item-detail'),
    path('pos/invoices/<int:pk>/payments/', invoice_payments, name='invoice-payments'),
    path('pos/invoices/<int:pk>/void/', invoice_void, name='invoice-void'),
    path('pos/invoices/<int:pk>/checkout/', invoice_checkout, name='invoice-checkout'),
    path('pos/invoices/<int:pk>/mark-credit/', invoice_mark_credit, name='invoice-mark-credit'),
    path('pos/invoices/<int:pk>/return/', invoice_return, name='invoice-return'),
    path('pos/invoices/<int:pk>/exchange/', invoice_exchange, name='invoice-exchange'),
    
    # Return endpoints
    path('returns/', return_list_create, name='return-list-create'),
    path('returns/<int:pk>/', return_detail, name='return-detail'),
    path('returns/<int:pk>/credit-note/', return_credit_note, name='return-credit-note'),
    path('returns/<int:pk>/refund/', return_refund, name='return-refund'),
    
    # Credit Note endpoints
    path('credit-notes/', credit_note_list, name='credit-note-list'),
    path('credit-notes/<int:pk>/', credit_note_detail, name='credit-note-detail'),
    
    # Replacement endpoints
    path('pos/replacement/check/', replacement_check, name='replacement-check'),
    path('pos/replacement/create/', replacement_create, name='replacement-create'),
    path('pos/replacement/barcode/<int:barcode_id>/update-tag/', replacement_update_tag, name='replacement-update-tag'),
    path('pos/replacement/replace/', replacement_replace, name='replacement-replace'),
    path('pos/replacement/return/', replacement_return, name='replacement-return'),
    path('pos/replacement/defective/', replacement_defective, name='replacement-defective'),
    path('pos/replacement/find-invoice/', find_invoice_by_barcode, name='find-invoice-by-barcode'),
    path('pos/replacement/search-invoices/', search_invoices_by_number, name='search-invoices-by-number'),
    path('pos/replacement/<int:invoice_id>/process/', process_replacement, name='process-replacement'),
    path('pos/replacement/<int:invoice_id>/credit-note/', replacement_credit_note, name='replacement-credit-note'),
    
    # Repair endpoints
    path('pos/repair/invoices/', repair_invoices_list, name='repair-invoices-list'),
    path('pos/repair/invoices/find-by-barcode/', find_repair_invoice_by_barcode, name='find-repair-invoice-by-barcode'),
    path('pos/invoices/<int:pk>/update-repair-status/', update_repair_status, name='update-repair-status'),
    path('pos/invoices/<int:pk>/generate-repair-label/', generate_repair_label, name='generate-repair-label'),
]
