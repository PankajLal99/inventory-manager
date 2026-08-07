import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { posApi, productsApi } from '../../lib/api';
import { formatAppDate, formatNumber } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import BarcodeScanner from '../../components/BarcodeScanner';
import Card from '../../components/ui/Card';
import ToastContainer from '../../components/ui/Toast';
import type { Toast } from '../../components/ui/Toast';
import { Search, Camera, AlertTriangle, Package, Plus, Minus, FileText, ArrowLeft, DollarSign, Barcode } from 'lucide-react';
import { invoiceLineSticker } from '../../lib/invoiceLineSticker';

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
  sold_barcode_value?: string;
  source_invoice_id?: number;
  source_invoice_number?: string;
  source_store?: number;
  source_customer?: number | null;
  source_customer_name?: string;
}

interface Invoice {
  id: number;
  invoice_number: string;
  customer?: number | null;
  customer_name?: string;
  store_name?: string;
  created_at: string;
  items: InvoiceItem[];
  total: string;
  store?: number;
}

interface ReplacementItem {
  item_id: number;
  new_product_id: number | null;
  new_product_name: string;
  selected_short_code?: string | null;
  reserved_barcode_id?: number | null;
  reserved_restore_tag?: 'new' | 'returned';
  quantity: number;
  new_unit_price?: number | null;
  manual_unit_price?: number | null;
  /** Purchase/cost for the scanned new piece (read-only in UI; from barcode/product API) */
  reference_purchase_cost?: number | null;
  scanned_barcode?: string | null; // Exact barcode scanned or searched for the new piece
  return_tag?: 'returned' | 'defective' | 'unknown';
}

const pickAutoReplacementPrice = (product: any): number | null => {
  const candidates = [product?.selling_price, product?.purchase_price, product?.unit_price]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length > 0 ? candidates[0] : null;
};

