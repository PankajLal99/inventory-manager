import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import (
    Case,
    Count,
    F,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from backend.catalog.models import Product
from backend.locations.models import Store
from backend.parties.models import Customer, CustomerGroup

from .collection_crm import (
    auto_bump_follow_up_after_payment,
    follow_up_delta_days,
    update_collection_fields,
)
from .models import (
    CreditCart,
    CreditCartItem,
    CreditCollectionEvent,
    CreditCustomer,
    CreditInvoice,
    CreditInvoiceItem,
    CreditLedgerEntry,
    CreditPayment,
    CreditProduct,
    CreditReturn,
    CreditReturnItem,
)
from .serializers import (
    CreditCartItemSerializer,
    CreditCartSerializer,
    CreditCustomerSerializer,
    CreditInvoiceSerializer,
    CreditLedgerEntrySerializer,
    CreditPaymentSerializer,
    CreditProductSerializer,
    CreditReturnSerializer,
    MergedCustomerSearchSerializer,
    MergedProductSearchSerializer,
    SoldCreditProductSerializer,
)

# Main-app customers eligible for Credit POS/ledger are marked with a heart in the name
# (❤ U+2764; also matches ❤️ with variation selector).
CREDIT_ELIGIBLE_NAME_MARKER = '❤'


def _credit_eligible_name_q(field: str = 'name') -> Q:
    """Filter customers whose name contains the credit heart marker."""
    return Q(**{f'{field}__contains': CREDIT_ELIGIBLE_NAME_MARKER})


def _generate_cart_number():
    while True:
        number = f"CCART-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        if not CreditCart.objects.filter(cart_number=number).exists():
            return number


def _generate_invoice_number():
    while True:
        number = f"CR-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        if not CreditInvoice.objects.filter(invoice_number=number).exists():
            return number


def _generate_return_number():
    while True:
        number = f"CRR-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
        if not CreditReturn.objects.filter(return_number=number).exists():
            return number


def _to_decimal(value, default='0'):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def _require_whole_quantity(qty: Decimal, *, allow_zero: bool = False):
    """Credit qty matches POS: whole units only (no fractional pcs)."""
    if allow_zero:
        if qty < 0:
            return 'Quantity cannot be negative'
    elif qty <= 0:
        return 'Quantity must be a positive whole number'
    if qty != qty.to_integral_value():
        return 'Quantity must be a whole number (decimals not allowed)'
    return None


def _get_credit_default_group():
    """CustomerGroup used for credit-only customers (not linked from parties)."""
    group, _ = CustomerGroup.objects.get_or_create(
        name='Credit',
        defaults={
            'description': 'POS Credit customers',
            'discount_percentage': Decimal('0.00'),
            'is_active': True,
        },
    )
    return group


def ensure_credit_customer(*, credit_customer_id=None, parties_customer_id=None, name=None, phone=None):
    """
    Resolve or create a CreditCustomer.
    Prefer an existing credit customer; for parties customers, get_or_create linked row.
    """
    if credit_customer_id:
        try:
            return CreditCustomer.objects.get(pk=credit_customer_id, is_active=True)
        except CreditCustomer.DoesNotExist:
            raise ValueError('Credit customer not found')

    if parties_customer_id:
        try:
            party = Customer.objects.get(pk=parties_customer_id, is_active=True)
        except Customer.DoesNotExist:
            raise ValueError('Customer not found')
        existing = CreditCustomer.objects.filter(linked_customer=party).first()
        if existing:
            return existing
        # Prefer matching by phone if already present as credit-only
        if party.phone:
            by_phone = CreditCustomer.objects.filter(phone=party.phone).first()
            if by_phone:
                if not by_phone.linked_customer_id:
                    by_phone.linked_customer = party
                    by_phone.save(update_fields=['linked_customer', 'updated_at'])
                return by_phone
        return CreditCustomer.objects.create(
            name=party.name,
            phone=party.phone or None,
            email=party.email or '',
            address=party.address or '',
            linked_customer=party,
            customer_group=party.customer_group or _get_credit_default_group(),
        )

    if name and str(name).strip():
        return CreditCustomer.objects.create(
            name=str(name).strip(),
            phone=(str(phone).strip() if phone else None) or None,
            customer_group=_get_credit_default_group(),
        )

    raise ValueError('Customer is required')


# ── Customers ───────────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def credit_customer_list_create(request):
    if request.method == 'GET':
        qs = CreditCustomer.objects.filter(
            is_active=True
        ).filter(_credit_eligible_name_q()).select_related('customer_group', 'linked_customer')
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(phone__icontains=search) |
                Q(email__icontains=search)
            )
        customer_group_id = request.query_params.get('customer_group', '').strip()
        if customer_group_id:
            qs = qs.filter(customer_group_id=customer_group_id)
        qs = qs.order_by('name')[:50]
        return Response(CreditCustomerSerializer(qs, many=True).data)

    serializer = CreditCustomerSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    customer = serializer.save()
    if not customer.customer_group_id:
        customer.customer_group = _get_credit_default_group()
        customer.save(update_fields=['customer_group', 'updated_at'])
    return Response(CreditCustomerSerializer(customer).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_customer_groups_list(request):
    """Customer groups used on credit customers (always includes Credit group)."""
    default_group = _get_credit_default_group()
    used_ids = set(
        CreditCustomer.objects.filter(is_active=True, customer_group__isnull=False)
        .values_list('customer_group_id', flat=True)
        .distinct()
    )
    used_ids.add(default_group.id)
    groups = CustomerGroup.objects.filter(id__in=used_ids, is_active=True).order_by('name')
    return Response([{'id': g.id, 'name': g.name} for g in groups])


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_customer_search(request):
    """Merge CreditCustomer + parties.Customer results for the POS picker."""
    search = request.query_params.get('search', '').strip()
    if len(search) < 1:
        return Response([])

    results = []
    seen_party_ids = set()
    seen_phones = set()

    credit_qs = CreditCustomer.objects.filter(is_active=True).filter(
        _credit_eligible_name_q()
    ).filter(
        Q(name__icontains=search) | Q(phone__icontains=search)
    ).select_related('linked_customer', 'customer_group')[:30]

    for c in credit_qs:
        if c.linked_customer_id:
            seen_party_ids.add(c.linked_customer_id)
        if c.phone:
            seen_phones.add(c.phone.strip())
        group_name = c.customer_group.name if c.customer_group_id else ''
        results.append({
            'id': c.id,
            'name': c.name,
            'phone': c.phone,
            'email': c.email or '',
            'source': 'credit',
            'credit_customer_id': c.id,
            'parties_customer_id': c.linked_customer_id,
            'balance': c.balance,
            'customer_group_id': c.customer_group_id,
            'customer_group_name': group_name,
        })

    party_qs = Customer.objects.filter(is_active=True).filter(
        _credit_eligible_name_q()
    ).filter(
        Q(name__icontains=search) | Q(phone__icontains=search)
    ).select_related('customer_group')[:30]

    for p in party_qs:
        if p.id in seen_party_ids:
            continue
        if p.phone and p.phone.strip() in seen_phones:
            continue
        # If a linked credit customer already exists, prefer that (should already be in results)
        linked = CreditCustomer.objects.filter(linked_customer=p).select_related('customer_group').first()
        if linked:
            continue
        results.append({
            'id': p.id,
            'name': p.name,
            'phone': p.phone,
            'email': p.email or '',
            'source': 'parties',
            'credit_customer_id': None,
            'parties_customer_id': p.id,
            'balance': Decimal('0.00'),
            'customer_group_id': p.customer_group_id,
            'customer_group_name': p.customer_group.name if p.customer_group_id else '',
        })

    results.sort(key=lambda r: (r['name'] or '').lower())
    return Response(MergedCustomerSearchSerializer(results[:40], many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_customer_ensure(request):
    """Ensure a CreditCustomer exists for a parties customer or create credit-only."""
    try:
        customer = ensure_credit_customer(
            credit_customer_id=request.data.get('credit_customer_id'),
            parties_customer_id=request.data.get('parties_customer_id'),
            name=request.data.get('name'),
            phone=request.data.get('phone'),
        )
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(CreditCustomerSerializer(customer).data)


# ── Products ────────────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def credit_product_list_create(request):
    if request.method == 'GET':
        qs = CreditProduct.objects.filter(is_active=True)
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(sku__icontains=search))
        qs = qs.order_by('name')[:50]
        return Response(CreditProductSerializer(qs, many=True).data)

    serializer = CreditProductSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    product = serializer.save()
    return Response(CreditProductSerializer(product).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_product_search(request):
    """
    Product picker for Credit POS.

    Catalog half uses the same optimized name_only filter + relevance ranking as
    GET /products/?search_mode=name_only. Credit-only products are merged on top.
    Returns identity fields only (no stock / costs).
    """
    from django.db.models import Case, IntegerField, Value, When

    from backend.catalog.filters import ProductFilter
    from backend.catalog.product_name_relevance import order_product_ids_by_name_relevance

    search = (request.query_params.get('search') or '').strip()
    if len(search) < 1:
        return Response([])

    try:
        limit = min(max(int(request.query_params.get('limit', 40)), 1), 100)
    except (TypeError, ValueError):
        limit = 40

    def _rank_queryset(model, ordered_ids, only_fields=('id', 'name', 'sku')):
        order_case = Case(
            *[When(pk=pid, then=Value(idx)) for idx, pid in enumerate(ordered_ids)],
            output_field=IntegerField(),
        )
        return (
            model.objects.filter(pk__in=ordered_ids)
            .only(*only_fields)
            .annotate(_rank=order_case)
            .order_by('_rank')
        )

    results = []

    # ── Credit-only products first (name tokens + same relevance ranking) ────
    search_words = [w for w in search.upper().split() if w]
    credit_qs = CreditProduct.objects.filter(is_active=True).only('id', 'name', 'sku')
    if search_words:
        cq = Q(name__icontains=search_words[0])
        for word in search_words[1:]:
            cq &= Q(name__icontains=word)
        credit_qs = credit_qs.filter(cq)

    credit_pairs = list(credit_qs.values('id', 'name')[:200])
    credit_ordered = order_product_ids_by_name_relevance(credit_pairs, search, len(credit_pairs))
    for p in _rank_queryset(CreditProduct, credit_ordered):
        results.append({
            'id': p.id,
            'name': p.name,
            'sku': p.sku,
            'source': 'credit',
            'catalog_product_id': None,
            'credit_product_id': p.id,
        })

    # ── Catalog products (ProductFilter name_only + relevance, same as /products/)
    catalog_qs = Product.objects.filter(is_active=True).only('id', 'name', 'sku')
    if request.query_params.get('exclude_other_custom') in ('true', '1', 'yes'):
        catalog_qs = catalog_qs.exclude(name__istartswith='Other -')

    filtered = ProductFilter(
        data={'search': search, 'search_mode': 'name_only'},
        queryset=catalog_qs,
    ).qs

    remaining = max(limit - len(results), 0)
    candidate_cap = min(2000, max(remaining * 10, 200)) if remaining else 0
    if remaining:
        pairs = list(filtered.values('id', 'name')[:candidate_cap])
        ordered_ids = order_product_ids_by_name_relevance(pairs, search, len(pairs))[:remaining]
        for p in _rank_queryset(Product, ordered_ids):
            results.append({
                'id': p.id,
                'name': p.name,
                'sku': p.sku,
                'source': 'catalog',
                'catalog_product_id': p.id,
                'credit_product_id': None,
            })

    return Response(MergedProductSearchSerializer(results[:limit], many=True).data)


# ── Carts ───────────────────────────────────────────────────────────────────

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def credit_cart_list_create(request):
    if request.method == 'GET':
        qs = CreditCart.objects.filter(created_by=request.user, status='active').select_related(
            'store', 'customer'
        ).prefetch_related('items')
        store_id = request.query_params.get('store')
        if store_id:
            qs = qs.filter(store_id=store_id)
        if request.query_params.get('single') == 'true':
            cart = qs.order_by('-updated_at').first()
            if not cart:
                return Response({'detail': 'No active cart'}, status=status.HTTP_404_NOT_FOUND)
            return Response(CreditCartSerializer(cart).data)
        return Response(CreditCartSerializer(qs.order_by('-updated_at'), many=True).data)

    store_id = request.data.get('store')
    if not store_id:
        return Response({'detail': 'store is required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        store = Store.objects.get(pk=store_id)
    except Store.DoesNotExist:
        return Response({'detail': 'Store not found'}, status=status.HTTP_400_BAD_REQUEST)

    customer = None
    if request.data.get('credit_customer_id') or request.data.get('parties_customer_id') or request.data.get('customer'):
        try:
            customer = ensure_credit_customer(
                credit_customer_id=request.data.get('credit_customer_id') or request.data.get('customer'),
                parties_customer_id=request.data.get('parties_customer_id'),
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    cart = CreditCart.objects.create(
        cart_number=_generate_cart_number(),
        store=store,
        customer=customer,
        created_by=request.user,
    )
    return Response(CreditCartSerializer(cart).data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def credit_cart_detail(request, pk):
    try:
        cart = CreditCart.objects.select_related('store', 'customer').prefetch_related('items').get(pk=pk)
    except CreditCart.DoesNotExist:
        return Response({'detail': 'Cart not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(CreditCartSerializer(cart).data)

    if request.method == 'DELETE':
        if cart.status == 'completed':
            return Response({'detail': 'Cannot delete a completed cart'}, status=status.HTTP_400_BAD_REQUEST)
        if cart.locked:
            return Response(
                {'detail': 'Cart is locked. Unlock the cart before closing or discarding it.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cart.status = 'cancelled'
        cart.save(update_fields=['status', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH — lock and/or customer
    if 'locked' in request.data:
        cart.locked = bool(request.data.get('locked'))

    has_customer_update = (
        'credit_customer_id' in request.data
        or 'parties_customer_id' in request.data
        or 'customer' in request.data
    )
    if has_customer_update:
        if cart.locked and 'locked' not in request.data:
            return Response(
                {'detail': 'Cart is locked. Unlock the cart to edit customer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        credit_id = request.data.get('credit_customer_id') or request.data.get('customer')
        parties_id = request.data.get('parties_customer_id')
        if credit_id is None and parties_id is None:
            cart.customer = None
        else:
            try:
                cart.customer = ensure_credit_customer(
                    credit_customer_id=credit_id,
                    parties_customer_id=parties_id,
                )
            except ValueError as e:
                return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    cart.save()
    return Response(CreditCartSerializer(cart).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_cart_items(request, pk):
    try:
        cart = CreditCart.objects.get(pk=pk, status='active')
    except CreditCart.DoesNotExist:
        return Response({'detail': 'Active cart not found'}, status=status.HTTP_404_NOT_FOUND)

    if cart.locked:
        return Response(
            {'detail': 'Cart is locked. Unlock the cart to add items.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    catalog_product_id = request.data.get('catalog_product_id') or request.data.get('product')
    credit_product_id = request.data.get('credit_product_id') or request.data.get('credit_product')
    # Draft lines may start at qty 0 / price 0; checkout enforces both > 0.
    quantity = _to_decimal(request.data.get('quantity', '0'), '0')
    # Qty and price are always cart-driven — never take cost/price from product master data.
    unit_price = _to_decimal(request.data.get('unit_price', '0'), '0')

    qty_err = _require_whole_quantity(quantity, allow_zero=True)
    if qty_err:
        return Response({'detail': qty_err}, status=status.HTTP_400_BAD_REQUEST)
    quantity = quantity.to_integral_value()

    product = None
    credit_product = None
    product_name = (request.data.get('product_name') or '').strip()

    if catalog_product_id:
        try:
            product = Product.objects.only('id', 'name').get(pk=catalog_product_id)
            product_name = product_name or product.name
        except Product.DoesNotExist:
            return Response({'detail': 'Catalog product not found'}, status=status.HTTP_400_BAD_REQUEST)
    elif credit_product_id:
        try:
            credit_product = CreditProduct.objects.only('id', 'name').get(pk=credit_product_id)
            product_name = product_name or credit_product.name
        except CreditProduct.DoesNotExist:
            return Response({'detail': 'Credit product not found'}, status=status.HTTP_400_BAD_REQUEST)
    else:
        return Response(
            {'detail': 'catalog_product_id or credit_product_id is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    line_total = (quantity * unit_price).quantize(Decimal('0.01'))
    item = CreditCartItem.objects.create(
        cart=cart,
        product=product,
        credit_product=credit_product,
        product_name=product_name,
        quantity=quantity,
        unit_price=unit_price,
        line_total=line_total,
    )
    cart.save(update_fields=['updated_at'])
    return Response(CreditCartItemSerializer(item).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def credit_cart_item_detail(request, pk, item_id):
    try:
        cart = CreditCart.objects.get(pk=pk, status='active')
        item = cart.items.get(pk=item_id)
    except (CreditCart.DoesNotExist, CreditCartItem.DoesNotExist):
        return Response({'detail': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

    if cart.locked:
        return Response(
            {'detail': 'Cart is locked. Unlock the cart to edit items.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if request.method == 'DELETE':
        item.delete()
        cart.save(update_fields=['updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    if 'quantity' in request.data:
        qty = _to_decimal(request.data.get('quantity'), str(item.quantity))
        qty_err = _require_whole_quantity(qty, allow_zero=True)
        if qty_err:
            return Response({'detail': qty_err}, status=status.HTTP_400_BAD_REQUEST)
        item.quantity = qty.to_integral_value()
    if 'unit_price' in request.data:
        price = _to_decimal(request.data.get('unit_price'), str(item.unit_price))
        if price < 0:
            return Response({'detail': 'Unit prices cannot be negative'}, status=status.HTTP_400_BAD_REQUEST)
        item.unit_price = price
    item.line_total = (item.quantity * item.unit_price).quantize(Decimal('0.01'))
    item.save()
    cart.save(update_fields=['updated_at'])
    return Response(CreditCartItemSerializer(item).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_cart_checkout(request, pk):
    try:
        cart = CreditCart.objects.select_related('customer', 'store').prefetch_related('items').get(
            pk=pk, status='active'
        )
    except CreditCart.DoesNotExist:
        return Response({'detail': 'Active cart not found'}, status=status.HTTP_404_NOT_FOUND)

    if cart.locked:
        return Response(
            {'detail': 'Cart is locked. Unlock the cart before checkout.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    items = list(cart.items.all())
    if not items:
        return Response({'detail': 'Cart is empty'}, status=status.HTTP_400_BAD_REQUEST)

    # Resolve customer
    try:
        customer = ensure_credit_customer(
            credit_customer_id=request.data.get('credit_customer_id') or (
                cart.customer_id if cart.customer_id else None
            ),
            parties_customer_id=request.data.get('parties_customer_id'),
            name=request.data.get('name'),
            phone=request.data.get('phone'),
        )
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    notes = request.data.get('notes', '') or ''
    created_at_raw = request.data.get('created_at')
    created_at_override = None
    if created_at_raw not in (None, ''):
        raw_str = str(created_at_raw).strip()
        if raw_str.endswith('Z'):
            raw_str = raw_str[:-1] + '+00:00'
        parsed_created_at = parse_datetime(raw_str)
        if parsed_created_at is None:
            return Response(
                {'detail': 'Invalid created_at datetime format'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if timezone.is_naive(parsed_created_at):
            parsed_created_at = timezone.make_aware(
                parsed_created_at, timezone.get_current_timezone()
            )
        created_at_override = parsed_created_at

    for item in items:
        if item.unit_price <= 0:
            return Response(
                {
                    'detail': (
                        f'{item.product_name}: Selling price must be greater than 0'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        qty_err = _require_whole_quantity(item.quantity)
        if qty_err:
            return Response(
                {'detail': f'{item.product_name}: {qty_err}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    with transaction.atomic():
        cart = CreditCart.objects.select_for_update().get(pk=cart.pk)
        if cart.status != 'active':
            return Response({'detail': 'Cart is no longer active'}, status=status.HTTP_400_BAD_REQUEST)

        customer = CreditCustomer.objects.select_for_update().get(pk=customer.pk)

        subtotal = sum((i.line_total for i in items), Decimal('0.00'))
        total = subtotal

        invoice_kwargs = {
            'invoice_number': _generate_invoice_number(),
            'cart': cart,
            'store': cart.store,
            'customer': customer,
            'status': 'open',
            'subtotal': subtotal,
            'total': total,
            'notes': notes,
            'created_by': request.user,
        }
        if created_at_override is not None:
            invoice_kwargs['created_at'] = created_at_override

        invoice = CreditInvoice.objects.create(**invoice_kwargs)

        CreditInvoiceItem.objects.bulk_create([
            CreditInvoiceItem(
                invoice=invoice,
                product=item.product,
                credit_product=item.credit_product,
                product_name=item.product_name or (
                    item.product.name if item.product_id else (
                        item.credit_product.name if item.credit_product_id else ''
                    )
                ),
                quantity=item.quantity,
                unit_price=item.unit_price,
                line_total=item.line_total,
            )
            for item in items
        ])

        CreditLedgerEntry.objects.create(
            customer=customer,
            invoice=invoice,
            entry_type='debit',
            amount=total,
            description=f'Credit invoice {invoice.invoice_number}',
            created_by=request.user,
            created_at=invoice.created_at,
        )
        customer.balance = F('balance') + total
        customer.save(update_fields=['balance', 'updated_at'])
        customer.refresh_from_db(fields=['balance'])

        cart.customer = customer
        cart.status = 'completed'
        cart.save(update_fields=['customer', 'status', 'updated_at'])

    invoice = CreditInvoice.objects.select_related('customer', 'store', 'created_by').prefetch_related('items').get(
        pk=invoice.pk
    )
    return Response(CreditInvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


# ── Invoices ────────────────────────────────────────────────────────────────

def _credit_invoices_filtered_queryset(request):
    qs = CreditInvoice.objects.select_related(
        'customer', 'customer__customer_group', 'store', 'created_by'
    ).all()

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(invoice_number__icontains=search) |
            Q(customer__name__icontains=search) |
            Q(customer__phone__icontains=search)
        )

    store_id = request.query_params.get('store')
    if store_id:
        qs = qs.filter(store_id=store_id)

    status_filter = request.query_params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)

    customer_id = request.query_params.get('customer')
    if customer_id:
        qs = qs.filter(customer_id=customer_id)

    customer_group_id = request.query_params.get('customer_group', '').strip()
    if customer_group_id:
        qs = qs.filter(customer__customer_group_id=customer_group_id)

    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)

    return qs.order_by('-id')


def _credit_returns_filtered_queryset(request):
    qs = CreditReturn.objects.select_related(
        'customer', 'customer__customer_group', 'store', 'created_by'
    ).prefetch_related('items')

    customer_id = request.query_params.get('customer') or request.query_params.get('credit_customer_id')
    if customer_id:
        qs = qs.filter(customer_id=customer_id)

    customer_group_id = request.query_params.get('customer_group', '').strip()
    if customer_group_id:
        qs = qs.filter(customer__customer_group_id=customer_group_id)

    store_id = request.query_params.get('store')
    if store_id:
        qs = qs.filter(store_id=store_id)

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(return_number__icontains=search) |
            Q(customer__name__icontains=search)
        )

    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)

    status_filter = request.query_params.get('status', '').strip()
    if status_filter:
        qs = qs.filter(status=status_filter)

    return qs.order_by('-created_at')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_invoices_summary(request):
    """KPI totals for credit invoices / returns with the same filters as list views."""
    invoice_qs = _credit_invoices_filtered_queryset(request)
    return_qs = _credit_returns_filtered_queryset(request)

    sales_total = invoice_qs.filter(status='open').aggregate(
        total=Coalesce(Sum('total'), Decimal('0')),
        count=Count('id'),
    )
    void_count = invoice_qs.filter(status='void').count()
    # KPI return totals exclude voided returns
    returns_total = return_qs.filter(status='completed').aggregate(
        total=Coalesce(Sum('total'), Decimal('0')),
        count=Count('id'),
    )

    return Response({
        'total_sales': str(sales_total['total'] or Decimal('0')),
        'sales_count': sales_total['count'] or 0,
        'void_count': void_count,
        'total_returns': str(returns_total['total'] or Decimal('0')),
        'returns_count': returns_total['count'] or 0,
        'invoice_count': invoice_qs.count(),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_invoice_list(request):
    qs = _credit_invoices_filtered_queryset(request)
    try:
        page = max(int(request.query_params.get('page', 1)), 1)
        page_size = min(max(int(request.query_params.get('page_size', 25)), 1), 100)
    except (TypeError, ValueError):
        page, page_size = 1, 25

    total_count = qs.count()
    start = (page - 1) * page_size
    end = start + page_size
    page_qs = qs[start:end]

    return Response({
        'count': total_count,
        'page': page,
        'page_size': page_size,
        'results': CreditInvoiceSerializer(page_qs, many=True).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_invoice_detail(request, pk):
    try:
        invoice = CreditInvoice.objects.select_related(
            'customer', 'store', 'created_by'
        ).prefetch_related('items').get(pk=pk)
    except CreditInvoice.DoesNotExist:
        return Response({'detail': 'Invoice not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(CreditInvoiceSerializer(invoice).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_invoice_update(request, pk):
    """
    Edit an open credit invoice (lines / notes) and apply ledger delta.

    Payload:
      items: [
        {
          id?: int,                  # existing line id (omit for new lines)
          catalog_product_id?: int,
          credit_product_id?: int,
          product_name?: str,
          quantity: number,
          unit_price: number,
        },
        ...
      ]
      notes?: str
      created_at?: ISO datetime (optional — also moves sale debit timestamp)

    Ledger: update the original sale debit amount in place and
    customer.balance += (new_total - old_total).
    """
    if not _can_manage_credit_records(request.user):
        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        invoice = CreditInvoice.objects.select_related('customer').prefetch_related('items').get(pk=pk)
    except CreditInvoice.DoesNotExist:
        return Response({'detail': 'Invoice not found'}, status=status.HTTP_404_NOT_FOUND)

    if invoice.status == 'void':
        return Response({'detail': 'Cannot edit a voided invoice'}, status=status.HTTP_400_BAD_REQUEST)

    raw_items = request.data.get('items')
    if not isinstance(raw_items, list) or len(raw_items) == 0:
        return Response({'detail': 'At least one item is required'}, status=status.HTTP_400_BAD_REQUEST)

    notes = request.data.get('notes')
    created_at_raw = request.data.get('created_at')
    created_at_override = None
    if created_at_raw not in (None, ''):
        raw_str = str(created_at_raw).strip()
        if raw_str.endswith('Z'):
            raw_str = raw_str[:-1] + '+00:00'
        parsed = parse_datetime(raw_str)
        if parsed is None:
            return Response({'detail': 'Invalid created_at datetime format'}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        created_at_override = parsed

    existing_by_id = {item.id: item for item in invoice.items.all()}
    kept_ids = set()
    prepared = []

    for idx, row in enumerate(raw_items):
        if not isinstance(row, dict):
            return Response(
                {'detail': f'Item {idx + 1}: invalid payload'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item_id = row.get('id')
        existing = None
        if item_id not in (None, ''):
            try:
                item_id = int(item_id)
            except (TypeError, ValueError):
                return Response(
                    {'detail': f'Item {idx + 1}: invalid id'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            existing = existing_by_id.get(item_id)
            if existing is None:
                return Response(
                    {'detail': f'Item {idx + 1}: line {item_id} not found on this invoice'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kept_ids.add(item_id)

        quantity = _to_decimal(row.get('quantity'), '0')
        qty_err = _require_whole_quantity(quantity)
        if qty_err:
            return Response(
                {'detail': f'Item {idx + 1}: {qty_err}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        quantity = quantity.to_integral_value()

        unit_price = _to_decimal(row.get('unit_price'), '0')
        if unit_price <= 0:
            return Response(
                {'detail': f'Item {idx + 1}: Selling price must be greater than 0'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        returned_qty = Decimal('0')
        if existing is not None:
            returned_qty = existing.returned_quantity or Decimal('0')
            if quantity < returned_qty:
                return Response(
                    {
                        'detail': (
                            f'Item {idx + 1} ({existing.product_name}): '
                            f'quantity cannot be below returned qty ({returned_qty})'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        product = existing.product if existing else None
        credit_product = existing.credit_product if existing else None
        product_name = (row.get('product_name') or '').strip()
        if existing and not product_name:
            product_name = existing.product_name

        catalog_product_id = row.get('catalog_product_id') or row.get('product')
        credit_product_id = row.get('credit_product_id') or row.get('credit_product')

        if existing is None:
            if catalog_product_id:
                try:
                    product = Product.objects.only('id', 'name').get(pk=catalog_product_id)
                    product_name = product_name or product.name
                except Product.DoesNotExist:
                    return Response(
                        {'detail': f'Item {idx + 1}: catalog product not found'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            elif credit_product_id:
                try:
                    credit_product = CreditProduct.objects.only('id', 'name').get(pk=credit_product_id)
                    product_name = product_name or credit_product.name
                except CreditProduct.DoesNotExist:
                    return Response(
                        {'detail': f'Item {idx + 1}: credit product not found'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            if not product_name:
                return Response(
                    {'detail': f'Item {idx + 1}: product_name is required'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        line_total = (quantity * unit_price).quantize(Decimal('0.01'))
        prepared.append({
            'existing': existing,
            'product': product,
            'credit_product': credit_product,
            'product_name': product_name,
            'quantity': quantity,
            'unit_price': unit_price,
            'line_total': line_total,
            'returned_quantity': returned_qty,
        })

    # Cannot delete lines that have returns
    for item_id, item in existing_by_id.items():
        if item_id not in kept_ids:
            returned = item.returned_quantity or Decimal('0')
            if returned > 0:
                return Response(
                    {
                        'detail': (
                            f'Cannot remove "{item.product_name}" — '
                            f'{returned} unit(s) already returned'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

    new_total = sum((p['line_total'] for p in prepared), Decimal('0.00')).quantize(Decimal('0.01'))
    if new_total <= 0:
        return Response({'detail': 'Invoice total must be greater than 0'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        invoice = CreditInvoice.objects.select_for_update().select_related('customer').get(pk=pk)
        if invoice.status == 'void':
            return Response({'detail': 'Cannot edit a voided invoice'}, status=status.HTTP_400_BAD_REQUEST)

        customer = CreditCustomer.objects.select_for_update().get(pk=invoice.customer_id)
        old_total = invoice.total or Decimal('0.00')
        delta = (new_total - old_total).quantize(Decimal('0.01'))

        # Remove dropped lines (no returns — already validated)
        for item_id, item in existing_by_id.items():
            if item_id not in kept_ids:
                item.delete()

        for p in prepared:
            existing = p['existing']
            if existing is not None:
                existing.product = p['product']
                existing.credit_product = p['credit_product']
                existing.product_name = p['product_name']
                existing.quantity = p['quantity']
                existing.unit_price = p['unit_price']
                existing.line_total = p['line_total']
                existing.save()
            else:
                CreditInvoiceItem.objects.create(
                    invoice=invoice,
                    product=p['product'],
                    credit_product=p['credit_product'],
                    product_name=p['product_name'],
                    quantity=p['quantity'],
                    unit_price=p['unit_price'],
                    line_total=p['line_total'],
                    returned_quantity=Decimal('0'),
                )

        invoice.subtotal = new_total
        invoice.total = new_total
        update_fields = ['subtotal', 'total', 'updated_at']
        if notes is not None:
            invoice.notes = str(notes)
            update_fields.append('notes')
        if created_at_override is not None:
            invoice.created_at = created_at_override
            update_fields.append('created_at')
        invoice.save(update_fields=update_fields)

        # Update original sale debit in place (exclude void / return / payment credits)
        sale_debit = (
            CreditLedgerEntry.objects.filter(
                invoice=invoice,
                entry_type='debit',
                payment__isnull=True,
                credit_return__isnull=True,
            )
            .order_by('id')
            .first()
        )
        if sale_debit:
            sale_debit.amount = new_total
            sale_debit.description = f'Credit invoice {invoice.invoice_number}'
            debit_fields = ['amount', 'description']
            if created_at_override is not None:
                sale_debit.created_at = created_at_override
                debit_fields.append('created_at')
            sale_debit.save(update_fields=debit_fields)
        else:
            CreditLedgerEntry.objects.create(
                customer=customer,
                invoice=invoice,
                entry_type='debit',
                amount=new_total,
                description=f'Credit invoice {invoice.invoice_number}',
                created_by=request.user,
                created_at=invoice.created_at,
            )
            # Missing debit was not in balance — apply full new total, not just delta
            delta = new_total

        if delta != 0:
            customer.balance = F('balance') + delta
            customer.save(update_fields=['balance', 'updated_at'])

    invoice = CreditInvoice.objects.select_related(
        'customer', 'store', 'created_by'
    ).prefetch_related('items').get(pk=pk)
    data = CreditInvoiceSerializer(invoice).data
    data['ledger_delta'] = str(delta)
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_invoice_void(request, pk):
    if not _can_manage_credit_records(request.user):
        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        invoice = CreditInvoice.objects.select_related('customer').get(pk=pk)
    except CreditInvoice.DoesNotExist:
        return Response({'detail': 'Invoice not found'}, status=status.HTTP_404_NOT_FOUND)

    if invoice.status == 'void':
        return Response({'detail': 'Invoice already voided'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        invoice = CreditInvoice.objects.select_for_update().select_related('customer').get(pk=pk)
        if invoice.status == 'void':
            return Response({'detail': 'Invoice already voided'}, status=status.HTTP_400_BAD_REQUEST)

        customer = CreditCustomer.objects.select_for_update().get(pk=invoice.customer_id)
        amount = invoice.total

        CreditLedgerEntry.objects.create(
            customer=customer,
            invoice=invoice,
            entry_type='credit',
            amount=amount,
            description=f'Void credit invoice {invoice.invoice_number}',
            created_by=request.user,
        )
        customer.balance = F('balance') - amount
        customer.save(update_fields=['balance', 'updated_at'])

        invoice.status = 'void'
        invoice.voided_at = timezone.now()
        invoice.voided_by = request.user
        invoice.save(update_fields=['status', 'voided_at', 'voided_by', 'updated_at'])

    invoice = CreditInvoice.objects.select_related(
        'customer', 'store', 'created_by'
    ).prefetch_related('items').get(pk=pk)
    return Response(CreditInvoiceSerializer(invoice).data)


# ── Ledger ──────────────────────────────────────────────────────────────────

def _ledger_signed_amount(entry):
    """Debit increases outstanding; credit decreases."""
    amt = entry.amount or Decimal('0')
    return amt if entry.entry_type == 'debit' else -amt


def _active_ledger_entries(qs):
    """Exclude ledger rows for voided invoices/returns — they cancel out and clutter the statement."""
    return qs.exclude(
        Q(invoice__isnull=False, invoice__status='void')
        | Q(credit_return__isnull=False, credit_return__status='void')
    )


def _is_manual_ledger_entry(entry):
    """Opening balance / manual adjustments — not invoice, return, or main-ledger sync."""
    if entry.invoice_id or entry.credit_return_id:
        return False
    if entry.payment_id:
        payment = entry.payment
        if payment is None:
            payment = CreditPayment.objects.filter(pk=entry.payment_id).first()
        if payment and payment.source_ledger_entry_id:
            return False
    return True


def _parse_ledger_datetime(value):
    if value in (None, ''):
        return None
    raw_str = str(value).strip()
    if raw_str.endswith('Z'):
        raw_str = raw_str[:-1] + '+00:00'
    parsed = parse_datetime(raw_str)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _can_manage_credit_records(user):
    """Only Admin and Super may edit/void credit invoices, returns, and manual ledger entries.

    Accounts group is always denied (view-only for destructive credit actions).
    """
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if user.groups.filter(name__iexact='Account').exists() or user.groups.filter(name__iexact='Accounts').exists():
        return False
    if getattr(user, 'is_superuser', False):
        return True
    return user.groups.filter(name__in=['Super', 'Admin']).exists()


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_ledger_entry_create(request):
    """
    Manual credit / debit against a credit customer.
    - credit: records a CreditPayment + ledger credit (reduces balance)
    - debit: records a standalone ledger debit (increases balance)
    """
    try:
        customer = ensure_credit_customer(
            credit_customer_id=request.data.get('credit_customer_id') or request.data.get('customer'),
            parties_customer_id=request.data.get('parties_customer_id'),
        )
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    entry_type = (request.data.get('entry_type') or '').strip().lower()
    if entry_type not in ('credit', 'debit'):
        return Response(
            {'detail': 'entry_type must be credit or debit'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    amount = _to_decimal(request.data.get('amount'), '0')
    if amount <= 0:
        return Response({'detail': 'Amount must be greater than 0'}, status=status.HTTP_400_BAD_REQUEST)

    description = (request.data.get('description') or request.data.get('notes') or '').strip()

    created_at_raw = request.data.get('created_at') or request.data.get('paid_at')
    if created_at_raw:
        raw_str = str(created_at_raw).strip()
        if raw_str.endswith('Z'):
            raw_str = raw_str[:-1] + '+00:00'
        created_at = parse_datetime(raw_str)
        if created_at is None:
            return Response({'detail': 'Invalid created_at'}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(created_at):
            created_at = timezone.make_aware(created_at, timezone.get_current_timezone())
    else:
        created_at = timezone.now()

    with transaction.atomic():
        customer = CreditCustomer.objects.select_for_update().get(pk=customer.pk)

        if entry_type == 'credit':
            method = (request.data.get('payment_method') or 'cash').strip().lower()
            if method not in dict(CreditPayment.PAYMENT_METHOD_CHOICES):
                return Response(
                    {'detail': 'payment_method must be cash, upi, or mixed'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            cash_amount = None
            upi_amount = None
            if method == 'cash':
                cash_amount = amount
                upi_amount = Decimal('0.00')
            elif method == 'upi':
                upi_amount = amount
                cash_amount = Decimal('0.00')
            else:
                cash_amount = _to_decimal(request.data.get('cash_amount'), '0')
                upi_amount = _to_decimal(request.data.get('upi_amount'), '0')
                if cash_amount < 0 or upi_amount < 0:
                    return Response(
                        {'detail': 'cash_amount and upi_amount cannot be negative'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                mixed_total = (cash_amount + upi_amount).quantize(Decimal('0.01'))
                if mixed_total != amount.quantize(Decimal('0.01')):
                    # If split not provided, put full amount on cash
                    if cash_amount == 0 and upi_amount == 0:
                        cash_amount = amount
                        upi_amount = Decimal('0.00')
                    else:
                        return Response(
                            {
                                'detail': (
                                    f'amount ({amount}) must equal cash_amount + upi_amount ({mixed_total})'
                                )
                            },
                            status=status.HTTP_400_BAD_REQUEST,
                        )

            payment = CreditPayment.objects.create(
                customer=customer,
                payment_method=method,
                amount=amount,
                cash_amount=cash_amount,
                upi_amount=upi_amount,
                notes=description,
                paid_at=created_at,
                created_by=request.user,
            )

            parts = [f'Payment ({_payment_method_label(method)})']
            if method == 'mixed':
                parts.append(f'cash ₹{cash_amount} + UPI ₹{upi_amount}')
            if description:
                parts.append(description)
            ledger_description = ' — '.join(parts)

            entry = CreditLedgerEntry.objects.create(
                customer=customer,
                payment=payment,
                entry_type='credit',
                amount=amount,
                description=ledger_description,
                created_by=request.user,
                created_at=created_at,
            )
            customer.balance = F('balance') - amount
            did_payment = True
        else:
            ledger_description = description or 'Manual debit'
            entry = CreditLedgerEntry.objects.create(
                customer=customer,
                entry_type='debit',
                amount=amount,
                description=ledger_description,
                created_by=request.user,
                created_at=created_at,
            )
            customer.balance = F('balance') + amount
            did_payment = False

        customer.save(update_fields=['balance', 'updated_at'])
        customer.refresh_from_db(fields=['balance', 'next_follow_up_date', 'collection_reason'])
        if did_payment:
            auto_bump_follow_up_after_payment(customer, user=request.user)

    entry = CreditLedgerEntry.objects.select_related(
        'customer', 'payment', 'created_by'
    ).get(pk=entry.pk)
    data = CreditLedgerEntrySerializer(entry).data
    data['customer_balance'] = customer.balance
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def credit_ledger_entry_detail(request, pk):
    """
    Update or delete a manual ledger entry (opening balance debit/credit).
    Reverses old balance effect and applies new values on PATCH.
    """
    if not _can_manage_credit_records(request.user):
        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        entry = CreditLedgerEntry.objects.select_related('customer', 'payment').get(pk=pk)
    except CreditLedgerEntry.DoesNotExist:
        return Response({'detail': 'Entry not found'}, status=status.HTTP_404_NOT_FOUND)

    if not _is_manual_ledger_entry(entry):
        return Response(
            {'detail': 'Only manual opening balance entries can be changed'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if request.method == 'DELETE':
        with transaction.atomic():
            entry = CreditLedgerEntry.objects.select_for_update(of=('self',)).get(pk=pk)
            if not _is_manual_ledger_entry(entry):
                return Response(
                    {'detail': 'Only manual opening balance entries can be changed'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            customer = CreditCustomer.objects.select_for_update().get(pk=entry.customer_id)
            signed = _ledger_signed_amount(entry)
            customer.balance = F('balance') - signed
            customer.save(update_fields=['balance', 'updated_at'])
            payment_id = entry.payment_id
            entry.delete()
            if payment_id:
                payment = CreditPayment.objects.filter(pk=payment_id).first()
                if payment:
                    from .ledger_sync import revert_main_ledger_sent_for_payment

                    revert_main_ledger_sent_for_payment(payment)
                    payment.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)

    old_signed = _ledger_signed_amount(entry)

    if 'amount' in request.data:
        amount = _to_decimal(request.data.get('amount'), '0')
    else:
        amount = entry.amount
    if amount <= 0:
        return Response({'detail': 'Amount must be greater than 0'}, status=status.HTTP_400_BAD_REQUEST)

    description = entry.description
    if 'description' in request.data or 'notes' in request.data:
        description = (request.data.get('description') or request.data.get('notes') or '').strip()
        if not description:
            description = entry.description or 'Opening Balance'

    created_at = _parse_ledger_datetime(
        request.data.get('created_at') or request.data.get('paid_at')
    )

    with transaction.atomic():
        entry = CreditLedgerEntry.objects.select_for_update(of=('self',)).get(pk=pk)
        if not _is_manual_ledger_entry(entry):
            return Response(
                {'detail': 'Only manual opening balance entries can be changed'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        customer = CreditCustomer.objects.select_for_update().get(pk=entry.customer_id)
        entry.amount = amount
        entry.description = description
        update_fields = ['amount', 'description']
        if created_at is not None:
            entry.created_at = created_at
            update_fields.append('created_at')
        entry.save(update_fields=update_fields)

        if entry.payment_id:
            payment = CreditPayment.objects.select_for_update().get(pk=entry.payment_id)
            payment.amount = amount
            method = payment.payment_method or 'cash'
            if method == 'upi':
                payment.upi_amount = amount
                payment.cash_amount = Decimal('0.00')
            elif method == 'mixed':
                payment.cash_amount = amount
                payment.upi_amount = Decimal('0.00')
            else:
                payment.cash_amount = amount
                payment.upi_amount = Decimal('0.00')
            payment.notes = description
            pay_fields = ['amount', 'cash_amount', 'upi_amount', 'notes', 'updated_at']
            if created_at is not None:
                payment.paid_at = created_at
                pay_fields.append('paid_at')
            payment.save(update_fields=pay_fields)

        new_signed = _ledger_signed_amount(entry)
        delta = new_signed - old_signed
        if delta != 0:
            customer.balance = F('balance') + delta
            customer.save(update_fields=['balance', 'updated_at'])

    entry = CreditLedgerEntry.objects.select_related(
        'customer', 'payment', 'created_by'
    ).get(pk=pk)
    customer = entry.customer
    customer.refresh_from_db(fields=['balance'])
    data = CreditLedgerEntrySerializer(entry).data
    data['customer_balance'] = customer.balance
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_ledger_list(request):
    qs = CreditLedgerEntry.objects.select_related(
        'customer', 'invoice', 'credit_return', 'payment', 'created_by'
    ).all()

    customer_id = request.query_params.get('customer')
    if customer_id:
        qs = qs.filter(customer_id=customer_id)

    entry_type = request.query_params.get('entry_type')
    if entry_type:
        qs = qs.filter(entry_type=entry_type)

    txn_type = request.query_params.get('txn_type', '').strip().lower()
    if txn_type == 'payment':
        qs = qs.filter(payment__isnull=False)
    elif txn_type == 'return':
        qs = qs.filter(credit_return__isnull=False)
    elif txn_type == 'sale':
        qs = qs.filter(payment__isnull=True, credit_return__isnull=True)

    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(
            Q(customer__name__icontains=search) |
            Q(description__icontains=search) |
            Q(invoice__invoice_number__icontains=search)
        )

    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)

    qs = qs.order_by('-created_at')

    try:
        page = max(int(request.query_params.get('page', 1)), 1)
        page_size = min(max(int(request.query_params.get('page_size', 50)), 1), 200)
    except (TypeError, ValueError):
        page, page_size = 1, 50

    total_count = qs.count()
    start = (page - 1) * page_size
    end = start + page_size

    return Response({
        'count': total_count,
        'page': page,
        'page_size': page_size,
        'results': CreditLedgerEntrySerializer(qs[start:end], many=True).data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_ledger_statement(request):
    """
    Classic account statement for one credit customer:
    opening balance, chronological rows (sale / payment / return),
    debit/credit columns, running balance, period totals.
    """
    customer_id = request.query_params.get('customer') or request.query_params.get('credit_customer_id')
    if not customer_id:
        return Response({'detail': 'customer is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        customer = CreditCustomer.objects.get(pk=customer_id)
    except CreditCustomer.DoesNotExist:
        return Response({'detail': 'Customer not found'}, status=status.HTTP_404_NOT_FOUND)

    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')
    txn_type = request.query_params.get('txn_type', '').strip().lower()

    base = _active_ledger_entries(
        CreditLedgerEntry.objects.filter(customer_id=customer.id).select_related(
            'invoice', 'credit_return', 'payment', 'created_by'
        )
    )

    # Opening balance = signed sum of all entries before date_from
    opening = Decimal('0.00')
    if date_from:
        prior = base.filter(created_at__date__lt=date_from)
        for e in prior.only('entry_type', 'amount'):
            opening += _ledger_signed_amount(e)

    qs = base
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    if txn_type == 'payment':
        qs = qs.filter(payment__isnull=False)
    elif txn_type == 'return':
        qs = qs.filter(credit_return__isnull=False)
    elif txn_type == 'sale':
        qs = qs.filter(payment__isnull=True, credit_return__isnull=True)

    # Chronological statement: oldest first (ascending by date)
    entries = list(qs.order_by('created_at', 'id'))
    serializer = CreditLedgerEntrySerializer(entries, many=True)

    running = opening
    total_debit = Decimal('0.00')
    total_credit = Decimal('0.00')
    rows = []
    for raw, entry in zip(serializer.data, entries):
        debit = entry.amount if entry.entry_type == 'debit' else Decimal('0.00')
        credit = entry.amount if entry.entry_type == 'credit' else Decimal('0.00')
        total_debit += debit
        total_credit += credit
        running += _ledger_signed_amount(entry)
        bal_side = 'Dr' if running >= 0 else 'Cr'
        rows.append({
            **raw,
            'debit': debit,
            'credit': credit,
            'running_balance': abs(running),
            'balance_side': bal_side,
        })

    # Keep response rows strictly ascending by date (oldest on top)
    rows.sort(
        key=lambda r: (
            str(r.get('created_at') or ''),
            int(r.get('id') or 0),
        )
    )

    closing = running
    closing_side = 'Dr' if closing >= 0 else 'Cr'

    return Response({
        'customer': CreditCustomerSerializer(customer).data,
        'date_from': date_from or None,
        'date_to': date_to or None,
        'opening_balance': abs(opening),
        'opening_side': 'Dr' if opening >= 0 else 'Cr',
        'closing_balance': abs(closing),
        'closing_side': closing_side,
        'total_debit': total_debit,
        'total_credit': total_credit,
        'rows': rows,
    })


def _credit_days_since_last_payment(last_payment_at, last_sale_at):
    """Days since last payment; if never paid, days since last sale debit."""
    today = timezone.localdate()
    if last_payment_at:
        return (today - timezone.localtime(last_payment_at).date()).days
    if last_sale_at:
        return (today - timezone.localtime(last_sale_at).date()).days
    return None


def _credit_collection_status(balance, days_since_last_payment):
    """
    Defaulter / collection status for credit ledger accounts:
    - good (green): balance cleared or payment received within 4 days
    - warning (yellow): no payment for 5–9 days while balance is due
    - danger (red): no payment for 10+ days while balance is due
    """
    bal = balance if isinstance(balance, Decimal) else Decimal(str(balance or 0))
    if bal <= 0:
        return 'good'
    if days_since_last_payment is None:
        return 'danger'
    if days_since_last_payment >= 10:
        return 'danger'
    if days_since_last_payment >= 5:
        return 'warning'
    return 'good'


def _parse_follow_up_date(raw):
    """Parse yyyy-mm-dd or ISO datetime into a date, or None if blank."""
    if raw in (None, ''):
        return None
    text = str(raw).strip()
    if not text:
        return None
    if 'T' in text:
        parsed = parse_datetime(text.replace('Z', '+00:00') if text.endswith('Z') else text)
        if parsed is None:
            raise ValueError('Invalid next_follow_up_date')
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        return timezone.localtime(parsed).date()
    try:
        from datetime import date as date_cls
        parts = text[:10].split('-')
        return date_cls(int(parts[0]), int(parts[1]), int(parts[2]))
    except (TypeError, ValueError, IndexError) as exc:
        raise ValueError('Invalid next_follow_up_date') from exc


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_ledger_by_customer(request):
    """Summary list of credit customers with balances and collection status (ledger index)."""
    search = request.query_params.get('search', '').strip()
    only_with_balance = (request.query_params.get('with_balance') or '').strip().lower()
    # Default: heart-marked only. Pass with_heart=0 / false / all to show everyone.
    with_heart_raw = (request.query_params.get('with_heart') or '1').strip().lower()
    only_with_heart = with_heart_raw not in ('0', 'false', 'all', 'no')
    follow_up_filter = (request.query_params.get('follow_up') or '').strip().lower()

    latest_desc = (
        CreditLedgerEntry.objects.filter(customer_id=OuterRef('pk'))
        .order_by('-created_at', '-id')
        .values('description')[:1]
    )
    latest_activity = (
        CreditLedgerEntry.objects.filter(customer_id=OuterRef('pk'))
        .order_by('-created_at', '-id')
        .values('created_at')[:1]
    )
    last_payment = (
        CreditPayment.objects.filter(customer_id=OuterRef('pk'))
        .order_by('-paid_at')
        .values('paid_at')[:1]
    )
    last_sale = (
        CreditLedgerEntry.objects.filter(
            customer_id=OuterRef('pk'),
            entry_type='debit',
            payment__isnull=True,
            credit_return__isnull=True,
        )
        .exclude(invoice__status='void')
        .order_by('-created_at')
        .values('created_at')[:1]
    )
    returns_total_sq = (
        CreditReturn.objects.filter(
            customer_id=OuterRef('pk'),
            status='completed',
        )
        .values('customer_id')
        .annotate(s=Sum('total'))
        .values('s')[:1]
    )

    qs = CreditCustomer.objects.filter(is_active=True)
    if only_with_heart:
        qs = qs.filter(_credit_eligible_name_q())
    void_ledger_exclude = (
        (Q(ledger_entries__invoice__isnull=True) | ~Q(ledger_entries__invoice__status='void'))
        & (Q(ledger_entries__credit_return__isnull=True) | ~Q(ledger_entries__credit_return__status='void'))
    )
    qs = qs.select_related(
        'customer_group',
        'linked_customer',
    ).annotate(
        total_debit=Coalesce(
            Sum(
                'ledger_entries__amount',
                filter=Q(ledger_entries__entry_type='debit') & void_ledger_exclude,
            ),
            Decimal('0'),
        ),
        total_credit=Coalesce(
            Sum(
                'ledger_entries__amount',
                filter=Q(ledger_entries__entry_type='credit') & void_ledger_exclude,
            ),
            Decimal('0'),
        ),
        # Payments received (CreditPayment-linked credits only — not returns)
        total_received=Coalesce(
            Sum(
                Case(
                    When(
                        ledger_entries__entry_type='credit',
                        ledger_entries__payment__isnull=False,
                        ledger_entries__credit_return__isnull=True,
                        then=F('ledger_entries__amount'),
                    ),
                    default=Value(Decimal('0')),
                )
            ),
            Decimal('0'),
        ),
        # Sum of CreditReturn.total (completed) — not ledger / manual credits
        total_returns=Coalesce(Subquery(returns_total_sq), Decimal('0')),
        entry_count=Count('ledger_entries', distinct=True),
        latest_description=Subquery(latest_desc),
        last_activity_at=Subquery(latest_activity),
        last_payment_at=Subquery(last_payment),
        last_sale_at=Subquery(last_sale),
    )

    if search:
        qs = qs.filter(Q(name__icontains=search) | Q(phone__icontains=search))
    customer_group_id = request.query_params.get('customer_group', '').strip()
    if customer_group_id:
        qs = qs.filter(customer_group_id=customer_group_id)
    if only_with_balance in ('1', 'true'):
        qs = qs.exclude(balance=0)

    today = timezone.localdate()
    if follow_up_filter in ('overdue', 'past'):
        qs = qs.filter(next_follow_up_date__lt=today)
    elif follow_up_filter in ('today', 'due_today'):
        qs = qs.filter(next_follow_up_date=today)
    elif follow_up_filter in ('upcoming', 'future'):
        qs = qs.filter(next_follow_up_date__gt=today)
    elif follow_up_filter in ('none', 'blank', 'unset'):
        qs = qs.filter(next_follow_up_date__isnull=True)
    elif follow_up_filter in ('set', 'scheduled'):
        qs = qs.filter(next_follow_up_date__isnull=False)

    # Oldest ledger activity first; newest at the bottom; no-entry accounts last
    qs = qs.order_by(F('last_activity_at').asc(nulls_last=True), 'name')[:200]

    out = []
    for row in qs:
        balance = row.balance or Decimal('0')
        days_since = _credit_days_since_last_payment(row.last_payment_at, row.last_sale_at)
        collection_status = _credit_collection_status(balance, days_since)
        total_debit = row.total_debit or Decimal('0')
        total_credit = row.total_credit or Decimal('0')
        total_received = row.total_received or Decimal('0')
        total_returns = row.total_returns or Decimal('0')
        fu_delta = follow_up_delta_days(row.next_follow_up_date)
        out.append({
            'id': row.id,
            'name': row.name,
            'phone': row.phone or '',
            'customer_group_id': row.customer_group_id,
            'customer_group_name': row.customer_group.name if row.customer_group_id else '',
            'balance': str(balance),
            'total_debit': str(total_debit),
            'total_credit': str(total_credit),
            'total_received': str(total_received),
            'total_returns': str(total_returns),
            'net_amount': str(total_debit - total_credit),
            'entry_count': row.entry_count or 0,
            'latest_description': row.latest_description or '',
            'last_activity_at': timezone.localtime(row.last_activity_at).isoformat() if row.last_activity_at else None,
            'last_payment_at': timezone.localtime(row.last_payment_at).isoformat() if row.last_payment_at else None,
            'last_sale_at': timezone.localtime(row.last_sale_at).isoformat() if row.last_sale_at else None,
            'days_since_last_payment': days_since,
            'collection_status': collection_status,
            'collection_reason': row.collection_reason or '',
            'next_follow_up_date': row.next_follow_up_date.isoformat() if row.next_follow_up_date else None,
            'follow_up_delta_days': fu_delta,
        })
    return Response(out)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def credit_ledger_collection_update(request, pk):
    """Inline update of collection reason and/or next follow-up date."""
    try:
        customer = CreditCustomer.objects.get(pk=pk, is_active=True)
    except CreditCustomer.DoesNotExist:
        return Response({'detail': 'Customer not found'}, status=status.HTTP_404_NOT_FOUND)

    data = request.data or {}
    reason = data.get('collection_reason') if 'collection_reason' in data else (
        data.get('reason') if 'reason' in data else None
    )

    clear_follow_up = False
    next_follow_up_date = None
    if 'next_follow_up_date' in data:
        raw = data.get('next_follow_up_date')
        if raw in (None, ''):
            clear_follow_up = True
        else:
            try:
                next_follow_up_date = _parse_follow_up_date(raw)
            except ValueError as e:
                return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    if reason is None and 'next_follow_up_date' not in data:
        return Response(
            {'detail': 'Provide collection_reason and/or next_follow_up_date'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        customer = CreditCustomer.objects.select_for_update().get(pk=pk)
        update_collection_fields(
            customer,
            reason=reason,
            next_follow_up_date=None if clear_follow_up else next_follow_up_date,
            clear_follow_up=clear_follow_up,
            user=request.user,
        )
        customer.refresh_from_db()

    fu_delta = follow_up_delta_days(customer.next_follow_up_date)
    return Response({
        'id': customer.id,
        'collection_reason': customer.collection_reason or '',
        'next_follow_up_date': (
            customer.next_follow_up_date.isoformat() if customer.next_follow_up_date else None
        ),
        'follow_up_delta_days': fu_delta,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_ledger_collection_history(request, pk):
    """Timeline of reason / follow-up changes for the clock history button."""
    if not CreditCustomer.objects.filter(pk=pk).exists():
        return Response({'detail': 'Customer not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        limit = min(max(int(request.query_params.get('limit', 50)), 1), 200)
    except (TypeError, ValueError):
        limit = 50

    events = (
        CreditCollectionEvent.objects.filter(customer_id=pk)
        .select_related('created_by')
        .order_by('-created_at', '-id')[:limit]
    )
    results = []
    for ev in events:
        results.append({
            'id': ev.id,
            'event_type': ev.event_type,
            'event_type_label': dict(CreditCollectionEvent.EVENT_CHOICES).get(ev.event_type, ev.event_type),
            'reason': ev.reason or '',
            'follow_up_date': ev.follow_up_date.isoformat() if ev.follow_up_date else None,
            'previous_follow_up_date': (
                ev.previous_follow_up_date.isoformat() if ev.previous_follow_up_date else None
            ),
            'note': ev.note or '',
            'created_by': ev.created_by_id,
            'created_by_name': (
                (ev.created_by.get_full_name() or ev.created_by.username)
                if ev.created_by_id else ''
            ),
            'created_at': ev.created_at.isoformat() if ev.created_at else None,
        })
    return Response({'count': len(results), 'results': results})


def _credit_customer_delete_summary(customer):
    """Counts of related records that would be removed with the credit customer."""
    cid = customer.id
    invoices = CreditInvoice.objects.filter(customer_id=cid)
    returns = CreditReturn.objects.filter(customer_id=cid)
    return {
        'customer': CreditCustomerSerializer(customer).data,
        'invoice_count': invoices.count(),
        'open_invoice_count': invoices.filter(status='open').count(),
        'void_invoice_count': invoices.filter(status='void').count(),
        'return_count': returns.count(),
        'completed_return_count': returns.filter(status='completed').count(),
        'void_return_count': returns.filter(status='void').count(),
        'payment_count': CreditPayment.objects.filter(customer_id=cid).count(),
        'ledger_entry_count': CreditLedgerEntry.objects.filter(customer_id=cid).count(),
        'cart_count': CreditCart.objects.filter(customer_id=cid).count(),
        'collection_event_count': CreditCollectionEvent.objects.filter(customer_id=cid).count(),
    }


def _delete_credit_customer_ledger(customer):
    """Hard-delete a credit customer and all related ledger / invoice / return data."""
    cid = customer.id
    with transaction.atomic():
        customer = CreditCustomer.objects.select_for_update().get(pk=cid)
        summary = _credit_customer_delete_summary(customer)

        payments_qs = CreditPayment.objects.filter(customer_id=cid)
        from .ledger_sync import revert_main_ledger_sent_for_payment_queryset

        revert_main_ledger_sent_for_payment_queryset(payments_qs)
        CreditLedgerEntry.objects.filter(customer_id=cid).delete()
        payments_qs.delete()

        return_ids = list(
            CreditReturn.objects.filter(customer_id=cid).values_list('id', flat=True)
        )
        if return_ids:
            CreditReturnItem.objects.filter(credit_return_id__in=return_ids).delete()
            CreditReturn.objects.filter(id__in=return_ids).delete()

        invoice_ids = list(
            CreditInvoice.objects.filter(customer_id=cid).values_list('id', flat=True)
        )
        if invoice_ids:
            CreditInvoiceItem.objects.filter(invoice_id__in=invoice_ids).delete()
            CreditInvoice.objects.filter(id__in=invoice_ids).delete()

        cart_ids = list(
            CreditCart.objects.filter(customer_id=cid).values_list('id', flat=True)
        )
        if cart_ids:
            CreditCartItem.objects.filter(cart_id__in=cart_ids).delete()
            CreditCart.objects.filter(id__in=cart_ids).delete()

        customer.delete()
        return summary


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def credit_ledger_customer_delete(request, pk):
    """
    GET — preview counts before deleting an entire credit ledger account.
    DELETE — remove customer and all invoices, returns, payments, ledger entries, carts.
    Admin / Super only.
    """
    if not _can_manage_credit_records(request.user):
        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        customer = CreditCustomer.objects.get(pk=pk, is_active=True)
    except CreditCustomer.DoesNotExist:
        return Response({'detail': 'Customer not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(_credit_customer_delete_summary(customer))

    summary = _delete_credit_customer_ledger(customer)
    return Response(summary)


# ── Returns ─────────────────────────────────────────────────────────────────

def _resolve_credit_customer_id(request):
    """Resolve credit customer from query/body; ensures parties link if needed."""
    credit_id = request.query_params.get('credit_customer_id') or request.data.get('credit_customer_id')
    parties_id = request.query_params.get('parties_customer_id') or request.data.get('parties_customer_id')
    customer_id = request.query_params.get('customer') or request.data.get('customer')
    try:
        if credit_id or customer_id or parties_id:
            cust = ensure_credit_customer(
                credit_customer_id=credit_id or (customer_id if not parties_id else None),
                parties_customer_id=parties_id,
            )
            return cust.id
    except ValueError as e:
        raise ValueError(str(e))
    raise ValueError('credit_customer_id or parties_customer_id is required')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_return_sold_products(request):
    """
    Search products sold on open credit invoices for a customer.
    Returns sold unit price and remaining returnable qty per invoice line.
    """
    search = request.query_params.get('search', '').strip()
    try:
        customer_id = _resolve_credit_customer_id(request)
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    qs = CreditInvoiceItem.objects.filter(
        invoice__customer_id=customer_id,
        invoice__status='open',
    ).select_related('invoice', 'product', 'credit_product').annotate(
        remaining=F('quantity') - F('returned_quantity'),
    ).filter(remaining__gt=0)

    if search:
        qs = qs.filter(
            Q(product_name__icontains=search) |
            Q(product__name__icontains=search) |
            Q(credit_product__name__icontains=search) |
            Q(product__sku__icontains=search) |
            Q(credit_product__sku__icontains=search)
        )

    qs = qs.order_by('-invoice__created_at', 'product_name')[:50]

    results = []
    for item in qs:
        remaining = item.quantity - (item.returned_quantity or Decimal('0'))
        if remaining <= 0:
            continue
        results.append({
            'invoice_item_id': item.id,
            'invoice_id': item.invoice_id,
            'invoice_number': item.invoice.invoice_number,
            'product_name': item.product_name,
            'catalog_product_id': item.product_id,
            'credit_product_id': item.credit_product_id,
            'sold_unit_price': item.unit_price,
            'sold_quantity': item.quantity,
            'returned_quantity': item.returned_quantity or Decimal('0'),
            'returnable_quantity': remaining,
            'sold_at': item.invoice.created_at,
        })

    return Response(SoldCreditProductSerializer(results, many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def credit_return_list_create(request):
    if request.method == 'GET':
        qs = _credit_returns_filtered_queryset(request)
        try:
            page = max(int(request.query_params.get('page', 1)), 1)
            page_size = min(max(int(request.query_params.get('page_size', 25)), 1), 100)
        except (TypeError, ValueError):
            page, page_size = 1, 25
        total_count = qs.count()
        start = (page - 1) * page_size
        return Response({
            'count': total_count,
            'page': page,
            'page_size': page_size,
            'results': CreditReturnSerializer(qs[start:start + page_size], many=True).data,
        })

    # POST — create return (any product + editable unit price)
    store_id = request.data.get('store')
    if not store_id:
        return Response({'detail': 'store is required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        store = Store.objects.get(pk=store_id)
    except Store.DoesNotExist:
        return Response({'detail': 'Store not found'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        customer = ensure_credit_customer(
            credit_customer_id=request.data.get('credit_customer_id') or request.data.get('customer'),
            parties_customer_id=request.data.get('parties_customer_id'),
        )
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    raw_items = request.data.get('items') or []
    if not raw_items:
        return Response({'detail': 'items are required'}, status=status.HTTP_400_BAD_REQUEST)

    pending = []
    for idx, row in enumerate(raw_items):
        qty = _to_decimal(row.get('quantity', '0'), '0')
        qty_err = _require_whole_quantity(qty)
        if qty_err:
            return Response({'detail': qty_err}, status=status.HTTP_400_BAD_REQUEST)

        unit_price = _to_decimal(row.get('unit_price', '0'), '0')
        if unit_price < 0:
            return Response(
                {'detail': 'Unit prices cannot be negative'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice_item_id = row.get('invoice_item_id')
        if invoice_item_id in (None, ''):
            invoice_item_id = None
        else:
            try:
                invoice_item_id = int(invoice_item_id)
            except (TypeError, ValueError):
                return Response(
                    {'detail': f'Invalid invoice_item_id on item {idx + 1}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        catalog_product_id = row.get('product') or row.get('product_id') or row.get('catalog_product_id')
        credit_product_id = row.get('credit_product') or row.get('credit_product_id')
        try:
            catalog_product_id = int(catalog_product_id) if catalog_product_id not in (None, '') else None
        except (TypeError, ValueError):
            return Response({'detail': f'Invalid product on item {idx + 1}'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            credit_product_id = int(credit_product_id) if credit_product_id not in (None, '') else None
        except (TypeError, ValueError):
            return Response(
                {'detail': f'Invalid credit_product on item {idx + 1}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        product_name = (row.get('product_name') or '').strip()
        pending.append({
            'invoice_item_id': invoice_item_id,
            'catalog_product_id': catalog_product_id,
            'credit_product_id': credit_product_id,
            'product_name': product_name,
            'quantity': qty.to_integral_value(),
            'unit_price': unit_price,
        })

    notes = request.data.get('notes', '') or ''

    try:
        with transaction.atomic():
            customer = CreditCustomer.objects.select_for_update().get(pk=customer.pk)

            return_lines = []
            total = Decimal('0.00')

            for row in pending:
                invoice_item = None
                product = None
                credit_product = None
                product_name = row['product_name']

                if row['invoice_item_id'] is not None:
                    try:
                        invoice_item = CreditInvoiceItem.objects.select_related('invoice').get(
                            pk=row['invoice_item_id']
                        )
                    except CreditInvoiceItem.DoesNotExist:
                        raise ValueError(f'Invoice item {row["invoice_item_id"]} not found')
                    if not product_name:
                        product_name = invoice_item.product_name
                    if row['catalog_product_id'] is None:
                        row['catalog_product_id'] = invoice_item.product_id
                    if row['credit_product_id'] is None:
                        row['credit_product_id'] = invoice_item.credit_product_id

                if row['catalog_product_id'] is not None:
                    try:
                        product = Product.objects.get(pk=row['catalog_product_id'])
                    except Product.DoesNotExist:
                        raise ValueError(f'Product {row["catalog_product_id"]} not found')
                    if not product_name:
                        product_name = product.name

                if row['credit_product_id'] is not None:
                    try:
                        credit_product = CreditProduct.objects.get(
                            pk=row['credit_product_id'], is_active=True
                        )
                    except CreditProduct.DoesNotExist:
                        raise ValueError(f'Credit product {row["credit_product_id"]} not found')
                    if not product_name:
                        product_name = credit_product.name

                if not product_name:
                    raise ValueError('Each return item needs a product name')

                qty = row['quantity']
                unit_price = row['unit_price']
                line_total = (qty * unit_price).quantize(Decimal('0.01'))
                return_lines.append({
                    'invoice_item': invoice_item,
                    'product': product,
                    'credit_product': credit_product,
                    'product_name': product_name,
                    'quantity': qty,
                    'unit_price': unit_price,
                    'line_total': line_total,
                })
                total += line_total

            credit_return = CreditReturn.objects.create(
                return_number=_generate_return_number(),
                store=store,
                customer=customer,
                status='completed',
                total=total,
                notes=notes,
                created_by=request.user,
            )

            for line in return_lines:
                CreditReturnItem.objects.create(
                    credit_return=credit_return,
                    invoice_item=line['invoice_item'],
                    product=line['product'],
                    credit_product=line['credit_product'],
                    product_name=line['product_name'],
                    quantity=line['quantity'],
                    unit_price=line['unit_price'],
                    line_total=line['line_total'],
                )
                inv_item = line['invoice_item']
                if inv_item is not None:
                    inv_item.returned_quantity = F('returned_quantity') + line['quantity']
                    inv_item.save(update_fields=['returned_quantity'])

            CreditLedgerEntry.objects.create(
                customer=customer,
                credit_return=credit_return,
                entry_type='credit',
                amount=total,
                description=f'Credit return {credit_return.return_number}',
                created_by=request.user,
                created_at=credit_return.created_at,
            )
            customer.balance = F('balance') - total
            customer.save(update_fields=['balance', 'updated_at'])

    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    credit_return = CreditReturn.objects.select_related(
        'customer', 'store', 'created_by'
    ).prefetch_related('items__invoice_item__invoice').get(pk=credit_return.pk)
    return Response(CreditReturnSerializer(credit_return).data, status=status.HTTP_201_CREATED)



@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_return_detail(request, pk):
    try:
        credit_return = CreditReturn.objects.select_related(
            'customer', 'store', 'created_by'
        ).prefetch_related('items__invoice_item__invoice').get(pk=pk)
    except CreditReturn.DoesNotExist:
        return Response({'detail': 'Return not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(CreditReturnSerializer(credit_return).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_return_update(request, pk):
    """
    Edit a completed credit return (lines / notes / date) and apply ledger delta.

    Payload mirrors credit invoice update:
      items: [
        {
          id?: int,
          invoice_item_id?: int,
          catalog_product_id?: int,
          credit_product_id?: int,
          product_name?: str,
          quantity: number,
          unit_price: number,
        },
        ...
      ]
      notes?: str
      created_at?: ISO datetime

    Ledger: update the original return credit amount in place and
    customer.balance -= (new_total - old_total).
    Also adjusts CreditInvoiceItem.returned_quantity for linked lines.
    """
    if not _can_manage_credit_records(request.user):
        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        credit_return = CreditReturn.objects.select_related('customer').prefetch_related(
            'items__invoice_item'
        ).get(pk=pk)
    except CreditReturn.DoesNotExist:
        return Response({'detail': 'Return not found'}, status=status.HTTP_404_NOT_FOUND)

    if credit_return.status == 'void':
        return Response({'detail': 'Cannot edit a voided return'}, status=status.HTTP_400_BAD_REQUEST)

    raw_items = request.data.get('items')
    if not isinstance(raw_items, list) or len(raw_items) == 0:
        return Response({'detail': 'At least one item is required'}, status=status.HTTP_400_BAD_REQUEST)

    notes = request.data.get('notes')
    created_at_raw = request.data.get('created_at')
    created_at_override = None
    if created_at_raw not in (None, ''):
        raw_str = str(created_at_raw).strip()
        if raw_str.endswith('Z'):
            raw_str = raw_str[:-1] + '+00:00'
        parsed = parse_datetime(raw_str)
        if parsed is None:
            return Response({'detail': 'Invalid created_at datetime format'}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        created_at_override = parsed

    existing_by_id = {item.id: item for item in credit_return.items.all()}
    kept_ids = set()
    prepared = []

    for idx, row in enumerate(raw_items):
        if not isinstance(row, dict):
            return Response(
                {'detail': f'Item {idx + 1}: invalid payload'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item_id = row.get('id')
        existing = None
        if item_id not in (None, ''):
            try:
                item_id = int(item_id)
            except (TypeError, ValueError):
                return Response(
                    {'detail': f'Item {idx + 1}: invalid id'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            existing = existing_by_id.get(item_id)
            if existing is None:
                return Response(
                    {'detail': f'Item {idx + 1}: line {item_id} not found on this return'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            kept_ids.add(item_id)

        quantity = _to_decimal(row.get('quantity'), '0')
        qty_err = _require_whole_quantity(quantity)
        if qty_err:
            return Response(
                {'detail': f'Item {idx + 1}: {qty_err}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        quantity = quantity.to_integral_value()

        unit_price = _to_decimal(row.get('unit_price'), '0')
        if unit_price < 0:
            return Response(
                {'detail': f'Item {idx + 1}: Unit price cannot be negative'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if unit_price <= 0:
            return Response(
                {'detail': f'Item {idx + 1}: Unit price must be greater than 0'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice_item = existing.invoice_item if existing else None
        invoice_item_id = row.get('invoice_item_id')
        if invoice_item_id not in (None, '') and existing is None:
            try:
                invoice_item = CreditInvoiceItem.objects.select_related('invoice').get(
                    pk=int(invoice_item_id)
                )
            except (TypeError, ValueError, CreditInvoiceItem.DoesNotExist):
                return Response(
                    {'detail': f'Item {idx + 1}: invoice item not found'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        product = existing.product if existing else None
        credit_product = existing.credit_product if existing else None
        product_name = (row.get('product_name') or '').strip()
        if existing and not product_name:
            product_name = existing.product_name

        catalog_product_id = row.get('catalog_product_id') or row.get('product')
        credit_product_id = row.get('credit_product_id') or row.get('credit_product')

        if existing is None:
            if catalog_product_id:
                try:
                    product = Product.objects.only('id', 'name').get(pk=catalog_product_id)
                    product_name = product_name or product.name
                except Product.DoesNotExist:
                    return Response(
                        {'detail': f'Item {idx + 1}: catalog product not found'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            elif credit_product_id:
                try:
                    credit_product = CreditProduct.objects.only('id', 'name').get(pk=credit_product_id)
                    product_name = product_name or credit_product.name
                except CreditProduct.DoesNotExist:
                    return Response(
                        {'detail': f'Item {idx + 1}: credit product not found'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            elif invoice_item is not None:
                product = invoice_item.product
                credit_product = invoice_item.credit_product
                product_name = product_name or invoice_item.product_name

            if not product_name:
                return Response(
                    {'detail': f'Item {idx + 1}: product_name is required'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if invoice_item is not None:
            old_qty = existing.quantity if existing is not None else Decimal('0')
            returned = invoice_item.returned_quantity or Decimal('0')
            # Capacity excluding this return line's current contribution
            available = (invoice_item.quantity or Decimal('0')) - (returned - old_qty)
            if quantity > available:
                return Response(
                    {
                        'detail': (
                            f'Item {idx + 1} ({product_name or invoice_item.product_name}): '
                            f'quantity {quantity} exceeds returnable ({available})'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        line_total = (quantity * unit_price).quantize(Decimal('0.01'))
        prepared.append({
            'existing': existing,
            'invoice_item': invoice_item,
            'product': product,
            'credit_product': credit_product,
            'product_name': product_name,
            'quantity': quantity,
            'unit_price': unit_price,
            'line_total': line_total,
        })

    new_total = sum((p['line_total'] for p in prepared), Decimal('0.00')).quantize(Decimal('0.01'))
    if new_total <= 0:
        return Response({'detail': 'Return total must be greater than 0'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        credit_return = CreditReturn.objects.select_for_update().select_related('customer').get(pk=pk)
        if credit_return.status == 'void':
            return Response({'detail': 'Cannot edit a voided return'}, status=status.HTTP_400_BAD_REQUEST)

        customer = CreditCustomer.objects.select_for_update().get(pk=credit_return.customer_id)
        old_total = credit_return.total or Decimal('0.00')
        total_delta = (new_total - old_total).quantize(Decimal('0.01'))
        # Returns credit the customer (reduce balance)
        balance_delta = -total_delta

        # Undo returned_quantity for removed linked lines
        for item_id, item in existing_by_id.items():
            if item_id not in kept_ids and item.invoice_item_id:
                inv_item = CreditInvoiceItem.objects.select_for_update().get(pk=item.invoice_item_id)
                inv_item.returned_quantity = max(
                    Decimal('0'),
                    (inv_item.returned_quantity or Decimal('0')) - (item.quantity or Decimal('0')),
                )
                inv_item.save(update_fields=['returned_quantity'])
                item.delete()
            elif item_id not in kept_ids:
                item.delete()

        for p in prepared:
            existing = p['existing']
            invoice_item = p['invoice_item']
            if existing is not None:
                old_qty = existing.quantity or Decimal('0')
                new_qty = p['quantity']
                if invoice_item is not None and new_qty != old_qty:
                    inv_item = CreditInvoiceItem.objects.select_for_update().get(pk=invoice_item.pk)
                    inv_item.returned_quantity = (inv_item.returned_quantity or Decimal('0')) + (new_qty - old_qty)
                    if inv_item.returned_quantity < 0:
                        inv_item.returned_quantity = Decimal('0')
                    inv_item.save(update_fields=['returned_quantity'])

                existing.product = p['product']
                existing.credit_product = p['credit_product']
                existing.product_name = p['product_name']
                existing.quantity = p['quantity']
                existing.unit_price = p['unit_price']
                existing.line_total = p['line_total']
                existing.save()
            else:
                CreditReturnItem.objects.create(
                    credit_return=credit_return,
                    invoice_item=invoice_item,
                    product=p['product'],
                    credit_product=p['credit_product'],
                    product_name=p['product_name'],
                    quantity=p['quantity'],
                    unit_price=p['unit_price'],
                    line_total=p['line_total'],
                )
                if invoice_item is not None:
                    inv_item = CreditInvoiceItem.objects.select_for_update().get(pk=invoice_item.pk)
                    inv_item.returned_quantity = (inv_item.returned_quantity or Decimal('0')) + p['quantity']
                    inv_item.save(update_fields=['returned_quantity'])

        credit_return.total = new_total
        update_fields = ['total', 'updated_at']
        if notes is not None:
            credit_return.notes = str(notes)
            update_fields.append('notes')
        if created_at_override is not None:
            credit_return.created_at = created_at_override
            update_fields.append('created_at')
        credit_return.save(update_fields=update_fields)

        return_credit = (
            CreditLedgerEntry.objects.filter(
                credit_return=credit_return,
                entry_type='credit',
                payment__isnull=True,
                invoice__isnull=True,
            )
            .order_by('id')
            .first()
        )
        if return_credit:
            return_credit.amount = new_total
            return_credit.description = f'Credit return {credit_return.return_number}'
            credit_fields = ['amount', 'description']
            if created_at_override is not None:
                return_credit.created_at = created_at_override
                credit_fields.append('created_at')
            return_credit.save(update_fields=credit_fields)
        else:
            CreditLedgerEntry.objects.create(
                customer=customer,
                credit_return=credit_return,
                entry_type='credit',
                amount=new_total,
                description=f'Credit return {credit_return.return_number}',
                created_by=request.user,
                created_at=credit_return.created_at,
            )
            # Missing credit was not in balance — apply full credit, not just delta
            balance_delta = -new_total

        if balance_delta != 0:
            customer.balance = F('balance') + balance_delta
            customer.save(update_fields=['balance', 'updated_at'])

    credit_return = CreditReturn.objects.select_related(
        'customer', 'store', 'created_by'
    ).prefetch_related('items__invoice_item__invoice').get(pk=pk)
    data = CreditReturnSerializer(credit_return).data
    data['ledger_delta'] = str(balance_delta)
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def credit_return_void(request, pk):
    """
    Void a completed credit return: reverse ledger credit, restore customer balance,
    and undo returned_quantity on linked invoice lines.
    """
    if not _can_manage_credit_records(request.user):
        return Response({'detail': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        credit_return = CreditReturn.objects.select_related('customer').prefetch_related(
            'items'
        ).get(pk=pk)
    except CreditReturn.DoesNotExist:
        return Response({'detail': 'Return not found'}, status=status.HTTP_404_NOT_FOUND)

    if credit_return.status == 'void':
        return Response({'detail': 'Return already voided'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        credit_return = CreditReturn.objects.select_for_update().select_related('customer').get(pk=pk)
        if credit_return.status == 'void':
            return Response({'detail': 'Return already voided'}, status=status.HTTP_400_BAD_REQUEST)

        customer = CreditCustomer.objects.select_for_update().get(pk=credit_return.customer_id)
        amount = credit_return.total or Decimal('0.00')

        for item in credit_return.items.all():
            if item.invoice_item_id:
                inv_item = CreditInvoiceItem.objects.select_for_update().get(pk=item.invoice_item_id)
                inv_item.returned_quantity = max(
                    Decimal('0'),
                    (inv_item.returned_quantity or Decimal('0')) - (item.quantity or Decimal('0')),
                )
                inv_item.save(update_fields=['returned_quantity'])

        # Reverse the original return credit with a debit
        CreditLedgerEntry.objects.create(
            customer=customer,
            credit_return=credit_return,
            entry_type='debit',
            amount=amount,
            description=f'Void credit return {credit_return.return_number}',
            created_by=request.user,
        )
        customer.balance = F('balance') + amount
        customer.save(update_fields=['balance', 'updated_at'])

        credit_return.status = 'void'
        credit_return.save(update_fields=['status', 'updated_at'])

    credit_return = CreditReturn.objects.select_related(
        'customer', 'store', 'created_by'
    ).prefetch_related('items__invoice_item__invoice').get(pk=pk)
    return Response(CreditReturnSerializer(credit_return).data)


# ── Payments ────────────────────────────────────────────────────────────────

def _payment_method_label(method: str) -> str:
    return dict(CreditPayment.PAYMENT_METHOD_CHOICES).get(method, method)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def credit_payment_list_create(request):
    if request.method == 'GET':
        qs = CreditPayment.objects.select_related('customer', 'created_by').all()
        customer_id = request.query_params.get('customer') or request.query_params.get('credit_customer_id')
        if customer_id:
            qs = qs.filter(customer_id=customer_id)
        qs = qs.order_by('-paid_at')
        try:
            page = max(int(request.query_params.get('page', 1)), 1)
            page_size = min(max(int(request.query_params.get('page_size', 50)), 1), 200)
        except (TypeError, ValueError):
            page, page_size = 1, 50
        total_count = qs.count()
        start = (page - 1) * page_size
        return Response({
            'count': total_count,
            'page': page,
            'page_size': page_size,
            'results': CreditPaymentSerializer(qs[start:start + page_size], many=True).data,
        })

    # POST — record payment against credit customer
    try:
        customer = ensure_credit_customer(
            credit_customer_id=request.data.get('credit_customer_id') or request.data.get('customer'),
            parties_customer_id=request.data.get('parties_customer_id'),
        )
    except ValueError as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    method = (request.data.get('payment_method') or '').strip().lower()
    if method not in dict(CreditPayment.PAYMENT_METHOD_CHOICES):
        return Response(
            {'detail': 'payment_method must be cash, upi, or mixed'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    cash_amount = None
    upi_amount = None
    if method == 'cash':
        amount = _to_decimal(request.data.get('amount') or request.data.get('cash_amount'), '0')
        cash_amount = amount
        upi_amount = Decimal('0.00')
    elif method == 'upi':
        amount = _to_decimal(request.data.get('amount') or request.data.get('upi_amount'), '0')
        upi_amount = amount
        cash_amount = Decimal('0.00')
    else:  # mixed
        cash_amount = _to_decimal(request.data.get('cash_amount'), '0')
        upi_amount = _to_decimal(request.data.get('upi_amount'), '0')
        if 'amount' in request.data and request.data.get('amount') not in (None, ''):
            amount = _to_decimal(request.data.get('amount'), '0')
            expected = (cash_amount + upi_amount).quantize(Decimal('0.01'))
            if amount.quantize(Decimal('0.01')) != expected:
                return Response(
                    {'detail': f'amount ({amount}) must equal cash_amount + upi_amount ({expected})'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            amount = (cash_amount + upi_amount).quantize(Decimal('0.01'))

    if amount <= 0:
        return Response({'detail': 'Payment amount must be greater than 0'}, status=status.HTTP_400_BAD_REQUEST)
    if cash_amount is not None and cash_amount < 0:
        return Response({'detail': 'cash_amount cannot be negative'}, status=status.HTTP_400_BAD_REQUEST)
    if upi_amount is not None and upi_amount < 0:
        return Response({'detail': 'upi_amount cannot be negative'}, status=status.HTTP_400_BAD_REQUEST)

    notes = request.data.get('notes', '') or ''
    paid_at_raw = request.data.get('paid_at')
    if paid_at_raw:
        paid_at = parse_datetime(str(paid_at_raw)) if isinstance(paid_at_raw, str) else paid_at_raw
        if paid_at is None:
            return Response({'detail': 'Invalid paid_at'}, status=status.HTTP_400_BAD_REQUEST)
        if timezone.is_naive(paid_at):
            paid_at = timezone.make_aware(paid_at, timezone.get_current_timezone())
    else:
        paid_at = timezone.now()

    with transaction.atomic():
        customer = CreditCustomer.objects.select_for_update().get(pk=customer.pk)
        payment = CreditPayment.objects.create(
            customer=customer,
            payment_method=method,
            amount=amount,
            cash_amount=cash_amount,
            upi_amount=upi_amount,
            notes=notes,
            paid_at=paid_at,
            created_by=request.user,
        )

        parts = [f'Payment ({_payment_method_label(method)})']
        if method == 'mixed':
            parts.append(f'cash ₹{cash_amount} + UPI ₹{upi_amount}')
        if notes:
            parts.append(notes)
        description = ' — '.join(parts)

        CreditLedgerEntry.objects.create(
            customer=customer,
            payment=payment,
            entry_type='credit',
            amount=amount,
            description=description,
            created_by=request.user,
            created_at=payment.paid_at,
        )
        customer.balance = F('balance') - amount
        customer.save(update_fields=['balance', 'updated_at'])
        customer.refresh_from_db(fields=['balance', 'next_follow_up_date', 'collection_reason'])
        auto_bump_follow_up_after_payment(customer, user=request.user)

    payment = CreditPayment.objects.select_related('customer', 'created_by').get(pk=payment.pk)
    data = CreditPaymentSerializer(payment).data
    data['customer_balance'] = customer.balance
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_payment_detail(request, pk):
    try:
        payment = CreditPayment.objects.select_related('customer', 'created_by').get(pk=pk)
    except CreditPayment.DoesNotExist:
        return Response({'detail': 'Payment not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response(CreditPaymentSerializer(payment).data)
