"""
Collection CRM helpers for credit ledger: reason / follow-up updates and auto-bump.
"""
from datetime import date, timedelta

from django.utils import timezone

from .models import CreditCollectionEvent, CreditCustomer

# Days to push next follow-up after a payment while balance remains due
FOLLOW_UP_BUMP_DAYS = 7


def _today() -> date:
    return timezone.localdate()


def log_collection_event(
    customer: CreditCustomer,
    *,
    event_type: str,
    reason: str = '',
    follow_up_date=None,
    previous_follow_up_date=None,
    note: str = '',
    user=None,
) -> CreditCollectionEvent:
    return CreditCollectionEvent.objects.create(
        customer=customer,
        event_type=event_type,
        reason=(reason or '').strip(),
        follow_up_date=follow_up_date,
        previous_follow_up_date=previous_follow_up_date,
        note=(note or '').strip(),
        created_by=user if getattr(user, 'is_authenticated', False) else None,
    )


def update_collection_fields(
    customer: CreditCustomer,
    *,
    reason=None,
    next_follow_up_date=None,
    clear_follow_up: bool = False,
    user=None,
) -> CreditCustomer:
    """
    Update latest reason and/or next_follow_up_date, writing history events.
    Pass next_follow_up_date as a date, or clear_follow_up=True to clear.
    reason=None means leave unchanged; reason='' clears the text.
    """
    update_fields = ['updated_at']
    prev_follow_up = customer.next_follow_up_date

    if reason is not None:
        new_reason = (reason or '').strip()
        if new_reason != (customer.collection_reason or '').strip():
            customer.collection_reason = new_reason
            update_fields.append('collection_reason')
            log_collection_event(
                customer,
                event_type=CreditCollectionEvent.EVENT_REASON,
                reason=new_reason,
                follow_up_date=customer.next_follow_up_date,
                previous_follow_up_date=prev_follow_up,
                user=user,
            )

    if clear_follow_up:
        if customer.next_follow_up_date is not None:
            customer.next_follow_up_date = None
            update_fields.append('next_follow_up_date')
            log_collection_event(
                customer,
                event_type=CreditCollectionEvent.EVENT_CLEARED,
                reason=customer.collection_reason or '',
                follow_up_date=None,
                previous_follow_up_date=prev_follow_up,
                user=user,
            )
    elif next_follow_up_date is not None:
        # Allow explicit date (including same date no-op skip)
        if next_follow_up_date != customer.next_follow_up_date:
            customer.next_follow_up_date = next_follow_up_date
            update_fields.append('next_follow_up_date')
            log_collection_event(
                customer,
                event_type=CreditCollectionEvent.EVENT_FOLLOW_UP,
                reason=customer.collection_reason or '',
                follow_up_date=next_follow_up_date,
                previous_follow_up_date=prev_follow_up,
                user=user,
            )

    if len(update_fields) > 1:
        customer.save(update_fields=update_fields)
    return customer


def auto_bump_follow_up_after_payment(customer: CreditCustomer, user=None) -> CreditCustomer:
    """
    After a payment posts:
    - balance cleared → clear next_follow_up_date
    - balance still due → bump next_follow_up_date to today + FOLLOW_UP_BUMP_DAYS
    """
    balance = customer.balance or 0
    prev = customer.next_follow_up_date

    if balance <= 0:
        if prev is not None:
            customer.next_follow_up_date = None
            customer.save(update_fields=['next_follow_up_date', 'updated_at'])
            log_collection_event(
                customer,
                event_type=CreditCollectionEvent.EVENT_CLEARED,
                reason=customer.collection_reason or '',
                follow_up_date=None,
                previous_follow_up_date=prev,
                note='Follow-up cleared after balance settled',
                user=user,
            )
        return customer

    new_date = _today() + timedelta(days=FOLLOW_UP_BUMP_DAYS)
    if prev == new_date:
        return customer

    customer.next_follow_up_date = new_date
    customer.save(update_fields=['next_follow_up_date', 'updated_at'])
    log_collection_event(
        customer,
        event_type=CreditCollectionEvent.EVENT_AUTO_BUMP,
        reason=customer.collection_reason or '',
        follow_up_date=new_date,
        previous_follow_up_date=prev,
        note=f'Auto-bumped +{FOLLOW_UP_BUMP_DAYS} days after payment',
        user=user,
    )
    return customer


def follow_up_delta_days(next_follow_up_date) -> int | None:
    """Positive = days until follow-up; negative = days overdue; None if unset."""
    if not next_follow_up_date:
        return None
    return (next_follow_up_date - _today()).days
