from decimal import Decimal
from django.test import TransactionTestCase
from backend.core.test_utils import TestDataFactory, AuthenticatedAPIClient
from rest_framework import status
from backend.catalog.models import Product, Barcode
from backend.catalog.serializers import _get_supplier_breakdown_for_product, ProductSerializer


class ProductListStockFromPurchaseTests(TransactionTestCase):
    """Tests for ProductListSerializer: shop/warehouse from purchase, available = (new+returned) - warehouse."""

    def setUp(self):
        Barcode.objects.all().delete()
        Product.objects.all().delete()
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
        Barcode.objects.all().delete()
        Product.objects.all().delete()
        
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
