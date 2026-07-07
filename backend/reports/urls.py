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
    path('reports/stock-sold/', views.stock_sold_report, name='stock-sold'),
    path('reports/inventory-summary/', views.inventory_summary, name='inventory-summary'),
    path('reports/revenue/', views.revenue_report, name='revenue-report'),
    path('reports/customers/', views.customer_summary, name='customer-summary'),
    path('reports/stock-ordering/', views.stock_ordering_report, name='stock-ordering-report'),
    # Analytics
    path('reports/analytics-comparison/', views.analytics_comparison, name='analytics-comparison'),
    path('reports/category-brand-analytics/', views.category_brand_analytics, name='category-brand-analytics'),
    path('reports/kpi-detail/', views.kpi_detail, name='kpi-detail'),
    path('reports/sales-export/', views.sales_export, name='sales-export'),
    path('reports/stock-inventory-export/', views.stock_inventory_export, name='stock-inventory-export'),
    path('reports/stock-sold-export/', views.stock_sold_export, name='stock-sold-export'),


    # Dashboard
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
