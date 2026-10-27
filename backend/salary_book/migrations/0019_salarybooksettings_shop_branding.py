from django.db import migrations, models

import backend.core.storage
import backend.salary_book.models


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0018_alter_employee_overall_late_penalty_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='salarybooksettings',
            name='shop_name',
            field=models.CharField(default='MANISH TRADERS', max_length=120),
        ),
        migrations.AddField(
            model_name='salarybooksettings',
            name='shop_tagline',
            field=models.TextField(
                blank=True,
                default='Mobile Display / Parts Wholesale\nAll India Shipping',
                help_text='One line per row on the salary invoice.',
            ),
        ),
        migrations.AddField(
            model_name='salarybooksettings',
            name='shop_logo',
            field=models.ImageField(
                blank=True,
                null=True,
                storage=backend.core.storage.SalaryBookImageStorage(),
                upload_to=backend.salary_book.models.shop_logo_upload,
            ),
        ),
    ]
