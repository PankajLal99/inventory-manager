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

from .models import (
    CreditCart,
    CreditCartItem,
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


def _require_whole_quantity(qty: Decimal):
    """Credit qty matches POS: whole units only (no fractional pcs)."""
    if qty <= 0:
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
        qs = CreditCustomer.objects.filter(is_active=True).select_related('customer_group', 'linked_customer')
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
    quantity = _to_decimal(request.data.get('quantity', '1'), '1')
    # Qty and price are always cart-driven — never take cost/price from product master data.
    unit_price = _to_decimal(request.data.get('unit_price', '0'), '0')

    qty_err = _require_whole_quantity(quantity)
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
        qty_err = _require_whole_quantity(qty)
        if qty_err:
            return Response({'detail': qty_err}, status=status.HTTP_400_BAD_REQUEST)
        item.quantity = qty.to_integral_value()
    if 'unit_price' in request.data:
        item.unit_price = _to_decimal(request.data.get('unit_price'), str(item.unit_price))
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
    created_at = request.data.get('created_at')

    for item in items:
        if item.unit_price < 0:
            return Response({'detail': 'Unit prices cannot be negative'}, status=status.HTTP_400_BAD_REQUEST)
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
        if created_at:
            invoice_kwargs['created_at'] = created_at

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

    return qs.order_by('-created_at')


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

    return qs.filter(status='completed').order_by('-created_at')


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
    returns_total = return_qs.aggregate(
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
def credit_invoice_void(request, pk):
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

    base = CreditLedgerEntry.objects.filter(customer_id=customer.id).select_related(
        'invoice', 'credit_return', 'payment', 'created_by'
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
        return (today - last_payment_at.date()).days
    if last_sale_at:
        return (today - last_sale_at.date()).days
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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def credit_ledger_by_customer(request):
    """Summary list of credit customers with balances and collection status (ledger index)."""
    search = request.query_params.get('search', '').strip()
    only_with_balance = (request.query_params.get('with_balance') or '').strip().lower()

    latest_desc = (
        CreditLedgerEntry.objects.filter(customer_id=OuterRef('pk'))
        .order_by('-created_at', '-id')
        .values('description')[:1]
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
        .order_by('-created_at')
        .values('created_at')[:1]
    )

    qs = CreditCustomer.objects.filter(is_active=True).select_related(
        'customer_group',
        'linked_customer',
    ).annotate(
        total_debit=Coalesce(
            Sum(
                Case(
                    When(ledger_entries__entry_type='debit', then=F('ledger_entries__amount')),
                    default=Value(Decimal('0')),
                )
            ),
            Decimal('0'),
        ),
        total_credit=Coalesce(
            Sum(
                Case(
                    When(ledger_entries__entry_type='credit', then=F('ledger_entries__amount')),
                    default=Value(Decimal('0')),
                )
            ),
            Decimal('0'),
        ),
        entry_count=Count('ledger_entries', distinct=True),
        latest_description=Subquery(latest_desc),
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

    qs = qs.order_by('name')[:200]

    out = []
    for row in qs:
        balance = row.balance or Decimal('0')
        days_since = _credit_days_since_last_payment(row.last_payment_at, row.last_sale_at)
        collection_status = _credit_collection_status(balance, days_since)
        total_debit = row.total_debit or Decimal('0')
        total_credit = row.total_credit or Decimal('0')
        out.append({
            'id': row.id,
            'name': row.name,
            'phone': row.phone or '',
            'customer_group_id': row.customer_group_id,
            'customer_group_name': row.customer_group.name if row.customer_group_id else '',
            'balance': str(balance),
            'total_debit': str(total_debit),
            'total_credit': str(total_credit),
            'net_amount': str(total_debit - total_credit),
            'entry_count': row.entry_count or 0,
            'latest_description': row.latest_description or '',
            'last_payment_at': row.last_payment_at.isoformat() if row.last_payment_at else None,
            'days_since_last_payment': days_since,
            'collection_status': collection_status,
        })
    return Response(out)


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

    # POST — create return
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

    # Normalize + validate before locking
    pending = []
    for row in raw_items:
        try:
            invoice_item_id = int(row.get('invoice_item_id'))
        except (TypeError, ValueError):
            return Response({'detail': 'Each item needs invoice_item_id'}, status=status.HTTP_400_BAD_REQUEST)
        qty = _to_decimal(row.get('quantity', '0'), '0')
        qty_err = _require_whole_quantity(qty)
        if qty_err:
            return Response({'detail': qty_err}, status=status.HTTP_400_BAD_REQUEST)
        pending.append((invoice_item_id, qty.to_integral_value()))

    notes = request.data.get('notes', '') or ''

    try:
        with transaction.atomic():
            customer = CreditCustomer.objects.select_for_update().get(pk=customer.pk)

            # Lock invoice items in stable id order to avoid deadlocks
            item_ids = sorted({iid for iid, _ in pending})
            locked = {
                i.id: i
                for i in CreditInvoiceItem.objects.select_for_update()
                .select_related('invoice')
                .filter(id__in=item_ids)
            }

            return_lines = []
            total = Decimal('0.00')

            for invoice_item_id, qty in pending:
                item = locked.get(invoice_item_id)
                if not item:
                    raise ValueError(f'Invoice item {invoice_item_id} not found')
                if item.invoice.status != 'open':
                    raise ValueError(f'Invoice {item.invoice.invoice_number} is not open')
                if item.invoice.customer_id != customer.id:
                    raise ValueError(
                        f'Invoice item {invoice_item_id} does not belong to this customer'
                    )
                remaining = item.quantity - (item.returned_quantity or Decimal('0'))
                if qty > remaining:
                    raise ValueError(
                        f'Cannot return {qty} of "{item.product_name}" — only {remaining} left '
                        f'(sold {item.quantity} on {item.invoice.invoice_number})'
                    )

                line_total = (qty * item.unit_price).quantize(Decimal('0.01'))
                return_lines.append({
                    'invoice_item': item,
                    'product_name': item.product_name,
                    'quantity': qty,
                    'unit_price': item.unit_price,
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
                    product_name=line['product_name'],
                    quantity=line['quantity'],
                    unit_price=line['unit_price'],
                    line_total=line['line_total'],
                )
                inv_item = line['invoice_item']
                inv_item.returned_quantity = F('returned_quantity') + line['quantity']
                inv_item.save(update_fields=['returned_quantity'])

            CreditLedgerEntry.objects.create(
                customer=customer,
                credit_return=credit_return,
                entry_type='credit',
                amount=total,
                description=f'Credit return {credit_return.return_number}',
                created_by=request.user,
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
        customer.refresh_from_db(fields=['balance'])

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
