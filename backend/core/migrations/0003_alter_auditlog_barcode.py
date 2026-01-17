# Generated manually to fix barcode field length for PostgreSQL migration

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_remove_role_and_permission_models'),
    ]

    operations = [
        migrations.AlterField(
            model_name='auditlog',
            name='barcode',
            field=models.CharField(blank=True, help_text='Barcode/SKU if applicable (can contain multiple comma-separated barcodes)', max_length=1000, null=True),
        ),
    ]
