from django.urls import path
from .views import (
    stock_list, stock_detail, stock_low, stock_out_of_stock,
    stock_batch_list, stock_batch_detail,
    stock_adjustment_list_create, stock_adjustment_detail,
    stock_transfer_list_create, stock_transfer_detail
)

urlpatterns = [
    # Stock endpoints
    path('stock/', stock_list, name='stock-list'),
    path('stock/<int:pk>/', stock_detail, name='stock-detail'),
    path('stock/low/', stock_low, name='stock-low'),
    path('stock/out-of-stock/', stock_out_of_stock, name='stock-out-of-stock'),
    
    # StockBatch endpoints
    path('stock/batches/', stock_batch_list, name='stock-batch-list'),
    path('stock/batches/<int:pk>/', stock_batch_detail, name='stock-batch-detail'),
    
    # StockAdjustment endpoints
    path('stock-adjustments/', stock_adjustment_list_create, name='stock-adjustment-list-create'),
    path('stock-adjustments/<int:pk>/', stock_adjustment_detail, name='stock-adjustment-detail'),
    
    # StockTransfer endpoints
    path('stock-transfers/', stock_transfer_list_create, name='stock-transfer-list-create'),
    path('stock-transfers/<int:pk>/', stock_transfer_detail, name='stock-transfer-detail'),
]
