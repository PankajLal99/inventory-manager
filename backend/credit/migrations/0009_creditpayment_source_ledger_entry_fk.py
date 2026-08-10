import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("credit", "0008_creditcustomer_collection_crm"),
    ]

    operations = [
        migrations.AlterField(
            model_name="creditpayment",
            name="source_ledger_entry",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Main-app manual payment mirrored from Payments page (is_sent). "
                    "Mixed mode may create one cash and one UPI row for the same source."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="synced_credit_payments",
                to="parties.ledgerentry",
            ),
        ),
    ]
