# Generated manually for internal ledger backfill

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('parties', '0016_ledgerentry_mixed_payment_support'),
    ]

    operations = [
        migrations.AddField(
            model_name='internalledgerentry',
            name='source_ledger_entry_id',
            field=models.PositiveIntegerField(blank=True, db_index=True, null=True, unique=True),
        ),
    ]
