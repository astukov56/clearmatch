import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  persistReconciliationRecord,
  recordResolutionEvent,
  fetchRecentReconciliations,
} from './auditService';
import * as clientModule from '../supabase/client';
import { PurchaseOrder, ReconciliationResult } from '../reconcile';

describe('auditService', () => {
  const samplePO: PurchaseOrder = {
    id: 'po-1001',
    po_number: 'PO-2026-0881',
    vendor_name: 'Apex Industrial Supplies',
    currency: 'USD',
    issue_date: '2026-10-01',
    items: [
      {
        line_number: 1,
        sku: 'SKU-001',
        description: 'Industrial Hex Bolts M8',
        quantity: 10,
        unit_price_cents: 1250,
        tax_rate_bps: 1000,
        total_cents: 12500,
      },
    ],
    subtotal_cents: 12500,
    tax_cents: 1250,
    total_cents: 13750,
  };

  const sampleReconciliation: ReconciliationResult = {
    po_number: 'PO-2026-0881',
    invoice_number: 'INV-99412',
    vendor_name: 'Apex Industrial Supplies',
    status: 'APPROVED',
    total_variance_cents: 0,
    invoiced_subtotal_cents: 12500,
    line_items: [],
    unmatched_po_items: [],
    audit_notes: ['Zero variance match.'],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('persistReconciliationRecord', () => {
    it('returns null gracefully when Supabase client is not available (offline mode)', async () => {
      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(null);

      const result = await persistReconciliationRecord(
        sampleReconciliation,
        samplePO,
        null,
        'strict-zero'
      );

      expect(result).toBeNull();
    });

    it('upserts PO and inserts reconciliation run returning trace_id', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'rec-uuid-1', trace_id: 'TRC-PO-2026-0881-123' },
            error: null,
          }),
        }),
      });

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'purchase_orders') {
            return { upsert: mockUpsert };
          }
          if (table === 'reconciliations') {
            return { insert: mockInsert };
          }
          return {};
        }),
      };

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(
        mockClient as unknown as ReturnType<typeof clientModule.getSupabaseClient>
      );

      const result = await persistReconciliationRecord(
        { ...sampleReconciliation, trace_id: 'TRC-PO-2026-0881-123' } as unknown as ReconciliationResult,
        samplePO,
        { extraction_confidence: 0.98 },
        'standard-ap'
      );

      expect(mockUpsert).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          trace_id: 'TRC-PO-2026-0881-123',
          engine_ledger: expect.objectContaining({
            invoiced_subtotal_cents: sampleReconciliation.invoiced_subtotal_cents,
            po_subtotal_cents: samplePO.subtotal_cents,
            total_variance_cents: sampleReconciliation.total_variance_cents,
            tax_cents: samplePO.tax_cents,
            total_cents: samplePO.total_cents,
          }),
        })
      );
      expect(result).toBe('TRC-PO-2026-0881-123');
    });
  });

  describe('recordResolutionEvent', () => {
    it('handles offline mode without throwing', async () => {
      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(null);

      await expect(
        recordResolutionEvent('some-trace-id', 'HUMAN_OVERRIDE', {
          justification: 'Approved variance',
        })
      ).resolves.not.toThrow();
    });

    it('inserts resolution event directly when given a valid UUID', async () => {
      const mockEventInsert = vi.fn().mockResolvedValue({ error: null });
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'audit_resolution_events') {
            return { insert: mockEventInsert };
          }
          return {};
        }),
      };

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(
        mockClient as unknown as ReturnType<typeof clientModule.getSupabaseClient>
      );

      const uuid = '12345678-1234-1234-1234-123456789abc';
      await recordResolutionEvent(uuid, 'HUMAN_OVERRIDE', {
        justification: 'Test justification',
      });

      expect(mockEventInsert).toHaveBeenCalledWith({
        reconciliation_id: uuid,
        event_type: 'HUMAN_OVERRIDE',
        operator_justification: 'Test justification',
        notice_payload: {
          operator_email: 'guest-sandbox@clearmatch.local',
        },
      });
    });

    it('resolves trace_id to reconciliation UUID before inserting event', async () => {
      const mockEventInsert = vi.fn().mockResolvedValue({ error: null });
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'resolved-uuid-456' },
              error: null,
            }),
          }),
        }),
      });

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'reconciliations') {
            return { select: mockSelect };
          }
          if (table === 'audit_resolution_events') {
            return { insert: mockEventInsert };
          }
          return {};
        }),
      };

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(
        mockClient as unknown as ReturnType<typeof clientModule.getSupabaseClient>
      );

      await recordResolutionEvent('LOG-PO-2026-0881-999', 'DISPUTE_NOTICE_GENERATED', {
        noticeText: 'Formal vendor dispute text',
        operatorEmail: 'ap.lead@clearmatch.io',
      });

      expect(mockEventInsert).toHaveBeenCalledWith({
        reconciliation_id: 'resolved-uuid-456',
        event_type: 'DISPUTE_NOTICE_GENERATED',
        operator_justification: null,
        notice_payload: {
          memo: 'Formal vendor dispute text',
          operator_email: 'ap.lead@clearmatch.io',
        },
      });
    });
  });

  describe('fetchRecentReconciliations', () => {
    it('returns empty array when Supabase client is null', async () => {
      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(null);

      const records = await fetchRecentReconciliations();
      expect(records).toEqual([]);
    });

    it('fetches ordered records from reconciliations table', async () => {
      const mockRecords = [
        {
          id: 'rec-1',
          trace_id: 'TRC-1',
          po_number: 'PO-2026-0881',
          invoice_number: 'INV-1',
          status: 'APPROVED',
          created_at: '2026-10-29T00:00:00.000Z',
        },
      ];

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockRecords, error: null }),
            }),
          }),
        }),
      };

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(
        mockClient as unknown as ReturnType<typeof clientModule.getSupabaseClient>
      );

      const records = await fetchRecentReconciliations(10);
      expect(records).toEqual(mockRecords);
    });

    it('filters out transient test schema records (TRC-TEST*, PO-TEST*, Test Vendor)', async () => {
      const mockRecords = [
        {
          id: 'real-1',
          trace_id: 'LOG-PO-2026-0881-123',
          po_number: 'PO-2026-0881',
          vendor_name: 'Apex Industrial Supplies',
        },
        {
          id: 'test-1',
          trace_id: 'TRC-TEST-SCHEMA',
          po_number: 'PO-TEST-SCHEMA',
          vendor_name: 'Test Vendor',
        },
        {
          id: 'test-2',
          trace_id: 'LOG-TEST-456',
          po_number: 'PO-TEST-SCHEMA-2',
          vendor_name: 'Test Vendor',
        },
      ];

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: mockRecords, error: null }),
            }),
          }),
        }),
      };

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue(
        mockClient as unknown as ReturnType<typeof clientModule.getSupabaseClient>
      );

      const records = await fetchRecentReconciliations(10);
      expect(records).toHaveLength(1);
      expect(records[0].trace_id).toBe('LOG-PO-2026-0881-123');
    });
  });
});
