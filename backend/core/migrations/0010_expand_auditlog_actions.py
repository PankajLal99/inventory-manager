from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_access_permission_descriptions'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='action',
            field=models.CharField(
                choices=[
                    ('create', 'Create'),
                    ('update', 'Update'),
                    ('delete', 'Delete'),
                    ('view', 'View'),
                    ('stock_adjust', 'Stock Adjustment'),
                    ('price_change', 'Price Change'),
                    ('invoice_void', 'Invoice Void'),
                    ('invoice_create', 'Invoice Created'),
                    ('invoice_edit', 'Invoice Edit Started'),
                    ('invoice_update', 'Invoice Updated'),
                    ('invoice_checkout', 'Invoice Checkout'),
                    ('payment_add', 'Payment Added'),
                    ('return', 'Return'),
                    ('refund', 'Refund'),
                    ('cart_add', 'Add to Cart'),
                    ('cart_remove', 'Remove from Cart'),
                    ('cart_checkout', 'Cart Checkout'),
                    ('cart_update', 'Cart Update'),
                    ('barcode_scan', 'Barcode Scanned'),
                    ('barcode_tag_change', 'Barcode Tag Changed'),
                    ('stock_purchase', 'Stock Added (Purchase)'),
                    ('stock_sale', 'Stock Removed (Sale)'),
                    ('replacement_create', 'Replacement Created'),
                    ('replacement_replace', 'Item Replaced'),
                    ('replacement_return', 'Item Returned'),
                    ('replacement_defective', 'Item Marked Defective'),
                    ('replacement_pos_create', 'Replacement POS Invoice Created'),
                    ('replacement_pos_checkout', 'Replacement POS Invoice Checked Out'),
                ],
                max_length=50,
            ),
        ),
    ]
