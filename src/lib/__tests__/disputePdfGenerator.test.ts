import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generateDisputeNoticePdf } from '../disputePdfGenerator';
import { PurchaseOrder, ReconciledInvoice } from '../reconcile';

describe('generateDisputeNoticePdf (pdf-lib Printable Corporate Dispute Notice)', () => {
  const vertexPoBaseline: PurchaseOrder = {
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
    po_number: 'PO-2026-0104',
    trace_id: 'LOG-PO-2026-0104-4402',
    invoice_number: 'INV-2026-4402',
    vendor_name: 'Vertex Cloud Services',
    status: 'FLAGGED_DRIFT',
    po_subtotal_cents: 125000,
    invoiced_subtotal_cents: 133100,
    total_variance_cents: 8100,
    line_items: [
      {
        invoice_description: 'Additional Provisioned Seats (Tier 1 Support)',
        po_sku: 'VTX-SEAT-SUPP',
        status: 'PRICE_MISMATCH',
        invoiced_quantity: 9,
        expected_quantity: 8,
        invoiced_unit_price_cents: 5344,
        expected_unit_price_cents: 5000,
        variance_unit_price_cents: 344,
        invoiced_line_total_cents: 48100,
        line_variance_cents: 8100,
      },
    ],
    unmatched_po_items: [],
    audit_notes: ['Line 2 price & quantity mismatch (+8100 cents).'],
  };

  it('generates a valid single-page PDF document with %PDF header', async () => {
    const pdfBytes = await generateDisputeNoticePdf(
      seatCreepReconciliation,
      vertexPoBaseline,
      'Strict Zero-Drift ($0.00)',
      'Alex Stukov — Senior AP Controller'
    );

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.byteLength).toBeGreaterThan(1000);

    const headerStr = Buffer.from(pdfBytes.slice(0, 8)).toString('ascii');
    expect(headerStr).toContain('%PDF-1.');

    const parsedDoc = await PDFDocument.load(pdfBytes);
    expect(parsedDoc.getPageCount()).toBe(1);
    const { width, height } = parsedDoc.getPages()[0].getSize();
    expect(width).toBe(612);
    expect(height).toBe(792);
  });
});

