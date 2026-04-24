# Generated manually on 2026-04-24

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0040_add_cart_discount_amount"),
    ]

    operations = [
        migrations.AlterField(
            model_name="cart",
            name="invoice_type",
            field=models.CharField(
                choices=[
                    ("cash", "Cash Invoice"),
                    ("upi", "UPI Invoice"),
                    ("pending", "Pending Invoice"),
                    ("defective", "Defective Invoice"),
                    ("credit", "Credit Invoice"),
                    ("mixed", "Mixed Payment (Cash + UPI)"),
                    ("card", "Card Invoice"),
                ],
                default="cash",
                max_length=20,
            ),
        ),
    ]
