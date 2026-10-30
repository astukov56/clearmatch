import { formatCurrency } from './money';
import {
  PurchaseOrder,
  ReconciledInvoice,
  ReconciledLineItem,
} from './reconcile';

export type { ReconciledInvoice };

/**
 * Formats line item description with SKU prefix if SKU is present and not already in description.
 */
export function formatDisputeLineDescription(
  description: string,
  sku?: string | null
): string {
  if (!sku) return description;
  return description.toUpperCase().includes(sku.toUpperCase())
    ? description
    : `[SKU: ${sku}] ${description}`;
}

/**
 * Computes exact integer-cent line total variance for a reconciled line item.
 */
export function computeLineVarianceCents(item: ReconciledLineItem): number {
  if (typeof item.line_variance_cents === 'number') {
    return Math.round(item.line_variance_cents);
  }
  const expectedLineTotalCents = Math.round(
    item.expected_quantity * item.expected_unit_price_cents
  );
  return Math.round(item.invoiced_line_total_cents - expectedLineTotalCents);
}

/**
 * Pure, deterministic Accounts Payable Dispute Notice generator.
 * Produces an executive-ready "NOTICE OF INVOICE DISCREPANCY & SHORT-PAY ADJUSTMENT"
 * from integer-cent reconciliation and PO baseline values.
 */
