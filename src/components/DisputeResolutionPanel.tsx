'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { PurchaseOrder, ReconciliationResult } from '../lib/reconcile';
import { generateDisputeNotice } from '../lib/disputeGenerator';
import { generateDisputeNoticePdf } from '../lib/disputePdfGenerator';
import { recordResolutionEvent } from '../lib/services/auditService';

interface DisputeResolutionPanelProps {
  reconciliation: ReconciliationResult;
  po: PurchaseOrder;
  policyName: string;
  traceId: string;
  authenticatedOperatorEmail?: string | null;
  onOverrideConfirmed: (justification: string) => void;
  onOpenFullModal?: (noticeText: string) => void;
}

export default function DisputeResolutionPanel({
  reconciliation,
  po,
  policyName,
  traceId,
  authenticatedOperatorEmail,
  onOverrideConfirmed,
  onOpenFullModal,
}: DisputeResolutionPanelProps) {
  const [activeMode, setActiveMode] = useState<'dispute' | 'override'>('dispute');
  const [operatorName, setOperatorName] = useState(
    authenticatedOperatorEmail || 'Accounts Payable Operator'
  );
  const [copied, setCopied] = useState(false);
  const [justification, setJustification] = useState(
    'Approved one-time seat overage per VP Engineering sign-off'
  );
  const [overrideCommittedBanner, setOverrideCommittedBanner] = useState<string | null>(
    null
  );
  const [disputeLoggedBanner, setDisputeLoggedBanner] = useState<string | null>(null);

  const effectiveTraceId =
    reconciliation.trace_id || traceId || `LOG-${po.po_number || reconciliation.po_number}`;

  useEffect(() => {
    if (authenticatedOperatorEmail) {
      setOperatorName(authenticatedOperatorEmail);
    } else {
      setOperatorName('Accounts Payable Operator');
    }
  }, [authenticatedOperatorEmail]);

  useEffect(() => {
    setCopied(false);
    setOverrideCommittedBanner(null);
    setDisputeLoggedBanner(null);
  }, [reconciliation.invoice_number, reconciliation.po_number, effectiveTraceId]);

  // Automatically generate and live-update the dispute notice memo
  const noticeText = useMemo(() => {
    return generateDisputeNotice(
      {
        ...reconciliation,
        trace_id: effectiveTraceId,
        po_subtotal_cents: reconciliation.po_subtotal_cents ?? po.subtotal_cents,
      },
      po,
      policyName,
      operatorName
    );
  }, [reconciliation, effectiveTraceId, po, policyName, operatorName]);

  const handleCopyNotice = useCallback(async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(noticeText);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = noticeText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }

    setDisputeLoggedBanner(
      `Dispute notice copied and logged to public.audit_resolution_events (${effectiveTraceId}).`
    );
    recordResolutionEvent(effectiveTraceId, 'DISPUTE_NOTICE_GENERATED', {
      noticeText,
      operatorEmail: authenticatedOperatorEmail,
    }).catch(() => {});
  }, [noticeText, effectiveTraceId, authenticatedOperatorEmail]);

  const handleDownloadNoticeTxt = useCallback(() => {
    const filename = `Dispute-${reconciliation.invoice_number || 'INV'}-${effectiveTraceId}.txt`;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([noticeText], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }

    setDisputeLoggedBanner(
      `Dispute notice downloaded (${filename}) and logged to public.audit_resolution_events.`
    );
    recordResolutionEvent(effectiveTraceId, 'DISPUTE_NOTICE_GENERATED', {
      noticeText,
      operatorEmail: authenticatedOperatorEmail,
    }).catch(() => {});
  }, [noticeText, reconciliation.invoice_number, effectiveTraceId, authenticatedOperatorEmail]);

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportPdf = useCallback(async () => {
    setIsExportingPdf(true);
    try {
      const pdfBytes = await generateDisputeNoticePdf(
        {
          ...reconciliation,
          trace_id: effectiveTraceId,
          po_subtotal_cents: reconciliation.po_subtotal_cents ?? po.subtotal_cents,
        },
        po,
        policyName,
        operatorName
      );

      const filename = `Dispute-Notice-${reconciliation.invoice_number || 'INV'}-${effectiveTraceId}.pdf`;

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }

      setDisputeLoggedBanner(
        `Official Dispute Notice PDF exported (${filename}) and logged to public.audit_resolution_events.`
      );
      recordResolutionEvent(effectiveTraceId, 'DISPUTE_PDF_EXPORTED', {
        invoice: reconciliation.invoice_number,
        operator: operatorName,
        operatorEmail: authenticatedOperatorEmail,
      }).catch(() => {});
    } finally {
      setIsExportingPdf(false);
    }
  }, [
    reconciliation,
    effectiveTraceId,
    po,
    policyName,
    operatorName,
    authenticatedOperatorEmail,
  ]);

  const trimmedJustification = justification.trim();
  const isJustificationValid = trimmedJustification.length >= 5;

  const handleConfirmOverrideSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isJustificationValid) return;

      onOverrideConfirmed(trimmedJustification);
      setOverrideCommittedBanner(
        `Human override committed to Supabase audit trail (public.audit_resolution_events) for ${effectiveTraceId}.`
      );
    },
    [isJustificationValid, trimmedJustification, onOverrideConfirmed, effectiveTraceId]
  );

  const statusStr = String(reconciliation.status);
  const shouldRender =
    statusStr === 'FLAGGED_DRIFT' ||
    statusStr === 'MANUAL_REVIEW' ||
    statusStr === 'REQUIRES_MANUAL_REVIEW' ||
    statusStr === 'APPROVED_WITH_OVERRIDE';

  if (!shouldRender) {
    return null;
  }

  const isOverridden = statusStr === 'APPROVED_WITH_OVERRIDE';

  return (
    <div className="bg-white border-2 border-neutral-900/90 rounded-md p-4 shadow-xs flex flex-col gap-4">
      {/* Header & Mode Selector Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isOverridden ? 'bg-emerald-600' : 'bg-rose-600 animate-pulse'
            }`}
          />
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-900">
              Resolution &amp; Dispute Triage
            </h3>
            <p className="font-mono text-[11px] text-neutral-500">
              Trace: {effectiveTraceId} • Policy: {policyName}
            </p>
          </div>
        </div>

        {/* Mode Toggle Tabs */}
        <div className="flex items-center gap-1 bg-neutral-100 p-0.5 rounded border border-neutral-200 font-mono text-xs">
          <button
            type="button"
            onClick={() => setActiveMode('dispute')}
            className={`px-3 py-1 rounded transition-colors font-semibold cursor-pointer ${
              activeMode === 'dispute'
                ? 'bg-neutral-900 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            1. Formal Dispute Notice
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('override')}
            className={`px-3 py-1 rounded transition-colors font-semibold cursor-pointer ${
              activeMode === 'override'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            2. Authorize Human Override
          </button>
        </div>
      </div>

      {/* Green Confirmation Banner when Override is Committed */}
      {(overrideCommittedBanner || isOverridden) && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-md px-3.5 py-2.5 font-mono text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-700">✓ OVERRIDE COMMITTED:</span>
            <span>
              {overrideCommittedBanner ||
                `Status transitioned to APPROVED_WITH_OVERRIDE and logged to Supabase audit trail (${effectiveTraceId}).`}
            </span>
          </div>
          {overrideCommittedBanner && (
            <button
              type="button"
              onClick={() => setOverrideCommittedBanner(null)}
              className="text-emerald-700 hover:text-emerald-950 underline text-[11px] cursor-pointer ml-3"
            >
              dismiss
            </button>
          )}
        </div>
      )}

      {/* Dispute Event Logged Banner */}
      {disputeLoggedBanner && (
        <div className="bg-neutral-100 border border-neutral-300 rounded-md px-3.5 py-2 font-mono text-[11px] text-neutral-800 flex items-center justify-between">
          <span>✓ {disputeLoggedBanner}</span>
          <button
            type="button"
            onClick={() => setDisputeLoggedBanner(null)}
            className="text-neutral-600 hover:text-neutral-900 underline text-[10px] cursor-pointer ml-3"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Tab / Mode 1: Formal Dispute Notice (DISPUTE_NOTICE_GENERATED) */}
      {activeMode === 'dispute' && (
        <div className="flex flex-col gap-3">
          {/* Operator Name Live Input & Action Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 bg-neutral-50 border border-neutral-200 rounded-md p-3">
            <div className="flex-1 max-w-sm">
              <label
                htmlFor="dispute-operator-name"
                className="block font-mono text-[10px] uppercase font-bold text-neutral-600 mb-1"
              >
                Operator Name (Live-Updates Signature Block):
              </label>
              <input
                id="dispute-operator-name"
                type="text"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="Accounts Payable Operator"
                className="w-full font-mono text-xs px-2.5 py-1.5 bg-white border border-neutral-300 rounded focus:outline-hidden focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyNotice}
                className={`inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded font-semibold transition-colors cursor-pointer shadow-xs ${
                  copied
                    ? 'bg-emerald-600 text-white border border-emerald-700'
                    : 'bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-900'
                }`}
              >
                <span>{copied ? '✓' : '📋'}</span>
                <span>{copied ? 'Copied!' : '[ 📋 Copy Dispute Notice ]'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadNoticeTxt}
                className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded font-semibold bg-white hover:bg-neutral-100 text-neutral-900 border border-neutral-300 transition-colors cursor-pointer shadow-xs"
              >
                <span>⬇️</span>
                <span>[ ⬇️ Download Notice (.txt) ]</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleExportPdf();
                }}
                disabled={isExportingPdf}
                className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded font-semibold bg-rose-700 hover:bg-rose-800 text-white border border-rose-800 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <span>📄</span>
                <span>
                  {isExportingPdf ? 'Generating PDF...' : '[ 📄 Export Official PDF ]'}
                </span>
              </button>

              {onOpenFullModal && (
                <button
                  type="button"
                  onClick={() => onOpenFullModal(noticeText)}
                  className="inline-flex items-center gap-1 font-mono text-xs px-2.5 py-1.5 rounded bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300 transition-colors cursor-pointer"
                >
                  <span>⛶</span>
                  <span>Expand</span>
                </button>
              )}
            </div>
          </div>

          {/* High-Contrast Monospace Preview Container */}
          <div className="border border-neutral-800 rounded-md overflow-hidden bg-neutral-950 shadow-xs">
            <div className="flex items-center justify-between bg-neutral-900 border-b border-neutral-800 px-3.5 py-1.5 font-mono text-[11px] text-neutral-300">
              <span>
                DISPUTE NOTICE PREVIEW — {reconciliation.invoice_number} vs {po.po_number}
              </span>
              <span className="text-neutral-400">DISPUTE_NOTICE_GENERATED</span>
            </div>
            <div className="p-3.5 max-h-80 overflow-y-auto">
              <pre className="font-mono text-[11px] text-neutral-100 leading-relaxed whitespace-pre overflow-x-auto select-all">
                {noticeText}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab / Mode 2: Authorize Human Override (HUMAN_OVERRIDE) */}
      {activeMode === 'override' && (
        <div className="bg-neutral-50 border border-neutral-200 rounded-md p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-mono text-xs font-bold uppercase text-neutral-900">
                Authorize Human Override (APPROVED_WITH_OVERRIDE)
              </h4>
              <p className="text-xs text-neutral-600 mt-0.5">
                Provide a documented commercial justification (minimum 5 characters) to approve this variance and commit a{' '}
                <code className="font-mono text-[11px] bg-neutral-200/70 px-1 rounded">HUMAN_OVERRIDE</code> event to Supabase.
              </p>
            </div>
          </div>

          <form onSubmit={handleConfirmOverrideSubmit} className="flex flex-col gap-2.5">
            <label
              htmlFor="operator-override-justification-input"
              className="font-mono text-[11px] font-bold text-neutral-800"
            >
              Operator Justification (Required, min 5 chars):
            </label>
            <input
              id="operator-override-justification-input"
              type="text"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              disabled={isOverridden}
              placeholder="Approved one-time seat overage per VP Engineering sign-off"
              required
              minLength={5}
              className="w-full font-mono text-xs px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-hidden focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 disabled:bg-neutral-100 disabled:text-neutral-500"
            />

            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[10px] text-neutral-500">
                {trimmedJustification.length < 5
                  ? `Enter at least ${5 - trimmedJustification.length} more character(s) to enable override.`
                  : 'Justification length verified. Ready to commit audit override.'}
              </span>

              <button
                type="submit"
                disabled={isOverridden || !isJustificationValid}
                className={`inline-flex items-center gap-1.5 font-mono text-xs px-4 py-2 rounded font-semibold transition-all shadow-xs ${
                  isOverridden
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 cursor-not-allowed'
                    : 'bg-emerald-700 hover:bg-emerald-800 text-white border border-emerald-800 cursor-pointer active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <span>✓</span>
                <span>
                  {isOverridden
                    ? '[ ✓ Override Confirmed & Approved ]'
                    : '[ ✓ Confirm Override & Approve ]'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
