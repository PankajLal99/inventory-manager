import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { posApi } from '../../lib/api';
import { formatNumber } from '../../lib/utils';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Table, { TableRow, TableCell } from '../../components/ui/Table';
import LoadingState from '../../components/ui/LoadingState';
import ErrorState from '../../components/ui/ErrorState';
import {
    FileText,
    ArrowLeft,
    Receipt,
    User,
    Calendar,
    Printer,
    FileCheck,
    ShoppingBag,
} from 'lucide-react';

export default function CreditNoteShowcase() {
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

    const formatDateForInvoice = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

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

    const generateA4CreditNoteHTML = (isPreview = false) => {
        const cnDate = formatDateForInvoice(creditNote.created_at);
        const companyName = 'Manish Traders';
        const companyAddress = 'Shop Number124-A Ground Floor\nChaitaniya Market Ghoda Nikkas Bhopal';
        const totalPcs = returnedItems.reduce((sum: number, item: any) => sum + (parseInt(item.quantity || '0') || 0), 0);

        return `
<!DOCTYPE html>
<html>
<head>
    <title>Credit Note ${creditNote.credit_note_number}</title>
    <meta charset="UTF-8">
    <style>
        * {margin: 0; padding: 0; box-sizing: border-box; }
        body {font-family: Arial, sans-serif; padding: 10px; color: #000; line-height: 1.2; }
        .page-container {
            display: flex;
            flex-direction: column;
            min-height: 277mm; 
            padding: 10px;
        }
        .content-area { flex: 1; display: flex; flex-direction: column; }
        .top-section {display: flex; justify-content: space-between; margin-bottom: 15px; }
        .top-left p, .top-right p {margin: 2px 0; font-size: 13px; }
        .company-header {text-align: center; margin-bottom: 15px; }
        .company-name {font-size: 20px; font-weight: bold; margin-bottom: 4px; }
        .company-address {font-size: 13px; white-space: pre-line; margin-bottom: 2px; }
        .doc-title {text-align: center; font-size: 22px; font-weight: bold; margin: 15px 0; text-transform: uppercase; border-y: 2px solid #000; padding: 5px 0; }
        .party-section {margin-bottom: 15px; }
        .party-section p {margin: 4px 0; font-size: 14px; }
        table {width: 100%; border-collapse: collapse; margin-bottom: 15px; flex: 1; }
        th {background: #f0f0f0; padding: 10px 8px; text-align: left; border: 1px solid #000; font-weight: bold; font-size: 13px; }
        td {padding: 8px; border-left: 1px solid #000; border-right: 1px solid #000; font-size: 13px; border-bottom: 1px solid #eee; }
        .text-right {text-align: right; }
        .text-center {text-align: center; }
        .total-row {font-weight: bold; }
        .total-row td {border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 10px 8px; background: #f9f9f9; }
        .footer-area { margin-top: auto; padding-top: 20px; }
        .signatory { text-align: right; margin-top: 40px; }
        .footer { text-align: center; border-top: 1px solid #000; padding-top: 10px; margin-top: 20px; font-size: 11px; }
        .watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 100px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.05);
            z-index: -1;
            pointer-events: none;
            text-transform: uppercase;
        }
        @media print {
            body {padding: 0; margin: 0; }
            .page-container {min-height: 297mm; padding: 20mm 15mm; }
        }
    </style>
</head>
<body>
    <div class="page-container">
        <div class="watermark">CREDIT NOTE</div>
        <div class="content-area">
            <div class="top-section">
                <div class="top-left">
                    <p><strong>Credit Note No.:</strong> ${creditNote.credit_note_number}</p>
                    <p><strong>Ref Invoice:</strong> ${creditNote.invoice_number || '-'}</p>
                </div>
                <div class="top-right">
                    <p><strong>Date:</strong> ${cnDate}</p>
                </div>
            </div>

            <div class="company-header">
                <div class="company-name">${companyName}</div>
                <div class="company-address">${companyAddress}</div>
            </div>

            <div class="doc-title">CREDIT NOTE</div>

            <div class="party-section">
                <p><strong>Customer:</strong> ${creditNote.customer_name || 'Walk-in Customer'}</p>
                <p><strong>Return No.:</strong> ${creditNote.return_number}</p>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 70%;">Description of Goods</th>
                        <th style="width: 30%;" class="text-center">Quantity (PCS)</th>
                    </tr>
                </thead>
                <tbody>
                    ${returnedItems.map((item: any) => `
                        <tr>
                            <td>${item.product_name} ${item.product_brand_name ? `(${item.product_brand_name})` : ''}</td>
                            <td class="text-center">${formatNumber(item.quantity, 3)}</td>
                        </tr>
                    `).join('')}
                    <tr style="height: 100%;"><td style="border-bottom: none;"></td><td style="border-bottom: none;"></td></tr>
                    <tr class="total-row">
                        <td><strong>Total</strong></td>
                        <td class="text-center"><strong>${formatNumber(totalPcs, 3)}</strong></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="footer-area">
            <div style="display: flex; justify-content: space-between;">
                <div style="width: 60%;">
                    <p style="font-size: 12px;"><strong>Notes:</strong> ${creditNote.notes || 'N/A'}</p>
                </div>
                <div class="signatory">
                    <p><strong>for ${companyName}</strong></p>
                    <div style="margin-top: 50px;">
                        <p>Authorised Signatory</p>
                    </div>
                </div>
            </div>
            <div class="footer">
                <p>This is a Computer Generated Credit Note</p>
            </div>
        </div>
    </div>
    ${!isPreview ? `
    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 500);
        };
    </script>
    ` : ''}
</body>
</html>
    `;
    };

    const handlePrintA4 = () => {
        const html = generateA4CreditNoteHTML();
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(html);
        printWindow.document.close();
    };

    const handlePrintThermal = () => {
        if (!creditNote) return;

        // Helper to format date for thermal printer
        const formatThermalDate = (dateString: string) => {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        };

        const thermalHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Credit Note ${creditNote.credit_note_number}</title>
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
        .footer {margin-top: 15px; padding-top: 8px; border-top: 1px dashed #000; text-align: center; font-size: 10px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>CREDIT NOTE</h1>
        <p>${creditNote.credit_note_number}</p>
        <p>${formatThermalDate(creditNote.created_at)}</p>
    </div>
    <div class="info">
        <div class="info-row"><strong>Invoice:</strong> ${creditNote.invoice_number || '-'}</div>
        <div class="info-row"><strong>Customer:</strong> ${creditNote.customer_name || 'Walk-in Customer'}</div>
    </div>
    <table>
        <thead>
            <tr>
                <th style="width: 70%">Item</th>
                <th class="text-right" style="width: 30%">Qty</th>
            </tr>
        </thead>
        <tbody>
            ${returnedItems.map((item: any) => `
                <tr>
                    <td>${(item.product_name || 'Unknown').substring(0, 30)}</td>
                    <td class="text-right">${item.quantity}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    <div class="footer">
        <p>Thank you!</p>
    </div>
    <script>
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 500);
        };
    </script>
</body>
</html>
    `;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups to print');
            return;
        }

        printWindow.document.write(thermalHTML);
        printWindow.document.close();
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            {/* Header section similar to InvoiceDetail */}
            <div className="space-y-4">
                <Button
                    variant="outline"
                    onClick={() => navigate('/credit-notes')}
                    className="w-full sm:w-auto"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                </Button>

                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 sm:p-6 border-b border-gray-100">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="flex-shrink-0 p-2.5 bg-purple-50 rounded-lg border border-purple-100">
                                    <Receipt className="h-5 w-5 text-purple-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                                        {creditNote.credit_note_number}
                                    </h1>
                                    <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                                        Created on {formatDate(creditNote.created_at)}
                                    </p>
                                </div>
                            </div>

                            <div className="flex-shrink-0">
                                <Badge variant="success" className="w-full sm:w-auto justify-center sm:justify-start">
                                    <FileCheck className="h-3.5 w-3.5 mr-1.5" />
                                    Completed
                                </Badge>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 sm:p-6 bg-gray-50">
                        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end sm:items-center">
                            <div className="flex gap-2 w-full sm:w-auto">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrintA4}
                                    className="flex-1 sm:flex-none"
                                >
                                    <Printer className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">Print A4</span>
                                    <span className="sm:hidden">A4</span>
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrintThermal}
                                    className="flex-1 sm:flex-none"
                                >
                                    <Printer className="h-4 w-4 sm:mr-2" />
                                    <span className="hidden sm:inline">Print Thermal</span>
                                    <span className="sm:hidden">Thermal</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid Layout similar to InvoiceDetail */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Credit Note Info and Items */}
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Credit Note Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex items-start gap-3">
                                <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <dt className="text-sm font-medium text-gray-500 mb-1">Customer</dt>
                                    <dd className="text-sm text-gray-900 font-semibold">{creditNote.customer_name || 'Walk-in Customer'}</dd>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <dt className="text-sm font-medium text-gray-500 mb-1">Date Created</dt>
                                    <dd className="text-sm text-gray-900">{formatDate(creditNote.created_at)}</dd>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <FileText className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <dt className="text-sm font-medium text-gray-500 mb-1">Reference Invoice</dt>
                                    <dd className="text-sm">
                                        <button
                                            onClick={() => navigate(`/invoices/${creditNote.invoice_id}`)}
                                            className="text-blue-600 hover:text-blue-800 font-semibold hover:underline"
                                        >
                                            {creditNote.invoice_number}
                                        </button>
                                    </dd>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Receipt className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <dt className="text-sm font-medium text-gray-500 mb-1">Return Number</dt>
                                    <dd className="text-sm font-mono text-gray-700">{creditNote.return_number}</dd>
                                </div>
                            </div>
                        </div>
                        {creditNote.notes && (
                            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-100 italic text-gray-600 text-sm">
                                "{creditNote.notes}"
                            </div>
                        )}
                    </Card>

                    <Card>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <ShoppingBag className="h-5 w-5 text-gray-400" />
                            Returned Items ({returnedItems.length})
                        </h3>
                        <div className="overflow-x-auto">
                            <Table headers={['Product Details', 'SKU', 'Quantity']}>
                                {returnedItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center py-8 text-gray-500">
                                            No items found in this return.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    returnedItems.map((item: any) => (
                                        <TableRow key={item.id}>
                                            <TableCell>
                                                <span className="font-semibold text-gray-900">{item.product_name}</span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-gray-600 font-mono">{item.product_sku}</span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="font-bold text-gray-900">{item.quantity}</span>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </Table>
                        </div>
                    </Card>
                </div>

                {/* Right Column: Summary */}
                <div className="space-y-6">
                    <Card>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-4">Summary</h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center py-2">
                                <span className="text-sm text-gray-600">Items Count</span>
                                <span className="text-sm font-medium text-gray-900">{returnedItems.length}</span>
                            </div>
                            <div className="flex justify-between items-center py-2">
                                <span className="text-sm text-gray-600">Total Returned Qty</span>
                                <span className="text-sm font-medium text-gray-900">
                                    {returnedItems.reduce((sum: number, item: any) => sum + parseFloat(item.quantity || 0), 0)}
                                </span>
                            </div>
                            <div className="pt-6 border-t border-gray-100">
                                <p className="text-[10px] text-gray-400 uppercase font-bold text-center tracking-widest mb-4">Process Details</p>
                                <div className="flex justify-between text-xs text-gray-500">
                                    <span>Created By:</span>
                                    <span className="font-semibold text-gray-700">{creditNote.created_by_username || 'System'}</span>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-3 shadow-sm">
                        <div className="flex items-center gap-2 text-blue-800 font-bold text-sm">
                            <FileCheck className="h-4 w-4" />
                            Ledger Updated
                        </div>
                        <p className="text-xs text-blue-700 leading-relaxed">
                            The transaction has been successfully processed and the customer's ledger has been adjusted accordingly.
                        </p>
                    </div>
                </div>
            </div>

            {/* A4 Print Preview - Integrated */}
            <Card className="no-print mt-8">
                <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Printer className="h-5 w-5 text-gray-400" />
                        A4 Credit Note Preview
                    </h3>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePrintA4}
                            className="flex-1 sm:flex-none"
                        >
                            <Printer className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">Print A4</span>
                            <span className="sm:hidden">A4</span>
                        </Button>
                    </div>
                </div>
                <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 shadow-lg">
                    <div className="bg-gray-50 border-b border-gray-300 px-4 py-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700">A4 Credit Note Preview</span>
                        <span className="text-xs text-gray-500 hidden sm:inline">This is how the credit note will appear when printed</span>
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
                                title="Credit Note A4 Preview"
                                srcDoc={generateA4CreditNoteHTML(true)}
                                className="w-full border-0 block"
                                style={{
                                    width: '100%',
                                    minHeight: '297mm',
                                    border: 'none',
                                    display: 'block'
                                }}
                                onLoad={(e) => {
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
                                        iframe.style.height = (height + 40) + 'px';
                                    }
                                }}
                            />
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    );
}
