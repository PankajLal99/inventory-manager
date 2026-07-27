"""Keep linked CreditCustomer profile fields in sync with parties.Customer."""
from django.utils import timezone

from backend.parties.models import Customer

from .models import CreditCustomer


def sync_linked_credit_customers_from_party(party: Customer) -> int:
    """
    Push name / contact / group / active status from a parties.Customer to every
    CreditCustomer linked via linked_customer. Returns number of rows updated.
    """
    if not party or not party.pk:
        return 0

    return CreditCustomer.objects.filter(linked_customer_id=party.pk).update(
        name=party.name,
        phone=party.phone,
        email=party.email or '',
        address=party.address or '',
        customer_group_id=party.customer_group_id,
        is_active=party.is_active,
        updated_at=timezone.now(),
    )
