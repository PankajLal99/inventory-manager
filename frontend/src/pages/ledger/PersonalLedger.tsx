import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { customersApi, purchasingApi } from '../../lib/api';
import { toast } from '../../lib/toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import DatePicker from '../../components/ui/DatePicker';
import DateRangeSelector from '../../components/ui/DateRangeSelector';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import { 
  Plus, Minus, FileText, Users, TrendingUp, TrendingDown, 
  FileSpreadsheet, FileText as FileTextIcon, Printer,
  Filter, X, Calendar, Search,
  UserPlus, Building2, Lock
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { DateRangePreset, formatAmountINR, formatAppDate, toLocalDateString, dateStringWithCurrentTimeISO } from '../../lib/utils';

const PIN_LENGTH = 6;
const PERSONAL_LEDGER_PIN = '980980';

export default function PersonalLedger() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [unlocked, setUnlocked] = useState(false);
  const [pinDigits, setPinDigits] = useState<string[]>(() => Array(PIN_LENGTH).fill(''));
  const [pinError, setPinError] = useState('');
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit');
  const [entryData, setEntryData] = useState({ amount: '', description: '', date: toLocalDateString(new Date()) });
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCreateCustomerModal, setShowCreateCustomerModal] = useState(false);
  const [showCustomerListModal, setShowCustomerListModal] = useState(false);
  const [customerListSearch, setCustomerListSearch] = useState('');
  const [newCustomerData, setNewCustomerData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
  });
  
  // Filters - default to no date filter so all entries are shown until user selects dates
  const [filters, setFilters] = useState({
    dateFrom: searchParams.get('date_from') ?? '',
    dateTo: searchParams.get('date_to') ?? '',
    entryType: searchParams.get('entry_type') ?? '',
    customer: searchParams.get('customer') ?? '',
    search: searchParams.get('search') ?? '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => {
    const preset = searchParams.get('preset');
    if (preset === 'one_day' || preset === 'last_7_days' || preset === 'last_30_days' || preset === 'custom') {
      return preset;
    }
    return 'custom';
  });
  const [sortConfig, _setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [editingEntry, setEditingEntry] = useState<any>(null);
  const [editEntryData, setEditEntryData] = useState({ amount: '', description: '', date: '', entryType: 'credit' as 'credit' | 'debit' });
  const [deletingEntryId, setDeletingEntryId] = useState<number | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const buildPersonalLedgerDetailPath = (customerId: number) => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.dateFrom) params.set('date_from', filters.dateFrom);
    if (filters.dateTo) params.set('date_to', filters.dateTo);
    if (filters.entryType) params.set('entry_type', filters.entryType);
    if (filters.customer) params.set('customer', filters.customer);
    if (datePreset !== 'custom') params.set('preset', datePreset);
    const query = params.toString();
    return query ? `/personal-ledger/${customerId}?${query}` : `/personal-ledger/${customerId}`;
  };

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (filters.search.trim()) nextParams.set('search', filters.search.trim());
    if (filters.dateFrom) nextParams.set('date_from', filters.dateFrom);
    if (filters.dateTo) nextParams.set('date_to', filters.dateTo);
    if (filters.entryType) nextParams.set('entry_type', filters.entryType);
    if (filters.customer) nextParams.set('customer', filters.customer);
    if (datePreset !== 'custom') nextParams.set('preset', datePreset);
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters, datePreset, searchParams, setSearchParams]);

  useEffect(() => {
    if (!unlocked) {
      const t = setTimeout(() => pinInputRefs.current[0]?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [unlocked]);

  const clearPin = () => {
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setPinError('');
    pinInputRefs.current[0]?.focus();
  };

  const handlePinChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...pinDigits];
    next[index] = digit;
    setPinDigits(next);
    setPinError('');
    if (digit && index < PIN_LENGTH - 1) pinInputRefs.current[index + 1]?.focus();
    if (next.every(Boolean)) {
      const pin = next.join('');
      if (pin === PERSONAL_LEDGER_PIN) {
        setUnlocked(true);
      } else {
        setPinError('Wrong PIN');
        clearPin();
      }
    }
  };

  const handlePinKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      clearPin();
    }
  };

  // Fetch personal customers for personal ledger (separate from regular customers)
  const { data: customersResponse } = useQuery({
    queryKey: ['personal-customers', customerSearch],
    queryFn: async () => {
      const response = await customersApi.personalCustomers.list({ search: customerSearch });
      return response.data;
    },
    enabled: unlocked && customerSearch.trim().length > 0,
    retry: false,
  });

  // Fetch vendors/suppliers for personal ledger search
  const { data: suppliersResponse } = useQuery({
    queryKey: ['personal-ledger-suppliers', customerSearch],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list({ search: customerSearch });
      return response.data;
    },
    enabled: unlocked && customerSearch.trim().length > 0,
    retry: false,
  });

  const { data: allCustomers } = useQuery({
    queryKey: ['personal-customers-all'],
    queryFn: async () => {
      const response = await customersApi.personalCustomers.list();
      return response.data;
    },
    enabled: unlocked,
    retry: false,
  });

  // Fetch personal customers for customer list modal
  const { data: customerListResponse } = useQuery({
    queryKey: ['personal-customers-list', customerListSearch],
    queryFn: async () => {
      const response = await customersApi.personalCustomers.list({ search: customerListSearch });
      return response.data;
    },
    enabled: unlocked && showCustomerListModal,
    retry: false,
  });

  // Fetch suppliers for customer list modal
  const { data: supplierListResponse } = useQuery({
    queryKey: ['personal-ledger-supplier-list', customerListSearch],
    queryFn: async () => {
      const response = await purchasingApi.suppliers.list({ search: customerListSearch });
      return response.data;
    },
    enabled: unlocked && showCustomerListModal,
    retry: false,
  });

  const { data: ledgerSummary } = useQuery({
    queryKey: ['personal-ledger-summary'],
    queryFn: async () => {
      const response = await customersApi.personalLedger.summary({});
      return response.data;
    },
    enabled: unlocked,
    retry: false,
  });

  const { data: ledgerEntries, isLoading } = useQuery({
    queryKey: ['personal-ledger-entries', filters],
    queryFn: async () => {
      const params: any = {};
      if (filters.dateFrom) params.date_from = filters.dateFrom;
      if (filters.dateTo) params.date_to = filters.dateTo;
      if (filters.entryType) params.entry_type = filters.entryType;
      if (filters.customer) params.customer = filters.customer;
      if (filters.search) params.search = filters.search;
      
      const response = await customersApi.personalLedger.entries.list(params);
      return response.data;
    },
    enabled: unlocked,
    retry: false,
  });

  const createEntryMutation = useMutation({
    mutationFn: (data: any) => customersApi.personalLedger.entries.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-entries'] });
      setShowEntryForm(false);
      setSelectedCustomer(null);
      setEntryData({ amount: '', description: '', date: toLocalDateString(new Date()) });
      toast('Personal ledger entry created successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to create personal ledger entry', 'error');
    },
  });

  const updateEntryMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => customersApi.personalLedger.entries.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-entries'] });
      setEditingEntry(null);
      setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' });
      toast('Entry updated successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to update entry', 'error');
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id: number) => customersApi.personalLedger.entries.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-entries'] });
      setDeletingEntryId(null);
      toast('Entry removed successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to remove entry', 'error');
      setDeletingEntryId(null);
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: (data: any) => customersApi.personalCustomers.create(data),
    onSuccess: (response) => {
      const newCustomer = response.data;
      setSelectedCustomer({ ...newCustomer, type: 'customer' });
      setCustomerSearch('');
      setNewCustomerData({ name: '', phone: '', email: '', address: '' });
      setShowCreateCustomerModal(false);
      queryClient.invalidateQueries({ queryKey: ['personal-customers'] });
      queryClient.invalidateQueries({ queryKey: ['personal-customers-all'] });
      queryClient.invalidateQueries({ queryKey: ['personal-customers-list'] });
      toast('Personal customer created successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || error?.response?.data?.message || 'Failed to create personal customer', 'error');
    },
  });

  // Handle supplier selection - create or find corresponding personal customer
  const handleSupplierSelect = async (supplier: any) => {
    try {
      // Check if a personal customer with the same name already exists
      const existingCustomers = await customersApi.personalCustomers.list({ search: supplier.name });
      const customerList = (() => {
        const data = existingCustomers.data;
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.results)) return data.results;
        if (Array.isArray(data?.data)) return data.data;
        return [];
      })();
      
      const matchingCustomer = customerList.find((c: any) => 
        c.name.toLowerCase() === supplier.name.toLowerCase()
      );

      if (matchingCustomer) {
        // Use existing personal customer
        setSelectedCustomer({ ...matchingCustomer, type: 'customer' });
        setCustomerSearch('');
        toast(`Using existing personal customer: ${matchingCustomer.name}`, 'info');
      } else {
        // Create personal customer from supplier
        const customerData = {
          name: supplier.name,
          phone: supplier.phone || '',
          email: supplier.email || '',
          address: supplier.address || '',
          is_active: true,
        };
        
        const response = await customersApi.personalCustomers.create(customerData);
        const newCustomer = response.data;
        setSelectedCustomer({ ...newCustomer, type: 'customer', supplier_id: supplier.id });
        setCustomerSearch('');
        queryClient.invalidateQueries({ queryKey: ['personal-customers'] });
        queryClient.invalidateQueries({ queryKey: ['personal-customers-all'] });
        queryClient.invalidateQueries({ queryKey: ['personal-customers-list'] });
        toast(`Personal customer created from vendor: ${supplier.name}`, 'success');
      }
    } catch (error: any) {
      toast(error?.response?.data?.error || error?.response?.data?.message || 'Failed to process vendor selection', 'error');
    }
  };

  const handleCreateEntry = (type: 'credit' | 'debit') => {
    setEntryType(type);
    setShowEntryForm(true);
  };

  const handleSubmitEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      toast('Please select a customer or vendor', 'error');
      return;
    }
    if (!entryData.amount || parseFloat(entryData.amount) <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }
    
    // Ensure we have a customer ID (not supplier ID)
    if (selectedCustomer.type === 'supplier' || (selectedCustomer.supplier_id && !selectedCustomer.id)) {
      toast('Please wait, processing vendor selection...', 'info');
      // This shouldn't happen as handleSupplierSelect should have created a customer
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

  const suppliers = (() => {
    if (!suppliersResponse) return [];
    if (Array.isArray(suppliersResponse.results)) return suppliersResponse.results;
    if (Array.isArray(suppliersResponse.data)) return suppliersResponse.data;
    if (Array.isArray(suppliersResponse)) return suppliersResponse;
    return [];
  })();

  // Combine customers and suppliers for search results
  // Convert suppliers to customer-like format for display
  const searchResults = useMemo(() => {
    const customerList = customers.map((c: any) => ({ ...c, type: 'customer' }));
    const supplierList = suppliers.map((s: any) => ({
      id: s.id,
      name: s.name,
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      code: s.code || '',
      type: 'supplier',
      supplier_id: s.id, // Keep original supplier ID
    }));
    return [...customerList, ...supplierList];
  }, [customers, suppliers]);

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
    if (Array.isArray(ledgerEntries.results)) return ledgerEntries.results;
    if (Array.isArray(ledgerEntries.data)) return ledgerEntries.data;
    return [];
  })();

  const filteredEntries = useMemo(() => {
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
  }, [entries, sortConfig]);

  const totalCredit = useMemo(() => {
    return filteredEntries
      .filter((e: any) => e.entry_type === 'credit')
      .reduce((sum: number, e: any) => sum + parseFloat(e.amount || 0), 0);
  }, [filteredEntries]);

  const totalDebit = useMemo(() => {
    return filteredEntries
      .filter((e: any) => e.entry_type === 'debit')
      .reduce((sum: number, e: any) => sum + parseFloat(e.amount || 0), 0);
  }, [filteredEntries]);

  // Group entries by customer
  const groupedByCustomer = useMemo(() => {
    const grouped: { [key: string]: { customer: any; entries: any[]; totalCredit: number; totalDebit: number; netAmount: number; latestDescription: string } } = {};
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
  }, [filteredEntries]);

  const handleExportExcel = () => {
    const data = filteredEntries.map((entry: any) => ({
      'Date': formatAppDate(entry.created_at, { empty: '' }),
      'Customer': entry.customer_name || 'Anonymous',
      'Group': entry.customer_group_name || '-',
      'Type': entry.entry_type.toUpperCase(),
      'Description': entry.description || '-',
      'Amount': formatAmountINR(entry.amount || 0),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger Entries');
    
    const fileName = `personal_ledger_entries_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    // Add title
    doc.setFontSize(18);
    doc.text('Personal Ledger Entries Report', 14, 20);
    
    // Add date range if filtered
    doc.setFontSize(10);
    doc.text(
      `Date Range: ${filters.dateFrom} to ${filters.dateTo}`,
      14,
      30
    );
    
    // Prepare table data
    const tableData = filteredEntries.map((entry: any) => [
      formatAppDate(entry.created_at, { empty: '' }),
      entry.customer_name || 'Anonymous',
      entry.customer_group_name || '-',
      entry.entry_type.toUpperCase(),
      entry.description || '-',
      `₹${formatAmountINR(entry.amount || 0)}`,
    ]);

    (doc as any).autoTable({
      head: [['Date', 'Customer', 'Group', 'Type', 'Description', 'Amount']],
      body: tableData,
      startY: 35,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    const fileName = `personal_ledger_entries_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Personal Ledger Entries Report</title>
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
          <h1>Personal Ledger Entries Report</h1>
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
              </tr>
            </thead>
            <tbody>
              ${filteredEntries.map((entry: any) => `
                <tr>
                  <td>${formatAppDate(entry.created_at, { empty: '' })}</td>
                  <td>${entry.customer_name || 'Anonymous'}</td>
                  <td>${entry.customer_group_name || '-'}</td>
                  <td>${entry.entry_type.toUpperCase()}</td>
                  <td>${entry.description || '-'}</td>
                  <td class="${entry.entry_type === 'credit' ? 'credit' : 'debit'}">
                    ${entry.entry_type === 'credit' ? '+' : '-'}₹${formatAmountINR(entry.amount || 0)}
                  </td>
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
      search: '',
    });
    setDatePreset('custom');
  };

  const hasActiveFilters = filters.entryType || filters.customer || filters.search || filters.dateFrom || filters.dateTo;

  if (!unlocked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-6">
              <Lock className="h-7 w-7 text-gray-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Personal Ledger locked</h2>
            <p className="text-sm text-gray-500 mb-6">Enter 6-digit PIN</p>
            <div className="flex gap-2 justify-center mb-2">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    pinInputRefs.current[i] = el;
                  }}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  autoFocus={i === 0}
                  value={pinDigits[i]}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={handlePinKeyDown}
                  className="w-14 h-14 text-center text-lg font-semibold border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300"
                />
              ))}
            </div>
            {pinError ? <p className="text-sm text-red-600 font-medium mt-2">{pinError}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 w-full sm:w-auto">
          <h1 className="text-3xl font-bold text-gray-900">Personal Ledger</h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex gap-2">
          <Button
            onClick={() => setShowCustomerListModal(true)}
            variant="outline"
            className="border-blue-300 text-blue-600 hover:bg-blue-50"
          >
            <Users className="h-4 w-4 mr-2" />
            Customers
          </Button>
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
          <h2 className="text-xl font-semibold">Personal Ledger Entries</h2>
          <div className="flex flex-wrap items-center gap-2">
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
                  {[filters.entryType, filters.customer, filters.search, filters.dateFrom, filters.dateTo].filter(Boolean).length}
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
                <Select
                  label="Customer"
                  value={filters.customer}
                  onChange={(e) => setFilters({ ...filters, customer: e.target.value })}
                >
                  <option value="">All Customers</option>
                  {allCustomersList.map((customer: any) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} {customer.phone ? `(${customer.phone})` : ''}
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
        {isLoading ? (
          <div className="mt-6">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : filteredEntries && filteredEntries.length > 0 ? (
          <>
            {/* Desktop Table View - Grouped by Customer */}
            <div className="mt-6 hidden md:block">
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <div className="inline-block min-w-full align-middle">
                  <div className="overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Customer</th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Entries</th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Description</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Net Amount</th>
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
                                      onClick={() => navigate(buildPersonalLedgerDetailPath(group.customer.id))}
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
                                <span className="text-sm text-gray-600">{group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="text-sm text-gray-700 max-w-xs truncate" title={group.latestDescription || '-'}>
                                  {group.latestDescription || <span className="text-gray-400 italic">—</span>}
                                </div>
                              </td>
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
                          <td colSpan={2} className="px-6 py-4 text-right text-sm font-bold text-gray-700">Totals:</td>
                          <td className="px-6 py-4" />
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
                  Showing <strong className="text-gray-900">{Object.keys(groupedByCustomer).length}</strong> customers with <strong className="text-gray-900">{filteredEntries.length}</strong> entries
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
                                onClick={() => navigate(buildPersonalLedgerDetailPath(group.customer.id))}
                                className="text-base font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors text-left"
                              >
                                {group.customer.name}
                              </button>
                            ) : (
                              <span className="text-base font-semibold text-gray-700">{group.customer.name}</span>
                            )}
                            <p className="text-xs text-gray-600 mt-0.5">{group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}</p>
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
                  Showing <strong className="text-gray-900">{Object.keys(groupedByCustomer).length}</strong> customers with <strong className="text-gray-900">{filteredEntries.length}</strong> entries
                  {hasActiveFilters && <span className="ml-1 text-blue-600">(filtered)</span>}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium text-gray-700 mb-2">No personal ledger entries found</p>
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
        title="Edit Personal Ledger Entry"
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
              <DatePicker value={editEntryData.date} onChange={(date) => setEditEntryData({ ...editEntryData, date })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Entry Type</label>
              <Select value={editEntryData.entryType} onChange={(e) => setEditEntryData({ ...editEntryData, entryType: e.target.value as 'credit' | 'debit' })}>
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
              <Input type="number" step="0.01" value={editEntryData.amount} onChange={(e) => setEditEntryData({ ...editEntryData, amount: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={3} value={editEntryData.description} onChange={(e) => setEditEntryData({ ...editEntryData, description: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => { setEditingEntry(null); setEditEntryData({ amount: '', description: '', date: '', entryType: 'credit' }); }}>Cancel</Button>
              <Button type="submit" disabled={updateEntryMutation.isPending}>{updateEntryMutation.isPending ? 'Saving...' : 'Save'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Entry Confirmation (Admin only) */}
      <Modal isOpen={deletingEntryId !== null} onClose={() => setDeletingEntryId(null)} title="Remove entry?">
        <p className="text-gray-600 mb-4">This will remove the entry and adjust the balance. This cannot be undone.</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDeletingEntryId(null)}>Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700" disabled={deleteEntryMutation.isPending} onClick={() => deletingEntryId !== null && deleteEntryMutation.mutate(deletingEntryId)}>
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
              Customer or Vendor
            </label>
            <div className="relative">
              <Input
                placeholder="Search customer or vendor by name, phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full"
              />
              {customerSearch && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {searchResults.length > 0 ? (
                    <>
                      {/* Customers Section */}
                      {customers.length > 0 && (
                        <>
                          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                            Customers
                          </div>
                          {customers.map((customer: any) => (
                            <button
                              key={`customer-${customer.id}`}
                              type="button"
                              onClick={() => {
                                setSelectedCustomer({ ...customer, type: 'customer' });
                                setCustomerSearch('');
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b last:border-b-0 flex items-center gap-2"
                            >
                              <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">{customer.name}</div>
                                {customer.phone && (
                                  <div className="text-sm text-gray-500">{customer.phone}</div>
                                )}
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                      
                      {/* Vendors/Suppliers Section */}
                      {suppliers.length > 0 && (
                        <>
                          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                            Vendors
                          </div>
                          {suppliers.map((supplier: any) => (
                            <button
                              key={`supplier-${supplier.id}`}
                              type="button"
                              onClick={() => handleSupplierSelect(supplier)}
                              className="w-full text-left px-4 py-2 hover:bg-purple-50 border-b last:border-b-0 flex items-center gap-2"
                            >
                              <Building2 className="h-4 w-4 text-purple-600 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">{supplier.name}</div>
                                <div className="text-sm text-gray-500">
                                  {supplier.phone && `${supplier.phone}`}
                                  {supplier.code && ` • Code: ${supplier.code}`}
                                </div>
                              </div>
                            </button>
                          ))}
                        </>
                      )}
                      
                      {/* Create New Customer Option */}
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
              <div className="mt-2 p-2 bg-blue-50 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedCustomer.supplier_id ? (
                    <Building2 className="h-4 w-4 text-purple-600" />
                  ) : (
                    <Users className="h-4 w-4 text-blue-600" />
                  )}
                  <div>
                    <span className="text-sm font-medium">{selectedCustomer.name}</span>
                    {selectedCustomer.phone && (
                      <span className="text-sm text-gray-600 ml-2">({selectedCustomer.phone})</span>
                    )}
                    {selectedCustomer.supplier_id && (
                      <span className="text-xs text-purple-600 ml-2">(Vendor)</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs text-red-600 hover:text-red-800"
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

      {/* Customer List Modal for Personal Ledger */}
      <Modal
        isOpen={showCustomerListModal}
        onClose={() => {
          setShowCustomerListModal(false);
          setCustomerListSearch('');
        }}
        title="Customers & Vendors (Personal Ledger)"
        size="lg"
      >
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search customers or vendors by name, phone..."
              value={customerListSearch}
              onChange={(e) => setCustomerListSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Customer List */}
          <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
            {(() => {
              const customerList = (() => {
                if (!customerListResponse) return [];
                if (Array.isArray(customerListResponse.results)) return customerListResponse.results;
                if (Array.isArray(customerListResponse.data)) return customerListResponse.data;
                if (Array.isArray(customerListResponse)) return customerListResponse;
                return [];
              })();

              const supplierList = (() => {
                if (!supplierListResponse) return [];
                if (Array.isArray(supplierListResponse.results)) return supplierListResponse.results;
                if (Array.isArray(supplierListResponse.data)) return supplierListResponse.data;
                if (Array.isArray(supplierListResponse)) return supplierListResponse;
                return [];
              })();

              const allItems = [
                ...customerList.map((c: any) => ({ ...c, type: 'customer' })),
                ...supplierList.map((s: any) => ({
                  id: s.id,
                  name: s.name,
                  phone: s.phone || '',
                  email: s.email || '',
                  address: s.address || '',
                  code: s.code || '',
                  type: 'supplier',
                  supplier_id: s.id,
                })),
              ];

              if (allItems.length === 0) {
                return (
                  <div className="p-8 text-center text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>No customers or vendors found</p>
                    {customerListSearch && (
                      <p className="text-sm mt-1">Try a different search term</p>
                    )}
                  </div>
                );
              }

              return (
                <div className="divide-y divide-gray-200">
                  {/* Customers Section */}
                  {customerList.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                        <div className="text-xs font-semibold text-gray-600 uppercase flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Customers ({customerList.length})
                        </div>
                      </div>
                      {customerList.map((customer: any) => (
                        <div
                          key={`customer-${customer.id}`}
                          className="px-4 py-3 hover:bg-blue-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedCustomer({ ...customer, type: 'customer' });
                            setShowCustomerListModal(false);
                            setCustomerListSearch('');
                            // Open entry form if not already open
                            if (!showEntryForm) {
                              setEntryType('credit');
                              setShowEntryForm(true);
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <Users className="h-5 w-5 text-blue-600 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 truncate">{customer.name}</div>
                                <div className="text-sm text-gray-500 space-x-2">
                                  {customer.phone && <span>{customer.phone}</span>}
                                  {customer.email && <span>• {customer.email}</span>}
                                </div>
                                {customer.customer_group_name && (
                                  <div className="text-xs text-gray-400 mt-1">
                                    Group: {customer.customer_group_name}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-4">
                              <div className="text-sm font-semibold text-gray-700">
                                ₹{formatAmountINR(customer.credit_balance || 0)}
                              </div>
                              <div className="text-xs text-gray-500">Balance</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Vendors Section */}
                  {supplierList.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                        <div className="text-xs font-semibold text-gray-600 uppercase flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          Vendors ({supplierList.length})
                        </div>
                      </div>
                      {supplierList.map((supplier: any) => (
                        <div
                          key={`supplier-${supplier.id}`}
                          className="px-4 py-3 hover:bg-purple-50 cursor-pointer transition-colors"
                          onClick={async () => {
                            await handleSupplierSelect(supplier);
                            setShowCustomerListModal(false);
                            setCustomerListSearch('');
                            // Open entry form if not already open
                            if (!showEntryForm) {
                              setEntryType('credit');
                              setShowEntryForm(true);
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <Building2 className="h-5 w-5 text-purple-600 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 truncate">{supplier.name}</div>
                                <div className="text-sm text-gray-500 space-x-2">
                                  {supplier.phone && <span>{supplier.phone}</span>}
                                  {supplier.email && <span>• {supplier.email}</span>}
                                  {supplier.code && <span>• Code: {supplier.code}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-4">
                              <div className="text-xs text-purple-600 font-medium">Vendor</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Create New Customer Button */}
          <div className="flex justify-end pt-2 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setShowCustomerListModal(false);
                setNewCustomerData({
                  name: customerListSearch.trim() || '',
                  phone: '',
                  email: '',
                  address: '',
                });
                setShowCreateCustomerModal(true);
              }}
              className="flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Create New Customer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Customer Modal for Personal Ledger */}
      <Modal
        isOpen={showCreateCustomerModal}
        onClose={() => {
          setShowCreateCustomerModal(false);
          setNewCustomerData({ name: '', phone: '', email: '', address: '' });
        }}
        title="Create New Customer (Personal Ledger)"
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
