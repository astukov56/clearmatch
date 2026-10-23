import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeCsvCell,
  buildReconciliationCSV,
  buildAuditProofPayload,
  exportReconciliationToCSV,
  exportAuditProofJSON,
  triggerDownload,
} from './export';
import { ReconciliationResult } from '../reconcile';
import { ExtractedInvoice } from '../extraction/schemas';

describe('export utilities', () => {
  const sampleReconciliation: ReconciliationResult = {
    po_number: 'PO-2026-0881',
    invoice_number: 'INV-2026-912',
    vendor_name: 'Apex Industrial Supplies',
    status: 'FLAGGED_DRIFT',
    total_variance_cents: -50,
    invoiced_subtotal_cents: 30450,
    line_items: [
      {
        invoice_description: 'Industrial Hex Bolts, M8 (Box of "100")',
        po_sku: 'SKU-001',
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
        po_sku: 'SKU-002',
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
    audit_notes: ['IEEE 754 float drift detected.'],
  };

  const sampleRawExtraction: ExtractedInvoice = {
    vendor_name: 'Apex Industrial Supplies',
    invoice_number: 'INV-2026-912',
    invoice_date: '2026-10-14',
    currency: 'USD',
    extraction_confidence: 0.98,
    unresolved_ambiguities: [],
    items: [
      {
        raw_description: 'Industrial Hex Bolts M8',
        quantity: 10,
        unit_price: 12.79,
        tax_rate_percent: 10,
        raw_item_total: 127.9,
      },
    ],
  };

  describe('escapeCsvCell', () => {
    it('returns empty string for null or undefined', () => {
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
    });

    it('returns unquoted string for clean values', () => {
      expect(escapeCsvCell('SKU-001')).toBe('SKU-001');
      expect(escapeCsvCell(123)).toBe('123');
    });

    it('wraps and escapes strings containing commas, quotes, and newlines', () => {
      expect(escapeCsvCell('Bolts, M8')).toBe('"Bolts, M8"');
      expect(escapeCsvCell('Box of "100"')).toBe('"Box of ""100"""');
      expect(escapeCsvCell("Line1\nLine2")).toBe('"Line1\nLine2"');
    });
  });

  describe('buildReconciliationCSV', () => {
    it('generates standard ERP-ready CSV with formatted currency and summary block', () => {
      const csv = buildReconciliationCSV(
        sampleReconciliation,
        'PO-2026-0881',
        'INV-2026-912',
        {
          poSubtotalCents: 30500,
          traceId: 'LOG-PO-2026-0881',
        }
      );

      const lines = csv.split('\r\n');
      const headerCols = lines[0].split(',');
      expect(headerCols).toEqual([
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
      ]);

      // Unambiguous column positioning
      expect(headerCols[5]).toBe('Unit Price Expected'); // Column F
      expect(headerCols[6]).toBe('Unit Price Invoiced'); // Column G

      // Line 1: Col F is Expected PO Price ($12.50), Col G is Invoiced Price ($12.79)
      expect(lines[1]).toContain(
        '1,SKU-001,"Industrial Hex Bolts, M8 (Box of ""100"")",10,10,$12.50,$12.79,+$0.29,$127.90,PRICE_MISMATCH'
      );

      // Line 2: Col F is Expected PO Price ($45.00), Col G is Invoiced Price ($44.15)
      expect(lines[2]).toContain(
        '2,SKU-002,Sealed Ball Bearings 22mm,4,4,$45.00,$44.15,-$0.85,$176.60,PRICE_MISMATCH'
      );

      // Empty line before summary
      expect(lines[3]).toBe('');

      // Clean vertical key-value summary block
      expect(lines[4]).toBe('SUMMARY METRICS');
      expect(lines[5]).toBe('Invoiced Subtotal,$304.50');
      expect(lines[6]).toBe('PO Subtotal Baseline,$305.00');
      expect(lines[7]).toBe('Total Drift / Variance,-$0.50');
      expect(lines[8]).toBe('Reconciliation Status,FLAGGED_DRIFT');
      expect(lines[9]).toBe('Trace Audit ID,LOG-PO-2026-0881');

      // Audit Trail Log section
      expect(lines[10]).toBe('');
      expect(lines[11]).toBe('AUDIT TRAIL LOG');
      expect(lines[12]).toBe('Audit Note,IEEE 754 float drift detected.');
    });

    it('captures APPROVED_WITH_OVERRIDE status and human override note in CSV', () => {
      const overrideReconciliation: ReconciliationResult = {
        ...sampleReconciliation,
        status: 'APPROVED_WITH_OVERRIDE',
        audit_notes: [
          ...sampleReconciliation.audit_notes,
          '[HUMAN_OVERRIDE] Approved by operator: "Variance within acceptable commercial tolerance (<$1.00)" (2026-10-23T04:21:45.000Z)',
        ],
      };

      const csv = buildReconciliationCSV(
        overrideReconciliation,
        'PO-2026-0881',
        'INV-2026-912'
      );

      expect(csv).toContain('Reconciliation Status,APPROVED_WITH_OVERRIDE');
      expect(csv).toContain('AUDIT TRAIL LOG');
      expect(csv).toContain(
        'Audit Note,"[HUMAN_OVERRIDE] Approved by operator: ""Variance within acceptable commercial tolerance (<$1.00)"" (2026-10-23T04:21:45.000Z)"'
      );
    });
  });

  describe('buildAuditProofPayload', () => {
    it('constructs complete Trust Boundary cryptographic proof', () => {
      const payload = buildAuditProofPayload(
        sampleRawExtraction,
        sampleReconciliation,
        'LOG-PO-2026-0881'
      );

      expect(payload.meta.app).toBe('ClearMatch');
      expect(payload.meta.version).toBe('v0.1-deterministic');
      expect(payload.meta.traceId).toBe('LOG-PO-2026-0881');
      expect(new Date(payload.meta.exportedAt).getTime()).not.toBeNaN();
      expect(payload.untrustedVlmExtraction).toEqual(sampleRawExtraction);
      expect(payload.trustedDeterministicLedger).toEqual(sampleReconciliation);
    });

    it('captures APPROVED_WITH_OVERRIDE and human override audit notes in JSON audit proof', () => {
      const overrideReconciliation: ReconciliationResult = {
        ...sampleReconciliation,
        status: 'APPROVED_WITH_OVERRIDE',
        audit_notes: [
          ...sampleReconciliation.audit_notes,
          '[HUMAN_OVERRIDE] Approved by operator: "Variance within acceptable commercial tolerance (<$1.00)" (2026-10-23T04:21:45.000Z)',
        ],
      };

      const payload = buildAuditProofPayload(
        sampleRawExtraction,
        overrideReconciliation,
        'LOG-PO-2026-0881'
      );

      expect(payload.trustedDeterministicLedger.status).toBe('APPROVED_WITH_OVERRIDE');
      expect(payload.trustedDeterministicLedger.audit_notes).toContain(
        '[HUMAN_OVERRIDE] Approved by operator: "Variance within acceptable commercial tolerance (<$1.00)" (2026-10-23T04:21:45.000Z)'
      );
    });
  });

  describe('browser download triggers', () => {
    let originalWindow: unknown;
    let originalDocument: unknown;

    beforeEach(() => {
      originalWindow = global.window;
      originalDocument = global.document;
    });

    afterEach(() => {
      (global as unknown as { window: unknown }).window = originalWindow;
      (global as unknown as { document: unknown }).document = originalDocument;
      vi.restoreAllMocks();
    });

    it('safely no-ops in non-browser environment', () => {
      // In node without window/document
      (global as unknown as { window: unknown }).window = undefined;
      (global as unknown as { document: unknown }).document = undefined;

      const blob = new Blob(['test'], { type: 'text/plain' });
      expect(() => triggerDownload(blob, 'test.csv')).not.toThrow();
    });

    it('creates anchor and triggers click in browser environment', () => {
      const mockClick = vi.fn();
      const mockAppendChild = vi.fn();
      const mockRemoveChild = vi.fn();
      const mockAnchor = {
        href: '',
        download: '',
        click: mockClick,
      };

      const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/123');
      const mockRevokeObjectURL = vi.fn();

      (global as unknown as { window: unknown }).window = {};
      (global as unknown as { URL: unknown }).URL = {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      };
      (global as unknown as { document: unknown }).document = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: mockAppendChild,
          removeChild: mockRemoveChild,
        },
      };

      exportReconciliationToCSV(sampleReconciliation, 'PO-2026-0881', 'INV-2026-912');
      expect(mockCreateObjectURL).toHaveBeenCalled();
      expect(mockAnchor.download).toMatch(/^reconciliation-INV-2026-912-\d+\.csv$/);
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/123');

      exportAuditProofJSON(
        sampleRawExtraction,
        sampleReconciliation,
        'LOG-PO-2026-0881',
        'INV-2026-912'
      );
      expect(mockAnchor.download).toMatch(/^audit-proof-INV-2026-912-\d+\.json$/);

      triggerDownload(new Blob(['dispute memo']), 'dispute-notice-INV-99412.txt');
      expect(mockAnchor.download).toBe('dispute-notice-INV-99412.txt');
      expect(mockClick).toHaveBeenCalledTimes(3);
    });
  });
});