export default function ReplaceProduct() {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const [replacements, setReplacements] = useState<Record<number, ReplacementItem>>({});
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [showProductDropdown, setShowProductDropdown] = useState<Record<number, boolean>>({});
  const [debouncedProductSearches, setDebouncedProductSearches] = useState<Record<number, string>>({});
  const [showProductScanner, setShowProductScanner] = useState<Record<number, boolean>>({});
  const [productSearchSelectedIndex, setProductSearchSelectedIndex] = useState<Record<number, number>>({});
  const [strictBarcodeMode, setStrictBarcodeMode] = useState(true); // Default to strict mode like POS
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const normalizeCustomerName = (name?: string) => (name || '').trim().toLowerCase();
  const isSameCustomer = (a: Invoice, b: Invoice) => {
    if (a.customer !== null && a.customer !== undefined && b.customer !== null && b.customer !== undefined) {
      return a.customer === b.customer;
    }
    if ((a.customer ?? null) !== (b.customer ?? null)) return false;
    return normalizeCustomerName(a.customer_name) === normalizeCustomerName(b.customer_name);
  };
  const withInvoiceContext = (items: InvoiceItem[], sourceInvoice: Invoice): InvoiceItem[] =>
    items.map((item) => ({
      ...item,
      source_invoice_id: sourceInvoice.id,
      source_invoice_number: sourceInvoice.invoice_number,
      source_store: sourceInvoice.store,
      source_customer: sourceInvoice.customer ?? null,
      source_customer_name: sourceInvoice.customer_name,
    }));

  // Helper function to check if input looks like a barcode
  const looksLikeBarcode = (input: string): boolean => {
    if (!input || input.length < 3) return false;
    // Barcodes are typically alphanumeric, may contain dashes, and are usually longer
    // Product names usually have spaces and are more varied
    const hasSpaces = /\s/.test(input);
    const isMostlyNumeric = /^\d+$/.test(input);
    const hasSpecialChars = /[^a-zA-Z0-9\s-]/.test(input);

    // If it has spaces or special chars (except dashes), it's likely a product name
    if (hasSpaces || hasSpecialChars) return false;
    // If it's mostly numeric or alphanumeric without spaces, it's likely a barcode
    return isMostlyNumeric || (!hasSpaces && input.length >= 3);
  };

  // Debounce product searches
  useEffect(() => {
    const timers: Record<number, ReturnType<typeof setTimeout>> = {};
    Object.entries(productSearch).forEach(([itemId, value]) => {
      if (timers[parseInt(itemId)]) {
        clearTimeout(timers[parseInt(itemId)]);
      }
      timers[parseInt(itemId)] = setTimeout(() => {
        setDebouncedProductSearches(prev => ({ ...prev, [itemId]: value }));
      }, 300);
    });
    return () => {
      Object.values(timers).forEach(timer => clearTimeout(timer));
    };
  }, [productSearch]);

  // Toast helper function
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const releaseReservedBarcode = async (replacement?: ReplacementItem) => {
    if (!replacement?.reserved_barcode_id) return;
    try {
      await posApi.replacement.reserveBarcode({
        barcode_id: replacement.reserved_barcode_id,
        action: 'release',
        restore_tag: replacement.reserved_restore_tag || 'new',
      });
    } catch (_error) {
      // Ignore release failures here; backend tag checks still protect final processing.
    }
  };

  const releaseAllReservedBarcodes = async () => {
    const releaseJobs = Object.values(replacements)
      .filter((replacement) => replacement.reserved_barcode_id)
      .map((replacement) => releaseReservedBarcode(replacement));
    if (releaseJobs.length > 0) {
      await Promise.allSettled(releaseJobs);
    }
  };

  useEffect(() => {
    return () => {
      // Best-effort cleanup when user leaves this screen.
      void releaseAllReservedBarcodes();
    };
  }, [replacements]);

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

  const applyInvoiceResult = (foundInvoice: Invoice, searchBarcode: string) => {
    const contextualItems = withInvoiceContext(foundInvoice.items, foundInvoice);
    setInvoice({ ...foundInvoice, items: contextualItems });
    setSearchError(null);
    setSearchValue('');
    const initialReplacements: Record<number, ReplacementItem> = {};
    const initialProductSearch: Record<number, string> = {};
    const searchUpper = searchBarcode.toUpperCase();

    contextualItems.forEach((item: InvoiceItem) => {
      const itemBarcode = item.barcode_value?.toUpperCase() || '';
      const itemBarcodeFull = item.barcode_full?.toUpperCase() || '';
      const itemSnap = item.sold_barcode_value?.toUpperCase() || '';
      if (
        itemBarcode === searchUpper ||
        itemBarcodeFull === searchUpper ||
        itemSnap === searchUpper
      ) {
        initialReplacements[item.id] = {
          item_id: item.id,
          new_product_id: null,
          new_product_name: '',
          quantity: Math.min(1, item.available_quantity),
        };
      }
    });

    setReplacements(initialReplacements);
    setProductSearch(initialProductSearch);
  };

  // Find invoice by barcode/SKU or invoice number (no side effects)
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
        const serverMsg = error?.response?.data?.message || error?.response?.data?.error;
        const errorMsg = status === 404 || serverMsg?.toLowerCase().includes('no invoice')
          ? 'Barcode not sold or not in this invoice'
          : serverMsg || 'Failed to find invoice';
        setSearchError(errorMsg);
        setSearchValue('');
        return null;
      }
    },
    enabled: false,
    retry: false,
  });

  // Product search - use a single query that updates based on active search
  const [activeProductSearchItemId, setActiveProductSearchItemId] = useState<number | null>(null);
  const activeSearchTerm = activeProductSearchItemId ? debouncedProductSearches[activeProductSearchItemId] : '';
  const trimmedActiveSearch = activeSearchTerm?.trim() || '';

  // Barcode check query for replacement product search
  const barcodeCheckQuery = useQuery({
    queryKey: ['barcode-check-replacement', activeProductSearchItemId, trimmedActiveSearch],
    queryFn: async () => {
      if (!trimmedActiveSearch || trimmedActiveSearch.length < 3) return null;
      if (!looksLikeBarcode(trimmedActiveSearch)) return null;

      try {
        const response = await productsApi.byBarcode(trimmedActiveSearch, strictBarcodeMode);
        if (response.data) {
          return { product: response.data, isUnavailable: !response.data.barcode_available };
        }
      } catch (error) {
        return null;
      }
      return null;
    },
    enabled: Boolean(trimmedActiveSearch.length >= 3 && looksLikeBarcode(trimmedActiveSearch) && activeProductSearchItemId !== null),
    retry: false,
  });

  const productSearchQuery = useQuery({
    queryKey: ['products-replacement', activeProductSearchItemId, activeSearchTerm],
    queryFn: async () => {
      if (!activeSearchTerm || activeSearchTerm.trim().length < 1) return { results: [] };
      try {
        const response = await productsApi.list({ search: activeSearchTerm.trim(), tag: 'new' }); // Only show available inventory
        return response.data;
      } catch (error) {
        return { results: [] };
      }
    },
    enabled: Boolean(activeSearchTerm && activeSearchTerm.trim().length >= 1 && activeProductSearchItemId !== null && !strictBarcodeMode && !(looksLikeBarcode(trimmedActiveSearch) && barcodeCheckQuery.data?.product && !barcodeCheckQuery.data?.isUnavailable)),
    retry: false,
  });

  // Process replacement mutation
  const processReplacementMutation = useMutation({
    mutationFn: async (data: {
      invoiceIds: number[];
      replacements: Array<{
        invoice_item_id: number;
        new_product_id: number;
        store_id?: number;
        new_unit_price?: number;
        manual_unit_price?: number;
        scanned_barcode?: string;
        scanned_original_barcode?: string;
        return_tag?: string;
      }>;
    }) => {
      const results = [];
      for (const replacement of data.replacements) {
        console.log('Calling API with:', replacement);
        const result = await posApi.replacement.replace({
          invoice_item_id: replacement.invoice_item_id,
          new_product_id: replacement.new_product_id,
          store_id: replacement.store_id,
          new_unit_price: replacement.new_unit_price,
          manual_unit_price: replacement.manual_unit_price,
          scanned_barcode: replacement.scanned_barcode,
          scanned_original_barcode: replacement.scanned_original_barcode,
          return_tag: replacement.return_tag,
        });
        results.push(result.data);
      }
      return { results, invoiceIds: data.invoiceIds };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      showToast('Product replacement processed successfully', 'success');
      if (data.invoiceIds.length === 1) {
        navigate(`/invoices/${data.invoiceIds[0]}`);
      } else {
        setInvoice(null);
        setReplacements({});
        setProductSearch({});
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to process replacement';
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
    const matchingItems = withInvoiceContext(foundInvoice.items as InvoiceItem[], foundInvoice);

    if (invoice && !isSameCustomer(foundInvoice, invoice)) {
      const switchConfirmed = window.confirm(
        `This barcode belongs to customer ${foundInvoice.customer_name || 'N/A'}, while current selection is for ${invoice.customer_name || 'N/A'}. Do you want to clear current selection and switch customer?`
      );
      if (!switchConfirmed) return;
      await releaseAllReservedBarcodes();
      applyInvoiceResult(foundInvoice, searchValue.trim());
      showToast(`Switched to customer ${foundInvoice.customer_name || 'N/A'}.`, 'success');
      return;
    }

    if (invoice && isSameCustomer(foundInvoice, invoice)) {
      setInvoice((prev) => {
        if (!prev) return prev;
        const existingIds = new Set(prev.items.map((i) => i.id));
        const newItems = matchingItems.filter((item) => !existingIds.has(item.id));
        return { ...prev, items: newItems.length > 0 ? [...prev.items, ...newItems] : prev.items };
      });
      setReplacements((prev) => {
        const next = { ...prev };
        for (const item of matchingItems) {
          if (!next[item.id]) {
            next[item.id] = {
              item_id: item.id,
              new_product_id: null,
              new_product_name: '',
              quantity: Math.min(1, item.available_quantity),
            };
          }
        }
        return next;
      });
      setSearchError(null);
      setSearchValue('');
      showToast(
        foundInvoice.id === invoice.id
          ? `Added ${matchingItems.length} item(s) to replacement list`
          : `Added ${matchingItems.length} item(s) from invoice ${foundInvoice.invoice_number}`,
        'success'
      );
      return;
    }

    applyInvoiceResult(foundInvoice, searchValue.trim());
    showToast(`Customer ${foundInvoice.customer_name || 'N/A'} loaded. Scan more items or process replacement.`, 'success');
  };

  const handleInvoiceSelect = async (selectedInvoice: Invoice) => {
    await releaseAllReservedBarcodes();
    const contextualItems = withInvoiceContext(selectedInvoice.items, selectedInvoice);
    setShowInvoiceDropdown(false);
    setInvoice({ ...selectedInvoice, items: contextualItems });
    setSearchError(null);
    setSearchValue('');
    setReplacements({});
    setProductSearch({});
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
      const matchingItems = withInvoiceContext(foundInvoice.items as InvoiceItem[], foundInvoice);

      if (invoice) {
        if (!isSameCustomer(foundInvoice, invoice)) {
          const switchConfirmed = window.confirm(
            `This barcode belongs to customer ${foundInvoice.customer_name || 'N/A'}, while current selection is for ${invoice.customer_name || 'N/A'}. Do you want to clear current selection and switch customer?`
          );
          if (!switchConfirmed) return;

          await releaseAllReservedBarcodes();
          setInvoice({ ...foundInvoice, items: matchingItems });
          setSearchError(null);
          setSearchValue('');
          const initialReplacements: Record<number, ReplacementItem> = {};
          matchingItems.forEach((item: InvoiceItem) => {
            initialReplacements[item.id] = {
              item_id: item.id,
              new_product_id: null,
              new_product_name: '',
              quantity: Math.min(1, item.available_quantity),
            };
          });
          setReplacements(initialReplacements);
          setProductSearch({});
          showToast(`Switched to customer ${foundInvoice.customer_name || 'N/A'}.`, 'success');
          return;
        }

        setInvoice((prev) => {
          if (!prev) return prev;
          const existingIds = new Set(prev.items.map((i) => i.id));
          const newItems = matchingItems.filter((item) => !existingIds.has(item.id));
          return { ...prev, items: newItems.length > 0 ? [...prev.items, ...newItems] : prev.items };
        });
        setReplacements((prev) => {
          const next = { ...prev };
          for (const item of matchingItems) {
            if (!next[item.id]) {
              next[item.id] = {
                item_id: item.id,
                new_product_id: null,
                new_product_name: '',
                quantity: Math.min(1, item.available_quantity),
              };
            }
          }
          return next;
        });
        showToast(
          foundInvoice.id === invoice.id
            ? `Added ${matchingItems.length} item(s) to replacement list`
            : `Added ${matchingItems.length} item(s) from invoice ${foundInvoice.invoice_number}`,
          'success'
        );
        setSearchValue('');
        return;
      }

      setInvoice({ ...foundInvoice, items: matchingItems });
      setSearchError(null);
      setSearchValue('');
      const initialReplacements: Record<number, ReplacementItem> = {};
      matchingItems.forEach((item: InvoiceItem) => {
        initialReplacements[item.id] = {
          item_id: item.id,
          new_product_id: null,
          new_product_name: '',
          quantity: Math.min(1, item.available_quantity),
        };
      });
      setReplacements(initialReplacements);
      setProductSearch({});
      showToast(`Customer ${foundInvoice.customer_name || 'N/A'} loaded. Scan more items or process replacement.`, 'success');
    } catch (error: any) {
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.message || error?.response?.data?.error;
      const message = status === 404 || serverMsg?.toLowerCase().includes('no invoice')
        ? 'Barcode not sold or not in this invoice'
        : serverMsg || 'Barcode not sold or not in this invoice';
      showToast(message, 'error');
      setSearchValue('');
    }
  };

  const handleItemToggle = (itemId: number) => {
    const existingReplacement = replacements[itemId];
    if (existingReplacement) {
      void releaseReservedBarcode(existingReplacement);
    }

    setReplacements(prev => {
      if (prev[itemId]) {
        const newReplacements = { ...prev };
        delete newReplacements[itemId];
        return newReplacements;
      } else {
        return {
          ...prev,
          [itemId]: {
            item_id: itemId,
            new_product_id: null,
            new_product_name: '',
            quantity: 1,
          }
        };
      }
    });
  };

  const handleQuantityChange = (itemId: number, value: string, maxQuantity: number) => {
    if (value === '' || /^\d+$/.test(value)) {
      const intValue = value === '' ? 0 : parseInt(value);
      const clampedValue = Math.max(1, Math.min(intValue, maxQuantity));
      setReplacements(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          quantity: clampedValue,
        }
      }));
    }
  };

  const handleProductSelect = async (itemId: number, product: any, searchedValue?: string) => {
    // Auto charge for new line: only accept positive catalog prices; otherwise fallback later to old sale.
    const productPrice = pickAutoReplacementPrice(product);
    const purchaseCost =
      product.purchase_price != null && product.purchase_price !== ''
        ? Number(product.purchase_price)
        : null;

    // Get the barcode to use for replacement
    // Priority: searchedValue (what user typed) > matched_barcode (from API) > product.barcode
    // We want the EXACT barcode the user searched for, not what the API matched
    const barcodeToUse = searchedValue || product.matched_barcode || product.barcode || null;
    const normalizedSelectedCode = (barcodeToUse || '').trim().toUpperCase();

    if (normalizedSelectedCode) {
      const alreadyUsed = Object.entries(replacements).some(([existingItemId, existingReplacement]) => {
        if (Number(existingItemId) === itemId) return false;
        const existingCode = (existingReplacement.scanned_barcode || '').trim().toUpperCase();
        return Boolean(existingReplacement.new_product_id) && existingCode === normalizedSelectedCode;
      });

      if (alreadyUsed) {
        showToast(
          `Barcode/short code ${barcodeToUse} is already selected for another item. Please scan a different piece.`,
          'error'
        );
        return;
      }
    }

    const barcodeIdToReserve = product.barcode_id;
    if (!barcodeIdToReserve) {
      showToast('Could not reserve this barcode. Please scan/select a specific available barcode.', 'error');
      return;
    }

    const existingReplacement = replacements[itemId];
    let reserveResponse: any = null;

    if (existingReplacement?.reserved_barcode_id && existingReplacement.reserved_barcode_id !== barcodeIdToReserve) {
      await releaseReservedBarcode(existingReplacement);
    }

    if (existingReplacement?.reserved_barcode_id !== barcodeIdToReserve) {
      try {
        reserveResponse = await posApi.replacement.reserveBarcode({
          barcode_id: barcodeIdToReserve,
          action: 'reserve',
        });
      } catch (error: any) {
        const errorMsg = error?.response?.data?.error || 'Failed to reserve barcode for replacement';
        showToast(errorMsg, 'error');
        return;
      }
    }

    const restoreTag = (reserveResponse?.data?.previous_tag || product.barcode_tag || 'new') as 'new' | 'returned';

    console.log('handleProductSelect:', { itemId, searchedValue, matched_barcode: product.matched_barcode, barcodeToUse });

    setReplacements(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        new_product_id: product.id,
        new_product_name: product.name,
        selected_short_code: product.matched_barcode || searchedValue || null,
        reserved_barcode_id: barcodeIdToReserve,
        reserved_restore_tag: restoreTag === 'returned' ? 'returned' : 'new',
        new_unit_price: productPrice,
        manual_unit_price: null, // Effective charge uses new_unit_price until user edits
        reference_purchase_cost: purchaseCost,
        scanned_barcode: barcodeToUse, // Store the exact barcode that was searched
      }
    }));
    setProductSearch(prev => ({ ...prev, [itemId]: product.name }));
    setShowProductDropdown(prev => ({ ...prev, [itemId]: false }));
  };

  const handlePriceChange = (itemId: number, value: string) => {
    // Allow empty string, 0, or positive numbers
    if (value === '' || value === null || value === undefined) {
      // Clear manual price, use default from product
      setReplacements(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          manual_unit_price: undefined, // Will use new_unit_price
        }
      }));
    } else {
      // Only parse if there's actual content
      const trimmedValue = value.trim();
      if (trimmedValue === '' || trimmedValue === '-') {
        // Allow empty or just minus sign while typing
        setReplacements(prev => ({
          ...prev,
          [itemId]: {
            ...prev[itemId],
            manual_unit_price: undefined,
          }
        }));
      } else {
        const priceValue = parseFloat(trimmedValue);
        if (!isNaN(priceValue) && priceValue >= 0) {
          setReplacements(prev => ({
            ...prev,
            [itemId]: {
              ...prev[itemId],
              manual_unit_price: priceValue,
            }
          }));
        }
      }
    }
  };

  const handleReturnTagChange = (itemId: number, tag: 'returned' | 'defective' | 'unknown') => {
    setReplacements(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        return_tag: tag,
      }
    }));
  };

  const handleProductSearchChange = (itemId: number, value: string) => {
    setProductSearch(prev => ({ ...prev, [itemId]: value }));
    setShowProductDropdown(prev => ({ ...prev, [itemId]: value.trim().length > 0 }));
    setActiveProductSearchItemId(itemId);
    setProductSearchSelectedIndex(prev => ({ ...prev, [itemId]: -1 }));
  };

  const handleProductSearchKeyDown = async (itemId: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const products = getProductsForItem(itemId);
    const searchValue = productSearch[itemId] || '';

    if (e.key === 'Enter') {
      e.preventDefault();
      if (productSearchSelectedIndex[itemId] >= 0 && products.length > 0) {
        const product = products[productSearchSelectedIndex[itemId]];
        if (product) {
          await handleProductSelect(itemId, product);
          return;
        }
      }

      // If barcode check found a product, select it
      if (barcodeCheckQuery.data?.product && !barcodeCheckQuery.data.isUnavailable && activeProductSearchItemId === itemId) {
        await handleProductSelect(itemId, barcodeCheckQuery.data.product, searchValue.trim());
        return;
      }

      // Try barcode lookup
      if (searchValue.trim().length >= 3 && looksLikeBarcode(searchValue.trim())) {
        try {
          const barcodeCheck = await productsApi.byBarcode(searchValue.trim(), strictBarcodeMode);
          if (barcodeCheck.data && barcodeCheck.data.barcode_available) {
            await handleProductSelect(itemId, barcodeCheck.data, searchValue.trim());
            setProductSearch(prev => ({ ...prev, [itemId]: '' }));
            return;
          }
        } catch (error) {
          // Barcode not found, continue with normal search
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (products.length > 0) {
        setProductSearchSelectedIndex(prev => ({ ...prev, [itemId]: 0 }));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = productSearchSelectedIndex[itemId] || -1;
      if (currentIndex > 0) {
        setProductSearchSelectedIndex(prev => ({ ...prev, [itemId]: currentIndex - 1 }));
      }
    } else if (e.key === 'Escape') {
      setShowProductDropdown(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleProcessReplacement = () => {
    if (!invoice) return;

    console.log('=== handleProcessReplacement START ===');
    console.log('All replacements:', replacements);

    const replacementsToProcess: Array<{
      invoice_item_id: number;
      new_product_id: number;
      store_id?: number;
      new_unit_price?: number;
      manual_unit_price?: number;
      scanned_barcode?: string;
      scanned_original_barcode?: string;
      return_tag?: string;
    }> = [];
    const involvedInvoiceIds = new Set<number>();

    Object.values(replacements).forEach(replacement => {
      console.log('Processing replacement:', replacement);

      if (replacement.new_product_id && replacement.quantity > 0) {
        const sourceItem = invoice.items.find((item) => item.id === replacement.item_id);
        if (!sourceItem) {
          return;
        }
        if (sourceItem.source_invoice_id) {
          involvedInvoiceIds.add(sourceItem.source_invoice_id);
        }
        const replacementData: any = {
          invoice_item_id: replacement.item_id,
          new_product_id: replacement.new_product_id,
          store_id: sourceItem.source_store ?? invoice.store,
          return_tag: replacement.return_tag,
        };

        // Include the scanned barcode if available
        if (replacement.scanned_barcode) {
          replacementData.scanned_barcode = replacement.scanned_barcode;
          console.log('✅ Adding scanned_barcode:', replacement.scanned_barcode);
        } else {
          console.log('❌ NO scanned_barcode in replacement!', replacement);
        }

        const origSticker = invoiceLineSticker(sourceItem);
        if (origSticker) {
          replacementData.scanned_original_barcode = origSticker;
        }

        const oldSale = parseFloat(sourceItem.manual_unit_price || sourceItem.unit_price || '0');
        const chargePrice =
          replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
            ? replacement.manual_unit_price
            : (
              replacement.new_unit_price !== null &&
              replacement.new_unit_price !== undefined &&
              replacement.new_unit_price > 0
                ? replacement.new_unit_price
                : oldSale
            );
        replacementData.manual_unit_price = chargePrice;

        console.log('Final replacementData:', replacementData);
        replacementsToProcess.push(replacementData);
      }
    });

    console.log('=== Sending to backend:', replacementsToProcess);
    console.log('=== handleProcessReplacement END ===');

    if (replacementsToProcess.length === 0) {
      showToast('Please select at least one item with a replacement product', 'info');
      return;
    }
    const missingStatus = replacementsToProcess.some((replacement) => !replacement.return_tag);
    if (missingStatus) {
      showToast('Please select return status for all selected items', 'error');
      return;
    }

    const barcodeUsage = new Map<string, number>();
    for (const replacement of replacementsToProcess) {
      const key = (replacement.scanned_barcode || '').trim().toUpperCase();
      if (!key) continue;
      barcodeUsage.set(key, (barcodeUsage.get(key) || 0) + 1);
    }
    const duplicateCodes = [...barcodeUsage.entries()]
      .filter(([, count]) => count > 1)
      .map(([code]) => code);
    if (duplicateCodes.length > 0) {
      showToast(
        `Duplicate replacement barcode/short code selected: ${duplicateCodes.join(', ')}. Use a unique code per item.`,
        'error'
      );
      return;
    }

    if (!confirm('Are you sure you want to process this replacement? Old items will be returned to stock and new items will be added to the invoice.')) {
      return;
    }

    // Process replacements one by one
    processReplacementMutation.mutate({
      invoiceIds: Array.from(involvedInvoiceIds),
      replacements: replacementsToProcess,
    });
  };

  const handleReset = async () => {
    await releaseAllReservedBarcodes();
    setSearchValue('');
    setInvoice(null);
    setReplacements({});
    setProductSearch({});
    setSearchError(null);
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  const selectedReplacementRows = Object.values(replacements).filter((r) => r.quantity > 0);
  const hasReplacements = selectedReplacementRows.length > 0;
  const allSelectedHaveReplacementProduct = selectedReplacementRows.every((r) => r.new_product_id !== null);
  const allSelectedHaveReturnStatus = selectedReplacementRows.every((r) => Boolean(r.return_tag));
  const selectedReplacementItemIds = new Set(Object.keys(replacements).map((id) => Number(id)));
  const involvedInvoiceNumbers = invoice
    ? [...new Set(invoice.items
      .filter((item) => selectedReplacementItemIds.has(item.id))
      .map((item) => item.source_invoice_number || invoice.invoice_number))]
    : [];

  // Get products for each item
  const getProductsForItem = (itemId: number) => {
    if (activeProductSearchItemId !== itemId) return [];

    const productList: any[] = [];

    // Add barcode-check product if available (highest priority)
    if (barcodeCheckQuery.data?.product && !barcodeCheckQuery.data.isUnavailable) {
      productList.push(barcodeCheckQuery.data.product);
    }

    // Add products from search results
    if (productSearchQuery?.data) {
      const data = productSearchQuery.data;
      const existingIds = new Set(productList.map(p => p.id));

      if (Array.isArray(data?.results)) {
        productList.push(...data.results.filter((p: any) => !existingIds.has(p.id)));
      } else if (Array.isArray(data?.data)) {
        productList.push(...data.data.filter((p: any) => !existingIds.has(p.id)));
      } else if (Array.isArray(data)) {
        productList.push(...data.filter((p: any) => !existingIds.has(p.id)));
      }
    }

    return productList;
  };

  const handleProductBarcodeScan = (itemId: number, barcode: string) => {
    setProductSearch(prev => ({ ...prev, [itemId]: barcode }));
    setShowProductScanner(prev => ({ ...prev, [itemId]: false }));
    setActiveProductSearchItemId(itemId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={async () => {
            await handleReset();
            navigate('/replacement');
          }}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">Replace Product</h1>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-2">Product Replacement:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Find the invoice containing items to replace</li>
              <li>Select items and choose replacement products (same or different)</li>
              <li>Old items will be returned to stock, new items will be added to invoice</li>
              <li>Price difference will be adjusted in customer ledger</li>
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
                          {inv.customer_name || 'N/A'} • {inv.store_name || 'N/A'} • {formatAppDate(inv.created_at, { empty: '' })}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                  <Button
                    onClick={() => setStrictBarcodeMode(!strictBarcodeMode)}
                    variant="outline"
                    size="sm"
                    className={`whitespace-nowrap transition-all ${strictBarcodeMode
                      ? '!bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700 hover:!border-blue-700'
                      : '!bg-white !text-gray-600 !border-gray-300 hover:!bg-gray-50'
                      }`}
                    title={strictBarcodeMode ? "Strict barcode matching (ON)" : "Flexible search (OFF)"}
                  >
                    <Barcode className="h-4 w-4" />
                  </Button>
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
                  <h3 className="font-semibold text-lg">Customer Context</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-gray-600 block text-xs">Customer</span>
                    <span className="font-medium">{invoice.customer_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Invoices in Selection</span>
                    <span className="font-medium">
                      {involvedInvoiceNumbers.length > 0 ? involvedInvoiceNumbers.join(', ') : invoice.invoice_number}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Store</span>
                    <span className="font-medium">{invoice.store_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 block text-xs">Date</span>
                    <span className="font-medium">
                      {formatAppDate(invoice.created_at, { empty: '' })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Invoice Items - backend returns only matching barcode/SKU items when search was by barcode/SKU */}
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-900">Select Items to Replace</h3>
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {invoice.items.map((item) => {
                    const replacement = replacements[item.id];
                    const isSelected = Boolean(replacement);
                    const maxQuantity = item.available_quantity;
                    const selectedQuantity = replacement?.quantity || 0;
                    const products = getProductsForItem(item.id);
                    const showDropdown = showProductDropdown[item.id] && products.length > 0;

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
                                Current Price: ₹{formatNumber(item.manual_unit_price || item.unit_price || 0)} per unit
                              </div>
                            </div>
                          </div>
                          {isSelected && (
                            <div className="flex items-center gap-2 self-start">
                              <span className="text-sm text-gray-700">Qty:</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (selectedQuantity > 1) {
                                    handleQuantityChange(item.id, String(selectedQuantity - 1), maxQuantity);
                                  }
                                }}
                                disabled={selectedQuantity <= 1}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input
                                type="number"
                                step="1"
                                value={selectedQuantity}
                                onChange={(e) => handleQuantityChange(item.id, e.target.value, maxQuantity)}
                                min={1}
                                max={maxQuantity}
                                className="w-16 text-center"
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
                          )}
                          {isSelected && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleReturnTagChange(item.id, 'returned')}
                                className={`w-5 h-5 rounded-full bg-green-500 border-2 transition-all hover:scale-110 ${replacement.return_tag === 'returned'
                                  ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-green-200'
                                  : 'border-transparent opacity-30 hover:opacity-60'
                                  }`}
                                title="Returned (Good condition)"
                              />
                              <button
                                type="button"
                                onClick={() => handleReturnTagChange(item.id, 'defective')}
                                className={`w-5 h-5 rounded-full bg-red-500 border-2 transition-all hover:scale-110 ${replacement.return_tag === 'defective'
                                  ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-red-200'
                                  : 'border-transparent opacity-30 hover:opacity-60'
                                  }`}
                                title="Defective"
                              />
                              <button
                                type="button"
                                onClick={() => handleReturnTagChange(item.id, 'unknown')}
                                className={`w-5 h-5 rounded-full bg-yellow-400 border-2 transition-all hover:scale-110 ${replacement.return_tag === 'unknown'
                                  ? 'border-gray-900 scale-110 shadow-sm ring-1 ring-yellow-200'
                                  : 'border-transparent opacity-30 hover:opacity-60'
                                  }`}
                                title="Unknown"
                              />
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${replacement.return_tag === 'returned' ? 'text-green-700 bg-green-50' :
                                replacement.return_tag === 'defective' ? 'text-red-700 bg-red-50' :
                                  replacement.return_tag === 'unknown' ? 'text-yellow-700 bg-yellow-50' :
                                    'text-gray-700 bg-gray-100'
                                }`}>
                                {replacement.return_tag || 'select'}
                              </span>
                            </div>
                          )}
                        </div>

                        {isSelected && (
                          <div className="mt-3 ml-7 space-y-4">
                            {/* Product Search */}
                            <div className="relative">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Replacement Product:
                              </label>
                              <div className="relative">
                                <Input
                                  type="text"
                                  value={productSearch[item.id] || ''}
                                  onChange={(e) => handleProductSearchChange(item.id, e.target.value)}
                                  onKeyDown={(e) => handleProductSearchKeyDown(item.id, e)}
                                  placeholder="Search by name, SKU, or scan barcode / short code..."
                                  className="w-full pr-32"
                                />
                                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                                  <Button
                                    onClick={() => setStrictBarcodeMode(!strictBarcodeMode)}
                                    variant="outline"
                                    size="sm"
                                    className={`whitespace-nowrap transition-all ${strictBarcodeMode
                                      ? '!bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700 hover:!border-blue-700'
                                      : '!bg-white !text-gray-600 !border-gray-300 hover:!bg-gray-50'
                                      }`}
                                    title={strictBarcodeMode ? "Strict barcode matching (ON)" : "Flexible search (OFF)"}
                                  >
                                    <Barcode className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    onClick={() => setShowProductScanner(prev => ({ ...prev, [item.id]: true }))}
                                    variant="outline"
                                    size="sm"
                                    className="whitespace-nowrap"
                                    title="Open camera scanner"
                                  >
                                    <Camera className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {/* Barcode Scanner for Product Search */}
                              {showProductScanner[item.id] && (
                                <div className="mt-2 border rounded-lg p-4 bg-gray-50 flex justify-center">
                                  <div className="w-full max-w-sm">
                                    <BarcodeScanner
                                      isOpen={showProductScanner[item.id]}
                                      continuous={true}
                                      onScan={(barcode) => handleProductBarcodeScan(item.id, barcode)}
                                      onClose={() => setShowProductScanner(prev => ({ ...prev, [item.id]: false }))}
                                    />
                                  </div>
                                </div>
                              )}

                              {showDropdown && (
                                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                  {products.length === 0 ? (
                                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                                      No products found
                                    </div>
                                  ) : (
                                    products.map((product: any, index: number) => {
                                      const isSelected = (productSearchSelectedIndex[item.id] || -1) === index;
                                      return (
                                        <button
                                          key={product.id}
                                          type="button"
                                          onClick={() => { void handleProductSelect(item.id, product, productSearch[item.id]); }}
                                          className={`w-full text-left px-4 py-3 hover:bg-blue-50 border-b last:border-b-0 transition-colors ${isSelected ? 'bg-blue-50' : ''
                                            }`}
                                        >
                                          <div className="font-medium text-gray-900">{product.name}</div>
                                          <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                                            {product.matched_barcode && (
                                              <div>Short Code: {product.matched_barcode}</div>
                                            )}
                                            {product.barcode && product.barcode !== product.matched_barcode && (
                                              <div>Barcode: {product.barcode}</div>
                                            )}
                                            {!product.matched_barcode && !product.barcode && product.sku && (
                                              <div>SKU: {product.sku}</div>
                                            )}
                                          </div>
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              )}

                              {/* Barcode status message */}
                              {activeProductSearchItemId === item.id && barcodeCheckQuery.data?.isUnavailable && (
                                <div className="mt-2 text-sm text-red-600 flex items-center gap-1">
                                  <AlertTriangle className="h-4 w-4" />
                                  {barcodeCheckQuery.data.product?.barcode_status_message || 'This barcode is not available'}
                                </div>
                              )}

                              {replacement?.new_product_name && (
                                <>
                                  <div className="mt-2 text-sm text-green-600 flex items-center gap-1">
                                    <Package className="h-4 w-4" />
                                    Selected: {replacement.new_product_name}
                                    {replacement.selected_short_code && (
                                      <span className="text-gray-600">
                                        (short: {replacement.selected_short_code})
                                      </span>
                                    )}
                                  </div>

                                  {/* Price: original sale + cost ref (read-only) + charge (editable) */}
                                  <div className="mt-3 space-y-2">
                                    <label className="block text-sm font-medium text-gray-700">
                                      Pricing (replacement)
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                      <div>
                                        <span className="text-gray-600 block text-xs">Original sale (this line)</span>
                                        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-900 font-medium">
                                          ₹{formatNumber(item.manual_unit_price || item.unit_price || 0)}
                                        </div>
                                        <span className="text-[10px] text-gray-500 mt-0.5 block">From invoice — not editable</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-600 block text-xs">Purchase cost (this piece)</span>
                                        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-900 font-medium">
                                          {replacement.reference_purchase_cost != null && replacement.reference_purchase_cost !== undefined
                                            ? `₹${formatNumber(replacement.reference_purchase_cost)}`
                                            : '—'}
                                        </div>
                                        <span className="text-[10px] text-gray-500 mt-0.5 block">From barcode — not editable</span>
                                      </div>
                                      <div>
                                        <span className="text-gray-600 block text-xs">Charge for replacement (per unit)</span>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={
                                              replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                                ? replacement.manual_unit_price.toString()
                                                : (replacement.new_unit_price !== null && replacement.new_unit_price !== undefined
                                                  ? replacement.new_unit_price.toString()
                                                  : '')
                                            }
                                            onChange={(e) => handlePriceChange(item.id, e.target.value)}
                                            placeholder={
                                              replacement.new_unit_price !== null && replacement.new_unit_price !== undefined
                                                ? `e.g. ₹${formatNumber(replacement.new_unit_price)}`
                                                : `e.g. ₹${formatNumber(item.manual_unit_price || item.unit_price || 0)}`
                                            }
                                            className="w-full h-9"
                                          />
                                        </div>
                                        <span className="text-[10px] text-gray-500 mt-1 block">
                                          What you charge for the new item (defaults to list price from scan)
                                        </span>
                                      </div>
                                    </div>

                                    {/* Price Difference Indicator */}
                                    <div className="mt-2 p-2 bg-gray-50 rounded border">
                                      <div className="flex justify-between items-center text-xs">
                                        <span className="text-gray-600 font-medium">Price Diff (Total):</span>
                                        {(() => {
                                          const originalPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                                          const currentPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                            ? replacement.manual_unit_price
                                            : (
                                              replacement.new_unit_price !== null &&
                                              replacement.new_unit_price !== undefined &&
                                              replacement.new_unit_price > 0
                                                ? replacement.new_unit_price
                                                : originalPrice
                                            );
                                          const diff = currentPrice - originalPrice;
                                          const totalDiff = diff * selectedQuantity;

                                          return (
                                            <span className={`font-bold ${totalDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                              {totalDiff >= 0 ? `+₹${formatNumber(totalDiff)}` : `₹${formatNumber(totalDiff)}`}
                                            </span>
                                          );
                                        })()}
                                      </div>
                                      <div className="text-[10px] text-gray-500 mt-1">
                                        {(() => {
                                          const originalPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                                          const currentPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                            ? replacement.manual_unit_price
                                            : (
                                              replacement.new_unit_price !== null &&
                                              replacement.new_unit_price !== undefined &&
                                              replacement.new_unit_price > 0
                                                ? replacement.new_unit_price
                                                : originalPrice
                                            );
                                          const diff = currentPrice - originalPrice;

                                          if (diff === 0) return 'No price difference per unit';
                                          return diff > 0
                                            ? `Customer pays ₹${formatNumber(diff)} more per unit`
                                            : `Customer gets ₹${formatNumber(Math.abs(diff))} refund per unit`;
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              {hasReplacements && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-5 w-5 text-blue-600" />
                    <span className="font-semibold text-blue-900">Replacement Summary</span>
                  </div>
                  <div className="text-sm text-blue-800 space-y-1">
                    <div>Total items to replace: {Object.values(replacements).filter(r => r.new_product_id).length}</div>
                    <div className="mt-2 pt-2 border-t border-blue-300">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4" />
                        <span className="font-semibold">Price Adjustments:</span>
                      </div>
                      {(() => {
                        let totalPriceDiff = 0;
                        Object.values(replacements).forEach(replacement => {
                          if (replacement.new_product_id) {
                            const item = invoice.items.find(i => i.id === replacement.item_id);
                            if (item) {
                              const oldPrice = parseFloat(item.manual_unit_price || item.unit_price || '0');
                              const newPrice = replacement.manual_unit_price !== null && replacement.manual_unit_price !== undefined
                                ? replacement.manual_unit_price
                                : (
                                  replacement.new_unit_price !== null &&
                                  replacement.new_unit_price !== undefined &&
                                  replacement.new_unit_price > 0
                                    ? replacement.new_unit_price
                                    : oldPrice
                                );
                              const diff = (newPrice - oldPrice) * replacement.quantity;
                              totalPriceDiff += diff;
                            }
                          }
                        });
                        return (
                          <div className={`font-semibold ${totalPriceDiff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            Total Adjustment: {totalPriceDiff >= 0 ? `+₹${formatNumber(totalPriceDiff)}` : `₹${formatNumber(totalPriceDiff)}`}
                            {totalPriceDiff > 0 && <span className="text-xs font-normal text-gray-600 ml-2">(Customer pays more)</span>}
                            {totalPriceDiff < 0 && <span className="text-xs font-normal text-gray-600 ml-2">(Customer gets refund)</span>}
                            {totalPriceDiff === 0 && <span className="text-xs font-normal text-gray-600 ml-2">(No change)</span>}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={processReplacementMutation.isPending}
                >
                  Reset
                </Button>
                <Button
                  variant="primary"
                  onClick={handleProcessReplacement}
                  disabled={!hasReplacements || !allSelectedHaveReplacementProduct || !allSelectedHaveReturnStatus || processReplacementMutation.isPending}
                >
                  {processReplacementMutation.isPending ? 'Processing...' : 'Process Replacement'}
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

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
