from django.urls import path
from .views import (
    stock_detail,
    stock_batch_list, stock_batch_detail,
    stock_adjustment_list_create, stock_adjustment_detail,
    stock_transfer_list_create, stock_transfer_detail,
    stock_transfer_complete, stock_transfer_cancel,
)
from .views_optimized import optimized_stock_list, optimized_stock_low, optimized_stock_out_of_stock

urlpatterns = [
    # Stock endpoints
    path('stock/', optimized_stock_list, name='stock-list'),  # 🚀 OPTIMIZED!
    path('stock/<int:pk>/', stock_detail, name='stock-detail'),
    path('stock/low/', optimized_stock_low, name='stock-low'),  # 🚀 OPTIMIZED!
    path('stock/out-of-stock/', optimized_stock_out_of_stock, name='stock-out-of-stock'),  # 🚀 OPTIMIZED!
    
    # StockBatch endpoints
    path('stock/batches/', stock_batch_list, name='stock-batch-list'),
    path('stock/batches/<int:pk>/', stock_batch_detail, name='stock-batch-detail'),
    
    # StockAdjustment endpoints
    path('stock-adjustments/', stock_adjustment_list_create, name='stock-adjustment-list-create'),
    path('stock-adjustments/<int:pk>/', stock_adjustment_detail, name='stock-adjustment-detail'),
    
    # StockTransfer endpoints (specific paths before pk)
    path('stock-transfers/', stock_transfer_list_create, name='stock-transfer-list-create'),
    path('stock-transfers/<int:pk>/complete/', stock_transfer_complete, name='stock-transfer-complete'),
    path('stock-transfers/<int:pk>/cancel/', stock_transfer_cancel, name='stock-transfer-cancel'),
    path('stock-transfers/<int:pk>/', stock_transfer_detail, name='stock-transfer-detail'),
]
