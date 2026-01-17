# Generated manually for short_code field addition
# Adds short_code field to Barcode model for quick barcode lookup without date

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0012_add_barcode_sku_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="barcode",
            name="short_code",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Short barcode identifier without date (e.g., FRAM-0001)",
                max_length=50,
                null=True,
                unique=True,
            ),
        ),
    ]
