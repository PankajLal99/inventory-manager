import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, Fragment, useMemo } from 'react';
import { posApi, productsApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import {
  FileText,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Store,
  ShoppingBag,
  Coins,
  Printer,
  Download,
  Edit,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Pencil,
} from 'lucide-react';

export default function InvoiceDetail() {
  const user = auth.getUser();
  const userGroups = user?.groups || [];
  const isRestrictedUser = (userGroups.includes('Retail') || userGroups.includes('Wholesale')) &&
    !userGroups.includes('Admin') &&
    !userGroups.includes('RetailAdmin') &&
    !userGroups.includes('WholesaleAdmin');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invoiceId = parseInt(id || '0');
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi' | 'card' | 'bank_transfer' | 'credit' | 'other'>('cash');
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [deleteRestoreStock, setDeleteRestoreStock] = useState(true);
  const [checkoutInvoiceType, setCheckoutInvoiceType] = useState<'cash' | 'upi' | 'pending' | 'mixed'>('pending');
  const [checkoutCashAmount, setCheckoutCashAmount] = useState<string>('');
  const [checkoutUpiAmount, setCheckoutUpiAmount] = useState<string>('');
  const [checkoutQuantities, setCheckoutQuantities] = useState<Record<number, string>>({});
  const [checkoutPrices, setCheckoutPrices] = useState<Record<number, string>>({});
  const [parentGroupPrices, setParentGroupPrices] = useState<Record<string, string>>({});
  const [checkoutPriceErrors, setCheckoutPriceErrors] = useState<Record<string, string>>({});
  const [barcodeInput, setBarcodeInput] = useState('');
  const [debouncedBarcodeInput, setDebouncedBarcodeInput] = useState('');
  const [productSearchSelectedIndex, setProductSearchSelectedIndex] = useState(-1);
  const [isSearchTyped, setIsSearchTyped] = useState(false);
  const [editingPrice, setEditingPrice] = useState<Record<number, string>>({});
  const [showPriceInput, setShowPriceInput] = useState<Record<number, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedInvoiceItems, setExpandedInvoiceItems] = useState<Record<string, boolean>>({});
  const [editingInvoiceType, setEditingInvoiceType] = useState(false);
  const [editingStore, setEditingStore] = useState(false);
  const [selectedInvoiceType, setSelectedInvoiceType] = useState<string>('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => posApi.invoices.get(invoiceId),
    enabled: !!invoiceId,
    retry: false,
  });

  // Fetch stores list
  const { data: storesData } = useQuery({
    queryKey: ['stores'],
    queryFn: () => catalogApi.stores.list(),
    retry: false,
  });

  const stores = storesData?.data || [];

  // Mutations - must be defined before any early returns
  const checkoutMutation = useMutation({
    mutationFn: (data: { invoice_type: 'cash' | 'upi' | 'pending' | 'mixed'; items: any[]; cash_amount?: number; upi_amount?: number }) => {
      return posApi.invoices.checkout(invoiceId, data);
    },
    onSuccess: async (_, variables) => {
      // Invalidate and refetch to get updated totals
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowCheckoutModal(false);
      setCheckoutQuantities({});
      setCheckoutPrices({});
      setCheckoutPriceErrors({});
      setCheckoutCashAmount('');
      setCheckoutUpiAmount('');
      if (variables.invoice_type === 'pending') {
        alert('Prices saved successfully! Invoice remains as draft.');
      } else {
        alert('Invoice checked out successfully!');
      }
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to checkout invoice';
      alert(errorMsg);
    },
  });

  const markCreditMutation = useMutation({
    mutationFn: (itemsData: any[]) => posApi.invoices.markCredit(invoiceId, { items: itemsData }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      setShowCheckoutModal(false);
      setCheckoutQuantities({});
      setCheckoutPrices({});
      setCheckoutPriceErrors({});
      alert('Invoice marked as credit and moved to ledger successfully!');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to mark invoice as credit';
      alert(errorMsg);
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: any }) =>
      posApi.invoices.updateItem(invoiceId, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to update item');
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => posApi.invoices.deleteItem(invoiceId, itemId),
    onSuccess: async () => {
      // Invalidate and refetch to get updated invoice without deleted items
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to delete item');
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (data: { payment_method: string; amount: number; reference?: string; notes?: string }) =>
      posApi.invoices.payments(invoiceId, data),
    onSuccess: async () => {
      // Invalidate and refetch to get updated invoice with payment
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentMethod('cash');
      alert('Payment recorded successfully!');
    },
    onError: (error: any) => {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to record payment';
      alert(errorMsg);
    },
  });

  const addItemMutation = useMutation({
    mutationFn: (data: any) => posApi.invoices.addItem(invoiceId, data),
    onSuccess: async () => {
      // Invalidate and refetch to get updated invoice with new items
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      setBarcodeInput('');
      setProductSearchSelectedIndex(-1);
      setIsSearchTyped(false);
    },
    onError: (error: any) => {
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.response?.data?.detail || error?.response?.data || 'Failed to add item';
      console.error('Add item error:', error?.response?.data);
      // Show detailed error including serializer errors
      if (error?.response?.data && typeof error.response.data === 'object') {
        const errorDetails = Object.entries(error.response.data)
          .map(([key, value]: [string, any]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
          .join('\n');
        alert(`Failed to add item:\n\n${errorDetails}`);
      } else {
        alert(errorMessage);
      }
    },
  });

  // Debounce barcode input for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedBarcodeInput(barcodeInput);
    }, 300);
    return () => clearTimeout(handler);
  }, [barcodeInput]);

  // Helper function to detect if input looks like a barcode
  const looksLikeBarcode = (input: string): boolean => {
    if (!input || input.length < 3) return false;
    const barcodePattern = /^[A-Za-z0-9\-_]+$/;
    return barcodePattern.test(input) && (input.length >= 4 || input.includes('-') || input.includes('_'));
  };

  const trimmedBarcodeInput = useMemo(() => debouncedBarcodeInput.trim(), [debouncedBarcodeInput]);

  // Barcode check query
  const { data: barcodeCheck } = useQuery({
    queryKey: ['barcode-check-invoice', trimmedBarcodeInput],
    queryFn: async () => {
      if (!trimmedBarcodeInput || trimmedBarcodeInput.length < 3) return null;
      if (!looksLikeBarcode(trimmedBarcodeInput)) return null;

      try {
        const response = await productsApi.byBarcode(trimmedBarcodeInput, true);
        if (response.data) {
          return { product: response.data, isUnavailable: !response.data.barcode_available };
        }
      } catch (error: any) {
        // Not a barcode or not found
        return null;
      }
      return null;
    },
    enabled: trimmedBarcodeInput.length >= 3 && looksLikeBarcode(trimmedBarcodeInput),
    retry: false,
  });

  // Product search query
  const { data: products } = useQuery({
    queryKey: ['products-invoice', debouncedBarcodeInput],
    queryFn: async () => {
      const params: any = { search: debouncedBarcodeInput };
      const response = await productsApi.list(params);
      return response.data;
    },
    enabled: debouncedBarcodeInput.trim().length > 0
      && !(looksLikeBarcode(debouncedBarcodeInput.trim()) && barcodeCheck?.product && !barcodeCheck?.isUnavailable),
    retry: false,
  });


  const deleteInvoiceMutation = useMutation({
    mutationFn: ({ force, restoreStock }: { force: boolean; restoreStock: boolean }) =>
      posApi.invoices.delete(invoiceId, force, restoreStock),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Refresh products to show updated stock
      setShowDeleteModal(false);
      navigate('/invoices');
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Failed to delete invoice');
    },
  });

  const updateInvoiceMutation = useMutation({
    mutationFn: (data: { invoice_type?: string; store?: number }) =>
      posApi.invoices.update(invoiceId, data),
    onSuccess: async () => {
      // Invalidate and refetch to get updated totals
      await queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setEditingInvoiceType(false);
      setEditingStore(false);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || error?.response?.data?.message || 'Failed to update invoice');
    },
  });

  // When invoice items change and checkout modal is open, initialize new items
  useEffect(() => {
    const inv = invoice?.data;
    if (showCheckoutModal && inv?.items && Array.isArray(inv.items)) {
      const newQuantities = { ...checkoutQuantities };
      const newPrices = { ...checkoutPrices };
      const newParentPrices = { ...parentGroupPrices };
      let hasNewItems = false;

      // Check for new items that aren't in checkoutQuantities
      inv.items.forEach((item: any) => {
        if (!(item.id in checkoutQuantities)) {
          // New item - initialize it
          newQuantities[item.id] = item.quantity.toString();
          newPrices[item.id] = (item.manual_unit_price || item.unit_price || '0').toString();
          hasNewItems = true;
        }
      });

      // Update parent prices for any new groups
      if (hasNewItems) {
        const groupedItems = groupItemsByProduct(inv.items);
        groupedItems.forEach((group, groupIndex) => {
          const groupKey = `group_${group.productId}_${groupIndex}`;
          if (!(groupKey in parentGroupPrices)) {
            const firstItem = group.items[0];
            const basePrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
            newParentPrices[groupKey] = basePrice;
          }
        });
      }

      if (hasNewItems) {
        setCheckoutQuantities(newQuantities);
        setCheckoutPrices(newPrices);
        setParentGroupPrices(newParentPrices);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.data?.items?.length, showCheckoutModal]); // Only run when item count changes or modal opens

  // Early returns after all hooks
  if (isLoading) {
    return <LoadingState message="Loading invoice details..." />;
  }

  if (error || !invoice?.data) {
    return (
      <ErrorState
        message="Invoice not found or failed to load"
        onRetry={() => navigate('/invoices')}
      />
    );
  }

  const inv = invoice.data;

  const statusConfig: Record<string, { label: string; color: 'success' | 'warning' | 'danger' | 'info' | 'default'; icon: any }> = {
    draft: { label: 'Draft', color: 'default', icon: Clock },
    paid: { label: 'Paid', color: 'success', icon: CheckCircle },
    partial: { label: 'Partial', color: 'warning', icon: Clock },
    credit: { label: 'Credit', color: 'info', icon: Coins },
    void: { label: 'Void', color: 'danger', icon: XCircle },
    pending: { label: 'Pending', color: 'warning', icon: Clock },
    sale: { label: 'Sale', color: 'success', icon: CheckCircle },
  };

  const StatusIcon = statusConfig[inv.status]?.icon || FileText;
  const statusInfo = statusConfig[inv.status] || statusConfig.draft;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(parseFloat(String(amount || '0')));
  };

  // Convert number to words (Indian numbering system)
  const numberToWords = (num: number): string => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    if (num === 0) return 'Zero Rupees Only';

    const convertHundreds = (n: number): string => {
      if (n === 0) return '';
      let result = '';
      if (n >= 100) {
        result += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 20) {
        result += tens[Math.floor(n / 10)] + ' ';
        n %= 10;
      }
      if (n > 0) {
        result += ones[n] + ' ';
      }
      return result.trim();
    };

    const convert = (n: number): string => {
      if (n === 0) return '';

      // Crore
      if (n >= 10000000) {
        const crores = Math.floor(n / 10000000);
        const remainder = n % 10000000;
        return convertHundreds(crores) + 'Crore ' + convert(remainder);
      }

      // Lakh
      if (n >= 100000) {
        const lakhs = Math.floor(n / 100000);
        const remainder = n % 100000;
        return convertHundreds(lakhs) + 'Lakh ' + convert(remainder);
      }

      // Thousand
      if (n >= 1000) {
        const thousands = Math.floor(n / 1000);
        const remainder = n % 1000;
        return convertHundreds(thousands) + 'Thousand ' + convert(remainder);
      }

      // Hundreds, Tens, Ones
      return convertHundreds(n);
    };

    const integerPart = Math.floor(num);
    const decimalPart = Math.round((num % 1) * 100);

    let result = convert(integerPart).trim();

    if (result) {
      result += ' Rupees';
    } else {
      result = 'Zero Rupees';
    }

    if (decimalPart > 0) {
      const paiseWords = convert(decimalPart).trim();
      if (paiseWords) {
        result += ' and ' + paiseWords + ' Paise';
      }
    }

    return result + ' Only';
  };

  const formatDateForInvoice = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Check if invoice is editable (draft credit or pending)
  const isEditable = inv.status === 'draft' && (inv.invoice_type === 'credit' || inv.invoice_type === 'pending');
  const isPending = inv.invoice_type === 'pending' && inv.status === 'draft';

  // Group items by product only (not by barcode)
  const groupItemsByProduct = (items: any[]) => {
    const grouped = new Map<number, {
      productId: number;
      productName: string;
      items: any[];
      totalQuantity: number;
      isTrackedInventory: boolean;
    }>();

    items.forEach((item: any) => {
      const productId = item.product || item.product_id || 0;

      if (grouped.has(productId)) {
        const group = grouped.get(productId)!;
        group.items.push(item);
        group.totalQuantity += parseInt(item.quantity || '0') || 0;
      } else {
        grouped.set(productId, {
          productId: productId,
          productName: item.product_name || '-',
          items: [item],
          totalQuantity: parseInt(item.quantity || '0') || 0,
          isTrackedInventory: item.product_track_inventory === true,
        });
      }
    });

    return Array.from(grouped.values());
  };

  // Check if all items have prices entered
  const areAllPricesEntered = (): boolean => {
    if (!inv?.items || inv.items.length === 0) return false;

    // Filter out items with quantity 0
    const activeItems = inv.items.filter((item: any) => {
      const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
      return parseFloat(qty) > 0;
    });

    if (activeItems.length === 0) return false;

    // Group items to get parent prices (same logic as calculateCheckoutTotal)
    const groupedItems = groupItemsByProduct(activeItems);

    for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex++) {
      const group = groupedItems[groupIndex];
      const groupKey = `group_${group.productId}_${groupIndex}`;
      const parentPrice = parentGroupPrices[groupKey];

      // Check if parent price is set
      if (!parentPrice || parseFloat(parentPrice.toString()) <= 0) {
        return false;
      }

      // Check each item in the group (individual item prices override parent price)
      for (const item of group.items) {
        const itemPrice = checkoutPrices[item.id];
        // If item has individual price, use it; otherwise use parent price
        const effectivePrice = itemPrice ?? parentPrice;
        if (!effectivePrice || parseFloat(effectivePrice.toString()) <= 0) {
          return false;
        }
      }
    }

    return true;
  };

  // Helper function to calculate invoice total from checkout prices
  const calculateCheckoutTotal = (): number => {
    if (!inv?.items || !Array.isArray(inv.items)) return 0;

    // Filter out items with quantity 0
    const activeItems = inv.items.filter((item: any) => {
      const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
      return parseFloat(qty) > 0;
    });

    if (activeItems.length === 0) return 0;

    // Group items to get parent prices
    const groupedItems = groupItemsByProduct(activeItems);
    const groupPriceMap: Record<number, string> = {}; // Map item.id to parent group price

    groupedItems.forEach((group, groupIndex) => {
      const groupKey = `group_${group.productId}_${groupIndex}`;
      const parentPrice = parentGroupPrices[groupKey];
      group.items.forEach((item: any) => {
        groupPriceMap[item.id] = parentPrice;
      });
    });

    return activeItems.reduce((sum: number, item: any) => {
      const quantity = checkoutQuantities[item.id] ?? item.quantity.toString();
      // Use checkoutPrices first, then fall back to parentGroupPrices, then original price
      let price = checkoutPrices[item.id];
      if (!price || price === '' || price === '0') {
        price = groupPriceMap[item.id];
      }
      if (!price || price === '' || price === '0') {
        price = (item.manual_unit_price || item.unit_price || '0').toString();
      }

      const qty = parseFloat(quantity) || 0;
      const prc = parseFloat(price) || 0;
      return sum + (qty * prc);
    }, 0);
  };

  // Helper function to validate price threshold
  const validatePriceThreshold = (price: string, item: any): string | null => {
    if (!price || price.trim() === '' || parseFloat(price) <= 0) {
      return null; // No validation needed for empty or zero prices
    }

    const salePrice = parseFloat(price);
    if (isNaN(salePrice)) {
      return null;
    }

    // Get selling_price first, then fall back to purchase_price
    const sellingPrice = item.product_selling_price && item.product_selling_price > 0
      ? parseFloat(item.product_selling_price)
      : null;
    const purchasePrice = parseFloat(item.product_purchase_price || '0');

    // Use selling_price if available and > 0, otherwise use purchase_price
    const minPrice = sellingPrice !== null && sellingPrice > 0 ? sellingPrice : purchasePrice;
    const canGoBelow = item.product_can_go_below_purchase_price || false;

    // Validate price threshold if product doesn't allow going below purchase/selling price
    if (!canGoBelow && minPrice > 0 && salePrice < minPrice) {
      const priceType = sellingPrice !== null && sellingPrice > 0 ? 'selling price' : 'purchase price';
      return `Price cannot be less than ${priceType} (₹${minPrice.toFixed(2)})`;
    }

    return null;
  };

  const handleCheckout = () => {
    // Initialize checkout quantities and prices from current invoice items
    const initialQuantities: Record<number, string> = {};
    const initialPrices: Record<number, string> = {};
    const initialParentPrices: Record<string, string> = {};

    // Group items to initialize parent prices
    if (inv?.items && Array.isArray(inv.items)) {
      const groupedItems = groupItemsByProduct(inv.items);
      groupedItems.forEach((group, groupIndex) => {
        const groupKey = `group_${group.productId}_${groupIndex}`;
        const firstItem = group.items[0];
        const basePrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
        initialParentPrices[groupKey] = basePrice;
      });
    }

    inv?.items?.forEach((item: any) => {
      initialQuantities[item.id] = item.quantity.toString();
      initialPrices[item.id] = (item.manual_unit_price || item.unit_price || '0').toString();
    });
    setCheckoutQuantities(initialQuantities);
    setCheckoutPrices(initialPrices);
    setParentGroupPrices(initialParentPrices);
    setCheckoutPriceErrors({}); // Clear any previous errors
    setCheckoutInvoiceType('pending'); // Default to pending (draft saving)
    setShowCheckoutModal(true);
  };

  const handleCheckoutSubmit = async () => {
    // Refetch invoice to ensure we have the latest data (in case items were deleted)
    await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });

    // Get fresh invoice data
    const freshInvoice = queryClient.getQueryData(['invoice', invoiceId]) as any;
    const freshInv = freshInvoice?.data;

    if (!freshInv?.items || freshInv.items.length === 0) {
      alert('Invoice has no items');
      return;
    }

    // Check for any price validation errors
    if (Object.keys(checkoutPriceErrors).length > 0) {
      const errorMessages = Object.values(checkoutPriceErrors).filter(Boolean);
      if (errorMessages.length > 0) {
        alert(`Price validation failed:\n\n${errorMessages.join('\n')}`);
        return;
      }
    }

    // Prepare items with updated quantities and prices
    // Filter out items with quantity 0 (they will be deleted by backend)
    // Use freshInv instead of inv to ensure we have the latest data
    const items = freshInv.items
      .map((item: any): any => {
        const quantity = checkoutQuantities[item.id]
          ? parseInt(checkoutQuantities[item.id]) || 0
          : parseInt(item.quantity) || 0;
        const price = checkoutPrices[item.id]
          ? parseFloat(checkoutPrices[item.id])
          : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);

        return {
          id: item.id,
          quantity: quantity,
          unit_price: item.unit_price,
          manual_unit_price: price > 0 ? price : null,
          discount_amount: item.discount_amount || 0,
          tax_amount: item.tax_amount || 0,
        };
      })
      .filter((item: any) => item.quantity > 0); // Remove items with quantity 0

    // Check if there are any items left after filtering
    if (items.length === 0) {
      alert('Invoice must have at least one item with quantity greater than 0.');
      return;
    }

    // Validate that all items have prices for cash/upi/mixed invoices (not required for pending)
    if (checkoutInvoiceType !== 'pending') {
      const itemsWithoutPrice = items.filter((item: any) => !item.manual_unit_price || item.manual_unit_price <= 0);
      if (itemsWithoutPrice.length > 0) {
        alert(`Please enter prices for all items. ${itemsWithoutPrice.length} item(s) are missing prices.`);
        return;
      }
    }

    // Validate price threshold for all invoice types (including pending/draft)
    // Check if sale price is below purchase/selling price threshold
    // Use freshInv instead of inv to ensure we have the latest data
    const priceValidationErrors: string[] = [];
    freshInv.items.forEach((item: any) => {
      const salePrice = checkoutPrices[item.id]
        ? parseFloat(checkoutPrices[item.id])
        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);

      // Only validate if price is set and greater than 0
      if (salePrice > 0) {
        // Get selling_price first, then fall back to purchase_price
        const sellingPrice = item.product_selling_price && item.product_selling_price > 0
          ? parseFloat(item.product_selling_price)
          : null;
        const purchasePrice = parseFloat(item.product_purchase_price || '0');

        // Use selling_price if available and > 0, otherwise use purchase_price
        const minPrice = sellingPrice !== null && sellingPrice > 0 ? sellingPrice : purchasePrice;
        const canGoBelow = item.product_can_go_below_purchase_price || false;

        // Validate price threshold if product doesn't allow going below purchase/selling price
        if (!canGoBelow && minPrice > 0 && salePrice < minPrice) {
          const priceType = sellingPrice !== null && sellingPrice > 0 ? 'selling price' : 'purchase price';
          priceValidationErrors.push(
            `${item.product_name || 'Product'}: Sale price (₹${salePrice.toFixed(2)}) cannot be less than ${priceType} (₹${minPrice.toFixed(2)})`
          );
        }
      }
    });

    if (priceValidationErrors.length > 0) {
      alert(`Price validation failed:\n\n${priceValidationErrors.join('\n')}`);
      return;
    }

    // Validate split payments for mixed type
    if (checkoutInvoiceType === 'mixed') {
      const total = items.reduce((sum: number, item: any) => {
        return sum + (item.quantity * (item.manual_unit_price || 0));
      }, 0);
      const cash = parseFloat(checkoutCashAmount) || 0;
      const upi = parseFloat(checkoutUpiAmount) || 0;

      if (!checkoutCashAmount || !checkoutUpiAmount || cash <= 0 || upi <= 0) {
        alert('Please enter both cash and UPI amounts for split payment');
        return;
      }

      if (Math.abs((cash + upi) - total) > 0.01) { // Allow small floating point differences
        alert(`Split payment amounts (₹${(cash + upi).toFixed(2)}) do not match invoice total (₹${total.toFixed(2)})`);
        return;
      }
    }

    const checkoutData: any = {
      invoice_type: checkoutInvoiceType,
      items: items,
    };

    // Add split payment amounts for mixed type
    if (checkoutInvoiceType === 'mixed') {
      checkoutData.cash_amount = parseFloat(checkoutCashAmount);
      checkoutData.upi_amount = parseFloat(checkoutUpiAmount);
    }

    checkoutMutation.mutate(checkoutData);
  };

  const handleUpdateQuantity = (item: any, delta: number) => {
    const newQuantity = Math.max(0, parseInt(item.quantity) || 0 + delta);
    if (newQuantity === 0) {
      if (window.confirm('Remove this item from the invoice?')) {
        deleteItemMutation.mutate(item.id);
      }
    } else {
      updateItemMutation.mutate({
        itemId: item.id,
        data: { quantity: newQuantity },
      });
    }
  };

  const handleBarcodeScan = async (barcode: string) => {
    if (!barcode || !barcode.trim()) return;

    const trimmedBarcode = barcode.trim();

    // Check if invoice is in the correct state to add items
    if (inv?.status !== 'draft' || inv?.invoice_type !== 'pending') {
      alert('Items can only be added to draft pending invoices. Please ensure the invoice is in draft status with pending type.');
      return;
    }

    // Try to find product by barcode (use barcode_only=true like POS.tsx)
    let product = null;
    let matchedBarcode: string | null = null;

    try {
      const barcodeResponse = await productsApi.byBarcode(trimmedBarcode, true);
      if (barcodeResponse.data) {
        product = barcodeResponse.data;
        matchedBarcode = product.matched_barcode || trimmedBarcode;

        // Check if barcode is available
        if (product.barcode_available === false) {
          const errorMsg = product.sold_invoice
            ? `This item (SKU: ${matchedBarcode}) has already been sold and is assigned to invoice ${product.sold_invoice}. It is not available in inventory.`
            : `This item (SKU: ${matchedBarcode}) has already been sold and is not available in inventory.`;
          alert(errorMsg);
          return;
        }
      }
    } catch (barcodeError: any) {
      if (barcodeError?.response?.status === 404) {
        // Barcode not found - try product name search
        const searchResponse = await productsApi.list({ search: trimmedBarcode });
        const searchData = searchResponse.data || searchResponse;
        let products: any[] = [];
        if (Array.isArray(searchData.results)) {
          products = searchData.results;
        } else if (Array.isArray(searchData.data)) {
          products = searchData.data;
        } else if (Array.isArray(searchData)) {
          products = searchData;
        }

        product = products.find((p: any) => p.sku?.toLowerCase() === trimmedBarcode.toLowerCase());
        if (!product && products.length > 0) {
          product = products[0];
        }
      } else {
        alert(barcodeError?.response?.data?.error || 'Failed to search for product');
        return;
      }
    }

    if (!product || !product.id) {
      alert('Product not found');
      return;
    }

    // For pending invoices, backend will set unit_price to 0, but we should still send it
    const isPending = inv?.invoice_type === 'pending' && inv?.status === 'draft';
    const quantity = 1;
    const unitPrice = isPending ? 0 : (product.selling_price || 0);
    const discountAmount = 0;
    const taxAmount = 0;
    // Calculate line_total: quantity * price - discount_amount + tax_amount (same as checkout)
    const lineTotal = quantity * unitPrice - discountAmount + taxAmount;

    const itemData: any = {
      product: product.id,
      quantity: quantity,
      unit_price: unitPrice,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      line_total: lineTotal, // Required field - calculate it like checkout does
    };

    // Don't pass barcode - backend will auto-assign based on product
    // The backend expects barcode to be an ID (integer), not a string value
    // It will auto-assign a barcode if quantity is 1 and barcode is not provided

    addItemMutation.mutate(itemData);
    setBarcodeInput('');
    setProductSearchSelectedIndex(-1);
    setIsSearchTyped(false);
  };

  const handleDelete = () => {
    setDeleteRestoreStock(true); // Default to restoring stock
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    const isDraftOrVoid = inv.status === 'draft' || inv.status === 'void';
    deleteInvoiceMutation.mutate({
      force: !isDraftOrVoid, // Force flag for non-draft/void invoices
      restoreStock: deleteRestoreStock
    });
  };

  // Shared function to generate invoice HTML for both print and download
  const generateInvoiceHTML = () => {
    // Calculate total PCS
    const totalPcs = inv.items && Array.isArray(inv.items)
      ? inv.items.reduce((sum: number, item: any) => sum + (parseInt(item.quantity || '0') || 0), 0)
      : 0;

    // Get total amount
    const totalAmount = parseFloat(inv.total || '0');
    const amountInWords = numberToWords(totalAmount);

    // Format date
    const invoiceDate = formatDateForInvoice(inv.created_at);

    // Get customer PAN/IT (not available in model, will show empty)
    const customerPanIt = ''; // Customer model doesn't have PAN/IT field

    // Get reference number (using invoice_number as ref)
    const refNo = inv.invoice_number || `#${inv.id}`;

    // Company details - using store info or default
    const companyName = 'Manish Traders';
    const companyAddress = 'Shop Number124-A Ground Floor\nChaitaniya Market Ghoda Nikkas Bhopal';
    const companyPhone1 = ''; // Can be populated from store.phone if needed
    const companyPhone2 = '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${inv.invoice_number || inv.id}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 40px; color: #000; line-height: 1.6; }
            
            /* Top section with Invoice No, Ref No, and Date */
            .top-section { display: flex; justify-content: space-between; margin-bottom: 30px; }
            .top-left { }
            .top-right { text-align: right; }
            .top-left p, .top-right p { margin: 5px 0; font-size: 14px; }
            
            /* Company header - centered */
            .company-header { text-align: center; margin-bottom: 30px; }
            .company-name { font-size: 20px; font-weight: bold; margin-bottom: 8px; }
            .company-address { font-size: 14px; white-space: pre-line; margin-bottom: 5px; }
            .company-phone { font-size: 14px; }
            
            /* INVOICE title - bold and centered */
            .invoice-title { text-align: center; font-size: 24px; font-weight: bold; margin: 20px 0; text-transform: uppercase; }
            
            /* Party section */
            .party-section { margin-bottom: 20px; }
            .party-section p { margin: 5px 0; font-size: 14px; }
            
            /* Table */
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th { background: #f0f0f0; padding: 10px; text-align: left; border: 1px solid #000; font-weight: bold; font-size: 13px; }
            td { padding: 8px 10px; border: 1px solid #000; font-size: 13px; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            
            /* Total row */
            .total-row { font-weight: bold; }
            
            /* Amount in words section */
            .amount-words { margin-top: 20px; margin-bottom: 20px; }
            .amount-words p { margin: 5px 0; font-size: 14px; }
            
            /* Declaration section */
            .declaration { margin-top: 30px; margin-bottom: 20px; }
            .declaration p { margin: 5px 0; font-size: 13px; }
            
            /* Authorised Signatory */
            .signatory { margin-top: 50px; text-align: right; }
            .signatory p { font-size: 14px; }
            
            /* Footer */
            .footer { margin-top: 30px; text-align: center; border-top: 1px solid #000; padding-top: 10px; }
            .footer p { font-size: 12px; text-decoration: underline; }
            
            /* Watermark */
            .watermark {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-45deg);
              font-size: 120px;
              font-weight: bold;
              color: rgba(0, 0, 0, 0.08);
              z-index: -1;
              pointer-events: none;
              white-space: nowrap;
              text-transform: uppercase;
              letter-spacing: 10px;
            }
            
            @media print {
              body { padding: 20px; position: relative; }
              .top-section { margin-bottom: 20px; }
              .company-header { margin-bottom: 20px; }
              .invoice-title { margin: 15px 0; }
              table { margin-bottom: 15px; }
              .amount-words { margin-top: 15px; margin-bottom: 15px; }
              .declaration { margin-top: 20px; }
              .signatory { margin-top: 40px; }
              .footer { margin-top: 20px; }
              .watermark {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-45deg);
                font-size: 120px;
                font-weight: bold;
                color: rgba(0, 0, 0, 0.08);
                z-index: -1;
                pointer-events: none;
                white-space: nowrap;
                text-transform: uppercase;
                letter-spacing: 10px;
              }
            }
          </style>
        </head>
        <body>
          <!-- Watermark -->
          <div class="watermark">${(inv.invoice_type || 'sale').toUpperCase()}</div>
          
          <!-- Top Left: Invoice No and Ref No -->
          <!-- Top Right: Date -->
          <div class="top-section">
            <div class="top-left">
              <p><strong>Invoice No. :</strong> ${inv.invoice_number || `#${inv.id}`}</p>
              <p><strong>Ref No. :</strong> ${refNo}</p>
            </div>
            <div class="top-right">
              <p><strong>Date:</strong> ${invoiceDate}</p>
            </div>
          </div>
          
          <!-- Center Top: Company Details -->
          <div class="company-header">
            <div class="company-name">${companyName}</div>
            <div class="company-address">${companyAddress}</div>
            <div class="company-phone">${companyPhone1}${companyPhone1 && companyPhone2 ? ', ' : ''}${companyPhone2}</div>
          </div>
          
          <!-- INVOICE Title - Bold -->
          <div class="invoice-title">INVOICE</div>
          
          <!-- Party Section -->
          <div class="party-section">
            <p><strong>Party :</strong> ${inv.customer_name || 'Walk-in Customer'}</p>
            <p><strong>PAN/IT no :</strong> ${customerPanIt || '-'}</p>
          </div>
          
          <!-- Table -->
          <table>
            <thead>
              <tr>
                <th>Description of Good</th>
                <th class="text-center">Quantity in PCS</th>
                <th class="text-right">Rate</th>
                <th class="text-center">Per (PCS)</th>
                <th class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${(() => {
        // Format numbers without currency symbol
        const formatNumber = (n: number, decimals: number = 2) => {
          return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        };

        if (!inv.items || !Array.isArray(inv.items) || inv.items.length === 0) {
          return '<tr><td colspan="5">No items</td></tr>';
        }

        // Group items by product name AND brand (to show separate rows for same product with different brands)
        const groupedItems: Record<string, {
          name: string;
          brand: string;
          skus: string[];
          totalQuantity: number;
          totalAmount: number;
          items: any[];
        }> = {};

        inv.items.forEach((item: any) => {
          const name = item.product_name || '-';
          const brand = item.product_brand_name || item.brand_name || '';
          // Create unique key combining name and brand
          const groupKey = brand ? `${name}::${brand}` : name;

          if (!groupedItems[groupKey]) {
            groupedItems[groupKey] = {
              name,
              brand,
              skus: [],
              totalQuantity: 0,
              totalAmount: 0,
              items: []
            };
          }

          // Add SKU/barcode to the list if available
          const sku = item.barcode_value || item.product_sku || '';
          if (sku && !groupedItems[groupKey].skus.includes(sku)) {
            groupedItems[groupKey].skus.push(sku);
          }

          // Sum quantities and amounts
          const quantity = parseInt(item.quantity || '0') || 0;
          const amount = parseFloat(item.line_total || '0');
          groupedItems[groupKey].totalQuantity += quantity;
          groupedItems[groupKey].totalAmount += amount;
          groupedItems[groupKey].items.push(item);
        });

        // Render grouped items
        return Object.values(groupedItems).map((group) => {
          // Calculate average unit price from total amount and quantity
          const avgUnitPrice = group.totalQuantity > 0
            ? group.totalAmount / group.totalQuantity
            : 0;

          // Build product name with brand
          const productDisplay = group.brand
            ? `${group.name} (${group.brand})`
            : group.name;

          // Build SKU list HTML
          const skuList = group.skus.length > 0
            ? '<div style="font-size: 11px; color: #666; margin-top: 2px;">SKUs: ' + group.skus.join(', ') + '</div>'
            : '';

          return `
                    <tr>
                      <td>
                        ${productDisplay}
                        ${skuList}
                      </td>
                      <td class="text-center">${formatNumber(group.totalQuantity, 3)}</td>
                      <td class="text-right">${formatNumber(avgUnitPrice, 2)}</td>
                      <td class="text-center">PCS</td>
                      <td class="text-right">${formatNumber(group.totalAmount, 2)}</td>
                    </tr>
                  `;
        }).join('');
      })()}
              <!-- Total Row -->
              <tr class="total-row">
                <td><strong>Total</strong></td>
                <td class="text-center"><strong>${totalPcs.toFixed(3).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</strong></td>
                <td></td>
                <td></td>
                <td class="text-right"><strong>${totalAmount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</strong></td>
              </tr>
            </tbody>
          </table>
          
          <!-- Amount in Words -->
          <div class="amount-words">
            <p><strong>Amount Chargeable (in words)</strong> E & OE</p>
            <p><strong>${amountInWords}</strong></p>
          </div>
          
          <!-- Declaration -->
          <div class="declaration">
            <p><strong>Declaration | for ${companyName}</strong></p>
            <p>We declare that this invoice shows the actual price of the good described and that all particulars are true and correct.</p>
          </div>
          
          <!-- Authorised Signatory -->
          <div class="signatory">
            <p><strong>Authorised Signatory</strong></p>
          </div>
          
          <!-- Footer -->
          <div class="footer">
            <p>This is a Computer Generated Invoice</p>
          </div>
        </body>
      </html>
    `;
  };

  const handlePrint = () => {
    // Create a printable version of the invoice using the same HTML as download
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const invoiceHTML = generateInvoiceHTML();
    printWindow.document.write(invoiceHTML);
    printWindow.document.close();

    // Wait for content to load, then trigger print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  };

  const handleDownload = () => {
    // Create a printable version of the invoice (same as print)
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const invoiceHTML = generateInvoiceHTML();
    printWindow.document.write(invoiceHTML);
    printWindow.document.close();

    // Wait for content to load, then trigger print or save as PDF
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        // Note: Browser will handle PDF download through print dialog
      }, 250);
    };
  };

  const generateThermalInvoiceHTML = (invoice: any) => {
    const formatCurrency = (amount: string | number) => {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(parseFloat(String(amount || '0')));
    };

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${invoice.invoice_number || invoice.id}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            @page { size: 4in auto; margin: 0.1in; }
            body { 
              font-family: 'Courier New', monospace; 
              font-size: 10px;
              width: 4in;
              max-width: 4in;
              padding: 5px;
              color: #000;
            }
            .header { 
              text-align: center; 
              margin-bottom: 8px; 
              border-bottom: 1px dashed #000; 
              padding-bottom: 5px; 
            }
            .header h1 { font-size: 14px; margin-bottom: 3px; font-weight: bold; }
            .header p { font-size: 9px; margin: 1px 0; }
            .info { margin-bottom: 6px; font-size: 9px; }
            .info-row { margin: 2px 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; }
            th { padding: 3px 2px; text-align: left; border-bottom: 1px dashed #000; font-weight: bold; }
            td { padding: 2px; border-bottom: 1px dotted #ccc; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .summary { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
            .summary-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 9px; }
            .summary-total { border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-weight: bold; font-size: 11px; }
            .footer { margin-top: 8px; padding-top: 4px; border-top: 1px dashed #000; text-align: center; font-size: 8px; }
            /* Watermark - positioned relative to content area */
            body { position: relative; }
            .watermark {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-45deg);
              font-size: 60px;
              font-weight: bold;
              color: rgba(0, 0, 0, 0.08);
              z-index: -1;
              pointer-events: none;
              white-space: nowrap;
              text-transform: uppercase;
              letter-spacing: 5px;
              width: 100%;
              text-align: center;
            }
            @media print {
              body { padding: 0; margin: 0; position: relative; }
              .no-print { display: none; }
              .watermark {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-45deg);
                font-size: 60px;
                font-weight: bold;
                color: rgba(0, 0, 0, 0.08);
                z-index: -1;
                pointer-events: none;
                white-space: nowrap;
                text-transform: uppercase;
                letter-spacing: 5px;
                width: 100%;
                text-align: center;
              }
            }
          </style>
        </head>
        <body>
          <!-- Watermark -->
          <div class="watermark">${(invoice.invoice_type || 'sale').toUpperCase()}</div>
          
          <div class="header">
            <h1>INVOICE</h1>
            <p>${invoice.invoice_number || `#${invoice.id}`}</p>
            <p>${formatDate(invoice.created_at)}</p>
          </div>
          <div class="info">
            <div class="info-row"><strong>Store:</strong> ${invoice.store_name || '-'}</div>
            <div class="info-row"><strong>Customer:</strong> ${invoice.customer_name || 'Walk-in Customer'}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th class="text-right">Qty</th>
                <th class="text-right">Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice.items && Array.isArray(invoice.items) ? (() => {
        // Group items by product name AND brand for thermal layout
        const groupedItems: Record<string, {
          name: string;
          brand: string;
          totalQuantity: number;
          totalAmount: number;
          avgPrice: number;
          items: any[];
        }> = {};

        invoice.items.forEach((item: any) => {
          const name = item.product_name || '-';
          const brand = item.product_brand_name || item.brand_name || '';
          const groupKey = brand ? `${name}::${brand}` : name;

          if (!groupedItems[groupKey]) {
            groupedItems[groupKey] = {
              name,
              brand,
              totalQuantity: 0,
              totalAmount: 0,
              avgPrice: 0,
              items: []
            };
          }

          const quantity = parseInt(item.quantity || '0') || 0;
          const amount = parseFloat(item.line_total || '0');
          groupedItems[groupKey].totalQuantity += quantity;
          groupedItems[groupKey].totalAmount += amount;
          groupedItems[groupKey].items.push(item);
        });

        // Calculate average price for each group
        Object.values(groupedItems).forEach(group => {
          group.avgPrice = group.totalQuantity > 0
            ? group.totalAmount / group.totalQuantity
            : 0;
        });

        // Render grouped items
        return Object.values(groupedItems).map((group) => {
          const productDisplay = group.brand
            ? `${group.name} (${group.brand})`
            : group.name;
          // Truncate for thermal printer (max 20 chars)
          const displayText = productDisplay.substring(0, 20);

          return `
                    <tr>
                      <td>${displayText}</td>
                      <td class="text-right">${group.totalQuantity}</td>
                      <td class="text-right">${formatCurrency(group.avgPrice)}</td>
                      <td class="text-right">${formatCurrency(group.totalAmount)}</td>
                </tr>
                  `;
        }).join('');
      })() : '<tr><td colspan="4">No items</td></tr>'}
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-row">
              <span>Subtotal:</span>
              <span>${formatCurrency(invoice.subtotal || '0')}</span>
            </div>
            ${parseFloat(invoice.discount_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Discount:</span>
              <span>-${formatCurrency(invoice.discount_amount || '0')}</span>
            </div>
            ` : ''}
            ${parseFloat(invoice.tax_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Tax:</span>
              <span>${formatCurrency(invoice.tax_amount || '0')}</span>
            </div>
            ` : ''}
            <div class="summary-row summary-total">
              <span>TOTAL:</span>
              <span>${formatCurrency(invoice.total || '0')}</span>
            </div>
            ${parseFloat(invoice.paid_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Paid:</span>
              <span>${formatCurrency(invoice.paid_amount || '0')}</span>
            </div>
            ` : ''}
            ${parseFloat(invoice.due_amount || '0') > 0 ? `
            <div class="summary-row">
              <span>Due:</span>
              <span>${formatCurrency(invoice.due_amount || '0')}</span>
            </div>
            ` : ''}
          </div>
          <div class="footer">
            <p>Thank you for your business!</p>
          </div>
        </body>
      </html>
    `;
  };

  const handlePrintThermal = () => {
    if (!inv) return;

    const thermalHTML = generateThermalInvoiceHTML(inv);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print invoice');
      return;
    }

    printWindow.document.write(thermalHTML);
    printWindow.document.close();

    // Wait for content to load, then trigger print
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="no-print space-y-4">
        {/* Back Button */}
        <Button
          variant="outline"
          onClick={() => navigate('/invoices')}
          className="w-full sm:w-auto"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Main Header Card */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {/* Top Section: Invoice Info */}
          <div className="p-4 sm:p-6 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              {/* Invoice Details */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                    {inv.invoice_number || `Invoice #${inv.id}`}
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                    Created on {formatDate(inv.created_at)}
                  </p>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex-shrink-0">
                <Badge variant={statusInfo.color} className="w-full sm:w-auto justify-center sm:justify-start">
                  <StatusIcon className="h-3.5 w-3.5 mr-1.5" />
                  {statusInfo.label}
                </Badge>
              </div>
            </div>
          </div>

          {/* Actions Section */}
          <div className="p-4 sm:p-6 bg-gray-50">
            <div className="flex flex-col sm:flex-row gap-3 sm:justify-end sm:items-center">
              {/* Primary Action */}
              {isPending && (
                <Button
                  variant="primary"
                  onClick={handleCheckout}
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  disabled={checkoutMutation.isPending}
                >
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {checkoutMutation.isPending ? 'Processing...' : 'Checkout'}
                </Button>
              )}

              {/* Secondary Actions */}
              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                {/* Edit */}
                {isEditable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowEditModal(true)}
                    className="w-full sm:w-auto"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}

                {/* Print & Download */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrint}
                    className="flex-1 sm:flex-none"
                  >
                    <Printer className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Print</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrintThermal}
                    className="flex-1 sm:flex-none"
                  >
                    <Printer className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Thermal</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    className="flex-1 sm:flex-none"
                  >
                    <Download className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                </div>

                {/* Delete */}
                {!isRestrictedUser && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleDelete}
                    className="w-full sm:w-auto"
                    disabled={deleteInvoiceMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {deleteInvoiceMutation.isPending ? 'Deleting...' : 'Delete'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice Information & Financial Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 print-area">
        {/* Invoice Information */}
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Information</h3>
          <dl className="space-y-4">
            <div className="flex items-start gap-3">
              <Store className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-2">
                  Store
                  {!isRestrictedUser && (
                    <button
                      onClick={() => {
                        setSelectedStoreId(inv.store || null);
                        setEditingStore(true);
                      }}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      title="Edit store"
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </dt>
                {editingStore ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedStoreId || ''}
                      onChange={(e) => setSelectedStoreId(e.target.value ? parseInt(e.target.value) : null)}
                      className="flex-1 text-sm"
                    >
                      <option value="">Select a store</option>
                      {stores.map((store: any) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (selectedStoreId && selectedStoreId !== inv.store) {
                          updateInvoiceMutation.mutate({ store: selectedStoreId });
                        } else {
                          setEditingStore(false);
                        }
                      }}
                      disabled={updateInvoiceMutation.isPending || !selectedStoreId}
                    >
                      {updateInvoiceMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingStore(false);
                        setSelectedStoreId(inv.store || null);
                      }}
                      disabled={updateInvoiceMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <dd className="text-sm text-gray-900">{inv.store_name || '-'}</dd>
                )}
              </div>
            </div>
            {inv.customer_name && (
              <div className="flex items-start gap-3">
                <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <dt className="text-sm font-medium text-gray-500 mb-1">Customer</dt>
                  <dd className="text-sm text-gray-900">{inv.customer_name}</dd>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <dt className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-2">
                  Invoice Type
                  {!isRestrictedUser && (
                    <button
                      onClick={() => {
                        setSelectedInvoiceType(inv.invoice_type || 'cash');
                        setEditingInvoiceType(true);
                      }}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                      title="Edit invoice type"
                    >
                      <Pencil className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600" />
                    </button>
                  )}
                </dt>
                {editingInvoiceType ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedInvoiceType}
                      onChange={(e) => setSelectedInvoiceType(e.target.value)}
                      className="flex-1 text-sm"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="mixed">Cash + UPI</option>
                      <option value="pending">Pending</option>
                      <option value="defective">Defective</option>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (selectedInvoiceType !== inv.invoice_type) {
                          updateInvoiceMutation.mutate({ invoice_type: selectedInvoiceType });
                        } else {
                          setEditingInvoiceType(false);
                        }
                      }}
                      disabled={updateInvoiceMutation.isPending}
                    >
                      {updateInvoiceMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingInvoiceType(false);
                        setSelectedInvoiceType(inv.invoice_type || 'cash');
                      }}
                      disabled={updateInvoiceMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <dd className="text-sm text-gray-900 capitalize">{inv.invoice_type || 'Sale'}</dd>
                )}
              </div>
            </div>
            {inv.notes && (
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <dt className="text-sm font-medium text-gray-500 mb-1">Notes</dt>
                  <dd className="text-sm text-gray-900 leading-relaxed">{inv.notes}</dd>
                </div>
              </div>
            )}
          </dl>
        </Card>

        {/* Financial Summary */}
        <Card className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-gray-400" />
            Financial Summary
          </h3>
          <div className="space-y-3">
            {isPending ? (
              // For pending invoices, show totals as 0
              <>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600">Subtotal</span>
                  <span className="text-sm font-medium text-gray-900">{formatCurrency('0')}</span>
                </div>
                <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
                  <span className="text-base font-semibold text-gray-900">Total</span>
                  <span className="text-lg font-bold text-gray-900">{formatCurrency('0')}</span>
                </div>
              </>
            ) : (
              // For other invoices, show actual totals
              <>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600">Subtotal</span>
                  <span className="text-sm font-medium text-gray-900">{formatCurrency(inv.subtotal || '0')}</span>
                </div>
                {parseFloat(inv.discount_amount || '0') > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Discount</span>
                    <span className="text-sm font-medium text-red-600">-{formatCurrency(inv.discount_amount || '0')}</span>
                  </div>
                )}
                {parseFloat(inv.tax_amount || '0') > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-600">Tax</span>
                    <span className="text-sm font-medium text-gray-900">{formatCurrency(inv.tax_amount || '0')}</span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-3 mt-3 flex justify-between items-center">
                  <span className="text-base font-semibold text-gray-900">Total</span>
                  <span className="text-lg font-bold text-gray-900">{formatCurrency(inv.total || '0')}</span>
                </div>
              </>
            )}
            {parseFloat(inv.paid_amount || '0') > 0 && (
              <div className="flex justify-between items-center py-2 bg-green-50 rounded-lg px-3">
                <span className="text-sm font-medium text-green-700">Paid</span>
                <span className="text-sm font-semibold text-green-700">{formatCurrency(inv.paid_amount || '0')}</span>
              </div>
            )}
            {parseFloat(inv.due_amount || '0') > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2 bg-red-50 rounded-lg px-3">
                  <span className="text-sm font-medium text-red-700">Due</span>
                  <span className="text-sm font-semibold text-red-700">{formatCurrency(inv.due_amount || '0')}</span>
                </div>
                <Button
                  onClick={() => {
                    setPaymentAmount(inv.due_amount || '0');
                    setShowPaymentModal(true);
                  }}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                >
                  Settle Up
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Invoice Items */}
      {inv.items && Array.isArray(inv.items) && inv.items.length > 0 && (
        <Card className="print-area">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-gray-400" />
            Invoice Items ({(() => {
              if (!inv.items || !Array.isArray(inv.items) || inv.items.length === 0) return 0;
              return groupItemsByProduct(inv.items).length;
            })()})
          </h3>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            {(() => {
              const groupedItems = groupItemsByProduct(inv.items);

              if (isPending) {
                // For pending invoices, show only Product, SKU, and Quantity
                return (
                  <Table headers={['Product', 'SKU', 'Quantity']}>
                    {groupedItems.map((group, groupIndex) => {
                      const groupKey = `invoice_group_${group.productId}_${groupIndex}`;
                      const isExpanded = expandedInvoiceItems[groupKey] || false;
                      const totalQuantity = group.items.reduce((sum, item) => sum + (parseInt(item.quantity || '0') || 0), 0);
                      const barcodes = group.items.map(item => ({
                        barcode: item.barcode_value || item.product_sku || 'N/A',
                        item: item
                      }));

                      return (
                        <>
                          <TableRow key={groupKey}>
                            <TableCell>
                              <span className="font-medium text-gray-900">{group.productName}</span>
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => setExpandedInvoiceItems({ ...expandedInvoiceItems, [groupKey]: !isExpanded })}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-mono"
                              >
                                <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            </TableCell>
                            <TableCell>
                              <span className="text-gray-600 font-semibold">{totalQuantity}</span>
                            </TableCell>
                          </TableRow>
                          {isExpanded && barcodes.map((barcodeItem, barcodeIndex) => (
                            <TableRow key={`${groupKey}_barcode_${barcodeIndex}`} className="bg-gray-50">
                              <TableCell className="pl-12">
                                <span className="text-xs text-gray-500">↳ {group.productName}</span>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-gray-600 font-mono">{barcodeItem.barcode}</span>
                              </TableCell>
                              <TableCell>
                                <span className="text-xs text-gray-600 font-semibold">{barcodeItem.item.quantity}</span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </>
                      );
                    })}
                  </Table>
                );
              } else {
                // For other invoices, show full details with prices
                return (
                  <Table headers={['Product', 'SKU', 'Quantity', 'Unit Price', 'Discount', 'Tax', 'Total']}>
                    {groupedItems.map((group, groupIndex) => {
                      const groupKey = `invoice_group_${group.productId}_${groupIndex}`;
                      const isExpanded = expandedInvoiceItems[groupKey] || false;
                      const totalQuantity = group.items.reduce((sum, item) => sum + (parseInt(item.quantity || '0') || 0), 0);
                      const totalLineTotal = group.items.reduce((sum, item) => sum + parseFloat(item.line_total || '0'), 0);
                      const totalDiscount = group.items.reduce((sum, item) => sum + parseFloat(item.discount_amount || '0'), 0);
                      const totalTax = group.items.reduce((sum, item) => sum + parseFloat(item.tax_amount || '0'), 0);
                      const avgUnitPrice = totalQuantity > 0 ? totalLineTotal / totalQuantity : 0;
                      const barcodes = group.items.map(item => ({
                        barcode: item.barcode_value || item.product_sku || 'N/A',
                        item: item
                      }));

                      return (
                        <>
                          <TableRow key={groupKey}>
                            <TableCell>
                              <span className="font-medium text-gray-900">{group.productName}</span>
                            </TableCell>
                            <TableCell>
                              <button
                                onClick={() => setExpandedInvoiceItems({ ...expandedInvoiceItems, [groupKey]: !isExpanded })}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-mono"
                              >
                                <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            </TableCell>
                            <TableCell>
                              <span className="text-gray-600 font-semibold">{totalQuantity}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="font-medium text-gray-900">{formatCurrency(avgUnitPrice)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="text-gray-600">{formatCurrency(totalDiscount)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="text-gray-600">{formatCurrency(totalTax)}</span>
                            </TableCell>
                            <TableCell align="right">
                              <span className="font-semibold text-gray-900">{formatCurrency(totalLineTotal)}</span>
                            </TableCell>
                          </TableRow>
                          {isExpanded && barcodes.map((barcodeItem, barcodeIndex) => {
                            const item = barcodeItem.item;
                            return (
                              <TableRow key={`${groupKey}_barcode_${barcodeIndex}`} className="bg-gray-50">
                                <TableCell className="pl-12">
                                  <span className="text-xs text-gray-500">↳ {group.productName}</span>
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs text-gray-600 font-mono">{barcodeItem.barcode}</span>
                                </TableCell>
                                <TableCell>
                                  <span className="text-xs text-gray-600">{item.quantity}</span>
                                </TableCell>
                                <TableCell align="right">
                                  {item.manual_unit_price && parseFloat(item.unit_price || '0') > 0 && parseFloat(item.unit_price || '0') !== parseFloat(item.manual_unit_price || '0') ? (
                                    <div className="flex flex-col items-end">
                                      <span className="line-through text-gray-400 text-xs">{formatCurrency(item.unit_price || '0')}</span>
                                      <span className="text-xs font-medium text-gray-900">{formatCurrency(item.manual_unit_price)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-xs font-medium text-gray-900">{formatCurrency(item.manual_unit_price || item.unit_price || '0')}</span>
                                  )}
                                </TableCell>
                                <TableCell align="right">
                                  <span className="text-xs text-gray-600">{formatCurrency(item.discount_amount || '0')}</span>
                                </TableCell>
                                <TableCell align="right">
                                  <span className="text-xs text-gray-600">{formatCurrency(item.tax_amount || '0')}</span>
                                </TableCell>
                                <TableCell align="right">
                                  <span className="text-xs font-semibold text-gray-900">{formatCurrency(item.line_total || '0')}</span>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </>
                      );
                    })}
                  </Table>
                );
              }
            })()}
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {(() => {
              const groupedItems = groupItemsByProduct(inv.items);
              return groupedItems.map((group, groupIndex) => {
                const groupKey = `invoice_group_${group.productId}_${groupIndex}`;
                const isExpanded = expandedInvoiceItems[groupKey] || false;
                const totalQuantity = group.items.reduce((sum, item) => sum + parseFloat(item.quantity || '0'), 0);
                const totalLineTotal = group.items.reduce((sum, item) => sum + parseFloat(item.line_total || '0'), 0);
                const totalDiscount = group.items.reduce((sum, item) => sum + parseFloat(item.discount_amount || '0'), 0);
                const totalTax = group.items.reduce((sum, item) => sum + parseFloat(item.tax_amount || '0'), 0);
                const avgUnitPrice = totalQuantity > 0 ? totalLineTotal / totalQuantity : 0;
                const barcodes = group.items.map(item => ({
                  barcode: item.barcode_value || item.product_sku || 'N/A',
                  item: item
                }));

                return (
                  <div key={groupKey} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                    {/* Parent Card */}
                    <div className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0 pr-3">
                          <h4 className="font-semibold text-gray-900 text-base mb-1">{group.productName}</h4>
                          <button
                            onClick={() => setExpandedInvoiceItems({ ...expandedInvoiceItems, [groupKey]: !isExpanded })}
                            className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 font-mono mt-1"
                          >
                            <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          <div className="text-sm text-gray-500 mt-1">
                            <span>Quantity: <span className="font-semibold text-gray-900">{totalQuantity}</span></span>
                          </div>
                        </div>
                        {!isPending && (
                          <div className="text-right flex-shrink-0">
                            <div className="text-lg font-bold text-gray-900">{formatCurrency(totalLineTotal)}</div>
                            <div className="text-xs text-gray-500 mt-0.5">Total</div>
                          </div>
                        )}
                      </div>
                      {!isPending && (
                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-100 mt-3">
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Unit Price</div>
                            <div className="font-semibold text-gray-900">{formatCurrency(avgUnitPrice)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Discount</div>
                            <div className="font-medium text-gray-900">{formatCurrency(totalDiscount)}</div>
                          </div>
                          <div>
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Tax</div>
                            <div className="font-medium text-gray-900">{formatCurrency(totalTax)}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Expanded Barcode Section */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-200 bg-gray-50">
                        <div className="pt-3 space-y-2">
                          {barcodes.map((barcodeItem, barcodeIndex) => {
                            const item = barcodeItem.item;
                            return (
                              <div key={`${groupKey}_barcode_${barcodeIndex}`} className="bg-white rounded-md p-3 border border-gray-200">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-xs font-mono text-gray-600">{barcodeItem.barcode}</div>
                                  <div className="text-xs text-gray-500">Qty: {item.quantity}</div>
                                </div>
                                {!isPending && (
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <div className="text-gray-500 mb-0.5">Price</div>
                                      {item.manual_unit_price && parseFloat(item.unit_price || '0') > 0 && parseFloat(item.unit_price || '0') !== parseFloat(item.manual_unit_price || '0') ? (
                                        <div className="space-y-0.5">
                                          <div className="line-through text-gray-400">{formatCurrency(item.unit_price || '0')}</div>
                                          <div className="font-semibold text-gray-900">{formatCurrency(item.manual_unit_price)}</div>
                                        </div>
                                      ) : (
                                        <div className="font-semibold text-gray-900">{formatCurrency(item.manual_unit_price || item.unit_price || '0')}</div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-gray-500 mb-0.5">Total</div>
                                      <div className="font-semibold text-gray-900">{formatCurrency(item.line_total || '0')}</div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </Card>
      )}

      {/* Payments */}
      {inv.payments && Array.isArray(inv.payments) && inv.payments.length > 0 && (
        <Card className="print-area">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Coins className="h-5 w-5 text-gray-400" />
            Payments ({inv.payments.length})
          </h3>
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <Table headers={['Payment Method', 'Amount', 'Reference', 'Date']}>
              {inv.payments.map((payment: any) => (
                <TableRow key={payment.id}>
                  <TableCell>
                    <span className="capitalize font-medium text-gray-900">{payment.payment_method || '-'}</span>
                  </TableCell>
                  <TableCell align="right">
                    <span className="font-semibold text-gray-900">{formatCurrency(payment.amount || '0')}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{payment.reference || '-'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{formatDate(payment.created_at)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          </div>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {inv.payments.map((payment: any) => (
              <div key={payment.id} className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Coins className="h-4 w-4 text-gray-400" />
                        <div className="font-semibold text-gray-900 capitalize">{payment.payment_method || '-'}</div>
                      </div>
                      <div className="text-sm text-gray-500">{formatDate(payment.created_at)}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold text-green-600">{formatCurrency(payment.amount || '0')}</div>
                    </div>
                  </div>
                  {payment.reference && (
                    <div className="pt-3 border-t border-gray-100">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Reference</div>
                      <div className="text-sm font-medium text-gray-900 break-all">{payment.reference}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* A4 Print Preview - Embedded */}
      <Card className="no-print">
        <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Printer className="h-5 w-5 text-gray-400" />
            A4 Print Preview
          </h3>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="flex-1 sm:flex-none"
            >
              <Printer className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Print</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="flex-1 sm:flex-none"
            >
              <Download className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Download</span>
            </Button>
          </div>
        </div>
        <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 shadow-lg">
          <div className="bg-gray-50 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">A4 Invoice Preview</span>
            <span className="text-xs text-gray-500 hidden sm:inline">This is how the invoice will appear when printed</span>
          </div>
          <div className="bg-gray-200 p-4 sm:p-8 flex justify-center overflow-auto" style={{ maxHeight: '900px' }}>
            <div
              className="bg-white shadow-2xl mx-auto"
              style={{
                width: '210mm',
                minHeight: '297mm',
                maxWidth: '100%',
                boxShadow: '0 0 20px rgba(0,0,0,0.3)'
              }}
            >
              <iframe
                title="Invoice A4 Preview"
                srcDoc={generateInvoiceHTML()}
                className="w-full border-0 block"
                style={{
                  width: '100%',
                  minHeight: '297mm',
                  border: 'none',
                  display: 'block'
                }}
                onLoad={(e) => {
                  // Auto-resize iframe to content height
                  const iframe = e.target as HTMLIFrameElement;
                  if (iframe.contentWindow?.document?.body) {
                    const body = iframe.contentWindow.document.body;
                    const html = iframe.contentWindow.document.documentElement;
                    const height = Math.max(
                      body.scrollHeight,
                      body.offsetHeight,
                      html.clientHeight,
                      html.scrollHeight,
                      html.offsetHeight
                    );
                    // Convert pixels to mm (1mm = 3.779527559 pixels at 96 DPI)
                    // Add some padding
                    iframe.style.height = (height + 40) + 'px';
                  }
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Checkout Modal */}
      {isPending && (
        <Modal
          isOpen={showCheckoutModal}
          onClose={() => {
            setShowCheckoutModal(false);
            setCheckoutQuantities({});
            setCheckoutPrices({});
            setCheckoutPriceErrors({});
            setParentGroupPrices({});
            setCheckoutCashAmount('');
            setCheckoutUpiAmount('');
          }}
          title="Checkout Invoice"
          size="xl"
        >
          <div className="space-y-6">
            {/* Invoice Type Selection */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="block text-sm font-semibold text-gray-900 mb-3">
                <FileText className="h-4 w-4 inline mr-2" />
                Invoice Type
              </label>
              <Select
                value={checkoutInvoiceType}
                onChange={(e) => {
                  const newType = e.target.value as 'cash' | 'upi' | 'pending' | 'mixed';
                  setCheckoutInvoiceType(newType);
                  // Clear split amounts when switching away from mixed
                  if (newType !== 'mixed') {
                    setCheckoutCashAmount('');
                    setCheckoutUpiAmount('');
                  }
                }}
                className="w-full font-semibold border-2 border-blue-300 hover:border-blue-400 cursor-pointer bg-white"
              >
                <option value="pending">PENDING (Save Prices Only)</option>
                <option value="cash">CASH (Checkout)</option>
                <option value="upi">UPI (Checkout)</option>
                <option value="mixed">CASH + UPI (Checkout)</option>
              </Select>
              <p className="text-xs text-blue-700 mt-2 font-medium">
                {checkoutInvoiceType === 'pending' && '✓ Prices will be saved. Invoice remains as draft. No checkout performed.'}
                {checkoutInvoiceType === 'cash' && '✓ Invoice will be checked out and marked as paid (cash). Inventory will be updated.'}
                {checkoutInvoiceType === 'upi' && '✓ Invoice will be checked out and marked as paid (UPI). Inventory will be updated.'}
                {checkoutInvoiceType === 'mixed' && '✓ Invoice will be checked out with split payment (cash + UPI). Inventory will be updated.'}
              </p>
              {/* Split Payment Inputs for Mixed Type */}
              {checkoutInvoiceType === 'mixed' && (
                <div className="mt-3 space-y-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-900 mb-2">
                    <FileText className="h-3.5 w-3.5" />
                    Split Payment Amounts
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Cash Amount (₹)</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={checkoutCashAmount}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCheckoutCashAmount(value);
                          // Auto-calculate UPI amount if total is known
                          if (inv?.items && value) {
                            const total = calculateCheckoutTotal();
                            const cash = parseFloat(value) || 0;
                            const remaining = Math.max(0, total - cash);
                            setCheckoutUpiAmount(remaining.toFixed(2));
                          }
                        }}
                        className="w-full text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">UPI Amount (₹)</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={checkoutUpiAmount}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCheckoutUpiAmount(value);
                          // Auto-calculate Cash amount if total is known
                          if (inv?.items && value) {
                            const total = calculateCheckoutTotal();
                            const upi = parseFloat(value) || 0;
                            const remaining = Math.max(0, total - upi);
                            setCheckoutCashAmount(remaining.toFixed(2));
                          }
                        }}
                        className="w-full text-xs"
                      />
                    </div>
                  </div>
                  {inv?.items && checkoutCashAmount && checkoutUpiAmount && (
                    <div className="text-xs mt-2">
                      <span className="text-gray-600">Total: </span>
                      <span className={`font-semibold ${(parseFloat(checkoutCashAmount) + parseFloat(checkoutUpiAmount)).toFixed(2) === calculateCheckoutTotal().toFixed(2) ? 'text-green-600' : 'text-red-600'}`}>
                        ₹{(parseFloat(checkoutCashAmount) + parseFloat(checkoutUpiAmount)).toFixed(2)}
                      </span>
                      <span className="text-gray-600"> / Invoice Total: ₹{calculateCheckoutTotal().toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Add Product Section */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Product
              </h4>
              <div className="relative w-full">
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Input
                      type="text"
                      placeholder="Search products by name, SKU, or scan barcode..."
                      value={barcodeInput}
                      autoComplete="off"
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setBarcodeInput(newValue);
                        setIsSearchTyped(newValue.trim().length > 0);
                        setProductSearchSelectedIndex(-1);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const searchValue = barcodeInput.trim();
                          if (!searchValue) return;

                          // If a product is selected in dropdown, select it
                          if (productSearchSelectedIndex >= 0 && products) {
                            const productList = (() => {
                              if (Array.isArray(products?.results)) return products.results;
                              if (Array.isArray(products?.data)) return products.data;
                              if (Array.isArray(products)) return products;
                              return [];
                            })();
                            if (productList[productSearchSelectedIndex]) {
                              const product = productList[productSearchSelectedIndex];
                              const isPending = inv?.invoice_type === 'pending' && inv?.status === 'draft';
                              const quantity = 1;
                              const unitPrice = isPending ? 0 : (product.selling_price || 0);
                              const discountAmount = 0;
                              const taxAmount = 0;
                              // Calculate line_total: quantity * price - discount_amount + tax_amount
                              const lineTotal = quantity * unitPrice - discountAmount + taxAmount;

                              const itemData: any = {
                                product: product.id,
                                quantity: quantity,
                                unit_price: unitPrice,
                                discount_amount: discountAmount,
                                tax_amount: taxAmount,
                                line_total: lineTotal, // Required field - calculate it like checkout does
                              };
                              addItemMutation.mutate(itemData);
                              setBarcodeInput('');
                              setProductSearchSelectedIndex(-1);
                              setIsSearchTyped(false);
                              return;
                            }
                          }

                          // Otherwise, try barcode scan
                          await handleBarcodeScan(searchValue);
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          if (products) {
                            const productList = (() => {
                              if (Array.isArray(products?.results)) return products.results;
                              if (Array.isArray(products?.data)) return products.data;
                              if (Array.isArray(products)) return products;
                              return [];
                            })();
                            if (productList.length > 0) {
                              setProductSearchSelectedIndex(0);
                            }
                          }
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          if (productSearchSelectedIndex > 0) {
                            setProductSearchSelectedIndex(productSearchSelectedIndex - 1);
                          }
                        }
                      }}
                      className="w-full"
                    />
                    {/* Product Search Dropdown */}
                    {isSearchTyped && (products || barcodeCheck?.product) && (
                      <div className="absolute top-full left-0 mt-2 border border-gray-200 rounded-lg bg-white shadow-xl z-20 w-full">
                        <div className="max-h-64 overflow-y-auto">
                          {(() => {
                            const productList: any[] = [];
                            if (barcodeCheck?.product && !barcodeCheck.isUnavailable) {
                              productList.push(barcodeCheck.product);
                            }
                            if (products) {
                              const existingIds = new Set(productList.map(p => p.id));
                              if (Array.isArray(products?.results)) {
                                productList.push(...products.results.filter((p: any) => !existingIds.has(p.id)));
                              } else if (Array.isArray(products?.data)) {
                                productList.push(...products.data.filter((p: any) => !existingIds.has(p.id)));
                              } else if (Array.isArray(products)) {
                                productList.push(...products.filter((p: any) => !existingIds.has(p.id)));
                              }
                            }
                            if (productList.length === 0) {
                              return (
                                <div className="px-4 py-6 text-center text-sm text-gray-500">
                                  No products found
                                </div>
                              );
                            }
                            return productList.map((product: any, index: number) => {
                              const isSelected = index === productSearchSelectedIndex;
                              return (
                                <button
                                  key={product.id}
                                  onClick={() => {
                                    const isPending = inv?.invoice_type === 'pending' && inv?.status === 'draft';
                                    const quantity = 1;
                                    const unitPrice = isPending ? 0 : (product.selling_price || 0);
                                    const discountAmount = 0;
                                    const taxAmount = 0;
                                    // Calculate line_total: quantity * price - discount_amount + tax_amount
                                    const lineTotal = quantity * unitPrice - discountAmount + taxAmount;

                                    const itemData: any = {
                                      product: product.id,
                                      quantity: quantity,
                                      unit_price: unitPrice,
                                      discount_amount: discountAmount,
                                      tax_amount: taxAmount,
                                      line_total: lineTotal, // Required field - calculate it like checkout does
                                    };
                                    addItemMutation.mutate(itemData);
                                    setBarcodeInput('');
                                    setProductSearchSelectedIndex(-1);
                                    setIsSearchTyped(false);
                                  }}
                                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                                    }`}
                                >
                                  <div className="font-medium text-gray-900">{product.name}</div>
                                  {product.sku && (
                                    <div className="text-xs text-gray-500 mt-1">SKU: {product.sku}</div>
                                  )}
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={async () => {
                      if (barcodeInput.trim()) {
                        await handleBarcodeScan(barcodeInput);
                      }
                    }}
                    disabled={!barcodeInput.trim() || addItemMutation.isPending}
                    className="flex-shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                    {addItemMutation.isPending ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              </div>
            </div>

            {/* Invoice Items with Editable Quantities */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                Invoice Items ({(() => {
                  if (!inv.items || !Array.isArray(inv.items) || inv.items.length === 0) return 0;
                  // Filter out items with quantity 0
                  const activeItems = inv.items.filter((item: any) => {
                    const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                    return parseFloat(qty) > 0;
                  });
                  return groupItemsByProduct(activeItems).length;
                })()})
              </h4>
              {inv.items && Array.isArray(inv.items) && inv.items.length > 0 ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Product</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">SKU</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Purchase Price</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Quantity</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Unit Price</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Total</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(() => {
                          // Filter out items with quantity 0 for display
                          const activeItems = inv.items.filter((item: any) => {
                            const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                            return parseFloat(qty) > 0;
                          });
                          const groupedItems = groupItemsByProduct(activeItems);
                          return groupedItems.map((group, groupIndex) => {
                            // Calculate total quantity from all items in group
                            const totalQuantity = group.items.reduce((sum, item) => {
                              const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                              return sum + parseFloat(qty || '0');
                            }, 0);

                            // Create a unique key for the group
                            const groupKey = `group_${group.productId}_${groupIndex}`;
                            const isExpanded = expandedGroups[groupKey] || false;

                            // Get parent price from separate state (independent of individual item prices)
                            const firstItem = group.items[0];
                            const parentPrice = parentGroupPrices[groupKey] ?? (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();

                            // Calculate line total using parent price
                            const lineTotal = totalQuantity * parseFloat(parentPrice);

                            // Get all unique barcodes for this product
                            const barcodes = group.items.map(item => ({
                              barcode: item.barcode_value || item.product_sku || 'N/A',
                              item: item
                            }));

                            return (
                              <Fragment key={groupKey}>
                                {/* Parent Row */}
                                <tr className="hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-4">
                                    <div className="font-medium text-gray-900">{group.productName}</div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <button
                                      onClick={() => setExpandedGroups({ ...expandedGroups, [groupKey]: !isExpanded })}
                                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-mono"
                                    >
                                      <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    </button>
                                  </td>
                                  <td className="px-4 py-4 text-right">
                                    <span className="text-sm text-gray-900">
                                      ₹{(() => {
                                        const sp = parseFloat(firstItem.product_selling_price || '0');
                                        const pp = parseFloat(firstItem.product_purchase_price || '0');
                                        return (sp > 0 ? sp : pp).toFixed(2);
                                      })()}
                                    </span>
                                  </td>
                                  <td className="px-4 py-4">
                                    {group.isTrackedInventory ? (
                                      <div className="flex items-center justify-center">
                                        <span className="text-gray-600 font-semibold">{totalQuantity}</span>
                                        <span className="ml-2 text-xs text-gray-500">(Fixed)</span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center gap-1">
                                        <button
                                          onClick={() => {
                                            const newQty = Math.max(0, totalQuantity - 1);
                                            // Distribute quantity change proportionally across items
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }}
                                          className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 transition-colors"
                                          disabled={totalQuantity <= 0}
                                        >
                                          <Minus className="h-4 w-4" />
                                        </button>
                                        <Input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={totalQuantity}
                                          onChange={(e) => {
                                            const newQty = parseFloat(e.target.value) || 0;
                                            // Distribute quantity proportionally across items
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }}
                                          className="w-20 text-center font-semibold"
                                        />
                                        <button
                                          onClick={() => {
                                            const newQty = totalQuantity + 1;
                                            // Distribute quantity change proportionally across items
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }}
                                          className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 transition-colors"
                                        >
                                          <Plus className="h-4 w-4" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-sm text-gray-500">₹</span>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                        value={parentPrice}
                                        onFocus={(e) => {
                                          // Clear the input when focused
                                          setParentGroupPrices({
                                            ...parentGroupPrices,
                                            [groupKey]: '',
                                          });
                                          e.target.select();
                                        }}
                                        onBlur={(e) => {
                                          // Restore original value if empty
                                          const newPrice = e.target.value;
                                          if (!newPrice || newPrice.trim() === '') {
                                            const firstItem = group.items[0];
                                            const originalPrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
                                            setParentGroupPrices({
                                              ...parentGroupPrices,
                                              [groupKey]: originalPrice,
                                            });
                                          }
                                        }}
                                        onChange={(e) => {
                                          // Update parent price state
                                          const newPrice = e.target.value;
                                          setParentGroupPrices({
                                            ...parentGroupPrices,
                                            [groupKey]: newPrice,
                                          });

                                          // Validate price threshold for parent price (use first item for validation)
                                          const firstItem = group.items[0];
                                          const error = validatePriceThreshold(newPrice, firstItem);
                                          if (error) {
                                            setCheckoutPriceErrors({
                                              ...checkoutPriceErrors,
                                              [groupKey]: error,
                                            });
                                          } else {
                                            const newErrors = { ...checkoutPriceErrors };
                                            delete newErrors[groupKey];
                                            setCheckoutPriceErrors(newErrors);
                                          }

                                          // Apply price to all items in group (auto-fill) unless they have been explicitly overridden
                                          const newPrices = { ...checkoutPrices };
                                          const oldParentPrice = parentPrice; // Store old parent price before update
                                          group.items.forEach((item) => {
                                            const currentItemPrice = checkoutPrices[item.id];
                                            const originalItemPrice = (item.manual_unit_price || item.unit_price || '0').toString();

                                            // Update item price if:
                                            // 1. It doesn't have a price set in checkoutPrices, OR
                                            // 2. It matches the old parent price, OR
                                            // 3. It matches the original item price (meaning it hasn't been manually overridden)
                                            const shouldUpdate = !currentItemPrice ||
                                              currentItemPrice === oldParentPrice ||
                                              currentItemPrice === originalItemPrice;

                                            if (shouldUpdate) {
                                              newPrices[item.id] = newPrice;

                                              // Validate individual item price
                                              const itemError = validatePriceThreshold(newPrice, item);
                                              if (itemError) {
                                                setCheckoutPriceErrors(prev => ({
                                                  ...prev,
                                                  [`item_${item.id}`]: itemError,
                                                }));
                                              } else {
                                                setCheckoutPriceErrors(prev => {
                                                  const updated = { ...prev };
                                                  delete updated[`item_${item.id}`];
                                                  return updated;
                                                });
                                              }
                                            }
                                            // Otherwise, keep the manually overridden price
                                          });
                                          setCheckoutPrices(newPrices);
                                        }}
                                        className={`w-28 text-right font-medium ${checkoutPriceErrors[groupKey] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                      />
                                    </div>
                                    {checkoutPriceErrors[groupKey] && (
                                      <div className="text-xs text-red-600 mt-1 text-right pr-1">{checkoutPriceErrors[groupKey]}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="text-right">
                                      <div className="font-semibold text-gray-900">
                                        ₹{lineTotal.toFixed(2)}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="flex items-center justify-center">
                                      <button
                                        onClick={() => {
                                          // Remove all items in this group by calling delete API for each item
                                          if (window.confirm(`Remove all items of "${group.productName}" from the invoice?`)) {
                                            group.items.forEach((item) => {
                                              deleteItemMutation.mutate(item.id);
                                            });
                                          }
                                        }}
                                        disabled={deleteItemMutation.isPending}
                                        className="p-1.5 rounded-md text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
                                        title="Remove Product"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {/* Expanded Barcode Rows */}
                                {isExpanded && barcodes.map((barcodeItem, barcodeIndex) => {
                                  const item = barcodeItem.item;
                                  const itemQty = checkoutQuantities[item.id] ?? item.quantity.toString();
                                  const itemPrice = checkoutPrices[item.id] ?? parentPrice;
                                  const itemLineTotal = parseFloat(itemQty) * parseFloat(itemPrice);

                                  return (
                                    <tr key={`${groupKey}_barcode_${barcodeIndex}`} className="bg-gray-50 hover:bg-gray-100 transition-colors">
                                      <td className="px-4 py-3 pl-12">
                                        <div className="text-xs text-gray-500">↳ {group.productName}</div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="text-xs text-gray-600 font-mono">{barcodeItem.barcode}</div>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span className="text-xs text-gray-600">
                                          ₹{(() => {
                                            const sp = parseFloat(item.product_selling_price || '0');
                                            const pp = parseFloat(item.product_purchase_price || '0');
                                            return (sp > 0 ? sp : pp).toFixed(2);
                                          })()}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="text-center text-xs text-gray-600 font-semibold">{itemQty}</div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                          <span className="text-xs text-gray-500">₹</span>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            placeholder={parentPrice}
                                            value={itemPrice}
                                            onFocus={(e) => {
                                              // Clear the input when focused
                                              setCheckoutPrices({
                                                ...checkoutPrices,
                                                [item.id]: '',
                                              });
                                              e.target.select();
                                            }}
                                            onBlur={(e) => {
                                              // Restore parent price if empty
                                              const newPrice = e.target.value;
                                              if (!newPrice || newPrice.trim() === '') {
                                                setCheckoutPrices({
                                                  ...checkoutPrices,
                                                  [item.id]: parentPrice,
                                                });
                                              }
                                            }}
                                            onChange={(e) => {
                                              const newPrice = e.target.value;
                                              // Allow individual price override - this does NOT affect parent price
                                              setCheckoutPrices({
                                                ...checkoutPrices,
                                                [item.id]: newPrice,
                                              });

                                              // Validate price threshold for individual item
                                              const error = validatePriceThreshold(newPrice, item);
                                              if (error) {
                                                setCheckoutPriceErrors(prev => ({
                                                  ...prev,
                                                  [`item_${item.id}`]: error,
                                                }));
                                              } else {
                                                setCheckoutPriceErrors(prev => {
                                                  const updated = { ...prev };
                                                  delete updated[`item_${item.id}`];
                                                  return updated;
                                                });
                                              }
                                            }}
                                            className={`w-24 text-right font-medium text-xs ${checkoutPriceErrors[`item_${item.id}`] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                          />
                                        </div>
                                        {checkoutPriceErrors[`item_${item.id}`] && (
                                          <div className="text-xs text-red-600 mt-1 text-right pr-1">{checkoutPriceErrors[`item_${item.id}`]}</div>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="text-right text-xs font-semibold text-gray-700">
                                          ₹{itemLineTotal.toFixed(2)}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="md:hidden divide-y divide-gray-200 max-h-96 overflow-y-auto">
                    {(() => {
                      // Filter out items with quantity 0 for display
                      const activeItems = inv.items.filter((item: any) => {
                        const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                        return parseFloat(qty) > 0;
                      });
                      const groupedItems = groupItemsByProduct(activeItems);
                      return groupedItems.map((group, groupIndex) => {
                        // Calculate total quantity from all items in group
                        const totalQuantity = group.items.reduce((sum, item) => {
                          const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                          return sum + parseFloat(qty || '0');
                        }, 0);

                        // Create a unique key for the group
                        const groupKey = `group_${group.productId}_${groupIndex}`;
                        const isExpanded = expandedGroups[groupKey] || false;

                        // Get parent price from separate state (independent of individual item prices)
                        const firstItem = group.items[0];
                        const parentPrice = parentGroupPrices[groupKey] ?? (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
                        const lineTotal = totalQuantity * parseFloat(parentPrice);

                        // Get all unique barcodes for this product
                        const barcodes = group.items.map(item => ({
                          barcode: item.barcode_value || item.product_sku || 'N/A',
                          item: item
                        }));

                        return (
                          <div key={groupKey} className="bg-white">
                            {/* Parent Card */}
                            <div className="p-4">
                              <div className="mb-3">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h5 className="font-semibold text-gray-900 mb-1">{group.productName}</h5>
                                    <button
                                      onClick={() => setExpandedGroups({ ...expandedGroups, [groupKey]: !isExpanded })}
                                      className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 font-mono"
                                    >
                                      <span>{barcodes.length} Barcode{barcodes.length > 1 ? 's' : ''}</span>
                                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </button>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-xs text-gray-500 block">Purchase Price</span>
                                    <span className="text-sm font-medium text-gray-900">
                                      ₹{(() => {
                                        const sp = parseFloat(firstItem.product_selling_price || '0');
                                        const pp = parseFloat(firstItem.product_purchase_price || '0');
                                        return (sp > 0 ? sp : pp).toFixed(2);
                                      })()}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                {/* Quantity */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Quantity</label>
                                  {group.isTrackedInventory ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-900 font-semibold">{totalQuantity}</span>
                                      <span className="text-xs text-gray-500">(Fixed)</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => {
                                          const newQty = Math.max(0, totalQuantity - 1);
                                          const newQuantities = { ...checkoutQuantities };
                                          group.items.forEach((item) => {
                                            const currentQty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString());
                                            const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                            newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                          });
                                          setCheckoutQuantities(newQuantities);
                                        }}
                                        className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                                        disabled={totalQuantity <= 0}
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>
                                      <Input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={totalQuantity}
                                        onChange={(e) => {
                                          // Only allow positive integers
                                          const val = e.target.value;
                                          if (val === '' || /^\d+$/.test(val)) {
                                            const newQty = parseInt(val) || 0;
                                            const newQuantities = { ...checkoutQuantities };
                                            group.items.forEach((item) => {
                                              const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                              const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                              newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                            });
                                            setCheckoutQuantities(newQuantities);
                                          }
                                        }}
                                        onBlur={(e) => {
                                          // Ensure value is a positive integer on blur
                                          const val = Math.max(0, parseInt(e.target.value) || 0);
                                          const newQuantities = { ...checkoutQuantities };
                                          group.items.forEach((item) => {
                                            const currentQty = parseInt(checkoutQuantities[item.id] ?? item.quantity.toString()) || 0;
                                            const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                            newQuantities[item.id] = Math.max(0, Math.floor(val * proportion)).toString();
                                          });
                                          setCheckoutQuantities(newQuantities);
                                        }}
                                        className="w-20 text-center font-semibold"
                                      />
                                      <button
                                        onClick={() => {
                                          const newQty = totalQuantity + 1;
                                          const newQuantities = { ...checkoutQuantities };
                                          group.items.forEach((item) => {
                                            const currentQty = parseFloat(checkoutQuantities[item.id] ?? item.quantity.toString());
                                            const proportion = totalQuantity > 0 ? currentQty / totalQuantity : 1 / group.items.length;
                                            newQuantities[item.id] = Math.max(0, Math.floor(newQty * proportion)).toString();
                                          });
                                          setCheckoutQuantities(newQuantities);
                                        }}
                                        className="p-1.5 rounded-md text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Price */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Unit Price</label>
                                  <div className="flex items-center gap-1">
                                    <span className="text-sm text-gray-500">₹</span>
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      placeholder="0.00"
                                      value={parentPrice}
                                      onFocus={(e) => {
                                        // Clear the input when focused
                                        setParentGroupPrices({
                                          ...parentGroupPrices,
                                          [groupKey]: '',
                                        });
                                        e.target.select();
                                      }}
                                      onBlur={(e) => {
                                        // Restore original value if empty
                                        const newPrice = e.target.value;
                                        if (!newPrice || newPrice.trim() === '') {
                                          const firstItem = group.items[0];
                                          const originalPrice = (firstItem.manual_unit_price || firstItem.unit_price || '0').toString();
                                          setParentGroupPrices({
                                            ...parentGroupPrices,
                                            [groupKey]: originalPrice,
                                          });
                                        }
                                      }}
                                      onChange={(e) => {
                                        // Update parent price state
                                        const newPrice = e.target.value;
                                        setParentGroupPrices({
                                          ...parentGroupPrices,
                                          [groupKey]: newPrice,
                                        });

                                        // Validate price threshold for parent price (use first item for validation)
                                        const firstItem = group.items[0];
                                        const error = validatePriceThreshold(newPrice, firstItem);
                                        if (error) {
                                          setCheckoutPriceErrors({
                                            ...checkoutPriceErrors,
                                            [groupKey]: error,
                                          });
                                        } else {
                                          const newErrors = { ...checkoutPriceErrors };
                                          delete newErrors[groupKey];
                                          setCheckoutPriceErrors(newErrors);
                                        }

                                        // Apply price to all items in group (auto-fill) unless they have been explicitly overridden
                                        const newPrices = { ...checkoutPrices };
                                        const oldParentPrice = parentPrice; // Store old parent price before update
                                        group.items.forEach((item) => {
                                          const currentItemPrice = checkoutPrices[item.id];
                                          const originalItemPrice = (item.manual_unit_price || item.unit_price || '0').toString();

                                          // Update item price if:
                                          // 1. It doesn't have a price set in checkoutPrices, OR
                                          // 2. It matches the old parent price, OR
                                          // 3. It matches the original item price (meaning it hasn't been manually overridden)
                                          const shouldUpdate = !currentItemPrice ||
                                            currentItemPrice === oldParentPrice ||
                                            currentItemPrice === originalItemPrice;

                                          if (shouldUpdate) {
                                            newPrices[item.id] = newPrice;

                                            // Validate individual item price
                                            const itemError = validatePriceThreshold(newPrice, item);
                                            if (itemError) {
                                              setCheckoutPriceErrors(prev => ({
                                                ...prev,
                                                [`item_${item.id}`]: itemError,
                                              }));
                                            } else {
                                              setCheckoutPriceErrors(prev => {
                                                const updated = { ...prev };
                                                delete updated[`item_${item.id}`];
                                                return updated;
                                              });
                                            }
                                          }
                                          // Otherwise, keep the manually overridden price
                                        });
                                        setCheckoutPrices(newPrices);
                                      }}
                                      className={`flex-1 text-right font-medium ${checkoutPriceErrors[groupKey] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                    />
                                  </div>
                                  {checkoutPriceErrors[groupKey] && (
                                    <div className="text-xs text-red-600 mt-1">{checkoutPriceErrors[groupKey]}</div>
                                  )}
                                </div>
                              </div>

                              {/* Line Total */}
                              {parseFloat(parentPrice) > 0 && (
                                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                                  <span className="text-sm font-medium text-gray-700">Line Total:</span>
                                  <span className="text-lg font-bold text-gray-900">₹{lineTotal.toFixed(2)}</span>
                                </div>
                              )}
                            </div>

                            {/* Expanded Barcode Section */}
                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-gray-200 bg-gray-50">
                                <div className="pt-3 space-y-2">
                                  {barcodes.map((barcodeItem, barcodeIndex) => {
                                    const item = barcodeItem.item;
                                    const itemQty = checkoutQuantities[item.id] ?? item.quantity.toString();
                                    const itemPrice = checkoutPrices[item.id] ?? parentPrice;
                                    const itemLineTotal = parseFloat(itemQty) * parseFloat(itemPrice);

                                    return (
                                      <div key={`${groupKey}_barcode_${barcodeIndex}`} className="bg-white rounded-md p-3 border border-gray-200">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="text-xs font-mono text-gray-600">{barcodeItem.barcode}</div>
                                          <div className="text-xs text-gray-500">Qty: {itemQty}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <label className="text-xs font-medium text-gray-700">Price:</label>
                                          <div className="flex items-center gap-1 flex-1">
                                            <span className="text-xs text-gray-500">₹</span>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              placeholder={parentPrice}
                                              value={itemPrice}
                                              onFocus={(e) => {
                                                // Clear the input when focused
                                                setCheckoutPrices({
                                                  ...checkoutPrices,
                                                  [item.id]: '',
                                                });
                                                e.target.select();
                                              }}
                                              onBlur={(e) => {
                                                // Restore parent price if empty
                                                const newPrice = e.target.value;
                                                if (!newPrice || newPrice.trim() === '') {
                                                  setCheckoutPrices({
                                                    ...checkoutPrices,
                                                    [item.id]: parentPrice,
                                                  });
                                                }
                                              }}
                                              onChange={(e) => {
                                                const newPrice = e.target.value;
                                                // Allow individual price override
                                                setCheckoutPrices({
                                                  ...checkoutPrices,
                                                  [item.id]: newPrice,
                                                });

                                                // Validate price threshold for individual item
                                                const error = validatePriceThreshold(newPrice, item);
                                                if (error) {
                                                  setCheckoutPriceErrors(prev => ({
                                                    ...prev,
                                                    [`item_${item.id}`]: error,
                                                  }));
                                                } else {
                                                  setCheckoutPriceErrors(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[`item_${item.id}`];
                                                    return updated;
                                                  });
                                                }
                                              }}
                                              className={`flex-1 text-right font-medium text-xs ${checkoutPriceErrors[`item_${item.id}`] ? 'border-red-500 focus:border-red-500 focus:ring-red-200' : ''}`}
                                            />
                                          </div>
                                          <div className="text-xs font-semibold text-gray-700">
                                            ₹{itemLineTotal.toFixed(2)}
                                          </div>
                                        </div>
                                        {checkoutPriceErrors[`item_${item.id}`] && (
                                          <div className="text-xs text-red-600 mt-1">{checkoutPriceErrors[`item_${item.id}`]}</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {/* Remove Button for Mobile */}
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <button
                                onClick={() => {
                                  // Remove all items in this group by calling delete API for each item
                                  if (window.confirm(`Remove all items of "${group.productName}" from the invoice?`)) {
                                    group.items.forEach((item) => {
                                      deleteItemMutation.mutate(item.id);
                                    });
                                  }
                                }}
                                disabled={deleteItemMutation.isPending}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                Remove Product
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <ShoppingBag className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No items in invoice</p>
                </div>
              )}
            </div>

            {/* Summary */}
            {(() => {
              // Filter out items with quantity 0 for total calculation
              const activeItems = inv.items?.filter((item: any) => {
                const qty = checkoutQuantities[item.id] ?? item.quantity.toString();
                return parseFloat(qty) > 0;
              }) || [];

              if (activeItems.length > 0) {
                const subtotal = calculateCheckoutTotal();
                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Summary</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Subtotal:</span>
                        <span className="font-semibold text-gray-900">₹{subtotal.toFixed(2)}</span>
                      </div>
                      <div className="pt-2 border-t border-gray-200 flex justify-between">
                        <span className="text-base font-bold text-gray-900">Total:</span>
                        <span className="text-xl font-bold text-blue-600">₹{subtotal.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCheckoutModal(false);
                  setCheckoutQuantities({});
                  setCheckoutPrices({});
                }}
                disabled={checkoutMutation.isPending || markCreditMutation.isPending}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!inv?.items || inv.items.length === 0) {
                    alert('Invoice has no items');
                    return;
                  }

                  // Check for any price validation errors
                  if (Object.keys(checkoutPriceErrors).length > 0) {
                    const errorMessages = Object.values(checkoutPriceErrors).filter(Boolean);
                    if (errorMessages.length > 0) {
                      alert(`Price validation failed:\n\n${errorMessages.join('\n')}`);
                      return;
                    }
                  }

                  // Prepare items with updated quantities and prices (same as handleCheckoutSubmit)
                  // Filter out items with quantity 0 (they will be deleted by backend)
                  const items = inv.items
                    .map((item: any): any => {
                      const quantity = checkoutQuantities[item.id]
                        ? parseInt(checkoutQuantities[item.id]) || 0
                        : parseInt(item.quantity) || 0;
                      const price = checkoutPrices[item.id]
                        ? parseFloat(checkoutPrices[item.id])
                        : (parseFloat(item.manual_unit_price) || parseFloat(item.unit_price) || 0);

                      return {
                        id: item.id,
                        quantity: quantity,
                        unit_price: item.unit_price,
                        manual_unit_price: price > 0 ? price : null,
                        discount_amount: item.discount_amount || 0,
                        tax_amount: item.tax_amount || 0,
                      };
                    })
                    .filter((item: any) => item.quantity > 0); // Remove items with quantity 0

                  // Check if there are any items left after filtering
                  if (items.length === 0) {
                    alert('Invoice must have at least one item with quantity greater than 0.');
                    return;
                  }

                  // Validate that all items have prices
                  const itemsWithoutPrice = items.filter((item: any) => !item.manual_unit_price || item.manual_unit_price <= 0);
                  if (itemsWithoutPrice.length > 0) {
                    alert(`Please enter prices for all items. ${itemsWithoutPrice.length} item(s) are missing prices.`);
                    return;
                  }

                  markCreditMutation.mutate(items);
                }}
                disabled={markCreditMutation.isPending || checkoutMutation.isPending || !areAllPricesEntered() || !inv?.items || inv.items.length === 0 || Object.keys(checkoutPriceErrors).length > 0}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
              >
                {markCreditMutation.isPending ? 'Moving to Ledger...' : 'Move to Ledger'}
              </Button>
              <Button
                onClick={handleCheckoutSubmit}
                disabled={checkoutMutation.isPending || markCreditMutation.isPending || !inv?.items || inv.items.length === 0}
                className="w-full sm:w-auto"
              >
                {checkoutMutation.isPending ? 'Processing...' : 'Complete Checkout'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Payment Modal */}
      {invoice?.data && (() => {
        const inv = invoice.data;
        return (
          <Modal
            isOpen={showPaymentModal}
            onClose={() => {
              setShowPaymentModal(false);
              setPaymentAmount('');
              setPaymentReference('');
              setPaymentNotes('');
              setPaymentMethod('cash');
            }}
            title="Settle Payment"
            size="md"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Method <span className="text-red-500">*</span>
                </label>
                <Select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="credit">Credit</option>
                  <option value="other">Other</option>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Amount <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={parseFloat(inv.due_amount || '0')}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder={`Max: ${formatCurrency(inv.due_amount || '0')}`}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Due Amount: {formatCurrency(inv.due_amount || '0')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reference (Optional)
                </label>
                <Input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="Transaction ID, Check Number, etc."
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Additional notes about this payment"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  onClick={() => {
                    setShowPaymentModal(false);
                    setPaymentAmount('');
                    setPaymentReference('');
                    setPaymentNotes('');
                    setPaymentMethod('cash');
                  }}
                  variant="outline"
                  className="flex-1"
                  disabled={paymentMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const amount = parseFloat(paymentAmount);
                    if (!amount || amount <= 0) {
                      alert('Please enter a valid payment amount');
                      return;
                    }
                    if (amount > parseFloat(inv.due_amount || '0')) {
                      alert(`Payment amount cannot exceed due amount of ${formatCurrency(inv.due_amount || '0')}`);
                      return;
                    }
                    paymentMutation.mutate({
                      payment_method: paymentMethod,
                      amount: amount,
                      reference: paymentReference || undefined,
                      notes: paymentNotes || undefined,
                    });
                  }}
                  disabled={paymentMutation.isPending || !paymentAmount || parseFloat(paymentAmount) <= 0}
                  className="flex-1"
                >
                  {paymentMutation.isPending ? 'Processing...' : 'Record Payment'}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Invoice"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            Are you sure you want to delete invoice <strong>{inv.invoice_number || `#${inv.id}`}</strong>?
          </p>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm font-medium text-yellow-800 mb-3">
              Choose what to do with the items:
            </p>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="deleteOption"
                  checked={deleteRestoreStock}
                  onChange={() => setDeleteRestoreStock(true)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Add items back to inventory</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Stock quantities will be restored, barcodes will be marked as available, and ledger entries will be reversed.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="deleteOption"
                  checked={!deleteRestoreStock}
                  onChange={() => setDeleteRestoreStock(false)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900">Delete everything</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Invoice will be permanently deleted. Stock will NOT be restored. Ledger entries will still be reversed.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button
              variant="outline"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleteInvoiceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteConfirm}
              disabled={deleteInvoiceMutation.isPending}
            >
              {deleteInvoiceMutation.isPending ? 'Deleting...' : 'Delete Invoice'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      {isEditable && (
        <Modal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          title="Edit Invoice"
          size="xl"
        >
          <div className="space-y-6">
            {/* Add Item Section */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Add Item</h4>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Scan barcode or enter SKU..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && barcodeInput.trim()) {
                      handleBarcodeScan(barcodeInput);
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  onClick={() => {
                    if (barcodeInput.trim()) {
                      handleBarcodeScan(barcodeInput);
                    }
                  }}
                  disabled={!barcodeInput.trim() || addItemMutation.isPending}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>

            {/* Invoice Items */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Invoice Items</h4>
              {inv.items && Array.isArray(inv.items) && inv.items.length > 0 ? (
                <div className="space-y-3">
                  {inv.items.map((item: any) => {
                    const isEditingPrice = showPriceInput[item.id];
                    const priceValue = editingPrice[item.id] ?? (item.manual_unit_price?.toString() || item.unit_price?.toString() || '');
                    return (
                      <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h5 className="font-semibold text-gray-900">{item.product_name || '-'}</h5>
                            <p className="text-sm text-gray-600">SKU: {item.barcode_value || item.product_sku || 'N/A'}</p>
                            <div className="mt-2 space-y-2">
                              {isEditingPrice ? (
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="Enter price"
                                    value={priceValue}
                                    onChange={(e) => setEditingPrice({ ...editingPrice, [item.id]: e.target.value })}
                                    className="w-32"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (priceValue) {
                                        updateItemMutation.mutate({
                                          itemId: item.id,
                                          data: { manual_unit_price: parseFloat(priceValue) },
                                        });
                                      }
                                      setShowPriceInput({ ...showPriceInput, [item.id]: false });
                                    }}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setShowPriceInput({ ...showPriceInput, [item.id]: false });
                                      setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '' });
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3 flex-wrap">
                                  {isPending ? (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600">
                                          Quantity: <span className="font-semibold text-gray-900 text-base">{item.quantity}</span>
                                        </span>
                                      </div>
                                      {!item.manual_unit_price && (
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            setShowPriceInput({ ...showPriceInput, [item.id]: true });
                                            setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '0' });
                                          }}
                                          className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
                                        >
                                          <Coins className="h-3.5 w-3.5 mr-1.5" />
                                          Set Price
                                        </Button>
                                      )}
                                      {item.manual_unit_price && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-md">
                                          <span className="text-xs text-green-700 font-medium">Price Set:</span>
                                          <span className="text-sm font-semibold text-green-900">{formatCurrency(item.manual_unit_price)}</span>
                                          <button
                                            onClick={() => {
                                              setShowPriceInput({ ...showPriceInput, [item.id]: true });
                                              setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '0' });
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-700 ml-2 font-medium"
                                          >
                                            Change
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-sm text-gray-600">
                                        {formatCurrency(item.manual_unit_price || item.unit_price || '0')} × {item.quantity} = {formatCurrency(item.line_total || '0')}
                                      </span>
                                      <button
                                        onClick={() => {
                                          setShowPriceInput({ ...showPriceInput, [item.id]: true });
                                          setEditingPrice({ ...editingPrice, [item.id]: item.manual_unit_price?.toString() || item.unit_price?.toString() || '' });
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                      >
                                        Edit Price
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpdateQuantity(item, -1)}
                              disabled={updateItemMutation.isPending || deleteItemMutation.isPending}
                              className="p-1.5 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="min-w-[3rem] px-2 py-1 text-center font-semibold text-gray-900 bg-gray-50 rounded border border-gray-300">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleUpdateQuantity(item, 1)}
                              disabled={updateItemMutation.isPending}
                              className="p-1.5 rounded-md text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm('Remove this item from the invoice?')) {
                                  deleteItemMutation.mutate(item.id);
                                }
                              }}
                              disabled={deleteItemMutation.isPending}
                              className="p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50 ml-2"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No items in invoice</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button variant="outline" onClick={() => setShowEditModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
