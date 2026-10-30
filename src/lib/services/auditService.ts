import { getSupabaseClient } from '../supabase/client';
import { PurchaseOrder, ReconciliationResult, ReconciliationStatus } from '../reconcile';
import { ExtractedInvoice } from '../extraction/schemas';
import { GUEST_OPERATOR_EMAIL } from '../supabaseAuth';

export interface PersistedReconciliation {
  id: string;
  trace_id: string;
  po_number: string;
  invoice_number: string;
  vendor_name: string;
  status: ReconciliationStatus;
  extraction_confidence: number;
  invoiced_subtotal_cents: number;
  po_subtotal_cents: number;
  total_variance_cents: number;
  tolerance_policy_id: string;
  raw_vlm_payload: ExtractedInvoice | null;
  engine_ledger: ReconciliationResult & { operator_email?: string };
  audit_notes: string[];
  created_at: string;
  operator_email?: string;
}

export interface ResolutionEventPayload {
  justification?: string;
  noticeText?: string;
  operatorEmail?: string | null;
  invoice?: string;
  operator?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts the attributed operator email from a persisted reconciliation record,
 * falling back to 'guest-sandbox@clearmatch.local' when unauthenticated or legacy.
 */
export function getReconciliationOperatorEmail(rec: PersistedReconciliation): string {
  if (rec.operator_email && rec.operator_email.trim()) {
    return rec.operator_email.trim();
  }

  if (rec.engine_ledger && typeof rec.engine_ledger === 'object') {
    const ledgerEmail = (rec.engine_ledger as { operator_email?: unknown }).operator_email;
    if (typeof ledgerEmail === 'string' && ledgerEmail.trim()) {
      return ledgerEmail.trim();
    }
  } else if (typeof rec.engine_ledger === 'string') {
    try {
      const parsed = JSON.parse(rec.engine_ledger) as { operator_email?: unknown };
      if (typeof parsed?.operator_email === 'string' && parsed.operator_email.trim()) {
        return parsed.operator_email.trim();
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return GUEST_OPERATOR_EMAIL;
}

/**
 * Persists an authorized PO baseline and deterministic reconciliation run into Supabase.
 * Returns the trace_id of the persisted reconciliation record, or null on offline/failure.
 */
export async function persistReconciliationRecord(
  reconciliation: ReconciliationResult,
  po: PurchaseOrder,
  vlmPayload: unknown,
  tolerancePolicyId: string,
  operatorEmail?: string | null
): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  try {
    // 1. Upsert PO baseline contract to satisfy relational integrity
    const poPayload = {
      id: po.id || `po-${po.po_number.toLowerCase().replace(/[^\w-]/g, '')}`,
      po_number: po.po_number,
      vendor_name: po.vendor_name,
      currency: po.currency,
      issue_date: po.issue_date,
      subtotal_cents: po.subtotal_cents,
      tax_cents: po.tax_cents,
      total_cents: po.total_cents,
      items: po.items,
    };

    const { error: poError } = await client
      .from('purchase_orders')
      .upsert(poPayload, { onConflict: 'po_number' });

    if (poError) {
      console.warn('[ClearMatch Supabase] Failed to upsert purchase order baseline:', poError.message);
    }

    // 2. Generate or extract trace ID
    const explicitTraceId = (reconciliation as { trace_id?: string }).trace_id;
    const traceId = explicitTraceId || `LOG-${po.po_number || 'UNKNOWN'}-${Date.now()}`;

    // Extract confidence from VLM payload if present
    let extractionConfidence = 1.0;
    if (
      vlmPayload &&
      typeof vlmPayload === 'object' &&
      'extraction_confidence' in vlmPayload &&
      typeof (vlmPayload as Record<string, unknown>).extraction_confidence === 'number'
    ) {
      extractionConfidence = (vlmPayload as Record<string, unknown>).extraction_confidence as number;
    }

    const resolvedOperatorEmail =
      operatorEmail?.trim() ||
      (reconciliation as { operator_email?: string }).operator_email?.trim() ||
      GUEST_OPERATOR_EMAIL;

    // 3. Construct complete engine ledger snapshot with operator attribution
    const completeEngineLedger = {
      ...reconciliation,
      operator_email: resolvedOperatorEmail,
      invoiced_subtotal_cents: reconciliation.invoiced_subtotal_cents ?? 0,
      po_subtotal_cents: po.subtotal_cents ?? 0,
      total_variance_cents: reconciliation.total_variance_cents ?? 0,
      tax_cents: po.tax_cents ?? 0,
      total_cents: po.total_cents ?? 0,
      line_items: reconciliation.line_items ?? [],
      unmatched_po_items: reconciliation.unmatched_po_items ?? [],
      audit_notes: reconciliation.audit_notes ?? [],
    };

    // 4. Insert reconciliation record
    const { data: recData, error: recError } = await client
      .from('reconciliations')
      .insert({
        trace_id: traceId,
        po_number: po.po_number,
        invoice_number: reconciliation.invoice_number || 'UNKNOWN',
        vendor_name: reconciliation.vendor_name || po.vendor_name,
        status: reconciliation.status,
        extraction_confidence: extractionConfidence,
        invoiced_subtotal_cents: reconciliation.invoiced_subtotal_cents ?? 0,
        po_subtotal_cents: po.subtotal_cents ?? 0,
        total_variance_cents: reconciliation.total_variance_cents ?? 0,
        tolerance_policy_id: tolerancePolicyId,
        raw_vlm_payload: vlmPayload ?? null,
        engine_ledger: completeEngineLedger,
        audit_notes: reconciliation.audit_notes ?? [],
      })
      .select('id, trace_id')
      .single();

    if (recError) {
      console.warn('[ClearMatch Supabase] Failed to insert reconciliation run:', recError.message);
      return null;
    }

    return recData?.trace_id || traceId;
  } catch (err) {
    console.warn('[ClearMatch Supabase] Unexpected error persisting reconciliation record:', err);
    return null;
  }
}

/**
 * Records an audit resolution event (e.g. human variance approval override or vendor dispute dispatch).
 */
export async function recordResolutionEvent(
  reconciliationIdOrTrace: string,
  eventType: 'HUMAN_OVERRIDE' | 'DISPUTE_NOTICE_GENERATED' | 'DISPUTE_PDF_EXPORTED',
  payload: ResolutionEventPayload
): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !reconciliationIdOrTrace) {
    return;
  }

  try {
    let reconciliationId = reconciliationIdOrTrace;

    // If input is not a UUID, resolve it via trace_id
    if (!UUID_REGEX.test(reconciliationIdOrTrace)) {
      const { data, error } = await client
        .from('reconciliations')
        .select('id')
        .eq('trace_id', reconciliationIdOrTrace)
        .limit(1)
        .maybeSingle();

      if (error || !data?.id) {
        console.warn(
          `[ClearMatch Supabase] Could not resolve reconciliation ID for trace: ${reconciliationIdOrTrace}`
        );
        return;
      }
      reconciliationId = data.id;
    }

    const resolvedOperatorEmail =
      payload.operatorEmail?.trim() ||
      payload.operator?.trim() ||
      GUEST_OPERATOR_EMAIL;

    const noticePayloadData: Record<string, string> = {
      operator_email: resolvedOperatorEmail,
      ...(payload.noticeText ? { memo: payload.noticeText } : {}),
      ...(payload.invoice ? { invoice: payload.invoice } : {}),
      ...(payload.operator ? { operator: payload.operator } : {}),
    };

    const { error: eventError } = await client
      .from('audit_resolution_events')
      .insert({
        reconciliation_id: reconciliationId,
        event_type: eventType,
        operator_justification: payload.justification || null,
        notice_payload: noticePayloadData,
      });

    if (eventError) {
      console.warn('[ClearMatch Supabase] Failed to insert audit resolution event:', eventError.message);
    }
  } catch (err) {
    console.warn('[ClearMatch Supabase] Unexpected error recording resolution event:', err);
  }
}

/**
 * Fetches recent reconciliation audit entries ordered by creation date descending.
 */
export async function fetchRecentReconciliations(limit = 15): Promise<PersistedReconciliation[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('reconciliations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[ClearMatch Supabase] Failed to fetch recent reconciliations:', error.message);
      return [];
    }

    const rawRecords = (data || []) as PersistedReconciliation[];
    // Filter out any transient test schema records
    return rawRecords.filter(
      (rec) =>
        !rec.trace_id?.startsWith('TRC-TEST') &&
        !rec.po_number?.startsWith('PO-TEST') &&
        rec.vendor_name !== 'Test Vendor'
    );
  } catch (err) {
    console.warn('[ClearMatch Supabase] Unexpected error fetching recent reconciliations:', err);
    return [];
  }
}
