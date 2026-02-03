"""Find barcodes tagged 'sold' that are not in any InvoiceItem. Optionally reset them to 'new' and log."""
import os
from datetime import datetime

from django.core.management.base import BaseCommand
from django.db.models import Exists, OuterRef

from backend.catalog.models import Barcode
from backend.core.models import AuditLog
from backend.pos.models import InvoiceItem


class Command(BaseCommand):
    help = "List barcodes tagged 'sold' that are not in any invoice; with --no-dry-run, set them to 'new' and log"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=True,
            help="Only list barcodes, no changes (default: True)",
        )
        parser.add_argument(
            "--no-dry-run",
            action="store_false",
            dest="dry_run",
            help="Reset tag to 'new' and write audit + file log",
        )
        parser.add_argument(
            "--log-dir",
            type=str,
            default="",
            help="Directory for file log (default: project root)",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        log_dir = options.get("log_dir") or os.path.dirname(
            os.path.dirname(
                os.path.dirname(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                )
            )
        )
        in_invoice = InvoiceItem.objects.filter(barcode_id=OuterRef("pk"))
        sold_not_in_invoices = Barcode.objects.filter(tag="sold").exclude(
            Exists(in_invoice)
        )
        qs = sold_not_in_invoices.values_list("id", "barcode")
        rows = list(qs)
        barcode_ids = [r[0] for r in rows]
        barcode_strings = [r[1] for r in rows]
        count = len(rows)

        self.stdout.write(f"Count: {count}")
        for b in barcode_strings:
            self.stdout.write(b)

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no changes made."))
            return

        if count == 0:
            self.stdout.write("Nothing to fix.")
            return

        # Reset tag to 'new'
        updated = Barcode.objects.filter(pk__in=barcode_ids).update(tag="new")
        self.stdout.write(self.style.SUCCESS(f"Reset {updated} barcode(s) to 'new'."))

        # AuditLog: one entry for this run
        barcode_ref = ",".join(barcode_strings[:50])
        if len(barcode_strings) > 50:
            barcode_ref += f" ... (+{len(barcode_strings) - 50} more)"
        AuditLog.objects.create(
            user=None,
            action="barcode_tag_change",
            model_name="Barcode",
            object_id="check_sold_not_in_invoices",
            object_name=f"Reset {count} barcodes (sold→new)",
            object_reference=datetime.now().isoformat(),
            barcode=barcode_ref[:1000] if len(barcode_ref) > 1000 else barcode_ref,
            changes={
                "from_tag": "sold",
                "to_tag": "new",
                "count": count,
                "barcodes": barcode_strings,
            },
        )

        # File log
        log_path = os.path.join(log_dir, "sold_not_in_invoices.log")
        with open(log_path, "a") as f:
            f.write(f"\n[{datetime.now().isoformat()}] count={count}\n")
            for b in barcode_strings:
                f.write(f"  {b}\n")
        self.stdout.write(f"Logged to {log_path}")
