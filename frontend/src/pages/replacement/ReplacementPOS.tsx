import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, FileText, ScanLine, Trash2, User } from 'lucide-react';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import { auth } from '../../lib/auth';
import { catalogApi, customersApi, posApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';

type ReturnTag = 'returned' | 'unknown' | 'defective';
type ReplacementMode = 'instant' | 'pending';

interface ReplacementScanLine {
  invoice_item_id: number;
  source_invoice_id: number;
  source_invoice_number: string;
  source_customer: number | null;
  source_customer_name: string;
  product: number;
  product_name: string;
  product_sku: string;
  barcode: string;
  sold_barcode_value: string;
  sold_unit_price: string;
  sold_line_total: string;
  accepted_return_price: string;
  return_tag: ReturnTag;
}

const returnTagStyles: Record<ReturnTag, string> = {
  returned: 'bg-green-100 text-green-700 border-green-300',
  unknown: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  defective: 'bg-red-100 text-red-700 border-red-300',
};

export default function ReplacementPOS() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const user = auth.getUser();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [replacementMode, setReplacementMode] = useState<ReplacementMode>('instant');
  const [selectedStoreId, setSelectedStoreId] = useState<number | ''>(user?.default_store?.id ?? '');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | ''>('');
  const [customerAutoFilled, setCustomerAutoFilled] = useState(false);
  const [items, setItems] = useState<ReplacementScanLine[]>([]);
  const [notes, setNotes] = useState('');

  const { data: storesData } = useQuery({
    queryKey: ['stores'],
    queryFn: () => catalogApi.stores.list(),
    retry: false,
  });
  const stores = storesData?.data || [];

  const { data: customersData } = useQuery({
    queryKey: ['replacement-pos-customers'],
    queryFn: () => customersApi.list({ page_size: 200 }),
    retry: false,
  });
  const customers = (customersData?.data?.results ?? customersData?.data ?? []) as any[];

  const mixedCustomerWarning = useMemo(() => {
    const sourceIds = new Set(items.map((item) => `${item.source_customer ?? 'none'}:${item.source_customer_name || ''}`));
    return sourceIds.size > 1;
  }, [items]);

  const totalAccepted = useMemo(
    () => items.reduce((sum, item) => sum + (parseFloat(item.accepted_return_price) || 0), 0),
    [items]
  );

  const scanMutation = useMutation({
    mutationFn: (barcode: string) => posApi.replacementPos.lookup(barcode),
    onSuccess: (response) => {
      const raw = response.data?.item;
      if (!raw) return;
      const normalizedBarcode = String(raw.sold_barcode_value || raw.barcode || '').trim().toUpperCase();
      if (items.some((item) => String(item.sold_barcode_value || item.barcode).trim().toUpperCase() === normalizedBarcode)) {
        alert(`Barcode ${normalizedBarcode} is already added to this invoice.`);
        return;
      }
      const line: ReplacementScanLine = {
        ...raw,
        accepted_return_price: String(raw.sold_unit_price || ''),
        return_tag: (raw.return_tag || 'returned') as ReturnTag,
      };
      setItems((prev) => [...prev, line]);
      if (!customerAutoFilled && raw.source_customer) {
        setSelectedCustomerId(raw.source_customer);
        setCustomerAutoFilled(true);
      }
      setBarcodeInput('');
      searchInputRef.current?.focus();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.response?.data?.message || 'Failed to scan sold barcode';
      alert(message);
      searchInputRef.current?.focus();
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => posApi.replacementPos.create(payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      const invoiceId = response.data?.invoice?.id;
      if (invoiceId) navigate(`/invoices/${invoiceId}`);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.response?.data?.message || 'Failed to create Replacement POS invoice';
      alert(message);
    },
  });

  const handleScan = () => {
    const trimmed = barcodeInput.trim();
    if (!trimmed) return;
    scanMutation.mutate(trimmed);
  };

  const updateItem = (index: number, patch: Partial<ReplacementScanLine>) => {
    setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = () => {
    if (!selectedStoreId) {
      alert('Please select a store.');
      return;
    }
    if (items.length === 0) {
      alert('Scan at least one sold barcode.');
      return;
    }

    for (const item of items) {
      const accepted = parseFloat(item.accepted_return_price);
      const sold = parseFloat(item.sold_unit_price);
      if (!Number.isFinite(accepted) || accepted <= 0) {
        alert(`Enter a valid return price for ${item.product_name}.`);
        return;
      }
      if (accepted > sold) {
        alert(`Return price for ${item.product_name} cannot exceed sold price (₹${formatNumber(sold)}).`);
        return;
      }
    }

    const createdAt = `${invoiceDate}T${new Date().toTimeString().slice(0, 8)}`;
    createMutation.mutate({
      store: selectedStoreId,
      customer: selectedCustomerId || null,
      replacement_mode: replacementMode,
      created_at: createdAt,
      notes,
      items: items.map((item) => ({
        invoice_item_id: item.invoice_item_id,
        barcode: item.barcode,
        sold_barcode_value: item.sold_barcode_value,
        return_tag: item.return_tag,
        accepted_return_price: item.accepted_return_price,
      })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Replacement POS</h1>
          <p className="text-sm text-gray-600 mt-1">
            Scan already sold barcodes, capture return price, and create an instant or pending replacement-return invoice.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/replacement')}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      <Card>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
              <Input
                ref={searchInputRef}
                label="Scan sold barcode"
                placeholder="Scan or enter sold barcode"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleScan();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="block w-full px-3 py-2.5 border rounded-lg shadow-sm border-gray-300"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleScan} className="w-full" disabled={scanMutation.isPending}>
                <ScanLine className="h-4 w-4" />
                {scanMutation.isPending ? 'Scanning...' : 'Add Barcode'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Store</label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value ? Number(e.target.value) : '')}
                className="block w-full px-3 py-2.5 border rounded-lg shadow-sm border-gray-300 bg-white"
              >
                <option value="">Select store</option>
                {stores.map((store: any) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value ? Number(e.target.value) : '')}
                className="block w-full px-3 py-2.5 border rounded-lg shadow-sm border-gray-300 bg-white"
              >
                <option value="">Walk-in / No customer</option>
                {customers.map((customer: any) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Replacement invoice type</label>
              <select
                value={replacementMode}
                onChange={(e) => setReplacementMode(e.target.value as ReplacementMode)}
                className="block w-full px-3 py-2.5 border rounded-lg shadow-sm border-gray-300 bg-white"
              >
                <option value="instant">Instant</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Accepted total</label>
              <div className="h-[42px] rounded-lg border border-gray-300 bg-gray-50 px-3 flex items-center font-semibold text-blue-700">
                ₹{formatNumber(totalAccepted)}
              </div>
            </div>
          </div>

          <Input
            label="Notes"
            placeholder="Optional notes for this replacement invoice"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {mixedCustomerWarning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                Scanned items belong to different original customers/invoices. Checkout is still allowed, but please confirm the selected customer is correct.
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Scanned sold items</h2>
            <span className="text-sm text-gray-500">{items.length} item(s)</span>
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              Scan a sold barcode to start the replacement invoice.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, index) => {
                const soldPrice = parseFloat(item.sold_unit_price) || 0;
                return (
                  <div key={`${item.invoice_item_id}-${item.sold_barcode_value}`} className="rounded-xl border border-gray-200 p-4 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-gray-900">{item.product_name || 'Item'}</div>
                        <div className="text-xs text-gray-500 mt-1">{item.product_sku || '-'}</div>
                        <div className="text-xs text-gray-600 mt-1">Barcode: {item.barcode || item.sold_barcode_value}</div>
                        <div className="text-xs text-gray-600">Source invoice: {item.source_invoice_number}</div>
                        <div className="text-xs text-gray-600">Original customer: {item.source_customer_name || 'Walk-in Customer'}</div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Sold price</label>
                        <div className="h-[42px] rounded-lg border border-gray-300 bg-gray-50 px-3 flex items-center font-medium text-gray-900">
                          ₹{formatNumber(soldPrice)}
                        </div>
                      </div>
                      <div>
                        <Input
                          label="Accepted return price"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.accepted_return_price}
                          onChange={(e) => updateItem(index, { accepted_return_price: e.target.value })}
                        />
                        <p className="text-xs text-gray-500 mt-1">Must be greater than 0 and not more than sold price.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-2">Return condition</label>
                        <div className="flex flex-wrap gap-2">
                          {(['returned', 'unknown', 'defective'] as ReturnTag[]).map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => updateItem(index, { return_tag: tag })}
                              className={`px-3 py-2 rounded-full border text-sm font-medium capitalize ${item.return_tag === tag ? returnTagStyles[tag] : 'bg-white text-gray-600 border-gray-300'}`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6 flex flex-col sm:flex-row gap-3 justify-end">
          <Button variant="outline" onClick={() => setItems([])} disabled={items.length === 0 || createMutation.isPending}>
            Clear Items
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || items.length === 0}>
            {replacementMode === 'pending' ? <FileText className="h-4 w-4" /> : <User className="h-4 w-4" />}
            {createMutation.isPending
              ? 'Saving...'
              : replacementMode === 'pending'
                ? 'Create Pending Replacement Invoice'
                : 'Create Instant Replacement Invoice'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
