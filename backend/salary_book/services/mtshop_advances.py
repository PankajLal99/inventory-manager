"""
Mirror MT Shop (Shop Boys) ledger activity into Salary Book advances.

Debits (purchases on credit) become ACTIVE advances that reduce net salary.
Credits (payments / settlements / refunds) mark matching advances as PAID so
they are not deducted when the employee already settled separately.
"""
from __future__ import annotations

import re
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from backend.salary_book.models import Employee, SalaryAdvance

_MTSHOP_NAME_NOISE = re.compile(
    r'\b(?:MT\s*SHOP|SHOP\s*BOY|SHOPBOY|MTSHOP)\b',
    re.IGNORECASE,
)

_INVOICE_NUMBER_PATTERNS = (
    re.compile(r'(?:Credit\s+)?Invoice\s+(\S+)', re.I),
    re.compile(r'Payment(?:\s+adjustment)?\s+for\s+Invoice\s+(\S+)', re.I),
    re.compile(r'Credit note\s+\S+\s+for replacement of items from Invoice\s+(\S+)', re.I),
    re.compile(r'Refund for returned items from Invoice\s+(\S+)', re.I),
    re.compile(r'Replacement adjustment for Invoice\s+(\S+)', re.I),
    re.compile(r'Replacement POS return\s+(\S+)', re.I),
)


def normalize_phone(phone: str | None) -> str:
    if not phone:
        return ''
    digits = re.sub(r'\D', '', str(phone))
    if digits.startswith('91') and len(digits) >= 12:
        digits = digits[-10:]
    elif len(digits) > 10:
        digits = digits[-10:]
    return digits


def normalize_mtshop_name(name: str | None) -> str:
    cleaned = _MTSHOP_NAME_NOISE.sub(' ', name or '')
    return ' '.join(cleaned.split()).strip().upper()


def find_employee_for_mtshop_customer(customer):
    """Resolve Salary Book employee for an MT Shop customer."""
    if not customer:
        return None

    linked = (
        Employee.objects.filter(mtshop_customer_id=customer.id, status=Employee.STATUS_ACTIVE)
        .order_by('id')
        .first()
    )
    if linked:
        return linked

    phone = normalize_phone(getattr(customer, 'phone', None))
    if phone:
        by_phone = (
            Employee.objects.filter(status=Employee.STATUS_ACTIVE)
            .filter(Q(mobile__endswith=phone) | Q(alternate_contact__endswith=phone))
            .order_by('id')
            .first()
        )
        if by_phone:
            return by_phone

    target = normalize_mtshop_name(getattr(customer, 'name', None))
    if not target or len(target) < 2:
        return None
    for emp in Employee.objects.filter(status=Employee.STATUS_ACTIVE).only('id', 'name'):
        if normalize_mtshop_name(emp.name) == target:
            return emp
    return None


def _advance_date(created_at):
    if created_at is None:
        return timezone.localdate()
    if timezone.is_aware(created_at):
        return timezone.localtime(created_at).date()
    return created_at.date()


def _invoice_number_from_entry(entry) -> str:
    """Parse invoice number from ledger description text (no DB lookup required)."""
    description = getattr(entry, 'description', '') or ''
    for pattern in _INVOICE_NUMBER_PATTERNS:
        match = pattern.search(description)
        if match:
            return match.group(1).rstrip('.,)')
    return ''


@transaction.atomic
def sync_salary_advance_from_internal_entry(entry, created_by=None):
    """
    Apply one InternalLedgerEntry to Salary Book advances.

    - debit  → create/update ACTIVE MTSHOP advance (idempotent via source_internal_entry_id)
    - credit → mark ACTIVE MTSHOP advances PAID (invoice match, then FIFO)
    """
    if not entry or not getattr(entry, 'customer_id', None):
        return None
    amount = Decimal(str(entry.amount or 0))
    if amount <= 0:
        return None

    employee = find_employee_for_mtshop_customer(entry.customer)
    if not employee:
        return None

    entry_type = (entry.entry_type or '').lower()
    if entry_type == 'debit':
        return _upsert_debit_advance(employee, entry, amount, created_by)
    if entry_type == 'credit':
        return _apply_credit_to_advances(employee, entry, amount, created_by)
    return None


