import { describe, it, expect } from 'vitest';
import { ExtractedInvoiceSchema } from './schemas';
import sampleInvoiceDrift from '../../../fixtures/invoice_sample_01_drift.json';

describe('ExtractedInvoiceSchema', () => {
    it('successfully parses valid extraction fixture with price drift', () => {
        const result = ExtractedInvoiceSchema.safeParse(sampleInvoiceDrift);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.items).toHaveLength(2);
            expect(result.data.items[0].unit_price).toBe(12.95);
            expect(result.data.extraction_confidence).toBe(0.96);
        }
    });

    it('rejects extraction payloads with missing required header fields', () => {
        const invalidPayload = {
            ...sampleInvoiceDrift,
            invoice_number: '',
        };
        const result = ExtractedInvoiceSchema.safeParse(invalidPayload);
        expect(result.success).toBe(false);
    });

    it('rejects line items with non-positive quantities', () => {
        const invalidItemPayload = {
            ...sampleInvoiceDrift,
            items: [
                {
                    raw_description: 'Invalid Item',
                    quantity: 0,
                    unit_price: 10.0,
                },
            ],
        };
        const result = ExtractedInvoiceSchema.safeParse(invalidItemPayload);
        expect(result.success).toBe(false);
    });

    it('enforces confidence bounds between 0.0 and 1.0', () => {
        const outOfBoundsConfidence = {
            ...sampleInvoiceDrift,
            extraction_confidence: 1.25,
        };
        const result = ExtractedInvoiceSchema.safeParse(outOfBoundsConfidence);
        expect(result.success).toBe(false);
    });
});