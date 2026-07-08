import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Users, Plus, FileText, Printer } from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { creditApi } from '../../lib/api';
import { formatAmountINR, formatNumber, toLocalDateString } from '../../lib/utils';
import PageHeader from '../../components/ui/PageHeader';
import Card from '../../components/ui/Card';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import LoadingState from '../../components/ui/LoadingState';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import Modal from '../../components/ui/Modal';

type PaymentMethod = 'cash' | 'upi' | 'mixed';
type TxnType = '' | 'sale' | 'payment' | 'return';

function formatLedgerDate(value?: string | null) {
  if (!value) return '—';
  try {
    return format(new Date(value), 'dd-MM-yyyy');
  } catch {
    return '—';
  }
}

function formatMoneyCell(value: string | number | null | undefined) {
  const n = parseFloat(String(value ?? 0));
  if (!Number.isFinite(n) || n === 0) return '';
  return formatAmountINR(n);
}

function balanceLabel(amount: string | number, side: string) {
  const n = parseFloat(String(amount ?? 0));
  return `${formatAmountINR(n)} ${side || 'Dr'}`;
}

export default function CreditLedger() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const customerParam = searchParams.get('customer') || '';

  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customerParam);
  const [txnType, setTxnType] = useState<TxnType>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => toLocalDateString(new Date()));
  const [paymentNotes, setPaymentNotes] = useState('');

  useEffect(() => {
    setSelectedCustomerId(customerParam);
  }, [customerParam]);

  const { data: customers = [], isLoading: customersLoading, refetch: refetchCustomers } = useQuery({
    queryKey: ['credit-ledger-customers', customerSearch],
    queryFn: async () => {
      const params: any = { with_balance: '0' };
      if (customerSearch.trim()) params.search = customerSearch.trim();
      const res = await creditApi.ledger.byCustomer(params);
      return res.data || [];
    },
  });

  const {
    data: statement,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['credit-ledger-statement', selectedCustomerId, dateFrom, dateTo, txnType],
    queryFn: async () => {
      const res = await creditApi.ledger.statement({
        customer: selectedCustomerId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        txn_type: txnType || undefined,
      });
      return res.data;
    },
    enabled: !!selectedCustomerId,
  });

  const selectedCustomer = useMemo(() => {
    if (statement?.customer) return statement.customer;
    return (customers as any[]).find((c) => String(c.id) === String(selectedCustomerId));
  }, [statement, customers, selectedCustomerId]);

  const rows = statement?.rows || [];

  const openPaymentModal = () => {
    setPaymentMethod('cash');
    setPaymentAmount('');
    setCashAmount('');
    setUpiAmount('');
    setPaymentDate(toLocalDateString(new Date()));
    setPaymentNotes('');
    setShowPaymentModal(true);
  };

  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomerId) throw new Error('Select a customer first');
      const payload: any = {
        credit_customer_id: Number(selectedCustomerId),
        payment_method: paymentMethod,
        notes: paymentNotes.trim() || undefined,
        paid_at: paymentDate ? `${paymentDate}T12:00:00` : undefined,
      };
      if (paymentMethod === 'mixed') {
        payload.cash_amount = parseFloat(cashAmount || '0');
        payload.upi_amount = parseFloat(upiAmount || '0');
      } else {
        payload.amount = parseFloat(paymentAmount);
      }
      const res = await creditApi.payments.create(payload);
      return res.data;
    },
    onSuccess: () => {
      setShowPaymentModal(false);
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-statement'] });
      queryClient.invalidateQueries({ queryKey: ['credit-ledger-customers'] });
      refetch();
      refetchCustomers();
    },
  });

  const mixedPreview =
    (parseFloat(cashAmount || '0') || 0) + (parseFloat(upiAmount || '0') || 0);

  const periodLabel = useMemo(() => {
    if (dateFrom && dateTo) return `From ${formatLedgerDate(dateFrom)} to ${formatLedgerDate(dateTo)}`;
    if (dateFrom) return `From ${formatLedgerDate(dateFrom)}`;
    if (dateTo) return `To ${formatLedgerDate(dateTo)}`;
    return 'All dates';
  }, [dateFrom, dateTo]);

  const exportPDF = () => {
    if (!selectedCustomer || !statement) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 12;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('POS CREDIT', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(14);
    doc.text('LEDGER', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`( ${periodLabel} )`, pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Account : ${(selectedCustomer.name || '').toUpperCase()}`, pageWidth / 2, y, {
      align: 'center',
    });
    y += 4;

    const body: any[][] = [];
    body.push([
      '',
      '',
      '',
      'Opening Balance',
      '',
      '',
      '',
      balanceLabel(statement.opening_balance, statement.opening_side),
    ]);

    for (const row of rows) {
      body.push([
        formatLedgerDate(row.created_at),
        row.txn_type || '',
        row.vch_no || '',
        row.particulars || '',
        row.narration || '',
        formatMoneyCell(row.debit),
        formatMoneyCell(row.credit),
        balanceLabel(row.running_balance, row.balance_side),
      ]);
    }

    body.push([
      '',
      '',
      '',
      'Totals',
      '',
      formatMoneyCell(statement.total_debit),
      formatMoneyCell(statement.total_credit),
      balanceLabel(statement.closing_balance, statement.closing_side),
    ]);

    (doc as any).autoTable({
      startY: y + 2,
      head: [['Date', 'Type', 'Vch No.', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance']],
      body,
      styles: {
        fontSize: 8,
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.1,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 20 },
        2: { cellWidth: 32 },
        3: { cellWidth: 45 },
        4: { cellWidth: 40 },
        5: { cellWidth: 28, halign: 'right' },
        6: { cellWidth: 28, halign: 'right' },
        7: { cellWidth: 32, halign: 'right' },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && (data.row.index === 0 || data.row.index === body.length - 1)) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 10, right: 10 },
      theme: 'grid',
    });

    const fileName = `credit_ledger_${(selectedCustomer.name || 'customer').replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Credit Ledger"
        subtitle="Account statement — sale, payment, and return"
        icon={BookOpen}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/pos-credit')}>
              POS Credit
            </Button>
            {selectedCustomerId && statement ? (
              <Button variant="secondary" onClick={exportPDF}>
                <FileText className="h-4 w-4 mr-1" />
                PDF
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card>
          <div className="p-4 border-b border-gray-100 flex items-center gap-2 font-medium">
            <Users className="h-4 w-4" />
            Accounts
          </div>
          <div className="p-3">
            <Input
              placeholder="Filter customers…"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
          </div>
          {customersLoading ? (
            <LoadingState />
          ) : (customers as any[]).length === 0 ? (
            <EmptyState icon={Users} title="No credit customers yet" />
          ) : (
            <div className="max-h-[560px] overflow-auto divide-y divide-gray-100">
              {(customers as any[]).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-amber-50 ${
                    String(selectedCustomerId) === String(c.id) ? 'bg-amber-50' : ''
                  }`}
                  onClick={() => {
                    setSelectedCustomerId(String(c.id));
                    setSearchParams({ customer: String(c.id) });
                  }}
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-gray-900">{c.name}</span>
                    <span className="text-amber-700">₹{formatNumber(parseFloat(c.balance || 0))}</span>
                  </div>
                  {c.phone ? <div className="text-xs text-gray-400">{c.phone}</div> : null}
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:col-span-3 space-y-4">
          {!selectedCustomerId ? (
            <Card>
              <EmptyState
                icon={BookOpen}
                title="Select an account"
                message="Choose a credit customer to view their ledger statement."
              />
            </Card>
          ) : (
            <>
              <Card>
                <div className="p-4 flex flex-wrap gap-3 items-end justify-between">
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="w-36">
                      <Input
                        label="From"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="w-36">
                      <Input
                        label="To"
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </div>
                    <div className="w-40">
                      <Select
                        label="Type"
                        value={txnType}
                        onChange={(e) => setTxnType(e.target.value as TxnType)}
                      >
                        <option value="">All</option>
                        <option value="sale">Sale</option>
                        <option value="payment">Payment</option>
                        <option value="return">Return</option>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={openPaymentModal}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Payment
                  </Button>
                </div>
              </Card>

              {isLoading ? (
                <LoadingState />
              ) : error ? (
                <ErrorState message="Failed to load statement" onRetry={() => refetch()} />
              ) : (
                <div className="bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
                  {/* Statement header — matching classic ledger look */}
                  <div className="border-b border-gray-800 px-4 py-4 text-center">
                    <div className="text-sm font-semibold tracking-wide text-gray-700">POS CREDIT</div>
                    <div className="text-xl font-bold tracking-wider text-gray-900 mt-1">LEDGER</div>
                    <div className="text-sm text-gray-600 mt-1">( {periodLabel} )</div>
                    <div className="text-base font-bold text-gray-900 mt-2 uppercase">
                      Account : {selectedCustomer?.name}
                    </div>
                    {selectedCustomer?.phone ? (
                      <div className="text-xs text-gray-500 mt-1">{selectedCustomer.phone}</div>
                    ) : null}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b-2 border-gray-800 bg-gray-50">
                          <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Date</th>
                          <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Type</th>
                          <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Vch No.</th>
                          <th className="text-left px-3 py-2 font-semibold">Particulars</th>
                          <th className="text-left px-3 py-2 font-semibold">Narration</th>
                          <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Debit</th>
                          <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Credit</th>
                          <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-200 font-medium bg-amber-50/40">
                          <td className="px-3 py-2" colSpan={3} />
                          <td className="px-3 py-2">Opening Balance</td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {balanceLabel(statement?.opening_balance, statement?.opening_side)}
                          </td>
                        </tr>

                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                              No entries in this period.
                            </td>
                          </tr>
                        ) : (
                          rows.map((row: any) => (
                            <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {formatLedgerDate(row.created_at)}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap capitalize">
                                <span
                                  className={
                                    row.txn_type === 'sale'
                                      ? 'text-red-700'
                                      : row.txn_type === 'payment'
                                        ? 'text-green-700'
                                        : 'text-blue-700'
                                  }
                                >
                                  {row.txn_type}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs">
                                {row.vch_no}
                              </td>
                              <td className="px-3 py-1.5">{row.particulars}</td>
                              <td className="px-3 py-1.5 text-gray-500">{row.narration}</td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                                {formatMoneyCell(row.debit)}
                              </td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                                {formatMoneyCell(row.credit)}
                              </td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums font-medium">
                                {balanceLabel(row.running_balance, row.balance_side)}
                              </td>
                            </tr>
                          ))
                        )}

                        <tr className="border-t-2 border-gray-800 font-bold bg-gray-50">
                          <td className="px-3 py-2" colSpan={3} />
                          <td className="px-3 py-2">Totals</td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {formatMoneyCell(statement?.total_debit)}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {formatMoneyCell(statement?.total_credit)}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {balanceLabel(statement?.closing_balance, statement?.closing_side)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="px-4 py-3 border-t border-gray-200 flex justify-end">
                    <Button variant="secondary" size="sm" onClick={exportPDF}>
                      <Printer className="h-4 w-4 mr-1" />
                      Download PDF
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title={`Add Payment${selectedCustomer ? ` — ${selectedCustomer.name}` : ''}`}
      >
        <div className="space-y-3">
          <Select
            label="Payment type"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="mixed">Cash + UPI</option>
          </Select>

          {paymentMethod === 'mixed' ? (
            <>
              <Input
                label="Cash amount"
                type="number"
                min="0"
                step="0.01"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
              <Input
                label="UPI amount"
                type="number"
                min="0"
                step="0.01"
                value={upiAmount}
                onChange={(e) => setUpiAmount(e.target.value)}
              />
              <div className="text-sm text-gray-600">Total: ₹{formatNumber(mixedPreview)}</div>
            </>
          ) : (
            <Input
              label="Amount"
              type="number"
              min="0"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
            />
          )}

          <Input
            label="Payment date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
          <Input
            label="Notes / narration (optional)"
            value={paymentNotes}
            onChange={(e) => setPaymentNotes(e.target.value)}
          />

          {paymentMutation.isError ? (
            <p className="text-sm text-red-600">
              {(paymentMutation.error as any)?.response?.data?.detail ||
                (paymentMutation.error as Error)?.message ||
                'Payment failed'}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowPaymentModal(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                paymentMutation.isPending ||
                (paymentMethod === 'mixed'
                  ? mixedPreview <= 0
                  : !(parseFloat(paymentAmount) > 0))
              }
              onClick={() => paymentMutation.mutate()}
            >
              {paymentMutation.isPending ? 'Saving…' : 'Record payment'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
