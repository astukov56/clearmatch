import { describe, it, expect } from 'vitest';
import {
  generateDisputeNotice,
  computeLineVarianceCents,
  formatDisputeLineDescription,
} from '../disputeGenerator';
import { PurchaseOrder, ReconciledInvoice } from '../reconcile';

describe('generateDisputeNotice (src/lib/disputeGenerator.ts)', () => {
  const vertexPo: PurchaseOrder = {
    id: 'po-1002-vtx1250',
    po_number: 'PO-2026-0104',
    vendor_name: 'Vertex Cloud Services',
    currency: 'USD',
    issue_date: '2026-10-05',
    items: [
      {
        line_number: 1,
        sku: 'VTX-SUB-BASE',
        description: 'Vertex Platform Enterprise Tier - Base Subscription (Monthly)',
        quantity: 1,
        unit_price_cents: 85000,
        tax_rate_bps: 0,
        total_cents: 85000,
      },
      {
        line_number: 2,
        sku: 'VTX-SEAT-SUPP',
        description: 'Additional Provisioned Seats (Tier 1 Support)',
        quantity: 8,
        unit_price_cents: 5000,
        tax_rate_bps: 0,
        total_cents: 40000,
      },
    ],
    subtotal_cents: 125000,
    tax_cents: 0,
    total_cents: 125000,
  };

  const seatCreepReconciliation: ReconciledInvoice = {
    trace_id: 'LOG-PO-2026-0104-1730000000',
    po_number: 'PO-2026-0104',
    invoice_number: 'INV-2026-4402',
    vendor_name: 'Vertex Cloud Services',
    status: 'FLAGGED_DRIFT',
    po_subtotal_cents: 125000,
    invoiced_subtotal_cents: 133100,
    total_variance_cents: 8100,
    line_items: [
      {
        invoice_description:
          'Vertex Platform Enterprise Tier - Base Subscription (Monthly)',
        po_sku: 'VTX-SUB-BASE',
        status: 'MATCH',
        invoiced_quantity: 1,
        expected_quantity: 1,
        invoiced_unit_price_cents: 85000,
        expected_unit_price_cents: 85000,
        variance_unit_price_cents: 0,
        invoiced_line_total_cents: 85000,
        line_variance_cents: 0,
      },
      {
        invoice_description: 'Additional Provisioned Seats (Tier 1 Support)',
        po_sku: 'VTX-SEAT-SUPP',
        status: 'PRICE_MISMATCH',
        invoiced_quantity: 8,
        expected_quantity: 8,
        invoiced_unit_price_cents: 5450,
        expected_unit_price_cents: 5000,
        variance_unit_price_cents: 450,
        invoiced_line_total_cents: 43600,
        line_variance_cents: 3600,
      },
      {
        invoice_description: 'Uncontracted Cloud Storage Overage (500GB)',
        po_sku: null,
        status: 'UNEXPECTED_ITEM',
        invoiced_quantity: 1,
        expected_quantity: 0,
        invoiced_unit_price_cents: 4500,
        expected_unit_price_cents: 0,
        variance_unit_price_cents: 4500,
        invoiced_line_total_cents: 4500,
        line_variance_cents: 4500,
      },
    ],
    unmatched_po_items: [],
    audit_notes: [
      'Price drift on "Additional Provisioned Seats (Tier 1 Support)": invoiced at 5450¢ vs expected 5000¢ (+450¢ variance per unit).',
      'Unexpected item on invoice: "Uncontracted Cloud Storage Overage (500GB)" not found on purchase order.',
    ],
  };

  it('accurately formats integer-cent amounts ($1,250.00 vs $1,331.00, variance +$81.00) in header and financial summary', () => {
    const notice = generateDisputeNotice(
      seatCreepReconciliation,
      vertexPo,
      'Strict Zero-Drift ($0.00)'
    );

    expect(notice).toContain(
      'NOTICE OF INVOICE DISCREPANCY & SHORT-PAY ADJUSTMENT'
    );
    expect(notice).toContain('Trace ID:               LOG-PO-2026-0104-1730000000');
    expect(notice).toContain('Vendor Name:            Vertex Cloud Services');
    expect(notice).toContain('Invoice Number:         INV-2026-4402');
    expect(notice).toContain('Baseline PO Number:     PO-2026-0104');
    expect(notice).toContain('Active STP Policy:      Strict Zero-Drift ($0.00)');

    // Financial summary integer-cent and dollar formatting ($1,250.00 vs $1,331.00, variance +$81.00)
    expect(notice).toContain('Contracted PO Baseline:               $1,250.00 (125000¢)');
    expect(notice).toContain('Invoiced Subtotal:                    $1,331.00 (133100¢)');
    expect(notice).toContain('Net Disputed Variance:                +$81.00 (+8100¢)');
    expect(notice).toContain('Authorized Short-Pay Remittance:      $1,250.00 (125000¢)');
  });

  it('isolates drifted and uncontracted line items while excluding matched lines', () => {
    const notice = generateDisputeNotice(
      seatCreepReconciliation,
      vertexPo,
      'Strict Zero-Drift ($0.00)'
    );

    // Matched Line 1 ($850.00 base subscription) should be excluded from discrepancy breakdown
    expect(notice).not.toContain(
      'Vertex Platform Enterprise Tier - Base Subscription (Monthly)'
    );

    // Drifted Line 2 (8x @ $54.50 vs $50.00 -> +$36.00 / +3600¢) must be included
    expect(notice).toContain(
      '[1] [SKU: VTX-SEAT-SUPP] Additional Provisioned Seats (Tier 1 Support)'
    );
    expect(notice).toContain('Contracted Baseline:  8 × $50.00 = $400.00 (40000¢)');
    expect(notice).toContain('Billed on Invoice:    8 × $54.50 = $436.00 (43600¢)');
    expect(notice).toContain('Unit Price Delta:     +$4.50 (+450¢)');
    expect(notice).toContain('Line Total Delta:     +$36.00 (+3600¢)');

    // Uncontracted Line 3 ($45.00 storage overage) must be included
    expect(notice).toContain('[2] Uncontracted Cloud Storage Overage (500GB)');
    expect(notice).toContain('Category:             UNCONTRACTED / UNEXPECTED ITEM');
    expect(notice).toContain('Line Total Delta:     +$45.00 (+4500¢)');
  });

  it('places the operator name directly above the signature line (both default and custom operatorName)', () => {
    const defaultNotice = generateDisputeNotice(
      seatCreepReconciliation,
      vertexPo,
      'Strict Zero-Drift ($0.00)'
    );

    expect(defaultNotice).toContain(
      'Please issue a formal Credit Memo for $81.00 (8100¢) against Invoice #INV-2026-4402, OR submit a revised invoice matching baseline contract PO-2026-0104 ($1,250.00) before the disputed delta can be released.'
    );

    const repHeaderIdx = defaultNotice.indexOf(
      'Authorized Accounts Payable Representative:'
    );
    const defaultOpIdx = defaultNotice.indexOf('Accounts Payable Operator');
    const sigLineIdx = defaultNotice.indexOf(
      '__________________________________________________'
    );
    const sigStampIdx = defaultNotice.indexOf('Signature / Electronic Audit Stamp');

    expect(repHeaderIdx).toBeGreaterThan(-1);
    expect(defaultOpIdx).toBeGreaterThan(repHeaderIdx);
    expect(sigLineIdx).toBeGreaterThan(defaultOpIdx);
    expect(sigStampIdx).toBeGreaterThan(sigLineIdx);

    // Custom operator name live-updates above the signature line
    const customNotice = generateDisputeNotice(
      seatCreepReconciliation,
      vertexPo,
      'Strict Zero-Drift ($0.00)',
      'Alex Sterling, Senior AP Analyst'
    );
    const customOpIdx = customNotice.indexOf('Alex Sterling, Senior AP Analyst');
    const customSigLineIdx = customNotice.indexOf(
      '__________________________________________________'
    );
    expect(customOpIdx).toBeGreaterThan(-1);
    expect(customSigLineIdx).toBeGreaterThan(customOpIdx);
  });

  it('computes line variance in integer cents when line_variance_cents is omitted', () => {
    const lineItem = {
      invoice_description: 'Industrial Hex Bolts M8',
      po_sku: 'NUT-HEX-001',
      status: 'PRICE_MISMATCH' as const,
      invoiced_quantity: 10,
      expected_quantity: 10,
      invoiced_unit_price_cents: 1279,
      expected_unit_price_cents: 1250,
      variance_unit_price_cents: 29,
      invoiced_line_total_cents: 12790,
    };

    expect(computeLineVarianceCents(lineItem)).toBe(290);
    expect(formatDisputeLineDescription('Industrial Hex Bolts M8', 'NUT-HEX-001')).toBe(
      '[SKU: NUT-HEX-001] Industrial Hex Bolts M8'
    );
  });
});
