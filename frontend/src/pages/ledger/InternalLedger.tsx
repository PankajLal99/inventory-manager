import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { customersApi } from '../../lib/api';
import { toast } from '../../lib/toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import { 
  Plus, Minus, FileText, Users, TrendingUp, TrendingDown, 
  FileSpreadsheet, FileText as FileTextIcon, Printer,
  Filter, X, Calendar, Search,
  Clock, UserPlus, ChevronDown, ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format, startOfMonth, endOfMonth } from 'date-fns';

export default function InternalLedger() {
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit');
  const [entryData, setEntryData] = useState({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
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
  
  // Filters
  const [filters, setFilters] = useState({
    dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    dateTo: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    entryType: '',
    customer: '',
    search: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortConfig, _setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [expandedCustomers, setExpandedCustomers] = useState<Set<number>>(new Set());
  
  const navigate = useNavigate();
  const queryClient = useQueryClient();


  // Fetch internal customers for internal ledger (separate from regular customers)
  const { data: customersResponse } = useQuery({
    queryKey: ['internal-customers', customerSearch],
    queryFn: async () => {
      const response = await customersApi.internalCustomers.list({ search: customerSearch });
      return response.data;
    },
    enabled: customerSearch.trim().length > 0,
    retry: false,
  });


  const { data: allCustomers } = useQuery({
    queryKey: ['internal-customers-all'],
    queryFn: async () => {
      const response = await customersApi.internalCustomers.list();
      return response.data;
    },
    retry: false,
  });

  // Fetch internal customers for customer list modal
  const { data: customerListResponse } = useQuery({
    queryKey: ['internal-customers-list', customerListSearch],
    queryFn: async () => {
      const response = await customersApi.internalCustomers.list({ search: customerListSearch });
      return response.data;
    },
    enabled: showCustomerListModal,
    retry: false,
  });


  const { data: ledgerSummary } = useQuery({
    queryKey: ['internal-ledger-summary'],
    queryFn: async () => {
      const response = await customersApi.internalLedger.summary({});
      return response.data;
    },
    retry: false,
  });

  const { data: ledgerEntries, isLoading } = useQuery({
    queryKey: ['internal-ledger-entries', filters],
    queryFn: async () => {
      const params: any = {};
      if (filters.dateFrom) params.date_from = filters.dateFrom;
      if (filters.dateTo) params.date_to = filters.dateTo;
      if (filters.entryType) params.entry_type = filters.entryType;
      if (filters.customer) params.customer = filters.customer;
      if (filters.search) params.search = filters.search;
      
      const response = await customersApi.internalLedger.entries.list(params);
      return response.data;
    },
    retry: false,
  });

  const createEntryMutation = useMutation({
    mutationFn: (data: any) => customersApi.internalLedger.entries.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-ledger-summary'] });
      queryClient.invalidateQueries({ queryKey: ['internal-ledger-entries'] });
      setShowEntryForm(false);
      setSelectedCustomer(null);
      setEntryData({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
      toast('Shop boys ledger entry created successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to create shop boys ledger entry', 'error');
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: (data: any) => customersApi.internalCustomers.create(data),
    onSuccess: (response) => {
      const newCustomer = response.data;
      setSelectedCustomer({ ...newCustomer, type: 'customer' });
      setCustomerSearch('');
      setNewCustomerData({ name: '', phone: '', email: '', address: '' });
      setShowCreateCustomerModal(false);
      queryClient.invalidateQueries({ queryKey: ['internal-customers'] });
      queryClient.invalidateQueries({ queryKey: ['internal-customers-all'] });
      queryClient.invalidateQueries({ queryKey: ['internal-customers-list'] });
      toast('Internal customer created successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || error?.response?.data?.message || 'Failed to create internal customer', 'error');
    },
  });


  const handleCreateEntry = (type: 'credit' | 'debit') => {
    setEntryType(type);
    setShowEntryForm(true);
  };

  const handleSubmitEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      toast('Please select a shop boy', 'error');
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
      created_at: entryData.date ? new Date(entryData.date).toISOString() : undefined,
    });
  };

  const customers = (() => {
    if (!customersResponse) return [];
    if (Array.isArray(customersResponse.results)) return customersResponse.results;
    if (Array.isArray(customersResponse.data)) return customersResponse.data;
    if (Array.isArray(customersResponse)) return customersResponse;
    return [];
  })();

  // Search results - only shop boys
  const searchResults = useMemo(() => {
    return customers.map((c: any) => ({ ...c, type: 'customer' }));
  }, [customers]);

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
    }
    
    return sorted;
  }, [entries, sortConfig]);

  // Helper function to check if datetime has meaningful time (not just midnight)
  // When only a date is provided, it becomes midnight UTC, which shows as 5:30 AM in IST
  // So we check if the UTC time is exactly 00:00:00 (meaning it was likely just a date)
  const hasMeaningfulTime = (dateString: string): boolean => {
    if (!dateString) return false;
    try {
      const date = new Date(dateString);
      // Check UTC time - if it's exactly midnight UTC, it was likely just a date
      const hours = date.getUTCHours();
      const minutes = date.getUTCMinutes();
      const seconds = date.getUTCSeconds();
      const milliseconds = date.getUTCMilliseconds();
      // Consider time meaningful if it's not exactly midnight UTC (00:00:00.000)
      return !(hours === 0 && minutes === 0 && seconds === 0 && milliseconds === 0);
    } catch {
      return false;
    }
  };

  // Helper function to format date with optional time
  const formatDateTime = (dateString: string) => {
    if (!dateString) return { date: '', time: '' };
    try {
      const date = new Date(dateString);
      const dateStr = date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      
      if (hasMeaningfulTime(dateString)) {
        const timeStr = date.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        return { date: dateStr, time: timeStr };
      }
      
      return { date: dateStr, time: '' };
    } catch {
      return { date: '', time: '' };
    }
  };

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
    const grouped: { [key: string]: { customer: any; entries: any[]; totalCredit: number; totalDebit: number; netAmount: number } } = {};
    
    filteredEntries.forEach((entry: any) => {
      // Use customer ID or 'anonymous' for null/undefined customers
      const customerId = entry.customer ? `customer-${entry.customer}` : 'anonymous';
      const customerName = entry.customer_name || 'Anonymous';
      
      if (!grouped[customerId]) {
        grouped[customerId] = {
          customer: {
            id: entry.customer || null,
            name: customerName,
          },
          entries: [],
          totalCredit: 0,
          totalDebit: 0,
          netAmount: 0,
        };
      }
      
      grouped[customerId].entries.push(entry);
      if (entry.entry_type === 'credit') {
        grouped[customerId].totalCredit += parseFloat(entry.amount || 0);
      } else {
        grouped[customerId].totalDebit += parseFloat(entry.amount || 0);
      }
    });
    
    // Calculate net amount for each customer
    Object.keys(grouped).forEach(key => {
      grouped[key].netAmount = grouped[key].totalCredit - grouped[key].totalDebit;
    });
    
    return grouped;
  }, [filteredEntries]);

  const toggleCustomerExpansion = (customerId: number | null) => {
    if (customerId === null) return; // Don't expand anonymous entries
    setExpandedCustomers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(customerId)) {
        newSet.delete(customerId);
      } else {
        newSet.add(customerId);
      }
      return newSet;
    });
  };

  const handleExportExcel = () => {
    const data = filteredEntries.map((entry: any) => ({
      'Date': new Date(entry.created_at).toLocaleDateString(),
      'Customer': entry.customer_name || 'Anonymous',
      'Type': entry.entry_type.toUpperCase(),
      'Description': entry.description || '-',
      'Amount': parseFloat(entry.amount || 0).toFixed(2),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger Entries');
    
    const fileName = `internal_ledger_entries_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    // Add title
    doc.setFontSize(18);
    doc.text('Internal Ledger Entries Report', 14, 20);
    
    // Add date range if filtered
    doc.setFontSize(10);
    doc.text(
      `Date Range: ${filters.dateFrom} to ${filters.dateTo}`,
      14,
      30
    );
    
    // Prepare table data
    const tableData = filteredEntries.map((entry: any) => [
      new Date(entry.created_at).toLocaleDateString(),
      entry.customer_name || 'Anonymous',
      entry.entry_type.toUpperCase(),
      entry.description || '-',
      `₹${parseFloat(entry.amount || 0).toFixed(2)}`,
    ]);

    (doc as any).autoTable({
      head: [['Date', 'Customer', 'Type', 'Description', 'Amount']],
      body: tableData,
      startY: 35,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    const fileName = `internal_ledger_entries_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Internal Ledger Entries Report</title>
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
          <h1>Internal Ledger Entries Report</h1>
          <div class="info">
            <p><strong>Date Range:</strong> ${filters.dateFrom} to ${filters.dateTo}</p>
            <p><strong>Total Entries:</strong> ${filteredEntries.length}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${filteredEntries.map((entry: any) => `
                <tr>
                  <td>${new Date(entry.created_at).toLocaleDateString()}</td>
                  <td>${entry.customer_name || 'Anonymous'}</td>
                  <td>${entry.entry_type.toUpperCase()}</td>
                  <td>${entry.description || '-'}</td>
                  <td class="${entry.entry_type === 'credit' ? 'credit' : 'debit'}">
                    ${entry.entry_type === 'credit' ? '+' : '-'}₹${parseFloat(entry.amount || 0).toFixed(2)}
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
      dateFrom: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
      dateTo: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
      entryType: '',
      customer: '',
      search: '',
    });
  };

  const hasActiveFilters = filters.entryType || filters.customer || filters.search;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 w-full sm:w-auto">
          <h1 className="text-3xl font-bold text-gray-900">Shop Boys Ledger</h1>
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
                ₹{parseFloat(ledgerSummary?.total_credit || '0').toFixed(2)}
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
                ₹{parseFloat(ledgerSummary?.total_debit || '0').toFixed(2)}
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
          <h2 className="text-xl font-semibold">Shop Boys Ledger Entries</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
            >
              <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span className="hidden sm:inline">Filters</span>
              {hasActiveFilters && (
                <span className="bg-blue-600 text-white rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center text-xs flex-shrink-0">
                  {[filters.entryType, filters.customer, filters.search].filter(Boolean).length}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date From
                </label>
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Date To
                </label>
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Search className="h-4 w-4 inline mr-1" />
                  Search
                </label>
                <Input
                  placeholder="Search by name, phone, description..."
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
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Shop Boy
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Entries
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Net Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {Object.values(groupedByCustomer).map((group: any) => {
                        const isExpanded = group.customer.id !== null && expandedCustomers.has(group.customer.id);
                        const canExpand = group.customer.id !== null;
                        return (
                          <>
                            {/* Customer Group Row */}
                            <tr 
                              key={`customer-${group.customer.id || 'anonymous'}`}
                              className="bg-blue-50 hover:bg-blue-100 transition-colors"
                              style={{ cursor: canExpand ? 'pointer' : 'default' }}
                              onClick={() => canExpand && toggleCustomerExpansion(group.customer.id)}
                            >
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  {canExpand ? (
                                    isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-gray-600" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-gray-600" />
                                    )
                                  ) : (
                                    <div className="w-4 h-4" />
                                  )}
                                  <Users className="h-4 w-4 text-blue-600" />
                                  {canExpand ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/internal-ledger/${group.customer.id}`);
                                      }}
                                      className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                                    >
                                      {group.customer.name}
                                    </button>
                                  ) : (
                                    <span className="text-sm font-semibold text-gray-700">
                                      {group.customer.name}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="text-sm text-gray-600">
                                  {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                                </span>
                              </td>
                              <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${
                                group.netAmount >= 0 ? 'text-green-700' : 'text-red-700'
                              }`}>
                                <span className={`inline-flex items-center px-3 py-1.5 rounded ${
                                  group.netAmount >= 0 
                                    ? 'bg-green-50 border border-green-200' 
                                    : 'bg-red-50 border border-red-200'
                                }`}>
                                  {group.netAmount >= 0 ? '+' : ''}₹{group.netAmount.toFixed(2)}
                                </span>
                              </td>
                            </tr>
                            {/* Expanded Entries */}
                            {isExpanded && group.entries.map((entry: any) => (
                              <tr 
                                key={entry.id} 
                                className="bg-gray-50/30 hover:bg-gray-100 transition-colors"
                              >
                                <td className="px-6 py-3 whitespace-nowrap pl-12">
                                  <div className="flex flex-col">
                                    {(() => {
                                      const { date, time } = formatDateTime(entry.created_at);
                                      return (
                                        <>
                                          <span className="text-sm font-medium text-gray-900">
                                            {date}
                                          </span>
                                          {time && (
                                            <span className="text-xs text-gray-500">
                                              {time}
                                            </span>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </td>
                                <td className="px-6 py-3 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold shadow-sm ${
                                      entry.entry_type === 'credit'
                                        ? 'bg-green-100 text-green-800 border border-green-200'
                                        : 'bg-red-100 text-red-800 border border-red-200'
                                    }`}>
                                      {entry.entry_type === 'credit' ? (
                                        <TrendingUp className="h-3 w-3 mr-1" />
                                      ) : (
                                        <TrendingDown className="h-3 w-3 mr-1" />
                                      )}
                                      {entry.entry_type.toUpperCase()}
                                    </span>
                                    <span className="text-sm text-gray-700 max-w-xs truncate" title={entry.description || '-'}>
                                      {entry.description || <span className="text-gray-400 italic">No description</span>}
                                    </span>
                                  </div>
                                </td>
                                <td className={`px-6 py-3 whitespace-nowrap text-right text-sm font-bold ${
                                  entry.entry_type === 'credit' ? 'text-green-700' : 'text-red-700'
                                }`}>
                                  <span className={`inline-flex items-center px-2 py-1 rounded ${
                                    entry.entry_type === 'credit' 
                                      ? 'bg-green-50 border border-green-200' 
                                      : 'bg-red-50 border border-red-200'
                                  }`}>
                                    {entry.entry_type === 'credit' ? '+' : '-'}₹{parseFloat(entry.amount || 0).toFixed(2)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                      <tr>
                        <td colSpan={2} className="px-6 py-4 text-right text-sm font-bold text-gray-700">
                          Totals:
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="space-y-1">
                            <div className="text-sm">
                              <span className="text-gray-600">Credit: </span>
                              <span className="font-bold text-green-700">+₹{totalCredit.toFixed(2)}</span>
                            </div>
                            <div className="text-sm">
                              <span className="text-gray-600">Debit: </span>
                              <span className="font-bold text-red-700">-₹{totalDebit.toFixed(2)}</span>
                            </div>
                            <div className="text-sm pt-1 border-t border-gray-300">
                              <span className="text-gray-700">Net: </span>
                              <span className={`font-bold ${
                                (totalCredit - totalDebit) >= 0 ? 'text-green-700' : 'text-red-700'
                              }`}>
                                {(totalCredit - totalDebit) >= 0 ? '+' : ''}₹{(totalCredit - totalDebit).toFixed(2)}
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
                  Showing <strong className="text-gray-900">{Object.keys(groupedByCustomer).length}</strong> shop {Object.keys(groupedByCustomer).length === 1 ? 'boy' : 'boys'} with <strong className="text-gray-900">{filteredEntries.length}</strong> {filteredEntries.length === 1 ? 'entry' : 'entries'}
                  {hasActiveFilters && (
                    <span className="ml-2 text-xs text-blue-600">(filtered)</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-gray-500">Total Credit: </span>
                    <span className="font-semibold text-green-700">₹{totalCredit.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total Debit: </span>
                    <span className="font-semibold text-red-700">₹{totalDebit.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Card View - Grouped by Customer */}
            <div className="mt-6 md:hidden space-y-3">
              {Object.values(groupedByCustomer).map((group: any) => {
                const isExpanded = group.customer.id !== null && expandedCustomers.has(group.customer.id);
                const canExpand = group.customer.id !== null;
                return (
                  <div key={`customer-${group.customer.id || 'anonymous'}`} className="space-y-2">
                    {/* Customer Group Card */}
                    <div
                      className="bg-blue-50 border border-blue-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-4"
                      style={{ cursor: canExpand ? 'pointer' : 'default' }}
                      onClick={() => canExpand && toggleCustomerExpansion(group.customer.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1">
                          {canExpand ? (
                            isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-gray-600" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-600" />
                            )
                          ) : (
                            <div className="w-5 h-5" />
                          )}
                          <Users className="h-5 w-5 text-blue-600" />
                          <div className="flex-1">
                            {canExpand ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/internal-ledger/${group.customer.id}`);
                                }}
                                className="text-base font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                              >
                                {group.customer.name}
                              </button>
                            ) : (
                              <span className="text-base font-semibold text-gray-700">
                                {group.customer.name}
                              </span>
                            )}
                            <p className="text-xs text-gray-600 mt-0.5">
                              {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                            </p>
                          </div>
                        </div>
                        <div className={`text-lg font-bold ${
                          group.netAmount >= 0 ? 'text-green-700' : 'text-red-700'
                        }`}>
                          <span className={`inline-flex items-center px-3 py-1.5 rounded ${
                            group.netAmount >= 0 
                              ? 'bg-green-50 border border-green-200' 
                              : 'bg-red-50 border border-red-200'
                          }`}>
                            {group.netAmount >= 0 ? '+' : ''}₹{group.netAmount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Expanded Entries */}
                    {isExpanded && group.entries.map((entry: any) => (
                      <div
                        key={entry.id}
                        className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 ml-6"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Clock className="h-4 w-4 text-gray-400" />
                              {(() => {
                                const { date, time } = formatDateTime(entry.created_at);
                                return (
                                  <>
                                    <span className="text-sm font-medium text-gray-900">
                                      {date}
                                    </span>
                                    {time && (
                                      <span className="text-xs text-gray-500">
                                        {time}
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold shadow-sm ${
                            entry.entry_type === 'credit'
                              ? 'bg-green-100 text-green-800 border border-green-200'
                              : 'bg-red-100 text-red-800 border border-red-200'
                          }`}>
                            {entry.entry_type === 'credit' ? (
                              <TrendingUp className="h-3 w-3 mr-1" />
                            ) : (
                              <TrendingDown className="h-3 w-3 mr-1" />
                            )}
                            {entry.entry_type.toUpperCase()}
                          </span>
                        </div>
                        {entry.description && (
                          <div className="mb-2">
                            <p className="text-sm text-gray-700 break-words">
                              {entry.description}
                            </p>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                          <div className={`text-base font-bold ${
                            entry.entry_type === 'credit' ? 'text-green-700' : 'text-red-700'
                          }`}>
                            <span className={`inline-flex items-center px-2.5 py-1 rounded ${
                              entry.entry_type === 'credit' 
                                ? 'bg-green-50 border border-green-200' 
                                : 'bg-red-50 border border-red-200'
                            }`}>
                              {entry.entry_type === 'credit' ? '+' : '-'}₹{parseFloat(entry.amount || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Mobile Summary */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mt-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Total Credit:</span>
                    <span className="font-semibold text-green-700">₹{totalCredit.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Total Debit:</span>
                    <span className="font-semibold text-red-700">₹{totalDebit.toFixed(2)}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-300 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Net:</span>
                    <span className={`text-sm font-bold ${
                      (totalCredit - totalDebit) >= 0 ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {(totalCredit - totalDebit) >= 0 ? '+' : ''}₹{(totalCredit - totalDebit).toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-300 text-xs text-gray-500 text-center">
                  Showing <strong className="text-gray-900">{Object.keys(groupedByCustomer).length}</strong> shop {Object.keys(groupedByCustomer).length === 1 ? 'boy' : 'boys'} with <strong className="text-gray-900">{filteredEntries.length}</strong> {filteredEntries.length === 1 ? 'entry' : 'entries'}
                  {hasActiveFilters && (
                    <span className="ml-1 text-blue-600">(filtered)</span>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium text-gray-700 mb-2">No shop boys ledger entries found</p>
            {hasActiveFilters ? (
              <p className="text-sm text-gray-500">Try adjusting your filters or date range</p>
            ) : (
              <p className="text-sm text-gray-500">Start by creating a credit or debit entry</p>
            )}
          </div>
        )}
      </div>

      {/* Entry Form Modal */}
      <Modal
        isOpen={showEntryForm}
        onClose={() => {
          setShowEntryForm(false);
          setSelectedCustomer(null);
          setEntryData({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
        }}
        title={entryType === 'credit' ? 'Add Credit Entry' : 'Add Debit Entry'}
      >
        <form onSubmit={handleSubmitEntry} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Shop Boy
            </label>
            <div className="relative">
              <Input
                placeholder="Search shop boy by name, phone..."
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
                            Shop Boys
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
                      
                      {/* Create New Shop Boy Option */}
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
                          <div className="text-xs text-green-600">Add new shop boy</div>
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
                        <div className="text-xs text-green-600">Add new shop boy</div>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <div className="mt-2 p-2 bg-blue-50 rounded flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  <div>
                    <span className="text-sm font-medium">{selectedCustomer.name}</span>
                    {selectedCustomer.phone && (
                      <span className="text-sm text-gray-600 ml-2">({selectedCustomer.phone})</span>
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
            <Input
              type="date"
              value={entryData.date}
              onChange={(e) => setEntryData({ ...entryData, date: e.target.value })}
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
                setEntryData({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
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

      {/* Customer List Modal for Internal Ledger */}
      <Modal
        isOpen={showCustomerListModal}
        onClose={() => {
          setShowCustomerListModal(false);
          setCustomerListSearch('');
        }}
        title="Shop Boys"
        size="lg"
      >
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search shop boys by name, phone..."
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

              const allItems = customerList.map((c: any) => ({ ...c, type: 'customer' }));

              if (allItems.length === 0) {
                return (
                  <div className="p-8 text-center text-gray-500">
                    <Users className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>No shop boys found</p>
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
                          Shop Boys ({customerList.length})
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
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-4">
                              <div className="text-sm font-semibold text-gray-700">
                                ₹{parseFloat(customer.credit_balance || 0).toFixed(2)}
                              </div>
                              <div className="text-xs text-gray-500">Balance</div>
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
              Add Shop Boy
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Customer Modal for Internal Ledger */}
      <Modal
        isOpen={showCreateCustomerModal}
        onClose={() => {
          setShowCreateCustomerModal(false);
          setNewCustomerData({ name: '', phone: '', email: '', address: '' });
        }}
        title="Add Shop Boy"
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCustomerData.name.trim()) {
              toast('Name is required', 'error');
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
            label="Name *"
            value={newCustomerData.name}
            onChange={(e) => setNewCustomerData({ ...newCustomerData, name: e.target.value })}
            required
            placeholder="Enter name"
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
              {createCustomerMutation.isPending ? 'Adding...' : 'Add Shop Boy'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
