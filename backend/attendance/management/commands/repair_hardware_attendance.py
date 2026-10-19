from django.core.management.base import BaseCommand

from backend.attendance.services.attendance import repair_hardware_attendance


class Command(BaseCommand):
    help = (
        'Rebuild hardware salary-book attendance from stored ADMS punches. '
        'Fixes inverted check-in/out and accidental double-scan check-outs. '
        'Skips leave/holiday and manual/geo days.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Count changes without writing.',
        )

    def handle(self, *args, **options):
        dry_run = bool(options['dry_run'])
        stats = repair_hardware_attendance(dry_run=dry_run)
        label = 'Dry-run' if dry_run else 'Applied'
        self.stdout.write(
            self.style.SUCCESS(
                f'{label}: scanned={stats["scanned"]} updated={stats["updated"]} '
                f'unchanged={stats["unchanged"]} skipped_protected={stats["skipped_protected"]} '
                f'skipped_manual={stats["skipped_manual"]} no_punches={stats["no_punches"]}'
            )
        )
