import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractInvoiceFromDocument, ExtractionInput } from './gemini';
import sampleInvoiceDrift from '../../../fixtures/invoice_sample_01_drift.json';

// Mock @google/genai
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
      };
    },
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      ARRAY: 'ARRAY',
    },
  };
});

describe('extractInvoiceFromDocument', () => {
  const dummyInput: ExtractionInput = {
    base64Data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    mimeType: 'image/png',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws an error if no API key is provided and environment variables are unset', async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_AP_KEY;
    delete process.env.GOOGLE_API_KEY;

    await expect(extractInvoiceFromDocument(dummyInput)).rejects.toThrow(
      /Gemini API key is required/
    );

    process.env = originalEnv;
  });

  it('successfully extracts and validates invoice payload from Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(sampleInvoiceDrift),
    });

    const result = await extractInvoiceFromDocument(dummyInput, 'fake-api-key');

    expect(result.vendor_name).toBe('Apex Industrial Supplies');
    expect(result.invoice_number).toBe('INV-99412');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].raw_description).toBe('Industrial Hex Bolts M8 (Box of 100)');
    expect(result.items[0].unit_price).toBe(12.95);
    expect(result.extraction_confidence).toBe(0.96);
    expect(result.unresolved_ambiguities).toEqual([]);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences from model response before parsing', async () => {
    const wrappedInFences = `\`\`\`json\n${JSON.stringify(sampleInvoiceDrift)}\n\`\`\``;
    mockGenerateContent.mockResolvedValueOnce({
      text: wrappedInFences,
    });

    const result = await extractInvoiceFromDocument(dummyInput, 'fake-api-key');
    expect(result.invoice_number).toBe('INV-99412');
  });

  it('handles base64 data URLs by stripping the prefix', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(sampleInvoiceDrift),
    });

    const dataUrlInput: ExtractionInput = {
      base64Data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      mimeType: 'image/png',
    };

    await extractInvoiceFromDocument(dataUrlInput, 'fake-api-key');

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            inlineData: {
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
              mimeType: 'image/png',
            },
          }),
        ]),
      })
    );
  });

  it('throws an error if model returns empty text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '',
    });

    await expect(extractInvoiceFromDocument(dummyInput, 'fake-api-key')).rejects.toThrow(
      /empty response/
    );
  });

  it('throws an error if model output fails Zod schema validation', async () => {
    const invalidPayload = {
      ...sampleInvoiceDrift,
      extraction_confidence: 1.5, // Exceeds max 1.0
    };

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(invalidPayload),
    });

    await expect(extractInvoiceFromDocument(dummyInput, 'fake-api-key')).rejects.toThrow(
      /failed schema validation/
    );
  });
});
