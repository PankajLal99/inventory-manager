# Generated manually: deleting a defective invoice must remove the move-out

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0019_product_imagefield_azure"),
    ]

    operations = [
        migrations.AlterField(
            model_name="defectiveproductmoveout",
            name="invoice",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="defective_move_outs",
                to="pos.invoice",
            ),
        ),
    ]
