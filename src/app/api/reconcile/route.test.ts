import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, ReconcileApiResponse } from './route';
import sampleInvoiceDrift from '../../../../fixtures/invoice_sample_01_drift.json';
import { PO_VERTEX_SAAS } from '../../../lib/constants/purchaseOrders';

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

  it('uses sample drift fixture when sample flag is set to true without calling extractor', async () => {
    const formData = new FormData();
    const file = new File(['dummy-bytes'], 'invoice.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('sample', 'true');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.reconciliation.status).toBe('FLAGGED_DRIFT');
    expect(mockExtractInvoiceFromDocument).not.toHaveBeenCalled();
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

  it('returns 400 when file is empty (0 bytes)', async () => {
    const formData = new FormData();
    const emptyFile = new File([], 'invoice_empty.png', { type: 'image/png' });
    formData.append('file', emptyFile);
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('EMPTY_FILE');
    expect(json.error?.message).toBe('Uploaded file is empty (0 bytes).');
  });

  it('returns 413 when file exceeds 4.0 MB limit', async () => {
    const formData = new FormData();
    const largeBuffer = new Uint8Array(4 * 1024 * 1024 + 1);
    const largeFile = new File([largeBuffer], 'large_invoice.png', { type: 'image/png' });
    formData.append('file', largeFile);
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(413);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('FILE_TOO_LARGE');
    expect(json.error?.message).toContain('4.0 MB');
  });

  it('correctly executes float_trap benchmark scenario with negative variance', async () => {
    const formData = new FormData();
    const file = new File(['dummy-bytes'], 'float_trap.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('sample', 'true');
    formData.append('scenario', 'float_trap');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.reconciliation.status).toBe('FLAGGED_DRIFT');
    expect(json.data?.reconciliation.total_variance_cents).toBe(-50);
  });

  it('correctly executes ocr_guardrail benchmark scenario with manual review status', async () => {
    const formData = new FormData();
    const file = new File(['dummy-bytes'], 'ocr_guardrail.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('sample', 'true');
    formData.append('scenario', 'ocr_guardrail');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.reconciliation.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(json.data?.raw_extraction.extraction_confidence).toBe(0.78);
    expect(json.data?.raw_extraction.unresolved_ambiguities).toContain(
      'Unit price column obscured on Line 1'
    );
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

  it('correctly uses custom po_data baseline submitted in request', async () => {
    mockExtractInvoiceFromDocument.mockResolvedValueOnce(sampleInvoiceDrift);

    const formData = new FormData();
    const file = new File(['dummy-png-bytes'], 'invoice.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('po_data', JSON.stringify(PO_VERTEX_SAAS));

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.reconciliation.po_number).toBe('PO-2026-0104');
    expect(json.data?.reconciliation.vendor_name).toBe('Vertex Cloud Services');
    // Hardware invoice against Vertex SaaS PO leads to manual review and vendor mismatch
    expect(json.data?.reconciliation.status).toBe('REQUIRES_MANUAL_REVIEW');
    expect(json.data?.reconciliation.unmatched_po_items).toHaveLength(2);
  });

  it('respects submitted policy preset and auto-approves within tolerance', async () => {
    const formData = new FormData();
    const file = new File(['dummy-png-bytes'], 'invoice.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('sample', 'true');
    formData.append('scenario', 'float_trap');
    formData.append(
      'policy',
      JSON.stringify({
        id: 'standard-ap',
        name: 'Standard AP ($1.00 / 100 bps)',
        max_variance_cents: 100,
        max_variance_bps: 100,
        strict_quantity_match: true,
        allow_unexpected_items: false,
      })
    );

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.reconciliation.status).toBe('APPROVED_WITHIN_TOLERANCE');
    expect(json.data?.reconciliation.total_variance_cents).toBe(-50);
  });

  it('retries on 503 and succeeds on subsequent attempt with fallback model', async () => {
    process.env.RETRY_DELAY_OVERRIDE = '1';
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Attempt 1 fails with 503
    mockExtractInvoiceFromDocument.mockRejectedValueOnce({
      status: 503,
      message: 'The model is overloaded. Please try again later.',
    });
    // Attempt 2 succeeds
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
    expect(mockExtractInvoiceFromDocument).toHaveBeenCalledTimes(2);

    // First attempt used gemini-3.5-flash
    expect(mockExtractInvoiceFromDocument).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'gemini-3.5-flash' })
    );
    // Second attempt used candidate gemini-flash-lite-latest
    expect(mockExtractInvoiceFromDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'gemini-flash-lite-latest' })
    );

    expect(json.data?.reconciliation.audit_notes).toContain(
      '[LIVE_VLM: gemini-flash-lite-latest]'
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GEMINI_API] Retrying attempt 1/5 (gemini-3.5-flash) due to')
    );

    consoleWarnSpy.mockRestore();
    delete process.env.RETRY_DELAY_OVERRIDE;
  });

  it('aborts a hanging model attempt on timeout and cascades to next model', async () => {
    process.env.EXTRACTION_TIMEOUT_MS = '25';
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Attempt 1 hangs beyond 25ms
    mockExtractInvoiceFromDocument.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(sampleInvoiceDrift), 200))
    );
    // Attempt 2 succeeds immediately
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
    expect(mockExtractInvoiceFromDocument).toHaveBeenCalledTimes(2);
    expect(json.data?.reconciliation.audit_notes).toContain(
      '[LIVE_VLM: gemini-flash-lite-latest]'
    );

    consoleWarnSpy.mockRestore();
    delete process.env.EXTRACTION_TIMEOUT_MS;
  });

  it('exhausts all candidate attempts on 503 and returns HTTP 503 with regional demand busy message for unknown files', async () => {
    process.env.RETRY_DELAY_OVERRIDE = '1';
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExtractInvoiceFromDocument.mockRejectedValue({
      status: 503,
      message: 'UNAVAILABLE: High regional demand',
    });

    const formData = new FormData();
    const file = new File(['dummy-png-bytes'], 'unknown_invoice.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(json.error?.message).toBe(
      'Model temporarily busy under heavy regional demand. Retried 3 times. Please try again shortly.'
    );
    expect(mockExtractInvoiceFromDocument).toHaveBeenCalledTimes(5);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(4);

    consoleWarnSpy.mockRestore();
    delete process.env.RETRY_DELAY_OVERRIDE;
  });

  it('engages deterministic local fallback for vertex-clean-match-inv-2026-4401.pdf when Gemini returns 503', async () => {
    process.env.RETRY_DELAY_OVERRIDE = '1';
    mockExtractInvoiceFromDocument.mockRejectedValue({
      status: 503,
      message: 'Service Unavailable',
    });

    const formData = new FormData();
    const file = new File(['%PDF-1.4 simulated pdf stream'], 'vertex-clean-match-inv-2026-4401.pdf', {
      type: 'application/pdf',
    });
    formData.append('file', file);
    formData.append('po_id', 'po-1002-vtx1250');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.raw_extraction.invoice_number).toBe('INV-2026-4401');
    expect(json.data?.raw_extraction.vendor_name).toBe('Vertex Cloud Services');
    expect(json.data?.raw_extraction.extraction_confidence).toBe(0.99);
    expect(json.data?.reconciliation.status).toBe('APPROVED');
    expect(json.data?.reconciliation.total_variance_cents).toBe(0);
    expect(json.data?.reconciliation.audit_notes).toContain('[LOCAL_DETERMINISTIC_PARSER]');

    delete process.env.RETRY_DELAY_OVERRIDE;
  });

  it('engages deterministic local fallback for vertex-seat-creep-drift-inv-2026-4402.pdf when Gemini returns 404', async () => {
    process.env.RETRY_DELAY_OVERRIDE = '1';
    mockExtractInvoiceFromDocument.mockRejectedValue({
      status: 404,
      message: 'models/gemini-flash-latest is not found for API version v1beta',
    });

    const formData = new FormData();
    const file = new File(['%PDF-1.4 simulated pdf stream'], 'vertex-seat-creep-drift-inv-2026-4402.pdf', {
      type: 'application/pdf',
    });
    formData.append('file', file);
    formData.append('po_id', 'po-1002-vtx1250');
    formData.append(
      'policy',
      JSON.stringify({
        id: 'allow-unexpected',
        name: 'Allow Unexpected Drift',
        max_variance_cents: 0,
        max_variance_bps: 0,
        strict_quantity_match: true,
        allow_unexpected_items: true,
      })
    );

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.raw_extraction.invoice_number).toBe('INV-2026-4402');
    expect(json.data?.raw_extraction.extraction_confidence).toBe(0.98);
    expect(json.data?.reconciliation.status).toBe('FLAGGED_DRIFT');
    expect(json.data?.reconciliation.total_variance_cents).toBe(8100);
    expect(json.data?.reconciliation.audit_notes).toContain('[LOCAL_DETERMINISTIC_PARSER]');

    delete process.env.RETRY_DELAY_OVERRIDE;
  });

  it('engages deterministic local fallback for Apex Industrial invoice (INV-2026-912)', async () => {
    process.env.RETRY_DELAY_OVERRIDE = '1';
    mockExtractInvoiceFromDocument.mockRejectedValue({
      status: 503,
      message: 'experiencing high demand',
    });

    const formData = new FormData();
    const file = new File(['%PDF-1.4 INV-2026-912 stream'], 'Apex-Industrial-Invoice-912.pdf', {
      type: 'application/pdf',
    });
    formData.append('file', file);
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);
    const json = (await response.json()) as ReconcileApiResponse;

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data?.raw_extraction.invoice_number).toBe('INV-2026-912');
    expect(json.data?.raw_extraction.vendor_name).toBe('Apex Industrial Supplies');
    expect(json.data?.reconciliation.status).toBe('FLAGGED_DRIFT');
    expect(json.data?.reconciliation.total_variance_cents).toBe(-50);
    expect(json.data?.reconciliation.audit_notes).toContain('[LOCAL_DETERMINISTIC_PARSER]');

    delete process.env.RETRY_DELAY_OVERRIDE;
  });

  it('respects GEMINI_MODEL override environment variable', async () => {
    process.env.GEMINI_MODEL = 'gemini-custom-experimental';
    mockExtractInvoiceFromDocument.mockResolvedValueOnce(sampleInvoiceDrift);

    const formData = new FormData();
    const file = new File(['dummy-png-bytes'], 'invoice.png', { type: 'image/png' });
    formData.append('file', file);
    formData.append('po_id', 'po-1001');

    const request = createRequest(formData);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockExtractInvoiceFromDocument).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-custom-experimental' })
    );

    delete process.env.GEMINI_MODEL;
  });
});
