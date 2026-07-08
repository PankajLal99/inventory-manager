from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("credit", "0003_creditpayment_creditledgerentry_payment_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="creditcart",
            name="locked",
            field=models.BooleanField(default=False),
        ),
    ]
