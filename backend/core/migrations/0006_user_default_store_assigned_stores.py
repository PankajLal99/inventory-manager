# Generated manually for user ↔ store assignment

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_multitenant_phase1"),
        ("locations", "0004_multitenant_phase1"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="default_store",
            field=models.ForeignKey(
                blank=True,
                help_text="Preferred shop for POS and stock context when not overridden.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="users_default_store",
                to="locations.store",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="assigned_stores",
            field=models.ManyToManyField(
                blank=True,
                help_text="If empty, user can access all stores allowed by their groups for this retailer. If set, only these stores (still filtered by group shop types).",
                related_name="assigned_users",
                to="locations.store",
            ),
        ),
    ]
