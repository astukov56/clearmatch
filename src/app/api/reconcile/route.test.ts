import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, ReconcileApiResponse } from './route';
import sampleInvoiceDrift from '../../../../fixtures/invoice_sample_01_drift.json';

// Mock extraction module
const mockExtractInvoiceFromDocument = vi.fn();
vi.mock('../../../lib/extraction/gemini', () => ({
  extractInvoiceFromDocument: (...args: unknown[]) => mockExtractInvoiceFromDocument(...args),
}));

describe('POST /api/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRequest(formData: FormData): NextRequest {
    return new NextRequest('http://localhost:3000/api/reconcile', {
      method: 'POST',
      body: formData,
    });
  }

  it('successfully extracts and reconciles an invoice against po-1001', async () => {
    mockExtractInvoiceFromDocument.mockResolvedValueOnce(sampleInvoiceDrift);

    const formData = new FormData();
    const file = new File(['dummy-png-bytes'], 'invoice.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data?.reconciliation.status).toBe('FLAGGED_DRIFT');
    expect(json.data?.reconciliation.total_variance_cents).toBe(450);
    expect(json.data?.raw_extraction.invoice_number).toBe('INV-99412');
  });

  it('defaults po_id to po-1001 when not provided in form data', async () => {
    mockExtractInvoiceFromDocument.mockResolvedValueOnce(sampleInvoiceDrift);

    const formData = new FormData();
    const file = new File(['dummy-jpeg-bytes'], 'invoice.jpg', { type: 'image/jpeg' });
    formData.append('file', file);

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.reconciliation.po_number).toBe('PO-2026-0881');
  });

  it('normalizes image/jpg MIME type to image/jpeg', async () => {
    mockExtractInvoiceFromDocument.mockResolvedValueOnce(sampleInvoiceDrift);

    const formData = new FormData();
    const file = new File(['dummy-jpg-bytes'], 'invoice.jpg', { type: 'image/jpg' });
    formData.append('file', file);

    const request = createRequest(formData);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockExtractInvoiceFromDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/jpeg',
      })
    );
  });

  it('returns 400 when file field is missing', async () => {
    const formData = new FormData();
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('MISSING_FILE');
  });

  it('returns 415 when file has unsupported MIME type', async () => {
    const formData = new FormData();
    const file = new File(['plain text invoice'], 'invoice.txt', { type: 'text/plain' });
    formData.append('file', file);

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(415);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 404 when po_id does not exist', async () => {
    const formData = new FormData();
    const file = new File(['dummy-pdf-bytes'], 'invoice.pdf', { type: 'application/pdf' });
    formData.append('file', file);
    formData.append('po_id', 'unknown-po-999');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('PO_NOT_FOUND');
  });

  it('returns 422 when extraction fails', async () => {
    mockExtractInvoiceFromDocument.mockRejectedValueOnce(
      new Error('Gemini OCR extraction failed: illegible document')
    );

    const formData = new FormData();
    const file = new File(['dummy-pdf-bytes'], 'invoice.pdf', { type: 'application/pdf' });
    formData.append('file', file);

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('EXTRACTION_FAILED');
    expect(json.error?.message).toContain('illegible document');
  });
});
