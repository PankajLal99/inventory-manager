"""
Management command to import customers from CSV file
"""
import csv
import os
from django.core.management.base import BaseCommand
from django.conf import settings
from backend.parties.models import Customer
import re


class Command(BaseCommand):
    help = "Imports customers from distinct_customers.csv file"

    def add_arguments(self, parser):
        parser.add_argument(
            '--csv-file',
            type=str,
            default='inventory-manager/distinct_customers.csv',
            help='Path to the CSV file (default: distinct_customers.csv)',
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear all existing customers before importing',
        )
        parser.add_argument(
            '--normalize',
            action='store_true',
            help='Normalize customer names (remove emojis, extra spaces) before checking for duplicates',
        )

    def normalize_name(self, name):
        """Remove emojis and normalize whitespace"""
        if not name:
            return ''
        # Remove emojis and special characters (keep basic punctuation)
        name = re.sub(r'[❤️♥️💚💙💛🧡💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟]', '', name)
        # Normalize whitespace
        name = ' '.join(name.split())
        return name.strip()

    def handle(self, *args, **options):
        csv_file = options['csv_file']
        clear = options['clear']
        normalize = options['normalize']

        # Get the full path to the CSV file
        if not os.path.isabs(csv_file):
            # If relative path, assume it's in the project root
            csv_file = os.path.join(settings.BASE_DIR, '..', csv_file)
            csv_file = os.path.normpath(csv_file)

        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(self.style.SUCCESS("IMPORTING CUSTOMERS FROM CSV"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(f"CSV File: {csv_file}")

        if not os.path.exists(csv_file):
            self.stdout.write(self.style.ERROR(f"Error: CSV file not found at {csv_file}"))
            return

        if clear:
            self.stdout.write(self.style.WARNING("Clearing all existing customers..."))
            Customer.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("All customers cleared."))

        created_count = 0
        skipped_count = 0
        error_count = 0
        empty_count = 0

        # Track names we've seen to avoid duplicates within the CSV
        seen_names = set()

        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                
                for row in reader:
                    customer_name = row.get('customer_name', '').strip()
                    
                    # Skip empty names
                    if not customer_name:
                        empty_count += 1
                        continue
                    
                    # Normalize name if requested
                    if normalize:
                        normalized_name = self.normalize_name(customer_name)
                        if not normalized_name:
                            empty_count += 1
                            continue
                        # Use normalized name for duplicate checking
                        check_name = normalized_name
                        display_name = customer_name  # Keep original for display
                    else:
                        check_name = customer_name
                        display_name = customer_name
                    
                    # Skip if we've already seen this name in the CSV
                    if check_name.lower() in seen_names:
                        skipped_count += 1
                        self.stdout.write(self.style.WARNING(f"  ⊘ Skipped (duplicate in CSV): {display_name}"))
                        continue
                    
                    seen_names.add(check_name.lower())
                    
                    # Check if customer already exists in database
                    if normalize:
                        # Try to find by normalized name
                        existing = Customer.objects.filter(
                            name__iexact=normalized_name
                        ).first()
                    else:
                        existing = Customer.objects.filter(
                            name__iexact=customer_name
                        ).first()
                    
                    if existing:
                        skipped_count += 1
                        self.stdout.write(self.style.WARNING(f"  ⊘ Skipped (already exists): {display_name}"))
                        continue
                    
                    # Create new customer
                    try:
                        customer = Customer.objects.create(
                            name=display_name,
                            phone=None,  # CSV doesn't have phone numbers
                            email='',
                            address='',
                            is_active=True,
                        )
                        created_count += 1
                        self.stdout.write(self.style.SUCCESS(f"  ✓ Created: {display_name}"))
                    except Exception as e:
                        error_count += 1
                        self.stdout.write(self.style.ERROR(f"  ✗ Error creating {display_name}: {e}"))

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error reading CSV file: {e}"))
            return

        self.stdout.write(self.style.SUCCESS("\n================================================================================"))
        self.stdout.write(self.style.SUCCESS("SUMMARY"))
        self.stdout.write(self.style.SUCCESS("================================================================================"))
        self.stdout.write(f"Customers Created: {created_count}")
        self.stdout.write(f"Customers Skipped (duplicates/existing): {skipped_count}")
        self.stdout.write(f"Empty Rows Skipped: {empty_count}")
        if error_count > 0:
            self.stdout.write(self.style.ERROR(f"Customers with Errors: {error_count}"))
        self.stdout.write(f"Total Customers in Database: {Customer.objects.count()}")
        self.stdout.write(self.style.SUCCESS("================================================================================"))

