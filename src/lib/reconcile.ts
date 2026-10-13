import { dollarsToCents, calculateVarianceCents } from './money';
import { ExtractedInvoice } from './extraction/schemas';

export interface POLineItem {
  line_number: number;
  sku: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  tax_rate_bps: number;
  total_cents: number;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_name: string;
  currency: string;
  issue_date: string;
  items: POLineItem[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
}

export type LineMatchStatus = 
  | 'MATCH' 
  | 'PRICE_MISMATCH' 
  | 'QUANTITY_MISMATCH' 
  | 'UNEXPECTED_ITEM';

export interface ReconciledLineItem {
  invoice_description: string;
  po_sku: string | null;
  status: LineMatchStatus;
  invoiced_quantity: number;
  expected_quantity: number;
  invoiced_unit_price_cents: number;
  expected_unit_price_cents: number;
  variance_unit_price_cents: number;
  invoiced_line_total_cents: number;
}

export type ReconciliationStatus = 
  | 'APPROVED' 
  | 'FLAGGED_DRIFT' 
  | 'REQUIRES_MANUAL_REVIEW';

export interface ReconciliationResult {
  po_number: string;
  invoice_number: string;
  vendor_name: string;
  status: ReconciliationStatus;
  total_variance_cents: number;
  line_items: ReconciledLineItem[];
  unmatched_po_items: POLineItem[];
  audit_notes: string[];
}

const CONFIDENCE_THRESHOLD = 0.85;

/**
 * Finds the index of the matching PO item for a given invoice item description.
 * Priority:
 * 1. Exact description match (case-insensitive, trimmed)
 * 2. SKU substring match within invoice description
 * 3. Best overlapping description match
 */
function findMatchingPOIndex(
  invDesc: string,
  poItems: POLineItem[]
): number {
  const normInvDesc = invDesc.trim().toLowerCase();

  // 1. Exact description match
  const exactIndex = poItems.findIndex(
    (item) => item.description.trim().toLowerCase() === normInvDesc
  );
  if (exactIndex !== -1) return exactIndex;

  // 2. SKU exact match contained in description
  const skuIndex = poItems.findIndex(
    (item) => item.sku && normInvDesc.includes(item.sku.trim().toLowerCase())
  );
  if (skuIndex !== -1) return skuIndex;

  // 3. Substring match (longest overlap wins)
  let bestSubstrIndex = -1;
  let maxOverlap = 0;

  for (let i = 0; i < poItems.length; i++) {
    const normPoDesc = poItems[i].description.trim().toLowerCase();
    if (normInvDesc.includes(normPoDesc) || normPoDesc.includes(normInvDesc)) {
      const overlap = Math.min(normInvDesc.length, normPoDesc.length);
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestSubstrIndex = i;
      }
    }
  }

  return bestSubstrIndex;
}

/**
 * Pure domain reconciliation function:
 * Compares an ExtractedInvoice against an authorized PurchaseOrder using deterministic
 * integer-cent arithmetic.
 */
