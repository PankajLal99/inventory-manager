from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0018_multitenant_phase1"),
        ("purchasing", "0013_purchaseitem_gst_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="purchaseitem",
            name="tax_rate",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="purchase_items",
                to="catalog.taxrate",
            ),
        ),
    ]
