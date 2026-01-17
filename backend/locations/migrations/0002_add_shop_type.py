# Generated manually
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('locations', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='store',
            name='shop_type',
            field=models.CharField(choices=[('retail', 'Retail Shop'), ('wholesale', 'Wholesale Shop')], default='retail', max_length=20),
        ),
    ]

