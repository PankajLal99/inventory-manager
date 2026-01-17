"""
Management command to add predefined categories to the database
"""
from django.core.management.base import BaseCommand
from backend.catalog.models import Category


class Command(BaseCommand):
    help = "Adds predefined product categories to the database"

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear all existing categories before adding new ones',
        )

    def handle(self, *args, **options):
        clear = options['clear']

        # List of categories to add (removed duplicates)
        categories = [
            'LCD FLEX',
            'MIC FLEX',
            'SPEAKER FLEX',
            'GLASS',
            'TEMPERED GLASS',
            'VOLUME',
            'POWERBANK',
            'CABLE',
            'CC FLEX',
            'PASTE',
            'MACHINE',
            'OTHER',
            'BOARD MAIN FLEX',
            'TOOLS',
            'FRAME RING',
            'HEADPHONE PLATE',
            'VOLUME FLEX',
            'HOME KEY',
            'LCD',
            'SENSOR FLEX',
            'AIRPODS',
            'SPEAKER',
            'HEADPHONE',
            'CHARGER',
            'NECKBAND',
            'CAMERA FLEX',
            'SIM TRAY',
            'FINGER SENSOR',
            'RINGER BOX',
            'ON-OFF',
            'CAMERA GLASS',
            'MAIN FLEX',
            'FOLDER',
            'HOUSING',
            'BATTERY',
            'PANEL',
            'FRAME',
        ]

        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(self.style.SUCCESS("ADDING PRODUCT CATEGORIES"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))

        if clear:
            self.stdout.write(self.style.WARNING("Clearing all existing categories..."))
            Category.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("All categories cleared."))

        created_count = 0
        skipped_count = 0

        for category_name in categories:
            # Skip empty strings
            if not category_name or category_name.strip() == '' or category_name.upper() == 'NONE':
                continue
            
            category_name = category_name.strip()
            
            # Check if category already exists
            category, created = Category.objects.get_or_create(
                name=category_name,
                defaults={
                    'is_active': True,
                }
            )

            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f"  ✓ Created: {category_name}"))
            else:
                skipped_count += 1
                self.stdout.write(self.style.WARNING(f"  ⊘ Skipped (already exists): {category_name}"))

        self.stdout.write(self.style.SUCCESS("\n================================================================================"))
        self.stdout.write(self.style.SUCCESS("SUMMARY"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(f"Categories Created: {created_count}")
        self.stdout.write(f"Categories Skipped (already exist): {skipped_count}")
        self.stdout.write(f"Total Categories in Database: {Category.objects.count()}")
        self.stdout.write(self.style.SUCCESS("================================================================================"))



