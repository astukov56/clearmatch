import { formatCurrency } from '../money';
import { ReconciliationResult } from '../reconcile';
import { ExtractedInvoice } from '../extraction/schemas';

/**
 * Escapes a cell value for RFC 4180 compliant CSV export.
 * Wraps strings containing commas, quotes, or newlines in double quotes,
 * and escapes embedded quotes by doubling them.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface CSVExportOptions {
  poSubtotalCents?: number;
  traceId?: string;
}

/**
 * Builds the RFC 4180 CSV string for a reconciliation result.
 */
export function buildReconciliationCSV(
  data: ReconciliationResult,
  poNumber: string,
  _invoiceNumber: string,
  options?: CSVExportOptions
): string {
  const headers = [
    'Line',
    'PO SKU',
    'Item Description',
    'Qty Invoiced',
    'Qty Expected',
    'Unit Price Expected',
    'Unit Price Invoiced',
    'Unit Variance',
    'Line Total',
    'Status',
  ];

  const rows: string[] = [headers.join(',')];

  let lineIndex = 1;
  data.line_items.forEach((line) => {
    const row = [
      escapeCsvCell(lineIndex++),
      escapeCsvCell(line.po_sku ?? ''),
      escapeCsvCell(line.invoice_description),
      escapeCsvCell(line.invoiced_quantity),
      escapeCsvCell(line.expected_quantity),
      escapeCsvCell(formatCurrency(line.expected_unit_price_cents)),
      escapeCsvCell(formatCurrency(line.invoiced_unit_price_cents)),
      escapeCsvCell(
        formatCurrency(line.variance_unit_price_cents, { showPositiveSign: true })
      ),
      escapeCsvCell(formatCurrency(line.invoiced_line_total_cents)),
      escapeCsvCell(line.status),
    ];
    rows.push(row.join(','));
  });

  if (data.unmatched_po_items && data.unmatched_po_items.length > 0) {
    data.unmatched_po_items.forEach((poItem) => {
      const row = [
        escapeCsvCell(lineIndex++),
        escapeCsvCell(poItem.sku ?? ''),
        escapeCsvCell(`[UNBILLED] ${poItem.description}`),
        escapeCsvCell(0),
        escapeCsvCell(poItem.quantity),
        escapeCsvCell(formatCurrency(poItem.unit_price_cents)),
        escapeCsvCell(formatCurrency(0)),
        escapeCsvCell(
          formatCurrency(-poItem.unit_price_cents, { showPositiveSign: true })
        ),
        escapeCsvCell(formatCurrency(0)),
        escapeCsvCell('UNMATCHED_PO_ITEM'),
      ];
      rows.push(row.join(','));
    });
  }

  // Calculate summary metrics deterministically
  const invoicedSubtotalCents =
    data.invoiced_subtotal_cents ??
    data.line_items.reduce((sum, item) => sum + item.invoiced_line_total_cents, 0);

  const poSubtotalCents =
    options?.poSubtotalCents ?? (invoicedSubtotalCents - data.total_variance_cents);

  const traceId = options?.traceId ?? `LOG-${poNumber || data.po_number || 'UNKNOWN'}`;

  // Summary Block (clean key-value vertical layout to prevent tabular column skew)
  rows.push('');
  rows.push('SUMMARY METRICS');
  rows.push(`Invoiced Subtotal,${escapeCsvCell(formatCurrency(invoicedSubtotalCents))}`);
  rows.push(`PO Subtotal Baseline,${escapeCsvCell(formatCurrency(poSubtotalCents))}`);
  rows.push(
    `Total Drift / Variance,${escapeCsvCell(
      formatCurrency(data.total_variance_cents, { showPositiveSign: true })
    )}`
  );
  rows.push(`Reconciliation Status,${escapeCsvCell(data.status)}`);
  rows.push(`Trace Audit ID,${escapeCsvCell(traceId)}`);

  // Audit Trail Log capturing all engine notes and human operator overrides
  if (data.audit_notes && data.audit_notes.length > 0) {
    rows.push('');
    rows.push('AUDIT TRAIL LOG');
    data.audit_notes.forEach((note) => {
      rows.push(`Audit Note,${escapeCsvCell(note)}`);
    });
  }

  return rows.join('\r\n');
}

/**
 * Convenience helper matching currency formatting for cents to dollar representation.
 */
export function formatCentsToDollars(
  cents: number,
  options?: { showPositiveSign?: boolean }
): string {
  return formatCurrency(cents, options);
}

/**
 * Triggers a client-side browser download for a Blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Exports the reconciled state as a structured ERP-ready CSV file.
 */
export function exportReconciliationToCSV(
  data: ReconciliationResult,
  poNumber: string,
  invoiceNumber: string,
  options?: CSVExportOptions
): void {
  const csvContent = buildReconciliationCSV(data, poNumber, invoiceNumber, options);
  // Prepend UTF-8 BOM so Excel opens the file cleanly without character encoding issues
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const safeInvoiceNumber = (invoiceNumber || data.invoice_number || 'invoice').replace(
    /[^\w.-]/g,
    '_'
  );
  triggerDownload(blob, `reconciliation-${safeInvoiceNumber}-${Date.now()}.csv`);
}

/**
 * Alias for exportReconciliationToCSV supporting short nomenclature.
 */
export const exportToCsv = exportReconciliationToCSV;

export interface AuditProofPayload {
  meta: {
    app: string;
    version: string;
    exportedAt: string;
    traceId: string;
  };
  untrustedVlmExtraction: ExtractedInvoice | unknown;
  trustedDeterministicLedger: ReconciliationResult;
}

/**
 * Builds the complete cryptographic/audit proof payload capturing the Trust Boundary.
 */
export function buildAuditProofPayload(
  rawVlm: ExtractedInvoice | unknown,
  engineLedger: ReconciliationResult,
  traceId: string
): AuditProofPayload {
  return {
    meta: {
      app: 'ClearMatch',
      version: 'v0.1-deterministic',
      exportedAt: new Date().toISOString(),
      traceId,
    },
    untrustedVlmExtraction: rawVlm ?? null,
    trustedDeterministicLedger: engineLedger,
  };
}

/**
 * Exports the complete cryptographic/audit JSON proof capturing both raw VLM extraction
 * and deterministic engine ledger state.
 */
export function exportAuditProofJSON(
  rawVlm: ExtractedInvoice | unknown,
  engineLedger: ReconciliationResult,
  traceId: string,
  invoiceNumber: string
): void {
  const payload = buildAuditProofPayload(rawVlm, engineLedger, traceId);
  const jsonContent = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const safeInvoiceNumber = (invoiceNumber || engineLedger.invoice_number || 'invoice').replace(
    /[^\w.-]/g,
    '_'
  );
  triggerDownload(blob, `audit-proof-${safeInvoiceNumber}-${Date.now()}.json`);
}
