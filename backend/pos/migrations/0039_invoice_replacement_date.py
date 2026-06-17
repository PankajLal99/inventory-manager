from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pos', '0038_invoice_tags'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='replacement_date',
            field=models.DateField(blank=True, db_index=True, null=True),
        ),
    ]
