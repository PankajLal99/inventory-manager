import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '../../lib/api';
import { formatAppDate, formatNumber } from '../../lib/utils';
import ProductName from '../../components/ProductName';
import { formatProductNameHtml } from '../../lib/productNameColorRules';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card, { CardHeader } from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import {
    FileText,
    ArrowLeft,
    Receipt,
    User,
    Calendar,
    IndianRupee,
    Printer,
    FileCheck,
} from 'lucide-react';

export default function CreditNoteDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const creditNoteId = parseInt(id || '0');

    const { data: response, isLoading, error } = useQuery({
        queryKey: ['credit-note', creditNoteId],
        queryFn: () => posApi.creditNotes.get(creditNoteId),
        enabled: !!creditNoteId,
        retry: false,
    });

    const creditNote = response?.data;

    const formatDate = (dateString: string) =>
        formatAppDate(dateString, { includeTime: true, empty: '' });

    if (isLoading) {
        return <LoadingState message="Loading credit note details..." />;
    }

    if (error || !creditNote) {
        return (
            <ErrorState
                message="Credit note not found or failed to load"
                onRetry={() => navigate('/credit-notes')}
            />
        );
    }

    const returnDetails = creditNote.return_details || creditNote.return_obj || {};
    const returnedItems = Array.isArray(returnDetails.items) ? returnDetails.items :
        Array.isArray(creditNote.items) ? creditNote.items : [];

    const generateThermalCreditNoteHTML = (cn: any) => {
        const formatDate = (dateString: string) =>
            formatAppDate(dateString, { includeTime: true, empty: '' });

        const items = returnedItems || [];

        return `
<!DOCTYPE html>
<html>
<head>
    <title>Credit Note ${cn.credit_note_number}</title>
    <meta charset="UTF-8">
    <style>
        * {margin: 0; padding: 0; box-sizing: border-box; }
        @page {size: 4in auto; margin: 0.1in; }
        body {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            width: 4in;
            padding: 8px;
            color: #000;
        }
        .header {
            text-align: center;
            margin-bottom: 10px;
            border-bottom: 1px dashed #000;
            padding-bottom: 8px; 
        }
        .header h1 {font-size: 16px; margin-bottom: 4px; font-weight: bold; }
        .header p {font-size: 11px; margin: 2px 0; }
        .info {margin-bottom: 10px; font-size: 11px; }
        .info-row {margin: 3px 0; }
        table {width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
        th {padding: 4px 2px; text-align: left; border-bottom: 1px dashed #000; font-weight: bold; }
        td {padding: 4px 2px; border-bottom: 1px dotted #ccc; vertical-align: top; }
        .text-right {text-align: right; }
        .summary {margin-top: 10px; border-top: 1px dashed #000; padding-top: 8px; }
        .summary-row {display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
        .summary-total {border-top: 1px solid #000; margin-top: 6px; padding-top: 6px; font-weight: bold; font-size: 14px; }
        .footer {margin-top: 15px; padding-top: 8px; border-top: 1px dashed #000; text-align: center; font-size: 10px; }
        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 40px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.05);
            z-index: -1;
            text-transform: uppercase;
            width: 100%;
            text-align: center;
            pointer-events: none;
        }
    </style>
</head>
<body>
    <div class="watermark">CREDIT NOTE</div>
    <div class="header">
        <h1>CREDIT NOTE</h1>
        <p>${cn.credit_note_number}</p>
        <p>${formatDate(cn.created_at)}</p>
    </div>
    <div class="info">
        <div class="info-row"><strong>Invoice:</strong> ${cn.invoice_number || '-'}</div>
        <div class="info-row"><strong>Customer:</strong> ${cn.customer_name || 'Walk-in Customer'}</div>
    </div>
    <table>
        <thead>
            <tr>
                <th style="width: 50%">Item</th>
                <th class="text-right" style="width: 15%">Qty</th>
                <th class="text-right" style="width: 35%">Amount</th>
            </tr>
        </thead>
        <tbody>
            ${items.map((item: any) => `
                <tr>
                    <td>${formatProductNameHtml((item.product_name || 'Unknown').substring(0, 30))}</td>
                    <td class="text-right">${item.quantity}</td>
                    <td class="text-right">₹${formatNumber(item.refund_amount)}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    <div class="summary">
        <div class="summary-row summary-total">
            <span>TOTAL CREDIT:</span>
            <span>₹${formatNumber(cn.amount)}</span>
        </div>
    </div>
    <div class="footer">
        <p>Thank you!</p>
    </div>
    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
                // Close window after printing if desired
                // window.onafterprint = function() { window.close(); };
            }, 500);
        };
    </script>
