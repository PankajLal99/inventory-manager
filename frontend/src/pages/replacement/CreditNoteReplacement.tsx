import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { posApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import BarcodeScanner from '../../components/BarcodeScanner';
import Card from '../../components/ui/Card';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { Search, Camera, AlertTriangle, Plus, Minus, FileText, ArrowLeft, Receipt, ListOrdered, X } from 'lucide-react';

interface InvoiceItem {
  id: number;
  product: number;
  product_name: string;
  product_sku: string;
  product_track_inventory: boolean;
  quantity: string;
  available_quantity: number;
  unit_price: string;
  manual_unit_price?: string | null;
  line_total: string;
  barcode_id?: number;
  barcode_value?: string;
  barcode_full?: string;
}

interface Invoice {
  id: number;
  invoice_number: string;
  customer_name?: string;
  store_name?: string;
  created_at: string;
  items: InvoiceItem[];
  total: string;
  store?: number;
}

export default function CreditNoteReplacement() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [selectedItems, setSelectedItems] = useState<Record<number, number>>({}); // item_id -> quantity
  const [itemTags, setItemTags] = useState<Record<number, 'returned' | 'defective' | 'unknown'>>({}); // item_id -> status
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const [notes, setNotes] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkCheckResult, setBulkCheckResult] = useState<{
    valid: boolean;
    error?: string;
    customers?: Array<{ id: number; name: string }>;
    processable?: Array<{ barcode: string; barcode_full?: string | null; short_code?: string | null; invoice_id: number; invoice_number: string; item_id: number; product_name: string; customer_name: string }>;
    fresh_processable?: Array<{ barcode: string; barcode_id: number; barcode_full?: string | null; short_code?: string | null; product_name: string; tag?: string | null }>;
    skipped?: Array<{ barcode: string; barcode_full?: string | null; short_code?: string | null; reason: 'not_found' | 'not_sold' | 'different_customer'; current_tag?: string | null }>;
  } | null>(null);
  const [bulkCheckLoading, setBulkCheckLoading] = useState(false);
  const [bulkApplyLoading, setBulkApplyLoading] = useState(false);
  const [bulkReturnTag, setBulkReturnTag] = useState<'returned' | 'defective' | 'unknown' | ''>('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Toast helper function
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Search invoices by partial invoice number
  const searchInvoicesQuery = useQuery({
    queryKey: ['search-invoices', searchValue],
    queryFn: async () => {
      if (!searchValue.trim() || searchValue.trim().length < 2) return { invoices: [] };
      try {
        const response = await posApi.replacement.searchInvoices(searchValue.trim());
        return response.data;
      } catch (error) {
        return { invoices: [] };
      }
    },
    enabled: searchValue.trim().length >= 2,
    retry: false,
  });

  // Helper to apply invoice result (used by search and barcode scan)
  const applyInvoiceResult = (foundInvoice: Invoice, searchBarcode: string) => {
    setInvoice(foundInvoice);
    setSearchError(null);
    setSearchValue('');
    const initialSelected: Record<number, number> = {};
    foundInvoice.items.forEach((item: InvoiceItem) => {
      const itemBarcode = item.barcode_value?.toUpperCase() || '';
      const itemBarcodeFull = item.barcode_full?.toUpperCase() || '';
      const searchUpper = searchBarcode.toUpperCase();
      if (itemBarcode === searchUpper || itemBarcodeFull === searchUpper) {
        initialSelected[item.id] = Math.min(1, item.available_quantity);
      } else {
        initialSelected[item.id] = 0;
      }
    });
    setSelectedItems(initialSelected);
    setItemTags({});
  };

  // Find invoice by barcode/SKU or invoice number (fetches only - no side effects on success)
  const findInvoiceQuery = useQuery({
    queryKey: ['find-invoice', searchValue],
    queryFn: async () => {
      if (!searchValue.trim()) return null;
      try {
        const isInvoiceNumber = /^[A-Z0-9-]+$/i.test(searchValue.trim()) && searchValue.trim().length >= 3;

        const response = await posApi.replacement.findInvoiceByBarcode({
          barcode: isInvoiceNumber ? undefined : searchValue.trim(),
          sku: isInvoiceNumber ? undefined : searchValue.trim(),
          invoice_number: isInvoiceNumber ? searchValue.trim() : undefined,
        });
        if (response.data?.invoice) {
          return response.data;
        }
        return null;
      } catch (error: any) {
        const status = error?.response?.status;
        const serverMsg = error?.response?.data?.error || error?.response?.data?.message;
        const errorMsg = status === 404 || serverMsg?.toLowerCase().includes('no invoice')
          ? 'Barcode not sold or not in this invoice'
          : serverMsg || 'Failed to find invoice';
        setSearchError(errorMsg);
        setSearchValue(''); // Clear input so user can scan another barcode
        // Don't clear existing invoice/cart on search error - preserve user's selection
        return null;
      }
    },
    enabled: false,
    retry: false,
  });

  // Process credit note mutation
  const processCreditNoteMutation = useMutation({
    mutationFn: async (data: { invoice_id: number; items_to_replace: Array<{ item_id: number; quantity: number; status: string }>; store_id?: number; notes?: string }) => {
      return await posApi.replacement.creditNote(data.invoice_id, {
        items_to_replace: data.items_to_replace,
        store_id: data.store_id,
        notes: data.notes,
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      showToast(`Credit note ${data.data.credit_note.credit_note_number} created successfully`, 'success');
      // Navigate to credit note detail view
      const creditNoteId = data.data?.credit_note?.id;
      if (creditNoteId) {
        navigate(`/credit-notes/${creditNoteId}`);
      } else {
        navigate(`/invoices/${variables.invoice_id}`);
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to process credit note';
      showToast(errorMsg, 'error');
    },
  });

  const handleSearch = async () => {
    if (!searchValue.trim()) {
      setSearchError('Please enter a barcode / short code, SKU, or invoice number');
      return;
    }
    setShowInvoiceDropdown(false);
    const { data } = await findInvoiceQuery.refetch();
    if (!data?.invoice) return;

    const foundInvoice = data.invoice as Invoice;
    const matchingItems = foundInvoice.items as InvoiceItem[];

    // If we have an invoice loaded and found a different one, confirm before switching
    if (invoice && foundInvoice.id !== invoice.id) {
      const switchConfirmed = window.confirm(
        `This barcode is found in invoice ${foundInvoice.invoice_number}, not the current invoice (${invoice.invoice_number}). Do you want to clear the current selection and switch to invoice ${foundInvoice.invoice_number}?`
      );
      if (!switchConfirmed) return;
      applyInvoiceResult(foundInvoice, searchValue.trim());
      showToast(`Switched to invoice ${foundInvoice.invoice_number}. Scan more items or generate credit note.`, 'success');
      return;
    }

    // Same invoice - merge new items and add/increment (keep adding items when scanning)
    if (invoice && foundInvoice.id === invoice.id) {
      setInvoice((prev) => {
        if (!prev) return prev;
        const existingIds = new Set(prev.items.map((i) => i.id));
        const newItems = matchingItems.filter((item) => !existingIds.has(item.id));
        const updatedItems = newItems.length > 0 ? [...prev.items, ...newItems] : prev.items;
        return { ...prev, items: updatedItems };
      });
      setSelectedItems((prev) => {
        const next = { ...prev };
        for (const item of matchingItems) {
          const current = next[item.id] || 0;
          const maxQty = item.available_quantity;
          next[item.id] = Math.min(current + 1, maxQty);
        }
        return next;
      });
      setItemTags((prev) => ({ ...prev }));
      setSearchError(null);
      setSearchValue('');
      showToast(`Added ${matchingItems.length} item(s) to credit note`, 'success');
      return;
    }

    // No invoice loaded - first search, load invoice
    applyInvoiceResult(foundInvoice, searchValue.trim());
    showToast(`Invoice ${foundInvoice.invoice_number} loaded. Scan more items or generate credit note.`, 'success');
  };

  const handleInvoiceSelect = async (selectedInvoice: Invoice) => {
    setSearchValue(selectedInvoice.invoice_number);
    setShowInvoiceDropdown(false);
    setInvoice(selectedInvoice);
    setSearchError(null);

    const initialSelected: Record<number, number> = {};
    selectedInvoice.items.forEach((item: InvoiceItem) => {
      initialSelected[item.id] = 0;
    });
    setSelectedItems(initialSelected);

    setItemTags({});
  };

  const handleBarcodeScan = async (barcode: string) => {
    if (!barcode.trim()) return;

    try {
      const isInvoiceNumber = /^[A-Z0-9-]+$/i.test(barcode.trim()) && barcode.trim().length >= 3;
      const response = await posApi.replacement.findInvoiceByBarcode({
        barcode: isInvoiceNumber ? undefined : barcode.trim(),
        sku: isInvoiceNumber ? undefined : barcode.trim(),
        invoice_number: isInvoiceNumber ? barcode.trim() : undefined,
      });

      const data = response.data;
      if (!data?.invoice) return;

      const foundInvoice = data.invoice as Invoice;
      const matchingItems = foundInvoice.items as InvoiceItem[];

      // If we already have an invoice loaded, check if this barcode belongs to the same invoice
      if (invoice) {
        if (foundInvoice.id !== invoice.id) {
          const switchConfirmed = window.confirm(
            `This barcode is found in invoice ${foundInvoice.invoice_number}, not the current invoice (${invoice.invoice_number}). Do you want to clear the current selection and switch to invoice ${foundInvoice.invoice_number}?`
          );
          if (!switchConfirmed) return;

          // User confirmed - switch to the new invoice
          setInvoice(foundInvoice);
          setSearchError(null);
          setSearchValue('');
          const initialSelected: Record<number, number> = {};
          matchingItems.forEach((item: InvoiceItem) => {
            initialSelected[item.id] = Math.min(1, item.available_quantity);
          });
          setSelectedItems(initialSelected);
          setItemTags({});
          showToast(`Switched to invoice ${foundInvoice.invoice_number}. Scan more items or generate credit note.`, 'success');
          return;
        }

        // Same invoice - merge new items and add/increment
        setInvoice((prev) => {
          if (!prev) return prev;
          const existingIds = new Set(prev.items.map((i) => i.id));
          const newItems = matchingItems.filter((item) => !existingIds.has(item.id));
          const itemsToAdd = newItems;
          const updatedItems =
            itemsToAdd.length > 0 ? [...prev.items, ...itemsToAdd] : prev.items;

          return { ...prev, items: updatedItems };
        });

        setSelectedItems((prev) => {
          const next = { ...prev };
          for (const item of matchingItems) {
            const current = next[item.id] || 0;
            const maxQty = item.available_quantity;
            next[item.id] = Math.min(current + 1, maxQty);
          }
          return next;
        });

        setItemTags((prev) => ({ ...prev }));

        showToast(`Added ${matchingItems.length} item(s) to credit note`, 'success');
        setSearchValue('');
        // Keep scanner open for continued scanning
        return;
      }

      // No invoice loaded - first scan, load invoice and select matching items
      setInvoice(foundInvoice);
      setSearchError(null);
      setSearchValue('');

      const initialSelected: Record<number, number> = {};
      matchingItems.forEach((item: InvoiceItem) => {
        initialSelected[item.id] = Math.min(1, item.available_quantity);
      });
      setSelectedItems(initialSelected);

      setItemTags({});

      showToast(`Invoice ${foundInvoice.invoice_number} loaded. Scan more items or generate credit note.`, 'success');
      // Keep scanner open so user can scan more items
    } catch (error: any) {
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.error || error?.response?.data?.message;
      const message = status === 404 || serverMsg?.toLowerCase().includes('no invoice')
        ? 'Barcode not sold or not in this invoice'
        : serverMsg || 'Barcode not sold or not in this invoice';
      showToast(message, 'error');
      setSearchValue(''); // Clear input so user can scan another barcode
    }
  };

  const handleItemToggle = (itemId: number) => {
    setSelectedItems(prev => {
      const current = prev[itemId] || 0;
      if (current === 0) {
        return { ...prev, [itemId]: 1 };
      } else {
        return { ...prev, [itemId]: 0 };
      }
    });

    // Do not auto-select status; user must choose it explicitly.
  };

  const handleReturnTagChange = (itemId: number, tag: 'returned' | 'defective' | 'unknown') => {
    setItemTags(prev => ({
      ...prev,
      [itemId]: tag,
    }));
  };

  const handleQuantityChange = (itemId: number, value: string, maxQuantity: number) => {
    if (value === '' || /^\d+$/.test(value)) {
      const intValue = value === '' ? 0 : parseInt(value);
      const clampedValue = Math.max(0, Math.min(intValue, maxQuantity));
      setSelectedItems((prev) => ({
        ...prev,
        [itemId]: clampedValue,
      }));
    }
  };

  const handleProcessCreditNote = () => {
    if (!invoice) return;

    const items_to_replace: Array<{ item_id: number; quantity: number; status: string }> = [];
    Object.entries(selectedItems).forEach(([itemIdStr, quantity]) => {
      const quantityNum = Number(quantity);
      if (quantityNum > 0) {
        const itemId = parseInt(itemIdStr);
        const selectedTag = itemTags[itemId];
        if (!selectedTag) {
          return;
        }
        items_to_replace.push({
          item_id: itemId,
          quantity: quantityNum,
          status: selectedTag,
        });
      }
    });

    if (items_to_replace.length === 0) {
      showToast('Please select at least one item for credit note', 'info');
      return;
    }
    const missingStatus = Object.entries(selectedItems).some(([itemIdStr, quantity]) => {
      const quantityNum = Number(quantity);
      if (quantityNum <= 0) return false;
      return !itemTags[parseInt(itemIdStr)];
    });
    if (missingStatus) {
      showToast('Please select return status for all selected items', 'error');
      return;
    }

    if (!confirm('Are you sure you want to create a credit note? Items will be removed from invoice, added back to stock, and a credit note will be generated.')) {
      return;
    }

    processCreditNoteMutation.mutate({
      invoice_id: invoice.id,
      items_to_replace,
      store_id: invoice.store,
      notes,
    });
  };

  // Parse barcodes from pasted text (line or space separated)
  const parseBulkBarcodes = (text: string): string[] => {
    const raw = text.replace(/\r\n/g, '\n').split(/[\n\s]+/).map((s) => s.trim()).filter(Boolean);
    return [...new Set(raw)];
  };

  // Format barcode with hyphens every 4 characters for readability
  const formatBarcodeWithHyphens = (value: string): string => {
    const cleaned = (value || '').replace(/-/g, '');
    if (!cleaned) return value || '';
    return cleaned.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  };

  // Display text for a barcode row: hyphenated barcode + short code when available
  const formatBarcodeDisplay = (row: { barcode: string; barcode_full?: string | null; short_code?: string | null }) => {
    const full = row.barcode_full ?? row.barcode;
    const hyphenated = formatBarcodeWithHyphens(full);
    const short = row.short_code?.trim();
    if (short && short !== full && short !== row.barcode) {
      return `${hyphenated} (short: ${short})`;
    }
    return hyphenated;
  };

  const handleBulkCheck = async () => {
    if (!bulkReturnTag) {
      showToast('Please select status before bulk check', 'error');
      return;
    }
    const barcodes = parseBulkBarcodes(bulkInput);
    if (barcodes.length === 0) {
      showToast('Paste at least one barcode (line or space separated)', 'info');
      return;
    }
    setBulkCheckLoading(true);
    setBulkCheckResult(null);
    try {
      const response = await posApi.replacement.bulkBarcodesCheck(barcodes);
      setBulkCheckResult(response.data);
      const skippedCount = response.data.skipped?.length ?? 0;
      const processableCount = response.data.processable?.length ?? 0;
      const freshCount = response.data.fresh_processable?.length ?? 0;
      const actionableCount = processableCount + (bulkReturnTag === 'defective' ? freshCount : 0);
      if (response.data.valid) {
        showToast(
          actionableCount > 0
            ? `${actionableCount} barcode(s) can be marked as ${bulkReturnTag}.${bulkReturnTag !== 'defective' && freshCount > 0 ? ` ${freshCount} fresh barcode(s) are only available for defective.` : ''}${skippedCount > 0 ? ` ${skippedCount} skipped (no action).` : ''}`
            : 'No barcodes could be processed. Check skipped list.',
          skippedCount > 0 ? 'info' : 'success'
        );
      } else {
        showToast(
          skippedCount > 0
            ? `No action on ${skippedCount} barcode(s). See "Not resolved" below.`
            : 'No barcodes could be processed.',
          'error'
        );
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to check barcodes';
      showToast(msg, 'error');
      setBulkCheckResult(null);
    } finally {
      setBulkCheckLoading(false);
    }
  };

  const handleBulkMarkReturned = async () => {
    if (!bulkReturnTag) {
      showToast('Please select status before apply', 'error');
      return;
    }
    const processable = bulkCheckResult?.processable ?? [];
    const freshProcessable = bulkCheckResult?.fresh_processable ?? [];
    const freshToDefective = bulkReturnTag === 'defective' ? freshProcessable : [];
    if (!bulkCheckResult?.valid || (processable.length === 0 && freshToDefective.length === 0)) return;
    setBulkApplyLoading(true);
    const byInvoice = new Map<number, typeof processable>();
    for (const row of processable) {
      const list = byInvoice.get(row.invoice_id) || [];
      list.push(row);
      byInvoice.set(row.invoice_id, list);
    }
    let doneSold = 0;
    let doneFresh = 0;
    try {
      for (const [invoiceId, items] of byInvoice) {
        const items_to_replace = items.map((b) => ({
          item_id: b.item_id,
          quantity: 1,
          status: bulkReturnTag,
        }));
        await posApi.replacement.creditNote(invoiceId, {
          items_to_replace,
          notes: notes || 'Bulk return',
        });
        doneSold += items.length;
      }

      for (const row of freshToDefective) {
        const barcodeValue = row.barcode_full || row.short_code || row.barcode;
        await posApi.replacement.create({ barcode: barcodeValue });
        await posApi.replacement.updateTag(row.barcode_id, { tag: 'defective' });
        doneFresh += 1;
      }

      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
      const doneTotal = doneSold + doneFresh;
      const soldMessage = doneSold > 0 ? `${doneSold} sold barcode(s) across ${byInvoice.size} invoice(s)` : null;
      const freshMessage = doneFresh > 0 ? `${doneFresh} fresh barcode(s)` : null;
      const detail = [soldMessage, freshMessage].filter(Boolean).join(' + ');
      showToast(`Marked ${doneTotal} barcode(s) as ${bulkReturnTag}${detail ? ` (${detail})` : ''}.`, 'success');
      setShowBulkModal(false);
      setBulkInput('');
      setBulkCheckResult(null);
      setBulkReturnTag('');
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || 'Failed to mark as returned';
      showToast(msg, 'error');
    } finally {
      setBulkApplyLoading(false);
    }
  };

  const soldBulkCount = bulkCheckResult?.processable?.length ?? 0;
  const freshBulkCount = bulkCheckResult?.fresh_processable?.length ?? 0;
  const canApplyBulk = Boolean(bulkReturnTag) && (soldBulkCount > 0 || (bulkReturnTag === 'defective' && freshBulkCount > 0));

  const handleReset = () => {
    setSearchValue('');
    setInvoice(null);
    setSelectedItems({});
    setItemTags({});
    setNotes('');
    setSearchError(null);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const hasSelectedItems = Object.values(selectedItems).some(qty => qty > 0);
  const totalItemsToReturn = Object.values(selectedItems).reduce((sum, qty) => sum + Number(qty), 0);

  // Calculate estimated credit amount
  const estimatedCreditAmount = invoice ? Object.entries(selectedItems).reduce((sum, [itemId, quantity]) => {
    const quantityNum = Number(quantity);
    if (quantityNum > 0) {
      const item = invoice.items.find(i => i.id === parseInt(itemId));
      if (item) {
        const lineTotal = parseFloat(item.line_total) || 0;
        const itemQuantity = parseFloat(item.quantity) || 1;
        // Use line_total / quantity for accurate per-unit price (accounts for discounts/taxes)
        const pricePerUnit = itemQuantity > 0 ? lineTotal / itemQuantity : parseFloat(item.manual_unit_price || item.unit_price || '0');
        return sum + (pricePerUnit * quantityNum);
      }
    }
    return sum;
  }, 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={() => navigate('/replacement')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">Credit Note Replacement</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <Receipt className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-2">Credit Note Replacement:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Find the invoice containing items for credit note</li>
              <li>Select items and quantities to return</li>
              <li>Items will be removed from invoice and added back to stock</li>
              <li>A credit note will be generated and customer ledger will be updated</li>
            </ul>
          </div>
        </div>
      </div>

      <Card>
        <div className="space-y-4">
          {/* Search Section */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Search by Barcode or SKU
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchValue}
                  onChange={(e) => {
                    setSearchValue(e.target.value);
                    setShowInvoiceDropdown(e.target.value.trim().length >= 2);
                    setSearchError(null);
                  }}
                  onFocus={() => {
                    if (searchValue.trim().length >= 2) {
                      setShowInvoiceDropdown(true);
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowInvoiceDropdown(false), 200);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    } else if (e.key === 'Escape') {
                      setShowInvoiceDropdown(false);
                    }
                  }}
                  placeholder="Enter barcode / short code, SKU, or invoice number"
                  className="pl-10 pr-24"
                />
                {/* Invoice Search Dropdown */}
                {showInvoiceDropdown && searchInvoicesQuery.data?.invoices && searchInvoicesQuery.data.invoices.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchInvoicesQuery.data.invoices.map((inv: Invoice) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => handleInvoiceSelect(inv)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                      >
                        <div className="font-medium text-gray-900">{inv.invoice_number}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          {inv.customer_name || 'N/A'} • {inv.store_name || 'N/A'} • {new Date(inv.created_at).toLocaleDateString()}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                  <Button
                    onClick={() => setShowScanner(true)}
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    title="Open camera scanner"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Button
                onClick={handleSearch}
                disabled={findInvoiceQuery.isFetching}
                variant="primary"
              >
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowBulkModal(true);
                  setBulkCheckResult(null);
                  setBulkReturnTag('returned');
                  setBulkInput('');
                }}
                className="whitespace-nowrap"
              >
                <ListOrdered className="h-4 w-4 mr-2" />
                Bulk update
              </Button>
            </div>
            {searchError && (
              <div className="text-sm text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {searchError}
              </div>
            )}
          </div>

          {/* QR Code Scanner */}
          {showScanner && (
            <div className="border rounded-lg p-4 bg-gray-50 flex justify-center">
              <div className="w-full max-w-sm">
                <BarcodeScanner
                  isOpen={showScanner}
                  continuous={true}
                  onScan={handleBarcodeScan}
                  onClose={() => setShowScanner(false)}
                />
              </div>
            </div>
          )}

          {/* Invoice Details */}
          {invoice && (
            <div className="space-y-4 border-t pt-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-5 w-5 text-gray-600" />
                  <h3 className="font-semibold text-lg">Invoice Details</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600 block text-xs">Invoice Number</span>
                    <span className="font-medium">{invoice.invoice_number}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Customer</span>
                    <span className="font-medium">{invoice.customer_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Store</span>
                    <span className="font-medium">{invoice.store_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Date</span>
                    <span className="font-medium">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Invoice Items - backend returns only matching barcode/SKU items when search was by barcode/SKU */}
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900">Select Items for Credit Note</h3>
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {invoice.items.map((item) => {
                    const isSelected = (selectedItems[item.id] || 0) > 0;
                    const maxQuantity = item.available_quantity;
                    const selectedQuantity = selectedItems[item.id] || 0;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''
                          }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleItemToggle(item.id)}
                              className="w-4 h-4 text-blue-600 rounded mt-1"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900">{item.product_name}</div>
                              <div className="text-sm text-gray-600 mt-1">
                                {item.barcode_value && item.barcode_value !== item.barcode_full && <>Short code: {item.barcode_value}</>}
                                {item.barcode_value && item.barcode_value !== item.barcode_full && item.barcode_full && <> | </>}
                                {item.barcode_full && <>Barcode: {item.barcode_full}</>}
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                Sold: {item.quantity} | Available: {item.available_quantity}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                Price: ₹{formatNumber(item.manual_unit_price || item.unit_price || 0)} per unit
                              </div>
                            </div>
                          </div>
                          {isSelected && (
                            <div className="flex flex-col items-end gap-3">
                              {/* Return Condition (Traffic Signals) */}
                              <div className="flex items-center gap-2 mb-1">
                                <button
                                  type="button"
                                  onClick={() => handleReturnTagChange(item.id, 'returned')}
                                  className={`w-5 h-5 rounded-full bg-green-500 border-2 transition-all hover:scale-110 ${itemTags[item.id] === 'returned'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-green-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                    }`}
                                  title="Returned (Good condition)"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleReturnTagChange(item.id, 'defective')}
                                  className={`w-5 h-5 rounded-full bg-red-500 border-2 transition-all hover:scale-110 ${itemTags[item.id] === 'defective'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-red-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                    }`}
                                  title="Defective"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleReturnTagChange(item.id, 'unknown')}
                                  className={`w-5 h-5 rounded-full bg-yellow-400 border-2 transition-all hover:scale-110 ${itemTags[item.id] === 'unknown'
                                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-yellow-200'
                                    : 'border-transparent opacity-30 hover:opacity-60'
                                    }`}
                                  title="Unknown"
                                />
                                <span className="text-[10px] font-bold text-gray-500 capitalize min-w-[50px]">
                                  {itemTags[item.id] || 'select'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (selectedQuantity > 0) {
                                      handleQuantityChange(item.id, String(selectedQuantity - 1), maxQuantity);
                                    }
                                  }}
                                  disabled={selectedQuantity <= 0}
                                >
                                  <Minus className="h-4 w-4" />
                                </Button>
                                <Input
                                  type="number"
                                  step="1"
                                  value={selectedQuantity}
                                  onChange={(e) => handleQuantityChange(item.id, e.target.value, maxQuantity)}
                                  onBlur={(e) => {
                                    const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, maxQuantity));
                                    handleQuantityChange(item.id, val.toString(), maxQuantity);
                                  }}
                                  min={0}
                                  max={maxQuantity}
                                  className="w-20 text-center"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (selectedQuantity < maxQuantity) {
                                      handleQuantityChange(item.id, String(selectedQuantity + 1), maxQuantity);
                                    }
                                  }}
                                  disabled={selectedQuantity >= maxQuantity}
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                              {/* Credit amount for this item */}
                              <div className="text-xs text-purple-600 font-medium">
                                Credit: ₹{(() => {
                                  const lineTotal = parseFloat(item.line_total || '0');
                                  const itemQuantity = parseFloat(item.quantity) || 1;
                                  // Use line_total / quantity for accurate per-unit price (accounts for discounts/taxes)
                                  const pricePerUnit = itemQuantity > 0 ? lineTotal / itemQuantity : parseFloat(item.manual_unit_price || item.unit_price || '0');
                                  return formatNumber(pricePerUnit * selectedQuantity);
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Notes (Optional)
                </label>
                <Input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes for this credit note..."
                  className="w-full"
                />
              </div>

              {/* Summary */}
              {hasSelectedItems && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Receipt className="h-5 w-5 text-blue-600" />
                    <span className="font-semibold text-blue-900">Credit Note Summary</span>
                  </div>
                  <div className="text-sm text-blue-800 space-y-1">
                    <div>Total items selected: {Object.values(selectedItems).filter(qty => qty > 0).length}</div>
                    <div>Total quantity: {totalItemsToReturn}</div>
                    <div className="font-semibold mt-2">
                      Estimated credit amount: ₹{formatNumber(estimatedCreditAmount)}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={processCreditNoteMutation.isPending}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  onClick={handleProcessCreditNote}
                  disabled={!hasSelectedItems || processCreditNoteMutation.isPending}
                >
                  {processCreditNoteMutation.isPending ? 'Processing...' : 'Generate Credit Note'}
                </Button>
              </div>
            </div>
          )}

          {!invoice && !findInvoiceQuery.isFetching && !searchError && (
            <div className="text-center py-12 text-gray-500 border-t pt-8">
              <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-600">Enter a barcode / short code, SKU, or invoice number to find the invoice</p>
              <p className="text-sm text-gray-500 mt-2">Or use the camera icon to scan a QR code</p>
            </div>
          )}
        </div>
      </Card>

      {/* Bulk update modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Bulk update – mark barcodes</h2>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setBulkReturnTag('returned')}
                  disabled={bulkApplyLoading}
                  className={`w-5 h-5 rounded-full bg-green-500 border-2 transition-all hover:scale-110 disabled:opacity-50 ${bulkReturnTag === 'returned'
                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-green-200'
                    : 'border-transparent opacity-30 hover:opacity-60'
                  }`}
                  title="Returned (Good condition)"
                />
                <button
                  type="button"
                  onClick={() => setBulkReturnTag('defective')}
                  disabled={bulkApplyLoading}
                  className={`w-5 h-5 rounded-full bg-red-500 border-2 transition-all hover:scale-110 disabled:opacity-50 ${bulkReturnTag === 'defective'
                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-red-200'
                    : 'border-transparent opacity-30 hover:opacity-60'
                  }`}
                  title="Defective"
                />
                <button
                  type="button"
                  onClick={() => setBulkReturnTag('unknown')}
                  disabled={bulkApplyLoading}
                  className={`w-5 h-5 rounded-full bg-yellow-400 border-2 transition-all hover:scale-110 disabled:opacity-50 ${bulkReturnTag === 'unknown'
                    ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-yellow-200'
                    : 'border-transparent opacity-30 hover:opacity-60'
                  }`}
                  title="Unknown"
                />
                <span className="text-xs font-bold text-gray-500 capitalize min-w-[52px] hidden sm:inline">
                  {bulkReturnTag || 'select'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => !bulkApplyLoading && setShowBulkModal(false)}
                className="p-1 rounded hover:bg-gray-100 shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <p className="text-sm text-gray-600">
                Paste barcodes or short codes below (one per line or space separated). All must belong to a single customer.
              </p>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="Paste barcodes or short codes here..."
                className="w-full h-40 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                disabled={bulkApplyLoading}
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={handleBulkCheck}
                  disabled={bulkCheckLoading || bulkApplyLoading || parseBulkBarcodes(bulkInput).length === 0}
                >
                  {bulkCheckLoading ? 'Checking...' : 'Check status'}
                </Button>
                {bulkCheckResult && canApplyBulk && (
                  <Button
                    variant="primary"
                    onClick={handleBulkMarkReturned}
                    disabled={bulkApplyLoading}
                  >
                    {bulkApplyLoading ? 'Applying...' : `Mark as ${bulkReturnTag || '...'}`}
                  </Button>
                )}
              </div>
              {bulkCheckResult && (bulkCheckResult.fresh_processable?.length ?? 0) > 0 && bulkReturnTag !== 'defective' && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Fresh barcodes were found. To process them in bulk, select the red <span className="font-semibold">defective</span> tag.
                </div>
              )}
              {bulkCheckResult && (
                <div className="border rounded-lg p-3 bg-gray-50 text-sm space-y-3">
                  {(bulkCheckResult.processable?.length ?? 0) > 0 && (
                    <>
                      <p className="font-medium text-green-700">
                        ✓ {(bulkCheckResult.processable ?? []).length} barcode(s) will be marked as <span className="capitalize">{bulkReturnTag}</span>
                        {bulkCheckResult.customers?.length ? (
                          <span className="ml-1">(customer: {bulkCheckResult.customers[0]?.name ?? 'N/A'})</span>
                        ) : null}
                      </p>
                      <p className="text-gray-600">
                        Invoices: {[...new Set(bulkCheckResult.processable?.map((b) => b.invoice_number) || [])].join(', ')}
                      </p>
                      <ul className="list-disc list-inside text-gray-700 space-y-0.5 max-h-32 overflow-y-auto mt-1">
                        {(bulkCheckResult.processable ?? []).map((p, idx) => (
                          <li key={p.item_id ?? idx}>
                            <span className="font-mono text-sm">{formatBarcodeDisplay(p)}</span>
                            {p.product_name && <span className="text-gray-500 ml-1">· {p.product_name}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {(bulkCheckResult.fresh_processable?.length ?? 0) > 0 && (
                    <div>
                      <p className="font-medium text-blue-700">
                        ✓ {(bulkCheckResult.fresh_processable ?? []).length} fresh barcode(s) ready for defective flow
                      </p>
                      <p className="text-gray-600">
                        These are currently fresh and can be processed when the red defective tag is selected.
                      </p>
                      <ul className="list-disc list-inside text-gray-700 space-y-0.5 max-h-28 overflow-y-auto mt-1">
                        {(bulkCheckResult.fresh_processable ?? []).map((p, idx) => (
                          <li key={p.barcode_id ?? idx}>
                            <span className="font-mono text-sm">{formatBarcodeDisplay(p)}</span>
                            {p.product_name && <span className="text-gray-500 ml-1">· {p.product_name}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(bulkCheckResult.skipped?.length ?? 0) > 0 && (
                    <div>
                      <p className="font-medium text-amber-800 mb-1">
                        No action taken ({(bulkCheckResult.skipped ?? []).length}):
                      </p>
                      <ul className="list-disc list-inside text-gray-700 space-y-0.5 max-h-32 overflow-y-auto">
                        {(bulkCheckResult.skipped ?? []).map((s, idx) => {
                          const tagLabel = s.current_tag ? (s.current_tag === 'new' ? 'fresh' : s.current_tag === 'in-cart' ? 'in cart' : s.current_tag) : null;
                          const statusText = tagLabel
                            ? tagLabel
                            : s.reason === 'not_found'
                              ? 'not found'
                              : s.reason === 'not_sold'
                                ? 'not sold'
                                : 'different customer';
                          return (
                            <li key={s.barcode || s.short_code || idx}>
                              <span className="font-mono text-sm">{formatBarcodeDisplay(s)}</span>
                              <span className="text-amber-700 ml-1">
                                ({statusText})
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {!bulkCheckResult.valid && (bulkCheckResult.processable?.length ?? 0) === 0 && (
                    <p className="font-medium text-red-700">No barcodes could be processed. All were skipped (see above).</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
