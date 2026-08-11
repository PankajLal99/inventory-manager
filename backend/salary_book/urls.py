from django.urls import path

from . import views

urlpatterns = [
    path('salary-book/auth/login/', views.salary_book_login, name='salary-book-login'),
    path('salary-book/auth/refresh/', views.salary_book_refresh, name='salary-book-refresh'),
    path('salary-book/auth/me/', views.salary_book_me, name='salary-book-me'),
    path(
        'salary-book/auth/change-password/',
        views.salary_book_change_password,
        name='salary-book-change-password',
    ),

    path('salary-book/dashboard/', views.dashboard, name='salary-book-dashboard'),
    path('salary-book/calendar/', views.attendance_calendar, name='salary-book-calendar'),
    path('salary-book/settings/', views.settings_view, name='salary-book-settings'),

    path('salary-book/employees/', views.employee_list_create, name='salary-book-employee-list-create'),
    path('salary-book/employees/<int:pk>/', views.employee_detail, name='salary-book-employee-detail'),
    path('salary-book/employees/<int:pk>/photo/', views.employee_photo, name='salary-book-employee-photo'),
    path('salary-book/employees/<int:pk>/attendance/', views.employee_attendance_history, name='salary-book-employee-attendance'),
    path('salary-book/employees/<int:pk>/leaves/', views.employee_leave_history, name='salary-book-employee-leaves'),
    path('salary-book/employees/<int:pk>/advances/', views.employee_advance_history, name='salary-book-employee-advances'),
    path('salary-book/employees/<int:pk>/salaries/', views.employee_salary_history, name='salary-book-employee-salaries'),

    path('salary-book/attendance/', views.attendance_list_create, name='salary-book-attendance-list-create'),
    path('salary-book/attendance/<int:pk>/', views.attendance_detail, name='salary-book-attendance-detail'),
    path('salary-book/attendance/<int:pk>/photo/', views.attendance_photo, name='salary-book-attendance-photo'),

    path('salary-book/leaves/', views.leave_list_create, name='salary-book-leave-list-create'),
    path('salary-book/leaves/<int:pk>/void/', views.leave_void, name='salary-book-leave-void'),

    path('salary-book/advances/', views.advance_list_create, name='salary-book-advance-list-create'),
    path('salary-book/advances/<int:pk>/void/', views.advance_void, name='salary-book-advance-void'),

    path('salary-book/salaries/', views.salary_list, name='salary-book-salary-list'),
    path('salary-book/salaries/generate/', views.salary_generate, name='salary-book-salary-generate'),
    path('salary-book/salaries/<int:pk>/', views.salary_detail, name='salary-book-salary-detail'),
    path('salary-book/salaries/<int:pk>/finalize/', views.salary_finalize, name='salary-book-salary-finalize'),
    path('salary-book/salaries/<int:pk>/reopen/', views.salary_reopen, name='salary-book-salary-reopen'),

    path('salary-book/payments/', views.payment_list_create, name='salary-book-payment-list-create'),
    path('salary-book/payments/<int:pk>/void/', views.payment_void, name='salary-book-payment-void'),

    path('salary-book/reports/attendance/', views.report_attendance, name='salary-book-report-attendance'),
    path('salary-book/reports/leaves/', views.report_leaves, name='salary-book-report-leaves'),
    path('salary-book/reports/advances/', views.report_advances, name='salary-book-report-advances'),
    path('salary-book/reports/salaries/', views.report_salaries, name='salary-book-report-salaries'),
]
