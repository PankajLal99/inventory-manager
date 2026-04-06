import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useRef } from 'react';
import { customersApi, catalogApi, posApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { isLedgerAdminContext } from '../../lib/access';
import { DateRangePreset, formatAmountINR, toLocalDateString, dateStringWithCurrentTimeISO, amountForInput, formatNumber, getProductNameColor } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import DatePicker from '../../components/ui/DatePicker';
import DateRangeSelector from '../../components/ui/DateRangeSelector';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import { toast } from '../../lib/toast';
import {
  ArrowLeft, FileText, FileSpreadsheet, FileText as FileTextIcon,
  Printer, Filter, X, Calendar, Search, Plus, Minus, Pencil, Trash2, Package,
  Store, ChevronDown, Receipt, Camera
} from 'lucide-react';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

export default function LedgerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ledgerListPath = (() => {
    const query = searchParams.toString();
    return query ? `/ledger?${query}` : '/ledger';
  })();

  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    entryType: '',
    search: '',
  });
  const [showCreditInvoicesOnly, setShowCreditInvoicesOnly] = useState(true); // Default: show only entries from invoices with status 'credit'
  const [showFilters, setShowFilters] = useState(false);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('custom');
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit');
  const [entryData, setEntryData] = useState({
    amount: '',
    description: '',
    date: toLocalDateString(new Date())
  });
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editEntryData, setEditEntryData] = useState({ amount: '', description: '', date: '', entryType: 'credit' as 'credit' | 'debit' });
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [showCategorySelector, setShowCategorySelector] = useState(false);
  const aioPreviewRef = useRef<HTMLIFrameElement>(null);
  const queryClient = useQueryClient();

  const { data: customerData } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.get(parseInt(customerId || '0')),
    enabled: !!customerId,
    retry: false,
  });

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null); // 0 = ALL (no shop filter)
  const [user, setUser] = useState<any>(null);

  // Load user on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        await auth.loadUser();
        setUser(auth.getUser());
      } catch (e) {
        // User not loaded
      }
    };
    loadUser();
  }, []);

  // Fetch stores (already filtered by backend based on user groups)
  const { data: storesResponse } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const response = await catalogApi.stores.list();
      return response.data;
    },
    retry: false,
  });

  const stores = (() => {
    if (!storesResponse) return [];
    if (Array.isArray(storesResponse.results)) return storesResponse.results;
    if (Array.isArray(storesResponse.data)) return storesResponse.data;
    if (Array.isArray(storesResponse)) return storesResponse;
    return [];
  })();

  // Check if user is Admin (any group containing "Admin" gets store selector)
  const isAdmin = isLedgerAdminContext(user);

  // Determine the active store:
  // - For Admin: Use selectedStoreId (0 = ALL), or first active store if none selected
  // - For others: Auto-select first active store (filtered by backend)
  const defaultStore = (() => {
    if (isAdmin && selectedStoreId === 0) {
      return { id: 0, name: 'All Stores' };
    }
    if (isAdmin && selectedStoreId) {
      return stores.find((s: any) => s.id === selectedStoreId) || stores.find((s: any) => s.is_active) || stores[0];
    }
    return stores.find((s: any) => s.is_active) || stores[0];
  })();

  // Update selectedStoreId when stores/user load and Admin hasn't selected one yet
  useEffect(() => {
    if (isAdmin && selectedStoreId == null) {
      // Default to ALL for any admin-like user
      setSelectedStoreId(0);
    }
  }, [isAdmin, selectedStoreId]);

  const { data: ledgerDetail, isLoading } = useQuery({
    queryKey: ['ledger-customer-detail', customerId, defaultStore?.id, showCreditInvoicesOnly, filters.dateFrom, filters.dateTo, filters.entryType, filters.search],
    queryFn: () => {
      const params: any = {};
      if (defaultStore?.id && defaultStore.id !== 0) params.store = defaultStore.id;
      if (showCreditInvoicesOnly) params.invoice_status = 'credit';
      if (filters.dateFrom) params.date_from = filters.dateFrom;
      if (filters.dateTo) params.date_to = filters.dateTo;
      if (filters.entryType) params.entry_type = filters.entryType;
      if (filters.search) params.search = filters.search;
      return customersApi.ledger.customerDetail(parseInt(customerId || '0'), params);
    },
    enabled: !!customerId && !!defaultStore,
    retry: false,
  });

  const customer = customerData?.data;
  const allEntries = ledgerDetail?.data?.entries || [];
  const finalBalance = ledgerDetail?.data?.final_balance || '0.00';
  const pendingInvoiceTotal = Number(ledgerDetail?.data?.pending_invoice_total || 0);

  // Fetch all categories for the selector
  const { data: categoriesResponse } = useQuery({
    queryKey: ['categories'],
    queryFn: () => catalogApi.categories.list(),
    retry: false,
  });

  const categories = (() => {
    if (!categoriesResponse) return [];
    const d = categoriesResponse?.data ?? categoriesResponse;
    if (Array.isArray(d?.results)) return d.results;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d)) return d;
    return [];
  })();

  // Invoice items count by selected categories (products sold to this customer), respects date filter
  const { data: itemsByCategoryData } = useQuery({
    queryKey: ['ledger-invoice-items-by-category', customerId, defaultStore?.id, selectedCategoryIds, filters.dateFrom, filters.dateTo],
    queryFn: () => {
      const params: any = {};
      if (defaultStore?.id && defaultStore.id !== 0) params.store = defaultStore.id;
      if (selectedCategoryIds.length) params.categories = selectedCategoryIds;
      if (filters.dateFrom) params.date_from = filters.dateFrom;
      if (filters.dateTo) params.date_to = filters.dateTo;
      return customersApi.ledger.invoiceItemsByCategory(parseInt(customerId || '0'), params);
    },
    enabled: !!customerId && !!defaultStore && selectedCategoryIds.length > 0,
    retry: false,
  });

  const itemsByCategory = itemsByCategoryData?.data;
  const categoryTotalCount = itemsByCategory?.total_count ?? 0;
  const categoryBreakdown = itemsByCategory?.by_category ?? [];

  const toggleCategory = (id: number) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const createEntryMutation = useMutation({
    mutationFn: (data: any) => customersApi.ledger.entries.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-customer-detail', customerId, defaultStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      setShowEntryForm(false);
      setEntryData({ amount: '', description: '', date: toLocalDateString(new Date()) });
      toast('Ledger entry created successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to create ledger entry', 'error');
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => customersApi.ledger.entries.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-customer-detail', customerId, defaultStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      setEditingEntry(null);
      setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' });
      toast('Entry updated successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to update entry', 'error');
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => customersApi.ledger.entries.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-customer-detail', customerId, defaultStore?.id] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      setDeletingEntryId(null);
      toast('Entry removed successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to remove entry', 'error');
      setDeletingEntryId(null);
    },
  });

  const handleCreateEntry = (type: 'credit' | 'debit') => {
    setEntryType(type);
    setShowEntryForm(true);
  };

  const handleSubmitEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) {
      toast('Customer not found', 'error');
      return;
    }
    if (!entryData.amount || parseFloat(entryData.amount) <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }

    const submitData: any = {
      customer: customer.id,
      entry_type: entryType,
      amount: parseFloat(entryData.amount),
      description: (entryData.description || '').trim(),
      created_at: entryData.date ? dateStringWithCurrentTimeISO(entryData.date) : undefined,
    };

    // Add store if a specific store is selected (not ALL)
    if (defaultStore?.id && defaultStore.id !== 0) {
      submitData.store = defaultStore.id;
    }

    createEntryMutation.mutate(submitData);
  };

  const filteredEntries = useMemo(() => {
    return [...allEntries].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [allEntries]);

  // Collect unique invoice IDs from filtered (debit) entries
  const invoiceIds = useMemo(() => {
    const ids = new Set<number>();
    filteredEntries.forEach((entry: any) => {
      if (entry.invoice && entry.entry_type === 'debit') {
        ids.add(entry.invoice);
      }
    });
    return Array.from(ids);
  }, [filteredEntries]);

  // Fetch all invoice details in parallel
  const invoiceQueries = useQueries({
    queries: invoiceIds.map((id) => ({
      queryKey: ['invoice-detail', id],
      queryFn: () => posApi.invoices.get(id),
      enabled: invoiceIds.length > 0,
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });

  const allInvoicesLoaded = invoiceQueries.length > 0 && invoiceQueries.every((q) => q.isSuccess);
  const anyInvoiceLoading = invoiceQueries.some((q) => q.isLoading);

  const invoicesData = useMemo(() => {
    if (!allInvoicesLoaded) return [];
    return invoiceQueries
      .map((q) => q.data?.data)
      .filter(Boolean);
  }, [allInvoicesLoaded, invoiceQueries]);

  const invoiceItemsMap = useMemo(() => {
    const map: Record<number, { product_name: string; quantity: number }[]> = {};
    invoicesData.forEach((inv: any) => {
      if (inv?.id && inv.items && Array.isArray(inv.items)) {
        map[inv.id] = inv.items.map((item: any) => ({
          product_name: item.product_name || 'Unknown',
          quantity: parseInt(item.quantity || '0') || 0,
        }));
      }
    });
    return map;
  }, [invoicesData]);

  // Number to words (Indian numbering) for the AIO invoice
  const numberToWords = (num: number): string => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    if (num === 0) return 'Zero Rupees Only';
    const convertHundreds = (n: number): string => {
      if (n === 0) return '';
      let result = '';
      if (n >= 100) { result += ones[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
      if (n >= 20) { result += tens[Math.floor(n / 10)] + ' '; n %= 10; }
      if (n > 0) { result += ones[n] + ' '; }
      return result.trim();
    };
    const convert = (n: number): string => {
      if (n === 0) return '';
      if (n >= 10000000) return convertHundreds(Math.floor(n / 10000000)) + ' Crore ' + convert(n % 10000000);
      if (n >= 100000) return convertHundreds(Math.floor(n / 100000)) + ' Lakh ' + convert(n % 100000);
      if (n >= 1000) return convertHundreds(Math.floor(n / 1000)) + ' Thousand ' + convert(n % 1000);
      return convertHundreds(n);
    };
    const integerPart = Math.floor(num);
    const decimalPart = Math.round((num % 1) * 100);
    let result = convert(integerPart).trim() || 'Zero';
    result += ' Rupees';
    if (decimalPart > 0) {
      const paiseWords = convert(decimalPart).trim();
      if (paiseWords) result += ' and ' + paiseWords + ' Paise';
    }
    return result + ' Only';
  };

  // Generate combined All-In-One invoice HTML
  const generateAIOInvoiceHTML = (): string => {
    if (invoicesData.length === 0) return '<html><body><p>No invoices to display.</p></body></html>';

    const companyName = 'Manish Traders';
    const companyAddress = 'Shop Number124-A Ground Floor\nChaitaniya Market Ghoda Nikkas Bhopal';

    // Combine all items from all invoices
    const allItems: any[] = [];
    const invoiceNumbers: string[] = [];
    let combinedTotal = 0;

    invoicesData.forEach((inv: any) => {
      if (inv.items && Array.isArray(inv.items)) {
        allItems.push(...inv.items);
      }
      combinedTotal += parseFloat(inv.total || '0');
      invoiceNumbers.push(inv.invoice_number || `#${inv.id}`);
    });

    const totalPcs = allItems.reduce((sum, item) => sum + (parseInt(item.quantity || '0') || 0), 0);
    const amountInWords = numberToWords(combinedTotal);

    // Group items by product name AND brand
    const groupedItems: Record<string, { name: string; brand: string; totalQuantity: number; totalAmount: number }> = {};
    allItems.forEach((item: any) => {
      const name = item.product_name || '-';
      const brand = item.product_brand_name || item.brand_name || '';
      const groupKey = brand ? `${name}::${brand}` : name;
      if (!groupedItems[groupKey]) {
        groupedItems[groupKey] = { name, brand, totalQuantity: 0, totalAmount: 0 };
      }
      groupedItems[groupKey].totalQuantity += parseInt(item.quantity || '0') || 0;
      groupedItems[groupKey].totalAmount += parseFloat(item.line_total || '0');
    });

    let itemsHtml = Object.values(groupedItems).map((group) => {
      const avgUnitPrice = group.totalQuantity > 0 ? group.totalAmount / group.totalQuantity : 0;
      const productDisplay = group.brand ? `${group.name} (${group.brand})` : group.name;
      const productColor = getProductNameColor(group.name);
      const productColorStyle = productColor ? ` color: ${productColor};` : '';
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="border-bottom: 1px solid #eee;${productColorStyle}">${productDisplay}</td>
          <td style="border-bottom: 1px solid #eee; text-align: center;">${formatNumber(group.totalQuantity, 3)}</td>
          <td style="border-bottom: 1px solid #eee; text-align: right;">${formatNumber(avgUnitPrice, 2)}</td>
          <td style="border-bottom: 1px solid #eee; text-align: center;">PCS</td>
          <td style="border-bottom: 1px solid #eee; text-align: right;">${formatNumber(group.totalAmount, 2)}</td>
        </tr>`;
    }).join('');

    itemsHtml += `<tr style="height: 100%;"><td style="border-bottom: none;"></td><td style="border-bottom: none;"></td><td style="border-bottom: none;"></td><td style="border-bottom: none;"></td><td style="border-bottom: none;"></td></tr>`;

    const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentBalance = parseFloat(finalBalance);

    return `<!DOCTYPE html>
<html>
<head>
  <title>Credit Invoice - ${customer?.name || 'Customer'}</title>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 10px; color: #000; line-height: 1.2; }
    .page-container { display: flex; flex-direction: column; min-height: 277mm; padding: 10px; }
    .content-area { flex: 1; display: flex; flex-direction: column; }
    .footer-area { margin-top: auto; }
    .top-section { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .top-left p, .top-right p { margin: 2px 0; font-size: 13px; }
    .top-right { text-align: right; }
    .company-header { text-align: center; margin-bottom: 10px; }
    .company-name { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
    .company-address { font-size: 13px; white-space: pre-line; margin-bottom: 2px; }
    .invoice-title { text-align: center; font-size: 20px; font-weight: bold; margin: 10px 0; text-transform: uppercase; }
    .party-section { margin-bottom: 10px; }
    .party-section p { margin: 2px 0; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; table-layout: fixed; }
    th, td { vertical-align: middle; }
    th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #000; font-weight: bold; font-size: 12px; }
    td { padding: 4px 8px; border-left: 1px solid #000; border-right: 1px solid #000; font-size: 12px; }
    .total-row td { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 6px 8px; font-weight: bold; }
    .amount-words { margin-top: 10px; margin-bottom: 10px; }
    .amount-words p { margin: 2px 0; font-size: 13px; }
    .footer { margin-top: 15px; text-align: center; border-top: 1px solid #000; padding-top: 5px; }
    .footer p { font-size: 11px; text-decoration: underline; }
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
      body { padding: 0; margin: 0; position: relative; }
      .page-container { min-height: 297mm; padding: 20mm 15mm; }
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="content-area">
      <div class="watermark">CREDIT</div>
      <div style="flex-shrink: 0;">
        <div class="top-section">
          <div class="top-left">
            <p><strong>Invoices:</strong> ${invoiceNumbers.join(', ')}</p>
          </div>
          <div class="top-right">
            <p><strong>Date:</strong> ${today}</p>
          </div>
        </div>
        <div class="company-header">
          <div class="company-name">${companyName}</div>
          <div class="company-address">${companyAddress}</div>
        </div>
        <div class="invoice-title">CREDIT INVOICE</div>
        <div class="party-section">
          <p><strong>Party :</strong> ${customer?.name || 'Customer'}</p>
          ${customer?.phone ? `<p><strong>Phone :</strong> ${customer.phone}</p>` : ''}
          <p><strong>PAN/IT no :</strong> -</p>
        </div>
      </div>
      <table style="flex: 1; border-bottom: 1px solid #000;">
        <thead>
          <tr>
            <th style="width: 45%; text-align: left;">Description of Good</th>
            <th style="width: 15%; text-align: center;">Quantity in PCS</th>
            <th style="width: 15%; text-align: right;">Rate</th>
            <th style="width: 10%; text-align: center;">Per (PCS)</th>
            <th style="width: 15%; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          <tr><td>Transport Charge</td><td></td><td></td><td></td><td style="text-align: right;">${formatNumber(0, 2)}</td></tr>
          <tr class="total-row">
            <td><strong>Total</strong></td>
            <td style="text-align: center;"><strong>${formatNumber(totalPcs, 3)}</strong></td>
            <td></td>
            <td></td>
            <td style="text-align: right;"><strong>${formatNumber(combinedTotal, 2)}</strong></td>
          </tr>
          ${currentBalance !== 0 ? `
          <tr class="total-row" style="border-top: 1px dashed #000;">
            <td><strong>Current Balance</strong></td>
            <td></td><td></td><td></td>
            <td style="text-align: right;"><strong>${currentBalance < 0 ? formatNumber(Math.abs(currentBalance), 2) + ' (Cr)' : formatNumber(currentBalance, 2)}</strong></td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>
    <div class="footer-area">
      <div class="amount-words">
        <p><strong>Amount Chargeable (in words)</strong> E &amp; OE</p>
        <p><strong>${amountInWords}</strong></p>
      </div>
      <div style="display: flex; justify-content: space-between; padding-top: 4px;">
        <div style="width: 60%;">
          <p style="font-size: 12px; margin-bottom: 4px;"><strong>Declaration:</strong></p>
          <p style="font-size: 11px; line-height: 1.4;">We declare that this invoice shows the actual price of the good described and that all particulars are true and correct.</p>
        </div>
        <div style="text-align: right; width: 40%;">
          <p style="font-size: 13px;"><strong>for ${companyName}</strong></p>
          <div style="margin-top: 45px;">
            <p style="font-size: 13px;"><strong>Authorised Signatory</strong></p>
          </div>
        </div>
      </div>
      <div class="footer"><p>This is a Computer Generated Invoice</p></div>
    </div>
  </div>
</body>
</html>`;
  };

  const handlePrintAIO = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const html = generateAIOInvoiceHTML();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { setTimeout(() => printWindow.print(), 250); };
  };

  const handlePhotoAIO = async () => {
    const iframe = aioPreviewRef.current;
    const doc = iframe?.contentDocument;
    const body = doc?.body;
    if (!body) {
      toast('AIO preview is not ready. Please wait a moment and try again.', 'error');
      return;
    }
    const el = doc?.documentElement;
    const w = el?.scrollWidth ?? 794;
    const h = el?.scrollHeight ?? 1123;
    try {
      const canvas = await html2canvas(body, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: w,
        windowHeight: h,
      });
      canvas.toBlob(
        (blob) => {
          if (!blob) { toast('Failed to create image.', 'error'); return; }
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
            () => toast('Combined invoice image copied to clipboard.', 'success'),
            () => toast('Failed to copy to clipboard.', 'error')
          );
        },
        'image/png',
        1
      );
    } catch {
      toast('Failed to capture AIO preview.', 'error');
    }
  };

  const handleExportExcel = () => {
    const data = filteredEntries.map((entry: any) => ({
      'Date': new Date(entry.created_at).toLocaleDateString(),
      'Type': entry.entry_type.toUpperCase(),
      'Description': entry.description || '-',
      'Debit': entry.entry_type === 'debit' ? formatAmountINR(entry.amount || 0) : '-',
      'Credit': entry.entry_type === 'credit' ? formatAmountINR(entry.amount || 0) : '-',
      'Balance': formatAmountINR(entry.running_balance || 0),
      'Invoice': entry.invoice_number || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger Statement');

    const fileName = `ledger_${customer?.name || 'customer'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();

    // Add title
    doc.setFontSize(18);
    doc.text(`${customer?.name || 'Customer'} Ledger Statement`, 14, 20);

    // Add customer info
    doc.setFontSize(10);
    doc.text(`Customer: ${customer?.name || 'N/A'}`, 14, 30);
    if (customer?.phone) {
      doc.text(`Phone: ${customer.phone}`, 14, 36);
    }

    // Add date range if filtered
    if (filters.dateFrom || filters.dateTo) {
      doc.text(
        `Date Range: ${filters.dateFrom || 'Start'} to ${filters.dateTo || 'End'}`,
        14,
        42
      );
    }

    // Add final balance
    doc.setFontSize(12);
    doc.text(
      `Current Balance: ₹${formatAmountINR(finalBalance)}`,
      14,
      50
    );

    // Prepare table data
    const tableData = filteredEntries.map((entry: any) => [
      new Date(entry.created_at).toLocaleDateString(),
      entry.entry_type.toUpperCase(),
      entry.description || '-',
      entry.entry_type === 'debit' ? `₹${formatAmountINR(entry.amount || 0)}` : '-',
      entry.entry_type === 'credit' ? `₹${formatAmountINR(entry.amount || 0)}` : '-',
      `₹${formatAmountINR(entry.running_balance || 0)}`,
      entry.invoice_number || '-',
    ]);

    (doc as any).autoTable({
      head: [['Date', 'Type', 'Description', 'Debit', 'Credit', 'Balance', 'Invoice']],
      body: tableData,
      startY: 55,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    const fileName = `ledger_${customer?.name || 'customer'}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${customer?.name || 'Customer'} Ledger Statement</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #1f2937; margin-bottom: 10px; }
            .info { color: #6b7280; margin-bottom: 20px; }
            .balance { font-size: 18px; font-weight: bold; margin: 20px 0; }
            .balance.positive { color: #059669; }
            .balance.negative { color: #dc2626; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #3b82f6; color: white; padding: 12px; text-align: left; }
            td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
            tr:hover { background-color: #f9fafb; }
            .credit { color: #059669; }
            .debit { color: #dc2626; }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>${customer?.name || 'Customer'} Ledger Statement</h1>
          <div class="info">
            ${customer?.phone ? `<p><strong>Phone:</strong> ${customer.phone}</p>` : ''}
            ${filters.dateFrom || filters.dateTo ?
        `<p><strong>Date Range:</strong> ${filters.dateFrom || 'Start'} to ${filters.dateTo || 'End'}</p>` : ''}
            <p><strong>Total Entries:</strong> ${filteredEntries.length}</p>
          </div>
          <div class="balance ${parseFloat(finalBalance) >= 0 ? 'positive' : 'negative'}">
            Current Balance: ₹${formatAmountINR(finalBalance)}
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Balance</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              ${filteredEntries.map((entry: any) => `
                <tr>
                  <td>${new Date(entry.created_at).toLocaleDateString()}</td>
                  <td>${entry.entry_type.toUpperCase()}</td>
                  <td>${entry.description || '-'}</td>
                  <td class="debit">${entry.entry_type === 'debit' ? `₹${formatAmountINR(entry.amount || 0)}` : '-'}</td>
                  <td class="credit">${entry.entry_type === 'credit' ? `₹${formatAmountINR(entry.amount || 0)}` : '-'}</td>
                  <td>₹${formatAmountINR(entry.running_balance || 0)}</td>
                  <td>${entry.invoice_number || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  };

  const handleResetFilters = () => {
    setFilters({
      dateFrom: '',
      dateTo: '',
      entryType: '',
      search: '',
    });
    setDatePreset('custom');
  };

  const hasActiveFilters = filters.entryType || filters.search || filters.dateFrom || filters.dateTo;

  const currentStore = selectedStoreId === 0 ? { name: 'All' } : stores.find((s: any) => s.id === selectedStoreId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <Button
            variant="outline"
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
                return;
              }
              navigate(ledgerListPath);
            }}
            size="sm"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-gray-900 truncate">
              {customer?.name || 'Customer'} Ledger
            </h1>
            {customer?.phone && (
              <p className="text-sm text-gray-600 mt-1">Phone: {customer.phone}</p>
            )}
          </div>
          {/* Store selector for Admin - choose ALL or a specific store */}
          {isAdmin && stores.length > 0 && (
            <div className="w-full sm:w-auto min-w-0">
              <div className="relative group">
                <div className="flex items-center gap-2 bg-white border-2 border-blue-200 rounded-xl px-3 py-2.5 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer">
                  <Store className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {currentStore?.name || 'Select Store'}
                  </span>
                  <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </div>
                <select
                  value={selectedStoreId == null ? '' : String(selectedStoreId)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedStoreId(val === '0' ? 0 : parseInt(val, 10));
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 appearance-none"
                >
                  <option value="0">All</option>
                  {stores.map((store: any) => (
                    <option key={store.id} value={store.id.toString()}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invoice items by category - first content block so it's always visible */}
      <div className="bg-white rounded-2xl shadow p-6 border border-blue-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
            <Package className="h-5 w-5 text-blue-600" />
            Products sold by category
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCategorySelector(!showCategorySelector)}
          >
            {selectedCategoryIds.length > 0
              ? `${selectedCategoryIds.length} categor${selectedCategoryIds.length === 1 ? 'y' : 'ies'} selected`
              : 'Select categories'}
          </Button>
        </div>
        {showCategorySelector && (
          <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50">
            <p className="text-sm text-gray-600 mb-3">Select categories to see total item count sold to this customer:</p>
            <div className="flex flex-wrap gap-3 max-h-48 overflow-y-auto">
              {(categories ?? []).map((cat: any) => (
                <label
                  key={cat.id}
                  className="flex items-center gap-2 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedCategoryIds.includes(cat.id)}
                    onChange={() => toggleCategory(cat.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800">{cat.name}</span>
                </label>
              ))}
              {(!categories || categories.length === 0) && (
                <p className="text-sm text-gray-500">No categories found.</p>
              )}
            </div>
          </div>
        )}
        {selectedCategoryIds.length > 0 ? (
          <div className="space-y-2">
            <p className="text-lg font-semibold text-gray-900">
              Total items (selected categories): <span className="text-blue-600">{categoryTotalCount}</span>
            </p>
            {(filters.dateFrom || filters.dateTo) && (
              <p className="text-xs text-gray-500">
                Based on statement date filter: {filters.dateFrom || '…'} to {filters.dateTo || '…'}
              </p>
            )}
            {categoryBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {categoryBreakdown.map((row: { id: number; name: string; count: number }) => (
                  <span
                    key={row.id ?? row.name}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-800"
                  >
                    {row.name}: {row.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Select one or more categories above to see the count of products sold to this customer in those categories.</p>
        )}
      </div>

      {/* Balance Summary */}
      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Current Balance</p>
            <p className={`text-3xl font-bold mt-1 flex items-baseline gap-2 ${parseFloat(finalBalance) >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
              ₹{formatAmountINR(finalBalance)}
              <span className="text-3xl font-bold text-yellow-500">
                (Pending ₹{formatAmountINR(pendingInvoiceTotal)})
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => handleCreateEntry('credit')}
              className="bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Credit (+)
            </Button>
            <Button
              onClick={() => handleCreateEntry('debit')}
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50"
            >
              <Minus className="h-4 w-4 mr-2" />
              Debit (-)
            </Button>
          </div>
        </div>
      </div>

      {/* Statement Table */}
      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Statement</h2>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setShowCreditInvoicesOnly(!showCreditInvoicesOnly)}
              className={`flex items-center gap-2 ${!showCreditInvoicesOnly ? 'bg-blue-100 text-blue-700 border-blue-300' : ''}`}
              title={showCreditInvoicesOnly ? 'Show all entries' : 'Show only credit invoice entries'}
            >
              <Receipt className="h-4 w-4" />
              {showCreditInvoicesOnly ? 'Credit Invoices Only' : 'All Invoices'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filters
              {hasActiveFilters && (
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                  {[filters.entryType, filters.search, filters.dateFrom, filters.dateTo].filter(Boolean).length}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportExcel}
              className="flex items-center gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
            <Button
              variant="outline"
              onClick={handleExportPDF}
              className="flex items-center gap-2"
            >
              <FileTextIcon className="h-4 w-4" />
              PDF
            </Button>
            <Button
              variant="outline"
              onClick={handlePrint}
              className="flex items-center gap-2"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
            {invoiceIds.length > 0 && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!allInvoicesLoaded) { toast('Invoices are still loading...', 'info'); return; }
                    handlePrintAIO();
                  }}
                  disabled={anyInvoiceLoading}
                  className="flex items-center gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                >
                  <Printer className="h-4 w-4" />
                  {anyInvoiceLoading ? 'Loading...' : 'Print AIO'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!allInvoicesLoaded) { toast('Invoices are still loading...', 'info'); return; }
                    handlePhotoAIO();
                  }}
                  disabled={anyInvoiceLoading}
                  className="flex items-center gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                >
                  <Camera className="h-4 w-4" />
                  {anyInvoiceLoading ? 'Loading...' : 'Photo AIO'}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="border-t pt-4 mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date Range
                </label>
                <DateRangeSelector
                  preset={datePreset}
                  value={{ startDate: filters.dateFrom, endDate: filters.dateTo }}
                  onChange={({ preset, range }) => {
                    setDatePreset(preset);
                    setFilters({ ...filters, dateFrom: range.startDate, dateTo: range.endDate });
                  }}
                />
              </div>
              <div>
                <Select
                  label="Entry Type"
                  value={filters.entryType}
                  onChange={(e) => setFilters({ ...filters, entryType: e.target.value })}
                >
                  <option value="">All Types</option>
                  <option value="credit">Credit</option>
                  <option value="debit">Debit</option>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Search className="h-4 w-4 inline mr-1" />
                  Search
                </label>
                <Input
                  placeholder="Search description, invoice..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                Reset Filters
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : filteredEntries && filteredEntries.length > 0 ? (
          <div className="overflow-x-auto mt-6">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Type</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Description</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Debit</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Credit</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Balance</th>
                  <th className="text-left py-3 px-2 font-semibold text-gray-700">Inv#</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Products</th>
                  {isAdmin && <th className="text-right py-3 px-4 font-semibold text-gray-700">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry: any) => (
                  <tr key={entry.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-gray-700">
                      {new Date(entry.created_at).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${entry.entry_type === 'credit'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                        }`}>
                        {entry.entry_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-700">{entry.description || '-'}</td>
                    <td className="py-3 px-4 text-right text-red-600 font-medium">
                      {entry.entry_type === 'debit' ? `₹${formatAmountINR(entry.amount || 0)}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-right text-green-600 font-medium">
                      {entry.entry_type === 'credit' ? `₹${formatAmountINR(entry.amount || 0)}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-900">
                      ₹{formatAmountINR(entry.running_balance || 0)}
                    </td>
                    <td className="py-3 px-2">
                      {entry.invoice_number ? (
                        <button
                          onClick={() => navigate(`/invoices/${entry.invoice}`)}
                          className="text-blue-600 hover:underline text-xs font-medium"
                          title={entry.invoice_number}
                        >
                          {entry.invoice_number}
                        </button>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {entry.invoice && invoiceItemsMap[entry.invoice] ? (
                        <div className="flex flex-col gap-0.5">
                          {invoiceItemsMap[entry.invoice].map((item, idx) => (
                            <span key={idx} className="text-xs text-gray-700">
                              {item.product_name} <span className="text-gray-400">×</span> {item.quantity}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => { setEditingEntry(entry); setEditEntryData({ amount: amountForInput(entry.amount), description: entry.description || '', date: entry.created_at ? toLocalDateString(entry.created_at) : '', entryType: (entry.entry_type || 'credit') as 'credit' | 'debit' }); }} className="p-2 text-gray-500 hover:text-blue-600 rounded" title="Edit"><Pencil className="h-4 w-4" /></button>
                          <button type="button" onClick={() => setDeletingEntryId(entry.id)} className="p-2 text-gray-500 hover:text-red-600 rounded" title="Remove"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 text-sm text-gray-600">
              Showing <strong>{filteredEntries.length}</strong> of <strong>{allEntries.length}</strong> entries
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <FileText className="h-12 w-12 mx-auto mb-2 text-gray-300" />
            <p>No ledger entries for this customer</p>
            {hasActiveFilters && (
              <p className="text-sm mt-2">Try adjusting your filters</p>
            )}
          </div>
        )}
      </div>

      {/* AIO Credit Invoice Preview - always visible when invoices are loaded */}
      {allInvoicesLoaded && invoicesData.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-600" />
              Credit Invoice Preview
              <span className="text-sm font-normal text-gray-500">
                ({invoicesData.length} invoice{invoicesData.length !== 1 ? 's' : ''} combined)
              </span>
            </h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handlePrintAIO}
                className="flex items-center gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <Button
                variant="outline"
                onClick={handlePhotoAIO}
                className="flex items-center gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
              >
                <Camera className="h-4 w-4" />
                Copy as Image
              </Button>
            </div>
          </div>
          <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 shadow-lg">
            <div className="bg-gray-50 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">A4 Credit Invoice Preview</span>
              <span className="text-xs text-gray-500 hidden sm:inline">All credit invoices combined into one</span>
            </div>
            <div className="bg-gray-200 p-4 sm:p-8 flex justify-center overflow-auto" style={{ maxHeight: '900px' }}>
              <div
                className="bg-white shadow-2xl mx-auto"
                style={{ width: '210mm', minHeight: '297mm', maxWidth: '100%', boxShadow: '0 0 20px rgba(0,0,0,0.3)' }}
              >
                <iframe
                  ref={aioPreviewRef}
                  title="AIO Invoice Preview"
                  srcDoc={generateAIOInvoiceHTML()}
                  className="w-full border-0 block"
                  style={{ width: '100%', minHeight: '297mm', border: 'none', display: 'block' }}
                  onLoad={(e) => {
                    const iframe = e.target as HTMLIFrameElement;
                    if (iframe.contentWindow?.document?.body) {
                      const body = iframe.contentWindow.document.body;
                      const html = iframe.contentWindow.document.documentElement;
                      const height = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
                      iframe.style.height = (height + 40) + 'px';
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Entry Modal (Admin only) */}
      <Modal isOpen={!!editingEntry} onClose={() => { setEditingEntry(null); setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' }); }} title="Edit Ledger Entry">
        {editingEntry && (
          <form onSubmit={(e) => { e.preventDefault(); if (!editEntryData.amount || parseFloat(editEntryData.amount) <= 0) { toast('Please enter a valid amount', 'error'); return; } updateEntryMutation.mutate({ id: editingEntry.id, data: { entry_type: editEntryData.entryType, amount: parseFloat(editEntryData.amount), description: (editEntryData.description || '').trim(), created_at: editEntryData.date ? dateStringWithCurrentTimeISO(editEntryData.date) : undefined } }); }} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Date</label><DatePicker value={editEntryData.date} onChange={(date) => setEditEntryData({ ...editEntryData, date })} required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Entry Type</label><Select value={editEntryData.entryType} onChange={(e) => setEditEntryData({ ...editEntryData, entryType: e.target.value as 'credit' | 'debit' })}><option value="credit">Credit</option><option value="debit">Debit</option></Select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Amount</label><Input type="number" step="0.01" value={editEntryData.amount} onChange={(e) => setEditEntryData({ ...editEntryData, amount: e.target.value })} required /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Description</label><textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={3} value={editEntryData.description} onChange={(e) => setEditEntryData({ ...editEntryData, description: e.target.value })} /></div>
            <div className="flex gap-2 justify-end"><Button type="button" variant="outline" onClick={() => { setEditingEntry(null); setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' }); }}>Cancel</Button><Button type="submit" disabled={updateEntryMutation.isPending}>{updateEntryMutation.isPending ? 'Saving...' : 'Save'}</Button></div>
          </form>
        )}
      </Modal>
      {/* Delete Entry Confirmation (Admin only) */}
      <Modal isOpen={deletingEntryId !== null} onClose={() => setDeletingEntryId(null)} title="Remove entry?">
        <p className="text-gray-600 mb-4">This will remove the entry and adjust the customer balance. This cannot be undone.</p>
        <div className="flex gap-2 justify-end"><Button variant="outline" onClick={() => setDeletingEntryId(null)}>Cancel</Button><Button className="bg-red-600 hover:bg-red-700" disabled={deleteEntryMutation.isPending} onClick={() => deletingEntryId !== null && deleteEntryMutation.mutate(deletingEntryId)}>{deleteEntryMutation.isPending ? 'Removing...' : 'Remove'}</Button></div>
      </Modal>
      {/* Entry Form Modal */}
      <Modal
        isOpen={showEntryForm}
        onClose={() => {
          setShowEntryForm(false);
          setEntryData({ amount: '', description: '', date: toLocalDateString(new Date()) });
        }}
        title={entryType === 'credit' ? 'Add Credit Entry' : 'Add Debit Entry'}
      >
        <form onSubmit={handleSubmitEntry} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer
            </label>
            <Input
              value={customer?.name || ''}
              disabled
              className="bg-gray-100 cursor-not-allowed"
            />
            {customer?.phone && (
              <p className="text-xs text-gray-500 mt-1">Phone: {customer.phone}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Date
            </label>
            <DatePicker
              value={entryData.date}
              onChange={(date) => setEntryData({ ...entryData, date })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amount
            </label>
            <Input
              type="number"
              step="0.01"
              placeholder="Enter amount"
              value={entryData.amount}
              onChange={(e) => setEntryData({ ...entryData, amount: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Enter description"
              value={entryData.description}
              onChange={(e) => setEntryData({ ...entryData, description: e.target.value })}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowEntryForm(false);
                setEntryData({ amount: '', description: '', date: toLocalDateString(new Date()) });
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createEntryMutation.isPending}
              className={entryType === 'credit' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {createEntryMutation.isPending ? 'Creating...' : `Create ${entryType === 'credit' ? 'Credit' : 'Debit'} Entry`}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
