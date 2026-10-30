'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '../lib/money';
import { ReconciliationStatus } from '../lib/reconcile';
import {
  fetchRecentReconciliations,
  getReconciliationOperatorEmail,
  PersistedReconciliation,
} from '../lib/services/auditService';

interface AuditLedgerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onInspectRun: (record: PersistedReconciliation) => void;
  currentTraceId?: string | null;
  authenticatedOperatorEmail?: string | null;
  onOpenSignInModal?: () => void;
}

/**
 * Formats ISO timestamp into concise human-readable relative time string.
 */
function formatRelativeTime(dateString: string): string {
  try {
    const timestamp = new Date(dateString).getTime();
    if (isNaN(timestamp)) return dateString;

    const diffSeconds = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSeconds < 5) return 'Just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Date(dateString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

export default function AuditLedgerDrawer({
  isOpen,
  onClose,
  onInspectRun,
  currentTraceId,
  authenticatedOperatorEmail,
  onOpenSignInModal,
}: AuditLedgerDrawerProps) {
  const [records, setRecords] = useState<PersistedReconciliation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedTraceId, setCopiedTraceId] = useState<string | null>(null);
  const [filterScope, setFilterScope] = useState<'all' | 'mine'>('all');

  useEffect(() => {
    if (!authenticatedOperatorEmail) {
      setFilterScope('all');
    }
  }, [authenticatedOperatorEmail]);

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchRecentReconciliations(20);
      setRecords(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadRecords();
    }
  }, [isOpen, loadRecords]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleCopyTraceId = useCallback(async (traceId: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(traceId);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = traceId;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopiedTraceId(traceId);
      setTimeout(() => setCopiedTraceId(null), 1800);
    } catch {
      setCopiedTraceId(null);
    }
  }, []);

  const filteredRecords = useMemo(() => {
    if (filterScope === 'mine' && authenticatedOperatorEmail) {
      const targetEmail = authenticatedOperatorEmail.trim().toLowerCase();
      return records.filter(
        (rec) => getReconciliationOperatorEmail(rec).toLowerCase() === targetEmail
      );
    }
    return records;
  }, [records, filterScope, authenticatedOperatorEmail]);

  const renderBadge = (status: ReconciliationStatus) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded">
            VERIFIED MATCH
          </span>
        );
      case 'APPROVED_WITHIN_TOLERANCE':
        return (
          <span className="bg-teal-50 text-teal-800 border border-teal-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded">
            APPROVED (TOLERANCE)
          </span>
        );
      case 'APPROVED_WITH_OVERRIDE':
        return (
          <span className="bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded">
            OVERRIDE APPROVED
          </span>
        );
      case 'FLAGGED_DRIFT':
        return (
          <span className="bg-rose-50 text-rose-800 border border-rose-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded">
            DRIFT DETECTED
          </span>
        );
      case 'REQUIRES_MANUAL_REVIEW':
        return (
          <span className="bg-amber-50 text-amber-800 border border-amber-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded">
            MANUAL REVIEW
          </span>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Audit Ledger History"
      className="fixed inset-0 z-50 flex justify-end bg-neutral-900/40 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-neutral-300 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-200 bg-neutral-50/90 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block animate-pulse" />
            <div>
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900">
                Audit Ledger Triage HUD
              </h2>
              <p className="text-[11px] font-mono text-neutral-500 mt-0.5">
                PostgreSQL Immutable Audit Trail • Supabase Managed
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadRecords}
              disabled={isLoading}
              title="Refresh ledger"
              className="p-1.5 text-neutral-500 hover:text-neutral-800 rounded hover:bg-neutral-200/70 font-mono text-xs cursor-pointer disabled:opacity-50 transition-colors"
            >
              🔄
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded hover:bg-neutral-200/70 font-mono text-sm cursor-pointer transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sign-In Prompt Bar when Unauthenticated */}
        {!authenticatedOperatorEmail && (
          <div className="px-5 py-2.5 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <span className="text-[11px] font-sans text-neutral-600">
              Sign in via Magic Link to filter historical runs by <strong className="text-neutral-900">&ldquo;My Runs&rdquo;</strong>.
            </span>
            {onOpenSignInModal && (
              <button
                type="button"
                onClick={onOpenSignInModal}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-white shadow-xs transition-colors cursor-pointer shrink-0"
              >
                <span>[ Sign In ]</span>
              </button>
            )}
          </div>
        )}

        {/* Subheader info & Operator Filter Bar */}
        <div className="px-5 py-2 bg-neutral-100/70 border-b border-neutral-200 text-[11px] font-mono text-neutral-600 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span>
              {filteredRecords.length} Recorded Run{filteredRecords.length === 1 ? '' : 's'}
            </span>
            {authenticatedOperatorEmail && (
              <div className="inline-flex items-center bg-white border border-neutral-300 rounded p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setFilterScope('all')}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer font-semibold ${
                    filterScope === 'all'
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  All Runs
                </button>
                <button
                  type="button"
                  onClick={() => setFilterScope('mine')}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer font-semibold ${
                    filterScope === 'mine'
                      ? 'bg-emerald-700 text-white'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  My Runs
                </button>
              </div>
            )}
          </div>
          <span className="text-[10px] text-neutral-400">
            Click &ldquo;Inspect&rdquo; to load run state
          </span>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#fcfcfc]">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-neutral-400 font-mono text-xs gap-2">
              <div className="w-5 h-5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
              <span>Querying Supabase Audit Ledger...</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="py-12 px-6 text-center text-neutral-500 font-mono text-xs space-y-2">
              <p className="text-neutral-600 max-w-sm mx-auto leading-relaxed">
                {filterScope === 'mine'
                  ? `No reconciliation runs attributed to ${authenticatedOperatorEmail} yet. Switch to "All Runs" or execute a reconciliation.`
                  : 'No audit history recorded yet. Run a benchmark or extract an invoice to log an immutable audit entry.'}
              </p>
            </div>
          ) : (
            filteredRecords.map((rec) => {
              const isCurrentlyActive = currentTraceId && rec.trace_id === currentTraceId;
              const varianceCents = rec.total_variance_cents ?? 0;
              const invoicedCents = rec.invoiced_subtotal_cents ?? 0;
              const isOvercharge = varianceCents > 0;
              const isUndercharge = varianceCents < 0;
              const operatorEmail = getReconciliationOperatorEmail(rec);
              const isOwnRun =
                Boolean(authenticatedOperatorEmail) &&
                operatorEmail.toLowerCase() === authenticatedOperatorEmail?.trim().toLowerCase();

              return (
                <div
                  key={rec.id || rec.trace_id}
                  className={`bg-white border rounded-md p-3.5 shadow-xs transition-all ${
                    isCurrentlyActive
                      ? 'border-neutral-900 ring-1 ring-neutral-900 bg-neutral-50/30'
                      : 'border-neutral-200/90 hover:border-neutral-300'
                  }`}
                >
                  {/* Top Bar: Trace ID & Relative Timestamp */}
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-100">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-[11px] font-bold text-neutral-800 truncate">
                        {rec.trace_id}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyTraceId(rec.trace_id)}
                        className="text-neutral-400 hover:text-neutral-700 text-[11px] p-0.5 rounded cursor-pointer transition-colors"
                        title="Copy Trace ID"
                      >
                        {copiedTraceId === rec.trace_id ? '✓' : '📋'}
                      </button>
                      {isCurrentlyActive && (
                        <span className="bg-neutral-900 text-white font-mono text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold shrink-0">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-neutral-400 shrink-0">
                      {formatRelativeTime(rec.created_at)}
                    </span>
                  </div>

                  {/* Body: Contract & Financial Metrics */}
                  <div className="grid grid-cols-2 gap-2 my-2.5 text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-neutral-400 uppercase block">
                        Invoice &amp; PO
                      </span>
                      <span className="font-medium text-neutral-800 block truncate">
                        {rec.invoice_number}
                      </span>
                      <span className="text-[10px] text-neutral-500 block truncate">
                        PO: {rec.po_number}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-neutral-400 uppercase block">
                        Variance Drift
                      </span>
                      <span
                        className={`font-bold block ${
                          isOvercharge
                            ? 'text-rose-700'
                            : isUndercharge
                            ? 'text-emerald-700'
                            : 'text-neutral-700'
                        }`}
                      >
                        {formatCurrency(varianceCents, { showPositiveSign: true })}
                      </span>
                      <span className="text-[10px] text-neutral-500 block">
                        Inv: {formatCurrency(invoicedCents)}
                      </span>
                    </div>
                  </div>

                  {/* Vendor & Status Badge */}
                  <div className="flex items-center justify-between pt-2 border-t border-neutral-100 text-[11px] font-mono">
                    <span
                      className="text-neutral-600 truncate max-w-[200px]"
                      title={rec.vendor_name}
                    >
                      {rec.vendor_name}
                    </span>
                    <div>{renderBadge(rec.status)}</div>
                  </div>

                  {/* Action Bar with Recorded Operator Attribution Badge */}
                  <div className="mt-2.5 pt-2 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span
                        title={`Recorded Operator: ${operatorEmail}`}
                        className={`inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded border truncate max-w-[240px] ${
                          isOwnRun
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                            : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                        }`}
                      >
                        <span>👤</span>
                        <span className="truncate">{operatorEmail}</span>
                      </span>
                      <span className="text-[10px] font-mono text-neutral-400">
                        • {rec.tolerance_policy_id}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onInspectRun(rec)}
                      className="inline-flex items-center gap-1 font-mono text-xs px-2.5 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 shadow-xs transition-colors cursor-pointer font-medium active:translate-y-[1px]"
                    >
                      <span>🔍</span>
                      <span>Inspect Run</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
          <span className="font-mono text-[11px] text-neutral-500">
            ClearMatch Audit Trail Ledger
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs px-3.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 shadow-xs transition-colors cursor-pointer font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
