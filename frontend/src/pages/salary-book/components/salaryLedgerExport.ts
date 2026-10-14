import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatDate, formatINR } from '../utils';
import type { SalaryAdvance } from '../types';

export type LedgerExportRow = {
  date: string;
  particulars: string;
  invoice: string;
  debit: number;
  credit: number;
  balance: number;
  status: string;
  voided: boolean;
};

function entryParticulars(row: SalaryAdvance) {
  if (row.source === 'MTSHOP') {
    return `MT Shop${row.reason ? ` — ${row.reason}` : ''}`.trim();
  }
  return (row.reason || 'Advance').trim();
}

/** Build ledger lines with running outstanding balance (void rows shown, ignored in balance). */
export function buildSalaryLedgerRows(rows: SalaryAdvance[]): LedgerExportRow[] {
  let balance = 0;
  const out: LedgerExportRow[] = [];
  for (const row of rows) {
    const voided = row.status === 'VOID';
    const paid = row.status === 'PAID';
    const amount = Number(row.amount || 0);
    let debit = 0;
    let credit = 0;
    if (!voided) {
      if (paid) {
        // Taken earlier, settled now — net zero on outstanding.
        debit = amount;
        credit = amount;
      } else {
        debit = amount;
        balance += amount;
      }
    }
    out.push({
      date: formatDate(row.date),
      particulars: entryParticulars(row) + (voided ? ' (Voided)' : ''),
      invoice: (row.source_invoice_number || '').trim() || '—',
      debit,
      credit,
      balance: voided ? balance : balance,
      status: row.status,
      voided,
    });
  }
  return out;
}

function moneyCell(n: number) {
  if (!n) return '—';
  return formatINR(n);
}

function esc(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type SalaryLedgerExportMeta = {
  employeeName: string;
  employeeCode?: string;
  periodLabel?: string;
  totalActive: string | number;
  totalPaid: string | number;
};

export function exportSalaryLedgerPdf(rows: SalaryAdvance[], meta: SalaryLedgerExportMeta) {
  const ledger = buildSalaryLedgerRows(rows);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = 'Employee Salary Ledger';

  doc.setFontSize(16);
  doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.text(`Employee: ${meta.employeeName}`, 14, 26);
  let y = 31;
  if (meta.employeeCode) {
    doc.text(`Code: ${meta.employeeCode}`, 14, y);
    y += 5;
  }
  if (meta.periodLabel) {
    doc.text(`Period: ${meta.periodLabel}`, 14, y);
    y += 5;
  }
  doc.text(`Printed: ${formatDate(new Date().toISOString().slice(0, 10))}`, 14, y);
  y += 7;
  doc.setFontSize(11);
  doc.text(`Outstanding: ${formatINR(meta.totalActive)}`, 14, y);
  doc.text(`Settled / Paid: ${formatINR(meta.totalPaid)}`, 110, y);
  y += 4;

  const tableData = ledger.map((r) => [
    r.date,
    r.particulars,
    r.invoice,
    r.voided ? '—' : moneyCell(r.debit),
    r.voided ? '—' : moneyCell(r.credit),
    moneyCell(r.balance),
  ]);

  (doc as any).autoTable({
    head: [['Date', 'Particulars', 'Invoice', 'Taken (Dr)', 'Settled (Cr)', 'Balance']],
    body: tableData,
    startY: y + 2,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [5, 150, 105], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 62 },
      2: { cellWidth: 28 },
      3: { halign: 'right', cellWidth: 24 },
      4: {halign: 'right', cellWidth: 24 },
      5: {halign: 'right', cellWidth: 24 },
    },
    didParseCell: (data: any) => {
      const row = ledger[data.row.index];
      if (data.section === 'body' && row?.voided) {
        data.cell.styles.textColor = [150, 150, 150];
      }
    },
  });

  const safeName = (meta.employeeName || 'employee').replace(/[^\w\-]+/g, '_').slice(0, 40);
  doc.save(`salary_ledger_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function printSalaryLedger(rows: SalaryAdvance[], meta: SalaryLedgerExportMeta) {
  const ledger = buildSalaryLedgerRows(rows);
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const period = meta.periodLabel ? `<p><strong>Period:</strong> ${esc(meta.periodLabel)}</p>` : '';
  const code = meta.employeeCode ? `<p><strong>Code:</strong> ${esc(meta.employeeCode)}</p>` : '';

  const bodyRows = ledger
    .map(
      (r) => `
      <tr class="${r.voided ? 'voided' : ''}">
        <td>${esc(r.date)}</td>
        <td>${esc(r.particulars)}</td>
        <td>${esc(r.invoice)}</td>
        <td class="num debit">${r.voided ? '—' : esc(moneyCell(r.debit))}</td>
        <td class="num credit">${r.voided ? '—' : esc(moneyCell(r.credit))}</td>
        <td class="num">${esc(moneyCell(r.balance))}</td>
      </tr>`,
    )
    .join('');

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(meta.employeeName)} — Salary Ledger</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    .sub { color: #555; font-size: 13px; margin-bottom: 16px; }
    .totals { display: flex; gap: 32px; margin: 12px 0 18px; font-size: 14px; font-weight: 700; }
    .totals .out { color: #b45309; }
    .totals .paid { color: #047857; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #059669; color: #fff; text-align: left; padding: 8px 6px; }
    td { padding: 7px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th.num, td.num { text-align: right; white-space: nowrap; }
    .debit { color: #b91c1c; }
    .credit { color: #047857; }
    tr.voided td { color: #9ca3af; text-decoration: line-through; }
    .foot { margin-top: 18px; font-size: 11px; color: #6b7280; }
    @media print {
      body { margin: 12px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>Employee Salary Ledger</h1>
  <div class="sub">
    <p><strong>Employee:</strong> ${esc(meta.employeeName)}</p>
    ${code}
    ${period}
    <p><strong>Printed:</strong> ${esc(formatDate(new Date().toISOString().slice(0, 10)))}</p>
  </div>
  <div class="totals">
    <div class="out">Outstanding: ${esc(formatINR(meta.totalActive))}</div>
    <div class="paid">Settled / Paid: ${esc(formatINR(meta.totalPaid))}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Particulars</th>
        <th>Invoice</th>
        <th class="num">Taken (Dr)</th>
        <th class="num">Settled (Cr)</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="6">No entries</td></tr>'}
    </tbody>
  </table>
  <p class="foot">Taken = advance / MT Shop / repair hisab. Settled = paid or ledger credit. Balance = outstanding against salary.</p>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 200); };</script>
</body>
</html>`);
  printWindow.document.close();
}
