from django.urls import path

from backend.attendance import views

urlpatterns = [
    path('cdata', views.cdata, name='attendance-iclock-cdata'),
    path('getrequest', views.getrequest, name='attendance-iclock-getrequest'),
    path('devicecmd', views.devicecmd, name='attendance-iclock-devicecmd'),
]
