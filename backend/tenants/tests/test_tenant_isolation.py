"""Cross-tenant isolation: users only see their retailer's data on scoped endpoints."""

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from backend.catalog.models import Product
from backend.tenants.models import Retailer
from backend.core.test_utils import TestDataFactory

User = get_user_model()


class TenantIsolationProductAPITests(TestCase):
    def setUp(self):
        self.mt = Retailer.objects.create(code='MT2', name='Manish Test', is_active=True)
        self.str = Retailer.objects.create(code='STR2', name='Second Test', is_active=True)
        self.cat_mt = TestDataFactory.create_category()
        self.cat_mt.retailer = self.mt
        self.cat_mt.save()
        self.b_mt = TestDataFactory.create_brand()
        self.b_mt.retailer = self.mt
        self.b_mt.save()
        self.p_mt = Product.objects.create(
            retailer=self.mt,
            name='MT Only Product',
            sku='SKU-MT-ISO-1',
            category=self.cat_mt,
            brand=self.b_mt,
        )
        self.cat_str = TestDataFactory.create_category()
        self.cat_str.retailer = self.str
        self.cat_str.save()
        self.b_str = TestDataFactory.create_brand()
        self.b_str.retailer = self.str
        self.b_str.save()
        self.p_str = Product.objects.create(
            retailer=self.str,
            name='STR Only Product',
            sku='SKU-STR-ISO-1',
            category=self.cat_str,
            brand=self.b_str,
        )
        self.u_mt = User.objects.create_user(username='iso_mt', password='x', retailer=self.mt)
        self.u_str = User.objects.create_user(username='iso_str', password='x', retailer=self.str)

    def _auth(self, user):
        c = APIClient()
        t = RefreshToken.for_user(user)
        c.credentials(HTTP_AUTHORIZATION=f'Bearer {t.access_token}')
        return c

    def test_product_list_scoped_to_retailer(self):
        c = self._auth(self.u_mt)
        r = c.get('/api/v1/products/')
        self.assertEqual(r.status_code, 200)
        ids = {row['id'] for row in r.data.get('results', [])}
        self.assertIn(self.p_mt.id, ids)
        self.assertNotIn(self.p_str.id, ids)

    def test_product_detail_other_tenant_404(self):
        c = self._auth(self.u_str)
        r = c.get(f'/api/v1/products/{self.p_mt.id}/')
        self.assertEqual(r.status_code, 404)
