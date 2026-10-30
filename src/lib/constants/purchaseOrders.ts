import { z } from 'zod';
import { PurchaseOrder } from '../reconcile';

/**
 * Validation schema for a single line item within an authorized Purchase Order.
 * Enforces integer-only cents for financial integrity.
 */
export const POLineItemSchema = z.object({
  line_number: z.number().int().positive('Line number must be a positive integer'),
  sku: z.string().min(1, 'SKU is required'),
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unit_price_cents: z.number().int().nonnegative('Unit price cents must be a non-negative integer'),
  tax_rate_bps: z.number().int().nonnegative('Tax rate bps must be a non-negative integer'),
  total_cents: z.number().int().nonnegative('Total cents must be a non-negative integer'),
});

/**
 * Validation schema for an authorized Purchase Order baseline contract.
 */
export const PurchaseOrderSchema = z.object({
  id: z.string().min(1, 'PO ID is required'),
  po_number: z.string().min(1, 'PO number is required'),
  vendor_name: z.string().min(1, 'Vendor name is required'),
  currency: z.string().min(3, 'Currency code must be at least 3 characters'),
  issue_date: z.string().min(1, 'Issue date is required'),
  items: z.array(POLineItemSchema).min(1, 'At least one contracted line item is required'),
  subtotal_cents: z.number().int().nonnegative('Subtotal cents must be a non-negative integer'),
  tax_cents: z.number().int().nonnegative('Tax cents must be a non-negative integer'),
  total_cents: z.number().int().nonnegative('Total cents must be a non-negative integer'),
});

export type ValidatedPurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

/**
 * Preset 1: Default Hardware Procurement baseline
 * Apex Industrial Supplies (Bolts & Bearings)
 */
export const PO_APEX_HARDWARE: PurchaseOrder = {
  id: 'po-1001',
  po_number: 'PO-2026-0881',
  vendor_name: 'Apex Industrial Supplies',
  currency: 'USD',
  issue_date: '2026-10-01',
  items: [
    {
      line_number: 1,
      sku: 'NUT-HEX-001',
      description: 'Industrial Hex Bolts M8 (Box of 100)',
      quantity: 10,
      unit_price_cents: 1250,
      tax_rate_bps: 1000,
      total_cents: 12500,
    },
    {
      line_number: 2,
      sku: 'BRG-BALL-004',
      description: 'Sealed Ball Bearings 22mm',
      quantity: 4,
      unit_price_cents: 4500,
      tax_rate_bps: 1000,
      total_cents: 18000,
    },
  ],
  subtotal_cents: 30500,
  tax_cents: 3050,
  total_cents: 33550,
};

/**
 * Preset 2: Cloud SaaS & Compute Services baseline
 * Vertex Cloud Services (Seat Licenses & Compute Units)
 */
export const PO_VERTEX_SAAS: PurchaseOrder = {
  id: 'po-1002',
  po_number: 'PO-2026-0104',
  vendor_name: 'Vertex Cloud Services',
  currency: 'USD',
  issue_date: '2026-10-05',
  items: [
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
  subtotal_cents: 175000,
  tax_cents: 17500,
  total_cents: 192500,
};
 
/**
 * Preset 2B: Synthetic Ingestion Baseline ($1,250.00 / 125,000¢)
 * Targeting synthetic vertex invoices (1x Base Subscription + 8x Provisioned Seats)
 */
export const PO_VERTEX_SYNTHETIC_1250: PurchaseOrder = {
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

/**
 * Preset 3: User-defined Custom Baseline template
 */
export const PO_CUSTOM_TEMPLATE: PurchaseOrder = {
  id: 'po-custom',
  po_number: 'CUSTOM',
  vendor_name: 'Acme Global Logistics',
  currency: 'USD',
  issue_date: '2026-10-15',
  items: [
    {
      line_number: 1,
      sku: 'FRT-EXP-001',
      description: 'Express Freight Courier Dispatch',
      quantity: 2,
      unit_price_cents: 8500,
      tax_rate_bps: 1000,
      total_cents: 17000,
    },
    {
      line_number: 2,
      sku: 'WHS-STOR-002',
      description: 'Palletized Secure Warehouse Storage (Day)',
      quantity: 10,
      unit_price_cents: 1200,
      tax_rate_bps: 1000,
      total_cents: 12000,
    },
  ],
  subtotal_cents: 29000,
  tax_cents: 2900,
  total_cents: 31900,
};

export interface PurchaseOrderPreset {
  id: string;
  name: string;
  label: string;
  description: string;
  po: PurchaseOrder;
}

export const PURCHASE_ORDER_PRESETS: PurchaseOrderPreset[] = [
  {
    id: 'PO-2026-0881',
    name: 'PO-2026-0881',
    label: 'PO-2026-0881 — Apex Industrial Supplies',
    description: 'Hardware: Hex Bolts M8 & Ball Bearings 22mm',
    po: PO_APEX_HARDWARE,
  },
  {
    id: 'PO-2026-0104',
    name: 'PO-2026-0104',
    label: 'PO-2026-0104 — Vertex Cloud Services',
    description: 'SaaS: Seat Licenses & API Compute Units',
    po: PO_VERTEX_SAAS,
  },
  {
    id: 'CUSTOM',
    name: 'CUSTOM',
    label: 'CUSTOM — User-Defined Baseline',
    description: 'Configurable custom line items and contract pricing',
    po: PO_CUSTOM_TEMPLATE,
  },
];

export const DEFAULT_PO_PRESET: PurchaseOrder = PO_APEX_HARDWARE;
