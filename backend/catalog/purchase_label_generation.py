"""
Purchase-scoped label generation: one bulk Azure queue per purchase instead of N per-product calls.
"""
import logging
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

def _serial_number_from_barcode(barcode_value: Optional[str]) -> Optional[str]:
    if not barcode_value:
        return None
    parts = barcode_value.split('-')
    if len(parts) >= 4:
        return '-'.join(parts[-2:])
    if len(parts) >= 3:
        return parts[-1]
    return None


def _label_image_is_valid(label_image: Optional[str]) -> bool:
    if not label_image or not str(label_image).strip():
        return False
    img = str(label_image).strip()
    return img.startswith('data:image') or img.startswith('https://')


def generate_labels_for_purchase(purchase_id: int) -> Dict[str, Any]:
    """
    Queue/generate labels for all printable barcodes on a purchase in chunked bulk requests.
    Idempotent: skips barcodes that already have a valid label image.
    """
    from backend.catalog.models import Barcode, BarcodeLabel
    from backend.purchasing.models import Purchase

    try:
        purchase = Purchase.objects.select_related('supplier').get(pk=purchase_id)
    except Purchase.DoesNotExist:
        return {'queued': 0, 'skipped': 0, 'total': 0, 'error': 'Purchase not found'}

    barcodes = list(
        Barcode.objects.filter(purchase_id=purchase_id)
        .exclude(tag__in=['sold', 'defective'])
        .select_related('product', 'purchase', 'purchase__supplier')
    )
    if not barcodes:
        return {'queued': 0, 'skipped': 0, 'total': 0, 'purchase_id': purchase_id}

    existing_labels = {
        label.barcode_id: label
        for label in BarcodeLabel.objects.filter(barcode_id__in=[b.id for b in barcodes])
    }

    vendor_name = purchase.supplier.qr_label_vendor() if purchase.supplier else None
    purchase_date = purchase.purchase_date.strftime('%d-%m-%Y') if purchase.purchase_date else None

    barcodes_to_queue: List[Dict[str, Any]] = []
    skipped = 0

    for barcode in barcodes:
        label_obj = existing_labels.get(barcode.id)
        if _label_image_is_valid(label_obj.label_image if label_obj else None):
            skipped += 1
            continue

        product_name = barcode.product.name if barcode.product else 'Unknown'
        display_code = (barcode.short_code if hasattr(barcode, 'short_code') else None) or barcode.barcode
        barcodes_to_queue.append({
            'product_name': product_name,
            'barcode_value': display_code,
            'short_code': barcode.short_code if hasattr(barcode, 'short_code') else None,
            'barcode_id': barcode.id,
            'vendor_name': vendor_name,
            'purchase_date': purchase_date,
            'serial_number': _serial_number_from_barcode(barcode.barcode),
        })

    if not barcodes_to_queue:
        return {
            'queued': 0,
            'skipped': skipped,
            'total': len(barcodes),
            'purchase_id': purchase_id,
        }

    from backend.catalog.azure_label_service import queue_bulk_label_generation_via_azure

    blob_urls = queue_bulk_label_generation_via_azure(barcodes_to_queue)

    queued = 0
    for item in barcodes_to_queue:
        barcode_id = item['barcode_id']
        blob_url = blob_urls.get(barcode_id)
        if blob_url:
            BarcodeLabel.objects.update_or_create(
                barcode_id=barcode_id,
                defaults={'label_image': blob_url},
            )
            queued += 1

    # Azure not configured or URLs missing: local fallback for remaining
    if queued < len(barcodes_to_queue):
        from backend.catalog.label_generator import generate_label_image

        for item in barcodes_to_queue:
            barcode_id = item['barcode_id']
            if blob_urls.get(barcode_id):
                continue
            try:
                display_code = item.get('short_code') or item['barcode_value']
                image_data_url = generate_label_image(
                    product_name=item['product_name'],
                    barcode_value=display_code,
                    sku=display_code,
                    vendor_name=item.get('vendor_name'),
                    purchase_date=item.get('purchase_date'),
                    serial_number=item.get('serial_number'),
                )
                BarcodeLabel.objects.update_or_create(
                    barcode_id=barcode_id,
                    defaults={'label_image': image_data_url},
                )
                queued += 1
            except Exception as exc:
                logger.warning('Local label fallback failed for barcode %s: %s', barcode_id, exc)

    return {
        'queued': queued,
        'skipped': skipped,
        'total': len(barcodes),
        'purchase_id': purchase_id,
    }


def schedule_generate_labels_for_purchase(purchase_id: int) -> None:
    """Fire-and-forget label generation for a purchase (used after save)."""
    if not purchase_id:
        return

    def _run():
        try:
            result = generate_labels_for_purchase(purchase_id)
            logger.info(
                'Purchase %s label generation: queued=%s skipped=%s total=%s',
                purchase_id,
                result.get('queued'),
                result.get('skipped'),
                result.get('total'),
            )
        except Exception:
            logger.exception('Background label generation failed for purchase %s', purchase_id)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
