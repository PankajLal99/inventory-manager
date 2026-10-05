from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('salary_book', '0007_hardware_attendance_adms'),
    ]

    operations = [
        migrations.AddField(
            model_name='salarybooksettings',
            name='machine_time_delta_minutes',
            field=models.IntegerField(default=0),
        ),
    ]
