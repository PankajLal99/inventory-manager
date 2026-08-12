"""Unit tests for backend.catalog.barcode_resolution (used by POS and serializers)."""

from django.test import TestCase

from backend.catalog.barcode_resolution import (
    get_catalog_barcode_by_printed_value,
    single_barcode_for_untracked_product,
    clean_scanned_barcode,
)
from backend.catalog.models import Barcode
from backend.core.test_utils import TestDataFactory


class CleanScannedBarcodeTests(TestCase):
    def test_strips_scanner_space_around_slash(self):
        self.assertEqual(clean_scanned_barcode('ON/ -0185'), 'ON/-0185')
        self.assertEqual(clean_scanned_barcode('  on/-0185  '), 'ON/-0185')

    def test_blank_returns_empty(self):
        self.assertEqual(clean_scanned_barcode(''), '')
        self.assertEqual(clean_scanned_barcode('   '), '')
        self.assertEqual(clean_scanned_barcode(None), '')


class GetCatalogBarcodeByPrintedValueTests(TestCase):
    def test_none_and_blank_return_none(self):
        self.assertIsNone(get_catalog_barcode_by_printed_value(None))
        self.assertIsNone(get_catalog_barcode_by_printed_value(''))
        self.assertIsNone(get_catalog_barcode_by_printed_value('   '))

    def test_finds_by_barcode_case_insensitive(self):
        p = TestDataFactory.create_product(track_inventory=True)
        b = TestDataFactory.create_barcode(p, barcode='ABC-RESOLVE-01', tag='new')
        self.assertEqual(get_catalog_barcode_by_printed_value('abc-resolve-01').pk, b.pk)

    def test_finds_by_short_code_when_barcode_differs(self):
        p = TestDataFactory.create_product(track_inventory=True)
        b = Barcode.objects.create(
            product=p,
            barcode='LONG-UNIQUE-BARCODE-XYZ-001',
            short_code='SHORTY-777',
            tag='new',
        )
        self.assertEqual(get_catalog_barcode_by_printed_value('shorty-777').pk, b.pk)

    def test_unknown_value_returns_none(self):
        self.assertIsNone(get_catalog_barcode_by_printed_value('NO-SUCH-CODE-999'))

    def test_strips_scanner_space_before_lookup(self):
        p = TestDataFactory.create_product(track_inventory=True)
        b = TestDataFactory.create_barcode(p, barcode='ON/-0185', tag='new')
        self.assertEqual(get_catalog_barcode_by_printed_value('ON/ -0185').pk, b.pk)


class SingleBarcodeForUntrackedProductTests(TestCase):
    def test_none_product_returns_none(self):
        self.assertIsNone(single_barcode_for_untracked_product(None))

    def test_primary_barcode_preferred(self):
        p = TestDataFactory.create_product(track_inventory=False)
        TestDataFactory.create_barcode(p, barcode='BC-SEC-01', tag='new', purchase_item=None)
        primary = TestDataFactory.create_barcode(p, barcode='BC-PRI-01', tag='new', purchase_item=None)
        primary.is_primary = True
        primary.save(update_fields=['is_primary'])
        got = single_barcode_for_untracked_product(p)
        self.assertIsNotNone(got)
        self.assertEqual(got.pk, primary.pk)

    def test_single_non_primary_barcode_returned(self):
        p = TestDataFactory.create_product(track_inventory=False)
        only = TestDataFactory.create_barcode(p, barcode='BC-ONLY-01', tag='new', purchase_item=None)
        got = single_barcode_for_untracked_product(p)
        self.assertEqual(got.pk, only.pk)

    def test_multiple_without_primary_returns_none(self):
        p = TestDataFactory.create_product(track_inventory=False)
        TestDataFactory.create_barcode(p, barcode='BC-MULT-A', tag='new', purchase_item=None)
        TestDataFactory.create_barcode(p, barcode='BC-MULT-B', tag='new', purchase_item=None)
        self.assertIsNone(single_barcode_for_untracked_product(p))

    def test_two_primary_flags_returns_none(self):
        p = TestDataFactory.create_product(track_inventory=False)
        a = TestDataFactory.create_barcode(p, barcode='BC-2P-A', tag='new', purchase_item=None)
        b = TestDataFactory.create_barcode(p, barcode='BC-2P-B', tag='new', purchase_item=None)
        Barcode.objects.filter(pk__in=[a.pk, b.pk]).update(is_primary=True)
        self.assertIsNone(single_barcode_for_untracked_product(p))
