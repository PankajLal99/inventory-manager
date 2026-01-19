"""
API Performance Testing Script
Tests all GET/fetch endpoints from the inventory management system
Base URL: http://13.127.116.174/admin/

This script:
1. Tests all GET API endpoints
2. Measures response time for each endpoint
3. Checks response status and data
4. Generates a performance report
"""

import requests
import time
import json
from typing import Dict, List, Tuple, Optional
from datetime import datetime
import sys

# Configuration
BASE_URL = "http://127.0.0.1:8765/api/v1"
ADMIN_BASE_URL = "http://127.0.0.1:8765/admin"

# You need to set these credentials
USERNAME = ""  # Set your username
PASSWORD = ""  # Set your password

# Global session with auth token
session = requests.Session()
access_token = None


class APITester:
    """Class to handle API testing and performance measurement"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.results = []
        self.session = requests.Session()
        self.access_token = None
        
    def authenticate(self, username: str, password: str) -> bool:
        """Authenticate and get access token"""
        try:
            print(f"🔐 Authenticating as {username}...")
            response = self.session.post(
                f"{self.base_url}/auth/login/",
                json={"username": username, "password": password},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                self.access_token = data.get('access')
                self.session.headers.update({
                    'Authorization': f'Bearer {self.access_token}',
                    'Content-Type': 'application/json'
                })
                print("✅ Authentication successful!")
                return True
            else:
                print(f"❌ Authentication failed: {response.status_code}")
                print(f"Response: {response.text}")
                return False
        except Exception as e:
            print(f"❌ Authentication error: {str(e)}")
            return False
    
    def test_endpoint(
        self, 
        name: str, 
        endpoint: str, 
        params: Optional[Dict] = None,
        description: str = ""
    ) -> Dict:
        """Test a single API endpoint and measure response time"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            start_time = time.time()
            response = self.session.get(url, params=params, timeout=30)
            end_time = time.time()
            
            response_time = (end_time - start_time) * 1000  # Convert to milliseconds
            
            result = {
                'name': name,
                'endpoint': endpoint,
                'url': url,
                'description': description,
                'status_code': response.status_code,
                'response_time_ms': round(response_time, 2),
                'success': response.status_code == 200,
                'timestamp': datetime.now().isoformat(),
                'params': params or {}
            }
            
            # Try to parse response
            try:
                data = response.json()
                result['has_data'] = True
                result['data_type'] = type(data).__name__
                
                # Get count of items if it's a list or dict with results
                if isinstance(data, list):
                    result['item_count'] = len(data)
                elif isinstance(data, dict):
                    if 'results' in data:
                        result['item_count'] = len(data.get('results', []))
                        result['total_count'] = data.get('count', 0)
                    elif 'data' in data:
                        result['item_count'] = len(data.get('data', []))
                    else:
                        result['item_count'] = len(data)
            except:
                result['has_data'] = False
                result['response_text'] = response.text[:200]  # First 200 chars
            
            if not result['success']:
                result['error'] = response.text[:500]
            
            self.results.append(result)
            return result
            
        except requests.exceptions.Timeout:
            result = {
                'name': name,
                'endpoint': endpoint,
                'url': url,
                'description': description,
                'status_code': 0,
                'response_time_ms': 30000,
                'success': False,
                'error': 'Request timeout (30s)',
                'timestamp': datetime.now().isoformat()
            }
            self.results.append(result)
            return result
            
        except Exception as e:
            result = {
                'name': name,
                'endpoint': endpoint,
                'url': url,
                'description': description,
                'status_code': 0,
                'response_time_ms': 0,
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
            self.results.append(result)
            return result
    
    def print_result(self, result: Dict):
        """Print a single test result"""
        status_icon = "✅" if result['success'] else "❌"
        status_color = "\033[92m" if result['success'] else "\033[91m"
        reset_color = "\033[0m"
        
        print(f"{status_icon} {result['name']}")
        print(f"   Endpoint: {result['endpoint']}")
        if result.get('description'):
            print(f"   Description: {result['description']}")
        print(f"   Status: {status_color}{result['status_code']}{reset_color}")
        print(f"   Response Time: {result['response_time_ms']}ms")
        
        if result.get('item_count') is not None:
            print(f"   Items: {result['item_count']}")
        if result.get('total_count') is not None:
            print(f"   Total Count: {result['total_count']}")
        
        if not result['success'] and result.get('error'):
            print(f"   Error: {result['error'][:200]}")
        
        print()
    
    def generate_report(self):
        """Generate a summary report of all tests"""
        total_tests = len(self.results)
        successful_tests = sum(1 for r in self.results if r['success'])
        failed_tests = total_tests - successful_tests
        
        avg_response_time = sum(r['response_time_ms'] for r in self.results if r['success']) / successful_tests if successful_tests > 0 else 0
        
        fastest = min((r for r in self.results if r['success']), key=lambda x: x['response_time_ms'], default=None)
        slowest = max((r for r in self.results if r['success']), key=lambda x: x['response_time_ms'], default=None)
        
        print("\n" + "="*80)
        print("📊 API PERFORMANCE TEST REPORT")
        print("="*80)
        print(f"Base URL: {self.base_url}")
        print(f"Test Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"\nTotal Tests: {total_tests}")
        print(f"Successful: {successful_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        print(f"Success Rate: {(successful_tests/total_tests*100):.1f}%")
        print(f"\nAverage Response Time: {avg_response_time:.2f}ms")
        
        if fastest:
            print(f"Fastest: {fastest['name']} ({fastest['response_time_ms']}ms)")
        if slowest:
            print(f"Slowest: {slowest['name']} ({slowest['response_time_ms']}ms)")
        
        # Group by category
        print("\n" + "-"*80)
        print("📋 RESULTS BY CATEGORY")
        print("-"*80)
        
        categories = {}
        for result in self.results:
            category = result['name'].split(' - ')[0] if ' - ' in result['name'] else 'Other'
            if category not in categories:
                categories[category] = []
            categories[category].append(result)
        
        for category, results in sorted(categories.items()):
            success_count = sum(1 for r in results if r['success'])
            total_count = len(results)
            avg_time = sum(r['response_time_ms'] for r in results if r['success']) / success_count if success_count > 0 else 0
            
            print(f"\n{category}: {success_count}/{total_count} successful, avg {avg_time:.2f}ms")
            for result in sorted(results, key=lambda x: x['response_time_ms'], reverse=True):
                status_icon = "✅" if result['success'] else "❌"
                print(f"  {status_icon} {result['endpoint']}: {result['response_time_ms']}ms")
        
        # Failed tests
        if failed_tests > 0:
            print("\n" + "-"*80)
            print("❌ FAILED TESTS")
            print("-"*80)
            for result in self.results:
                if not result['success']:
                    print(f"\n{result['name']}")
                    print(f"  Endpoint: {result['endpoint']}")
                    print(f"  Error: {result.get('error', 'Unknown error')[:200]}")
        
        print("\n" + "="*80)
        
    def save_results(self, filename: str = "api_test_results.json"):
        """Save results to a JSON file"""
        with open(filename, 'w') as f:
            json.dump({
                'test_date': datetime.now().isoformat(),
                'base_url': self.base_url,
                'total_tests': len(self.results),
                'successful_tests': sum(1 for r in self.results if r['success']),
                'results': self.results
            }, f, indent=2)
        print(f"\n💾 Results saved to {filename}")


def main():
    """Main function to run all API tests"""
    
    print("="*80)
    print("🧪 API PERFORMANCE TESTING TOOL")
    print("="*80)
    print(f"Target: {BASE_URL}")
    print(f"Admin Panel: {ADMIN_BASE_URL}")
    print()
    
    # Get credentials if not set
    username = USERNAME
    password = PASSWORD
    
    if not username:
        username = input("Enter username: ")
    if not password:
        import getpass
        password = getpass.getpass("Enter password: ")
    
    # Initialize tester
    tester = APITester(BASE_URL)
    
    # Authenticate
    if not tester.authenticate(username, password):
        print("❌ Authentication failed. Cannot proceed with tests.")
        sys.exit(1)
    
    print("\n" + "="*80)
    print("🚀 Starting API Tests...")
    print("="*80 + "\n")
    
    # ========================================================================
    # PRODUCTS API TESTS
    # ========================================================================
    print("\n📦 Testing Products APIs...\n")
    
    # Test 1: List products with pagination and limit (as used in frontend)
    result = tester.test_endpoint(
        "Products - List with Pagination (page=1, limit=50)",
        "/products/",
        params={"page": 1, "limit": 50, "tag": "new"},
        description="Fetch products with pagination (frontend default)"
    )
    tester.print_result(result)
    
    # Store first product ID for detailed tests
    first_product_id = None
    if result['success'] and result.get('item_count', 0) > 0:
        # Try to extract first product ID from response
        try:
            import requests
            response = tester.session.get(f"{tester.base_url}/products/", params={"page": 1, "limit": 1, "tag": "new"})
            if response.status_code == 200:
                data = response.json()
                if 'results' in data and len(data['results']) > 0:
                    first_product_id = data['results'][0].get('id')
        except:
            pass
    
    # Test 2: Different page sizes
    result = tester.test_endpoint(
        "Products - List with limit=10",
        "/products/",
        params={"page": 1, "limit": 10, "tag": "new"},
        description="Fetch products with smaller page size"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Products - List with limit=100",
        "/products/",
        params={"page": 1, "limit": 100, "tag": "new"},
        description="Fetch products with larger page size"
    )
    tester.print_result(result)
    
    # Test 3: Filter by tag
    result = tester.test_endpoint(
        "Products - Fresh Products (tag=new)",
        "/products/",
        params={"page": 1, "limit": 50, "tag": "new"},
        description="Fetch fresh/new products only"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Products - Defective Products (tag=defective)",
        "/products/",
        params={"page": 1, "limit": 50, "tag": "defective"},
        description="Fetch defective products only"
    )
    tester.print_result(result)
    
    # Test 4: Stock status filters
    result = tester.test_endpoint(
        "Products - In Stock Only",
        "/products/",
        params={"page": 1, "limit": 50, "tag": "new", "in_stock": "true"},
        description="Fetch only in-stock products"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Products - Low Stock",
        "/products/",
        params={"page": 1, "limit": 50, "tag": "new", "low_stock": "true"},
        description="Fetch low stock products"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Products - Out of Stock",
        "/products/",
        params={"page": 1, "limit": 50, "tag": "new", "out_of_stock": "true"},
        description="Fetch out of stock products"
    )
    tester.print_result(result)
    
    # Test 5: Search with pagination
    result = tester.test_endpoint(
        "Products - Search by Name",
        "/products/",
        params={"search": "test", "search_mode": "name_only", "page": 1, "limit": 50},
        description="Search products by name with pagination"
    )
    tester.print_result(result)
    
    # Test 6: Combined filters (as used in frontend)
    result = tester.test_endpoint(
        "Products - Combined Filters",
        "/products/",
        params={
            "page": 1,
            "limit": 50,
            "tag": "new",
            "in_stock": "true",
        },
        description="Products with multiple filters"
    )
    tester.print_result(result)
    
    # Test 7: Get specific product details (if we have a valid ID)
    if first_product_id:
        result = tester.test_endpoint(
            "Products - Get by ID",
            f"/products/{first_product_id}/",
            description="Fetch single product details"
        )
        tester.print_result(result)
        
        result = tester.test_endpoint(
            "Products - Get Variants",
            f"/products/{first_product_id}/variants/",
            description="Fetch product variants"
        )
        tester.print_result(result)
        
        result = tester.test_endpoint(
            "Products - Get Barcodes",
            f"/products/{first_product_id}/barcodes/",
            description="Fetch product barcodes"
        )
        tester.print_result(result)
        
        result = tester.test_endpoint(
            "Products - Get Labels",
            f"/products/{first_product_id}/labels/",
            description="Fetch product labels"
        )
        tester.print_result(result)
        
        result = tester.test_endpoint(
            "Products - Labels Status",
            f"/products/{first_product_id}/labels-status/",
            description="Check label generation status"
        )
        tester.print_result(result)
    
    # ========================================================================
    # INVENTORY API TESTS
    # ========================================================================
    print("\n📊 Testing Inventory APIs...\n")
    
    result = tester.test_endpoint(
        "Inventory - Stock List",
        "/stock/",
        description="Fetch all stock levels"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Inventory - Low Stock",
        "/stock/low/",
        description="Fetch low stock items"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Inventory - Out of Stock",
        "/stock/out-of-stock/",
        description="Fetch out of stock items"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Inventory - Stock Adjustments",
        "/stock-adjustments/",
        description="Fetch stock adjustment history"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Inventory - Stock Transfers",
        "/stock-transfers/",
        description="Fetch stock transfer history"
    )
    tester.print_result(result)
    
    # ========================================================================
    # POS API TESTS
    # ========================================================================
    print("\n🛒 Testing POS APIs...\n")
    
    result = tester.test_endpoint(
        "POS - Active Carts",
        "/pos/carts/",
        params={"active": "true"},
        description="Fetch all active shopping carts"
    )
    tester.print_result(result)
    
    # Test invoices with pagination
    result = tester.test_endpoint(
        "POS - Invoices List (paginated)",
        "/pos/invoices/",
        params={"page": 1, "limit": 50},
        description="Fetch invoices with pagination"
    )
    tester.print_result(result)
    
    # Date-based invoice queries
    from datetime import datetime, timedelta
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    last_week = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    
    result = tester.test_endpoint(
        "POS - Invoices (Today)",
        "/pos/invoices/",
        params={"date_from": today, "page": 1, "limit": 50},
        description="Fetch today's invoices"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "POS - Invoices (Last 7 days)",
        "/pos/invoices/",
        params={"date_from": last_week, "page": 1, "limit": 50},
        description="Fetch invoices from last week"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "POS - Repair Invoices",
        "/pos/repair/invoices/",
        params={"page": 1, "limit": 50},
        description="Fetch repair invoices"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "POS - Credit Notes",
        "/credit-notes/",
        params={"page": 1, "limit": 50},
        description="Fetch credit notes"
    )
    tester.print_result(result)
    
    # ========================================================================
    # CUSTOMERS API TESTS
    # ========================================================================
    print("\n👥 Testing Customer APIs...\n")
    
    result = tester.test_endpoint(
        "Customers - List with Pagination",
        "/customers/",
        params={"page": 1, "limit": 50},
        description="Fetch customers with pagination"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Search",
        "/customers/",
        params={"search": "test", "page": 1, "limit": 50},
        description="Search customers by name/phone"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Groups",
        "/customer-groups/",
        description="Fetch customer groups"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Ledger Entries",
        "/ledger/entries/",
        description="Fetch ledger entries"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Ledger Summary",
        "/ledger/summary/",
        description="Fetch ledger summary"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Personal Customers",
        "/personal-customers/",
        description="Fetch personal customers"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Personal Ledger",
        "/personal-ledger/entries/",
        description="Fetch personal ledger entries"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Internal Customers",
        "/internal-customers/",
        description="Fetch internal customers"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Customers - Internal Ledger",
        "/internal-ledger/entries/",
        description="Fetch internal ledger entries"
    )
    tester.print_result(result)
    
    # ========================================================================
    # CATALOG API TESTS
    # ========================================================================
    print("\n📚 Testing Catalog APIs...\n")
    
    result = tester.test_endpoint(
        "Catalog - Categories",
        "/categories/",
        description="Fetch all product categories"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Catalog - Brands",
        "/brands/",
        description="Fetch all brands"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Catalog - Tax Rates",
        "/tax-rates/",
        description="Fetch tax rates"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Catalog - Stores",
        "/stores/",
        description="Fetch all stores"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Catalog - Warehouses",
        "/warehouses/",
        description="Fetch all warehouses"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Catalog - Defective Move Outs",
        "/defective-products/move-outs/",
        description="Fetch defective product move outs"
    )
    tester.print_result(result)
    
    # ========================================================================
    # PURCHASING API TESTS
    # ========================================================================
    print("\n🛍️ Testing Purchasing APIs...\n")
    
    # Test purchases with pagination
    result = tester.test_endpoint(
        "Purchasing - Purchases List (paginated)",
        "/purchases/",
        params={"page": 1, "limit": 50},
        description="Fetch purchases with pagination"
    )
    tester.print_result(result)
    
    # Store first purchase ID for detailed tests
    first_purchase_id = None
    if result['success'] and result.get('item_count', 0) > 0:
        try:
            import requests
            response = tester.session.get(f"{tester.base_url}/purchases/", params={"page": 1, "limit": 1})
            if response.status_code == 200:
                data = response.json()
                if 'results' in data and len(data['results']) > 0:
                    first_purchase_id = data['results'][0].get('id')
        except:
            pass
    
    # Test with date filters
    from datetime import datetime, timedelta
    today = datetime.now().strftime("%Y-%m-%d")
    last_month = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    
    result = tester.test_endpoint(
        "Purchasing - Recent Purchases (30 days)",
        "/purchases/",
        params={"page": 1, "limit": 50, "date_from": last_month},
        description="Fetch purchases from last 30 days"
    )
    tester.print_result(result)
    
    # Get specific purchase details if we have a valid ID
    if first_purchase_id:
        result = tester.test_endpoint(
            "Purchasing - Get Purchase by ID",
            f"/purchases/{first_purchase_id}/",
            description="Fetch single purchase details"
        )
        tester.print_result(result)
        
        result = tester.test_endpoint(
            "Purchasing - Purchase Items",
            f"/purchases/{first_purchase_id}/items/",
            description="Fetch purchase items"
        )
        tester.print_result(result)
    
    result = tester.test_endpoint(
        "Purchasing - Suppliers List",
        "/suppliers/",
        description="Fetch all suppliers"
    )
    tester.print_result(result)
    
    # ========================================================================
    # PRICING API TESTS
    # ========================================================================
    print("\n💰 Testing Pricing APIs...\n")
    
    result = tester.test_endpoint(
        "Pricing - Price Lists",
        "/price-lists/",
        description="Fetch all price lists"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Pricing - Promotions",
        "/promotions/",
        description="Fetch all promotions"
    )
    tester.print_result(result)
    
    # ========================================================================
    # REPORTS API TESTS
    # ========================================================================
    print("\n📈 Testing Reports APIs...\n")
    
    result = tester.test_endpoint(
        "Reports - Sales Summary",
        "/reports/sales-summary/",
        description="Fetch sales summary report"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Reports - Top Products",
        "/reports/top-products/",
        description="Fetch top selling products"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Reports - Inventory Summary",
        "/reports/inventory-summary/",
        description="Fetch inventory summary"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Reports - Revenue",
        "/reports/revenue/",
        description="Fetch revenue report"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Reports - Customers Report",
        "/reports/customers/",
        description="Fetch customer analytics"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Reports - Stock Ordering",
        "/reports/stock-ordering/",
        description="Fetch stock ordering recommendations"
    )
    tester.print_result(result)
    
    result = tester.test_endpoint(
        "Reports - Dashboard KPIs",
        "/reports/dashboard-kpis/",
        description="Fetch dashboard KPI metrics"
    )
    tester.print_result(result)
    
    # ========================================================================
    # HISTORY/AUDIT API TESTS
    # ========================================================================
    print("\n📜 Testing History/Audit APIs...\n")
    
    result = tester.test_endpoint(
        "History - Audit Logs",
        "/audit-logs/",
        description="Fetch audit logs"
    )
    tester.print_result(result)
    
    # ========================================================================
    # SEARCH API TESTS
    # ========================================================================
    print("\n🔍 Testing Search APIs...\n")
    
    result = tester.test_endpoint(
        "Search - Global Search",
        "/search/",
        params={"q": "product"},
        description="Global search across all entities"
    )
    tester.print_result(result)
    
    # ========================================================================
    # AUTH API TESTS (already authenticated, but test the me endpoint)
    # ========================================================================
    print("\n🔐 Testing Auth APIs...\n")
    
    result = tester.test_endpoint(
        "Auth - Current User",
        "/auth/me/",
        description="Fetch current user information"
    )
    tester.print_result(result)
    
    # ========================================================================
    # GENERATE REPORT
    # ========================================================================
    tester.generate_report()
    tester.save_results("api_test_results.json")
    
    print("\n✅ All tests completed!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
