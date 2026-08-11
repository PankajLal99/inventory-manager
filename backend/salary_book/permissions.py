from rest_framework.permissions import BasePermission

SALARY_BOOK_GROUP = 'SalaryBook'
ADMIN_GROUP = 'Admin'


def user_can_access_salary_book(user) -> bool:
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if not user.is_active:
        return False
    if user.is_superuser:
        return True
    return user.groups.filter(name__in=[SALARY_BOOK_GROUP, ADMIN_GROUP]).exists()


class IsSalaryBookUser(BasePermission):
    message = 'You do not have access to Salary Book.'

    def has_permission(self, request, view):
        return user_can_access_salary_book(request.user)
