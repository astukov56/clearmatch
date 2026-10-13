import { z } from 'zod';

/**
 * Raw extracted line item as output by Gemini Vision.
 * The model extracts values exactly as printed; conversion to integer cents
 * and math reconciliation happen downstream in pure TypeScript.
 */
export const ExtractedInvoiceItemSchema = z.object({
    raw_description: z.string().min(1, 'Description is required'),
    quantity: z.number().positive('Quantity must be greater than zero'),
    unit_price: z.number().nonnegative('Unit price cannot be negative'),
    tax_rate_percent: z.number().nonnegative().default(0),
    raw_item_total: z.number().nonnegative().optional(),
});

export type ExtractedInvoiceItem = z.infer<typeof ExtractedInvoiceItemSchema>;

/**
 * Full invoice payload extracted from OCR/Vision.
 * Requires explicit auditability flags: extraction_confidence and unresolved_ambiguities.
 */
export const ExtractedInvoiceSchema = z.object({
    vendor_name: z.string().min(1, 'Vendor name is required'),
    invoice_number: z.string().min(1, 'Invoice number is required'),
    invoice_date: z.string().min(1, 'Invoice date is required'),
    due_date: z.string().optional(),
    currency: z.string().length(3, 'Currency must be 3-letter ISO code (e.g. USD, AUD)').default('USD'),
    items: z.array(ExtractedInvoiceItemSchema).min(1, 'At least one line item is required'),
    raw_subtotal: z.number().nonnegative().optional(),
    raw_tax_total: z.number().nonnegative().optional(),
    raw_grand_total: z.number().nonnegative().optional(),
    extraction_confidence: z
        .number()
        .min(0, 'Confidence must be between 0 and 1')
        .max(1, 'Confidence must be between 0 and 1'),
    unresolved_ambiguities: z.array(z.string()).default([]),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;