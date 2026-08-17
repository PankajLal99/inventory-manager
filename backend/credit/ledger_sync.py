"""
Mirror main-app manual payment ledger entries (Payments page, is_sent) into credit ledger.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from backend.parties.models import Customer

from .collection_crm import auto_bump_follow_up_after_payment
from .models import CreditCustomer, CreditLedgerEntry, CreditPayment
from .views import CREDIT_ELIGIBLE_NAME_MARKER, ensure_credit_customer

_PAYMENT_METHOD_LABELS = dict(CreditPayment.PAYMENT_METHOD_CHOICES)


def _map_payment_method(payment_mode: str | None) -> str:
    mode = (payment_mode or 'cash').strip().lower()
    if mode in ('cash', 'upi', 'mixed'):
        return mode
    return 'cash'


def _parties_customer_is_credit_eligible(customer: Customer | None) -> bool:
    if not customer:
        return False
    if CreditCustomer.objects.filter(linked_customer=customer, is_active=True).exists():
        return True
    return CREDIT_ELIGIBLE_NAME_MARKER in (customer.name or '')


def _payment_amounts(method: str, amount: Decimal, cash_raw, upi_raw):
    if method == 'cash':
        return amount, Decimal('0.00')
    if method == 'upi':
        return Decimal('0.00'), amount
    cash_amount = Decimal(str(cash_raw or 0)).quantize(Decimal('0.01'))
    upi_amount = Decimal(str(upi_raw or 0)).quantize(Decimal('0.01'))
    if cash_amount == 0 and upi_amount == 0:
        return amount, Decimal('0.00')
    return cash_amount, upi_amount


def _ledger_description(method: str, notes: str) -> str:
    parts = [f'Payment ({_PAYMENT_METHOD_LABELS.get(method, method)})']
    if notes:
        parts.append(notes)
    text = ' — '.join(parts)
    return f'From main ledger — {text}' if text else 'From main ledger — Payment received'


def _local_midnight_today():
    """12:00 AM on the local day Sent was clicked, so the credit row leads that day."""
    now = timezone.localtime(timezone.now())
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _create_synced_payment(
    *,
    credit_customer,
    method: str,
    amount: Decimal,
    notes: str,
    paid_at,
    user,
    ledger_entry_id: int,
) -> CreditPayment:
    """Create one credit payment + ledger row and reduce customer balance."""
    if method == 'cash':
        cash_amount, upi_amount = amount, Decimal('0.00')
    else:
        cash_amount, upi_amount = Decimal('0.00'), amount

    payment = CreditPayment.objects.create(
        customer=credit_customer,
        payment_method=method,
        amount=amount,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        notes=notes,
        paid_at=paid_at,
        created_by=user,
        source_ledger_entry_id=ledger_entry_id,
    )
    CreditLedgerEntry.objects.create(
        customer=credit_customer,
        payment=payment,
        entry_type='credit',
        amount=amount,
        description=_ledger_description(method, notes),
        created_by=user,
        created_at=paid_at,
    )
    credit_customer.balance = F('balance') - amount
    credit_customer.save(update_fields=['balance', 'updated_at'])
    return payment


def unsync_main_ledger_payment(ledger_entry) -> None:
    """Remove mirrored credit payment(s) when main entry is unsent or deleted."""
    ledger_entry_id = getattr(ledger_entry, 'id', None)
    if not ledger_entry_id:
        return
    payments = list(
        CreditPayment.objects.filter(source_ledger_entry_id=ledger_entry_id)
        .select_related('customer')
        .order_by('id')
    )
    if not payments:
        return
    with transaction.atomic():
        # All synced rows belong to the same credit customer for one source entry.
        customer = CreditCustomer.objects.select_for_update().get(pk=payments[0].customer_id)
        total = Decimal('0.00')
        for payment in payments:
            total += payment.amount
            CreditLedgerEntry.objects.filter(payment=payment).delete()
            payment.delete()
        if total:
            customer.balance = F('balance') + total
            customer.save(update_fields=['balance', 'updated_at'])


def revert_main_ledger_sent_for_payment(payment) -> None:
    """Uncheck Sent on Payments page when a mirrored credit payment is removed."""
    source_id = getattr(payment, 'source_ledger_entry_id', None)
    if not source_id:
        return
    # Mixed sync creates cash + UPI rows; keep Sent until every sibling is gone.
    siblings = CreditPayment.objects.filter(source_ledger_entry_id=source_id)
    payment_pk = getattr(payment, 'pk', None)
    if payment_pk is not None:
        siblings = siblings.exclude(pk=payment_pk)
    if siblings.exists():
        return
    from backend.parties.models import LedgerEntry

    LedgerEntry.objects.filter(pk=source_id, is_sent=True).update(is_sent=False)


def revert_main_ledger_sent_for_payment_queryset(payments_qs) -> None:
    """Batch-uncheck Sent for all main ledger entries linked to credit payments."""
    source_ids = list(
        payments_qs.exclude(source_ledger_entry_id__isnull=True).values_list(
            'source_ledger_entry_id', flat=True
        )
    )
    if not source_ids:
        return
    from backend.parties.models import LedgerEntry

    LedgerEntry.objects.filter(pk__in=source_ids, is_sent=True).update(is_sent=False)


def sync_main_ledger_payment(ledger_entry, user=None) -> None:
    """
    When a manual main-ledger payment is marked sent, post matching credit to the
    linked / heart-marked credit customer.

    Mixed Payments-page entries are mirrored as two ledger rows (cash + UPI).
    """
    if ledger_entry.invoice_id is not None or ledger_entry.entry_type != 'credit':
        unsync_main_ledger_payment(ledger_entry)
        return
    if not ledger_entry.customer_id:
        unsync_main_ledger_payment(ledger_entry)
        return

    customer = ledger_entry.customer
    if customer is None:
        customer = Customer.objects.filter(pk=ledger_entry.customer_id).first()
    if not _parties_customer_is_credit_eligible(customer):
        unsync_main_ledger_payment(ledger_entry)
        return
    if not ledger_entry.is_sent:
        unsync_main_ledger_payment(ledger_entry)
        return

    with transaction.atomic():
        credit_customer = ensure_credit_customer(parties_customer_id=customer.id)
        credit_customer = CreditCustomer.objects.select_for_update().get(pk=credit_customer.pk)

        # Rebuild mirrors so mixed ↔ single (or amount edits) stay consistent.
        existing = list(
            CreditPayment.objects.filter(source_ledger_entry_id=ledger_entry.id).order_by('id')
        )
        previous_paid_at = existing[0].paid_at if existing else None
        if existing:
            restored = Decimal('0.00')
            for payment in existing:
                restored += payment.amount
                CreditLedgerEntry.objects.filter(payment=payment).delete()
                payment.delete()
            if restored:
                credit_customer.balance = F('balance') + restored
                credit_customer.save(update_fields=['balance', 'updated_at'])
                credit_customer.refresh_from_db(fields=['balance'])

        method = _map_payment_method(ledger_entry.payment_mode)
        amount = Decimal(str(ledger_entry.amount)).quantize(Decimal('0.01'))
        cash_amount, upi_amount = _payment_amounts(
            method, amount, ledger_entry.cash_amount, ledger_entry.upi_amount
        )
        notes = (ledger_entry.description or '').strip()
        # New Sent clicks stamp midnight today so the credit row is first that day.
        # Rebuilds keep the original sent timestamp.
        paid_at = previous_paid_at or _local_midnight_today()

        if method == 'mixed':
            # Two separate credit-ledger rows so cash and UPI appear distinctly.
            if cash_amount > 0:
                _create_synced_payment(
                    credit_customer=credit_customer,
                    method='cash',
                    amount=cash_amount,
                    notes=notes,
                    paid_at=paid_at,
                    user=user,
                    ledger_entry_id=ledger_entry.id,
                )
                credit_customer.refresh_from_db(fields=['balance'])
            if upi_amount > 0:
                _create_synced_payment(
                    credit_customer=credit_customer,
                    method='upi',
                    amount=upi_amount,
                    notes=notes,
                    paid_at=paid_at,
                    user=user,
                    ledger_entry_id=ledger_entry.id,
                )
        else:
            _create_synced_payment(
                credit_customer=credit_customer,
                method=method,
                amount=amount,
                notes=notes,
                paid_at=paid_at,
                user=user,
                ledger_entry_id=ledger_entry.id,
            )

        credit_customer.refresh_from_db(
            fields=['balance', 'next_follow_up_date', 'collection_reason']
        )
        auto_bump_follow_up_after_payment(credit_customer, user=user)
