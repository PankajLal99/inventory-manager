from django.urls import path

from . import views

urlpatterns = [
    path('platform/retailers/', views.platform_retailer_list, name='platform-retailer-list'),
    path('platform/retailers/create/', views.platform_retailer_create, name='platform-retailer-create'),
]
