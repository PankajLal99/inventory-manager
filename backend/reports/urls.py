from django.urls import path
from . import views
from .views_optimized import (
    optimized_dashboard_kpis,
    overall_profit_billing_period_details,
    overall_pending_invoice_details,
    wholesale_pending_cleared_details,
)

urlpatterns = [
    path('reports/sales-summary/', views.sales_summary, name='sales-summary'),
    path('reports/top-products/', views.top_products, name='top-products'),
    path('reports/inventory-summary/', views.inventory_summary, name='inventory-summary'),
    path('reports/revenue/', views.revenue_report, name='revenue-report'),
    path('reports/customers/', views.customer_summary, name='customer-summary'),
    path('reports/stock-ordering/', views.stock_ordering_report, name='stock-ordering-report'),
    path('reports/dashboard-kpis/', optimized_dashboard_kpis, name='dashboard-kpis'),
    path(
        'reports/overall-profit-billing-period-details/',
        overall_profit_billing_period_details,
        name='overall-profit-billing-period-details',
    ),
    path(
        'reports/overall-pending-invoice-details/',
        overall_pending_invoice_details,
        name='overall-pending-invoice-details',
    ),
    path(
        'reports/wholesale-pending-cleared-details/',
        wholesale_pending_cleared_details,
        name='wholesale-pending-cleared-details',
    ),
]

