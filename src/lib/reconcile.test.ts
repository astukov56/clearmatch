import { describe, it, expect } from 'vitest';
import { reconcile, reconcileInvoice, PurchaseOrder } from './reconcile';
import { ExtractedInvoice } from './extraction/schemas';
import samplePOJson from '../../fixtures/po_sample_01.json';
import sampleInvoiceDriftJson from '../../fixtures/invoice_sample_01_drift.json';
import { PO_VERTEX_SAAS } from './constants/purchaseOrders';

const samplePO = samplePOJson as PurchaseOrder;
const sampleInvoiceDrift = sampleInvoiceDriftJson as ExtractedInvoice;

describe('reconcile (ClearMatch Domain Reconciliation)', () => {
  it('correctly reconciles the drift fixture against the PO fixture', () => {
    const result = reconcile(samplePO, sampleInvoiceDrift);

    expect(result.po_number).toBe('PO-2026-0881');
    expect(result.invoice_number).toBe('INV-99412');
    expect(result.vendor_name).toBe('Apex Industrial Supplies');
    expect(result.status).toBe('FLAGGED_DRIFT');
    expect(result.invoiced_subtotal_cents).toBe(30950);
    expect(result.total_variance_cents).toBe(450); // (12.95 - 12.50) * 10 = +450 cents
    expect(result.total_variance_cents).toBe(result.invoiced_subtotal_cents - samplePO.subtotal_cents);
    expect(result.total_variance_cents).not.toBe(result.invoiced_subtotal_cents - samplePO.total_cents);
    expect(result.unmatched_po_items).toHaveLength(0);
    expect(result.line_items).toHaveLength(2);

    // First line item has price drift
    const hexBolts = result.line_items[0];
    expect(hexBolts.invoice_description).toBe('Industrial Hex Bolts M8 (Box of 100)');
    expect(hexBolts.po_sku).toBe('NUT-HEX-001');
    expect(hexBolts.status).toBe('PRICE_MISMATCH');
    expect(hexBolts.invoiced_quantity).toBe(10);
    expect(hexBolts.expected_quantity).toBe(10);
    expect(hexBolts.invoiced_unit_price_cents).toBe(1295);
    expect(hexBolts.expected_unit_price_cents).toBe(1250);
    expect(hexBolts.variance_unit_price_cents).toBe(45);
    expect(hexBolts.invoiced_line_total_cents).toBe(12950);

    // Second line item matches perfectly
    const bearings = result.line_items[1];
    expect(bearings.invoice_description).toBe('Sealed Ball Bearings 22mm');
    expect(bearings.po_sku).toBe('BRG-BALL-004');
    expect(bearings.status).toBe('MATCH');
    expect(bearings.invoiced_quantity).toBe(4);
    expect(bearings.expected_quantity).toBe(4);
    expect(bearings.invoiced_unit_price_cents).toBe(4500);
    expect(bearings.expected_unit_price_cents).toBe(4500);
    expect(bearings.variance_unit_price_cents).toBe(0);
    expect(bearings.invoiced_line_total_cents).toBe(18000);

    // Audit notes should capture price drift
    expect(result.audit_notes.some((n) => n.includes('Price drift on "Industrial Hex Bolts M8 (Box of 100)"'))).toBe(true);
  });

  it('approves an invoice that matches the purchase order exactly', () => {
    const perfectInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      items: [
        {
          raw_description: 'Industrial Hex Bolts M8 (Box of 100)',
          quantity: 10,
          unit_price: 12.5,
          tax_rate_percent: 10.0,
          raw_item_total: 125.0,
        },
        {
          raw_description: 'Sealed Ball Bearings 22mm',
          quantity: 4,
          unit_price: 45.0,
          tax_rate_percent: 10.0,
          raw_item_total: 180.0,
        },
      ],
      raw_subtotal: 305.0,
      raw_tax_total: 30.5,
      raw_grand_total: 335.5,
    };

    const result = reconcile(samplePO, perfectInvoice);

    expect(result.status).toBe('APPROVED');
    expect(result.invoiced_subtotal_cents).toBe(30500);
    expect(result.total_variance_cents).toBe(0);
    expect(result.line_items.every((item) => item.status === 'MATCH')).toBe(true);
    expect(result.unmatched_po_items).toHaveLength(0);
  });

  it('flags QUANTITY_MISMATCH and sets status to REQUIRES_MANUAL_REVIEW', () => {
    const qtyMismatchInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      items: [
        {
          raw_description: 'Industrial Hex Bolts M8 (Box of 100)',
          quantity: 8, // expected 10
          unit_price: 12.5,
          tax_rate_percent: 10.0,
        },
        {
          raw_description: 'Sealed Ball Bearings 22mm',
          quantity: 4,
          unit_price: 45.0,
          tax_rate_percent: 10.0,
        },
      ],
    };

    const result = reconcile(samplePO, qtyMismatchInvoice);

    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.line_items[0].status).toBe('QUANTITY_MISMATCH');
    expect(result.line_items[0].invoiced_quantity).toBe(8);
    expect(result.line_items[0].expected_quantity).toBe(10);
  });

  it('identifies UNEXPECTED_ITEM and sets status to REQUIRES_MANUAL_REVIEW', () => {
    const unexpectedItemInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      items: [
        ...sampleInvoiceDrift.items,
        {
          raw_description: 'Extra Hydraulic Fluid 5L',
          quantity: 1,
          unit_price: 89.99,
          tax_rate_percent: 10.0,
        },
      ],
    };

    const result = reconcile(samplePO, unexpectedItemInvoice);

    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    const unexpectedItem = result.line_items.find((i) => i.status === 'UNEXPECTED_ITEM');
    expect(unexpectedItem).toBeDefined();
    expect(unexpectedItem?.po_sku).toBeNull();
    expect(unexpectedItem?.expected_quantity).toBe(0);
    expect(unexpectedItem?.expected_unit_price_cents).toBe(0);
    expect(unexpectedItem?.invoiced_unit_price_cents).toBe(8999);
  });

  it('detects unmatched PO items when an invoice is missing items', () => {
    const partialInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      items: [
        {
          raw_description: 'Industrial Hex Bolts M8 (Box of 100)',
          quantity: 10,
          unit_price: 12.5,
          tax_rate_percent: 10.0,
        },
      ],
    };

    const result = reconcile(samplePO, partialInvoice);

    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.unmatched_po_items).toHaveLength(1);
    expect(result.unmatched_po_items[0].sku).toBe('BRG-BALL-004');
    expect(result.audit_notes.some((n) => n.includes('was not invoiced'))).toBe(true);
  });

  it('triggers REQUIRES_MANUAL_REVIEW when invoice has unresolved ambiguities', () => {
    const ambiguousInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      unresolved_ambiguities: ['Torn paper across line item 2 tax field'],
    };

    const result = reconcile(samplePO, ambiguousInvoice);

    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.audit_notes.some((n) => n.includes('Torn paper'))).toBe(true);
  });

  it('triggers REQUIRES_MANUAL_REVIEW when extraction confidence is below threshold', () => {
    const lowConfidenceInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      extraction_confidence: 0.65,
    };

    const result = reconcile(samplePO, lowConfidenceInvoice);

    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.audit_notes.some((n) => n.includes('Low extraction confidence (65%)'))).toBe(true);
  });

  it('triggers REQUIRES_MANUAL_REVIEW on vendor or currency mismatch', () => {
    const vendorMismatchInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      vendor_name: 'Different Supplier LLC',
    };

    const result = reconcile(samplePO, vendorMismatchInvoice);
    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.audit_notes.some((n) => n.includes('Vendor mismatch'))).toBe(true);

    const currencyMismatchInvoice: ExtractedInvoice = {
      ...sampleInvoiceDrift,
      currency: 'EUR',
    };

    const resultCurrency = reconcile(samplePO, currencyMismatchInvoice);
    expect(resultCurrency.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(resultCurrency.audit_notes.some((n) => n.includes('Currency mismatch'))).toBe(true);
  });

  it('correctly handles cross-contract mismatch between PO-2026-0104 (Vertex SaaS) and hardware invoice (INV-99412)', () => {
    const result = reconcile(PO_VERTEX_SAAS, sampleInvoiceDrift);

    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(result.audit_notes.some((n) => n.includes('Vendor mismatch'))).toBe(true);

    // Both PO items are unmatched (omitted from invoice)
    expect(result.unmatched_po_items).toHaveLength(2);
    expect(result.unmatched_po_items.map((i) => i.sku)).toEqual(['SAAS-SEAT-01', 'API-COMP-02']);

    // Both invoice items are unexpected (not on PO)
    expect(result.line_items).toHaveLength(2);
    expect(result.line_items.every((i) => i.status === 'UNEXPECTED_ITEM')).toBe(true);
    expect(result.line_items.every((i) => i.po_sku === null)).toBe(true);
  });

  it('correctly handles cross-contract mismatch between PO-2026-0104 (Vertex SaaS) and float-trap hardware invoice (INV-2026-912)', () => {
    const invoice2026_912: ExtractedInvoice = {
      vendor_name: 'Apex Industrial Supplies',
      invoice_number: 'INV-2026-912',
      invoice_date: '2026-10-14',
      currency: 'USD',
      extraction_confidence: 0.96,
      unresolved_ambiguities: [],
      items: [
        {
          raw_description: 'Industrial Hex Bolts M8 (Box of 100)',
          quantity: 10,
          unit_price: 12.79,
          tax_rate_percent: 10.0,
          raw_item_total: 127.90,
        },
        {
          raw_description: 'Sealed Ball Bearings 22mm',
          quantity: 4,
          unit_price: 44.15,
          tax_rate_percent: 10.0,
          raw_item_total: 176.60,
        },
      ],
      raw_subtotal: 304.50,
      raw_tax_total: 30.45,
      raw_grand_total: 334.95,
    };

    const result = reconcile(PO_VERTEX_SAAS, invoice2026_912);

    expect(result.po_number).toBe('PO-2026-0104');
    expect(result.invoice_number).toBe('INV-2026-912');
    expect(result.vendor_name).toBe('Vertex Cloud Services');
    expect(result.status).toBe('REQUIRES_MANUAL_REVIEW');

    // Integer cent verification
    expect(result.invoiced_subtotal_cents).toBe(30450); // $304.50
    expect(PO_VERTEX_SAAS.subtotal_cents).toBe(175000); // $1,750.00
    expect(result.total_variance_cents).toBe(-144550); // 30450 - 175000 = -144550 (-$1,445.50)

    // Unmatched PO items: all contracted items missing from invoice
    expect(result.unmatched_po_items).toHaveLength(2);
    expect(result.unmatched_po_items[0].sku).toBe('SAAS-SEAT-01');
    expect(result.unmatched_po_items[0].quantity).toBe(25);
    expect(result.unmatched_po_items[0].unit_price_cents).toBe(4000);
    expect(result.unmatched_po_items[1].sku).toBe('API-COMP-02');
    expect(result.unmatched_po_items[1].quantity).toBe(5);
    expect(result.unmatched_po_items[1].unit_price_cents).toBe(15000);

    // Line items: all billed items are unexpected
    expect(result.line_items).toHaveLength(2);
    expect(result.line_items[0].status).toBe('UNEXPECTED_ITEM');
    expect(result.line_items[0].po_sku).toBeNull();
    expect(result.line_items[0].invoiced_quantity).toBe(10);
    expect(result.line_items[0].expected_quantity).toBe(0);
    expect(result.line_items[0].invoiced_unit_price_cents).toBe(1279);
    expect(result.line_items[0].expected_unit_price_cents).toBe(0);
    expect(result.line_items[0].invoiced_line_total_cents).toBe(12790);

    expect(result.line_items[1].status).toBe('UNEXPECTED_ITEM');
    expect(result.line_items[1].po_sku).toBeNull();
    expect(result.line_items[1].invoiced_quantity).toBe(4);
    expect(result.line_items[1].expected_quantity).toBe(0);
    expect(result.line_items[1].invoiced_unit_price_cents).toBe(4415);
    expect(result.line_items[1].expected_unit_price_cents).toBe(0);
    expect(result.line_items[1].invoiced_line_total_cents).toBe(17660);

    // Audit notes check
    expect(result.audit_notes.some((n) => n.includes('Vendor mismatch'))).toBe(true);
    expect(result.audit_notes.some((n) => n.includes('Unexpected item on invoice'))).toBe(true);
    expect(result.audit_notes.some((n) => n.includes('Unmatched PO item'))).toBe(true);
  });

  it('exports reconcileInvoice as an alias for reconcile', () => {
    expect(reconcileInvoice).toBe(reconcile);
  });
});
