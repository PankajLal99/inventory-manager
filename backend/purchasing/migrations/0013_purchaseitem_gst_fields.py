from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("purchasing", "0012_multitenant_phase1"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseitem",
            name="gst_inclusive",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="purchaseitem",
            name="gst_percent",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=5),
        ),
    ]
