from django.core.management.base import BaseCommand
from django.db import transaction

from backend.pos.models import Invoice
from backend.tenants.models import Retailer


class Command(BaseCommand):
    help = (
        "Fix historical invoices where invoice_type='pending' but status is not 'draft'. "
        "Sets status to 'draft'."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist changes. Without this flag, runs in dry-run mode.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional cap on how many invoices to update (0 = no limit).",
        )
        parser.add_argument(
            "--retailer-code",
            type=str,
            default="",
            help="Optional retailer code to scope updates to one tenant.",
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        limit = int(options["limit"] or 0)
        retailer_code = (options.get("retailer_code") or "").strip()
        retailer = None
        if retailer_code:
            retailer = Retailer.objects.filter(code__iexact=retailer_code, is_active=True).first()
            if not retailer:
                self.stdout.write(self.style.ERROR(f'Retailer code "{retailer_code}" not found or inactive.'))
                return

        qs = Invoice.objects.filter(invoice_type="pending").exclude(status="draft")
        if retailer:
            qs = qs.filter(retailer_id=retailer.id)
        qs = qs.order_by("id")
        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS("No historical pending invoices require fixing."))
            return

        target_ids = list(qs.values_list("id", flat=True)[:limit] if limit > 0 else qs.values_list("id", flat=True))
        to_fix = Invoice.objects.filter(id__in=target_ids).order_by("id")

        self.stdout.write(
            self.style.WARNING(
                f"Found {total} pending invoices with non-draft status. "
                f"Selected {len(target_ids)} for this run (limit={limit or 'none'})."
            )
        )

        for inv in to_fix[:25]:
            self.stdout.write(
                f"  Invoice {inv.invoice_number} (id={inv.id}) status {inv.status!r} -> 'draft'"
            )
        if len(target_ids) > 25:
            self.stdout.write(f"  ... and {len(target_ids) - 25} more")

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry-run complete. Re-run with --apply to update rows."))
            return

        with transaction.atomic():
            updated = to_fix.update(status="draft")

        self.stdout.write(self.style.SUCCESS(f"Updated {updated} invoice(s) to status='draft'."))
