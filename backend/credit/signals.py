from django.db.models.signals import post_save
from django.dispatch import receiver

from backend.parties.models import Customer

from .customer_sync import sync_linked_credit_customers_from_party


@receiver(post_save, sender=Customer)
def sync_credit_customer_on_party_save(sender, instance, **kwargs):
    """When a parties customer is saved, mirror profile fields to linked credit customers."""
    sync_linked_credit_customers_from_party(instance)
