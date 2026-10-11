from decimal import Decimal
from django.utils import timezone
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model

from backend.catalog.models import Product, Barcode, Category, DefectiveProductMoveOut, DefectiveProductItem
from backend.locations.models import Store
from backend.pos.models import Invoice, InvoiceItem
from backend.parties.models import Supplier
from backend.purchasing.models import Purchase, PurchaseItem
from backend.core.models import Setting

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

    def test_defective_barcode_without_move_out_has_no_move_out_info(self):
        """Defective barcodes that are not on a move-out stay tagged Defective."""
        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-002', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'defective')
        self.assertIn('Defective', barcodes[0]['tag_display'])
        self.assertFalse(barcodes[0].get('defective_move_out_info'))

    def test_defective_barcode_in_move_out_includes_written_to_supplier_info(self):
        """Defective barcodes on a move-out item include move-out info for search display."""
        move_out = DefectiveProductMoveOut.objects.create(
            move_out_number='DEF-SEARCH-001',
            store=self.store,
            reason='defective',
            total_items=1,
        )
        DefectiveProductItem.objects.create(
            move_out=move_out,
            product=self.product,
            barcode=self.barcode_defective,
            purchase_price=Decimal('0.00'),
        )

        url = reverse('global-search')
        response = self.client.get(url, {'q': 'EXACT-BARCODE-002', 'type': 'barcode'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        barcodes = response.data.get('barcodes', [])
        self.assertEqual(len(barcodes), 1)
        self.assertEqual(barcodes[0]['tag'], 'defective')
        info = barcodes[0].get('defective_move_out_info') or {}
        self.assertTrue(info.get('moved_out'))
        self.assertEqual(info.get('move_out_id'), move_out.id)
        self.assertEqual(info.get('move_out_number'), 'DEF-SEARCH-001')
        self.assertEqual(info.get('reason'), 'Defective')


class GlobalSearchProductPriceFallbackTests(APITestCase):
    """Regression tests for product price fields in global search payload."""

    def setUp(self):
        self.user = User.objects.create_user(username='searchpriceuser', password='password')
        self.client.force_authenticate(user=self.user)
        self.category = Category.objects.create(name='Folder')
        self.supplier = Supplier.objects.create(name='BLUEHORSE', code='BLUEHORSE')

    def test_product_search_fills_price_from_supplier_breakdown_when_barcode_price_unavailable(self):
        """
        Product search should return top-level purchase/selling prices using supplier rows
        when direct barcode-derived values are unavailable.
        """
        product = Product.objects.create(
            name='FOLDER IPHONE XR TFT GX NON PESTING',
            category=self.category,
            track_inventory=True,
            is_active=True,
        )
        purchase = Purchase.objects.create(
            supplier=self.supplier,
            purchase_number='PUR-SEARCH-PRICE-001',
            purchase_date=timezone.now().date(),
            status='finalized',
            created_by=self.user,
        )
        PurchaseItem.objects.create(
            purchase=purchase,
            product=product,
            quantity=Decimal('10'),
            shop_quantity=Decimal('10'),
            warehouse_quantity=Decimal('0'),
            unit_price=Decimal('665'),
            selling_price=Decimal('0'),
        )

        url = reverse('global-search')
        response = self.client.get(url, {'q': 'FOLDER IPHONE XR TFT GX', 'type': 'product'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        products = response.data.get('products', [])
        target = next((p for p in products if p.get('id') == product.id), None)
        self.assertIsNotNone(target)

        # Fallback behavior from supplier_breakdown should populate top-level fields.
        self.assertEqual(target.get('purchase_price'), 665.0)
        self.assertEqual(target.get('selling_price'), 665.0)


class LedgerExportSettingsTests(APITestCase):
    """Shop-wide copy settings are stored as JSON on core.Setting, not per user."""

    def setUp(self):
        self.user_a = User.objects.create_user(username='ledger-a', password='password')
        self.user_b = User.objects.create_user(username='ledger-b', password='password')
        self.url = reverse('ledger-export-settings')

    def test_get_empty_when_unset(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {})

    def test_put_is_shared_across_users(self):
        self.client.force_authenticate(user=self.user_a)
        put_response = self.client.put(
            self.url,
            {
                'useRows': False,
                'useDays': True,
                'rowsPerPage': 10,
                'daysPerPage': 7,
            },
            format='json',
        )
        self.assertEqual(put_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            put_response.data,
            {
                'useRows': False,
                'useDays': True,
                'rowsPerPage': 10,
                'daysPerPage': 7,
            },
        )

        self.client.force_authenticate(user=self.user_b)
        get_response = self.client.get(self.url)
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(get_response.data['daysPerPage'], 7)
        self.assertEqual(get_response.data['useDays'], True)
        self.assertEqual(Setting.objects.filter(key='credit_ledger_export_split').count(), 1)

    def test_put_clamps_and_requires_a_mode(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.put(
            self.url,
            {'useRows': False, 'useDays': False, 'rowsPerPage': 999, 'daysPerPage': 0},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['useRows'])
        self.assertEqual(response.data['rowsPerPage'], 200)
        self.assertEqual(response.data['daysPerPage'], 1)


class InvoiceExportSettingsTests(APITestCase):
    """Shop-wide invoice photo split is stored as JSON on core.Setting, not per user."""

    def setUp(self):
        self.user_a = User.objects.create_user(username='invoice-a', password='password')
        self.user_b = User.objects.create_user(username='invoice-b', password='password')
        self.url = reverse('invoice-export-settings')

    def test_get_empty_when_unset(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {})

    def test_put_is_shared_across_users(self):
        self.client.force_authenticate(user=self.user_a)
        put_response = self.client.put(
            self.url,
            {'rowsPerPage': 20},
            format='json',
        )
        self.assertEqual(put_response.status_code, status.HTTP_200_OK)
        self.assertEqual(put_response.data, {'rowsPerPage': 20})

        self.client.force_authenticate(user=self.user_b)
        get_response = self.client.get(self.url)
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(get_response.data['rowsPerPage'], 20)
        self.assertEqual(Setting.objects.filter(key='invoice_photo_export_split').count(), 1)

    def test_put_clamps_rows_per_page(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.put(
            self.url,
            {'rowsPerPage': 999},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['rowsPerPage'], 200)


class ProductNameColorRulesSettingsTests(APITestCase):
    """Shop-wide custom keyword rules stored as JSON array on core.Setting."""

    def setUp(self):
        self.user_a = User.objects.create_user(username='pname-a', password='password')
        self.user_b = User.objects.create_user(username='pname-b', password='password')
        self.url = reverse('product-name-color-rules')

    def test_get_empty_when_unset(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_put_is_shared_across_users(self):
        self.client.force_authenticate(user=self.user_a)
        payload = [
            {'id': 'imported', 'keyword': 'IMPORTED', 'color': '#2563eb'},
        ]
        put_response = self.client.put(self.url, payload, format='json')
        self.assertEqual(put_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(put_response.data), 1)
        self.assertEqual(put_response.data[0]['keyword'], 'IMPORTED')
        self.assertEqual(put_response.data[0]['scope'], 'keyword')

        self.client.force_authenticate(user=self.user_b)
        get_response = self.client.get(self.url)
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(get_response.data[0]['color'], '#2563eb')
        self.assertEqual(Setting.objects.filter(key='product_name_color_rules').count(), 1)

    def test_put_filters_super_keywords_and_invalid_colors(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.put(
            self.url,
            [
                {'id': 'bad-super', 'keyword': 'PESTING', 'color': '#418f28'},
                {'id': 'bad-color', 'keyword': 'SPECIAL', 'color': 'not-a-color'},
                {'id': 'ok', 'keyword': 'SPECIAL', 'color': '#111111'},
            ],
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['keyword'], 'SPECIAL')

    def test_put_preserves_whole_line_scope(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.put(
            self.url,
            [{'id': 'vip', 'keyword': 'VIP', 'color': '#2563eb', 'scope': 'whole_line'}],
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]['scope'], 'whole_line')

    def test_put_requires_array(self):
        self.client.force_authenticate(user=self.user_a)
        response = self.client.put(self.url, {'keyword': 'X'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class EmergencyMaskTests(APITestCase):
    """Emergency display mask: activate, scale money fields, hide setting, skip carts."""

    def setUp(self):
        from django.contrib.auth.models import Group
        from django.core.cache import cache
        from backend.core.emergency_mask import SETTING_KEY, deactivate_emergency_mask

        cache.clear()
        deactivate_emergency_mask()

        self.admin_group, _ = Group.objects.get_or_create(name='Admin')
        self.admin = User.objects.create_user(username='maskadmin', password='password')
        self.admin.groups.add(self.admin_group)

        self.retail = User.objects.create_user(username='maskretail', password='password')
        retail_group, _ = Group.objects.get_or_create(name='Retail')
        self.retail.groups.add(retail_group)

        self.setting_key = SETTING_KEY

    def tearDown(self):
        from django.core.cache import cache
        from backend.core.emergency_mask import deactivate_emergency_mask
        deactivate_emergency_mask()
        cache.clear()

    def test_mask_scales_money_not_ids_or_qty(self):
        from backend.core.emergency_mask import apply_emergency_mask, activate_emergency_mask

        activate_emergency_mask(percent=10)
        data = {
            'id': 42,
            'count': 100,
            'quantity': 5,
            'total': '1000.00',
            'paid_amount': 200.0,
            'due_amount': Decimal('50.00'),
            'customer': {'id': 7, 'credit_balance': '500.00', 'name': 'Ada'},
            'kpis': {'total_sales': 10000, 'stock_value': 2500.5},
            'results': [{'unit_price': '100.00', 'quantity': 2}],
        }
        masked = apply_emergency_mask(data)
        self.assertEqual(masked['id'], 42)
        self.assertEqual(masked['count'], 100)
        self.assertEqual(masked['quantity'], 5)
        self.assertEqual(masked['total'], '100.00')
        self.assertEqual(masked['paid_amount'], 20.0)
        self.assertEqual(masked['due_amount'], Decimal('5.00'))
        self.assertEqual(masked['customer']['id'], 7)
        self.assertEqual(masked['customer']['credit_balance'], '50.00')
        self.assertEqual(masked['customer']['name'], 'Ada')
        self.assertEqual(masked['kpis']['total_sales'], 1000)
        self.assertEqual(masked['results'][0]['quantity'], 2)
        self.assertEqual(masked['results'][0]['unit_price'], '10.00')

    def test_skip_pos_and_credit_cart_paths(self):
        from backend.core.emergency_mask import should_skip_path

        self.assertTrue(should_skip_path('/api/v1/pos/carts/'))
        self.assertTrue(should_skip_path('/api/v1/pos/carts/12/items/'))
        self.assertTrue(should_skip_path('/api/v1/credit/carts/3/'))
        # Overview is display-only — still masked
        self.assertFalse(should_skip_path('/api/v1/pos/carts/overview/'))
        self.assertFalse(should_skip_path('/api/v1/pos/invoices/'))
        self.assertFalse(should_skip_path('/api/v1/reports/dashboard-kpis/'))

    def test_mask_covers_dashboard_cash_upi_currency_and_hourly_rate(self):
        from backend.core.emergency_mask import apply_emergency_mask, activate_emergency_mask

        activate_emergency_mask(percent=10)
        data = {
            'kpis': {
                'total_cash': 1000.0,
                'cash_from_invoice_type_cash': 400.0,
                'cash_from_mixed': 100.0,
                'upi_from_invoice_type_upi': 300.0,
                'upi_from_mixed': 200.0,
                'cash_breakdown': {
                    'retail_counter': 250.0,
                    'repair': 50.0,
                    'mix_cash': 40.0,
                    'manual_cash': 10.0,
                    'replacement_returns': 5.0,
                },
                'defective_purchase_value': 80.0,
                'defective_product_count': 12,
            },
            'supplier_breakdown': [
                {'price': '₹665', 'selling_price': '₹800', 'purchase_price_value': 665.0},
            ],
            'hourly_rate': '200.00',
            'hourly_rate_preview': 200.0,
            'tax_rate': 18.0,
            'credit_limit': 5000,
            'avg_order_value': 999.0,
        }
        masked = apply_emergency_mask(data)
        kpis = masked['kpis']
        self.assertEqual(kpis['total_cash'], 100.0)
        self.assertEqual(kpis['cash_from_invoice_type_cash'], 40.0)
        self.assertEqual(kpis['cash_from_mixed'], 10.0)
        self.assertEqual(kpis['upi_from_invoice_type_upi'], 30.0)
        self.assertEqual(kpis['upi_from_mixed'], 20.0)
        self.assertEqual(kpis['cash_breakdown']['retail_counter'], 25.0)
        self.assertEqual(kpis['cash_breakdown']['repair'], 5.0)
        self.assertEqual(kpis['defective_purchase_value'], 8.0)
        self.assertEqual(kpis['defective_product_count'], 12)  # count not scaled
        self.assertEqual(masked['supplier_breakdown'][0]['price'], '₹67')
        self.assertEqual(masked['supplier_breakdown'][0]['selling_price'], '₹80')
        self.assertEqual(masked['supplier_breakdown'][0]['purchase_price_value'], 66.5)
        self.assertEqual(masked['hourly_rate'], '20.00')
        self.assertEqual(masked['hourly_rate_preview'], 20.0)
        self.assertEqual(masked['tax_rate'], 18.0)  # non-money rate untouched
        self.assertEqual(masked['credit_limit'], 500)
        self.assertEqual(masked['avg_order_value'], 99.9)

    def test_activate_admin_only_and_no_http_disable(self):
        self.client.force_authenticate(user=self.retail)
        denied = self.client.post('/api/v1/emergency-mask/activate/', {}, format='json')
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.admin)
        ok = self.client.post(
            '/api/v1/emergency-mask/activate/',
            {'percent': 4},
            format='json',
        )
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        self.assertTrue(ok.data['enabled'])
        self.assertEqual(ok.data['percent'], 4.0)

        setting = Setting.objects.get(key=self.setting_key)
        import json as _json
        stored = _json.loads(setting.value)
        self.assertTrue(stored['enabled'])
        self.assertEqual(stored['percent'], 4.0)

        # Setting hidden from list API
        staff = User.objects.create_user(
            username='maskstaff', password='password', is_staff=True
        )
        self.client.force_authenticate(user=staff)
        listed = self.client.get('/api/v1/settings/')
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        keys = [row['key'] for row in listed.data]
        self.assertNotIn(self.setting_key, keys)

        me = self.client.get('/api/v1/auth/me/')
        # staff without Admin group may not get percent; re-auth as admin
        self.client.force_authenticate(user=self.admin)
        me = self.client.get('/api/v1/auth/me/')
        self.assertTrue(me.data.get('emergency_mask_active'))
        self.assertEqual(me.data.get('emergency_mask_percent'), 4.0)

    def test_export_api_blocked_when_mask_active(self):
        from backend.core.emergency_mask import activate_emergency_mask

        self.client.force_authenticate(user=self.admin)
        before = self.client.get('/api/v1/credit/ledger/export/')
        # May be 200 with empty rows or other status when mask off — just not 403 for mask
        self.assertNotEqual(before.status_code, status.HTTP_403_FORBIDDEN)

        activate_emergency_mask(percent=3)
        blocked = self.client.get('/api/v1/credit/ledger/export/')
        self.assertEqual(blocked.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('emergency data mask', str(blocked.json().get('detail', '')).lower())

    def test_mask_off_is_noop_on_payload(self):
        """When disabled, apply_emergency_mask must return the exact same object identity/values."""
        from backend.core.emergency_mask import apply_emergency_mask, deactivate_emergency_mask
        from copy import deepcopy

        deactivate_emergency_mask()
        original = {
            'id': 1,
            'total': '9999.99',
            'paid_amount': 1234.56,
            'quantity': 7,
            'nested': {'credit_balance': '50.00', 'name': 'Bob'},
            'results': [{'unit_price': '10.00', 'id': 9}],
        }
        before = deepcopy(original)
        out = apply_emergency_mask(original)
        self.assertIs(out, original)
        self.assertEqual(out, before)

    def test_renderer_mask_off_matches_stock_json_renderer(self):
        """Default renderer must not alter bytes vs stock JSONRenderer when mask is off."""
        from rest_framework.renderers import JSONRenderer
        from rest_framework.request import Request
        from django.test import RequestFactory
        from backend.core.renderers import EmergencyMaskJSONRenderer
        from backend.core.emergency_mask import deactivate_emergency_mask

        deactivate_emergency_mask()
        payload = {
            'total': '1000.00',
            'paid_amount': 250,
            'quantity': 3,
            'id': 5,
            'results': [{'due_amount': '40.00', 'count': 2}],
        }
        factory = RequestFactory()
        django_request = factory.get('/api/v1/pos/invoices/')
        drf_request = Request(django_request)
        context = {'request': drf_request}

        masked_bytes = EmergencyMaskJSONRenderer().render(payload, renderer_context=context)
        stock_bytes = JSONRenderer().render(payload, renderer_context=context)
        self.assertEqual(masked_bytes, stock_bytes)

    def test_renderer_skips_cart_paths_even_when_mask_on(self):
        """POS/credit cart responses must stay real so recording is unaffected."""
        import json as _json
        from rest_framework.request import Request
        from django.test import RequestFactory
        from backend.core.renderers import EmergencyMaskJSONRenderer
        from backend.core.emergency_mask import activate_emergency_mask

        activate_emergency_mask(percent=10)
        payload = {'unit_price': '100.00', 'total': '100.00', 'id': 1}
        factory = RequestFactory()

        for path in ('/api/v1/pos/carts/1/', '/api/v1/credit/carts/2/items/'):
            django_request = factory.get(path)
            drf_request = Request(django_request)
            rendered = EmergencyMaskJSONRenderer().render(
                payload, renderer_context={'request': drf_request}
            )
            data = _json.loads(rendered.decode('utf-8'))
            self.assertEqual(data['unit_price'], '100.00', path)
            self.assertEqual(data['total'], '100.00', path)

        # Non-cart path is scaled
        django_request = factory.get('/api/v1/pos/invoices/1/')
        rendered = EmergencyMaskJSONRenderer().render(
            payload, renderer_context={'request': Request(django_request)}
        )
        data = _json.loads(rendered.decode('utf-8'))
        self.assertEqual(data['unit_price'], '10.00')
        self.assertEqual(data['total'], '10.00')

    def test_export_settings_not_blocked_when_mask_on(self):
        """ledger/invoice export-settings URLs must keep working (not mistaken for /export/)."""
        from backend.core.emergency_mask import activate_emergency_mask

        activate_emergency_mask(percent=3)
        self.client.force_authenticate(user=self.admin)

        ledger_settings = self.client.get('/api/v1/ledger-export-settings/')
        self.assertNotEqual(ledger_settings.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ledger_settings.status_code, status.HTTP_200_OK)

        invoice_settings = self.client.get('/api/v1/invoice-export-settings/')
        self.assertNotEqual(invoice_settings.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(invoice_settings.status_code, status.HTTP_200_OK)

    def test_auth_me_and_search_unaffected_when_mask_off(self):
        self.client.force_authenticate(user=self.admin)
        me = self.client.get('/api/v1/auth/me/')
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertFalse(me.data.get('emergency_mask_active'))
        self.assertEqual(me.data.get('username'), 'maskadmin')
        self.assertIn('groups', me.data)

        search = self.client.get('/api/v1/search/', {'q': 'zzz-no-match'})
        self.assertEqual(search.status_code, status.HTTP_200_OK)

    def test_deactivate_restores_unmasked_renderer_output(self):
        import json as _json
        from rest_framework.request import Request
        from django.test import RequestFactory
        from backend.core.renderers import EmergencyMaskJSONRenderer
        from backend.core.emergency_mask import activate_emergency_mask, deactivate_emergency_mask

        payload = {'total': '1000.00', 'id': 1}
        factory = RequestFactory()
        context = {'request': Request(factory.get('/api/v1/reports/dashboard-kpis/'))}

        activate_emergency_mask(percent=10)
        on_data = _json.loads(
            EmergencyMaskJSONRenderer().render(payload, renderer_context=context).decode()
        )
        self.assertEqual(on_data['total'], '100.00')

        deactivate_emergency_mask()
        off_data = _json.loads(
            EmergencyMaskJSONRenderer().render(payload, renderer_context=context).decode()
        )
        self.assertEqual(off_data['total'], '1000.00')
        self.assertEqual(off_data['id'], 1)