export function reconcile(
  po: PurchaseOrder,
  invoice: ExtractedInvoice
): ReconciliationResult {
  const auditNotes: string[] = [];
  const reconciledLineItems: ReconciledLineItem[] = [];
  const remainingPOItems: POLineItem[] = [...po.items];

  // Header validations
  const normPoVendor = po.vendor_name.trim().toLowerCase();
  const normInvVendor = invoice.vendor_name.trim().toLowerCase();
  const isVendorMatch = normPoVendor === normInvVendor;
  if (!isVendorMatch) {
    auditNotes.push(
      `Vendor mismatch: PO specifies "${po.vendor_name}" but invoice specifies "${invoice.vendor_name}".`
    );
  }

  const isCurrencyMatch = po.currency.toUpperCase() === invoice.currency.toUpperCase();
  if (!isCurrencyMatch) {
    auditNotes.push(
      `Currency mismatch: PO is in ${po.currency} but invoice is in ${invoice.currency}.`
    );
  }

  if (invoice.unresolved_ambiguities && invoice.unresolved_ambiguities.length > 0) {
    for (const ambiguity of invoice.unresolved_ambiguities) {
      auditNotes.push(`Extraction ambiguity: ${ambiguity}`);
    }
  }

  if (invoice.extraction_confidence < CONFIDENCE_THRESHOLD) {
    auditNotes.push(
      `Low extraction confidence (${Math.round(invoice.extraction_confidence * 100)}%).`
    );
  }

  let hasPriceMismatch = false;
  let hasQuantityMismatch = false;
  let hasUnexpectedItem = false;

  // Reconcile line items
  for (const invItem of invoice.items) {
    const invoicedUnitPriceCents = dollarsToCents(invItem.unit_price);
    const invoicedQuantity = invItem.quantity;
    const invoicedLineTotalCents = Math.round(invoicedQuantity * invoicedUnitPriceCents);

    const matchedIndex = findMatchingPOIndex(invItem.raw_description, remainingPOItems);

    if (matchedIndex !== -1) {
      const matchedPO = remainingPOItems[matchedIndex];
      remainingPOItems.splice(matchedIndex, 1);

      const expectedQuantity = matchedPO.quantity;
      const expectedUnitPriceCents = matchedPO.unit_price_cents;
      const varianceUnitPriceCents = calculateVarianceCents(
        invoicedUnitPriceCents,
        expectedUnitPriceCents
      );

      const priceMatches = invoicedUnitPriceCents === expectedUnitPriceCents;
      const quantityMatches = invoicedQuantity === expectedQuantity;

      let status: LineMatchStatus;
      if (priceMatches && quantityMatches) {
        status = 'MATCH';
      } else if (!priceMatches && quantityMatches) {
        status = 'PRICE_MISMATCH';
        hasPriceMismatch = true;
        const diffSign = varianceUnitPriceCents > 0 ? '+' : '';
        auditNotes.push(
          `Price drift on "${invItem.raw_description}": invoiced at ${invoicedUnitPriceCents}¢ vs expected ${expectedUnitPriceCents}¢ (${diffSign}${varianceUnitPriceCents}¢ variance per unit).`
        );
      } else if (priceMatches && !quantityMatches) {
        status = 'QUANTITY_MISMATCH';
        hasQuantityMismatch = true;
        auditNotes.push(
          `Quantity mismatch on "${invItem.raw_description}": invoiced ${invoicedQuantity} vs expected ${expectedQuantity}.`
        );
      } else {
        // Both price and quantity differ
        status = 'PRICE_MISMATCH';
        hasPriceMismatch = true;
        hasQuantityMismatch = true;
        auditNotes.push(
          `Price mismatch on "${invItem.raw_description}": invoiced at ${invoicedUnitPriceCents}¢ vs expected ${expectedUnitPriceCents}¢.`
        );
        auditNotes.push(
          `Quantity mismatch on "${invItem.raw_description}": invoiced ${invoicedQuantity} vs expected ${expectedQuantity}.`
        );
      }

      reconciledLineItems.push({
        invoice_description: invItem.raw_description,
        po_sku: matchedPO.sku,
        status,
        invoiced_quantity: invoicedQuantity,
        expected_quantity: expectedQuantity,
        invoiced_unit_price_cents: invoicedUnitPriceCents,
        expected_unit_price_cents: expectedUnitPriceCents,
        variance_unit_price_cents: varianceUnitPriceCents,
        invoiced_line_total_cents: invoicedLineTotalCents,
      });
    } else {
      // Unexpected item not present on PO
      hasUnexpectedItem = true;
      const varianceUnitPriceCents = calculateVarianceCents(invoicedUnitPriceCents, 0);

      auditNotes.push(
        `Unexpected item on invoice: "${invItem.raw_description}" not found on purchase order.`
      );

      reconciledLineItems.push({
        invoice_description: invItem.raw_description,
        po_sku: null,
        status: 'UNEXPECTED_ITEM',
        invoiced_quantity: invoicedQuantity,
        expected_quantity: 0,
        invoiced_unit_price_cents: invoicedUnitPriceCents,
        expected_unit_price_cents: 0,
        variance_unit_price_cents: varianceUnitPriceCents,
        invoiced_line_total_cents: invoicedLineTotalCents,
      });
    }
  }

  // Audit notes for any PO items that were not invoiced
  for (const poItem of remainingPOItems) {
    auditNotes.push(
      `Unmatched PO item: "${poItem.description}" (SKU: ${poItem.sku}) was not invoiced.`
    );
  }

  // Compute total variance in integer cents
  const invoicedSubtotalCents = reconciledLineItems.reduce(
    (sum, item) => sum + item.invoiced_line_total_cents,
    0
  );
  const totalVarianceCents = calculateVarianceCents(invoicedSubtotalCents, po.subtotal_cents);

  // Overall reconciliation status determination
  const hasUnmatchedPOItems = remainingPOItems.length > 0;
  const hasAmbiguities = invoice.unresolved_ambiguities.length > 0;
  const isLowConfidence = invoice.extraction_confidence < CONFIDENCE_THRESHOLD;

  let overallStatus: ReconciliationStatus;

  if (
    !isVendorMatch ||
    !isCurrencyMatch ||
    hasUnexpectedItem ||
    hasUnmatchedPOItems ||
    hasQuantityMismatch ||
    hasAmbiguities ||
    isLowConfidence
  ) {
    overallStatus = 'REQUIRES_MANUAL_REVIEW';
  } else if (hasPriceMismatch || totalVarianceCents !== 0) {
    overallStatus = 'FLAGGED_DRIFT';
  } else {
    overallStatus = 'APPROVED';
    if (auditNotes.length === 0) {
      auditNotes.push('Invoice matches purchase order with zero variance.');
    }
  }

  return {
    po_number: po.po_number,
    invoice_number: invoice.invoice_number,
    vendor_name: po.vendor_name,
    status: overallStatus,
    total_variance_cents: totalVarianceCents,
    line_items: reconciledLineItems,
    unmatched_po_items: remainingPOItems,
    audit_notes: auditNotes,
  };
}

export const reconcileInvoice = reconcile;
