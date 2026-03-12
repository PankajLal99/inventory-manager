"""
Helpers to mirror main ledger activity into the internal (Shop Boys) ledger
when the customer name contains "MT SHOP". Used from invoice creation, edit,
repair invoices, payments, returns, etc. in POS.
"""
from django.utils import timezone

# Must match INTERNAL_LEDGER_NAME_CONTAINS in parties/views.py
INTERNAL_LEDGER_NAME_CONTAINS = 'MT SHOP'


def _customer_is_mtshop(customer):
    """Return True if customer exists and name contains MT SHOP (case-insensitive)."""
    if not customer or not getattr(customer, 'name', None):
        return False
    return INTERNAL_LEDGER_NAME_CONTAINS.upper() in (customer.name or '').upper()


def create_internal_ledger_entry_if_mtshop(customer, entry_type, amount, description, created_by, created_at=None):
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
    InternalLedgerEntry.objects.create(
        customer=customer,
        entry_type=entry_type,
        amount=amount,
        description=description or '',
        created_by=created_by,
        created_at=created_at or timezone.now(),
    )


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
        InternalLedgerEntry.objects.create(
            customer=entry.customer,
            entry_type=reverse_type,
            amount=entry.amount,
            description=f'{reason}: {entry.description or "ledger entry"}',
            created_by=created_by,
            created_at=timezone.now(),
        )
