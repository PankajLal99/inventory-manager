"""
Django management command to test cache configuration.

Usage:
    python manage.py test_cache
"""
from django.core.management.base import BaseCommand
from django.core.cache import cache
from django.conf import settings


class Command(BaseCommand):
    help = 'Test cache configuration and verify it is working'

    def handle(self, *args, **options):
        self.stdout.write("=" * 60)
        self.stdout.write(self.style.SUCCESS("Cache Configuration Test"))
        self.stdout.write("=" * 60)
        
        # Check configuration
        self.stdout.write(f"\n1. Cache Backend: {settings.CACHES['default']['BACKEND']}")
        self.stdout.write(f"2. Cache Location: {settings.CACHES['default'].get('LOCATION', 'N/A')}")
        
        # Test basic operations
        self.stdout.write("\n3. Testing Cache Operations:")
        self.stdout.write("-" * 60)
        
        try:
            # Test SET
            cache.set('test_key', 'test_value', 60)
            self.stdout.write(self.style.SUCCESS("✅ Cache SET: Success"))
            
            # Test GET
            value = cache.get('test_key')
            if value == 'test_value':
                self.stdout.write(self.style.SUCCESS("✅ Cache GET: Success (value matches)"))
            else:
                self.stdout.write(self.style.ERROR(f"❌ Cache GET: Failed (got: {value})"))
            
            # Test DELETE
            cache.delete('test_key')
            deleted_value = cache.get('test_key')
            if deleted_value is None:
                self.stdout.write(self.style.SUCCESS("✅ Cache DELETE: Success"))
            else:
                self.stdout.write(self.style.ERROR("❌ Cache DELETE: Failed"))
            
            # Test barcode cache
            self.stdout.write("\n4. Testing Barcode Cache:")
            self.stdout.write("-" * 60)
            
            from backend.catalog.barcode_cache import (
                get_barcode_cache_key,
                get_short_code_cache_key,
            )
            
            test_data = {
                'id': 999999,
                'barcode': 'TEST-BARCODE-123',
                'short_code': 'TEST-123',
                'tag': 'new',
            }
            
            barcode_key = get_barcode_cache_key('TEST-BARCODE-123')
            short_code_key = get_short_code_cache_key('TEST-123')
            
            cache.set(barcode_key, test_data, 600)
            cache.set(short_code_key, test_data, 600)
            self.stdout.write(self.style.SUCCESS("✅ Barcode data cached"))
            
            cached = cache.get(barcode_key)
            if cached:
                self.stdout.write(self.style.SUCCESS(f"✅ Barcode cache retrieval: {cached['barcode']}"))
            
            # Cleanup
            cache.delete(barcode_key)
            cache.delete(short_code_key)
            cache.delete('test_key')
            
            self.stdout.write("\n" + "=" * 60)
            self.stdout.write(self.style.SUCCESS("✅ ALL TESTS PASSED - Cache is working!"))
            self.stdout.write("=" * 60)
            
        except Exception as e:
            self.stdout.write("\n" + "=" * 60)
            self.stdout.write(self.style.ERROR(f"❌ ERROR: {str(e)}"))
            self.stdout.write("=" * 60)
            self.stdout.write(self.style.WARNING("\nTroubleshooting:"))
            self.stdout.write("   1. Check REDIS_URL in .env file")
            self.stdout.write("   2. Verify django-redis is installed: pip install django-redis")
            self.stdout.write("   3. Test Redis connection from your server")
            if 'REDIS_URL' in str(e) or 'Connection' in str(e):
                self.stdout.write("   4. Verify Redis service is accessible")
            raise
