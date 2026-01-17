from django.urls import path
from . import views

urlpatterns = [
    path('reports/sales-summary/', views.sales_summary, name='sales-summary'),
    path('reports/top-products/', views.top_products, name='top-products'),
    path('reports/inventory-summary/', views.inventory_summary, name='inventory-summary'),
    path('reports/revenue/', views.revenue_report, name='revenue-report'),
    path('reports/customers/', views.customer_summary, name='customer-summary'),
    path('reports/stock-ordering/', views.stock_ordering_report, name='stock-ordering-report'),
    path('reports/dashboard-kpis/', views.dashboard_kpis, name='dashboard-kpis'),
]

