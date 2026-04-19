"""
Deep validation for one customer: ledger replay vs credit_balance, invoices,
and random barcode/short_code consistency (POS / cart / sale lines).

Examples (local DB):

  python manage.py validate_ledger_customer 726
  python manage.py validate_ledger_customer 726 --store 0 --sample 15 --seed 42
  python manage.py validate_ledger_customer 726 --credit-only

  Only status=credit + invoice_type=credit invoices (and their lines / ledger rows):

  python manage.py validate_ledger_customer 726 --store 0 --credit-credit-only --sample 50
"""
from __future__ import annotations

import random
from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Q

from backend.catalog.models import Barcode
from backend.parties.models import Customer, LedgerEntry
from backend.parties.views import _credit_invoice_plus_manual_payment_filter
from backend.pos.models import Cart, CartItem, Invoice, InvoiceItem


def _ledger_base_qs(customer: Customer, *, store_id: int | None, credit_only: bool):
    qs = LedgerEntry.objects.filter(customer=customer).filter(
        Q(invoice__isnull=False) | Q(invoice__isnull=True, is_sent=True)
    )
    if credit_only:
        qs = qs.filter(_credit_invoice_plus_manual_payment_filter())
    if store_id is not None and store_id != 0:
        qs = qs.filter(Q(invoice__store_id=store_id) | Q(invoice__isnull=True))
    return qs.select_related('invoice', 'invoice__store').order_by('created_at', 'id')


def _replay_running(entries) -> Decimal:
    bal = Decimal('0.00')
    for e in entries:
        amt = Decimal(str(e.amount))
        if e.entry_type == 'credit':
            bal += amt
        else:
            bal -= amt
    return bal


