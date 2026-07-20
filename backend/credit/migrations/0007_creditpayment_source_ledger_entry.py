import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("parties", "0019_safer_fk_on_delete"),
        ("credit", "0006_creditreturnitem_free_return_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="creditpayment",
            name="source_ledger_entry",
            field=models.OneToOneField(
                blank=True,
                help_text="Main-app manual payment mirrored from Payments page (is_sent)",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="synced_credit_payment",
                to="parties.ledgerentry",
            ),
        ),
    ]
