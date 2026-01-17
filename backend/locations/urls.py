from django.urls import path
from .views import (
    store_list_create, store_detail,
    warehouse_list_create, warehouse_detail
)

urlpatterns = [
    path('stores/', store_list_create, name='store-list-create'),
    path('stores/<int:pk>/', store_detail, name='store-detail'),
    path('warehouses/', warehouse_list_create, name='warehouse-list-create'),
    path('warehouses/<int:pk>/', warehouse_detail, name='warehouse-detail'),
]
