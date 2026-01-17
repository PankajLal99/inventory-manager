from django.urls import path
from .views import (
    customer_group_list_create, customer_group_detail,
    customer_list_create, customer_detail, customer_balance, customer_adjust_credit,
    supplier_list_create, supplier_detail,
    ledger_entry_list_create, ledger_summary, ledger_customer_detail,
    personal_customer_list_create, personal_customer_detail,
    personal_ledger_entry_list_create, personal_ledger_summary, personal_ledger_customer_detail,
    internal_customer_list_create, internal_customer_detail,
    internal_ledger_entry_list_create, internal_ledger_summary, internal_ledger_customer_detail
)

urlpatterns = [
    # CustomerGroup endpoints
    path('customer-groups/', customer_group_list_create, name='customer-group-list-create'),
    path('customer-groups/<int:pk>/', customer_group_detail, name='customer-group-detail'),
    
    # Customer endpoints
    path('customers/', customer_list_create, name='customer-list-create'),
    path('customers/<int:pk>/', customer_detail, name='customer-detail'),
    path('customers/<int:pk>/balance/', customer_balance, name='customer-balance'),
    path('customers/<int:pk>/adjust-credit/', customer_adjust_credit, name='customer-adjust-credit'),
    
    # Supplier endpoints
    path('suppliers/', supplier_list_create, name='supplier-list-create'),
    path('suppliers/<int:pk>/', supplier_detail, name='supplier-detail'),
    
    # Ledger endpoints
    path('ledger/entries/', ledger_entry_list_create, name='ledger-entry-list-create'),
    path('ledger/summary/', ledger_summary, name='ledger-summary'),
    path('ledger/customers/<int:customer_id>/', ledger_customer_detail, name='ledger-customer-detail'),
    
    # Personal Customer endpoints
    path('personal-customers/', personal_customer_list_create, name='personal-customer-list-create'),
    path('personal-customers/<int:pk>/', personal_customer_detail, name='personal-customer-detail'),
    
    # Personal Ledger endpoints
    path('personal-ledger/entries/', personal_ledger_entry_list_create, name='personal-ledger-entry-list-create'),
    path('personal-ledger/summary/', personal_ledger_summary, name='personal-ledger-summary'),
    path('personal-ledger/customers/<int:customer_id>/', personal_ledger_customer_detail, name='personal-ledger-customer-detail'),
    
    # Internal Customer endpoints (Admin only)
    path('internal-customers/', internal_customer_list_create, name='internal-customer-list-create'),
    path('internal-customers/<int:pk>/', internal_customer_detail, name='internal-customer-detail'),
    
    # Internal Ledger endpoints (Admin only)
    path('internal-ledger/entries/', internal_ledger_entry_list_create, name='internal-ledger-entry-list-create'),
    path('internal-ledger/summary/', internal_ledger_summary, name='internal-ledger-summary'),
    path('internal-ledger/customers/<int:customer_id>/', internal_ledger_customer_detail, name='internal-ledger-customer-detail'),
]
