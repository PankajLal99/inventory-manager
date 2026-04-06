from decimal import Decimal
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from backend.catalog.models import Product, Barcode, Category
from backend.core.access import merge_store_role_permissions, permissions_from_django_groups
from backend.core.models import AccessPermission, Role, UserStoreRole
from backend.locations.models import Store
from backend.pos.models import Invoice, InvoiceItem
from backend.tenants.models import Retailer

User = get_user_model()


class GlobalSearchBarcodeTests(APITestCase):
    """Tests for global search barcode and barcode_status: exact match and status/invoice in response."""

    def setUp(self):
        self.user = User.objects.create_user(username='searchuser', password='password')
        self.client.force_authenticate(user=self.user)
        self.store = Store.objects.create(name='Search Test Store', shop_type='retail')
        self.category = Category.objects.create(name='Search Category')
        self.product = Product.objects.create(
            name='Search Test Product',
            category=self.category,
            product_type='simple',
            is_active=True,
        )
        # Barcode 1: exact match candidate (new), with short_code
        self.barcode_new = Barcode.objects.create(
            product=self.product,
            barcode='EXACT-BARCODE-001',
            short_code='EXACT-SC-001',
            tag='new',
        )
        # Barcode 2: defective
        self.barcode_defective = Barcode.objects.create(
            product=self.product,
            barcode='EXACT-BARCODE-002',
            short_code='EXACT-SC-002',
            tag='defective',
        )
        # Barcode 3: sold (will link to invoice)
        self.barcode_sold = Barcode.objects.create(
            product=self.product,
            barcode='SOLD-BARCODE-003',
            short_code='SOLD-SC-003',
            tag='sold',
        )
        self.invoice = Invoice.objects.create(
            invoice_number='INV-SEARCH-001',
            store=self.store,
            status='completed',
            invoice_type='cash',
            subtotal=Decimal('100.00'),
            total=Decimal('100.00'),
            paid_amount=Decimal('100.00'),
            due_amount=Decimal('0.00'),
            created_by=self.user,
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            product=self.product,
            barcode=self.barcode_sold,
            quantity=Decimal('1.000'),
            unit_price=Decimal('100.00'),
            line_total=Decimal('100.00'),
        )
        # Another barcode that shares a prefix but must not match partial search
        Barcode.objects.create(
            product=self.product,
            barcode='EXACT-BARCODE-001-X',
            short_code='EXACT-SC-001-X',
            tag='new',
        )

    def test_barcode_search_exact_match_returns_barcode(self):
        """Search with exact barcode value returns that barcode only."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-001', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')
        self.assertEqual(barcodes[0]['tag'], 'new')
        self.assertIn('tag_display', barcodes[0])

    def test_barcode_search_partial_does_not_match(self):
        """Partial barcode (prefix) does not return results; backend uses exact match only."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BAR', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 0)

    def test_barcode_search_short_code_exact_match(self):
        """Search by exact short_code returns the matching barcode."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-SC-001', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['short_code'], 'EXACT-SC-001')
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')

    def test_barcode_status_search_by_tag_defective(self):
        """Barcode status search with q=defective returns only defective barcodes."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'defective', 'type': 'barcode_status'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'defective')
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-002')

    def test_barcode_status_search_by_tag_sold(self):
        """Barcode status search with q=sold returns only sold barcodes."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'sold', 'type': 'barcode_status'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'sold')
        self.assertEqual(barcodes[0]['barcode'], 'SOLD-BARCODE-003')

    def test_barcode_status_search_by_tag_new(self):
        """Barcode status search with q=new returns barcodes with tag new."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'new', 'type': 'barcode_status'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertGreaterEqual(len(barcodes), 1)
        barcode_values = [b['barcode'] for b in barcodes]
        self.assertIn('EXACT-BARCODE-001', barcode_values)

    def test_barcode_search_response_includes_status(self):
        """Each barcode in search response includes tag and tag_display (current status)."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-002', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'defective')
        self.assertTrue(barcodes[0].get('tag_display'))
        self.assertIn('Defective', barcodes[0]['tag_display'])

    def test_barcode_search_sold_includes_invoice_detail(self):
        """Sold barcode in response includes invoice_id, invoice_number, and related fields."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'SOLD-BARCODE-003', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        b = barcodes[0]
        self.assertEqual(b['tag'], 'sold')
        self.assertEqual(b['invoice_number'], 'INV-SEARCH-001')
        self.assertEqual(b['invoice_id'], self.invoice.id)
        self.assertIsNotNone(b.get('invoice_date'))
        self.assertIsNotNone(b.get('sold_price'))

    def test_barcode_search_trimmed_query(self):
        """Query with leading/trailing spaces is trimmed and still exact-matches."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': '  EXACT-BARCODE-001  ', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')

    def test_barcode_search_in_all_type_exact_only(self):
        """With type=all, barcode results still use exact match (no partial)."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-002', 'type': 'all'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-002')
        # Partial should not appear in barcodes
        response2 = self.client.get(url, {'q': 'EXACT-BAR', 'type': 'all'})
        self.assertEqual(len(response2.data.get('barcodes', [])), 0)

    def test_barcode_search_normalizes_case(self):
        """Global search uppercases barcode query so scanner input matches stored barcodes (case-insensitive)."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'exact-barcode-001', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1, 'Backend normalizes query to upper; lowercase search should find EXACT-BARCODE-001')
        self.assertEqual(barcodes[0]['barcode'], 'EXACT-BARCODE-001')


class AccessResolutionTests(TestCase):
    def setUp(self):
        self.retailer = Retailer.objects.create(code='AR1', name='Access Retailer', is_active=True)
        self.store = Store.objects.create(
            retailer=self.retailer, name='S1', code='S1', shop_type='retail', is_active=True
        )
        g, _ = Group.objects.get_or_create(name='Retail')
        self.user = User.objects.create_user(username='acc_r', password='x', retailer=self.retailer)
        self.user.groups.add(g)

    def test_permissions_from_groups_includes_pos_for_retail(self):
        perms = permissions_from_django_groups(['Retail'], self.user)
        self.assertIn('nav.pos', perms)
        self.assertNotIn('nav.dashboard', perms)
        self.assertIn('feature.retail_catalog_restricted', perms)
        self.assertIn('feature.invoice_restricted', perms)

    def test_super_group_gets_super_metrics(self):
        perms = permissions_from_django_groups(['Retail', 'Super'], self.user)
        self.assertIn('feature.super_metrics', perms)

    def test_wholesale_gets_hide_cash_checkout_permission(self):
        perms = permissions_from_django_groups(['Wholesale'], self.user)
        self.assertIn('feature.invoice_hide_cash_checkout', perms)
        self.assertIn('feature.pos_wholesale', perms)

    def test_retail_admin_gets_invoice_admin_stores_not_retail_restricted(self):
        perms = permissions_from_django_groups(['RetailAdmin'], self.user)
        self.assertIn('feature.invoice_admin_stores', perms)
        self.assertNotIn('feature.retail_catalog_restricted', perms)

    def test_user_me_includes_permissions_array(self):
        client = APIClient()
        t = RefreshToken.for_user(self.user)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {t.access_token}')
        r = client.get('/api/v1/auth/me/')
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.data.get('permissions'), list)
        self.assertIn('nav.pos', r.data['permissions'])

    def test_store_role_adds_extra_nav_permission(self):
        ap = AccessPermission.objects.get(codename='nav.history')
        role = Role.objects.create(retailer=self.retailer, name='Night auditor')
        role.permissions.add(ap)
        UserStoreRole.objects.create(user=self.user, store=self.store, role=role)

        base = permissions_from_django_groups(['Retail'], self.user)
        merged = merge_store_role_permissions(self.user, base)
        self.assertIn('nav.pos', merged)
        self.assertIn('nav.history', merged)


class UserStoreAssignmentTests(TestCase):
    def setUp(self):
        self.r1 = Retailer.objects.create(code='UA1', name='Retailer A', is_active=True)
        self.r2 = Retailer.objects.create(code='UA2', name='Retailer B', is_active=True)
        self.s1 = Store.objects.create(retailer=self.r1, name='Shop A1', code='A1', shop_type='retail', is_active=True)
        self.s2 = Store.objects.create(retailer=self.r1, name='Shop A2', code='A2', shop_type='retail', is_active=True)
        self.s_other = Store.objects.create(retailer=self.r2, name='Other', code='O1', shop_type='retail', is_active=True)

    def test_default_store_must_match_retailer(self):
        u = User(username='u1', retailer=self.r1)
        u.default_store = self.s_other
        with self.assertRaises(ValidationError):
            u.full_clean()

    def test_assigned_stores_m2m_rejects_other_retailer(self):
        u = User.objects.create_user(username='u2', password='x', retailer=self.r1)
        with self.assertRaises(ValidationError):
            u.assigned_stores.add(self.s_other)

    def test_user_me_includes_default_and_assigned(self):
        u = User.objects.create_user(username='u3', password='x', retailer=self.r1, default_store=self.s1)
        u.assigned_stores.add(self.s1, self.s2)
        client = APIClient()
        t = RefreshToken.for_user(u)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {t.access_token}')
        r = client.get('/api/v1/auth/me/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['retailer']['code'], 'UA1')
        self.assertEqual(r.data['default_store']['id'], self.s1.id)
        self.assertEqual(len(r.data['assigned_stores']), 2)
        self.assertEqual(r.data['store']['id'], self.s1.id)

    def test_store_list_filters_by_assigned_stores(self):
        u = User.objects.create_user(username='u4', password='x', retailer=self.r1)
        g, _ = Group.objects.get_or_create(name='Admin')
        u.groups.add(g)
        u.assigned_stores.add(self.s1)
        client = APIClient()
        t = RefreshToken.for_user(u)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {t.access_token}')
        r = client.get('/api/v1/stores/')
        self.assertEqual(r.status_code, 200)
        ids = {row['id'] for row in r.data}
        self.assertEqual(ids, {self.s1.id})
