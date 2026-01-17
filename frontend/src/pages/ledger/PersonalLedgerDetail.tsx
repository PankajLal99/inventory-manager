import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { customersApi } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import { toast } from '../../lib/toast';
import { 
  ArrowLeft, FileText, FileSpreadsheet, FileText as FileTextIcon, 
  Printer, Filter, X, Calendar, Search, Plus, Minus
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

export default function PersonalLedgerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    entryType: '',
    search: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit');
  const [entryData, setEntryData] = useState({ 
    amount: '', 
    description: '', 
    date: new Date().toISOString().split('T')[0] 
  });
  const queryClient = useQueryClient();

  const { data: customerData } = useQuery({
    queryKey: ['personal-customer', customerId],
    queryFn: () => customersApi.personalCustomers.get(parseInt(customerId || '0')),
    enabled: !!customerId,
    retry: false,
  });


  const { data: ledgerDetail, isLoading } = useQuery({
    queryKey: ['personal-ledger-customer-detail', customerId],
    queryFn: () => {
      const params: any = {};
      return customersApi.personalLedger.customerDetail(parseInt(customerId || '0'), params);
    },
    enabled: !!customerId,
    retry: false,
  });

  const customer = customerData?.data;
  const allEntries = ledgerDetail?.data?.entries || [];
  const finalBalance = ledgerDetail?.data?.final_balance || '0.00';

  const createEntryMutation = useMutation({
    mutationFn: (data: any) => customersApi.personalLedger.entries.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['personal-customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['personal-ledger-summary'] });
      setShowEntryForm(false);
      setEntryData({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
      toast('Personal ledger entry created successfully', 'success');
    },
    onError: (error: any) => {
      toast(error?.response?.data?.error || 'Failed to create personal ledger entry', 'error');
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
    
    createEntryMutation.mutate({
      personal_customer: customer.id,
      entry_type: entryType,
      amount: parseFloat(entryData.amount),
      description: (entryData.description || '').trim(),
      created_at: entryData.date ? new Date(entryData.date).toISOString() : undefined,
    });
  };

  const filteredEntries = useMemo(() => {
    let entries = [...allEntries];
    
    if (filters.dateFrom) {
      entries = entries.filter(entry => 
        new Date(entry.created_at) >= new Date(filters.dateFrom)
      );
    }
    if (filters.dateTo) {
      entries = entries.filter(entry => 
        new Date(entry.created_at) <= new Date(filters.dateTo + 'T23:59:59')
      );
    }
    if (filters.entryType) {
      entries = entries.filter(entry => entry.entry_type === filters.entryType);
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      entries = entries.filter(entry =>
        entry.description?.toLowerCase().includes(searchLower)
      );
    }
    
    return entries;
  }, [allEntries, filters]);

  const handleExportExcel = () => {
    const data = filteredEntries.map((entry: any) => ({
      'Date': new Date(entry.created_at).toLocaleDateString(),
      'Type': entry.entry_type.toUpperCase(),
      'Description': entry.description || '-',
      'Debit': entry.entry_type === 'debit' ? parseFloat(entry.amount || 0).toFixed(2) : '-',
      'Credit': entry.entry_type === 'credit' ? parseFloat(entry.amount || 0).toFixed(2) : '-',
      'Balance': parseFloat(entry.running_balance || 0).toFixed(2),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger Statement');
    
    const fileName = `personal_ledger_${customer?.name || 'customer'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    // Add title
    doc.setFontSize(18);
    doc.text(`${customer?.name || 'Customer'} Personal Ledger Statement`, 14, 20);
    
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
      `Current Balance: ₹${parseFloat(finalBalance).toFixed(2)}`,
      14,
      50
    );
    
    // Prepare table data
    const tableData = filteredEntries.map((entry: any) => [
      new Date(entry.created_at).toLocaleDateString(),
      entry.entry_type.toUpperCase(),
      entry.description || '-',
      entry.entry_type === 'debit' ? `₹${parseFloat(entry.amount || 0).toFixed(2)}` : '-',
      entry.entry_type === 'credit' ? `₹${parseFloat(entry.amount || 0).toFixed(2)}` : '-',
      `₹${parseFloat(entry.running_balance || 0).toFixed(2)}`,
    ]);

    (doc as any).autoTable({
      head: [['Date', 'Type', 'Description', 'Debit', 'Credit', 'Balance']],
      body: tableData,
      startY: 55,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    const fileName = `personal_ledger_${customer?.name || 'customer'}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${customer?.name || 'Customer'} Personal Ledger Statement</title>
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
          <h1>${customer?.name || 'Customer'} Personal Ledger Statement</h1>
          <div class="info">
            ${customer?.phone ? `<p><strong>Phone:</strong> ${customer.phone}</p>` : ''}
            ${filters.dateFrom || filters.dateTo ? 
              `<p><strong>Date Range:</strong> ${filters.dateFrom || 'Start'} to ${filters.dateTo || 'End'}</p>` : ''}
            <p><strong>Total Entries:</strong> ${filteredEntries.length}</p>
          </div>
          <div class="balance ${parseFloat(finalBalance) >= 0 ? 'positive' : 'negative'}">
            Current Balance: ₹${parseFloat(finalBalance).toFixed(2)}
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
              </tr>
            </thead>
            <tbody>
              ${filteredEntries.map((entry: any) => `
                <tr>
                  <td>${new Date(entry.created_at).toLocaleDateString()}</td>
                  <td>${entry.entry_type.toUpperCase()}</td>
                  <td>${entry.description || '-'}</td>
                  <td class="debit">${entry.entry_type === 'debit' ? `₹${parseFloat(entry.amount || 0).toFixed(2)}` : '-'}</td>
                  <td class="credit">${entry.entry_type === 'credit' ? `₹${parseFloat(entry.amount || 0).toFixed(2)}` : '-'}</td>
                  <td>₹${parseFloat(entry.running_balance || 0).toFixed(2)}</td>
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
  };

  const hasActiveFilters = filters.entryType || filters.search || filters.dateFrom || filters.dateTo;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => navigate('/personal-ledger')}
            size="sm"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {customer?.name || 'Customer'} Personal Ledger
            </h1>
            {customer?.phone && (
              <p className="text-sm text-gray-600 mt-1">Phone: {customer.phone}</p>
            )}
          </div>
        </div>
      </div>

      {/* Balance Summary */}
      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Current Balance</p>
            <p className={`text-3xl font-bold mt-1 ${
              parseFloat(finalBalance) >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              ₹{parseFloat(finalBalance).toFixed(2)}
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
          <div className="flex gap-2">
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
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="border-t pt-4 mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Search className="h-4 w-4 inline mr-1" />
                  Search
                </label>
                <Input
                  placeholder="Search description..."
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
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        entry.entry_type === 'credit'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {entry.entry_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-700">{entry.description || '-'}</td>
                    <td className="py-3 px-4 text-right text-red-600 font-medium">
                      {entry.entry_type === 'debit' ? `₹${parseFloat(entry.amount || 0).toFixed(2)}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-right text-green-600 font-medium">
                      {entry.entry_type === 'credit' ? `₹${parseFloat(entry.amount || 0).toFixed(2)}` : '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-900">
                      ₹{parseFloat(entry.running_balance || 0).toFixed(2)}
                    </td>
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
            <p>No personal ledger entries for this customer</p>
            {hasActiveFilters && (
              <p className="text-sm mt-2">Try adjusting your filters</p>
            )}
          </div>
        )}
      </div>

      {/* Entry Form Modal */}
      <Modal
        isOpen={showEntryForm}
        onClose={() => {
          setShowEntryForm(false);
          setEntryData({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
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
    </div>
  );
}
