from django.urls import path

from . import views

urlpatterns = [
    # Customers
    path('credit/customers/', views.credit_customer_list_create, name='credit-customer-list-create'),
    path('credit/customers/groups/', views.credit_customer_groups_list, name='credit-customer-groups-list'),
    path('credit/customers/search/', views.credit_customer_search, name='credit-customer-search'),
    path('credit/customers/ensure/', views.credit_customer_ensure, name='credit-customer-ensure'),

    # Products
    path('credit/products/', views.credit_product_list_create, name='credit-product-list-create'),
    path('credit/products/search/', views.credit_product_search, name='credit-product-search'),

    # Carts
    path('credit/carts/', views.credit_cart_list_create, name='credit-cart-list-create'),
    path('credit/carts/<int:pk>/', views.credit_cart_detail, name='credit-cart-detail'),
    path('credit/carts/<int:pk>/items/', views.credit_cart_items, name='credit-cart-items'),
    path('credit/carts/<int:pk>/items/<int:item_id>/', views.credit_cart_item_detail, name='credit-cart-item-detail'),
    path('credit/carts/<int:pk>/checkout/', views.credit_cart_checkout, name='credit-cart-checkout'),

    # Invoices
    path('credit/invoices/', views.credit_invoice_list, name='credit-invoice-list'),
    path('credit/invoices/summary/', views.credit_invoices_summary, name='credit-invoices-summary'),
    path('credit/invoices/<int:pk>/', views.credit_invoice_detail, name='credit-invoice-detail'),
    path('credit/invoices/<int:pk>/update/', views.credit_invoice_update, name='credit-invoice-update'),
    path('credit/invoices/<int:pk>/void/', views.credit_invoice_void, name='credit-invoice-void'),

    # Ledger
    path('credit/ledger/', views.credit_ledger_list, name='credit-ledger-list'),
    path('credit/ledger/entries/', views.credit_ledger_entry_create, name='credit-ledger-entry-create'),
    path('credit/ledger/statement/', views.credit_ledger_statement, name='credit-ledger-statement'),
    path('credit/ledger/by-customer/', views.credit_ledger_by_customer, name='credit-ledger-by-customer'),
    path(
        'credit/ledger/customers/<int:pk>/collection/',
        views.credit_ledger_collection_update,
        name='credit-ledger-collection-update',
    ),
    path(
        'credit/ledger/customers/<int:pk>/collection-history/',
        views.credit_ledger_collection_history,
        name='credit-ledger-collection-history',
    ),

    # Returns
    path('credit/returns/sold-products/', views.credit_return_sold_products, name='credit-return-sold-products'),
    path('credit/returns/', views.credit_return_list_create, name='credit-return-list-create'),
    path('credit/returns/<int:pk>/', views.credit_return_detail, name='credit-return-detail'),
    path('credit/returns/<int:pk>/update/', views.credit_return_update, name='credit-return-update'),
    path('credit/returns/<int:pk>/void/', views.credit_return_void, name='credit-return-void'),

    # Payments
    path('credit/payments/', views.credit_payment_list_create, name='credit-payment-list-create'),
    path('credit/payments/<int:pk>/', views.credit_payment_detail, name='credit-payment-detail'),
]
