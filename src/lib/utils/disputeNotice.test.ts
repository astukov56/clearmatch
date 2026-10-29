import { describe, it, expect } from 'vitest';
import { generateDisputeNotice, formatDescription } from './disputeNotice';
import { ReconciliationResult } from '../reconcile';

describe('disputeNotice utility', () => {
  describe('formatDescription', () => {
    it('does not duplicate SKU if description already includes the SKU code', () => {
      const descWithSku = 'Industrial Hex Bolts M8 (Box of 100) (SKU: NUT-HEX-001)';
      expect(formatDescription(descWithSku, 'NUT-HEX-001')).toBe(descWithSku);
      expect(formatDescription(descWithSku, 'nut-hex-001')).toBe(descWithSku);
    });

    it('prefixes [SKU: ...] if description does not include the SKU code', () => {
      const descWithoutSku = 'Industrial Hex Bolts M8 (Box of 100)';
      expect(formatDescription(descWithoutSku, 'NUT-HEX-001')).toBe(
        '[SKU: NUT-HEX-001] Industrial Hex Bolts M8 (Box of 100)'
      );
    });

    it('returns raw description if sku is null or empty', () => {
      const desc = 'Miscellaneous Service Charge';
      expect(formatDescription(desc, null)).toBe(desc);
      expect(formatDescription(desc, undefined)).toBe(desc);
    });
  });

  describe('generateDisputeNotice', () => {
    // Overcharge fixture (+450 cents)
    const sampleLedgerOvercharge: ReconciliationResult = {
      po_number: 'PO-2026-0881',
      invoice_number: 'INV-99412',
      vendor_name: 'Apex Industrial Supplies',
      status: 'FLAGGED_DRIFT',
      total_variance_cents: 450,
      invoiced_subtotal_cents: 30950,
      line_items: [
        {
          invoice_description: 'Industrial Hex Bolts M8 (Box of 100) SKU: NUT-HEX-001',
          po_sku: 'NUT-HEX-001',
          status: 'PRICE_MISMATCH',
          invoiced_quantity: 10,
          expected_quantity: 10,
          invoiced_unit_price_cents: 1295,
          expected_unit_price_cents: 1250,
          variance_unit_price_cents: 45,
          invoiced_line_total_cents: 12950,
        },
        {
          invoice_description: 'Sealed Ball Bearings 22mm',
          po_sku: 'BRG-BALL-004',
          status: 'MATCH',
          invoiced_quantity: 4,
          expected_quantity: 4,
          invoiced_unit_price_cents: 4500,
          expected_unit_price_cents: 4500,
          variance_unit_price_cents: 0,
          invoiced_line_total_cents: 18000,
        },
      ],
      unmatched_po_items: [],
      audit_notes: ['Price drift on "Industrial Hex Bolts M8 (Box of 100)"'],
    };

    // Underbilled fixture (-50 cents, e.g. INV-2026-912)
    const sampleLedgerUnderbilled: ReconciliationResult = {
      po_number: 'PO-2026-0881',
      invoice_number: 'INV-2026-912',
      vendor_name: 'Apex Industrial Supplies',
      status: 'FLAGGED_DRIFT',
      total_variance_cents: -50,
      invoiced_subtotal_cents: 30450,
      line_items: [
        {
          invoice_description: 'Industrial Hex Bolts M8 (Box of 100)',
          po_sku: 'NUT-HEX-001',
          status: 'PRICE_MISMATCH',
          invoiced_quantity: 10,
          expected_quantity: 10,
          invoiced_unit_price_cents: 1279,
          expected_unit_price_cents: 1250,
          variance_unit_price_cents: 29,
          invoiced_line_total_cents: 12790,
        },
        {
          invoice_description: 'Sealed Ball Bearings 22mm',
          po_sku: 'BRG-BALL-004',
          status: 'PRICE_MISMATCH',
          invoiced_quantity: 4,
          expected_quantity: 4,
          invoiced_unit_price_cents: 4415,
          expected_unit_price_cents: 4500,
          variance_unit_price_cents: -85,
          invoiced_line_total_cents: 17660,
        },
      ],
      unmatched_po_items: [],
      audit_notes: ['IEEE 754 drift detected (-$0.50 net)'],
    };

    it('handles overcharge with Credit Memo request and Adjusted Authorized Payable', () => {
      const notice = generateDisputeNotice(sampleLedgerOvercharge, 'PO-2026-0881');

      // Deduplication check: SKU was already in description, so no "[SKU: NUT-HEX-001]" prefix
      expect(notice).not.toContain('[SKU: NUT-HEX-001] Industrial Hex Bolts M8 (Box of 100) SKU: NUT-HEX-001');
      expect(notice).toContain('Industrial Hex Bolts M8 (Box of 100) SKU: NUT-HEX-001');

      // Financial summary checks for overcharge
      expect(notice).toContain('PO Authorized Baseline Subtotal:  $305.00');
      expect(notice).toContain('Invoiced Subtotal Billed:         $309.50');
      expect(notice).toContain('Net Audit Variance:               +$4.50');
      expect(notice).toContain('Requested Credit Memo Amount:     $4.50');
      expect(notice).toContain('Adjusted Authorized Payable:      $305.00');

      // Requested action checks for overcharge
      expect(notice).toContain(
        '1. Please issue a Credit Memo in the amount of $4.50 referencing Invoice #INV-99412.'
      );
      expect(notice).toContain(
        '2. Alternatively, re-issue a corrected invoice reflecting authorized Purchase Order #PO-2026-0881 contract rates.'
      );
      expect(notice).toContain('3. Always reference Audit Trace ID: LOG-PO-2026-0881 on all billing communications.');
    });

    it('handles underbilled/mixed rate drift (INV-2026-912) without $0.00 credit memo and reflects actual billed subtotal', () => {
      const notice = generateDisputeNotice(sampleLedgerUnderbilled, 'PO-2026-0881');

      // Defect 1: Never request "$0.00 Credit Memo" on underbilled invoices
      expect(notice).not.toContain('$0.00 Credit Memo');
      expect(notice).not.toContain('Requested Credit Memo Amount');

      // Defect 2: Financial summary shows Commercial Impact and Current Invoiced Payable ($304.50), not inflated PO subtotal
      expect(notice).toContain('PO Authorized Baseline Subtotal:  $305.00');
      expect(notice).toContain('Invoiced Subtotal Billed:         $304.50');
      expect(notice).toContain('Net Audit Variance:               -$0.50');
      expect(notice).toContain('Commercial Impact:                Contract Rate Discrepancy (Net Underbill / Parity)');
      expect(notice).toContain('Current Invoiced Payable:         $304.50');
      expect(notice).not.toContain('Adjusted Authorized Payable:      $305.00');

      // Defect 3: Dynamic requested action for underbilled
      expect(notice).toContain(
        '1. Please confirm written authorization to settle at the lower invoiced subtotal ($304.50), or re-issue a corrected invoice aligning with authorized Purchase Order #PO-2026-0881 contract unit rates.'
      );
      expect(notice).toContain(
        '2. Note: Contract unit rate deviations are logged for quarterly vendor compliance review.'
      );
      expect(notice).toContain('3. Always reference Audit Trace ID: LOG-PO-2026-0881 on all billing communications.');
    });

    it('handles clean matching invoice without discrepancies', () => {
      const cleanLedger: ReconciliationResult = {
        ...sampleLedgerOvercharge,
        status: 'APPROVED',
        total_variance_cents: 0,
        invoiced_subtotal_cents: 30500,
        line_items: [
          {
            ...sampleLedgerOvercharge.line_items[0],
            status: 'MATCH',
            invoiced_unit_price_cents: 1250,
            variance_unit_price_cents: 0,
            invoiced_line_total_cents: 12500,
          },
        ],
      };

      const notice = generateDisputeNotice(cleanLedger, 'PO-2026-0881');
      expect(notice).toContain('No line item pricing or quantity discrepancies detected.');
      expect(notice).not.toContain('Requested Credit Memo Amount');
      expect(notice).toContain('Commercial Impact:                Contract Rate Discrepancy (Net Underbill / Parity)');
      expect(notice).toContain('Current Invoiced Payable:         $305.00');
    });

    it('accurately enumerates UNEXPECTED_ITEM and UNMATCHED PO items on cross-contract mismatch without undefined SKU', () => {
      const crossContractLedger: ReconciliationResult = {
        po_number: 'PO-2026-0104',
        invoice_number: 'INV-2026-912',
        vendor_name: 'Vertex Cloud Services',
        status: 'REQUIRES_MANUAL_REVIEW',
        total_variance_cents: 129500,
        invoiced_subtotal_cents: 304500,
        line_items: [
          {
            invoice_description: 'Industrial Hex Bolts M8 (Box of 100)',
            po_sku: null,
            status: 'UNEXPECTED_ITEM',
            invoiced_quantity: 10,
            expected_quantity: 0,
            invoiced_unit_price_cents: 1250,
            expected_unit_price_cents: 0,
            variance_unit_price_cents: 1250,
            invoiced_line_total_cents: 12500,
          },
        ],
        unmatched_po_items: [
          {
            line_number: 1,
            sku: 'SAAS-SEAT-01',
            description: 'Enterprise Team Seat Licenses (Monthly)',
            quantity: 25,
            unit_price_cents: 4000,
            tax_rate_bps: 1000,
            total_cents: 100000,
          },
        ],
        audit_notes: ['Vendor mismatch', 'Unexpected item on invoice'],
      };

      const notice = generateDisputeNotice(crossContractLedger, 'PO-2026-0104');

      // Verify unexpected line is formatted without undefined SKU
      expect(notice).toContain('1. Item Description:      Industrial Hex Bolts M8 (Box of 100)');
      expect(notice).toContain('Discrepancy Category:  UNEXPECTED ITEM');
      expect(notice).not.toContain('undefined');
      expect(notice).not.toContain('null');

      // Verify unmatched PO item is enumerated
      expect(notice).toContain('2. Item Description:      [SKU: SAAS-SEAT-01] Enterprise Team Seat Licenses (Monthly)');
      expect(notice).toContain('Discrepancy Category:  UNMATCHED PO ITEM (OMITTED FROM INVOICE)');
      expect(notice).toContain('Billed Quantity:       0 (Contracted / Expected: 25)');
    });

    it('generates complete dispute notice for full cross-contract mismatch (PO-2026-0104 vs INV-2026-912)', () => {
      const fullCrossContract: ReconciliationResult = {
        po_number: 'PO-2026-0104',
        invoice_number: 'INV-2026-912',
        vendor_name: 'Vertex Cloud Services',
        status: 'REQUIRES_MANUAL_REVIEW',
        total_variance_cents: -144550,
        invoiced_subtotal_cents: 30450,
        line_items: [
          {
            invoice_description: 'Industrial Hex Bolts M8 (Box of 100)',
            po_sku: null,
            status: 'UNEXPECTED_ITEM',
            invoiced_quantity: 10,
            expected_quantity: 0,
            invoiced_unit_price_cents: 1279,
            expected_unit_price_cents: 0,
            variance_unit_price_cents: 1279,
            invoiced_line_total_cents: 12790,
          },
          {
            invoice_description: 'Sealed Ball Bearings 22mm',
            po_sku: null,
            status: 'UNEXPECTED_ITEM',
            invoiced_quantity: 4,
            expected_quantity: 0,
            invoiced_unit_price_cents: 4415,
            expected_unit_price_cents: 0,
            variance_unit_price_cents: 4415,
            invoiced_line_total_cents: 17660,
          },
        ],
        unmatched_po_items: [
          {
            line_number: 1,
            sku: 'SAAS-SEAT-01',
            description: 'Enterprise Team Seat Licenses (Monthly)',
            quantity: 25,
            unit_price_cents: 4000,
            tax_rate_bps: 1000,
            total_cents: 100000,
          },
          {
            line_number: 2,
            sku: 'API-COMP-02',
            description: 'Dedicated API Compute Units (Block of 1M)',
            quantity: 5,
            unit_price_cents: 15000,
            tax_rate_bps: 1000,
            total_cents: 75000,
          },
        ],
        audit_notes: [
          'Vendor mismatch: PO specifies "Vertex Cloud Services" but invoice specifies "Apex Industrial Supplies".',
          'Unexpected item on invoice: "Industrial Hex Bolts M8 (Box of 100)" not found on purchase order.',
          'Unexpected item on invoice: "Sealed Ball Bearings 22mm" not found on purchase order.',
          'Unmatched PO item: "Enterprise Team Seat Licenses (Monthly)" (SKU: SAAS-SEAT-01) was not invoiced.',
          'Unmatched PO item: "Dedicated API Compute Units (Block of 1M)" (SKU: API-COMP-02) was not invoiced.',
        ],
      };

      const notice = generateDisputeNotice(fullCrossContract, 'PO-2026-0104');

      // Verify all 4 items are enumerated
      expect(notice).toContain('1. Item Description:      Industrial Hex Bolts M8 (Box of 100)');
      expect(notice).toContain('2. Item Description:      Sealed Ball Bearings 22mm');
      expect(notice).toContain('3. Item Description:      [SKU: SAAS-SEAT-01] Enterprise Team Seat Licenses (Monthly)');
      expect(notice).toContain('4. Item Description:      [SKU: API-COMP-02] Dedicated API Compute Units (Block of 1M)');

      // Verify financial summary displays integer-cent computed baseline and variance
      expect(notice).toContain('PO Authorized Baseline Subtotal:  $1750.00');
      expect(notice).toContain('Invoiced Subtotal Billed:         $304.50');
      expect(notice).toContain('Net Audit Variance:               -$1445.50');
      expect(notice).toContain('Current Invoiced Payable:         $304.50');

      // No undefined or null strings
      expect(notice).not.toContain('undefined');
      expect(notice).not.toContain('null');
    });
  });
});
