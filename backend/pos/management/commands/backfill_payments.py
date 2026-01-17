"""
Management command to backfill Payment records for existing paid invoices that don't have them.
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from decimal import Decimal
from backend.pos.models import Invoice, Payment


class Command(BaseCommand):
    help = 'Backfill Payment records for existing paid invoices that don\'t have them'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be done without actually creating Payment records',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Show detailed information for each invoice',
        )
        parser.add_argument(
            '--invoice-type',
            type=str,
            choices=['cash', 'upi', 'mixed', 'all'],
            default='all',
            help='Only backfill invoices of a specific type (default: all)',
        )
        parser.add_argument(
            '--limit',
            type=int,
            help='Limit the number of invoices to process (useful for testing)',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        verbose = options['verbose']
        invoice_type_filter = options['invoice_type']
        limit = options.get('limit')

        self.stdout.write(self.style.SUCCESS('Backfilling Payment records for paid invoices...\n'))

        # Find invoices that are paid but don't have Payment records
        # Exclude void invoices and pending invoices (they shouldn't have payments)
        invoices_query = Invoice.objects.filter(
            status__in=['paid', 'partial']
        ).exclude(
            status='void'
        ).exclude(
            invoice_type='pending'
        ).exclude(
            payments__isnull=False
        ).select_related('created_by', 'store', 'customer')

        # Filter by invoice_type if specified
        if invoice_type_filter != 'all':
            invoices_query = invoices_query.filter(invoice_type=invoice_type_filter)

        # Apply limit if specified
        if limit:
            invoices_query = invoices_query[:limit]

        invoices = list(invoices_query)
        total_invoices = len(invoices)

        if total_invoices == 0:
            self.stdout.write(self.style.SUCCESS('✓ No invoices found that need Payment records backfilled.'))
            return

        self.stdout.write(f'Found {total_invoices} invoice(s) that need Payment records.\n')

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN MODE - No Payment records will be created\n'))

        created_count = 0
        skipped_count = 0
        error_count = 0

        # Process invoices
        for invoice in invoices:
            try:
                # Determine payment method based on invoice_type
                payment_method = None
                # For partial payments, use paid_amount; for paid invoices, use total
                # (paid_amount should equal total for fully paid invoices)
                if invoice.status == 'partial' and invoice.paid_amount > 0:
                    payment_amount = invoice.paid_amount
                else:
                    payment_amount = invoice.total

                if invoice.invoice_type == 'cash':
                    payment_method = 'cash'
                elif invoice.invoice_type == 'upi':
                    payment_method = 'upi'
                elif invoice.invoice_type == 'mixed':
                    # For mixed payments, we need to split the amount
                    # Since we don't have the original split, we'll create two payments
                    # with equal amounts (or use paid_amount if available)
                    # This is a best-effort approach
                    if not dry_run:
                        # Split the total equally (or use a heuristic)
                        # In practice, you might want to check if there's any way to determine the split
                        cash_amount = payment_amount / 2
                        upi_amount = payment_amount - cash_amount

                        # Create two Payment records
                        Payment.objects.create(
                            invoice=invoice,
                            payment_method='cash',
                            amount=cash_amount,
                            created_by=invoice.created_by,
                            created_at=invoice.created_at,
                            reference=f'Backfilled from invoice {invoice.invoice_number}',
                            notes='Backfilled payment record - split amount estimated'
                        )
                        Payment.objects.create(
                            invoice=invoice,
                            payment_method='upi',
                            amount=upi_amount,
                            created_by=invoice.created_by,
                            created_at=invoice.created_at,
                            reference=f'Backfilled from invoice {invoice.invoice_number}',
                            notes='Backfilled payment record - split amount estimated'
                        )
                        created_count += 2
                    else:
                        # Dry run: show what would be created
                        cash_amount = payment_amount / 2
                        upi_amount = payment_amount - cash_amount
                        if verbose:
                            self.stdout.write(
                                f'  Would create 2 Payment records for {invoice.invoice_number}: '
                                f'Cash: ₹{cash_amount}, UPI: ₹{upi_amount}'
                            )
                        created_count += 2
                    continue
                elif invoice.invoice_type == 'pending':
                    # Pending invoices shouldn't have payments, skip them
                    skipped_count += 1
                    if verbose:
                        self.stdout.write(
                            self.style.WARNING(
                                f'  Skipping {invoice.invoice_number}: pending invoices should not have payments'
                            )
                        )
                    continue
                elif invoice.invoice_type == 'defective':
                    # Defective invoices might not have payments, skip them
                    skipped_count += 1
                    if verbose:
                        self.stdout.write(
                            self.style.WARNING(
                                f'  Skipping {invoice.invoice_number}: defective invoices may not have payments'
                            )
                        )
                    continue
                else:
                    # Unknown invoice_type, skip
                    skipped_count += 1
                    if verbose:
                        self.stdout.write(
                            self.style.WARNING(
                                f'  Skipping {invoice.invoice_number}: unknown invoice_type "{invoice.invoice_type}"'
                            )
                        )
                    continue

                # Skip if payment_method is still None
                if payment_method is None:
                    skipped_count += 1
                    continue

                # Skip if payment_amount is invalid
                if payment_amount <= 0:
                    skipped_count += 1
                    if verbose:
                        self.stdout.write(
                            self.style.WARNING(
                                f'  Skipping {invoice.invoice_number}: invalid payment amount ({payment_amount})'
                            )
                        )
                    continue

                # Create Payment record
                if not dry_run:
                    with transaction.atomic():
                        Payment.objects.create(
                            invoice=invoice,
                            payment_method=payment_method,
                            amount=payment_amount,
                            created_by=invoice.created_by,
                            created_at=invoice.created_at,
                            reference=f'Backfilled from invoice {invoice.invoice_number}',
                            notes='Backfilled payment record'
                        )
                    created_count += 1
                else:
                    # Dry run: show what would be created
                    if verbose:
                        self.stdout.write(
                            f'  Would create Payment record for {invoice.invoice_number}: '
                            f'{payment_method.upper()} - ₹{payment_amount}'
                        )
                    created_count += 1

                if verbose and not dry_run:
                    self.stdout.write(
                        self.style.SUCCESS(
                            f'  ✓ Created Payment record for {invoice.invoice_number}: '
                            f'{payment_method.upper()} - ₹{payment_amount}'
                        )
                    )

            except Exception as e:
                error_count += 1
                self.stdout.write(
                    self.style.ERROR(
                        f'  ✗ Error processing {invoice.invoice_number}: {str(e)}'
                    )
                )
                if verbose:
                    import traceback
                    self.stdout.write(traceback.format_exc())

        # Summary
        self.stdout.write('\n' + '='*60)
        self.stdout.write(self.style.SUCCESS('Summary:'))
        self.stdout.write(f'  Total invoices processed: {total_invoices}')
        if dry_run:
            self.stdout.write(f'  Payment records that would be created: {created_count}')
        else:
            self.stdout.write(f'  Payment records created: {created_count}')
        if skipped_count > 0:
            self.stdout.write(f'  Invoices skipped: {skipped_count}')
        if error_count > 0:
            self.stdout.write(self.style.ERROR(f'  Errors: {error_count}'))
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    '\nRun without --dry-run to actually create the Payment records.'
                )
            )
        elif created_count > 0:
            self.stdout.write(
                self.style.SUCCESS(
                    f'\n✓ Successfully backfilled {created_count} Payment record(s)!'
                )
            )

