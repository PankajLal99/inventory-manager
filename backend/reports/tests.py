"""
Comprehensive test suite for Reports module
Tests: Sales Summary, Top Products, Inventory Summary, Revenue, Customers, Stock Ordering
"""
from django.test import TestCase
from rest_framework import status
from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient


class ReportsTests(TestCase):
    """Test report endpoints"""
    
    def setUp(self):
        self.user = TestDataFactory.create_user()
        self.client = AuthenticatedAPIClient()
        self.client.authenticate_user(self.user)
    
    def test_sales_summary(self):
        """Test sales summary report"""
        response = self.client.get('/api/v1/reports/sales-summary/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, dict)
    
    def test_sales_summary_with_date_range(self):
        """Test sales summary with date range"""
        response = self.client.get('/api/v1/reports/sales-summary/?date_from=2024-01-01&date_to=2024-12-31')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_top_products(self):
        """Test top products report"""
        response = self.client.get('/api/v1/reports/top-products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, (list, dict))
    
    def test_inventory_summary(self):
        """Test inventory summary report"""
        response = self.client.get('/api/v1/reports/inventory-summary/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, dict)
    
    def test_revenue_report(self):
        """Test revenue report"""
        response = self.client.get('/api/v1/reports/revenue/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, dict)
    
    def test_customer_summary(self):
        """Test customer summary report"""
        response = self.client.get('/api/v1/reports/customers/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, (list, dict))
    
    def test_stock_ordering_report(self):
        """Test stock ordering report"""
        response = self.client.get('/api/v1/reports/stock-ordering/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsInstance(response.data, (list, dict))
