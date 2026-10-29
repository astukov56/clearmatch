import { formatCurrency } from '../money';
import { ReconciliationResult } from '../reconcile';

/**
 * Deduplicates SKU prefix if the item description already contains the SKU string.
 */
export const formatDescription = (desc: string, sku?: string | null): string => {
  if (!sku) return desc;
  return desc.toUpperCase().includes(sku.toUpperCase()) ? desc : `[SKU: ${sku}] ${desc}`;
};

/**
 * Generates an executive-ready Vendor Dispute Notice detailing itemized
 * pricing and quantity discrepancies between an extracted invoice and contracted PO.
 */
export function generateDisputeNotice(ledger: ReconciliationResult, poNumber: string): string {
  const currentDate = new Date().toISOString().split('T')[0];
  const targetPoNumber = poNumber || ledger.po_number || 'UNKNOWN';
  const targetInvoiceNumber = ledger.invoice_number || 'UNKNOWN';
  const traceId = (ledger as { trace_id?: string }).trace_id || `LOG-${targetPoNumber}`;

  const invoicedSubtotalCents =
    ledger.invoiced_subtotal_cents ??
    ledger.line_items.reduce((sum, item) => sum + item.invoiced_line_total_cents, 0);

  const poSubtotalCents = invoicedSubtotalCents - ledger.total_variance_cents;
  const netVarianceCents = ledger.total_variance_cents;

  // Filter line discrepancies specifically for price or quantity mismatches (and unexpected items)
  const discrepantLines = ledger.line_items.filter(
    (item) =>
      item.status === 'PRICE_MISMATCH' ||
      item.status === 'QUANTITY_MISMATCH' ||
      item.status === 'UNEXPECTED_ITEM'
  );

  const unmatchedPOItems = ledger.unmatched_po_items ?? [];

  let discrepanciesText = '';
  if (discrepantLines.length === 0 && unmatchedPOItems.length === 0) {
    discrepanciesText = '  No line item pricing or quantity discrepancies detected.\n';
  } else {
    const formattedDiscrepantLines = discrepantLines.map((item, index) => {
      const itemDesc = formatDescription(item.invoice_description, item.po_sku);
      const lineVarianceCents =
        item.invoiced_line_total_cents - item.expected_quantity * item.expected_unit_price_cents;

      return [
        `  ${index + 1}. Item Description:      ${itemDesc}`,
        `     Discrepancy Category:  ${item.status.replace(/_/g, ' ')}`,
        `     Billed Quantity:       ${item.invoiced_quantity} (Contracted / Expected: ${item.expected_quantity})`,
        `     Expected Unit Price:   ${formatCurrency(item.expected_unit_price_cents)}`,
        `     Invoiced Unit Price:   ${formatCurrency(item.invoiced_unit_price_cents)}`,
        `     Unit Variance:         ${formatCurrency(item.variance_unit_price_cents, { showPositiveSign: true })}`,
        `     Line Total Variance:   ${formatCurrency(lineVarianceCents, { showPositiveSign: true })} (Invoiced: ${formatCurrency(item.invoiced_line_total_cents)})`,
      ].join('\n');
    });

    const formattedUnmatchedItems = unmatchedPOItems.map((poItem, index) => {
      const entryNum = discrepantLines.length + index + 1;
      const itemDesc = formatDescription(poItem.description, poItem.sku);
      const poItemTotalCents =
        poItem.total_cents ?? poItem.quantity * poItem.unit_price_cents;
      return [
        `  ${entryNum}. Item Description:      ${itemDesc}`,
        `     Discrepancy Category:  UNMATCHED PO ITEM (OMITTED FROM INVOICE)`,
        `     Billed Quantity:       0 (Contracted / Expected: ${poItem.quantity})`,
        `     Expected Unit Price:   ${formatCurrency(poItem.unit_price_cents)}`,
        `     Invoiced Unit Price:   ${formatCurrency(0)}`,
        `     Unit Variance:         ${formatCurrency(-poItem.unit_price_cents, { showPositiveSign: true })}`,
        `     Line Total Variance:   ${formatCurrency(-poItemTotalCents, { showPositiveSign: true })} (Invoiced: ${formatCurrency(0)})`,
      ].join('\n');
    });

    discrepanciesText = [...formattedDiscrepantLines, ...formattedUnmatchedItems].join('\n\n');
  }

  const isOvercharge = netVarianceCents > 0;

  const financialSummaryLines = isOvercharge
    ? [
        `  PO Authorized Baseline Subtotal:  ${formatCurrency(poSubtotalCents)}`,
        `  Invoiced Subtotal Billed:         ${formatCurrency(invoicedSubtotalCents)}`,
        `  Net Audit Variance:               ${formatCurrency(netVarianceCents, { showPositiveSign: true })}`,
        `  Requested Credit Memo Amount:     ${formatCurrency(netVarianceCents)}`,
        `  Adjusted Authorized Payable:      ${formatCurrency(poSubtotalCents)}`,
      ]
    : [
        `  PO Authorized Baseline Subtotal:  ${formatCurrency(poSubtotalCents)}`,
        `  Invoiced Subtotal Billed:         ${formatCurrency(invoicedSubtotalCents)}`,
        `  Net Audit Variance:               ${formatCurrency(netVarianceCents, { showPositiveSign: true })}`,
        '  Commercial Impact:                Contract Rate Discrepancy (Net Underbill / Parity)',
        `  Current Invoiced Payable:         ${formatCurrency(invoicedSubtotalCents)}`,
      ];

  const requestedActionLines = isOvercharge
    ? [
        `1. Please issue a Credit Memo in the amount of ${formatCurrency(netVarianceCents)} referencing Invoice #${targetInvoiceNumber}.`,
        `2. Alternatively, re-issue a corrected invoice reflecting authorized Purchase Order #${targetPoNumber} contract rates.`,
        `3. Always reference Audit Trace ID: ${traceId} on all billing communications.`,
      ]
    : [
        `1. Please confirm written authorization to settle at the lower invoiced subtotal (${formatCurrency(invoicedSubtotalCents)}), or re-issue a corrected invoice aligning with authorized Purchase Order #${targetPoNumber} contract unit rates.`,
        '2. Note: Contract unit rate deviations are logged for quarterly vendor compliance review.',
        `3. Always reference Audit Trace ID: ${traceId} on all billing communications.`,
      ];

  return [
    '================================================================================',
    '                       FORMAL VENDOR DISPUTE NOTICE                             ',
    '                   CLEARMATCH CONTRACT AUDIT CLEARINGHOUSE                     ',
    '================================================================================',
    '',
    `DATE:                   ${currentDate}`,
    `VENDOR NAME:            ${ledger.vendor_name}`,
    `TARGET INVOICE NUMBER:  ${targetInvoiceNumber}`,
    `REFERENCED PO NUMBER:   ${targetPoNumber}`,
    `AUDIT TRACE ID:         ${traceId}`,
    '',
    '--------------------------------------------------------------------------------',
    `RE: Notice of Contract Discrepancy — Invoice #${targetInvoiceNumber}`,
    '--------------------------------------------------------------------------------',
    '',
    `Dear Accounts Receivable at ${ledger.vendor_name},`,
    '',
    `Our automated contract ingestion engine has audited Invoice #${targetInvoiceNumber} against`,
    `authorized Purchase Order #${targetPoNumber}. The audit identified itemized variance(s)`,
    'that do not conform to our contractual terms. Payment for the disputed portion is',
    'held pending resolution of the line item discrepancies listed below.',
    '',
    'ITEMIZED LINE DISCREPANCIES:',
    '--------------------------------------------------------------------------------',
    discrepanciesText,
    '--------------------------------------------------------------------------------',
    '',
    'FINANCIAL RECONCILIATION SUMMARY:',
    '--------------------------------------------------------------------------------',
    ...financialSummaryLines,
    '--------------------------------------------------------------------------------',
    '',
    'REQUESTED ACTION:',
    ...requestedActionLines,
    '',
    'Sincerely,',
    'Accounts Payable & Contract Compliance Department',
    'ClearMatch Automated Reconciliation Operations',
    '================================================================================',
  ].join('\n');
}
