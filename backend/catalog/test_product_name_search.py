"""Products page name search must find SKUs even when quantity is 0."""

from django.test import TestCase
from rest_framework import status

from backend.core.test_utils import AuthenticatedAPIClient, TestDataFactory


class ProductNameSearchZeroQtyTests(TestCase):
    def setUp(self):
        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)

    def _product_ids(self, response):
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = response.data.get('results') or response.data.get('data') or []
        return [row['id'] for row in rows]

    def _list(self, **params):
        return self.client.get('/api/v1/products/', params)

    def test_name_search_finds_sold_out_product_on_fresh_tab(self):
        name = 'OLED FOLDER 1+NORD 5/RENO 14 PRO NON PESTING SOLD'
        product = TestDataFactory.create_product(name=name)
        TestDataFactory.create_barcode(product, tag='sold')

        response = self._list(
            search=name,
            search_mode='name_only',
            tag='new',
            lite='true',
            exclude_other_custom='true',
        )
        self.assertIn(product.id, self._product_ids(response))

    def test_name_search_finds_product_with_only_defective_barcodes(self):
        name = 'OLED FOLDER 1+NORD 5/RENO 14 PRO NON PESTING DEF'
        product = TestDataFactory.create_product(name=name)
        TestDataFactory.create_barcode(product, tag='defective')

        response = self._list(
            search=name,
            search_mode='name_only',
            tag='new',
            lite='true',
            exclude_other_custom='true',
        )
        self.assertIn(product.id, self._product_ids(response))

    def test_fresh_tab_without_search_hides_defective_only_product(self):
        name = 'OLED FOLDER 1+NORD 5/RENO 14 PRO NON PESTING HIDE'
        product = TestDataFactory.create_product(name=name)
        TestDataFactory.create_barcode(product, tag='defective')

        response = self._list(tag='new', lite='true', exclude_other_custom='true', limit=50)
        self.assertNotIn(product.id, self._product_ids(response))