class Command(BaseCommand):
    help = 'Validate ledger, invoices, and random barcodes for one customer (local QA).'

    def add_arguments(self, parser):
        parser.add_argument('customer_id', type=int, help='Customer primary key (e.g. 726 from /ledger/726).')
        parser.add_argument(
            '--store',
            type=int,
            default=None,
            help='Filter ledger + pending helpers by store id; 0 or omit = all stores.',
        )
        parser.add_argument(
            '--credit-only',
            action='store_true',
            help='Apply same filter as Ledger UI "credit only" (invoice_status=credit path).',
        )
        parser.add_argument(
            '--credit-credit-only',
            action='store_true',
            help='Restrict invoice list, barcode sampling, and ledger replay slice to invoices where status=credit AND invoice_type=credit.',
        )
        parser.add_argument('--sample', type=int, default=12, help='How many random barcodes to deep-check.')
        parser.add_argument('--seed', type=int, default=None, help='RNG seed for sampling.')

    def handle(self, *args, **options):
        cid = options['customer_id']
        store_raw = options.get('store')
        store_id = None if store_raw in (None, 0) else int(store_raw)
        credit_only = options['credit_only']
        credit_credit_only = options['credit_credit_only']
        sample_n = max(0, int(options['sample']))
        seed = options.get('seed')
        if seed is not None:
            random.seed(seed)

        cust = Customer.objects.filter(pk=cid).first()
        if not cust:
            self.stdout.write(self.style.ERROR(f'Customer id={cid} not found.'))
            return

        self.stdout.write(self.style.NOTICE(f'=== Customer {cid}: {cust.name} ==='))
        self.stdout.write(f'credit_balance (DB): {cust.credit_balance}')

        qs_all = _ledger_base_qs(cust, store_id=store_id, credit_only=False)
        qs_view = _ledger_base_qs(cust, store_id=store_id, credit_only=credit_only)

        entries_all = list(qs_all)
        entries_view = list(qs_view)

        replay_all = _replay_running(entries_all)
        replay_view = _replay_running(entries_view)
        self.stdout.write(f'Ledger entries (all filters): {len(entries_all)}; replay balance: {replay_all}')
        self.stdout.write(
            f'Ledger entries ({"credit-only view" if credit_only else "same as all"}): {len(entries_view)}; replay: {replay_view}'
        )

        tot_cr = sum((Decimal(str(e.amount)) for e in entries_all if e.entry_type == 'credit'), Decimal('0'))
        tot_dr = sum((Decimal(str(e.amount)) for e in entries_all if e.entry_type == 'debit'), Decimal('0'))
        self.stdout.write(f'Ledger totals: credits={tot_cr} debits={tot_dr} (credits - debits)={tot_cr - tot_dr}')

        drift_all = (Decimal(str(cust.credit_balance or 0)) - replay_all).quantize(Decimal('0.01'))
        if credit_credit_only:
            self.stdout.write(self.style.NOTICE('(credit_balance drift vs full ledger skipped when using --credit-credit-only; see slice below.)'))
        elif drift_all != 0:
            self.stdout.write(
                self.style.WARNING(
                    f'DRIFT: credit_balance ({cust.credit_balance}) - ledger_replay ({replay_all}) = {drift_all}. '
                    'Often normal if balance was seeded, manually edited, or not all history is in LedgerEntry.'
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS('credit_balance matches full ledger replay (this queryset).'))

        # --- Invoices ---
        inv_q = Invoice.objects.filter(customer_id=cid).exclude(status='void').select_related('store')
        if store_id:
            inv_q = inv_q.filter(store_id=store_id)
        if credit_credit_only:
            inv_q = inv_q.filter(status='credit', invoice_type='credit')
        invoices = list(inv_q.order_by('-id')[:200])
        title = (
            'Invoices (credit/credit only, non-void, limit 200)'
            if credit_credit_only
            else 'Invoices (non-void, limit 200)'
        )
        self.stdout.write(self.style.NOTICE(f'\n=== {title}: {len(invoices)} ==='))
        by_status = defaultdict(int)
        for inv in invoices:
            by_status[f'{inv.status}/{inv.invoice_type}'] += 1
        for k in sorted(by_status.keys()):
            self.stdout.write(f'  {k}: {by_status[k]}')

        if credit_credit_only and invoices:
            self.stdout.write('  credit/credit invoice list:')
            for inv in sorted(invoices, key=lambda x: x.invoice_number or ''):
                n_items = InvoiceItem.objects.filter(invoice_id=inv.id).count()
                n_bc = InvoiceItem.objects.filter(invoice_id=inv.id, barcode_id__isnull=False).count()
                self.stdout.write(
                    f'    - {inv.invoice_number} id={inv.id} total={inv.total} items={n_items} with_barcode={n_bc}'
                )

        if credit_credit_only:
            cc_ids = {i.id for i in invoices}
            cc_entries = [e for e in entries_all if e.invoice_id and e.invoice_id in cc_ids]
            replay_cc = _replay_running(cc_entries)
            tot_cc_cr = sum((Decimal(str(e.amount)) for e in cc_entries if e.entry_type == 'credit'), Decimal('0'))
            tot_cc_dr = sum((Decimal(str(e.amount)) for e in cc_entries if e.entry_type == 'debit'), Decimal('0'))
            self.stdout.write(
                self.style.NOTICE(
                    f'\n=== Ledger rows only on these credit/credit invoices: {len(cc_entries)} ==='
                )
            )
            self.stdout.write(f'  credits={tot_cc_cr} debits={tot_cc_dr} replay={replay_cc}')
            inv_totals = sum((Decimal(str(i.total or 0)) for i in invoices), Decimal('0'))
            self.stdout.write(f'  sum(invoice.total) over {len(invoices)} invoices: {inv_totals}')
            debit_rows = [e for e in cc_entries if e.entry_type == 'debit']
            debit_sum = sum((Decimal(str(e.amount)) for e in debit_rows), Decimal('0'))
            if debit_rows and debit_sum != inv_totals:
                self.stdout.write(
                    self.style.WARNING(
                        f'  note: sum(debit amounts) on these invoices={debit_sum} vs sum(invoice.total)={inv_totals} '
                        '(edit/adjust/partial mark-credit can differ).'
                    )
                )

        # Replacement returns (within current invoice set)
        repl = [i for i in invoices if i.is_replacement_return]
        if repl:
            self.stdout.write(f'  replacement_return invoices: {len(repl)}')
            for inv in repl[:5]:
                self.stdout.write(
                    f'    - {inv.invoice_number} mode={inv.replacement_mode} status={inv.status} total={inv.total}'
                )

        # --- Barcode sample from this customer's invoice lines ---
        item_qs = (
            InvoiceItem.objects.filter(invoice__customer_id=cid, barcode_id__isnull=False)
            .exclude(invoice__status='void')
            .select_related('invoice', 'barcode', 'product')
        )
        if store_id:
            item_qs = item_qs.filter(invoice__store_id=store_id)
        if credit_credit_only:
            item_qs = item_qs.filter(invoice__status='credit', invoice__invoice_type='credit')
        items_with_bc = list(item_qs[:500])
        barcode_ids = {it.barcode_id for it in items_with_bc if it.barcode_id}
        barcodes = list(Barcode.objects.filter(pk__in=barcode_ids).select_related('product'))
        if sample_n and len(barcodes) > sample_n:
            barcodes = random.sample(barcodes, sample_n)

        bc_scope = 'credit/credit invoice lines only' if credit_credit_only else 'all sampled customer invoice lines'
        self.stdout.write(
            self.style.NOTICE(
                f'\n=== Barcode checks ({bc_scope}; sample {len(barcodes)} of {len(barcode_ids)} distinct) ==='
            )
        )

        active_cart_bc = set()
        for ci in CartItem.objects.filter(cart__status='active').exclude(scanned_barcodes=[]):
            for raw in ci.scanned_barcodes or []:
                active_cart_bc.add(str(raw).strip().upper())

        sold_line_bc_ids = set(
            InvoiceItem.objects.filter(
                invoice__status__in=('paid', 'partial', 'credit'),
                barcode_id__isnull=False,
            )
            .exclude(invoice__status='void')
            .values_list('barcode_id', flat=True)
            .distinct()
        )
        # Barcodes that appear on THIS customer's completed invoices (narrower than global sold set)
        cust_sold_bc_ids = set(
            InvoiceItem.objects.filter(
                invoice__customer_id=cid,
                invoice__status__in=('paid', 'partial', 'credit'),
                barcode_id__isnull=False,
            )
            .exclude(invoice__status='void')
            .values_list('barcode_id', flat=True)
            .distinct()
        )

        issues = 0
        for bc in barcodes:
            label = (bc.short_code or bc.barcode or '').strip() or f'id={bc.id}'
            problems = []
            on_completed_sale = bc.id in sold_line_bc_ids
            on_cust_completed = bc.id in cust_sold_bc_ids
            if bc.tag == 'sold' and not on_completed_sale:
                problems.append("tag=sold but no global paid/partial/credit invoice line")
            if bc.tag == 'sold' and on_completed_sale and not on_cust_completed:
                problems.append("tag=sold on completed line for another customer (sticker reuse / wrong link?)")
            if bc.tag in ('new', 'returned') and on_completed_sale:
                if bc.tag == 'new':
                    problems.append("tag=new but still linked to completed sale line (data smell)")
            if bc.tag == 'in-cart':
                full_u = (bc.barcode or '').strip().upper()
                short_u = (bc.short_code or '').strip().upper() if bc.short_code else None
                if full_u not in active_cart_bc and (not short_u or short_u not in active_cart_bc):
                    problems.append("tag=in-cart but barcode not in any active CartItem.scanned_barcodes")
            if problems:
                issues += 1
                self.stdout.write(self.style.ERROR(f'  [{label}] id={bc.id} tag={bc.tag} :: ' + ' | '.join(problems)))
            else:
                self.stdout.write(f'  OK [{label}] id={bc.id} tag={bc.tag} completed_sale_line={on_completed_sale}')

        # --- Ledger row sanity (replacement settlement should be credit after fix) ---
        self.stdout.write(self.style.NOTICE('\n=== Ledger row spot-checks ==='))
        bad = 0
        entry_rows_for_repl_check = (
            [e for e in entries_all if e.invoice_id and e.invoice_id in {i.id for i in invoices}]
            if credit_credit_only
            else entries_all
        )
        for e in entry_rows_for_repl_check:
            if e.invoice and e.invoice.is_replacement_return and 'Replacement return POS settlement' in (e.description or ''):
                if e.entry_type != 'credit':
                    self.stdout.write(
                        self.style.ERROR(
                            f'  id={e.id} inv={e.invoice.invoice_number}: replacement settlement should be credit, got {e.entry_type}'
                        )
                    )
                    bad += 1
        if bad == 0:
            self.stdout.write('  No stale replacement-settlement DEBIT rows in this slice.')

        self.stdout.write(self.style.NOTICE('\n=== Summary ==='))
        drift_flag = Decimal('0') if credit_credit_only else drift_all
        if issues or bad or drift_flag != 0:
            self.stdout.write(
                self.style.WARNING(
                    f'Done with warnings: barcode_issues={issues}, bad_ledger_rows={bad}, '
                    f'balance_drift_vs_full_ledger={drift_all if not credit_credit_only else "n/a (credit-credit-only mode)"}'
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS('Done: no barcode spot issues; replacement rows OK; balance aligned.'))
