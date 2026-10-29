import { NextRequest, NextResponse } from 'next/server';
import { extractInvoiceFromDocument } from '../../../lib/extraction/gemini';
import { ExtractedInvoice } from '../../../lib/extraction/schemas';
import {
  reconcileInvoiceAgainstPO,
  PurchaseOrder,
  ReconciliationResult,
} from '../../../lib/reconcile';
import samplePOFixture from '../../../../fixtures/po_sample_01.json';
import sampleInvoiceDriftFixture from '../../../../fixtures/invoice_sample_01_drift.json';
import {
  PurchaseOrderSchema,
  PO_APEX_HARDWARE,
  PO_VERTEX_SAAS,
  PO_CUSTOM_TEMPLATE,
} from '../../../lib/constants/purchaseOrders';
import {
  TolerancePolicy,
  TolerancePolicySchema,
  TOLERANCE_PRESETS,
} from '../../../lib/types/tolerance';

export interface ReconcileApiResponse {
  success: boolean;
  data?: {
    reconciliation: ReconciliationResult;
    raw_extraction: ExtractedInvoice;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'] as const;
type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

// Known purchase order fixtures registry
const PO_REGISTRY: Record<string, PurchaseOrder> = {
  'po-1001': PO_APEX_HARDWARE,
  'PO-2026-0881': PO_APEX_HARDWARE,
  'po-1002': PO_VERTEX_SAAS,
  'PO-2026-0104': PO_VERTEX_SAAS,
  'po-custom': PO_CUSTOM_TEMPLATE,
  'CUSTOM': PO_CUSTOM_TEMPLATE,
};

// Architecture verification benchmarks
const BENCHMARK_FIXTURES: Record<string, ExtractedInvoice> = {
  verified_match: {
    vendor_name: 'Apex Industrial Supplies',
    invoice_number: 'INV-2026-MATCH',
    invoice_date: '2026-10-14',
    currency: 'USD',
    items: [
      {
        raw_description: 'Industrial Hex Bolts M8 (Box of 100)',
        quantity: 10,
        unit_price: 12.50,
        tax_rate_percent: 10.0,
        raw_item_total: 125.00,
      },
      {
        raw_description: 'Sealed Ball Bearings 22mm',
        quantity: 4,
        unit_price: 45.00,
        tax_rate_percent: 10.0,
        raw_item_total: 180.00,
      },
    ],
    raw_subtotal: 305.00,
    raw_tax_total: 30.50,
    raw_grand_total: 335.50,
    extraction_confidence: 0.98,
    unresolved_ambiguities: [],
  },
  float_trap: {
    vendor_name: 'Apex Industrial Supplies',
    invoice_number: 'INV-2026-FLOAT',
    invoice_date: '2026-10-14',
    currency: 'USD',
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
    extraction_confidence: 0.96,
    unresolved_ambiguities: [],
  },
  ocr_guardrail: {
    vendor_name: 'Apex Industrial Supplies',
    invoice_number: 'INV-2026-SCAN',
    invoice_date: '2026-10-14',
    currency: 'USD',
    items: [
      {
        raw_description: 'Industrial Hex Bolts M8 (Box of 100)',
        quantity: 10,
        unit_price: 12.50,
        tax_rate_percent: 10.0,
        raw_item_total: 125.00,
      },
      {
        raw_description: 'Sealed Ball Bearings 22mm',
        quantity: 4,
        unit_price: 45.00,
        tax_rate_percent: 10.0,
        raw_item_total: 180.00,
      },
    ],
    raw_subtotal: 305.00,
    raw_tax_total: 30.50,
    raw_grand_total: 335.50,
    extraction_confidence: 0.78,
    unresolved_ambiguities: ['Unit price column obscured on Line 1'],
  },
};

/**
 * Normalizes client mime types (e.g. image/jpg -> image/jpeg).
 */
function normalizeMimeType(type: string): string {
  if (type === 'image/jpg') {
    return 'image/jpeg';
  }
  return type;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ReconcileApiResponse>> {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_MULTIPART_REQUEST',
            message: 'Request body must be valid multipart/form-data.',
          },
        },
        { status: 400 }
      );
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string' || !(file instanceof Blob)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSING_FILE',
            message: 'A file field (image/png, image/jpeg, or application/pdf) is required.',
          },
        },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMPTY_FILE',
            message: 'Uploaded file is empty (0 bytes).',
          },
        },
        { status: 400 }
      );
    }

    const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4.0 MB ceiling
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'Uploaded file exceeds the maximum allowed size of 4.0 MB.',
          },
        },
        { status: 413 }
      );
    }

    const normalizedMime = normalizeMimeType(file.type);
    if (!ALLOWED_MIME_TYPES.includes(normalizedMime as AllowedMimeType)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: `Unsupported file type "${file.type}". Supported formats: image/png, image/jpeg, application/pdf.`,
          },
        },
        { status: 415 }
      );
    }

    const poDataRaw = formData.get('po_data');
    let purchaseOrder: PurchaseOrder | undefined;

    if (typeof poDataRaw === 'string' && poDataRaw.trim().length > 0) {
      try {
        const parsed = JSON.parse(poDataRaw);
        const validated = PurchaseOrderSchema.safeParse(parsed);
        if (!validated.success) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: 'INVALID_PO_DATA',
                message: 'Submitted PO baseline failed schema validation.',
                details: validated.error.issues,
              },
            },
            { status: 400 }
          );
        }
        purchaseOrder = validated.data as PurchaseOrder;
      } catch (err) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'MALFORMED_PO_JSON',
              message: 'Failed to parse JSON from po_data.',
              details: err instanceof Error ? err.message : String(err),
            },
          },
          { status: 400 }
        );
      }
    }

    if (!purchaseOrder) {
      const poIdRaw = formData.get('po_id');
      const poId = typeof poIdRaw === 'string' && poIdRaw.trim().length > 0 ? poIdRaw.trim() : 'po-1001';

      purchaseOrder = PO_REGISTRY[poId];
      if (!purchaseOrder) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'PO_NOT_FOUND',
              message: `Purchase Order with ID "${poId}" was not found.`,
            },
          },
          { status: 404 }
        );
      }
    }

    const policyRaw = formData.get('policy');
    let policy: TolerancePolicy = TOLERANCE_PRESETS.STRICT_ZERO;
    if (typeof policyRaw === 'string' && policyRaw.trim().length > 0) {
      try {
        const parsedPolicy = JSON.parse(policyRaw);
        const validatedPolicy = TolerancePolicySchema.safeParse(parsedPolicy);
        if (validatedPolicy.success) {
          policy = validatedPolicy.data;
        }
      } catch {
        // Fallback to STRICT_ZERO
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const isSample = formData.get('sample') === 'true' || formData.get('mock') === 'true';

    let rawExtraction: ExtractedInvoice;
    if (isSample) {
      const scenarioKey = formData.get('scenario');
      if (typeof scenarioKey === 'string' && scenarioKey in BENCHMARK_FIXTURES) {
        rawExtraction = BENCHMARK_FIXTURES[scenarioKey];
      } else {
        rawExtraction = sampleInvoiceDriftFixture as ExtractedInvoice;
      }
    } else {
      try {
        rawExtraction = await extractInvoiceFromDocument({
          base64Data,
          mimeType: normalizedMime as AllowedMimeType,
        });
      } catch (extractionError) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'EXTRACTION_FAILED',
              message:
                extractionError instanceof Error
                  ? extractionError.message
                  : 'Failed to extract invoice data from document.',
              details:
                extractionError instanceof Error
                  ? extractionError.stack
                  : extractionError,
            },
          },
          { status: 422 }
        );
      }
    }

    const reconciliation = reconcileInvoiceAgainstPO(rawExtraction, purchaseOrder, policy);

    return NextResponse.json(
      {
        success: true,
        data: {
          reconciliation,
          raw_extraction: rawExtraction,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred.',
          details: error instanceof Error ? error.stack : error,
        },
      },
      { status: 500 }
    );
  }
}