</body>
</html>
        `;
    };

    const handlePrintThermal = () => {
        if (!creditNote) return;

        const thermalHTML = generateThermalCreditNoteHTML(creditNote);
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups to print');
            return;
        }

        printWindow.document.write(thermalHTML);
        printWindow.document.close();
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            {/* Header Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        onClick={() => navigate('/credit-notes')}
                        className="group"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2 group-hover:-translate-x-1 transition-transform" />
                        Back
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Credit Note Detail</h1>
                        <p className="text-gray-500 text-sm">{creditNote.credit_note_number}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handlePrintThermal}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Credit Note Info */}
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-3 bg-purple-100 rounded-lg">
                                        <Receipt className="h-6 w-6 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-500 uppercase font-semibold tracking-wider">Document Type</p>
                                        <h2 className="text-xl font-bold text-gray-900">Credit Note</h2>
                                    </div>
                                </div>
                                <Badge variant="success" className="text-sm px-3 py-1">
                                    <FileCheck className="h-4 w-4 mr-1" />
                                    Completed
                                </Badge>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6 border-y border-gray-100">
                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <User className="h-5 w-5 text-gray-400 mt-0.5" />
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Customer</p>
                                            <p className="font-semibold text-gray-900">{creditNote.customer_name || 'Walk-in Customer'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Date Created</p>
                                            <p className="text-gray-700 font-medium">{formatDate(creditNote.created_at)}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-start gap-3">
                                        <FileText className="h-5 w-5 text-gray-400 mt-0.5" />
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Reference Invoice</p>
                                            <button
                                                onClick={() => navigate(`/invoices/${creditNote.invoice_id}`)}
                                                className="text-blue-600 hover:text-blue-800 font-semibold hover:underline"
                                            >
                                                {creditNote.invoice_number}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <Receipt className="h-5 w-5 text-gray-400 mt-0.5" />
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Return Number</p>
                                            <p className="text-gray-700 font-medium font-mono">{creditNote.return_number}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {creditNote.notes && (
                                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                                    <p className="text-xs text-gray-500 uppercase font-bold mb-1">Notes</p>
                                    <p className="text-gray-700 italic">"{creditNote.notes}"</p>
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Items Table */}
                    <Card padding={false}>
                        <div className="p-6 border-b border-gray-100">
                            <CardHeader title="Returned Items" className="mb-0" />
                        </div>
                        <div className="overflow-x-auto">
                            <Table headers={['Product Details', 'Qty', 'Unit Price', 'Refund Amount']}>
                                {returnedItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                                            No items found in this return.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    returnedItems.map((item: any) => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <div>
                                                    <ProductName as="p"
                                                      className="font-semibold text-gray-900"
                                                     name={item.product_name} />
                                                    <div className="flex gap-2 text-xs text-gray-500 mt-0.5">
                                                        <span>SKU: {item.product_sku}</span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-medium text-gray-700">
                                                {item.quantity}
                                            </TableCell>
                                            <TableCell className="text-gray-600">
                                                ₹{item.quantity > 0 ? formatNumber(parseFloat(item.refund_amount) / parseFloat(item.quantity)) : '0.00'}
                                            </TableCell>
                                            <TableCell className="font-bold text-gray-900">
                                                ₹{formatNumber(item.refund_amount)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </Table>
                        </div>
                    </Card>
                </div>

                {/* Right Column: Total Summary */}
                <div className="space-y-6">
                    <Card>
                        <div className="p-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-4 border-b pb-4">Summary</h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-500">Items Count</span>
                                    <span className="font-medium text-gray-900">{returnedItems.length}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-gray-500">Total Returned Qty</span>
                                    <span className="font-medium text-gray-900">
                                        {returnedItems.reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0), 0)}
                                    </span>
                                </div>
                                <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                                    <span className="text-base font-bold text-gray-900 uppercase tracking-tight">Total Credit</span>
                                    <div className="flex items-center text-2xl font-black text-green-700">
                                        <IndianRupee className="h-6 w-6 mr-1" />
                                        {formatNumber(creditNote.amount)}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-3">
                                <div className="flex items-center gap-2 text-blue-800 font-bold text-sm">
                                    <FileCheck className="h-4 w-4" />
                                    Ledger Updated
                                </div>
                                <p className="text-xs text-blue-700 leading-relaxed">
                                    The amount of <strong>₹{formatNumber(creditNote.amount)}</strong> has been credited to the customer's ledger account.
                                </p>
                            </div>

                            <div className="mt-8 space-y-3">
                                <p className="text-[10px] text-gray-400 uppercase font-bold text-center">Process Details</p>
                                <div className="flex justify-between text-[11px] text-gray-500">
                                    <span>Created By:</span>
                                    <span className="font-semibold text-gray-700">{creditNote.created_by_username || 'System'}</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}