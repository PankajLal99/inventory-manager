import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { customersApi, catalogApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { formatAmountINR, toLocalDateString, dateStringWithCurrentTimeISO } from '../../lib/utils';
import { toast } from '../../lib/toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import DatePicker from '../../components/ui/DatePicker';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import {
  Plus, Minus, FileText, Users, TrendingUp, TrendingDown,
  FileSpreadsheet, FileText as FileTextIcon, Printer,
  Filter, X, Calendar, Search,
  Store, ChevronDown, UserPlus, Receipt
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

export default function Ledger() {
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit');
  const [entryData, setEntryData] = useState({ amount: '', description: '', date: toLocalDateString(new Date()) });
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null); // 0 = ALL (no shop filter)
  const [user, setUser] = useState<any>(null);
  const [showCreateCustomerModal, setShowCreateCustomerModal] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
  });

  // Filters - Default to all time (no date filter) to show all entries
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    entryType: '',
    customer: '',
    customerGroup: '',
    search: '',
  });
  const [showCreditInvoicesOnly, setShowCreditInvoicesOnly] = useState(true); // Default enabled
  const [showFilters, setShowFilters] = useState(false);
  const [sortConfig, _setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [customerFilterOpen, setCustomerFilterOpen] = useState(false);
  const [customerFilterSearch, setCustomerFilterSearch] = useState('');
  const customerFilterRef = useRef<HTMLDivElement>(null);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editEntryData, setEditEntryData] = useState({ amount: '', description: '', date: '', entryType: 'credit' as 'credit' | 'debit' });
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
  const isAdmin = user?.is_admin || user?.is_superuser || user?.is_staff ||
    (user?.groups && user.groups.some((group: string) => group.includes('Admin')));

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
      // Default to All for any admin-like user
      setSelectedStoreId(0);
    }
  }, [isAdmin, selectedStoreId]);

  // Close customer filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (customerFilterRef.current && !customerFilterRef.current.contains(e.target as Node)) {
        setCustomerFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get current selected store for display (ALL when selectedStoreId === 0)
  const currentStore = selectedStoreId === 0 ? { name: 'All' } : stores.find((s: any) => s.id === selectedStoreId);

  const { data: customersResponse } = useQuery({
    queryKey: ['customers', customerSearch],
    queryFn: async () => {
      const response = await customersApi.list({ search: customerSearch });
      return response.data;
    },
    enabled: customerSearch.trim().length > 0,
    retry: false,
  });

  const { data: allCustomers } = useQuery({
    queryKey: ['all-customers'],
    queryFn: async () => {
      const response = await customersApi.list();
      return response.data;
    },
    retry: false,
  });

  const { data: customerGroupsResponse } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: async () => {
      const response = await customersApi.groups.list();
      return response.data;
    },
    retry: false,
  });

  const { data: ledgerSummary } = useQuery({
    queryKey: ['ledger-summary', defaultStore?.id, showCreditInvoicesOnly],
    queryFn: async () => {
      const params: any = {};
      if (defaultStore?.id && defaultStore.id !== 0) params.store = defaultStore.id;
      // Filter to show only credit invoices (if toggle is enabled)
      if (showCreditInvoicesOnly) {
        params.invoice_status = 'credit';
      }
      const response = await customersApi.ledger.summary(params);
      return response.data;
    },
    enabled: !!defaultStore,
    retry: false,
  });

  const buildLedgerParams = useMemo(() => {
    const params: any = {};
    if (filters.dateFrom) params.date_from = filters.dateFrom;
    if (filters.dateTo) params.date_to = filters.dateTo;
    if (filters.entryType) params.entry_type = filters.entryType;
    if (filters.customer) params.customer = filters.customer;
    if (filters.customerGroup) params.customer_group = filters.customerGroup;
    if (filters.search) params.search = filters.search;
    // Only filter by store when a specific store is selected (not ALL)
    if (defaultStore?.id && defaultStore.id !== 0) params.store = defaultStore.id;
    return params;
  }, [filters.dateFrom, filters.dateTo, filters.entryType, filters.customer, filters.customerGroup, filters.search, defaultStore?.id]);

  const { data: ledgerEntries, isLoading: entriesLoading, error } = useQuery({
    queryKey: ['ledger-entries', buildLedgerParams, defaultStore?.id],
    queryFn: async () => {
      const params = { ...buildLedgerParams };
      const response = await customersApi.ledger.entries.list(params);
      return response.data;
    },
    enabled: !!defaultStore && !showCreditInvoicesOnly,
    retry: false,
  });

  const { data: ledgerByCustomer, isLoading: byCustomerLoading } = useQuery({
    queryKey: ['ledger-by-customer', buildLedgerParams, defaultStore?.id],
    queryFn: async () => {
      const params = { ...buildLedgerParams };
      params.invoice_status = 'credit';
      const response = await customersApi.ledger.byCustomer(params);
      return response.data;
    },
    enabled: !!defaultStore && showCreditInvoicesOnly,
    retry: false,
  });

  const isLoading = showCreditInvoicesOnly ? byCustomerLoading : entriesLoading;

  const createEntryMutation = useMutation({
    mutationFn: (data: any) => customersApi.ledger.entries.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-by-customer'] });
      setShowEntryForm(false);
      setSelectedCustomer(null);
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
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-by-customer'] });
      setEditingEntry(null);
      setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' });
      toast('Ledger entry updated successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to update ledger entry', 'error');
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => customersApi.ledger.entries.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-by-customer'] });
      setDeletingEntryId(null);
      toast('Ledger entry removed successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to remove ledger entry', 'error');
      setDeletingEntryId(null);
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: (data: any) => customersApi.create(data),
    onSuccess: (response) => {
      const newCustomer = response.data;
      setSelectedCustomer(newCustomer);
      setCustomerSearch('');
      setNewCustomerData({ name: '', phone: '', email: '', address: '' });
      setShowCreateCustomerModal(false);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['all-customers'] });
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || error?.response?.data?.message || 'Failed to create customer', 'error');
    },
  });

  const handleCreateEntry = (type: 'credit' | 'debit') => {
    setEntryType(type);
    setShowEntryForm(true);
  };

  const handleSubmitEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      toast('Please select a customer', 'error');
      return;
    }
    if (!entryData.amount || parseFloat(entryData.amount) <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }

    createEntryMutation.mutate({
      customer: selectedCustomer.id,
      entry_type: entryType,
      amount: parseFloat(entryData.amount),
      description: (entryData.description || '').trim(),
      created_at: entryData.date ? dateStringWithCurrentTimeISO(entryData.date) : undefined,
    });
  };

  const customers = (() => {
    if (!customersResponse) return [];
    if (Array.isArray(customersResponse.results)) return customersResponse.results;
    if (Array.isArray(customersResponse.data)) return customersResponse.data;
    if (Array.isArray(customersResponse)) return customersResponse;
    return [];
  })();

  const allCustomersList = (() => {
    if (!allCustomers) return [];
    if (Array.isArray(allCustomers.results)) return allCustomers.results;
    if (Array.isArray(allCustomers.data)) return allCustomers.data;
    if (Array.isArray(allCustomers)) return allCustomers;
    return [];
  })();

  const entries = (() => {
    if (!ledgerEntries) return [];
    if (Array.isArray(ledgerEntries)) return ledgerEntries;
    if (ledgerEntries && typeof ledgerEntries === 'object') {
      if (Array.isArray(ledgerEntries.results)) return ledgerEntries.results;
      if (Array.isArray(ledgerEntries.data)) return ledgerEntries.data;
    }
    return [];
  })();

  const filteredEntries = useMemo(() => {
    if (showCreditInvoicesOnly) return [];
    let sorted = [...entries];
    if (sortConfig) {
      sorted.sort((a, b) => {
        let aValue: any;
        let bValue: any;
        switch (sortConfig.key) {
          case 'date':
            aValue = new Date(a.created_at).getTime();
            bValue = new Date(b.created_at).getTime();
            break;
          case 'customer':
            aValue = (a.customer_name || 'Anonymous').toLowerCase();
            bValue = (b.customer_name || 'Anonymous').toLowerCase();
            break;
          case 'type':
            aValue = a.entry_type;
            bValue = b.entry_type;
            break;
          case 'amount':
            aValue = parseFloat(a.amount || 0);
            bValue = parseFloat(b.amount || 0);
            break;
          default:
            return 0;
        }
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      sorted.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    return sorted;
  }, [entries, sortConfig, showCreditInvoicesOnly]);

  const totalCredit = useMemo(() => {
    if (showCreditInvoicesOnly && ledgerSummary) return parseFloat(String(ledgerSummary.total_credit || 0));
    return filteredEntries
      .filter((e: any) => e.entry_type === 'credit')
      .reduce((sum: number, e: any) => sum + parseFloat(e.amount || 0), 0);
  }, [showCreditInvoicesOnly, ledgerSummary, filteredEntries]);

  const totalDebit = useMemo(() => {
    if (showCreditInvoicesOnly && ledgerSummary) return parseFloat(String(ledgerSummary.total_debit || 0));
    return filteredEntries
      .filter((e: any) => e.entry_type === 'debit')
      .reduce((sum: number, e: any) => sum + parseFloat(e.amount || 0), 0);
  }, [showCreditInvoicesOnly, ledgerSummary, filteredEntries]);

  // Group entries by customer: from aggregated API when credit-only, else from filtered entries
  const groupedByCustomer = useMemo(() => {
    if (showCreditInvoicesOnly && Array.isArray(ledgerByCustomer)) {
      const grouped: { [key: string]: { customer: any; entries: any[]; entryCount?: number; totalCredit: number; totalDebit: number; netAmount: number; latestDescription: string } } = {};
      ledgerByCustomer.forEach((row: any) => {
        const customerId = row.customer_id != null ? `customer-${row.customer_id}` : 'anonymous';
        const totalCredit = parseFloat(row.total_credit || 0);
        const totalDebit = parseFloat(row.total_debit || 0);
        const entryCount = Number(row.entry_count) || 0;
        grouped[customerId] = {
          customer: { id: row.customer_id ?? null, name: row.customer_name || 'Anonymous' },
          entries: [],
          entryCount,
          totalCredit,
          totalDebit,
          netAmount: parseFloat(row.net_amount || 0),
          latestDescription: row.latest_description || '',
        };
      });
      return grouped;
    }
    const grouped: { [key: string]: { customer: any; entries: any[]; entryCount?: number; totalCredit: number; totalDebit: number; netAmount: number; latestDescription: string } } = {};
    filteredEntries.forEach((entry: any) => {
      const customerId = entry.customer ? `customer-${entry.customer}` : 'anonymous';
      const customerName = entry.customer_name || 'Anonymous';
      if (!grouped[customerId]) {
        grouped[customerId] = {
          customer: { id: entry.customer || null, name: customerName },
          entries: [],
          totalCredit: 0,
          totalDebit: 0,
          netAmount: 0,
          latestDescription: '',
        };
      }
      grouped[customerId].entries.push(entry);
      if (entry.entry_type === 'credit') {
        grouped[customerId].totalCredit += parseFloat(entry.amount || 0);
      } else {
        grouped[customerId].totalDebit += parseFloat(entry.amount || 0);
      }
    });
    Object.keys(grouped).forEach(key => {
      grouped[key].netAmount = grouped[key].totalCredit - grouped[key].totalDebit;
      const byDate = [...grouped[key].entries].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      grouped[key].latestDescription = byDate[0]?.description || '';
      grouped[key].entries = byDate;
    });
    return grouped;
  }, [showCreditInvoicesOnly, ledgerByCustomer, filteredEntries]);

  const totalEntryCount = useMemo(() => {
    if (showCreditInvoicesOnly) {
      return Object.values(groupedByCustomer).reduce((sum, g) => sum + (g.entryCount ?? 0), 0);
    }
    return filteredEntries.length;
  }, [showCreditInvoicesOnly, groupedByCustomer, filteredEntries.length]);

  const hasDataToShow = useMemo(() => {
    if (showCreditInvoicesOnly) return Array.isArray(ledgerByCustomer) && ledgerByCustomer.length > 0;
    return filteredEntries.length > 0;
  }, [showCreditInvoicesOnly, ledgerByCustomer, filteredEntries.length]);

  const handleExportExcel = () => {
    const data = showCreditInvoicesOnly
      ? Object.values(groupedByCustomer).map((group: any) => ({
          'Customer': group.customer.name,
          'Entries': group.entryCount ?? group.entries.length,
          'Total Credit': formatAmountINR(group.totalCredit),
          'Total Debit': formatAmountINR(group.totalDebit),
          'Net Amount': formatAmountINR(group.netAmount),
          'Latest Description': group.latestDescription || '-',
        }))
      : filteredEntries.map((entry: any) => ({
          'Date': new Date(entry.created_at).toLocaleDateString(),
          'Customer': entry.customer_name || 'Anonymous',
          'Group': entry.customer_group_name || '-',
          'Type': entry.entry_type.toUpperCase(),
          'Description': entry.description || '-',
          'Amount': formatAmountINR(parseFloat(entry.amount || 0)),
          'Invoice': entry.invoice_number || '-',
        }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, showCreditInvoicesOnly ? 'Ledger by Customer' : 'Ledger Entries');

    const fileName = `ledger_${showCreditInvoicesOnly ? 'by_customer' : 'entries'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text(showCreditInvoicesOnly ? 'Ledger by Customer (Credit Invoices)' : 'Ledger Entries Report', 14, 20);

    doc.setFontSize(10);
    if (filters.dateFrom || filters.dateTo) {
      doc.text(`Date Range: ${filters.dateFrom || '—'} to ${filters.dateTo || '—'}`, 14, 30);
    } else if (showCreditInvoicesOnly) {
      doc.text('All credit invoices (no date filter)', 14, 30);
    }

    if (showCreditInvoicesOnly) {
      const tableData = Object.values(groupedByCustomer).map((group: any) => [
        group.customer.name,
        String(group.entryCount ?? group.entries.length),
        `₹${formatAmountINR(group.totalCredit)}`,
        `₹${formatAmountINR(group.totalDebit)}`,
        `₹${formatAmountINR(group.netAmount)}`,
        (group.latestDescription || '-').slice(0, 40),
      ]);
      (doc as any).autoTable({
        head: [['Customer', 'Entries', 'Total Credit', 'Total Debit', 'Net Amount', 'Latest Description']],
        body: tableData,
        startY: 35,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [59, 130, 246] },
      });
    } else {
      const tableData = filteredEntries.map((entry: any) => [
        new Date(entry.created_at).toLocaleDateString(),
        entry.customer_name || 'Anonymous',
        entry.customer_group_name || '-',
        entry.entry_type.toUpperCase(),
        entry.description || '-',
        `₹${formatAmountINR(entry.amount || 0)}`,
        entry.invoice_number || '-',
      ]);
      (doc as any).autoTable({
        head: [['Date', 'Customer', 'Group', 'Type', 'Description', 'Amount', 'Invoice']],
        body: tableData,
        startY: 35,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [59, 130, 246] },
      });
    }

    const fileName = `ledger_${showCreditInvoicesOnly ? 'by_customer' : 'entries'}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = showCreditInvoicesOnly
      ? `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ledger by Customer (Credit Invoices)</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #1f2937; margin-bottom: 10px; }
            .info { color: #6b7280; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background-color: #3b82f6; color: white; padding: 12px; text-align: left; }
            td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
            tr:hover { background-color: #f9fafb; }
            .credit { color: #059669; }
            .debit { color: #dc2626; }
            @media print { body { margin: 0; } .no-print { display: none; } }
          </style>
        </head>
        <body>
          <h1>Ledger by Customer (Credit Invoices)</h1>
          <div class="info">
            <p><strong>Date Range:</strong> ${filters.dateFrom || '—'} to ${filters.dateTo || '—'} ${!filters.dateFrom && !filters.dateTo ? '(all)' : ''}</p>
            <p><strong>Customers:</strong> ${Object.keys(groupedByCustomer).length} | <strong>Total Entries:</strong> ${totalEntryCount}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Entries</th>
                <th>Total Credit</th>
                <th>Total Debit</th>
                <th>Net Amount</th>
                <th>Latest Description</th>
              </tr>
            </thead>
            <tbody>
              ${Object.values(groupedByCustomer).map((group: any) => `
                <tr>
                  <td>${group.customer.name}</td>
                  <td>${group.entryCount ?? group.entries.length}</td>
                  <td class="credit">+₹${formatAmountINR(group.totalCredit)}</td>
                  <td class="debit">-₹${formatAmountINR(group.totalDebit)}</td>
                  <td class="${group.netAmount >= 0 ? 'credit' : 'debit'}">${group.netAmount >= 0 ? '+' : ''}₹${formatAmountINR(group.netAmount)}</td>
                  <td>${(group.latestDescription || '-').replace(/</g, '&lt;')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `
      : `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ledger Entries Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #1f2937; margin-bottom: 10px; }
            .info { color: #6b7280; margin-bottom: 20px; }
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
          <h1>Ledger Entries Report</h1>
          <div class="info">
            <p><strong>Date Range:</strong> ${filters.dateFrom} to ${filters.dateTo}</p>
            <p><strong>Total Entries:</strong> ${filteredEntries.length}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Group</th>
                <th>Type</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              ${filteredEntries.map((entry: any) => `
                <tr>
                  <td>${new Date(entry.created_at).toLocaleDateString()}</td>
                  <td>${entry.customer_name || 'Anonymous'}</td>
                  <td>${entry.customer_group_name || '-'}</td>
                  <td>${entry.entry_type.toUpperCase()}</td>
                  <td>${entry.description || '-'}</td>
                  <td class="${entry.entry_type === 'credit' ? 'credit' : 'debit'}">
                    ${entry.entry_type === 'credit' ? '+' : '-'}₹${formatAmountINR(entry.amount || 0)}
                  </td>
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
      customer: '',
      customerGroup: '',
      search: '',
    });
  };

  const customerGroups = (() => {
    if (!customerGroupsResponse) return [];
    if (Array.isArray(customerGroupsResponse.results)) return customerGroupsResponse.results;
    if (Array.isArray(customerGroupsResponse.data)) return customerGroupsResponse.data;
    if (Array.isArray(customerGroupsResponse)) return customerGroupsResponse;
    return [];
  })();

  const hasActiveFilters = filters.entryType || filters.customer || filters.customerGroup || filters.search;

  if (!defaultStore && stores.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Ledger (Vyapaar)</h2>
          <p className="text-red-600 mb-4">No store available. Please create a store first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 w-full sm:w-auto">
          <h1 className="text-3xl font-bold text-gray-900">Ledger (Vyapaar)</h1>
          {/* Store Selector for Admin users */}
          {isAdmin && stores.length > 0 && (
            <div className="w-full sm:w-auto">
              <div className="relative group">
                <div className="flex items-center gap-2 sm:gap-3 bg-white border-2 border-blue-200 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 cursor-pointer">
                  <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 p-1.5 bg-blue-50 rounded-lg">
                      <Store className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm sm:text-base font-semibold text-gray-900 truncate block">
                        {currentStore?.name || 'Select Store'}
                      </span>
                    </div>
                    <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0" />
                  </div>
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
        <div className="flex items-center gap-2 w-full sm:w-auto">
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Credit</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ₹{formatAmountINR(ledgerSummary?.total_credit || '0')}
              </p>
            </div>
            <TrendingUp className="h-12 w-12 text-green-600" />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Debit</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                ₹{formatAmountINR(ledgerSummary?.total_debit || '0')}
              </p>
            </div>
            <TrendingDown className="h-12 w-12 text-red-600" />
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Number of Accounts</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {ledgerSummary?.num_accounts || 0}
              </p>
            </div>
            <Users className="h-12 w-12 text-blue-600" />
          </div>
        </div>
      </div>

      {/* Filters and Actions */}
      <div className="bg-white rounded-2xl shadow p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <h2 className="text-xl font-semibold">Ledger Entries</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCreditInvoicesOnly(!showCreditInvoicesOnly)}
              className={`flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2 ${!showCreditInvoicesOnly ? 'bg-blue-100 text-blue-700 border-blue-300' : ''}`}
              title={showCreditInvoicesOnly ? 'Click to show all invoices' : 'Click to show credit invoices only'}
            >
              <Receipt className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{showCreditInvoicesOnly ? 'Credit Only' : 'All Invoices'}</span>
            </Button>
            <div className="relative flex-1 min-w-[140px] max-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                placeholder="Search name, phone, description..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="pl-9 py-1.5 h-9 text-sm border-gray-300 rounded-lg"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
            >
              <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Filters</span>
              {hasActiveFilters && (
                <span className="bg-blue-600 text-white rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center text-xs flex-shrink-0">
                  {[filters.entryType, filters.customer, filters.customerGroup, filters.search].filter(Boolean).length}
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Excel</span>
            </Button>
            <Button
              variant="outline"
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
            >
              <FileTextIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="hidden sm:inline">PDF</span>
            </Button>
            <Button
              variant="outline"
              onClick={handlePrint}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
            >
              <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Print</span>
            </Button>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="border-t pt-4 mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date From
                </label>
                <DatePicker
                  value={filters.dateFrom}
                  onChange={(date) => setFilters({ ...filters, dateFrom: date })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date To
                </label>
                <DatePicker
                  value={filters.dateTo}
                  onChange={(date) => setFilters({ ...filters, dateTo: date })}
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
              <div ref={customerFilterRef} className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Customer
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerFilterOpen((o) => !o);
                    if (!customerFilterOpen) setCustomerFilterSearch('');
                  }}
                  className="block w-full px-3 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors flex items-center justify-between"
                >
                  <span className="truncate">
                    {filters.customer
                      ? (() => {
                          const c = allCustomersList.find((x: any) => String(x.id) === filters.customer);
                          return c ? `${c.name}${c.phone ? ` (${c.phone})` : ''}` : 'All Customers';
                        })()
                      : 'All Customers'}
                  </span>
                  <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 ml-2" />
                </button>
                {customerFilterOpen && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-72 flex flex-col">
                    <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Type to search customer..."
                          value={customerFilterSearch}
                          onChange={(e) => setCustomerFilterSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <ul className="overflow-auto py-1 max-h-56">
                      <li>
                        <button
                          type="button"
                          onClick={() => {
                            setFilters({ ...filters, customer: '' });
                            setCustomerFilterOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${!filters.customer ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                        >
                          All Customers
                        </button>
                      </li>
                      {allCustomersList
                        .filter((customer: any) => {
                          const q = customerFilterSearch.trim().toLowerCase();
                          if (!q) return true;
                          const name = (customer.name || '').toLowerCase();
                          const phone = (customer.phone || '').toLowerCase();
                          return name.includes(q) || phone.includes(q);
                        })
                        .map((customer: any) => (
                          <li key={customer.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setFilters({ ...filters, customer: String(customer.id) });
                                setCustomerFilterOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${filters.customer === String(customer.id) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}
                            >
                              {customer.name} {customer.phone ? `(${customer.phone})` : ''}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <Select
                  label="Customer Group"
                  value={filters.customerGroup}
                  onChange={(e) => setFilters({ ...filters, customerGroup: e.target.value })}
                >
                  <option value="">All Groups</option>
                  {customerGroups.map((group: any) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
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

        {/* Ledger Entries Table */}
        {error ? (
          <div className="mt-6 text-center py-16 bg-red-50 rounded-lg border-2 border-dashed border-red-300">
            <FileText className="h-16 w-16 mx-auto mb-4 text-red-300" />
            <p className="text-lg font-medium text-red-700 mb-2">Error loading ledger entries</p>
            <p className="text-sm text-red-600">{error?.message || 'Unknown error'}</p>
            <p className="text-xs text-red-500 mt-2">Check console for details</p>
          </div>
        ) : isLoading ? (
          <div className="mt-6">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : hasDataToShow ? (
          <>
            {/* Desktop Table View - Grouped by Customer */}
            <div className="mt-6 hidden md:block">
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <div className="inline-block min-w-full align-middle">
                  <div className="overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                            Customer
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                            Entries
                          </th>
                          {!showCreditInvoicesOnly && (
                            <>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                                Date
                              </th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                                Group
                              </th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                                Type
                              </th>
                            </>
                          )}
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                            Description
                          </th>
                          {!showCreditInvoicesOnly && (
                            <>
                              <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                                Amount
                              </th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                                Invoice
                              </th>
                              {isAdmin && (
                                <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                                  Actions
                                </th>
                              )}
                            </>
                          )}
                          <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                            Net Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {Object.values(groupedByCustomer).map((group: any) => {
                          const canNavigate = group.customer.id !== null;
                          return (
                            <tr
                              key={`customer-${group.customer.id || 'anonymous'}`}
                              className="bg-blue-50 hover:bg-blue-100 transition-colors"
                            >
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4" />
                                  <Users className="h-4 w-4 text-blue-600" />
                                  {canNavigate ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(`/ledger/${group.customer.id}`)}
                                      className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors text-left"
                                    >
                                      {group.customer.name}
                                    </button>
                                  ) : (
                                    <span className="text-sm font-semibold text-gray-700">{group.customer.name}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-600">
                                  {(group.entryCount ?? group.entries.length)} {(group.entryCount ?? group.entries.length) === 1 ? 'entry' : 'entries'}
                                </span>
                              </td>
                              {!showCreditInvoicesOnly && (
                                <>
                                  <td className="px-6 py-4" />
                                  <td className="px-6 py-4" />
                                  <td className="px-6 py-4" />
                                </>
                              )}
                              <td className="px-6 py-4">
                                <div className="text-sm text-gray-700 max-w-xs truncate" title={group.latestDescription || '-'}>
                                  {group.latestDescription || <span className="text-gray-400 italic">—</span>}
                                </div>
                              </td>
                              {!showCreditInvoicesOnly && (
                                <>
                                  <td className="px-6 py-4" />
                                  <td className="px-6 py-4" />
                                  {isAdmin && <td className="px-6 py-4" />}
                                </>
                              )}
                              <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${group.netAmount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                <span className={`inline-flex items-center px-3 py-1.5 rounded ${group.netAmount >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                  {group.netAmount >= 0 ? '+' : ''}₹{formatAmountINR(group.netAmount)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                        <tr>
                          <td colSpan={2} className="px-6 py-4 text-right text-sm font-bold text-gray-700">
                            Totals:
                          </td>
                          <td colSpan={showCreditInvoicesOnly ? 1 : 6} className="px-6 py-4" />
                          {!showCreditInvoicesOnly && isAdmin && <td className="px-6 py-4" />}
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="space-y-1">
                              <div className="text-sm"><span className="text-gray-600">Credit: </span><span className="font-bold text-green-700">+₹{formatAmountINR(totalCredit)}</span></div>
                              <div className="text-sm"><span className="text-gray-600">Debit: </span><span className="font-bold text-red-700">-₹{formatAmountINR(totalDebit)}</span></div>
                              <div className="text-sm pt-1 border-t border-gray-300">
                                <span className="text-gray-700">Net: </span>
                                <span className={`font-bold ${(totalCredit - totalDebit) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                  {(totalCredit - totalDebit) >= 0 ? '+' : ''}₹{formatAmountINR(totalCredit - totalDebit)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-lg">
                <div>
                  Showing <strong className="text-gray-900">{Object.keys(groupedByCustomer).length}</strong> customers with <strong className="text-gray-900">{totalEntryCount}</strong> entries
                  {hasActiveFilters && (
                    <span className="ml-2 text-xs text-blue-600">(filtered)</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-gray-500">Total Credit: </span>
                    <span className="font-semibold text-green-700">₹{formatAmountINR(totalCredit)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total Debit: </span>
                    <span className="font-semibold text-red-700">₹{formatAmountINR(totalDebit)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Card View - Grouped by Customer */}
            <div className="mt-6 md:hidden space-y-3">
              {Object.values(groupedByCustomer).map((group: any) => {
                const canNavigate = group.customer.id !== null;
                return (
                  <div key={`customer-${group.customer.id || 'anonymous'}`}>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1">
                          <div className="w-5 h-5" />
                          <Users className="h-5 w-5 text-blue-600" />
                          <div className="flex-1">
                            {canNavigate ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/ledger/${group.customer.id}`)}
                                className="text-base font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors text-left"
                              >
                                {group.customer.name}
                              </button>
                            ) : (
                              <span className="text-base font-semibold text-gray-700">{group.customer.name}</span>
                            )}
                            <p className="text-xs text-gray-600 mt-0.5">
                              {(group.entryCount ?? group.entries.length)} {(group.entryCount ?? group.entries.length) === 1 ? 'entry' : 'entries'}
                            </p>
                            {group.latestDescription ? (
                              <p className="text-xs text-gray-600 mt-1 truncate max-w-[200px]" title={group.latestDescription}>
                                {group.latestDescription}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className={`text-lg font-bold ${group.netAmount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          <span className={`inline-flex items-center px-3 py-1.5 rounded ${group.netAmount >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                            {group.netAmount >= 0 ? '+' : ''}₹{formatAmountINR(group.netAmount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mt-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Total Credit:</span>
                    <span className="font-semibold text-green-700">₹{formatAmountINR(totalCredit)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Total Debit:</span>
                    <span className="font-semibold text-red-700">₹{formatAmountINR(totalDebit)}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-300 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Net:</span>
                    <span className={`text-sm font-bold ${(totalCredit - totalDebit) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {(totalCredit - totalDebit) >= 0 ? '+' : ''}₹{formatAmountINR(totalCredit - totalDebit)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-300 text-xs text-gray-500 text-center">
                  Showing <strong className="text-gray-900">{Object.keys(groupedByCustomer).length}</strong> customers with <strong className="text-gray-900">{totalEntryCount}</strong> entries
                  {hasActiveFilters && <span className="ml-1 text-blue-600">(filtered)</span>}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium text-gray-700 mb-2">No ledger entries found</p>
            {hasActiveFilters ? (
              <p className="text-sm text-gray-500">Try adjusting your filters or date range</p>
            ) : (
              <p className="text-sm text-gray-500">Start by creating a credit or debit entry</p>
            )}
          </div>
        )}
      </div>

      {/* Edit Entry Modal (Admin only) */}
      <Modal
        isOpen={!!editingEntry}
        onClose={() => {
          setEditingEntry(null);
          setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' });
        }}
        title="Edit Ledger Entry"
      >
        {editingEntry && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editEntryData.amount || parseFloat(editEntryData.amount) <= 0) {
                toast('Please enter a valid amount', 'error');
                return;
              }
              updateEntryMutation.mutate({
                id: editingEntry.id,
                data: {
                  entry_type: editEntryData.entryType,
                  amount: parseFloat(editEntryData.amount),
                  description: (editEntryData.description || '').trim(),
                  created_at: editEntryData.date ? dateStringWithCurrentTimeISO(editEntryData.date) : undefined,
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
              <DatePicker
                value={editEntryData.date}
                onChange={(date) => setEditEntryData({ ...editEntryData, date })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Entry Type</label>
              <Select
                value={editEntryData.entryType}
                onChange={(e) => setEditEntryData({ ...editEntryData, entryType: e.target.value as 'credit' | 'debit' })}
              >
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
              <Input
                type="number"
                step="0.01"
                value={editEntryData.amount}
                onChange={(e) => setEditEntryData({ ...editEntryData, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                value={editEntryData.description}
                onChange={(e) => setEditEntryData({ ...editEntryData, description: e.target.value })}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingEntry(null);
                  setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' });
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateEntryMutation.isPending}>
                {updateEntryMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Entry Confirmation (Admin only) */}
      <Modal
        isOpen={deletingEntryId !== null}
        onClose={() => setDeletingEntryId(null)}
        title="Remove ledger entry?"
      >
        <p className="text-gray-600 mb-4">This will remove the entry and adjust the customer balance. This cannot be undone.</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDeletingEntryId(null)}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={deleteEntryMutation.isPending}
            onClick={() => deletingEntryId !== null && deleteEntryMutation.mutate(deletingEntryId)}
          >
            {deleteEntryMutation.isPending ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      </Modal>

      {/* Entry Form Modal */}
      <Modal
        isOpen={showEntryForm}
        onClose={() => {
          setShowEntryForm(false);
          setSelectedCustomer(null);
          setEntryData({ amount: '', description: '', date: toLocalDateString(new Date()) });
        }}
        title={entryType === 'credit' ? 'Add Credit Entry' : 'Add Debit Entry'}
      >
        <form onSubmit={handleSubmitEntry} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer
            </label>
            <div className="relative">
              <Input
                placeholder="Search customer by name or phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full"
              />
              {customerSearch && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {customers.length > 0 ? (
                    <>
                      {customers.map((customer: any) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setCustomerSearch('');
                          }}
                          className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b last:border-b-0"
                        >
                          <div className="font-medium">{customer.name}</div>
                          {customer.phone && (
                            <div className="text-sm text-gray-500">{customer.phone}</div>
                          )}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setNewCustomerData({
                            name: customerSearch.trim(),
                            phone: '',
                            email: '',
                            address: ''
                          });
                          setShowCreateCustomerModal(true);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-green-50 border-t border-gray-200 bg-green-50/50 flex items-center gap-2"
                      >
                        <UserPlus className="h-4 w-4 text-green-600" />
                        <div>
                          <div className="font-medium text-green-700">Add "{customerSearch.trim()}"</div>
                          <div className="text-xs text-green-600">Create new customer</div>
                        </div>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNewCustomerData({
                          name: customerSearch.trim(),
                          phone: '',
                          email: '',
                          address: ''
                        });
                        setShowCreateCustomerModal(true);
                        setCustomerSearch('');
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-green-50 border-b border-gray-200 bg-green-50/50 flex items-center gap-2"
                    >
                      <UserPlus className="h-4 w-4 text-green-600" />
                      <div>
                        <div className="font-medium text-green-700">Add "{customerSearch.trim()}"</div>
                        <div className="text-xs text-green-600">Create new customer</div>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <div className="mt-2 p-2 bg-blue-50 rounded">
                <span className="text-sm font-medium">{selectedCustomer.name}</span>
                {selectedCustomer.phone && (
                  <span className="text-sm text-gray-600 ml-2">({selectedCustomer.phone})</span>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs text-red-600 ml-2"
                >
                  Remove
                </button>
              </div>
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
                setSelectedCustomer(null);
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

      {/* Create Customer Modal */}
      <Modal
        isOpen={showCreateCustomerModal}
        onClose={() => {
          setShowCreateCustomerModal(false);
          setNewCustomerData({ name: '', phone: '', email: '', address: '' });
        }}
        title="Create New Customer"
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCustomerData.name.trim()) {
              toast('Customer Name is required', 'error');
              return;
            }
            createCustomerMutation.mutate({
              name: newCustomerData.name.trim(),
              phone: newCustomerData.phone.trim() || undefined,
              email: newCustomerData.email.trim() || undefined,
              address: newCustomerData.address.trim() || undefined,
              is_active: true,
            });
          }}
          className="space-y-4"
        >
          <Input
            label="Customer Name *"
            value={newCustomerData.name}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
            required
            placeholder="Enter customer name"
            autoFocus
          />
          <Input
            label="Phone"
            type="tel"
            value={newCustomerData.phone}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, phone: e.target.value })}
            placeholder="Optional"
          />
          <Input
            label="Email"
            type="email"
            value={newCustomerData.email}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })}
            placeholder="Optional"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea
              className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              value={newCustomerData.address}
              onChange={(e) => setNewCustomerData({ ...newCustomerData, address: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowCreateCustomerModal(false);
                setNewCustomerData({ name: '', phone: '', email: '', address: '' });
              }}
              disabled={createCustomerMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createCustomerMutation.isPending || !newCustomerData.name.trim()}
            >
              {createCustomerMutation.isPending ? 'Creating...' : 'Create Customer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
