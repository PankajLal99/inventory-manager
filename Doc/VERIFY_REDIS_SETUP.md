# Verify Redis Cache Setup

## ✅ Quick Verification

Since you've installed `django-redis` and added `REDIS_URL` to your `.env` file, here's how to verify everything is working:

### Step 1: Check Server Startup Logs

When you restart your Django server, you should see:
```
✅ Using External Redis Cache (BEST PERFORMANCE)
```

If you see this message, Redis is configured correctly!

### Step 2: Test Cache (Recommended)

Run the test command:
```bash
python manage.py test_cache
```

This will:
- ✅ Verify Redis connection
- ✅ Test basic cache operations
- ✅ Test barcode cache functionality
- ✅ Show any errors if something is wrong

**Expected output:**
```
============================================================
Cache Configuration Test
============================================================

1. Cache Backend: django.core.cache.backends.redis.RedisCache
2. Cache Location: redis://default:password@host:port

3. Testing Cache Operations:
------------------------------------------------------------
✅ Cache SET: Success
✅ Cache GET: Success (value matches)
✅ Cache DELETE: Success

4. Testing Barcode Cache:
------------------------------------------------------------
✅ Barcode data cached
✅ Barcode cache retrieval: TEST-BARCODE-123

============================================================
✅ ALL TESTS PASSED - Cache is working!
============================================================
```

### Step 3: Manual Test (Alternative)

If you prefer to test manually in Django shell:

```bash
python manage.py shell
```

Then run:
```python
from django.core.cache import cache
from django.conf import settings

# Check configuration
print(f"Backend: {settings.CACHES['default']['BACKEND']}")
print(f"Location: {settings.CACHES['default'].get('LOCATION')}")

# Test cache
cache.set('test', 'value', 60)
print(f"Cache test: {cache.get('test')}")  # Should print 'value'

# Test barcode cache
from backend.catalog.barcode_cache import get_barcode_cache_key
key = get_barcode_cache_key('TEST-123')
cache.set(key, {'id': 1, 'barcode': 'TEST-123'}, 600)
print(f"Barcode cache: {cache.get(key)}")  # Should print the dict
```

---

## 🔧 Troubleshooting

### Issue: "Using Database Cache" instead of Redis

**Possible causes:**
1. `REDIS_URL` not in `.env` file
2. `REDIS_URL` is empty or incorrect format
3. `django-redis` not installed

**Solution:**
```bash
# Check .env file
cat .env | grep REDIS_URL

# Verify django-redis is installed
pip list | grep django-redis

# Install if missing
pip install django-redis
```

### Issue: Connection Error

**Possible causes:**
1. Redis URL format incorrect
2. Redis service not accessible from your server
3. Firewall blocking connection

**Check Redis URL format:**
```
# Correct formats:
redis://default:password@host:port
redis://:password@host:port
redis://host:port  (if no password)

# Examples:
redis://default:abc123@redis-12345.upstash.io:6379
redis://:mypassword@localhost:6379
```

**Test Redis connection:**
```python
# In Django shell
import redis
from django.conf import settings

redis_url = settings.CACHES['default']['LOCATION']
r = redis.from_url(redis_url)
r.ping()  # Should return True
```

### Issue: Import Error for django_redis

**Solution:**
```bash
pip install django-redis
# Make sure it's in requirements.txt
```

---

## 📊 Performance Monitoring

After Redis is working, you can monitor cache performance:

### Check Cache Stats (if using django-redis with stats)

```python
from django.core.cache import cache

# Get cache client
client = cache._cache.get_client()

# Check info (if available)
# This depends on your Redis service
```

### Monitor Cache Usage

The cache will automatically:
- ✅ Cache barcode lookups (10 min TTL)
- ✅ Cache API responses (5 min TTL)
- ✅ Cache barcode status (2 min TTL)
- ✅ Auto-invalidate on barcode updates

---

## ✅ Success Indicators

You'll know Redis is working when:

1. ✅ Server startup shows: "✅ Using External Redis Cache (BEST PERFORMANCE)"
2. ✅ `test_cache` command passes all tests
3. ✅ Barcode lookups are faster (check response times)
4. ✅ Cache hit rate improves (fewer database queries)

---

## 🎯 Next Steps

Once verified:
1. ✅ Your barcode cache is now using Redis
2. ✅ All barcode lookups will be cached automatically
3. ✅ Cache invalidates automatically on barcode updates
4. ✅ Performance should be significantly improved

**No further action needed!** The system will automatically use Redis for all cache operations.
