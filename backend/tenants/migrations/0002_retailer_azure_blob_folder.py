from django.db import migrations, models


def set_default_blob_folders(apps, schema_editor):
    Retailer = apps.get_model('tenants', 'Retailer')
    for retailer in Retailer.objects.all().only('id', 'code', 'azure_blob_folder'):
        existing = (retailer.azure_blob_folder or '').strip()
        if existing:
            continue
        code = (retailer.code or '').strip().lower()
        retailer.azure_blob_folder = f'{code}-labels' if code else ''
        retailer.save(update_fields=['azure_blob_folder'])


class Migration(migrations.Migration):
    dependencies = [
        ('tenants', '0001_multitenant_phase1'),
    ]

    operations = [
        migrations.AddField(
            model_name='retailer',
            name='azure_blob_folder',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.RunPython(set_default_blob_folders, migrations.RunPython.noop),
    ]

