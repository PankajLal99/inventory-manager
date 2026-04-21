from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("locations", "0004_multitenant_phase1"),
    ]

    operations = [
        migrations.AddField(
            model_name="store",
            name="auto_populate_price",
            field=models.BooleanField(default=False),
        ),
    ]
