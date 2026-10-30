'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { formatCurrency } from '../lib/money';
import {
  ReconciliationResult,
  ReconciledLineItem,
  ReconciliationStatus,
  LineMatchStatus,
  POLineItem,
  PurchaseOrder,
  reconcile,
} from '../lib/reconcile';
import { ExtractedInvoice } from '../lib/extraction/schemas';
import { exportReconciliationToCSV, exportAuditProofJSON } from '../lib/utils/export';
import { generateDisputeNotice } from '../lib/disputeGenerator';
import DisputeResolutionPanel from '../components/DisputeResolutionPanel';
import KeyboardHudBar from '../components/KeyboardHudBar';
import DisputeModal from '../components/DisputeModal';
import PoBaselineModal from '../components/PoBaselineModal';
import AuditLedgerDrawer from '../components/AuditLedgerDrawer';
import OperatorAuthModal from '../components/OperatorAuthModal';
import { useOperatorSession, GUEST_OPERATOR_EMAIL } from '../lib/supabaseAuth';
import { DEFAULT_PO_PRESET, PURCHASE_ORDER_PRESETS } from '../lib/constants/purchaseOrders';
import { TolerancePolicy, TOLERANCE_PRESETS } from '../lib/types/tolerance';
import {
  useOperatorHotkeys,
  getNextTolerancePolicy,
  OperatorCommandLog,
} from '../lib/hooks/useOperatorHotkeys';
import {
  persistReconciliationRecord,
  recordResolutionEvent,
  PersistedReconciliation,
} from '../lib/services/auditService';

interface ReconcileApiResponse {
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

/**
 * Helper using an offscreen <canvas> (1000x700, white background, black monospace text)
 * that draws a realistic invoice matching fixtures/invoice_sample_01_drift.json.
 * 1000px canvas width ensures long line items like "Total: $129.50" are never clipped.
 */
export async function generateSampleInvoicePng(): Promise<File> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Canvas rendering requires a browser environment.'));
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 700;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to acquire 2D canvas context.'));
      return;
    }

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1000, 700);

    // Document border
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 960, 660);

    // Black monospace text
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    // Header: "INVOICE: INV-99412 | PO: PO-2026-0881"
    ctx.font = 'bold 22px monospace';
    ctx.fillText('INVOICE: INV-99412 | PO: PO-2026-0881', 50, 50);

    // Vendor: "Apex Industrial Supplies"
    ctx.font = '16px monospace';
    ctx.fillText('Vendor: Apex Industrial Supplies', 50, 110);

    // Date: "2026-10-14 | Currency: USD"
    ctx.fillText('Date: 2026-10-14 | Currency: USD', 50, 145);

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, 185);
    ctx.lineTo(950, 185);
    ctx.stroke();

    // Line 1: "Industrial Hex Bolts M8 (Box of 100) | Qty: 10 | Unit Price: $12.95 | Total: $129.50"
    ctx.font = '15px monospace';
    ctx.fillText(
      'Line 1: Industrial Hex Bolts M8 (Box of 100) | Qty: 10 | Unit Price: $12.95 | Total: $129.50',
      50,
      220
    );

    // Line 2: "Sealed Ball Bearings 22mm | Qty: 4 | Unit Price: $45.00 | Total: $180.00"
    ctx.fillText(
      'Line 2: Sealed Ball Bearings 22mm | Qty: 4 | Unit Price: $45.00 | Total: $180.00',
      50,
      265
    );

    // Divider
    ctx.beginPath();
    ctx.moveTo(50, 315);
    ctx.lineTo(950, 315);
    ctx.stroke();

    // Footer: "Subtotal: $309.50 | Tax (10%): $30.95 | Total: $340.45"
    ctx.font = 'bold 16px monospace';
    ctx.fillText(
      'Footer: Subtotal: $309.50 | Tax (10%): $30.95 | Total: $340.45',
      50,
      345
    );

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to generate PNG blob from canvas.'));
        return;
      }
      const file = new File([blob], 'invoice_sample_01_drift.png', {
        type: 'image/png',
      });
      resolve(file);
    }, 'image/png');
  });
}

/**
 * Baseline contract definition for Vertex Cloud Services (PO-2026-0104)
 * Baseline: $1,250.00 (125,000¢) • Zero B2B Tax
 */
const PO_VERTEX_SYNTHETIC_1250: PurchaseOrder = {
  id: 'po-1002-vtx1250',
  po_number: 'PO-2026-0104',
  vendor_name: 'Vertex Cloud Services',
  currency: 'USD',
  issue_date: '2026-10-05',
  items: [
    {
      line_number: 1,
      sku: 'VTX-SUB-BASE',
      description: 'Vertex Platform Enterprise Tier - Base Subscription (Monthly)',
      quantity: 1,
      unit_price_cents: 85000,
      tax_rate_bps: 0,
      total_cents: 85000,
    },
    {
      line_number: 2,
      sku: 'VTX-SEAT-SUPP',
      description: 'Additional Provisioned Seats (Tier 1 Support)',
      quantity: 8,
      unit_price_cents: 5000,
      tax_rate_bps: 0,
      total_cents: 40000,
    },
  ],
  subtotal_cents: 125000,
  tax_cents: 0,
  total_cents: 125000,
};

