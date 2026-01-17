# Generated manually
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('catalog', '0003_barcodelabel'),
    ]

    operations = [
        migrations.AddField(
            model_name='barcode',
            name='tag',
            field=models.CharField(choices=[('new', 'NEW (Fresh)'), ('returned', 'Returned'), ('defective', 'Defective'), ('unknown', 'Unknown')], default='new', max_length=20),
        ),
    ]

