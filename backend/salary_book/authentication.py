import hashlib
from datetime import timedelta

from django.contrib.auth import get_user_model
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()

SALARY_BOOK_SCOPE = 'salary_book'
ACCESS_LIFETIME = timedelta(days=7)
REFRESH_LIFETIME = timedelta(days=365)


def password_fingerprint(user) -> str:
    return hashlib.sha256((user.password or '').encode()).hexdigest()[:24]


def issue_salary_book_tokens(user):
    refresh = RefreshToken.for_user(user)
    refresh.set_exp(lifetime=REFRESH_LIFETIME)
    claims = {
        'username': user.username,
        'groups': list(user.groups.values_list('name', flat=True)),
        'scope': SALARY_BOOK_SCOPE,
        'pwd': password_fingerprint(user),
    }
    for key, value in claims.items():
        refresh[key] = value
    access = refresh.access_token
    access.set_exp(lifetime=ACCESS_LIFETIME)
    for key, value in claims.items():
        access[key] = value
    return {
        'refresh': str(refresh),
        'access': str(access),
    }


class SalaryBookJWTAuthentication(JWTAuthentication):
    """POS tokens work as before. Salary Book tokens die when the password hash changes."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if validated_token.get('scope') != SALARY_BOOK_SCOPE:
            return user
        if validated_token.get('pwd') != password_fingerprint(user):
            raise InvalidToken('Password changed. Please log in again.')
        return user
