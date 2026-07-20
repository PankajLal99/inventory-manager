"""
Mirror main-app manual payment ledger entries (Payments page, is_sent) into credit ledger.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from backend.parties.models import Customer

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


def _ledger_description(method: str, amount: Decimal, cash_amount: Decimal, upi_amount: Decimal, notes: str) -> str:
    parts = [f'Payment ({_PAYMENT_METHOD_LABELS.get(method, method)})']
    if method == 'mixed':
        parts.append(f'cash ₹{cash_amount} + UPI ₹{upi_amount}')
    if notes:
        parts.append(notes)
    text = ' — '.join(parts)
    return f'From main ledger — {text}' if text else 'From main ledger — Payment received'


def unsync_main_ledger_payment(ledger_entry) -> None:
    """Remove mirrored credit payment when main entry is unsent or deleted."""
    ledger_entry_id = getattr(ledger_entry, 'id', None)
    if not ledger_entry_id:
        return
    payment = (
        CreditPayment.objects.filter(source_ledger_entry_id=ledger_entry_id)
        .select_related('customer')
        .first()
    )
    if not payment:
        return
    with transaction.atomic():
        customer = CreditCustomer.objects.select_for_update().get(pk=payment.customer_id)
        amount = payment.amount
        CreditLedgerEntry.objects.filter(payment=payment).delete()
        payment.delete()
        customer.balance = F('balance') + amount
        customer.save(update_fields=['balance', 'updated_at'])


def sync_main_ledger_payment(ledger_entry, user=None) -> None:
    """
    When a manual main-ledger payment is marked sent, post matching credit to the
    linked / heart-marked credit customer.
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

        method = _map_payment_method(ledger_entry.payment_mode)
        amount = Decimal(str(ledger_entry.amount)).quantize(Decimal('0.01'))
        cash_amount, upi_amount = _payment_amounts(
            method, amount, ledger_entry.cash_amount, ledger_entry.upi_amount
        )
        notes = (ledger_entry.description or '').strip()
        ledger_description = _ledger_description(method, amount, cash_amount, upi_amount, notes)
        paid_at = ledger_entry.created_at or timezone.now()

        existing = CreditPayment.objects.filter(source_ledger_entry_id=ledger_entry.id).first()
        if existing:
            old_amount = existing.amount
            existing.payment_method = method
            existing.amount = amount
            existing.cash_amount = cash_amount
            existing.upi_amount = upi_amount
            existing.notes = notes
            existing.paid_at = paid_at
            existing.save()

            le = CreditLedgerEntry.objects.filter(payment=existing).first()
            if le:
                le.amount = amount
                le.description = ledger_description
                le.created_at = paid_at
                le.save(update_fields=['amount', 'description', 'created_at'])

            delta = old_amount - amount
            if delta != 0:
                credit_customer.balance = F('balance') + delta
                credit_customer.save(update_fields=['balance', 'updated_at'])
            return

        payment = CreditPayment.objects.create(
            customer=credit_customer,
            payment_method=method,
            amount=amount,
            cash_amount=cash_amount,
            upi_amount=upi_amount,
            notes=notes,
            paid_at=paid_at,
            created_by=user,
            source_ledger_entry_id=ledger_entry.id,
        )
        CreditLedgerEntry.objects.create(
            customer=credit_customer,
            payment=payment,
            entry_type='credit',
            amount=amount,
            description=ledger_description,
            created_by=user,
            created_at=paid_at,
        )
        credit_customer.balance = F('balance') - amount
        credit_customer.save(update_fields=['balance', 'updated_at'])
