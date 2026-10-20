import { GoogleGenAI, Type } from '@google/genai';
import { ExtractedInvoice, ExtractedInvoiceSchema } from './schemas';

export interface ExtractionInput {
  base64Data: string;
  mimeType: 'image/png' | 'image/jpeg' | 'application/pdf';
}

const SYSTEM_INSTRUCTION = `You are a specialized OCR and entity extraction engine for invoices in the ClearMatch financial reconciliation system.

THE DETERMINISTIC SPLIT (STRICT INVARIANT):
- Your sole responsibility is extracting raw text, descriptions, quantities, unit prices, dates, and identifiers exactly as printed.
- You must NEVER calculate, derive, verify, or alter totals, subtotals, tax amounts, or variances.
- Downstream TypeScript domain functions perform all financial arithmetic.
- If an item total, subtotal, or tax total is explicitly printed on the document, record it in the raw_* fields. If not printed, leave it undefined.

FAILURE DEFENSE & AUDITABILITY:
- Assess extraction_confidence as a float between 0.0 and 1.0 based on visual clarity, OCR readability, and document quality.
- If text is blurry, occluded, ambiguous, torn, or has conflicting printed figures, populate unresolved_ambiguities with clear descriptions of each issue.
- If there are no ambiguities, return an empty array [] for unresolved_ambiguities.`;

const EXTRACTION_PROMPT = `Extract all invoice metadata and raw line items from this document into the required JSON schema.
Remember:
1. Do not calculate line totals or taxes; extract raw values as printed.
2. Extract all line items with their raw descriptions, quantities, and unit prices.
3. Provide an accurate extraction_confidence score between 0.0 and 1.0 and document any ambiguities.`;

const invoiceExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    vendor_name: {
      type: Type.STRING,
      description: 'Vendor or supplier business name as printed on the invoice.',
    },
    invoice_number: {
      type: Type.STRING,
      description: 'Invoice number or reference identifier.',
    },
    invoice_date: {
      type: Type.STRING,
      description: 'Invoice date (ISO format YYYY-MM-DD preferred, or as printed).',
    },
    due_date: {
      type: Type.STRING,
      description: 'Payment due date if printed on the invoice.',
    },
    currency: {
      type: Type.STRING,
      description: '3-letter ISO currency code (e.g., USD, AUD, EUR). Defaults to USD.',
    },
    items: {
      type: Type.ARRAY,
      description: 'List of line items extracted directly from the document.',
      items: {
        type: Type.OBJECT,
        properties: {
          raw_description: {
            type: Type.STRING,
            description: 'Exact line item description text as printed.',
          },
          quantity: {
            type: Type.NUMBER,
            description: 'Quantity billed for this item.',
          },
          unit_price: {
            type: Type.NUMBER,
            description: 'Unit price as printed. Do not compute or recalculate.',
          },
          tax_rate_percent: {
            type: Type.NUMBER,
            description: 'Tax rate percentage if printed (e.g. 10.0 for 10%), default 0.',
          },
          raw_item_total: {
            type: Type.NUMBER,
            description: 'Printed line item total if explicitly displayed on the line.',
          },
        },
        required: ['raw_description', 'quantity', 'unit_price'],
      },
    },
    raw_subtotal: {
      type: Type.NUMBER,
      description: 'Subtotal amount as explicitly printed on the document.',
    },
    raw_tax_total: {
      type: Type.NUMBER,
      description: 'Total tax amount as explicitly printed on the document.',
    },
    raw_grand_total: {
      type: Type.NUMBER,
      description: 'Grand total / total due as explicitly printed on the document.',
    },
    extraction_confidence: {
      type: Type.NUMBER,
      description: 'Confidence score between 0.0 and 1.0 indicating OCR certainty.',
    },
    unresolved_ambiguities: {
      type: Type.ARRAY,
      description: 'Audit log of ambiguities, unclear handwriting, or occlusions.',
      items: {
        type: Type.STRING,
      },
    },
  },
  required: [
    'vendor_name',
    'invoice_number',
    'invoice_date',
    'currency',
    'items',
    'extraction_confidence',
    'unresolved_ambiguities',
  ],
};

/**
 * Extracts raw line items and invoice metadata from an invoice image or PDF.
 * Enforces pure entity extraction and validates output against ExtractedInvoiceSchema.
 */
export async function extractInvoiceFromDocument(
  input: ExtractionInput,
  apiKey?: string
): Promise<ExtractedInvoice> {
  const resolvedApiKey =
    apiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GEMINI_AP_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!resolvedApiKey) {
    throw new Error(
      'Gemini API key is required. Pass an apiKey parameter or set GEMINI_API_KEY in the environment.'
    );
  }

  const ai = new GoogleGenAI({ apiKey: resolvedApiKey });

  const cleanBase64 = input.base64Data.includes(';base64,')
    ? input.base64Data.split(';base64,')[1]
    : input.base64Data;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [
      {
        inlineData: {
          data: cleanBase64,
          mimeType: input.mimeType,
        },
      },
      {
        text: EXTRACTION_PROMPT,
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: invoiceExtractionSchema,
      temperature: 0,
    },
  });

  const rawText = response.text;
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('Gemini returned an empty response during invoice extraction.');
  }

  let cleanedJsonText = rawText.trim();
  if (cleanedJsonText.startsWith('```json')) {
    cleanedJsonText = cleanedJsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanedJsonText.startsWith('```')) {
    cleanedJsonText = cleanedJsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedJsonText);
  } catch (parseError) {
    throw new Error(
      `Failed to parse Gemini output as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    );
  }

  const validationResult = ExtractedInvoiceSchema.safeParse(parsed);
  if (!validationResult.success) {
    throw new Error(
      `Invoice extraction failed schema validation: ${validationResult.error.message}`
    );
  }

  return validationResult.data;
}
