import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { posApi } from '../../lib/api';
import { 
  FileText, 
  Search, 
  Eye,
  Receipt,
  User,
  Calendar,
  DollarSign,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';

interface CreditNote {
  id: number;
  credit_note_number: string;
  return_number: string;
  invoice_id: number;
  invoice_number: string;
  customer_name: string | null;
  amount: string;
  notes: string;
  created_by_username: string;
  created_at: string;
}

export default function CreditNotes() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['credit-notes', search],
    queryFn: async () => {
      const params: any = {};
      if (search.trim()) {
        params.search = search.trim();
      }
      const response = await posApi.creditNotes.list(params);
      return response.data;
    },
    retry: false,
  });

  const creditNotes: CreditNote[] = data || [];

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

  const filteredCreditNotes = creditNotes.filter((cn) => {
    if (!search.trim()) return true;
    const searchLower = search.toLowerCase();
    return (
      cn.credit_note_number.toLowerCase().includes(searchLower) ||
      cn.invoice_number.toLowerCase().includes(searchLower) ||
      (cn.customer_name && cn.customer_name.toLowerCase().includes(searchLower)) ||
      cn.return_number.toLowerCase().includes(searchLower)
    );
  });

  if (isLoading) {
    return <LoadingState message="Loading credit notes..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Failed to load credit notes"
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit Notes"
        icon={Receipt}
        subtitle="View and manage all credit notes"
      />

      {/* Search and Filters */}
      <Card>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by credit note number, invoice number, customer, or return number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Credit Notes Table */}
      <Card>
        {filteredCreditNotes.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No credit notes found"
            message={
              search.trim()
                ? 'Try adjusting your search criteria'
                : 'Credit notes will appear here when created'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table headers={['Credit Note #', 'Invoice', 'Customer', 'Amount', 'Return #', 'Created By', 'Date', 'Actions']}>
              {filteredCreditNotes.map((creditNote) => (
                <TableRow key={creditNote.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-purple-500" />
                      <span className="font-medium text-gray-900">{creditNote.credit_note_number}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => navigate(`/invoices/${creditNote.invoice_id}`)}
                      className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                    >
                      <FileText className="h-4 w-4" />
                      {creditNote.invoice_number}
                    </button>
                  </TableCell>
                  <TableCell>
                    {creditNote.customer_name ? (
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-gray-700">{creditNote.customer_name}</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">Walk-in Customer</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-green-500" />
                      <span className="font-semibold text-green-700">{formatCurrency(creditNote.amount)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600 font-mono text-sm">{creditNote.return_number}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600">{creditNote.created_by_username || 'System'}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-600">{formatDate(creditNote.created_at)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => navigate(`/invoices/${creditNote.invoice_id}`)}
                      className="text-blue-600 hover:text-blue-800 flex items-center gap-1 hover:underline"
                    >
                      <Eye className="h-4 w-4" />
                      View Invoice
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {/* Summary */}
      {filteredCreditNotes.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Credit Notes</p>
              <p className="text-2xl font-bold text-gray-900">{filteredCreditNotes.length}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Total Credit Amount</p>
              <p className="text-2xl font-bold text-green-700">
                {formatCurrency(
                  filteredCreditNotes.reduce(
                    (sum, cn) => sum + parseFloat(cn.amount || '0'),
                    0
                  )
                )}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
