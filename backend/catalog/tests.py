from decimal import Decimal
from django.test import TransactionTestCase
from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient
from rest_framework import status
from backend.catalog.models import Product, Barcode
from backend.catalog.serializers import _get_supplier_breakdown_for_product, ProductSerializer


class ProductListStockFromPurchaseTests(TransactionTestCase):
    """Tests for ProductListSerializer: shop/warehouse from purchase, available = (new+returned) - warehouse."""

    def setUp(self):
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)
        self.product = TestDataFactory.create_product(name="Stock Test Product", track_inventory=True)

    def test_shop_warehouse_from_finalized_purchase_only(self):
        """Shop and warehouse qty are sums from PurchaseItem (finalized purchases only)."""
        purchase = TestDataFactory.create_purchase(user=self.user, status='finalized')
        TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('10'), shop_quantity=Decimal('7'), warehouse_quantity=Decimal('3')
        )
        # Barcodes don't change shop/warehouse numbers
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new')
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new')
        response = self.client.get('/api/v1/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product_data = next((p for p in response.data.get('results', []) if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)
        self.assertEqual(product_data['shop_stock'], 7.0)
        self.assertEqual(product_data['warehouse_stock'], 3.0)

    def test_available_quantity_is_new_returned_minus_warehouse(self):
        """Available = max(0, (new+returned barcode count) - warehouse_qty)."""
        purchase = TestDataFactory.create_purchase(user=self.user, status='finalized')
        TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('10'), shop_quantity=Decimal('7'), warehouse_quantity=Decimal('3')
        )
        # 5 new+returned barcodes; warehouse=3 -> available = 5 - 3 = 2
        for _ in range(3):
            TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new')
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='returned')
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='returned')
        response = self.client.get('/api/v1/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product_data = next((p for p in response.data.get('results', []) if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)
        self.assertEqual(product_data['available_quantity'], 2.0)

    def test_available_quantity_negative_capped_at_zero(self):
        """If (new+returned) - warehouse < 0, available is 0."""
        purchase = TestDataFactory.create_purchase(user=self.user, status='finalized')
        TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('10'), shop_quantity=Decimal('2'), warehouse_quantity=Decimal('8')
        )
        # Only 1 new barcode; warehouse=8 -> 1-8 = -7 -> available = 0
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new')
        response = self.client.get('/api/v1/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product_data = next((p for p in response.data.get('results', []) if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)
        self.assertEqual(product_data['available_quantity'], 0.0)

    def test_in_cart_barcode_excluded_from_available(self):
        """Barcodes with tag in-cart are not in new+returned, so they don't increase available."""
        purchase = TestDataFactory.create_purchase(user=self.user, status='finalized')
        TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('5'), shop_quantity=Decimal('5'), warehouse_quantity=Decimal('0')
        )
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new')
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='in-cart')
        response = self.client.get('/api/v1/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product_data = next((p for p in response.data.get('results', []) if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)
        # Only 'new' counts; in-cart does not -> available = 1 - 0 = 1
        self.assertEqual(product_data['available_quantity'], 1.0)

    def test_supplier_breakdown_from_purchase_not_tag(self):
        """Breakdown one row per purchase; shop_barcode_count = available (new+returned) for that batch; purchase_date present."""
        supp_a = TestDataFactory.create_supplier(name="SupplierA")
        supp_b = TestDataFactory.create_supplier(name="SupplierB")
        p1 = TestDataFactory.create_purchase(user=self.user, supplier=supp_a, status='finalized')
        item1 = TestDataFactory.create_purchase_item(
            purchase=p1, product=self.product,
            quantity=Decimal('10'), shop_quantity=Decimal('6'), warehouse_quantity=Decimal('4')
        )
        p2 = TestDataFactory.create_purchase(user=self.user, supplier=supp_b, status='finalized')
        item2 = TestDataFactory.create_purchase_item(
            purchase=p2, product=self.product,
            quantity=Decimal('5'), shop_quantity=Decimal('1'), warehouse_quantity=Decimal('4')
        )
        from backend.catalog.models import Barcode
        for i in range(6):
            b = TestDataFactory.create_barcode(
                product=self.product, tag='new', purchase_item=item1,
                barcode=f"BC-A-{i}-{TestDataFactory.random_string(4)}"
            )
            b.purchase = p1
            b.save()
        b2 = TestDataFactory.create_barcode(
            product=self.product, tag='new', purchase_item=item2,
            barcode=f"BC-B-{TestDataFactory.random_string(4)}"
        )
        b2.purchase = p2
        b2.save()
        response = self.client.get('/api/v1/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product_data = next((p for p in response.data.get('results', []) if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)
        breakdown_list = product_data.get('supplier_breakdown', [])
        breakdown = {b['supplier']: b for b in breakdown_list}
        self.assertIn(supp_a.name, breakdown)
        self.assertIn(supp_b.name, breakdown)
        self.assertEqual(breakdown[supp_a.name]['shop_stock'], 6.0)
        self.assertEqual(breakdown[supp_a.name]['warehouse_stock'], 4.0)
        self.assertEqual(breakdown[supp_b.name]['shop_stock'], 1.0)
        self.assertEqual(breakdown[supp_b.name]['warehouse_stock'], 4.0)
        self.assertEqual(breakdown[supp_a.name]['shop_barcode_count'], 6.0)
        self.assertEqual(breakdown[supp_b.name]['shop_barcode_count'], 1.0)
        self.assertIn('purchase_date', breakdown[supp_a.name])
        self.assertIn('purchase_date', breakdown[supp_b.name])

    def test_draft_purchase_excluded_from_shop_warehouse(self):
        """Only finalized purchases contribute to shop_stock and warehouse_stock."""
        purchase = TestDataFactory.create_purchase(user=self.user, status='draft')
        TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('10'), shop_quantity=Decimal('7'), warehouse_quantity=Decimal('3')
        )
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new')
        response = self.client.get('/api/v1/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product_data = next((p for p in response.data.get('results', []) if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)
        self.assertEqual(product_data['shop_stock'], 0.0)
        self.assertEqual(product_data['warehouse_stock'], 0.0)
        self.assertEqual(product_data['available_quantity'], 1.0)  # 1 new - 0 warehouse

    def test_supplier_breakdown_shop_qty_is_shop_minus_sold(self):
        """Shop Qty (shop_barcode_count) = max(0, purchase shop_quantity - sold barcode count) per supplier."""
        supp = TestDataFactory.create_supplier(name="SupplierAMS")
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=supp, status='finalized')
        purchase_item = TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('20'), shop_quantity=Decimal('20'), warehouse_quantity=Decimal('0')
        )
        # Create 12 sold barcodes linked to this purchase so they count under this supplier
        for i in range(12):
            b = TestDataFactory.create_barcode(
                product=self.product,
                barcode=f"BC-SOLD-{i}-{TestDataFactory.random_string(4)}",
                tag='sold',
                purchase_item=purchase_item
            )
            b.purchase = purchase
            b.save()
        # 8 new barcodes (remaining in shop)
        for i in range(8):
            b = TestDataFactory.create_barcode(
                product=self.product,
                barcode=f"BC-NEW-{i}-{TestDataFactory.random_string(4)}",
                tag='new',
                purchase_item=purchase_item
            )
            b.purchase = purchase
            b.save()
        breakdown = _get_supplier_breakdown_for_product(self.product)
        by_supp = {b['supplier']: b for b in breakdown}
        self.assertIn(supp.name, by_supp)
        row = by_supp[supp.name]
        self.assertEqual(row['shop_stock'], 20.0)
        self.assertEqual(row['warehouse_stock'], 0.0)
        self.assertEqual(row['shop_barcode_count'], 8.0)  # 20 - 12 sold

    def test_supplier_breakdown_keeps_warehouse_only_row_when_filtering_zeros(self):
        """With exclude_fully_zero_rows, omit row only if both shop and warehouse available are zero."""
        supp = TestDataFactory.create_supplier(name="SupplierWhOnly")
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=supp, status='finalized')
        TestDataFactory.create_purchase_item(
            purchase=purchase, product=self.product,
            quantity=Decimal('5'), shop_quantity=Decimal('0'), warehouse_quantity=Decimal('5')
        )
        hidden = _get_supplier_breakdown_for_product(self.product, exclude_fully_zero_rows=True)
        shown = _get_supplier_breakdown_for_product(self.product, exclude_fully_zero_rows=False)
        self.assertEqual(len(shown), 1)
        self.assertEqual(shown[0]['warehouse_available'], 5.0)
        self.assertEqual(shown[0]['shop_barcode_count'], 0.0)
        self.assertEqual(len(hidden), 1)
        self.assertEqual(hidden[0]['supplier'], supp.name)

    def test_product_serializer_shop_warehouse_tie_to_breakdown(self):
        """ProductSerializer (detail) shop_stock and warehouse_stock equal sum of breakdown columns."""
        supp_a = TestDataFactory.create_supplier(name="SupplierA")
        supp_b = TestDataFactory.create_supplier(name="SupplierB")
        p1 = TestDataFactory.create_purchase(user=self.user, supplier=supp_a, status='finalized')
        item1 = TestDataFactory.create_purchase_item(
            purchase=p1, product=self.product,
            quantity=Decimal('10'), shop_quantity=Decimal('6'), warehouse_quantity=Decimal('4')
        )
        p2 = TestDataFactory.create_purchase(user=self.user, supplier=supp_b, status='finalized')
        item2 = TestDataFactory.create_purchase_item(
            purchase=p2, product=self.product,
            quantity=Decimal('5'), shop_quantity=Decimal('1'), warehouse_quantity=Decimal('4')
        )
        for i in range(6):
            b = TestDataFactory.create_barcode(
                product=self.product, tag='new', purchase_item=item1,
                barcode=f"BC-TIE-{i}-{TestDataFactory.random_string(4)}"
            )
            b.purchase = p1
            b.save()
        b2 = TestDataFactory.create_barcode(
            product=self.product, tag='new', purchase_item=item2,
            barcode=f"BC-TIE-B-{TestDataFactory.random_string(4)}"
        )
        b2.purchase = p2
        b2.save()
        data = ProductSerializer(self.product).data
        self.assertIn('supplier_breakdown', data)
        breakdown = data['supplier_breakdown']
        self.assertEqual(len(breakdown), 2)
        sum_shop = sum(b['shop_barcode_count'] for b in breakdown)
        sum_whse = sum(b['warehouse_stock'] for b in breakdown)
        self.assertEqual(data['shop_stock'], sum_shop)
        self.assertEqual(data['warehouse_stock'], sum_whse)
        self.assertEqual(data['shop_stock'], 7)   # 6 + 1 (int from serializer)
        self.assertEqual(data['warehouse_stock'], 8)  # 4 + 4


