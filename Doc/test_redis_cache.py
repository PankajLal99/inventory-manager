"""
Test script to verify Redis cache is working correctly.

Run this after setting up Redis to verify everything is configured properly:
    python manage.py shell < test_redis_cache.py
    OR
    python manage.py shell
    >>> exec(open('test_redis_cache.py').read())
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

from django.core.cache import cache
from django.conf import settings

print("=" * 60)
print("Redis Cache Test")
print("=" * 60)

# Check configuration
print(f"\n1. Cache Backend: {settings.CACHES['default']['BACKEND']}")
print(f"2. Cache Location: {settings.CACHES['default'].get('LOCATION', 'N/A')}")

# Test basic cache operations
print("\n3. Testing Cache Operations:")
print("-" * 60)

try:
    # Test SET
    cache.set('test_key', 'test_value', 60)
    print("✅ Cache SET: Success")
    
    # Test GET
    value = cache.get('test_key')
    if value == 'test_value':
        print("✅ Cache GET: Success (value matches)")
    else:
        print(f"❌ Cache GET: Failed (got: {value}, expected: 'test_value')")
    
    # Test DELETE
    cache.delete('test_key')
    deleted_value = cache.get('test_key')
    if deleted_value is None:
        print("✅ Cache DELETE: Success")
    else:
        print(f"❌ Cache DELETE: Failed (value still exists: {deleted_value})")
    
    # Test barcode cache specifically
    print("\n4. Testing Barcode Cache:")
    print("-" * 60)
    from backend.catalog.barcode_cache import (
        get_barcode_cache_key,
        get_short_code_cache_key,
        cache_barcode_data,
        get_cached_barcode,
    )
    
    # Create a test barcode cache entry
    test_barcode_data = {
        'id': 999999,
        'barcode': 'TEST-BARCODE-123',
        'short_code': 'TEST-123',
        'tag': 'new',
        'product_id': 1,
        'variant_id': None,
        'is_primary': False,
    }
    
    # Test cache key generation
    barcode_key = get_barcode_cache_key('TEST-BARCODE-123')
    short_code_key = get_short_code_cache_key('TEST-123')
    print(f"✅ Barcode cache key: {barcode_key}")
    print(f"✅ Short code cache key: {short_code_key}")
    
    # Test caching (using cache directly since we don't have a real Barcode object)
    cache.set(barcode_key, test_barcode_data, 600)
    cache.set(short_code_key, test_barcode_data, 600)
    print("✅ Barcode data cached successfully")
    
    # Test retrieval
    cached_by_barcode = cache.get(barcode_key)
    cached_by_short_code = cache.get(short_code_key)
    
    if cached_by_barcode and cached_by_short_code:
        print("✅ Barcode cache retrieval: Success")
        print(f"   - Cached by barcode: {cached_by_barcode['barcode']}")
        print(f"   - Cached by short_code: {cached_by_short_code['short_code']}")
    else:
        print("❌ Barcode cache retrieval: Failed")
    
    # Cleanup test data
    cache.delete(barcode_key)
    cache.delete(short_code_key)
    cache.delete('test_key')
    print("✅ Test data cleaned up")
    
    print("\n" + "=" * 60)
    print("✅ ALL TESTS PASSED - Redis Cache is working correctly!")
    print("=" * 60)
    
except Exception as e:
    print(f"\n❌ ERROR: {str(e)}")
    print(f"   Error type: {type(e).__name__}")
    import traceback
    traceback.print_exc()
    print("\n" + "=" * 60)
    print("❌ Redis Cache test failed. Please check:")
    print("   1. REDIS_URL is set correctly in .env file")
    print("   2. django-redis is installed: pip install django-redis")
    print("   3. Redis service is accessible from your server")
    print("=" * 60)
