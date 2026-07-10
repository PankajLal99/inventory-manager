from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


def assign_credit_customer_groups(apps, schema_editor):
    CreditCustomer = apps.get_model('credit', 'CreditCustomer')
    Customer = apps.get_model('parties', 'Customer')
    CustomerGroup = apps.get_model('parties', 'CustomerGroup')

    credit_group, _ = CustomerGroup.objects.get_or_create(
        name='Credit',
        defaults={
            'description': 'POS Credit customers',
            'discount_percentage': Decimal('0.00'),
            'is_active': True,
        },
    )

    for customer in CreditCustomer.objects.filter(customer_group__isnull=True).iterator():
        group_id = credit_group.id
        if customer.linked_customer_id:
            party = Customer.objects.filter(pk=customer.linked_customer_id).first()
            if party and party.customer_group_id:
                group_id = party.customer_group_id
        customer.customer_group_id = group_id
        customer.save(update_fields=['customer_group_id'])


class Migration(migrations.Migration):

    dependencies = [
        ('parties', '0019_safer_fk_on_delete'),
        ('credit', '0004_creditcart_locked'),
    ]

    operations = [
        migrations.AddField(
            model_name='creditcustomer',
            name='customer_group',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='credit_customers',
                to='parties.customergroup',
            ),
        ),
        migrations.RunPython(assign_credit_customer_groups, migrations.RunPython.noop),
    ]