def _upsert_debit_advance(employee, entry, amount, created_by):
    invoice_number = _invoice_number_from_entry(entry)
    reason = (entry.description or '').strip() or 'MT Shop purchase'
    if len(reason) > 255:
        reason = reason[:252] + '...'

    existing = SalaryAdvance.objects.filter(source_internal_entry_id=entry.id).first()
    if existing:
        if existing.status == SalaryAdvance.STATUS_VOID:
            return existing
        existing.amount = amount
        existing.date = _advance_date(entry.created_at)
        existing.reason = reason
        existing.source_invoice_number = invoice_number
        existing.updated_by = created_by
        existing.save(
            update_fields=[
                'amount',
                'date',
                'reason',
                'source_invoice_number',
                'updated_by',
                'updated_at',
            ]
        )
        return existing

    return SalaryAdvance.objects.create(
        employee=employee,
        date=_advance_date(entry.created_at),
        amount=amount,
        reason=reason,
        remarks='Auto-deducted from MT Shop / Shop Boys ledger',
        status=SalaryAdvance.STATUS_ACTIVE,
        source=SalaryAdvance.SOURCE_MTSHOP,
        source_internal_entry_id=entry.id,
        source_invoice_number=invoice_number,
        created_by=created_by,
    )


def _apply_credit_to_advances(employee, entry, amount, created_by):
    """Mark MT Shop advances paid when the employee settles (ledger credit)."""
    remaining = amount
    invoice_number = _invoice_number_from_entry(entry)
    qs = SalaryAdvance.objects.filter(
        employee=employee,
        source=SalaryAdvance.SOURCE_MTSHOP,
        status=SalaryAdvance.STATUS_ACTIVE,
    ).order_by('date', 'id')

    if invoice_number:
        matched = list(qs.filter(source_invoice_number=invoice_number))
        rest = list(qs.exclude(source_invoice_number=invoice_number))
        ordered = matched + rest
    else:
        ordered = list(qs)

    updated = []
    for advance in ordered:
        if remaining <= 0:
            break
        if advance.amount <= remaining:
            remaining -= advance.amount
            advance.status = SalaryAdvance.STATUS_PAID
            advance.updated_by = created_by
            advance.remarks = (
                (advance.remarks + '\n' if advance.remarks else '')
                + f'Marked paid via ledger credit (entry #{entry.id})'
            ).strip()
            advance.save(update_fields=['status', 'updated_by', 'remarks', 'updated_at'])
            updated.append(advance)
        else:
            # Partial settlement: shrink remaining active amount.
            advance.amount = advance.amount - remaining
            remaining = Decimal('0')
            advance.updated_by = created_by
            advance.remarks = (
                (advance.remarks + '\n' if advance.remarks else '')
                + f'Partial settlement via ledger credit (entry #{entry.id})'
            ).strip()
            advance.save(update_fields=['amount', 'updated_by', 'remarks', 'updated_at'])
            updated.append(advance)
    return updated


def void_advance_for_internal_entry(entry_id, updated_by=None):
    """When an internal ledger debit is deleted, void the linked advance."""
    advance = SalaryAdvance.objects.filter(
        source_internal_entry_id=entry_id,
        source=SalaryAdvance.SOURCE_MTSHOP,
    ).first()
    if not advance or advance.status == SalaryAdvance.STATUS_VOID:
        return advance
    advance.status = SalaryAdvance.STATUS_VOID
    advance.updated_by = updated_by
    advance.save(update_fields=['status', 'updated_by', 'updated_at'])
    return advance
