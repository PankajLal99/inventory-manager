from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0020_defective_move_out_invoice_cascade"),
    ]

    operations = [
        migrations.AddField(
            model_name="defectiveproductmoveout",
            name="sent_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