class ProductQuantityTests(TransactionTestCase):
    def setUp(self):
        # TransactionTestCase ensures a clean state, but let's be super sure
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        
        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)
        
        # Create product
        self.product = TestDataFactory.create_product(name="Test Product")
        
        # Create barcodes with different tags
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new') # 1
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='new') # 2
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='defective') # 3
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='defective') # 4
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='defective') # 5
        TestDataFactory.create_barcode_with_purchase(self.user, self.product, tag='sold') # 6
        
    def test_quantity_with_new_tag(self):
        """Test quantity when filtered by 'new' tag"""
        response = self.client.get('/api/v1/products/', {'tag': 'new'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        results = response.data.get('results', [])
        # Find OUR product
        product_data = next((p for p in results if p['id'] == self.product.id), None)
        
        self.assertIsNotNone(product_data)
        
        # available_quantity should be 2 (new barcodes)
        self.assertEqual(product_data['available_quantity'], 2.0)
        # stock_quantity should be 2 (counted tagged barcodes)
        self.assertEqual(product_data['stock_quantity'], 2.0)
        
    def test_quantity_with_defective_tag(self):
        """Test quantity when filtered by 'defective' tag"""
        response = self.client.get('/api/v1/products/', {'tag': 'defective'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        results = response.data.get('results', [])
        product_data = next((p for p in results if p['id'] == self.product.id), None)
        
        self.assertIsNotNone(product_data)
        
        # In a 'defective' view, stock_quantity should show the count of defective barcodes
        self.assertEqual(product_data['stock_quantity'], 3.0)


class DefectiveMoveOutSupplierSplitTests(TransactionTestCase):
    """Tests for defective_product_move_out: one invoice per supplier."""

    def setUp(self):
        from backend.catalog.models import DefectiveProductMoveOut
        from backend.pos.models import Invoice
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        DefectiveProductMoveOut.objects.all().delete()
        Invoice.objects.all().delete()

        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)
        self.store = TestDataFactory.create_store()

        self.supplier_a = TestDataFactory.create_supplier(name='Supplier A')
        self.supplier_b = TestDataFactory.create_supplier(name='Supplier B')

        self.product1 = TestDataFactory.create_product(name='Product Alpha', track_inventory=True)
        self.product2 = TestDataFactory.create_product(name='Product Beta', track_inventory=True)

    def _make_defective_barcode(self, product, supplier):
        """Create a defective barcode linked to the given supplier's purchase."""
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=supplier, store=self.store)
        purchase_item = TestDataFactory.create_purchase_item(purchase=purchase, product=product, quantity=Decimal('1'))
        return TestDataFactory.create_barcode(product=product, tag='defective', purchase_item=purchase_item)

    def test_single_supplier_creates_one_move_out(self):
        """Selecting barcodes from one supplier should produce exactly one move-out and one invoice."""
        from backend.catalog.models import DefectiveProductMoveOut
        from backend.pos.models import Invoice
        from backend.parties.models import Customer as PartyCustomer

        b1 = self._make_defective_barcode(self.product1, self.supplier_a)
        b2 = self._make_defective_barcode(self.product1, self.supplier_a)

        response = self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': [self.product1.id],
            'barcode_ids': [b1.id, b2.id],
            'reason': 'defective',
            'notes': '',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.data
        self.assertEqual(data['total_move_outs'], 1)
        self.assertEqual(len(data['move_outs']), 1)
        self.assertEqual(DefectiveProductMoveOut.objects.count(), 1)
        invoice = Invoice.objects.get(invoice_type='defective')
        self.assertIsNotNone(invoice.customer)
        self.assertEqual(invoice.customer.name, self.supplier_a.name)
        self.assertTrue(PartyCustomer.objects.filter(name=self.supplier_a.name).exists())
        # Barcodes should remain defective after move-out (move-out is NOT a sale)
        b1.refresh_from_db()
        b2.refresh_from_db()
        self.assertEqual(b1.tag, 'defective')
        self.assertEqual(b2.tag, 'defective')

    def test_two_suppliers_creates_two_move_outs(self):
        """Barcodes from two different suppliers should produce two separate move-outs/invoices."""
        from backend.catalog.models import DefectiveProductMoveOut
        from backend.pos.models import Invoice

        b1 = self._make_defective_barcode(self.product1, self.supplier_a)
        b2 = self._make_defective_barcode(self.product2, self.supplier_b)

        response = self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': [self.product1.id, self.product2.id],
            'barcode_ids': [b1.id, b2.id],
            'reason': 'defective',
            'notes': 'batch test',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.data
        self.assertEqual(data['total_move_outs'], 2)
        self.assertEqual(len(data['move_outs']), 2)
        self.assertEqual(DefectiveProductMoveOut.objects.count(), 2)
        # Two separate invoices
        self.assertEqual(Invoice.objects.filter(invoice_type='defective').count(), 2)
        # Barcodes should remain defective after move-out
        b1.refresh_from_db()
        b2.refresh_from_db()
        self.assertEqual(b1.tag, 'defective')
        self.assertEqual(b2.tag, 'defective')
        # Each move-out notes should mention its supplier
        notes_values = list(DefectiveProductMoveOut.objects.values_list('notes', flat=True))
        self.assertTrue(any('Supplier A' in n for n in notes_values))
        self.assertTrue(any('Supplier B' in n for n in notes_values))

    def test_five_suppliers_creates_five_move_outs(self):
        """5 barcodes from 5 different suppliers → 5 move-outs."""
        from backend.catalog.models import DefectiveProductMoveOut

        suppliers = [TestDataFactory.create_supplier(name=f'S{i}') for i in range(5)]
        product = TestDataFactory.create_product(name='Multi Supplier Product', track_inventory=True)
        barcodes = [self._make_defective_barcode(product, s) for s in suppliers]

        response = self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': [product.id],
            'barcode_ids': [b.id for b in barcodes],
            'reason': 'defective',
            'notes': '',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['total_move_outs'], 5)
        self.assertEqual(DefectiveProductMoveOut.objects.count(), 5)

    def test_no_supplier_barcodes_grouped_together(self):
        """Barcodes with no purchase (no supplier) should be grouped into one 'No Supplier' move-out."""
        from backend.catalog.models import DefectiveProductMoveOut

        # Barcodes with no purchase_item → no supplier
        b1 = TestDataFactory.create_barcode(product=self.product1, tag='defective')
        b2 = TestDataFactory.create_barcode(product=self.product2, tag='defective')

        response = self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': [self.product1.id, self.product2.id],
            'barcode_ids': [b1.id, b2.id],
            'reason': 'defective',
            'notes': '',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # Both no-supplier barcodes grouped into one move-out
        self.assertEqual(response.data['total_move_outs'], 1)
        self.assertIn('No Supplier', DefectiveProductMoveOut.objects.first().notes)


class BarcodeSerializerSupplierTests(TransactionTestCase):
    """Tests for BarcodeSerializer supplier_name/supplier_id via both Path A and Path B."""

    def setUp(self):
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.supplier = TestDataFactory.create_supplier(name='TestVendor')
        self.product = TestDataFactory.create_product(name='Supplier Test Product', track_inventory=True)

    def test_supplier_name_via_path_a(self):
        """supplier_name returned when barcode.purchase.supplier is set (Path A)."""
        from backend.catalog.serializers import BarcodeSerializer
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=self.supplier, status='finalized')
        purchase_item = TestDataFactory.create_purchase_item(purchase=purchase, product=self.product, quantity=Decimal('1'))
        barcode = TestDataFactory.create_barcode(product=self.product, tag='defective', purchase_item=purchase_item)
        barcode.purchase = purchase
        barcode.save()

        data = BarcodeSerializer(barcode).data
        self.assertEqual(data['supplier_name'], 'TestVendor')
        self.assertEqual(data['supplier_id'], self.supplier.id)

    def test_supplier_name_via_path_b(self):
        """supplier_name returned via purchase_item.purchase.supplier when barcode.purchase is None (Path B)."""
        from backend.catalog.serializers import BarcodeSerializer
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=self.supplier, status='finalized')
        purchase_item = TestDataFactory.create_purchase_item(purchase=purchase, product=self.product, quantity=Decimal('1'))
        barcode = TestDataFactory.create_barcode(product=self.product, tag='defective', purchase_item=purchase_item)
        # Ensure barcode.purchase is None to exercise Path B
        barcode.purchase = None
        barcode.save()

        data = BarcodeSerializer(barcode).data
        self.assertEqual(data['supplier_name'], 'TestVendor')
        self.assertEqual(data['supplier_id'], self.supplier.id)

    def test_supplier_none_when_no_purchase(self):
        """supplier_name and supplier_id are None when barcode has no purchase at all."""
        from backend.catalog.serializers import BarcodeSerializer
        barcode = TestDataFactory.create_barcode(product=self.product, tag='defective')

        data = BarcodeSerializer(barcode).data
        self.assertIsNone(data['supplier_name'])
        self.assertIsNone(data['supplier_id'])

    def test_supplier_id_field_present(self):
        """supplier_id is included in serialized output."""
        from backend.catalog.serializers import BarcodeSerializer
        barcode = TestDataFactory.create_barcode(product=self.product, tag='new')
        data = BarcodeSerializer(barcode).data
        self.assertIn('supplier_id', data)


