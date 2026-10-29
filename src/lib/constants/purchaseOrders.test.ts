import { describe, it, expect } from 'vitest';
import {
  PurchaseOrderSchema,
  POLineItemSchema,
  PO_APEX_HARDWARE,
  PO_VERTEX_SAAS,
  PO_CUSTOM_TEMPLATE,
  PURCHASE_ORDER_PRESETS,
} from './purchaseOrders';
import { reconcile } from '../reconcile';
import { ExtractedInvoice } from '../extraction/schemas';

describe('Purchase Order Presets & Schemas', () => {
  it('validates PO_APEX_HARDWARE conforms to schema', () => {
    const result = PurchaseOrderSchema.safeParse(PO_APEX_HARDWARE);
    expect(result.success).toBe(true);
  });

  it('validates PO_VERTEX_SAAS conforms to schema', () => {
    const result = PurchaseOrderSchema.safeParse(PO_VERTEX_SAAS);
    expect(result.success).toBe(true);
  });

  it('validates PO_CUSTOM_TEMPLATE conforms to schema', () => {
    const result = PurchaseOrderSchema.safeParse(PO_CUSTOM_TEMPLATE);
    expect(result.success).toBe(true);
  });

  it('provides all 3 required presets in PURCHASE_ORDER_PRESETS', () => {
    expect(PURCHASE_ORDER_PRESETS).toHaveLength(3);
    const ids = PURCHASE_ORDER_PRESETS.map((p) => p.id);
    expect(ids).toContain('PO-2026-0881');
    expect(ids).toContain('PO-2026-0104');
    expect(ids).toContain('CUSTOM');
  });

  it('rejects purchase order with negative unit price cents', () => {
    const invalidPO = {
      ...PO_APEX_HARDWARE,
      items: [
        {
          ...PO_APEX_HARDWARE.items[0],
          unit_price_cents: -500,
        },
      ],
    };
    const result = PurchaseOrderSchema.safeParse(invalidPO);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('non-negative integer');
    }
  });

  it('rejects purchase order with floating-point cents (Engineering Invariant #2)', () => {
    const invalidPO = {
      ...PO_APEX_HARDWARE,
      items: [
        {
          ...PO_APEX_HARDWARE.items[0],
          unit_price_cents: 12.5,
        },
      ],
    };
    const result = PurchaseOrderSchema.safeParse(invalidPO);
    expect(result.success).toBe(false);
  });

  it('rejects purchase order with empty items array', () => {
    const invalidPO = {
      ...PO_APEX_HARDWARE,
      items: [],
    };
    const result = PurchaseOrderSchema.safeParse(invalidPO);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('At least one contracted line item is required');
    }
  });

  it('reconciles cleanly with Vertex SaaS preset', () => {
    const sampleInvoice: ExtractedInvoice = {
      vendor_name: 'Vertex Cloud Services',
      invoice_number: 'INV-SaaS-9021',
      invoice_date: '2026-10-10',
      currency: 'USD',
      items: [
        {
          raw_description: 'Enterprise Team Seat Licenses (Monthly)',
          quantity: 25,
          unit_price: 40.0,
          tax_rate_percent: 10.0,
        },
        {
          raw_description: 'Dedicated API Compute Units (Block of 1M)',
          quantity: 5,
          unit_price: 150.0,
          tax_rate_percent: 10.0,
        },
      ],
      raw_subtotal: 1750.0,
      raw_tax_total: 175.0,
      raw_grand_total: 1925.0,
      extraction_confidence: 0.99,
      unresolved_ambiguities: [],
    };

    const reconciliation = reconcile(PO_VERTEX_SAAS, sampleInvoice);
    expect(reconciliation.status).toBe('APPROVED');
    expect(reconciliation.total_variance_cents).toBe(0);
    expect(reconciliation.line_items).toHaveLength(2);
  });
});