export function generateDisputeNotice(
  reconciliation: ReconciledInvoice,
  po: PurchaseOrder,
  policyName: string,
  operatorName = 'Accounts Payable Operator'
): string {
  const issueDate = new Date().toISOString().split('T')[0];
  const poNumber = po.po_number || reconciliation.po_number || 'UNKNOWN';
  const invoiceNumber = reconciliation.invoice_number || 'UNKNOWN';
  const vendorName = po.vendor_name || reconciliation.vendor_name || 'UNKNOWN';
  const traceId = reconciliation.trace_id || `LOG-${poNumber}`;
  const activePolicy = policyName || 'Strict Zero-Drift ($0.00)';
  const resolvedOperatorName =
    operatorName && operatorName.trim().length > 0
      ? operatorName.trim()
      : 'Accounts Payable Operator';

  const invoicedSubtotalCents =
    reconciliation.invoiced_subtotal_cents ??
    (reconciliation.line_items ?? []).reduce(
      (sum, item) => sum + item.invoiced_line_total_cents,
      0
    );

  const poSubtotalCents =
    typeof reconciliation.po_subtotal_cents === 'number'
      ? reconciliation.po_subtotal_cents
      : typeof po.subtotal_cents === 'number'
      ? po.subtotal_cents
      : invoicedSubtotalCents - reconciliation.total_variance_cents;

  const totalVarianceCents = reconciliation.total_variance_cents;
  const authorizedShortPayCents = poSubtotalCents;

  // Filter (reconciliation.line_items ?? []) where line_variance_cents !== 0 or status !== 'MATCHED' / 'MATCH'
  const discrepantItems = (reconciliation.line_items ?? []).filter((item) => {
    const lineVarianceCents = computeLineVarianceCents(item);
    const statusStr = String(item.status);
    return (
      lineVarianceCents !== 0 ||
      item.variance_unit_price_cents !== 0 ||
      (statusStr !== 'MATCH' && statusStr !== 'MATCHED')
    );
  });

  const unmatchedPoItems = reconciliation.unmatched_po_items ?? [];

  const discrepancyRows: string[] = [];

  discrepantItems.forEach((item, idx) => {
    const lineVarianceCents = computeLineVarianceCents(item);
    const unitVarianceCents = item.variance_unit_price_cents;
    const expectedLineTotalCents = Math.round(
      item.expected_quantity * item.expected_unit_price_cents
    );
    const formattedDesc = formatDisputeLineDescription(
      item.invoice_description,
      item.po_sku
    );
    const categoryLabel =
      item.status === 'UNEXPECTED_ITEM' || item.po_sku === null
        ? 'UNCONTRACTED / UNEXPECTED ITEM'
        : item.status.replace(/_/g, ' ');

    const unitSign = unitVarianceCents > 0 ? '+' : '';
    const lineSign = lineVarianceCents > 0 ? '+' : '';

    discrepancyRows.push(
      [
        `  [${idx + 1}] ${formattedDesc}`,
        `      Category:             ${categoryLabel}`,
        `      Contracted Baseline:  ${item.expected_quantity} × ${formatCurrency(item.expected_unit_price_cents, { useGrouping: true })} = ${formatCurrency(expectedLineTotalCents, { useGrouping: true })} (${expectedLineTotalCents}¢)`,
        `      Billed on Invoice:    ${item.invoiced_quantity} × ${formatCurrency(item.invoiced_unit_price_cents, { useGrouping: true })} = ${formatCurrency(item.invoiced_line_total_cents, { useGrouping: true })} (${item.invoiced_line_total_cents}¢)`,
        `      Unit Price Delta:     ${formatCurrency(unitVarianceCents, { showPositiveSign: true, useGrouping: true })} (${unitSign}${unitVarianceCents}¢)`,
        `      Line Total Delta:     ${formatCurrency(lineVarianceCents, { showPositiveSign: true, useGrouping: true })} (${lineSign}${lineVarianceCents}¢)`,
      ].join('\n')
    );
  });

  unmatchedPoItems.forEach((poItem, idx) => {
    const entryIndex = discrepantItems.length + idx + 1;
    const poLineTotalCents =
      poItem.total_cents ?? Math.round(poItem.quantity * poItem.unit_price_cents);
    const formattedDesc = formatDisputeLineDescription(
      poItem.description,
      poItem.sku
    );

    discrepancyRows.push(
      [
        `  [${entryIndex}] ${formattedDesc}`,
        `      Category:             OMITTED CONTRACT LINE (UNMATCHED PO ITEM)`,
        `      Contracted Baseline:  ${poItem.quantity} × ${formatCurrency(poItem.unit_price_cents, { useGrouping: true })} = ${formatCurrency(poLineTotalCents, { useGrouping: true })} (${poLineTotalCents}¢)`,
        `      Billed on Invoice:    0 × ${formatCurrency(0, { useGrouping: true })} = ${formatCurrency(0, { useGrouping: true })} (0¢)`,
        `      Unit Price Delta:     ${formatCurrency(-poItem.unit_price_cents, { showPositiveSign: true, useGrouping: true })} (-${poItem.unit_price_cents}¢)`,
        `      Line Total Delta:     ${formatCurrency(-poLineTotalCents, { showPositiveSign: true, useGrouping: true })} (-${poLineTotalCents}¢)`,
      ].join('\n')
    );
  });

  const itemizedSectionText =
    discrepancyRows.length > 0
      ? discrepancyRows.join('\n\n')
      : '  No line-item pricing or quantity discrepancies detected.';

  const netVarianceSign = totalVarianceCents > 0 ? '+' : '';

  const resolutionDirectiveLines =
    totalVarianceCents > 0
      ? [
          `1. Please issue a formal Credit Memo for ${formatCurrency(totalVarianceCents, { useGrouping: true })} (${totalVarianceCents}¢) against Invoice #${invoiceNumber}, OR submit a revised invoice matching baseline contract ${poNumber} (${formatCurrency(poSubtotalCents, { useGrouping: true })}) before the disputed delta can be released.`,
          `2. Pending receipt of the Credit Memo or revised invoice, ClearMatch Accounts Payable has authorized a Short-Pay Remittance of ${formatCurrency(authorizedShortPayCents, { useGrouping: true })} (${authorizedShortPayCents}¢) in strict accordance with contract ${poNumber}.`,
          `3. Reference Audit Trace ID [${traceId}] on all revised billing documents and remittance correspondence.`,
        ]
      : [
          `1. Please issue a revised invoice or credit memo matching baseline contract ${poNumber} (${formatCurrency(poSubtotalCents, { useGrouping: true })}) before the disputed delta on Invoice #${invoiceNumber} can be released.`,
          `2. Authorized Short-Pay Remittance is set to ${formatCurrency(authorizedShortPayCents, { useGrouping: true })} (${authorizedShortPayCents}¢) pending compliance verification against contract ${poNumber}.`,
          `3. Reference Audit Trace ID [${traceId}] on all revised billing documents and remittance correspondence.`,
        ];

  return [
    '================================================================================',
    '            NOTICE OF INVOICE DISCREPANCY & SHORT-PAY ADJUSTMENT                ',
    '                 CLEARMATCH DETERMINISTIC AP AUDIT CLEARINGHOUSE                ',
    '================================================================================',
    `Date:                   ${issueDate}`,
    `Trace ID:               ${traceId}`,
    `Vendor Name:            ${vendorName}`,
    `Invoice Number:         ${invoiceNumber}`,
    `Baseline PO Number:     ${poNumber}`,
    `Active STP Policy:      ${activePolicy}`,
    '--------------------------------------------------------------------------------',
    'FINANCIAL SUMMARY',
    '--------------------------------------------------------------------------------',
    `  Contracted PO Baseline:               ${formatCurrency(poSubtotalCents, { useGrouping: true })} (${poSubtotalCents}¢)`,
    `  Invoiced Subtotal:                    ${formatCurrency(invoicedSubtotalCents, { useGrouping: true })} (${invoicedSubtotalCents}¢)`,
    `  Net Disputed Variance:                ${formatCurrency(totalVarianceCents, { showPositiveSign: true, useGrouping: true })} (${netVarianceSign}${totalVarianceCents}¢)`,
    `  Authorized Short-Pay Remittance:      ${formatCurrency(authorizedShortPayCents, { useGrouping: true })} (${authorizedShortPayCents}¢)`,
    '--------------------------------------------------------------------------------',
    'ITEMIZED DISCREPANCY BREAKDOWN',
    '--------------------------------------------------------------------------------',
    itemizedSectionText,
    '--------------------------------------------------------------------------------',
    'RESOLUTION DIRECTIVE',
    '--------------------------------------------------------------------------------',
    ...resolutionDirectiveLines,
    '',
    'Authorized Accounts Payable Representative:',
    '',
    resolvedOperatorName,
    '__________________________________________________',
    'Signature / Electronic Audit Stamp',
    '================================================================================',
  ].join('\n');
}