class DefectiveMoveOutAddItemsTests(TransactionTestCase):
    """Tests for the add-items-to-existing-move-out endpoint."""

    def setUp(self):
        from backend.catalog.models import DefectiveProductMoveOut, DefectiveProductItem
        from backend.pos.models import Invoice
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        DefectiveProductMoveOut.objects.all().delete()
        Invoice.objects.all().delete()

        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier(name='AddItemsSupplier')
        self.product = TestDataFactory.create_product(name='Product X', track_inventory=True)

    def _make_defective_barcode(self, product=None, supplier=None):
        product = product or self.product
        supplier = supplier or self.supplier
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=supplier, store=self.store)
        purchase_item = TestDataFactory.create_purchase_item(purchase=purchase, product=product, quantity=Decimal('1'))
        return TestDataFactory.create_barcode(product=product, tag='defective', purchase_item=purchase_item)

    def _create_move_out(self, barcodes):
        """Create a move-out via the API and return the move-out id."""
        product_ids = list({b.product_id for b in barcodes})
        barcode_ids = [b.id for b in barcodes]
        response = self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': product_ids,
            'barcode_ids': barcode_ids,
            'reason': 'defective',
            'notes': '',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response.data['move_outs'][0]['id']

    def test_add_items_success(self):
        """Adding new defective barcodes to an existing move-out should succeed."""
        from backend.catalog.models import DefectiveProductMoveOut, DefectiveProductItem

        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        # Add a second barcode
        b2 = self._make_defective_barcode()
        response = self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b2.id],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['added_items'], 1)

        move_out = DefectiveProductMoveOut.objects.get(pk=move_out_id)
        self.assertEqual(move_out.total_items, 2)
        self.assertEqual(DefectiveProductItem.objects.filter(move_out=move_out).count(), 2)

    def test_add_items_updates_totals(self):
        """total_loss and total_items should be updated after adding items."""
        from backend.catalog.models import DefectiveProductMoveOut

        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])
        original = DefectiveProductMoveOut.objects.get(pk=move_out_id)
        original_loss = original.total_loss
        original_items = original.total_items

        b2 = self._make_defective_barcode()
        self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b2.id],
            'product_ids': [self.product.id],
        }, format='json')

        updated = DefectiveProductMoveOut.objects.get(pk=move_out_id)
        self.assertEqual(updated.total_items, original_items + 1)
        self.assertGreaterEqual(updated.total_loss, original_loss)

    def test_add_items_rejects_already_moved_barcode(self):
        """Barcodes already in a move-out should be rejected."""
        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        # Try to add b1 again — it's already in the move-out
        response = self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b1.id],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already in a move-out', response.data['error'])

    def test_add_items_rejects_empty_barcode_ids(self):
        """Empty barcode_ids should return 400."""
        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        response = self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('No barcodes provided', response.data['error'])

    def test_add_items_rejects_non_defective_barcode(self):
        """Non-defective barcodes should not be added."""
        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        # Create a 'new' tag barcode
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=self.supplier, store=self.store)
        purchase_item = TestDataFactory.create_purchase_item(purchase=purchase, product=self.product, quantity=Decimal('1'))
        b_new = TestDataFactory.create_barcode(product=self.product, tag='new', purchase_item=purchase_item)

        response = self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b_new.id],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_items_nonexistent_move_out_returns_404(self):
        """Adding items to a nonexistent move-out should return 404."""
        b1 = self._make_defective_barcode()

        response = self.client.post('/api/v1/defective-products/move-outs/99999/add-items/', {
            'barcode_ids': [b1.id],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_add_multiple_items_at_once(self):
        """Adding multiple barcodes in a single call should work correctly."""
        from backend.catalog.models import DefectiveProductMoveOut

        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        b2 = self._make_defective_barcode()
        b3 = self._make_defective_barcode()
        b4 = self._make_defective_barcode()

        response = self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b2.id, b3.id, b4.id],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['added_items'], 3)

        move_out = DefectiveProductMoveOut.objects.get(pk=move_out_id)
        self.assertEqual(move_out.total_items, 4)  # 1 original + 3 added

    def test_add_items_skips_already_moved_reports_count(self):
        """When some barcodes are already moved, they should be skipped and reported."""
        b1 = self._make_defective_barcode()
        b2 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        # b3 is new and should be added; b1 already in move-out and should be skipped
        b3 = self._make_defective_barcode()
        response = self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b1.id, b3.id],
            'product_ids': [self.product.id],
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['added_items'], 1)
        self.assertEqual(response.data['skipped_already_moved'], 1)

    def test_add_items_updates_invoice_totals(self):
        """Invoice subtotal/total should be updated when items are added."""
        from backend.pos.models import Invoice

        b1 = self._make_defective_barcode()
        move_out_id = self._create_move_out([b1])

        from backend.catalog.models import DefectiveProductMoveOut
        move_out = DefectiveProductMoveOut.objects.select_related('invoice').get(pk=move_out_id)
        invoice = move_out.invoice
        original_total = invoice.total

        b2 = self._make_defective_barcode()
        self.client.post(f'/api/v1/defective-products/move-outs/{move_out_id}/add-items/', {
            'barcode_ids': [b2.id],
            'product_ids': [self.product.id],
        }, format='json')

        invoice.refresh_from_db()
        self.assertGreaterEqual(invoice.total, original_total)


