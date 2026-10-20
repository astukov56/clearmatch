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
  'po-1001': samplePOFixture as PurchaseOrder,
  'PO-2026-0881': samplePOFixture as PurchaseOrder,
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

    const poIdRaw = formData.get('po_id');
    const poId = typeof poIdRaw === 'string' && poIdRaw.trim().length > 0 ? poIdRaw.trim() : 'po-1001';

    const purchaseOrder = PO_REGISTRY[poId];
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

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const isSample = formData.get('sample') === 'true' || formData.get('mock') === 'true';

    let rawExtraction: ExtractedInvoice;
    if (isSample) {
      rawExtraction = sampleInvoiceDriftFixture as ExtractedInvoice;
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

    const reconciliation = reconcileInvoiceAgainstPO(rawExtraction, purchaseOrder);

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
