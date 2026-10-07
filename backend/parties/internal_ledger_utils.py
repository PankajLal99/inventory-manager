"""
Helpers to mirror main ledger activity into the internal (Shop Boys) ledger
when the customer name contains "MT SHOP". Used from invoice creation, edit,
repair invoices, payments, returns, etc. in POS.
"""
import re

from django.utils import timezone

# Must match INTERNAL_LEDGER_NAME_CONTAINS in parties/views.py
INTERNAL_LEDGER_NAME_CONTAINS = 'MT SHOP'

_INVOICE_NUMBER_PATTERNS = (
    re.compile(r'(?:Credit\s+)?Invoice\s+(\S+)', re.I),
    re.compile(r'Payment(?:\s+adjustment)?\s+for\s+Invoice\s+(\S+)', re.I),
    re.compile(r'Credit note\s+\S+\s+for replacement of items from Invoice\s+(\S+)', re.I),
    re.compile(r'Refund for returned items from Invoice\s+(\S+)', re.I),
    re.compile(r'Replacement adjustment for Invoice\s+(\S+)', re.I),
    re.compile(r'Replacement POS return\s+(\S+)', re.I),
)


def _invoice_from_description(description):
    """Best-effort invoice lookup from mirrored internal-ledger description text."""
    if not description:
        return None, None
    from backend.pos.models import Invoice

    for pattern in _INVOICE_NUMBER_PATTERNS:
        match = pattern.search(description)
        if not match:
            continue
        invoice_number = match.group(1).rstrip('.,)')
        invoice = Invoice.objects.filter(invoice_number=invoice_number).only('id', 'invoice_number').first()
        if invoice:
            return invoice.id, invoice.invoice_number
    return None, None


def resolve_invoices_for_internal_entries(entries):
    """
    Bulk-resolve (invoice_id, invoice_number) for InternalLedgerEntry rows.
    Uses source_ledger_entry_id, then main-ledger row match, then description parsing.
    """
    from .models import LedgerEntry

    entries = list(entries)
    result = {entry.id: (None, None) for entry in entries}
    if not entries:
        return result

    source_ids = [entry.source_ledger_entry_id for entry in entries if entry.source_ledger_entry_id]
    if source_ids:
        ledger_by_id = {
            le.id: le
            for le in LedgerEntry.objects.filter(pk__in=source_ids).select_related('invoice')
        }
        for entry in entries:
            if not entry.source_ledger_entry_id:
                continue
            ledger_entry = ledger_by_id.get(entry.source_ledger_entry_id)
            if ledger_entry and ledger_entry.invoice_id:
                result[entry.id] = (ledger_entry.invoice_id, ledger_entry.invoice.invoice_number)

    unresolved = [entry for entry in entries if result[entry.id][0] is None]
    if unresolved:
        ledger_qs = LedgerEntry.objects.filter(
            invoice__isnull=False,
            customer_id__in={entry.customer_id for entry in unresolved if entry.customer_id},
        ).select_related('invoice')
        ledger_rows = list(ledger_qs)
        for entry in unresolved:
            for ledger_entry in ledger_rows:
                if (
                    ledger_entry.customer_id == entry.customer_id
                    and ledger_entry.entry_type == entry.entry_type
                    and ledger_entry.amount == entry.amount
                    and ledger_entry.created_at == entry.created_at
                ):
                    result[entry.id] = (ledger_entry.invoice_id, ledger_entry.invoice.invoice_number)
                    break

    for entry in entries:
        if result[entry.id][0] is not None:
            continue
        result[entry.id] = _invoice_from_description(entry.description)

    return result


def _customer_is_mtshop(customer):
    """
    Return True for Shop Boys / MT Shop customers.
    Matches name containing "MT SHOP" or "SHOP BOY", or MTSHOP customer group.
    """
    if not customer:
        return False
    name = (getattr(customer, 'name', None) or '').upper()
    if INTERNAL_LEDGER_NAME_CONTAINS.upper() in name:
        return True
    if 'SHOP BOY' in name or 'SHOPBOY' in name:
        return True
    group = getattr(customer, 'customer_group', None)
    group_name = (getattr(group, 'name', None) or '').upper() if group else ''
    if not group_name and getattr(customer, 'customer_group_id', None):
        # Group may not be select_related; avoid extra query when name already matched.
        try:
            group_name = (customer.customer_group.name or '').upper()
        except Exception:
            group_name = ''
    return group_name == 'MTSHOP'


def create_internal_ledger_entry_if_mtshop(
    customer,
    entry_type,
    amount,
    description,
    created_by,
    created_at=None,
    source_ledger_entry_id=None,
):
    """
    If customer name contains "MT SHOP", create an InternalLedgerEntry mirroring
    main ledger activity. Does NOT update customer.credit_balance (main ledger already did).
    Use for: invoice checkout, mark as credit, payments, returns, replacements, etc.
    """
    if not customer or not amount or amount <= 0:
        return
    if not _customer_is_mtshop(customer):
        return
    from .models import InternalLedgerEntry
    entry = InternalLedgerEntry.objects.create(
        customer=customer,
        entry_type=entry_type,
        amount=amount,
        description=description or '',
        created_by=created_by,
        created_at=created_at or timezone.now(),
        source_ledger_entry_id=source_ledger_entry_id,
    )
    _sync_salary_advance(entry, created_by)
    return entry


def reverse_internal_ledger_entries_for_ledger_entries(ledger_entries, created_by, reason='Reversal'):
    """
    Before deleting main LedgerEntries (e.g. invoice type change or invoice delete),
    create opposite InternalLedgerEntry for each if customer is MT SHOP.
    Does NOT update customer.credit_balance (caller already reversed it).
    """
    from .models import LedgerEntry
    for entry in ledger_entries.select_related('customer'):
        if not entry.customer or not entry.amount or entry.amount <= 0:
            continue
        if not _customer_is_mtshop(entry.customer):
            continue
        from .models import InternalLedgerEntry
        reverse_type = 'credit' if entry.entry_type == 'debit' else 'debit'
        reverse_entry = InternalLedgerEntry.objects.create(
            customer=entry.customer,
            entry_type=reverse_type,
            amount=entry.amount,
            description=f'{reason}: {entry.description or "ledger entry"}',
            created_by=created_by,
            created_at=timezone.now(),
        )
        _sync_salary_advance(reverse_entry, created_by)


def _sync_salary_advance(entry, created_by=None):
    """Push MT Shop ledger activity into Salary Book advances (best-effort)."""
    try:
        from backend.salary_book.services.mtshop_advances import (
            sync_salary_advance_from_internal_entry,
        )
        sync_salary_advance_from_internal_entry(entry, created_by=created_by)
    except Exception:
        # Never block POS / ledger flows if salary sync fails.
        pass
