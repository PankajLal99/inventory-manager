# Generated manually for performance optimization
# Adds database indexes to Barcode.barcode and Product.sku fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0011_alter_barcode_tag_alter_category_name_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="barcode",
            name="barcode",
            field=models.CharField(db_index=True, max_length=100, unique=True),
        ),
        migrations.AlterField(
            model_name="product",
            name="sku",
            field=models.CharField(blank=True, db_index=True, max_length=100, null=True, unique=True),
        ),
    ]