export default function ClearMatchOperatorWorkbench() {
  const [activePO, setActivePO] = useState<PurchaseOrder>(DEFAULT_PO_PRESET);
  const [tolerancePolicy, setTolerancePolicy] = useState<TolerancePolicy>(
    TOLERANCE_PRESETS.STRICT_ZERO
  );
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [errorBanner, setErrorBanner] = useState<{ code: string; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'ledger' | 'trust_boundary'>('ledger');

  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [rawExtraction, setRawExtraction] = useState<ExtractedInvoice | null>(null);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const [isOverrideInputOpen, setIsOverrideInputOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState(
    'Approved: Variance within operational tolerance (<$1.00)'
  );
  const [isAuditLedgerOpen, setIsAuditLedgerOpen] = useState(false);
  const [currentTraceId, setCurrentTraceId] = useState<string | null>(null);
  const [loadingSyntheticFile, setLoadingSyntheticFile] = useState<'clean' | 'drift' | null>(null);
  const [lastHotkeyCommand, setLastHotkeyCommand] = useState<OperatorCommandLog | null>(null);
  const [isHotkeyHelpOpen, setIsHotkeyHelpOpen] = useState(false);
  const [isOperatorAuthModalOpen, setIsOperatorAuthModalOpen] = useState(false);
  const { user, signOut } = useOperatorSession();
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isHudVisible, setIsHudVisible] = useState<boolean>(true);
  const [copiedIdKey, setCopiedIdKey] = useState<'invoice' | 'po' | 'trace' | null>(null);
  const [executionLatencyMs, setExecutionLatencyMs] = useState<number | null>(null);
  const [extractionSourceBadge, setExtractionSourceBadge] = useState<
    'LIVE_VLM' | 'BENCHMARK' | 'LOCAL_FALLBACK'
  >('BENCHMARK');

  // Hydrate persistent theme and HUD visibility from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedTheme = window.localStorage.getItem('clearmatch_theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }
    const savedHud = window.localStorage.getItem('clearmatch_hud_visible');
    if (savedHud === 'false') {
      setIsHudVisible(false);
    } else if (savedHud === 'true') {
      setIsHudVisible(true);
    }
  }, []);

  const handleToggleTheme = useCallback((): 'light' | 'dark' => {
    let resolvedNext: 'light' | 'dark' = 'dark';
    setTheme((prev) => {
      resolvedNext = prev === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('clearmatch_theme', resolvedNext);
        document.documentElement.classList.toggle('dark', resolvedNext === 'dark');
      }
      return resolvedNext;
    });
    return resolvedNext;
  }, []);

  const handleToggleHudVisible = useCallback((): boolean => {
    let resolvedVisible = true;
    setIsHudVisible((prev) => {
      resolvedVisible = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('clearmatch_hud_visible', String(resolvedVisible));
      }
      return resolvedVisible;
    });
    return resolvedVisible;
  }, []);

  const handleQuickCopyIdentifier = useCallback(
    async (key: 'invoice' | 'po' | 'trace', value: string) => {
      if (!value) return;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(value);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = value;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        setCopiedIdKey(key);
        setTimeout(() => setCopiedIdKey(null), 1600);
      } catch {
        setCopiedIdKey(null);
      }
    },
    []
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInspectRun = useCallback((record: PersistedReconciliation) => {
    // 1. Extract engine ledger safely (handling both jsonb objects and json strings)
    let rawLedger: Record<string, unknown> | null = null;
    if (record.engine_ledger && typeof record.engine_ledger === 'object') {
      rawLedger = record.engine_ledger as unknown as Record<string, unknown>;
    } else if (typeof record.engine_ledger === 'string') {
      try {
        rawLedger = JSON.parse(record.engine_ledger);
      } catch {
        rawLedger = null;
      }
    }

    // 2. Hydrate complete ReconciledInvoice / ReconciliationResult structure with strict integer fallbacks
    const lineItemsRaw = (rawLedger?.line_items as unknown[]) ?? [];
    const hydratedLineItems: ReconciledLineItem[] = lineItemsRaw.map((itemRaw) => {
      const item = (itemRaw && typeof itemRaw === 'object' ? itemRaw : {}) as Record<string, unknown>;
      return {
        invoice_description: typeof item.invoice_description === 'string' ? item.invoice_description : 'Item',
        po_sku: typeof item.po_sku === 'string' ? item.po_sku : null,
        status: (typeof item.status === 'string' ? item.status : 'MATCH') as LineMatchStatus,
        invoiced_quantity: typeof item.invoiced_quantity === 'number' ? item.invoiced_quantity : 1,
        expected_quantity: typeof item.expected_quantity === 'number' ? item.expected_quantity : 1,
        invoiced_unit_price_cents: typeof item.invoiced_unit_price_cents === 'number' ? item.invoiced_unit_price_cents : 0,
        expected_unit_price_cents: typeof item.expected_unit_price_cents === 'number' ? item.expected_unit_price_cents : 0,
        variance_unit_price_cents: typeof item.variance_unit_price_cents === 'number' ? item.variance_unit_price_cents : 0,
        invoiced_line_total_cents: typeof item.invoiced_line_total_cents === 'number' ? item.invoiced_line_total_cents : 0,
      };
    });

    const unmatchedPoItemsRaw = (rawLedger?.unmatched_po_items as unknown[]) ?? [];
    const hydratedUnmatchedItems: POLineItem[] = unmatchedPoItemsRaw.map((itemRaw, idx) => {
      const item = (itemRaw && typeof itemRaw === 'object' ? itemRaw : {}) as Record<string, unknown>;
      return {
        line_number: typeof item.line_number === 'number' ? item.line_number : idx + 1,
        sku: typeof item.sku === 'string' ? item.sku : `SKU-${idx + 1}`,
        description: typeof item.description === 'string' ? item.description : 'PO Item',
        quantity: typeof item.quantity === 'number' ? item.quantity : 1,
        unit_price_cents: typeof item.unit_price_cents === 'number' ? item.unit_price_cents : 0,
        tax_rate_bps: typeof item.tax_rate_bps === 'number' ? item.tax_rate_bps : 1000,
        total_cents: typeof item.total_cents === 'number' ? item.total_cents : 0,
      };
    });

    const auditNotesRaw = (rawLedger?.audit_notes as unknown[]) ?? (record.audit_notes as unknown[]) ?? [];
    const hydratedAuditNotes: string[] = auditNotesRaw.map((note) => String(note));

    const totalVarianceCents =
      typeof rawLedger?.total_variance_cents === 'number'
        ? rawLedger.total_variance_cents
        : record.total_variance_cents ?? 0;

    const invoicedSubtotalCents =
      typeof rawLedger?.invoiced_subtotal_cents === 'number'
        ? rawLedger.invoiced_subtotal_cents
        : record.invoiced_subtotal_cents ?? 0;

    const hydratedReconciliation: ReconciliationResult = {
      po_number: (rawLedger?.po_number as string) || record.po_number || 'UNKNOWN',
      trace_id: record.trace_id,
      invoice_number: (rawLedger?.invoice_number as string) || record.invoice_number || 'UNKNOWN',
      vendor_name: (rawLedger?.vendor_name as string) || record.vendor_name || 'UNKNOWN',
      status: ((rawLedger?.status as string) || record.status || 'APPROVED') as ReconciliationStatus,
      total_variance_cents: totalVarianceCents,
      invoiced_subtotal_cents: invoicedSubtotalCents,
      line_items: hydratedLineItems,
      unmatched_po_items: hydratedUnmatchedItems,
      audit_notes: hydratedAuditNotes,
    };

    setReconciliation(hydratedReconciliation);

    // 3. Restore raw VLM payload if present
    let rawPayload = record.raw_vlm_payload;
    if (typeof rawPayload === 'string') {
      try {
        rawPayload = JSON.parse(rawPayload);
      } catch {
        rawPayload = null;
      }
    }
    setRawExtraction(rawPayload);

    setCurrentTraceId(record.trace_id);
    setSelectedFile(null);
    setErrorBanner(null);
    setIsOverrideInputOpen(false);

    // 4. Match authorized PO preset or reconstruct complete PO baseline
    const matchingPreset = PURCHASE_ORDER_PRESETS.find(
      (preset) =>
        preset.po.po_number === record.po_number &&
        preset.po.subtotal_cents === record.po_subtotal_cents
    );
    if (matchingPreset) {
      setActivePO(matchingPreset.po);
    } else {
      const poSubtotal =
        typeof rawLedger?.po_subtotal_cents === 'number'
          ? rawLedger.po_subtotal_cents
          : record.po_subtotal_cents ?? 0;
      const poTax =
        typeof rawLedger?.tax_cents === 'number'
          ? rawLedger.tax_cents
          : Math.round((poSubtotal * 1000) / 10000);
      const poTotal =
        typeof rawLedger?.total_cents === 'number'
          ? rawLedger.total_cents
          : poSubtotal + poTax;

      setActivePO({
        id: `po-${(record.po_number || 'unknown').toLowerCase().replace(/[^\w-]/g, '')}`,
        po_number: record.po_number || 'UNKNOWN',
        vendor_name: record.vendor_name || 'UNKNOWN',
        currency: 'USD',
        issue_date: new Date().toISOString().split('T')[0],
        items: [
          ...hydratedLineItems.map((li, idx) => ({
            line_number: idx + 1,
            sku: li.po_sku || `SKU-${idx + 1}`,
            description: li.invoice_description,
            quantity: li.expected_quantity || li.invoiced_quantity,
            unit_price_cents: li.expected_unit_price_cents || li.invoiced_unit_price_cents,
            tax_rate_bps: 1000,
            total_cents:
              (li.expected_quantity || li.invoiced_quantity) *
              (li.expected_unit_price_cents || li.invoiced_unit_price_cents),
          })),
          ...hydratedUnmatchedItems,
        ],
        subtotal_cents: poSubtotal,
        tax_cents: poTax,
        total_cents: poTotal,
      });
    }

    // 5. Match tolerance policy if available
    const matchingPolicy = Object.values(TOLERANCE_PRESETS).find(
      (p) => p.id === record.tolerance_policy_id
    );
    if (matchingPolicy) {
      setTolerancePolicy(matchingPolicy);
    }

    setIsAuditLedgerOpen(false);
    setActiveTab('ledger');
  }, []);

  const handleSelectTolerancePolicy = useCallback(
    (preset: TolerancePolicy) => {
      setTolerancePolicy(preset);
      setIsOverrideInputOpen(false);
      if (rawExtraction) {
        const updated = reconcile(activePO, rawExtraction, preset);
        setReconciliation(updated);
      }
    },
    [rawExtraction, activePO]
  );

  const handleApplyPO = useCallback(
    (newPO: PurchaseOrder) => {
      setActivePO(newPO);
      setIsOverrideInputOpen(false);
      setOverrideReason('Approved: Variance within operational tolerance (<$1.00)');
      setErrorBanner(null);

      if (rawExtraction) {
        const newReconciliation = reconcile(newPO, rawExtraction, tolerancePolicy);
        setReconciliation(newReconciliation);
      } else {
        setReconciliation(null);
      }
    },
    [rawExtraction, tolerancePolicy]
  );

  const executeReconciliation = useCallback(
    async (
      fileToSubmit: File,
      isSample = false,
      scenario?: string,
      targetPO?: PurchaseOrder
    ) => {
      setIsLoading(true);
      setErrorBanner(null);
      setLoadingText(
        isSample
          ? `Executing benchmark scenario [${scenario || 'default'}]...`
          : 'Running Gemini Flash OCR entity extraction...'
      );

      const effectivePO = targetPO || activePO;
      const startTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

      try {
        const formData = new FormData();
        formData.append('file', fileToSubmit);
        formData.append('po_id', effectivePO.id);
        formData.append('po_data', JSON.stringify(effectivePO));
        formData.append('policy', JSON.stringify(tolerancePolicy));
        if (isSample) {
          formData.append('sample', 'true');
          if (scenario) {
            formData.append('scenario', scenario);
          }
        }

        const response = await fetch('/api/reconcile', {
          method: 'POST',
          body: formData,
        });

        const result = (await response.json()) as ReconcileApiResponse;

        if (!response.ok || !result.success || !result.data) {
          const code = result.error?.code || `HTTP_${response.status}`;
          const rawMessage =
            result.error?.message || 'Reconciliation service encountered an unexpected error.';

          const isUnavailable =
            response.status === 503 ||
            response.status === 429 ||
            code === 'SERVICE_UNAVAILABLE' ||
            code === 'HTTP_503' ||
            rawMessage.includes('503') ||
            rawMessage.includes('429') ||
            rawMessage.includes('UNAVAILABLE') ||
            rawMessage.includes('RESOURCE_EXHAUSTED') ||
            rawMessage.includes('heavy regional demand') ||
            rawMessage.includes('temporarily busy') ||
            (rawMessage.trim().startsWith('{') &&
              (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')));

          const message = isUnavailable
            ? 'Model temporarily busy under heavy regional demand. Retried 3 times. Please try again shortly.'
            : rawMessage;

          setErrorBanner({ code: isUnavailable ? 'SERVICE_UNAVAILABLE' : code, message });
          return;
        }

        const rec = result.data.reconciliation;
        const raw = result.data.raw_extraction;
        const elapsedMs = Math.max(
          1,
          Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTimeMs)
        );
        setExecutionLatencyMs(elapsedMs);

        const notesJoined = (rec.audit_notes ?? []).join(' ');
        if (isSample) {
          setExtractionSourceBadge('BENCHMARK');
        } else if (notesJoined.includes('[LOCAL_DETERMINISTIC_PARSER]')) {
          setExtractionSourceBadge('LOCAL_FALLBACK');
        } else {
          setExtractionSourceBadge('LIVE_VLM');
        }

        const generatedTraceId = `LOG-${effectivePO.po_number}-${Date.now()}`;
        setCurrentTraceId(generatedTraceId);

        setReconciliation({ ...rec, trace_id: generatedTraceId });
        setRawExtraction(raw);

        // Background non-blocking persistence to Supabase with Operator Identity Attribution
        persistReconciliationRecord(
          { ...rec, trace_id: generatedTraceId } as ReconciliationResult,
          effectivePO,
          raw,
          tolerancePolicy.id,
          user?.email ?? GUEST_OPERATOR_EMAIL
        ).catch(() => {});
      } catch (err) {
        const rawMessage =
          err instanceof Error ? err.message : 'Unable to connect to reconciliation API endpoint.';
        const isUnavailable =
          rawMessage.includes('503') ||
          rawMessage.includes('429') ||
          rawMessage.includes('UNAVAILABLE') ||
          rawMessage.includes('RESOURCE_EXHAUSTED') ||
          rawMessage.includes('heavy regional demand') ||
          rawMessage.includes('temporarily busy') ||
          (rawMessage.trim().startsWith('{') &&
            (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')));

        setErrorBanner({
          code: isUnavailable ? 'SERVICE_UNAVAILABLE' : 'NETWORK_ERROR',
          message: isUnavailable
            ? 'Model temporarily busy under heavy regional demand. Retried 3 times. Please try again shortly.'
            : rawMessage,
        });
      } finally {
        setIsLoading(false);
        setLoadingText('');
      }
    },
    [activePO, tolerancePolicy, user?.email]
  );

  const handleFileSelection = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setReconciliation(null);
      setRawExtraction(null);
      setErrorBanner(null);
      setIsOverrideInputOpen(false);
      setOverrideReason('Approved: Variance within operational tolerance (<$1.00)');

      if (file.size === 0) {
        setErrorBanner({
          code: 'EMPTY_FILE',
          message: 'Uploaded file is empty (0 bytes).',
        });
        return;
      }

      const MAX_FILE_SIZE = 4 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        setErrorBanner({
          code: 'FILE_TOO_LARGE',
          message: 'Uploaded file exceeds the maximum allowed size of 4.0 MB.',
        });
        return;
      }
    },
    []
  );

  const handleLoadSyntheticInvoice = useCallback(
    async (type: 'clean' | 'drift') => {
      setLoadingSyntheticFile(type);
      setErrorBanner(null);

      const filename =
        type === 'clean'
          ? 'vertex-clean-match-inv-2026-4401.pdf'
          : 'vertex-seat-creep-drift-inv-2026-4402.pdf';
      const url = `/synthetic-invoices/${filename}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch synthetic PDF (${response.status} ${response.statusText}). Run "npm run generate:invoices" first.`
          );
        }

        const blob = await response.blob();
        const file = new File([blob], filename, { type: 'application/pdf' });

        // Automatically switch the active PO baseline to PO-2026-0104 (Vertex Cloud Services, $1,250.00)
        setActivePO(PO_VERTEX_SYNTHETIC_1250);

        // Stage file into active upload state
        handleFileSelection(file);
      } catch (err) {
        setErrorBanner({
          code: 'FETCH_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to load synthetic invoice PDF. Ensure npm run generate:invoices has been run.',
        });
      } finally {
        setLoadingSyntheticFile(null);
      }
    },
    [handleFileSelection]
  );

  const handleClearFile = useCallback(() => {
    setSelectedFile(null);
    setReconciliation(null);
    setRawExtraction(null);
    setErrorBanner(null);
    setIsOverrideInputOpen(false);
    setOverrideReason('Approved: Variance within operational tolerance (<$1.00)');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleRunBenchmark = async (
    scenario: 'verified_match' | 'float_trap' | 'ocr_guardrail'
  ) => {
    // Benchmark fixtures are specifically authored for the default baseline (PO-2026-0881).
    // Synchronize the active PO baseline so deterministic matching succeeds against the authorized contract.
    setActivePO(DEFAULT_PO_PRESET);
    setSelectedFile(null);
    setIsOverrideInputOpen(false);
    setOverrideReason('Approved: Variance within operational tolerance (<$1.00)');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    const sampleFile = await generateSampleInvoicePng();
    executeReconciliation(sampleFile, true, scenario, DEFAULT_PO_PRESET);
  };

  const handleManualUpload = useCallback(() => {
    if (!selectedFile) return;
    if (selectedFile.size === 0) {
      setErrorBanner({
        code: 'EMPTY_FILE',
        message: 'Uploaded file is empty (0 bytes).',
      });
      return;
    }
    const MAX_FILE_SIZE = 4 * 1024 * 1024;
    if (selectedFile.size > MAX_FILE_SIZE) {
      setErrorBanner({
        code: 'FILE_TOO_LARGE',
        message: 'Uploaded file exceeds the maximum allowed size of 4.0 MB.',
      });
      return;
    }
    executeReconciliation(selectedFile, false);
  }, [selectedFile, executeReconciliation]);

  const isFileValid = Boolean(
    selectedFile && selectedFile.size > 0 && selectedFile.size <= 4 * 1024 * 1024
  );

  const handleExportCSV = useCallback(() => {
    if (!reconciliation) return;
    exportReconciliationToCSV(
      reconciliation,
      reconciliation.po_number || activePO.po_number,
      reconciliation.invoice_number || 'INV-UNKNOWN',
      {
        poSubtotalCents: activePO.subtotal_cents,
        traceId: `LOG-${reconciliation.po_number || activePO.po_number}`,
      }
    );
  }, [reconciliation, activePO]);

  const handleExportAuditProof = useCallback(() => {
    if (!reconciliation) return;
    const traceId = `LOG-${reconciliation.po_number || activePO.po_number}`;
    exportAuditProofJSON(
      rawExtraction,
      reconciliation,
      traceId,
      reconciliation.invoice_number || 'INV-UNKNOWN'
    );
  }, [reconciliation, rawExtraction, activePO]);

  const handleToggleOverrideInput = useCallback(() => {
    if (!reconciliation) return;
    if (
      reconciliation.status === 'APPROVED_WITH_OVERRIDE' ||
      reconciliation.status === 'APPROVED' ||
      reconciliation.status === 'APPROVED_WITHIN_TOLERANCE'
    ) {
      return;
    }
    setIsOverrideInputOpen((prev) => {
      if (!prev && !overrideReason.trim()) {
        setOverrideReason('Approved: Variance within operational tolerance (<$1.00)');
      }
      return !prev;
    });
  }, [reconciliation, overrideReason]);

  const handleConfirmOverride = useCallback((customReason?: string) => {
    if (!reconciliation) return;
    const trimmedReason = (customReason ?? overrideReason).trim();
    if (!trimmedReason) return;

    const overrideAuditEntry = `[HUMAN_OVERRIDE]: ${trimmedReason}`;
    const effectiveTraceId =
      reconciliation.trace_id || currentTraceId || `LOG-${activePO.po_number}`;

    setReconciliation({
      ...reconciliation,
      status: 'APPROVED_WITH_OVERRIDE',
      audit_notes: [...(reconciliation.audit_notes ?? []), overrideAuditEntry],
    });
    setIsOverrideInputOpen(false);

    // Record resolution event in Supabase in background
    if (effectiveTraceId) {
      recordResolutionEvent(effectiveTraceId, 'HUMAN_OVERRIDE', {
        justification: trimmedReason,
        operatorEmail: user?.email ?? GUEST_OPERATOR_EMAIL,
      }).catch(() => {});
    }
  }, [reconciliation, overrideReason, currentTraceId, activePO.po_number, user?.email]);

  const handleOpenDisputeModal = useCallback(() => {
    if (!reconciliation) return;
    setIsDisputeModalOpen(true);
    const notice = generateDisputeNotice(
      { ...reconciliation, trace_id: currentTraceId || reconciliation.trace_id },
      activePO,
      tolerancePolicy.name,
      user?.email || 'Accounts Payable Operator'
    );
    if (currentTraceId) {
      recordResolutionEvent(currentTraceId, 'DISPUTE_NOTICE_GENERATED', {
        noticeText: notice,
        operatorEmail: user?.email ?? GUEST_OPERATOR_EMAIL,
      }).catch(() => {});
    }
  }, [reconciliation, activePO, currentTraceId, tolerancePolicy.name, user?.email]);

  const handleCycleTolerancePolicy = useCallback((): string => {
    const nextPolicy = getNextTolerancePolicy(tolerancePolicy.id);
    handleSelectTolerancePolicy(nextPolicy);
    return nextPolicy.name;
  }, [tolerancePolicy.id, handleSelectTolerancePolicy]);

  const handleToggleLedgerView = useCallback((): string => {
    const nextTab = activeTab === 'ledger' ? 'trust_boundary' : 'ledger';
    setActiveTab(nextTab);
    return nextTab;
  }, [activeTab]);

  const handleHotkeyCopyDispute = useCallback((): boolean => {
    if (!reconciliation) return false;
    const statusStr = String(reconciliation.status);
    if (
      statusStr !== 'FLAGGED_DRIFT' &&
      statusStr !== 'REQUIRES_MANUAL_REVIEW' &&
      statusStr !== 'MANUAL_REVIEW'
    ) {
      return false;
    }

    const effectiveTraceId =
      reconciliation.trace_id || currentTraceId || `LOG-${activePO.po_number}`;
    const notice = generateDisputeNotice(
      { ...reconciliation, trace_id: effectiveTraceId },
      activePO,
      tolerancePolicy.name,
      user?.email || 'Accounts Payable Operator'
    );

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(notice).catch(() => {});
    }

    recordResolutionEvent(effectiveTraceId, 'DISPUTE_NOTICE_GENERATED', {
      noticeText: notice,
      operatorEmail: user?.email ?? GUEST_OPERATOR_EMAIL,
    }).catch(() => {});
    return true;
  }, [reconciliation, currentTraceId, activePO, tolerancePolicy.name, user?.email]);

  useOperatorHotkeys({
    onRunBenchmark: (scenario) => {
      if (!isLoading) {
        void handleRunBenchmark(scenario);
      }
    },
    onStageSyntheticPdf: (type) => {
      if (!isLoading && loadingSyntheticFile === null) {
        void handleLoadSyntheticInvoice(type);
      }
    },
    onExtractStagedFile: () => {
      if (selectedFile && isFileValid && !isLoading) {
        handleManualUpload();
        return true;
      }
      return false;
    },
    onToggleAuditHistory: () => {
      setIsAuditLedgerOpen((prev) => !prev);
    },
    onCycleTolerancePolicy: handleCycleTolerancePolicy,
    onToggleLedgerView: handleToggleLedgerView,
    onCopyDisputeNotice: handleHotkeyCopyDispute,
    onToggleHud: handleToggleHudVisible,
    onToggleTheme: handleToggleTheme,
    onToggleOperatorAuth: () => {
      setIsOperatorAuthModalOpen((prev) => !prev);
    },
    onToggleHelpModal: () => {
      setIsHotkeyHelpOpen((prev) => !prev);
    },
    onEscape: () => {
      setIsHotkeyHelpOpen(false);
      setIsOperatorAuthModalOpen(false);
      setIsDisputeModalOpen(false);
      setIsPoModalOpen(false);
      setIsAuditLedgerOpen(false);
      setIsOverrideInputOpen(false);
      setErrorBanner(null);
    },
    onCommandTriggered: (entry) => {
      setLastHotkeyCommand(entry);
    },
  });

  // Invoiced subtotal in integer cents deterministically from reconciliation
  const invoicedSubtotalCents = reconciliation
    ? reconciliation.invoiced_subtotal_cents ??
      (reconciliation.line_items ?? []).reduce(
        (sum: number, item: { invoiced_line_total_cents?: number }) =>
          sum + (item.invoiced_line_total_cents ?? 0),
        0
      )
    : 0;

  const totalVarianceCents = reconciliation
    ? (reconciliation.total_variance_cents ?? 0)
    : 0;

  const renderStatusBadge = (status: ReconciliationStatus) => {
    switch (status) {
      case 'FLAGGED_DRIFT':
        return (
          <span className="bg-rose-100 text-rose-800 border border-rose-300 font-mono text-xs font-bold px-2.5 py-1 rounded inline-block">
            DRIFT DETECTED
          </span>
        );
      case 'APPROVED':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono text-xs font-bold px-2.5 py-1 rounded inline-block">
            VERIFIED MATCH
          </span>
        );
      case 'APPROVED_WITHIN_TOLERANCE':
        return (
          <span className="bg-teal-50 text-teal-800 border border-teal-300 font-mono text-xs font-bold px-2.5 py-1 rounded inline-block">
            APPROVED (TOLERANCE)
          </span>
        );
      case 'REQUIRES_MANUAL_REVIEW':
        return (
          <span className="bg-amber-100 text-amber-800 border border-amber-300 font-mono text-xs font-bold px-2.5 py-1 rounded inline-block">
            MANUAL REVIEW
          </span>
        );
      case 'APPROVED_WITH_OVERRIDE':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono text-xs font-bold px-2.5 py-1 rounded inline-block">
            OVERRIDE APPROVED
          </span>
        );
    }
  };

  const renderLineStatus = (status: ReconciledLineItem['status']) => {
    switch (status) {
      case 'MATCH':
        return <span className="font-mono text-emerald-700 font-semibold text-[11px]">MATCH</span>;
      case 'PRICE_MISMATCH':
        return <span className="font-mono text-rose-700 font-semibold text-[11px]">PRICE DRIFT</span>;
      case 'QUANTITY_MISMATCH':
        return <span className="font-mono text-amber-700 font-semibold text-[11px]">QTY MISMATCH</span>;
      case 'UNEXPECTED_ITEM':
        return <span className="font-mono text-purple-700 font-semibold text-[11px]">UNEXPECTED</span>;
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col font-sans transition-colors ${
        theme === 'dark' ? 'dark bg-[#0a0d12] text-[#f1f5f9]' : 'bg-[#fafafa] text-neutral-900'
      }`}
    >
      {/* 1. Top Navigation Bar */}
      <header className="border-b border-neutral-200 bg-white px-6 py-3 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Clean Brand Wordmark Only */}
          <span className="text-base font-bold tracking-tight text-neutral-900">
            ClearMatch
          </span>

          {/* Right: Audit History, Theme Toggle, and Operator Auth */}
          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={() => setIsAuditLedgerOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 shadow-xs transition-colors cursor-pointer font-medium active:translate-y-[1px]"
            >
              <span>[ Audit History ]</span>
            </button>

            <button
              type="button"
              onClick={() => handleToggleTheme()}
              title="Toggle Light / Dark theme (Shortcut: D)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 shadow-xs transition-colors cursor-pointer font-medium active:translate-y-[1px]"
            >
              <span>{theme === 'dark' ? '☀️ Light' : '🌙 Dark'}</span>
            </button>

            {user?.email ? (
              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                title="Sign out of authenticated operator session"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 shadow-xs transition-colors cursor-pointer font-semibold active:translate-y-[1px]"
              >
                <span>[ {user.email} • Sign Out ]</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsOperatorAuthModalOpen(true)}
                title="Sign in with passwordless Magic Link (Shortcut: A)"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded border border-neutral-900 bg-neutral-900 hover:bg-neutral-800 text-white shadow-xs transition-colors cursor-pointer font-semibold active:translate-y-[1px]"
              >
                <span>[ Sign In ]</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Error Alert Banner */}
      {errorBanner && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 text-xs text-rose-900">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-rose-700">[{errorBanner.code}]:</span>
              <span>{errorBanner.message}</span>
            </div>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-rose-600 hover:text-rose-800 font-mono text-xs cursor-pointer ml-4 underline"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* 2. Main Layout (Dense Two-Column Workbench) */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (Ingestion & PO Registry - ~35% width / 4 cols on 12) */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          {/* Section Header */}
          <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
            <h2 className="text-xs uppercase tracking-wider text-neutral-500 font-mono font-semibold">
              1. SOURCE DOCUMENT &amp; PO BASELINE
            </h2>
            <span className="text-[11px] font-mono text-neutral-400">{activePO.po_number}</span>
          </div>

          {/* Primary Ingestion Card: Dropzone, Sample PDFs & Test Presets */}
          <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs flex flex-col gap-3.5">
            {/* File Dropzone at the Very Top */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed border-neutral-300 hover:border-neutral-400 bg-neutral-50/50 rounded-lg p-5 text-center text-sm cursor-pointer transition-colors ${
                isDragging ? 'border-neutral-900 bg-neutral-100/70' : ''
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                className="hidden"
                onClick={(e) => {
                  (e.currentTarget as HTMLInputElement).value = '';
                }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelection(e.target.files[0]);
                  }
                }}
              />

              <div className="text-neutral-500 text-xs">
                {selectedFile ? (
                  <div>
                    <span className="font-mono font-medium text-neutral-900 block truncate">
                      {selectedFile.name}
                    </span>
                    <span className="font-mono text-[11px] text-neutral-500 block mt-0.5">
                      {(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'file'}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="text-neutral-700 font-medium block">Drop invoice file here</span>
                    <span className="text-neutral-400 text-[11px] font-mono block mt-0.5">
                      PDF, PNG, or JPEG (Max 4.0 MB)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Primary Action Button State Machine */}
            {isLoading ? (
              <button
                type="button"
                disabled
                className="w-full font-medium text-xs py-2.5 px-3 rounded-md transition-all flex items-center justify-center gap-2 bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed"
              >
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Extracting &amp; Computing...</span>
              </button>
            ) : reconciliation && selectedFile ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleManualUpload}
                  disabled={!isFileValid}
                  className="w-full font-medium text-xs py-2.5 px-3 rounded-md transition-all flex items-center justify-center gap-2 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 shadow-xs cursor-pointer active:translate-y-[1px]"
                >
                  <span>Re-run Ingestion</span>
                  <kbd className="font-mono text-[10px] bg-neutral-100 border border-neutral-300 text-neutral-600 px-1 rounded">
                    [E]
                  </kbd>
                </button>
                <button
                  type="button"
                  onClick={handleClearFile}
                  className="w-full text-center text-xs font-mono text-neutral-500 hover:text-neutral-800 transition-colors py-1 cursor-pointer"
                >
                  Clear / Upload New Invoice
                </button>
              </div>
            ) : selectedFile ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleManualUpload}
                  disabled={!isFileValid}
                  className={`w-full font-medium text-xs py-2.5 px-3 rounded-md transition-all flex items-center justify-center gap-2 ${
                    isFileValid
                      ? 'bg-neutral-900 text-white hover:bg-neutral-800 border border-neutral-900 shadow-sm cursor-pointer active:translate-y-[1px]'
                      : 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
                  }`}
                >
                  <span>Extract &amp; Reconcile File</span>
                  <kbd className="font-mono text-[10px] opacity-80 px-1 rounded border border-current/30">
                    [E]
                  </kbd>
                </button>
                <button
                  type="button"
                  onClick={handleClearFile}
                  className="w-full text-center text-xs font-mono text-neutral-500 hover:text-neutral-800 transition-colors py-1 cursor-pointer"
                >
                  Clear Selected File
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled
                  className="w-full font-medium text-xs py-2.5 px-3 rounded-md transition-all flex items-center justify-center gap-2 bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed"
                >
                  <span>Extract &amp; Reconcile File</span>
                  <kbd className="font-mono text-[10px] opacity-80 px-1 rounded border border-current/30">
                    [E]
                  </kbd>
                </button>
                {reconciliation && (
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="w-full text-center text-xs font-mono text-neutral-500 hover:text-neutral-800 transition-colors py-1 cursor-pointer"
                  >
                    Clear / Upload New Invoice
                  </button>
                )}
              </div>
            )}

            {/* Sample PDFs (Full-Width Clean Buttons Without Truncation) */}
            <div className="pt-2 border-t border-neutral-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold text-neutral-500 tracking-wider">
                  Sample PDFs
                </span>
                <span className="text-[10px] font-mono text-neutral-400">PO-2026-0104</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleLoadSyntheticInvoice('clean')}
                  disabled={isLoading || loadingSyntheticFile !== null}
                  title="Stage clean match sample PDF ($1,250.00)"
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 px-2.5 py-2 rounded font-mono text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between"
                >
                  <span className="font-medium text-neutral-800 text-[11px]">
                    Sample: Clean Match ($1,250)
                  </span>
                  {loadingSyntheticFile === 'clean' ? (
                    <div className="w-3.5 h-3.5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <kbd className="text-[10px] bg-neutral-100 border border-neutral-300 text-neutral-600 px-1.5 py-0.5 rounded shrink-0">
                      [Q]
                    </kbd>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleLoadSyntheticInvoice('drift')}
                  disabled={isLoading || loadingSyntheticFile !== null}
                  title="Stage price drift sample PDF (+$81.00)"
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-neutral-300 px-2.5 py-2 rounded font-mono text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between"
                >
                  <span className="font-medium text-neutral-800 text-[11px]">
                    Sample: Price Drift (+$81)
                  </span>
                  {loadingSyntheticFile === 'drift' ? (
                    <div className="w-3.5 h-3.5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <kbd className="text-[10px] bg-neutral-100 border border-neutral-300 text-neutral-600 px-1.5 py-0.5 rounded shrink-0">
                      [W]
                    </kbd>
                  )}
                </button>
              </div>
            </div>

            {/* Test Presets (Clean Single-Line Cards) */}
            <div className="pt-2 border-t border-neutral-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold text-neutral-500 tracking-wider">
                  Test Presets
                </span>
                <span className="text-[10px] font-mono text-neutral-400">PO-2026-0881</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleRunBenchmark('verified_match')}
                  disabled={isLoading}
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-neutral-300 px-2.5 py-2 rounded text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between"
                >
                  <span className="font-mono font-medium text-neutral-800 text-[11px]">
                    1. Verified Match ($0.00)
                  </span>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
                    APPROVED
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRunBenchmark('float_trap')}
                  disabled={isLoading}
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-neutral-300 px-2.5 py-2 rounded text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between"
                >
                  <span className="font-mono font-medium text-neutral-800 text-[11px]">
                    2. Float-Trap Drift (-$0.50)
                  </span>
                  <span className="bg-rose-50 text-rose-700 border border-rose-200 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
                    FLAGGED_DRIFT
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRunBenchmark('ocr_guardrail')}
                  disabled={isLoading}
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-neutral-300 px-2.5 py-2 rounded text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between"
                >
                  <span className="font-mono font-medium text-neutral-800 text-[11px]">
                    3. OCR Guardrail
                  </span>
                  <span className="bg-amber-50 text-amber-700 border border-amber-200 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
                    MANUAL_REVIEW
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* STP Tolerance Policy Management Card */}
          <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs flex flex-col gap-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-200">
              <span className="font-mono font-bold text-xs text-neutral-900">
                STP Tolerance Policy
              </span>
              <span className="font-mono text-[10px] text-neutral-700 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded font-medium">
                {tolerancePolicy.name}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => handleSelectTolerancePolicy(TOLERANCE_PRESETS.STRICT_ZERO)}
                className={`py-1.5 px-2 rounded font-mono text-xs transition-all cursor-pointer border text-center ${
                  tolerancePolicy.id === TOLERANCE_PRESETS.STRICT_ZERO.id
                    ? 'bg-neutral-900 text-white border-neutral-900 font-bold shadow-xs'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
              >
                [ Strict ($0.00) ]
              </button>
              <button
                type="button"
                onClick={() => handleSelectTolerancePolicy(TOLERANCE_PRESETS.STANDARD_AP)}
                className={`py-1.5 px-2 rounded font-mono text-xs transition-all cursor-pointer border text-center ${
                  tolerancePolicy.id === TOLERANCE_PRESETS.STANDARD_AP.id
                    ? 'bg-neutral-900 text-white border-neutral-900 font-bold shadow-xs'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
              >
                [ Standard AP ($1.00) ]
              </button>
              <button
                type="button"
                onClick={() => handleSelectTolerancePolicy(TOLERANCE_PRESETS.HIGH_VOLUME)}
                className={`py-1.5 px-2 rounded font-mono text-xs transition-all cursor-pointer border text-center ${
                  tolerancePolicy.id === TOLERANCE_PRESETS.HIGH_VOLUME.id
                    ? 'bg-neutral-900 text-white border-neutral-900 font-bold shadow-xs'
                    : 'bg-white hover:bg-neutral-50 text-neutral-700 border-neutral-300'
                }`}
              >
                [ High-Volume ($5.00) ]
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 pt-1 border-t border-neutral-100">
              <span>Limit: {formatCurrency(tolerancePolicy.max_variance_cents ?? 0)} ({tolerancePolicy.max_variance_bps} bps)</span>
              <span>Strict Qty: {tolerancePolicy.strict_quantity_match ? 'ENFORCED' : 'OFF'}</span>
            </div>
          </div>

          {/* Active PO Baseline Card */}
          <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs">
            <div className="flex items-center justify-between pb-2.5 border-b border-neutral-200">
              <span className="font-mono font-bold text-xs text-neutral-900">
                {activePO.po_number}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPoModalOpen(true)}
                  className="font-mono text-[11px] text-neutral-700 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 rounded px-2 py-0.5 transition-colors cursor-pointer"
                >
                  Edit PO Baseline
                </button>
                <span className="bg-neutral-100 text-neutral-700 font-mono text-[10px] px-1.5 py-0.5 rounded border border-neutral-200">
                  AUTHORIZED
                </span>
              </div>
            </div>

            {/* Key-Value Block */}
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-neutral-500">Vendor:</span>
                <span className="font-medium text-neutral-900">{activePO.vendor_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Issue Date:</span>
                <span className="font-mono text-neutral-700">{activePO.issue_date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Currency:</span>
                <span className="font-mono text-neutral-700">{activePO.currency}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-neutral-100">
                <span className="text-neutral-500">Authorized Subtotal:</span>
                <span className="font-mono text-neutral-900 font-medium">
                  {formatCurrency(activePO.subtotal_cents ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Tax (1000 bps):</span>
                <span className="font-mono text-neutral-900 font-medium">
                  {formatCurrency(activePO.tax_cents ?? 0)}
                </span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-neutral-200 font-semibold">
                <span className="text-neutral-800">Total:</span>
                <span className="font-mono text-neutral-900">
                  {formatCurrency(activePO.total_cents ?? 0)}
                </span>
              </div>
            </div>

            {/* Contracted PO Line Items */}
            <div className="mt-4 pt-3 border-t border-neutral-200">
              <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 block mb-2 font-medium">
                Contracted Items ({activePO.items.length})
              </span>
              <div className="space-y-1.5">
                {activePO.items.map((poItem) => (
                  <div
                    key={`${poItem.sku}-${poItem.line_number}`}
                    className="p-2 rounded bg-neutral-50 border border-neutral-200/70 text-xs flex items-center justify-between"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-medium text-neutral-800 truncate text-[11px] leading-tight">
                        {poItem.description}
                      </p>
                      <p className="font-mono text-[10px] text-neutral-400 mt-0.5">
                        {poItem.sku} • Qty {poItem.quantity}
                      </p>
                    </div>
                    <span className="font-mono font-medium text-neutral-700 text-[11px] shrink-0">
                      {formatCurrency(poItem.unit_price_cents ?? 0)}/ea
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (Workbench Ledger & Trust Boundary Inspector - ~65% width / 8 cols on 12) */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {/* Section Header with Clean Toggle Tabs */}
          <div className="flex flex-wrap items-center justify-between border-b border-neutral-200 pb-2 gap-2">
            <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded border border-neutral-200 font-mono text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('ledger')}
                className={`px-3 py-1 rounded transition-colors font-semibold cursor-pointer ${
                  activeTab === 'ledger'
                    ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/80'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Reinforced Ledger
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('trust_boundary')}
                className={`px-3 py-1 rounded transition-colors font-semibold cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'trust_boundary'
                    ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/80'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <span>Trust Boundary</span>
                <kbd className="text-[10px] bg-neutral-900 text-amber-300 border border-neutral-700 px-1 rounded font-bold">
                  [T]
                </kbd>
              </button>
            </div>

            {/* Client-Side Audit & ERP Export Utility Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                disabled={!reconciliation || isLoading}
                title={
                  reconciliation
                    ? 'Export structured ERP-ready reconciliation CSV'
                    : 'Export disabled: No active reconciliation result'
                }
                className="inline-flex items-center gap-1.5 bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 font-mono text-xs px-2.5 py-1 rounded shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-neutral-500">⬇</span>
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportAuditProof}
                disabled={!reconciliation || isLoading}
                title={
                  reconciliation
                    ? 'Download complete cryptographic audit proof JSON'
                    : 'Export disabled: No active reconciliation result'
                }
                className="inline-flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-900 font-mono text-xs px-2.5 py-1 rounded shadow-xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="text-neutral-400">⬇</span>
                <span>Download Audit Proof (JSON)</span>
              </button>
            </div>
          </div>

          {/* Loading Indicator */}
          {isLoading && (
            <div className="bg-white border border-neutral-200 p-8 rounded-md text-center shadow-xs">
              <div className="inline-block animate-spin w-5 h-5 border-2 border-neutral-900 border-t-transparent rounded-full mb-3" />
              <p className="font-mono text-xs font-medium text-neutral-900">
                Processing Deterministic Reconciliation
              </p>
              <p className="font-mono text-[11px] text-neutral-500 mt-1">{loadingText}</p>
            </div>
          )}

          {/* Crisp Minimal Empty State */}
          {!reconciliation && !isLoading && (
            <div className="border border-dashed border-neutral-300 bg-white rounded-md py-14 px-6 text-center shadow-xs">
              <p className="text-sm font-medium text-neutral-700">
                Upload an invoice or select a preset to begin reconciliation.
              </p>
            </div>
          )}

          {/* Tab 1: Reinforced Ledger Content */}
          {reconciliation && !isLoading && activeTab === 'ledger' && (
            <div className="flex flex-col gap-4">
              {/* Header Row: Clickable Quick-Copy Identifiers, Telemetry Pill & Status Chip */}
              <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-neutral-500">MATCH:</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickCopyIdentifier('invoice', reconciliation.invoice_number)
                    }
                    title="Click to copy Invoice Number"
                    className="font-mono text-xs font-bold text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 px-2 py-0.5 rounded transition-colors cursor-pointer inline-flex items-center gap-1"
                  >
                    <span>{reconciliation.invoice_number}</span>
                    <span className="text-[10px] text-emerald-700 font-normal">
                      {copiedIdKey === 'invoice' ? 'Copied!' : '📋'}
                    </span>
                  </button>
                  <span className="text-neutral-300 font-mono text-xs">against</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickCopyIdentifier('po', reconciliation.po_number)
                    }
                    title="Click to copy Baseline PO Number"
                    className="font-mono text-xs font-bold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 px-2 py-0.5 rounded transition-colors cursor-pointer inline-flex items-center gap-1"
                  >
                    <span>{reconciliation.po_number}</span>
                    <span className="text-[10px] text-emerald-700 font-normal">
                      {copiedIdKey === 'po' ? 'Copied!' : '📋'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickCopyIdentifier(
                        'trace',
                        reconciliation.trace_id || currentTraceId || `LOG-${activePO.po_number}`
                      )
                    }
                    title="Click to copy Audit Trace ID"
                    className="font-mono text-[11px] text-neutral-600 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded transition-colors cursor-pointer inline-flex items-center gap-1"
                  >
                    <span>
                      {reconciliation.trace_id || currentTraceId || `LOG-${activePO.po_number}`}
                    </span>
                    <span className="text-[10px] text-emerald-700 font-semibold">
                      {copiedIdKey === 'trace' ? 'Copied!' : '📋'}
                    </span>
                  </button>
                  <span className="text-neutral-300">•</span>
                  <span className="text-xs text-neutral-600 font-medium">
                    {reconciliation.vendor_name}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-neutral-100 text-neutral-700 border border-neutral-300 font-mono text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1">
                    <span>⚡ {executionLatencyMs ?? 42}ms</span>
                    <span className="text-neutral-400">•</span>
                    <span className="font-semibold">{extractionSourceBadge}</span>
                  </span>
                  {renderStatusBadge(reconciliation.status)}
                </div>
              </div>

              {/* Financial Metric Grid (3 Compact Boxes) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Box 1: Invoiced vs PO Subtotal */}
                <div className="bg-white border border-neutral-200/80 rounded-md p-3.5 shadow-xs">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 block font-medium">
                    INVOICED VS PO SUBTOTAL
                  </span>
                  <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="font-mono text-lg font-bold text-neutral-900 tabular-nums">
                      {formatCurrency(invoicedSubtotalCents ?? 0)}
                    </span>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">
                      vs {formatCurrency(activePO.subtotal_cents ?? 0)}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-400 block mt-1">
                    Pre-tax subtotal baseline ({activePO.currency})
                  </span>
                </div>

                {/* Box 2: Total Drift / Variance */}
                <div className="bg-white border border-neutral-200/80 rounded-md p-3.5 shadow-xs">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 block font-medium">
                    TOTAL DRIFT / VARIANCE
                  </span>
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span
                      className={`font-mono text-lg font-bold tabular-nums ${
                        totalVarianceCents !== 0 ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(totalVarianceCents ?? 0, { showPositiveSign: true })}
                    </span>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">
                      ({totalVarianceCents > 0 ? '+' : ''}{totalVarianceCents}¢)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-400 block mt-1">
                    {totalVarianceCents === 0
                      ? 'Exact zero-drift match'
                      : `Pre-tax variance: ${formatCurrency(totalVarianceCents ?? 0, { showPositiveSign: true })}`}
                  </span>
                </div>

                {/* Box 3: Extraction Confidence */}
                <div className="bg-white border border-neutral-200/80 rounded-md p-3.5 shadow-xs">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 block font-medium">
                    EXTRACTION CONFIDENCE
                  </span>
                  <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="font-mono text-lg font-bold text-neutral-900 tabular-nums">
                      {rawExtraction ? `${Math.round(rawExtraction.extraction_confidence * 100)}%` : '—'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-500 block mt-1 truncate">
                    {rawExtraction && (rawExtraction.unresolved_ambiguities ?? []).length === 0
                      ? 'Zero visual ambiguities'
                      : `${(rawExtraction?.unresolved_ambiguities ?? []).length} ambiguities noted`}
                  </span>
                </div>
              </div>

              {/* Visual Variance Progress Bar (PO Baseline vs Invoiced Subtotal) */}
              <div className="bg-white border border-neutral-200/80 rounded-md px-4 py-3 shadow-xs">
                <div className="flex items-center justify-between font-mono text-[11px] mb-1.5">
                  <span className="text-neutral-500 uppercase font-semibold">
                    Baseline vs. Invoiced Variance Ratio
                  </span>
                  <span
                    className={`font-bold ${
                      totalVarianceCents > 0
                        ? 'text-rose-700'
                        : totalVarianceCents < 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {activePO.subtotal_cents > 0
                      ? `${((invoicedSubtotalCents / activePO.subtotal_cents) * 100).toFixed(2)}% of PO Baseline`
                      : '100.00% of PO Baseline'}
                  </span>
                </div>
                <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden border border-neutral-200/80 flex">
                  <div
                    className={`h-full transition-all duration-300 ${
                      totalVarianceCents > 0
                        ? 'bg-rose-600'
                        : totalVarianceCents < 0
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                    }`}
                    style={{
                      width: `${
                        activePO.subtotal_cents > 0
                          ? Math.min(
                              100,
                              Math.max(
                                8,
                                Math.round((invoicedSubtotalCents / activePO.subtotal_cents) * 100)
                              )
                            )
                          : 100
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Line Item Table (High-Density Spreadsheet Style) */}
              <div className="bg-white border border-neutral-200/80 rounded-md overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="table-auto w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 bg-neutral-100/70 text-neutral-600 font-mono text-[11px]">
                        <th className="py-2 px-3 text-left font-semibold">ITEM DESCRIPTION</th>
                        <th className="py-2 px-3 text-left font-semibold">PO SKU</th>
                        <th className="py-2 px-3 text-left font-semibold">STATUS</th>
                        <th className="py-2 px-3 text-right font-semibold">QTY (INV/PO)</th>
                        <th className="py-2 px-3 text-right font-semibold">UNIT PRICE (INV/PO)</th>
                        <th className="py-2 px-3 text-right font-semibold">VARIANCE</th>
                        <th className="py-2 px-3 text-right font-semibold">LINE TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reconciliation.line_items ?? []).map((line, idx) => {
                        const hasVariance = line.variance_unit_price_cents !== 0;
                        return (
                          <tr
                            key={idx}
                            className="border-b border-neutral-200/60 hover:bg-neutral-50/60 transition-colors"
                          >
                            <td className="py-2.5 px-3 font-medium text-neutral-900 max-w-xs truncate">
                              {line.invoice_description}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-neutral-500 text-[11px]">
                              {line.po_sku || '—'}
                            </td>
                            <td className="py-2.5 px-3 shrink-0">{renderLineStatus(line.status)}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-neutral-700 tabular-nums">
                              {line.invoiced_quantity} / {line.expected_quantity}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <span className={hasVariance ? 'font-semibold text-rose-700' : 'text-neutral-800'}>
                                {formatCurrency(line.invoiced_unit_price_cents ?? 0)}
                              </span>{' '}
                              <span className="text-neutral-400 text-[10px]">
                                / {formatCurrency(line.expected_unit_price_cents ?? 0)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {hasVariance ? (
                                <span className="bg-rose-50 text-rose-700 font-mono font-medium text-[11px] px-1.5 py-0.5 rounded border border-rose-200/60 tabular-nums">
                                  {formatCurrency(line.variance_unit_price_cents ?? 0, { showPositiveSign: true })}
                                </span>
                              ) : (
                                <span className="font-mono text-neutral-400 tabular-nums">$0.00</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-neutral-900 tabular-nums">
                              {formatCurrency(line.invoiced_line_total_cents ?? 0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unmatched Contract Lines if any */}
              {(reconciliation.unmatched_po_items?.length ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs">
                  <span className="font-mono font-bold text-amber-800 uppercase text-[11px] block mb-1.5">
                    Unmatched Contract Items on PO ({(reconciliation.unmatched_po_items ?? []).length})
                  </span>
                  <div className="space-y-1">
                    {(reconciliation.unmatched_po_items ?? []).map((item) => (
                      <div
                        key={item.sku}
                        className="flex justify-between items-center bg-white p-2 rounded border border-amber-200/60"
                      >
                        <span className="font-medium text-neutral-800">
                          {item.description} ({item.sku}) • Qty: {item.quantity}
                        </span>
                        <span className="font-mono text-neutral-700 font-semibold">
                          {formatCurrency(item.total_cents ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit Trail Box */}
              <div className="bg-neutral-50 border border-neutral-200 p-3 rounded-md font-mono text-xs text-neutral-700 shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-200/80 mb-2">
                  <span className="text-[11px] font-bold text-neutral-600 uppercase tracking-wider">
                    AUDIT TRAIL ({(reconciliation.audit_notes ?? []).length} NOTES)
                  </span>
                  <span className="text-[10px] text-neutral-400">TRACE ID: LOG-{activePO.po_number}</span>
                </div>

                <div className="space-y-1">
                  {(reconciliation.audit_notes ?? []).length === 0 ? (
                    <p className="text-neutral-400 text-[11px] italic">No anomalies logged by reconciliation engine.</p>
                  ) : (
                    (reconciliation.audit_notes ?? []).map((note, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                        <span className="text-neutral-400 select-none">&gt;</span>
                        <span>{note}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Interactive Resolution & Dispute Triage Panel */}
              <DisputeResolutionPanel
                reconciliation={reconciliation}
                po={activePO}
                policyName={tolerancePolicy.name}
                traceId={currentTraceId || reconciliation.trace_id || `LOG-${activePO.po_number}`}
                authenticatedOperatorEmail={user?.email ?? null}
                onOverrideConfirmed={(justification) => handleConfirmOverride(justification)}
                onOpenFullModal={() => setIsDisputeModalOpen(true)}
              />

              {/* Reconciliation Workflow Actions Toolbar */}
              <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="font-mono text-xs font-bold text-neutral-900 block">
                      OPERATOR WORKFLOW ACTIONS
                    </span>
                    <span className="font-mono text-[11px] text-neutral-500 block">
                      Execute vendor dispute resolution notice or record authorized audit override
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleOpenDisputeModal}
                      className={`inline-flex items-center gap-2 font-mono text-xs px-3.5 py-2 rounded font-semibold transition-all shadow-xs cursor-pointer ${
                        reconciliation.status === 'FLAGGED_DRIFT' ||
                        reconciliation.status === 'REQUIRES_MANUAL_REVIEW'
                          ? 'bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-900 active:translate-y-[1px]'
                          : 'bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300'
                      }`}
                    >
                      <span>⚠️</span>
                      <span>Generate Vendor Dispute Notice</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleOverrideInput}
                      disabled={
                        reconciliation.status === 'APPROVED_WITH_OVERRIDE' ||
                        reconciliation.status === 'APPROVED' ||
                        reconciliation.status === 'APPROVED_WITHIN_TOLERANCE'
                      }
                      className={`inline-flex items-center gap-2 font-mono text-xs px-3.5 py-2 rounded font-semibold transition-all shadow-xs ${
                        reconciliation.status === 'APPROVED_WITH_OVERRIDE'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 cursor-not-allowed opacity-90'
                          : reconciliation.status === 'APPROVED_WITHIN_TOLERANCE'
                          ? 'bg-teal-50 text-teal-800 border border-teal-300 cursor-not-allowed opacity-90'
                          : reconciliation.status === 'APPROVED'
                          ? 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed opacity-60'
                          : isOverrideInputOpen
                          ? 'bg-neutral-100 text-neutral-800 border border-neutral-400 cursor-pointer'
                          : 'bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 cursor-pointer active:translate-y-[1px]'
                      }`}
                    >
                      <span>
                        {reconciliation.status === 'APPROVED_WITH_OVERRIDE' ||
                        reconciliation.status === 'APPROVED_WITHIN_TOLERANCE'
                          ? '✓'
                          : '🛡️'}
                      </span>
                      <span>
                        {reconciliation.status === 'APPROVED_WITH_OVERRIDE'
                          ? 'Variance Approved (Override)'
                          : reconciliation.status === 'APPROVED_WITHIN_TOLERANCE'
                          ? 'Approved (Tolerance Rule)'
                          : reconciliation.status === 'APPROVED'
                          ? 'Fully Matched ($0.00 Variance)'
                          : 'Accept & Approve Variance'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Compact Inline Operator Override Form */}
                {isOverrideInputOpen &&
                  reconciliation.status !== 'APPROVED_WITH_OVERRIDE' &&
                  reconciliation.status !== 'APPROVED_WITHIN_TOLERANCE' &&
                  reconciliation.status !== 'APPROVED' && (
                  <div className="mt-1 pt-3 border-t border-neutral-200/80 bg-neutral-50 -mx-4 -mb-4 p-3.5 rounded-b-md">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleConfirmOverride();
                      }}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
                    >
                      <label
                        htmlFor="operator-override-reason"
                        className="font-mono text-xs font-bold text-neutral-800 whitespace-nowrap"
                      >
                        Operator Justification / Policy Reference:
                      </label>
                      <input
                        id="operator-override-reason"
                        type="text"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Approved: Variance within operational tolerance (<$1.00)"
                        required
                        className="flex-1 font-mono text-xs px-3 py-1.5 bg-white border border-neutral-300 rounded focus:outline-hidden focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 shadow-xs"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="submit"
                          disabled={!overrideReason.trim()}
                          className="font-mono text-xs px-3.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Confirm Override
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsOverrideInputOpen(false)}
                          className="font-mono text-xs px-3 py-1.5 rounded bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 transition-colors shadow-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Trust Boundary Inspector (Raw VLM vs Engine) */}
          {reconciliation && !isLoading && activeTab === 'trust_boundary' && (
            <div className="flex flex-col gap-4">
              {/* Architectural Boundary Header Banner */}
              <div className="bg-neutral-900 text-white rounded-md p-4 font-mono text-xs shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-neutral-800">
                <div className="flex items-center gap-2.5">
                  <span className="bg-amber-400 text-neutral-950 font-bold px-2 py-0.5 rounded text-[10px] tracking-wide">
                    SYSTEM BOUNDARY
                  </span>
                  <span className="text-neutral-200">
                    Untrusted AI Entity Extraction <span className="text-neutral-500 font-bold">||</span> Trusted Deterministic Engine
                  </span>
                </div>
                <span className="text-[11px] text-neutral-400">
                  Invariant 1: LLM Never Calculates Math
                </span>
              </div>

              {/* Side-by-Side Comparison Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* LEFT: Untrusted VLM Output (Gemini 3.8 Flash) */}
                <div className="bg-white border-2 border-amber-300/80 rounded-md p-4 shadow-xs flex flex-col gap-3">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                      <h3 className="font-mono font-bold text-xs text-neutral-900 uppercase tracking-wider">
                        Untrusted VLM Output
                      </h3>
                    </div>
                    <span className="bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px] font-semibold px-2 py-0.5 rounded">
                      Gemini 3.5 Flash
                    </span>
                  </div>

                  {/* Confidence & Ambiguity Indicators */}
                  <div className="bg-neutral-50 border border-neutral-200/80 rounded p-2.5 space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-500 text-[11px]">Extraction Confidence:</span>
                      <span className={`font-bold ${rawExtraction && rawExtraction.extraction_confidence < 0.85 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {rawExtraction ? `${(rawExtraction.extraction_confidence * 100).toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between items-start">
                      <span className="text-neutral-500 text-[11px]">Unresolved Ambiguities:</span>
                      <span className="font-bold text-neutral-800 text-[11px] text-right">
                        {rawExtraction && (rawExtraction.unresolved_ambiguities ?? []).length > 0 ? (
                          <span className="text-amber-700 underline decoration-amber-400">
                            {(rawExtraction.unresolved_ambiguities ?? []).join(', ')}
                          </span>
                        ) : (
                          <span className="text-emerald-700">None (Clean OCR Table)</span>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-neutral-200/60">
                      <span className="text-neutral-500 text-[11px]">Arithmetic Execution:</span>
                      <span className="bg-neutral-200/80 text-neutral-700 px-1.5 py-0.5 rounded text-[10px] font-bold">
                        ZERO MATH (Raw Floats)
                      </span>
                    </div>
                  </div>

                  {/* Raw Line Items Extracted */}
                  <div>
                    <span className="font-mono text-[10px] uppercase font-bold text-neutral-400 block mb-1.5">
                      Raw Extracted Table Items (Unparsed Floats &amp; Strings)
                    </span>
                    <div className="space-y-1.5 font-mono text-xs">
                      {(rawExtraction?.items ?? []).map((item, idx) => (
                        <div key={idx} className="bg-neutral-50 border border-neutral-200 rounded p-2 text-[11px]">
                          <div className="text-neutral-900 font-medium truncate mb-1">
                            &ldquo;{item.raw_description}&rdquo;
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-neutral-600 text-[10px]">
                            <div>Qty: <strong className="text-neutral-900">{item.quantity}</strong></div>
                            <div>Unit Price: <strong className="text-neutral-900">${item.unit_price.toFixed(2)}</strong></div>
                            <div>OCR Total: <strong className="text-neutral-900">{item.raw_item_total !== undefined ? `$${item.raw_item_total.toFixed(2)}` : '—'}</strong></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Raw JSON Block */}
                  <div className="mt-auto pt-2 border-t border-neutral-200">
                    <span className="font-mono text-[10px] uppercase font-bold text-neutral-400 block mb-1">
                      Raw VLM JSON Response Payload
                    </span>
                    <pre className="bg-neutral-900 text-neutral-200 p-2.5 rounded text-[10px] font-mono overflow-x-auto max-h-56 leading-relaxed">
                      {JSON.stringify(rawExtraction, null, 2)}
                    </pre>
                  </div>
                </div>

                {/* RIGHT: Trusted Deterministic Engine */}
                <div className="bg-white border-2 border-emerald-400/80 rounded-md p-4 shadow-xs flex flex-col gap-3">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                      <h3 className="font-mono font-bold text-xs text-neutral-900 uppercase tracking-wider">
                        Trusted Deterministic Engine
                      </h3>
                    </div>
                    <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[10px] font-semibold px-2 py-0.5 rounded">
                      Pure TypeScript Math
                    </span>
                  </div>

                  {/* Invariant Guarantees */}
                  <div className="bg-neutral-50 border border-neutral-200/80 rounded p-2.5 space-y-1.5 font-mono text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-500 text-[11px]">Domain Function:</span>
                      <span className="font-bold text-neutral-800 text-[11px]">reconcileInvoiceAgainstPO</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-500 text-[11px]">Integer Cents Conversion:</span>
                      <span className="text-emerald-700 font-bold text-[11px]">dollarsToCents() [No Floats]</span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-neutral-200/60">
                      <span className="text-neutral-500 text-[11px]">Reconciliation Outcome:</span>
                      <span className="font-bold text-neutral-900 text-[11px]">{reconciliation.status}</span>
                    </div>
                  </div>

                  {/* Integer Cent Arithmetic Breakdown */}
                  <div>
                    <span className="font-mono text-[10px] uppercase font-bold text-neutral-400 block mb-1.5">
                      Integer-Cent Ledger &amp; SKU Normalization
                    </span>
                    <div className="space-y-1.5 font-mono text-xs">
                      {(reconciliation.line_items ?? []).map((line, idx) => (
                        <div key={idx} className="bg-neutral-50 border border-neutral-200 rounded p-2 text-[11px]">
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="font-medium text-neutral-900 truncate">
                              SKU: <strong className="text-neutral-900">{line.po_sku || 'UNMATCHED'}</strong>
                            </span>
                            <span className="font-bold">
                              {line.variance_unit_price_cents !== 0 ? (
                                <span className="text-rose-700">
                                  Variance: {formatCurrency(line.variance_unit_price_cents ?? 0, { showPositiveSign: true })}
                                </span>
                              ) : (
                                <span className="text-emerald-700">Zero Drift</span>
                              )}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-[10px] text-neutral-600">
                            <div>Invoiced: {line.invoiced_unit_price_cents ?? 0}¢ ({formatCurrency(line.invoiced_unit_price_cents ?? 0)})</div>
                            <div>Expected PO: {line.expected_unit_price_cents ?? 0}¢ ({formatCurrency(line.expected_unit_price_cents ?? 0)})</div>
                            <div className="col-span-2 text-neutral-500 pt-0.5 border-t border-neutral-200/40">
                              Calculated Total: {line.invoiced_quantity} × {line.invoiced_unit_price_cents ?? 0}¢ = {line.invoiced_line_total_cents ?? 0}¢ ({formatCurrency(line.invoiced_line_total_cents ?? 0)})
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Float Trap Callout */}
                  <div className="bg-neutral-100/90 border border-neutral-200 rounded p-2.5 font-mono text-[10px] text-neutral-700 space-y-1">
                    <div className="font-bold text-neutral-900">
                      FLOAT-TRAP DEFENSE &amp; VARIANCE PROOF
                    </div>
                    <div>Invoiced Subtotal: <strong className="text-neutral-900">{invoicedSubtotalCents}¢</strong> ({formatCurrency(invoicedSubtotalCents ?? 0)})</div>
                    <div>Baseline PO Subtotal: <strong className="text-neutral-900">{activePO.subtotal_cents}¢</strong> ({formatCurrency(activePO.subtotal_cents ?? 0)})</div>
                    <div>Exact Net Variance: <strong className={totalVarianceCents !== 0 ? 'text-rose-700' : 'text-emerald-700'}>{totalVarianceCents > 0 ? '+' : ''}{totalVarianceCents}¢ ({formatCurrency(totalVarianceCents ?? 0, { showPositiveSign: true })})</strong></div>
                    <div className="text-[9px] text-neutral-500 pt-1 border-t border-neutral-200">
                      Floating-point IEEE 754 math produces rounding artifacts like <code>-0.4999999999999886</code>. ClearMatch integer-cent domain function guarantees exact <code>-50¢</code> arithmetic.
                    </div>
                  </div>

                  {/* Engine JSON Block */}
                  <div className="mt-auto pt-2 border-t border-neutral-200">
                    <span className="font-mono text-[10px] uppercase font-bold text-neutral-400 block mb-1">
                      Engine Reconciliation Audit Payload
                    </span>
                    <pre className="bg-neutral-900 text-neutral-200 p-2.5 rounded text-[10px] font-mono overflow-x-auto max-h-56 leading-relaxed">
                      {JSON.stringify(reconciliation, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-white py-3 px-6 text-center text-xs font-mono text-neutral-400">
        ClearMatch • Integer-Cent Math • Deterministic Reconciliation
      </footer>

      {/* Sticky Bottom Speed-Run Operator Keyboard Triage HUD */}
      <KeyboardHudBar
        lastCommand={lastHotkeyCommand}
        isHudVisible={isHudVisible}
        onToggleHudVisible={() => {
          handleToggleHudVisible();
        }}
        theme={theme}
        onToggleTheme={() => {
          handleToggleTheme();
        }}
        onToggleOperatorAuth={() => setIsOperatorAuthModalOpen((prev) => !prev)}
        isHelpModalOpen={isHotkeyHelpOpen}
        onToggleHelpModal={() => setIsHotkeyHelpOpen((prev) => !prev)}
        onRunBenchmark={(scenario) => {
          if (!isLoading) void handleRunBenchmark(scenario);
        }}
        onStageSyntheticPdf={(type) => {
          if (!isLoading && loadingSyntheticFile === null) void handleLoadSyntheticInvoice(type);
        }}
        onExtractStagedFile={() => {
          if (selectedFile && isFileValid && !isLoading) handleManualUpload();
        }}
        onCyclePolicy={() => {
          handleCycleTolerancePolicy();
        }}
        onToggleView={() => {
          handleToggleLedgerView();
        }}
        onToggleAuditHistory={() => setIsAuditLedgerOpen((prev) => !prev)}
        canExtract={Boolean(selectedFile && isFileValid && !isLoading)}
      />

      {/* Vendor Dispute Memo Modal */}
      {reconciliation && (
        <DisputeModal
          isOpen={isDisputeModalOpen}
          onClose={() => setIsDisputeModalOpen(false)}
          noticeText={generateDisputeNotice(
            { ...reconciliation, trace_id: currentTraceId || reconciliation.trace_id },
            activePO,
            tolerancePolicy.name,
            user?.email || 'Accounts Payable Operator'
          )}
          invoiceNumber={reconciliation.invoice_number}
          poNumber={reconciliation.po_number || activePO.po_number}
          vendorName={reconciliation.vendor_name}
          status={reconciliation.status}
        />
      )}

      {/* PO Baseline Contract Editor Modal */}
      <PoBaselineModal
        isOpen={isPoModalOpen}
        onClose={() => setIsPoModalOpen(false)}
        activePO={activePO}
        onApply={handleApplyPO}
      />

      {/* Audit Ledger History Drawer */}
      <AuditLedgerDrawer
        isOpen={isAuditLedgerOpen}
        onClose={() => setIsAuditLedgerOpen(false)}
        onInspectRun={handleInspectRun}
        currentTraceId={currentTraceId}
        authenticatedOperatorEmail={user?.email ?? null}
        onOpenSignInModal={() => {
          setIsAuditLedgerOpen(false);
          setIsOperatorAuthModalOpen(true);
        }}
      />

      {/* Supabase Passwordless Operator Auth Modal */}
      <OperatorAuthModal
        isOpen={isOperatorAuthModalOpen}
        onClose={() => setIsOperatorAuthModalOpen(false)}
        user={user}
        onSignOut={async () => {
          await signOut();
        }}
      />
    </div>
  );
}