class DefectiveMoveOutListTests(TransactionTestCase):
    """Tests for the defective move-out list endpoint."""

    def setUp(self):
        from backend.catalog.models import DefectiveProductMoveOut
        from backend.pos.models import Invoice
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        DefectiveProductMoveOut.objects.all().delete()
        Invoice.objects.all().delete()

        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)
        self.store = TestDataFactory.create_store()
        self.supplier = TestDataFactory.create_supplier(name='ListTestSupplier')
        self.product = TestDataFactory.create_product(name='ListTestProduct', track_inventory=True)

    def _make_defective_barcode(self, product=None, supplier=None):
        product = product or self.product
        supplier = supplier or self.supplier
        purchase = TestDataFactory.create_purchase(user=self.user, supplier=supplier, store=self.store)
        purchase_item = TestDataFactory.create_purchase_item(purchase=purchase, product=product, quantity=Decimal('1'))
        return TestDataFactory.create_barcode(product=product, tag='defective', purchase_item=purchase_item)

    def test_list_returns_customer_name(self):
        """Move-out list should include the customer_name (supplier name) from invoice."""
        b1 = self._make_defective_barcode()
        self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': [self.product.id],
            'barcode_ids': [b1.id],
            'reason': 'defective',
            'notes': '',
        }, format='json')

        response = self.client.get('/api/v1/defective-products/move-outs/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data if isinstance(response.data, list) else response.data.get('results', response.data)
        if isinstance(results, list):
            move_out = results[0]
        else:
            move_out = results
        self.assertIn('customer_name', move_out)
        self.assertEqual(move_out['customer_name'], 'ListTestSupplier')

    def test_products_defective_list_excludes_already_moved_out_barcodes(self):
        """Defective products list should not include barcodes already linked to move-out items."""
        b1 = self._make_defective_barcode()
        b2 = self._make_defective_barcode()

        # Move out one barcode
        create_response = self.client.post('/api/v1/defective-products/move-out/', {
            'store': self.store.id,
            'product_ids': [self.product.id],
            'barcode_ids': [b1.id],
            'reason': 'defective',
            'notes': '',
        }, format='json')
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        # Defective list should only show the remaining barcode
        list_response = self.client.get('/api/v1/products/', {'tag': 'defective', 'supplier': self.supplier.id})
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        results = list_response.data.get('results', [])
        product_data = next((p for p in results if p['id'] == self.product.id), None)
        self.assertIsNotNone(product_data)

        barcodes = product_data.get('barcodes', [])
        barcode_ids = {b['id'] for b in barcodes}
        self.assertNotIn(b1.id, barcode_ids)
        self.assertIn(b2.id, barcode_ids)


class BarcodeLookupPosScanTests(TransactionTestCase):
    """Validate POS-specific lightweight barcode lookup behavior."""

    def setUp(self):
        Barcode.all_objects.all().delete()
        Product.all_objects.all().delete()
        self.client = AuthenticatedAPIClient()
        self.user = TestDataFactory.create_user(is_staff=True)
        self.client.authenticate_user(self.user)
        self.product = TestDataFactory.create_product(name="POS Scan Product", track_inventory=True)
        self.barcode = TestDataFactory.create_barcode_with_purchase(
            user=self.user,
            product=self.product,
            barcode=f"POS-SCAN-{TestDataFactory.random_string(8).upper()}",
            tag='new',
        )

    def test_pos_scan_returns_lightweight_payload(self):
        response = self.client.get(
            f"/api/v1/barcodes/by-barcode/{self.barcode.barcode}/",
            {"barcode_only": "true", "pos_scan": "true", "no_cache": "true"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], self.product.id)
        self.assertEqual(response.data["barcode_id"], self.barcode.id)
        self.assertIn("stock_quantity", response.data)
        self.assertIn("available_quantity", response.data)
        self.assertIn("matched_barcode", response.data)
        self.assertEqual(response.data.get("barcodes"), [])
        # Lightweight POS response should not include heavy serializer sections.
        self.assertNotIn("variants", response.data)
        self.assertNotIn("components", response.data)
        self.assertNotIn("supplier_breakdown", response.data)

    def test_regular_barcode_lookup_still_returns_full_product_shape(self):
        response = self.client.get(
            f"/api/v1/barcodes/by-barcode/{self.barcode.barcode}/",
            {"barcode_only": "true", "no_cache": "true"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Full serializer fields still exist for non-pos callers.
        self.assertIn("variants", response.data)
        self.assertIn("components", response.data)
        self.assertIn("supplier_breakdown", response.data)

    def test_pos_scan_sold_barcode_still_includes_invoice_number(self):
        from backend.pos.models import InvoiceItem

        self.barcode.tag = 'sold'
        self.barcode.save(update_fields=['tag'])

        invoice = TestDataFactory.create_invoice(user=self.user, invoice_type='cash', status='paid')
        InvoiceItem.objects.create(
            invoice=invoice,
            product=self.product,
            barcode=self.barcode,
            quantity=Decimal('1'),
            unit_price=Decimal('0'),
            line_total=Decimal('0'),
        )

        response = self.client.get(
            f"/api/v1/barcodes/by-barcode/{self.barcode.barcode}/",
            {"barcode_only": "true", "pos_scan": "true", "no_cache": "true"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data.get("barcode_available"), False)
        self.assertEqual(response.data.get("sold_invoice"), invoice.invoice_number)
