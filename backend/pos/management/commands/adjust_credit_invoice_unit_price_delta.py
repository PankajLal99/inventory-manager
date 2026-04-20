"""
Lower (or raise) sell unit prices on credit invoices and realign invoice totals + customer ledger.

Use when e.g. bulk_unpriced_pending_to_credit used default --profit 20 but you meant 10: subtract 10
per unit on each line, then refresh totals and replace the ledger debit for that invoice.

Examples:
  python manage.py adjust_credit_invoice_unit_price_delta --invoice-ids 123 --subtract-per-unit 10 --username pankajlal --dry-run
  python manage.py adjust_credit_invoice_unit_price_delta --invoice-ids 123 --from-profit 20 --to-profit 10 --username pankajlal
"""
from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.core.utils import create_audit_log
from backend.pos.invoice_credit_service import (
    item_effective_sell_unit_price,
    reconcile_ledger_after_credit_invoice_total_change,
)
from backend.pos.models import Invoice
from backend.tenants.models import Retailer

User = get_user_model()


class Command(BaseCommand):
    help = (
        'Subtract (or add, with negative delta) a fixed amount from each line unit sell price on '
        'credit invoices, recompute line_total and invoice totals, then reconcile ledger + customer balance.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--invoice-ids',
            type=str,
            required=True,
            help='Comma-separated invoice PKs (must be status=credit, invoice_type=credit).',
        )
        parser.add_argument(
            '--subtract-per-unit',
            type=str,
            default='',
            help='Amount to subtract from each line effective unit price (₹). Use --from-profit/--to-profit instead if easier.',
        )
        parser.add_argument(
            '--from-profit',
            type=str,
            default='',
            help='With --to-profit: per-unit delta = from - to (e.g. 20 and 10 => subtract 10).',
        )
        parser.add_argument(
            '--to-profit',
            type=str,
            default='',
            help='See --from-profit.',
        )
        parser.add_argument(
            '--username',
            type=str,
            required=True,
            help='User for ledger created_by and audit.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show planned new prices and totals only.',
        )
        parser.add_argument(
            '--retailer-code',
            type=str,
            default='',
            help='Optional retailer code to scope invoice IDs to one tenant.',
        )

    def handle(self, *args, **options):
        dry_run: bool = options['dry_run']
        retailer_code = (options.get('retailer_code') or '').strip()
        username = (options['username'] or '').strip()
        user = User.objects.filter(username=username).first()
        if not user:
            raise CommandError(f'User not found: {username}')

        raw = (options['subtract_per_unit'] or '').strip()
        fp = (options['from_profit'] or '').strip()
        tp = (options['to_profit'] or '').strip()

        if fp or tp:
            if not fp or not tp:
                raise CommandError('Use both --from-profit and --to-profit together, or use --subtract-per-unit')
            try:
                delta = Decimal(fp) - Decimal(tp)
            except Exception as e:
                raise CommandError(f'Invalid profit args: {e}') from e
        else:
            if not raw:
                raise CommandError('Provide --subtract-per-unit or --from-profit and --to-profit')
            try:
                delta = Decimal(raw)
            except Exception as e:
                raise CommandError(f'Invalid --subtract-per-unit: {e}') from e

        id_parts = [p.strip() for p in options['invoice_ids'].split(',') if p.strip()]
        if not id_parts:
            raise CommandError('--invoice-ids required')
        try:
            ids = [int(x) for x in id_parts]
        except ValueError as e:
            raise CommandError(f'Invalid invoice id: {e}') from e

        retailer = None
        if retailer_code:
            retailer = Retailer.objects.filter(code__iexact=retailer_code, is_active=True).first()
            if not retailer:
                raise CommandError(f'Retailer code "{retailer_code}" not found or inactive.')

        qs = Invoice.objects.filter(pk__in=ids).select_related('customer', 'store')
        if retailer:
            qs = qs.filter(retailer_id=retailer.id)
        found = {inv.pk: inv for inv in qs}
        for pk in ids:
            if pk not in found:
                raise CommandError(f'Invoice id not found: {pk}')

        for inv in qs.order_by('id'):
            if inv.status != 'credit' or inv.invoice_type != 'credit':
                raise CommandError(
                    f'Invoice {inv.id} must be status=credit and invoice_type=credit '
                    f'(got {inv.status!r} / {inv.invoice_type!r}).'
                )
            if not inv.customer_id:
                raise CommandError(f'Invoice {inv.id} has no customer')

        self.stdout.write(
            self.style.NOTICE(
                f'Per-unit price change: {"+" if delta >= 0 else ""}{delta} (dry_run={dry_run})\n'
            )
        )

        for inv in qs.order_by('id'):
            self._process_invoice(inv, delta, user, dry_run)

    def _process_invoice(self, inv: Invoice, delta: Decimal, user, dry_run: bool):
        items = list(inv.items.select_related('product', 'barcode').all())
        old_total = inv.total
        lines_out = []

        for it in items:
            if it.quantity is None or it.quantity <= 0:
                continue
            eff = item_effective_sell_unit_price(it)
            if eff <= 0:
                raise CommandError(f'Invoice {inv.id} item {it.id} has no positive sell price; abort')
            new_u = (eff - delta).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            if new_u <= 0:
                raise CommandError(
                    f'Invoice {inv.id} item {it.id}: new unit price {new_u} <= 0 after delta {delta}; abort'
                )
            new_line = (
                it.quantity * new_u - it.discount_amount + it.tax_amount
            ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            lines_out.append(
                f"  item {it.id} qty={it.quantity} {eff} -> {new_u}  line_total {it.line_total} -> {new_line}"
            )

        self.stdout.write(f'Invoice {inv.id} {inv.invoice_number}  total {old_total} -> (after lines + ledger)')
        for L in lines_out:
            self.stdout.write(L)

        if dry_run:
            new_sub = Decimal('0.00')
            for it in items:
                if it.quantity is None or it.quantity <= 0:
                    continue
                eff = item_effective_sell_unit_price(it)
                new_u = (eff - delta).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                lt = (
                    it.quantity * new_u - it.discount_amount + it.tax_amount
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                new_sub += lt
            preview_total = (
                new_sub - inv.discount_amount + inv.tax_amount
            ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            self.stdout.write(
                self.style.WARNING(f'  (dry-run) preview invoice total ≈ {preview_total}\n')
            )
            return

        with transaction.atomic():
            locked = Invoice.objects.select_for_update().get(pk=inv.pk)
            if locked.status != 'credit' or locked.invoice_type != 'credit':
                raise CommandError(
                    f'Invoice {locked.id} changed under lock (no longer credit); abort'
                )
            for it in locked.items.select_related('product', 'barcode').all():
                if it.quantity is None or it.quantity <= 0:
                    continue
                eff = item_effective_sell_unit_price(it)
                if eff <= 0:
                    raise CommandError(f'Item {it.id} non-positive price under lock')
                new_u = (eff - delta).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if new_u <= 0:
                    raise CommandError(f'Item {it.id} new unit {new_u} <= 0')
                it.manual_unit_price = None
                it.unit_price = new_u
                it.line_total = (
                    it.quantity * new_u - it.discount_amount + it.tax_amount
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                it.save(
                    update_fields=[
                        'manual_unit_price',
                        'unit_price',
                        'line_total',
                    ]
                )

            reconcile_ledger_after_credit_invoice_total_change(
                locked,
                user,
                note='adjust_credit_invoice_unit_price_delta',
            )

        inv.refresh_from_db()
        self.stdout.write(
            self.style.SUCCESS(
                f'  OK total {old_total} -> {inv.total}; ledger + customer balance reconciled.\n'
            )
        )
        create_audit_log(
            request=None,
            action='invoice_update',
            model_name='Invoice',
            object_id=str(inv.id),
            object_name=f'Invoice {inv.invoice_number}',
            object_reference=inv.invoice_number,
            barcode=None,
            user=user,
            changes={
                'invoice_number': inv.invoice_number,
                'subtract_per_unit': str(delta),
                'old_total': str(old_total),
                'new_total': str(inv.total),
                'tool': 'adjust_credit_invoice_unit_price_delta',
            },
        )
