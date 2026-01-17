#!/usr/bin/env python
"""
Quick validation script to check test setup
"""
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.config.settings')
django.setup()

def validate_imports():
    """Validate that all test imports work"""
    print("Validating test imports...")
    
    try:
        from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient
        print("✅ Test utilities imported successfully")
    except Exception as e:
        print(f"❌ Failed to import test utilities: {e}")
        return False
    
    try:
        from backend.core.tests import AuthenticationTests
        print("✅ Core tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import core tests: {e}")
        return False
    
    try:
        from backend.catalog.tests import CategoryTests
        print("✅ Catalog tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import catalog tests: {e}")
        return False
    
    try:
        from backend.pos.tests import CartTests
        print("✅ POS tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import POS tests: {e}")
        return False
    
    try:
        from backend.purchasing.tests import PurchaseTests
        print("✅ Purchasing tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import purchasing tests: {e}")
        return False
    
    try:
        from backend.inventory.tests import StockTests
        print("✅ Inventory tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import inventory tests: {e}")
        return False
    
    try:
        from backend.parties.tests import CustomerTests
        print("✅ Parties tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import parties tests: {e}")
        return False
    
    try:
        from backend.locations.tests import StoreTests
        print("✅ Locations tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import locations tests: {e}")
        return False
    
    try:
        from backend.pricing.tests import PriceListTests
        print("✅ Pricing tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import pricing tests: {e}")
        return False
    
    try:
        from backend.reports.tests import ReportsTests
        print("✅ Reports tests imported successfully")
    except Exception as e:
        print(f"❌ Failed to import reports tests: {e}")
        return False
    
    print("\n✅ All test imports validated successfully!")
    return True

if __name__ == '__main__':
    success = validate_imports()
    sys.exit(0 if success else 1)

