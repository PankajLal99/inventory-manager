import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export async function sharePdf(html: string, filename = 'document') {
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    UTI: '.pdf',
    mimeType: 'application/pdf',
    dialogTitle: `Share ${filename}`,
  });
}

export function invoicePdfHtml(invoice: any): string {
  const items = invoice.items || [];
  const rows = items
    .map(
      (item: any, i: number) =>
        `<tr>
          <td>${i + 1}</td>
          <td>${item.product_name || ''}</td>
          <td style="text-align:center">${item.quantity}</td>
          <td style="text-align:right">₹${Number(item.unit_price || 0).toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${Number(item.total || item.quantity * item.unit_price || 0).toLocaleString('en-IN')}</td>
        </tr>`,
    )
    .join('');

  const total = invoice.totals?.total ?? invoice.total ?? 0;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: sans-serif; padding: 20px; font-size: 14px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; }
  th { background: #f5f5f5; text-align: left; }
  .total { font-weight: bold; font-size: 16px; margin-top: 12px; text-align: right; }
  .info { color: #666; font-size: 12px; }
</style></head><body>
  <h1>Invoice #${invoice.invoice_number || ''}</h1>
  <p class="info">Date: ${invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : ''}</p>
  <p class="info">Customer: ${invoice.customer?.name || 'Walk-in'}</p>
  <p class="info">Store: ${invoice.store?.name || ''}</p>
  <p class="info">Type: ${(invoice.invoice_type || '').toUpperCase()}</p>
  <table>
    <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Total: ₹${Number(total).toLocaleString('en-IN')}</p>
</body></html>`;
}
