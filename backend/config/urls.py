"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.static import serve

admin.site.site_header = "MT-IMS Management Admin Panel"
admin.site.site_title = "MT-IMS Management Admin Portal"
admin.site.index_title = "Welcome to Manish Traders Admin Portal"

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include('backend.core.urls')),
    path('api/v1/', include('backend.locations.urls')),
    path('api/v1/', include('backend.catalog.urls')),
    path('api/v1/', include('backend.inventory.urls')),
    path('api/v1/', include('backend.parties.urls')),
    path('api/v1/', include('backend.purchasing.urls')),
    path('api/v1/', include('backend.pricing.urls')),
    path('api/v1/', include('backend.pos.urls')),
    path('api/v1/', include('backend.reports.urls')),
    re_path(r'^media/(?P<path>.*)$', serve,{'document_root': settings.MEDIA_ROOT}),
    re_path(r'^static/(?P<path>.*)$', serve,{'document_root': settings.STATIC_ROOT}),
]

