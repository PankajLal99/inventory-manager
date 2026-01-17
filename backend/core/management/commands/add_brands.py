"""
Management command to add predefined brands to the database
"""
from django.core.management.base import BaseCommand
from backend.catalog.models import Brand


class Command(BaseCommand):
    help = "Adds predefined product brands to the database"

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear all existing brands before adding new ones',
        )

    def handle(self, *args, **options):
        clear = options['clear']

        # List of brands to add (removed duplicates)
        brands = [
            'LG',
            'POCO',
            'IQ/vivo',
            'IQ',
            'APPLE',
            'BENCO',
            'GLASS',
            'NOTHING',
            'OTHER',
            'TOOLS',
            'AMS',
            'BACK GLASS',
            'REDMI',
            'SONY',
            'SAMSUNG',
            'REALME',
            'IPHONE',
            'OPPO',
            'ONE +',
            'ITEL',
            'NOKIA',
            'VIVO',
            'ZENPHONE',
            'LENOVO',
            'HONOR',
            'MOBISTAR',
            'HTC',
            'PANASONIC',
            'TECNO',
            'INFINIX',
            'COOLPAD',
            'COMIO',
            'LAVA',
            'INTEX',
            'LYF',
            'LETV',
            'INFOCUS',
            'MICROMAX',
            'GIONEE',
            'VOTO',
            'TAMBO',
            'MOTOROLA',
        ]

        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(self.style.SUCCESS("ADDING PRODUCT BRANDS"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))

        if clear:
            self.stdout.write(self.style.WARNING("Clearing all existing brands..."))
            Brand.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("All brands cleared."))

        created_count = 0
        skipped_count = 0
        error_count = 0

        for brand_name in brands:
            # Skip empty strings
            if not brand_name or brand_name.strip() == '':
                continue
            
            brand_name = brand_name.strip()
            
            # Check if brand already exists
            try:
                brand, created = Brand.objects.get_or_create(
                    name=brand_name,
                    defaults={
                        'is_active': True,
                    }
                )

                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"  ✓ Created: {brand_name}"))
                else:
                    skipped_count += 1
                    self.stdout.write(self.style.WARNING(f"  ⊘ Skipped (already exists): {brand_name}"))
            except Exception as e:
                error_count += 1
                self.stdout.write(self.style.ERROR(f"  ✗ Error creating {brand_name}: {e}"))

        self.stdout.write(self.style.SUCCESS("\n================================================================================"))
        self.stdout.write(self.style.SUCCESS("SUMMARY"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(f"Brands Created: {created_count}")
        self.stdout.write(f"Brands Skipped (already exist): {skipped_count}")
        if error_count > 0:
            self.stdout.write(self.style.ERROR(f"Brands with Errors: {error_count}"))
        self.stdout.write(f"Total Brands in Database: {Brand.objects.count()}")
        self.stdout.write(self.style.SUCCESS("================================================================================"))

