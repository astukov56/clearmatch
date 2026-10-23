'use client';

import React, { useState, useRef, useCallback } from 'react';
import { formatCurrency } from '../lib/money';
import {
  ReconciliationResult,
  ReconciledLineItem,
  ReconciliationStatus,
  POLineItem,
} from '../lib/reconcile';
import { ExtractedInvoice } from '../lib/extraction/schemas';
import samplePOJson from '../../fixtures/po_sample_01.json';

interface POFixture {
  id: string;
  po_number: string;
  vendor_name: string;
  currency: string;
  issue_date: string;
  items: POLineItem[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
}

const activePO = samplePOJson as POFixture;

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

export default function ClearMatchOperatorWorkbench() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [errorBanner, setErrorBanner] = useState<{ code: string; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'ledger' | 'trust_boundary'>('ledger');

  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [rawExtraction, setRawExtraction] = useState<ExtractedInvoice | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const executeReconciliation = useCallback(
    async (fileToSubmit: File, isSample = false, scenario?: string) => {
      setIsLoading(true);
      setErrorBanner(null);
      setLoadingText(
        isSample
          ? `Executing benchmark scenario [${scenario || 'default'}]...`
          : 'Running Gemini 3.8 Flash OCR entity extraction...'
      );

      try {
        const formData = new FormData();
        formData.append('file', fileToSubmit);
        formData.append('po_id', activePO.id);
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
          const message =
            result.error?.message || 'Reconciliation service encountered an unexpected error.';
          setErrorBanner({ code, message });
          return;
        }

        setReconciliation(result.data.reconciliation);
        setRawExtraction(result.data.raw_extraction);
      } catch (err) {
        setErrorBanner({
          code: 'NETWORK_ERROR',
          message:
            err instanceof Error ? err.message : 'Unable to connect to reconciliation API endpoint.',
        });
      } finally {
        setIsLoading(false);
        setLoadingText('');
      }
    },
    []
  );

  const handleFileSelection = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setReconciliation(null);
      setRawExtraction(null);
      setErrorBanner(null);

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

      executeReconciliation(file, false);
    },
    [executeReconciliation]
  );

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

  const handleRunBenchmark = async (scenario: 'verified_match' | 'float_trap' | 'ocr_guardrail') => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    const sampleFile = await generateSampleInvoicePng();
    executeReconciliation(sampleFile, true, scenario);
  };

  const handleManualUpload = () => {
    if (!selectedFile || selectedFile.size === 0) return;
    executeReconciliation(selectedFile, false);
  };

  // Invoiced subtotal in integer cents deterministically from reconciliation
  const invoicedSubtotalCents = reconciliation
    ? reconciliation.invoiced_subtotal_cents ??
      reconciliation.line_items.reduce((sum, item) => sum + item.invoiced_line_total_cents, 0)
    : 0;

  const totalVarianceCents = reconciliation ? reconciliation.total_variance_cents : 0;

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
      case 'REQUIRES_MANUAL_REVIEW':
        return (
          <span className="bg-amber-100 text-amber-800 border border-amber-300 font-mono text-xs font-bold px-2.5 py-1 rounded inline-block">
            MANUAL REVIEW
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
    <div className="min-h-screen bg-[#fafafa] text-neutral-900 flex flex-col font-sans">
      {/* 1. Top Navigation Bar */}
      <header className="border-b border-neutral-200 bg-white px-6 py-3 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Left wordmark and deterministic badge */}
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight text-neutral-900">ClearMatch</span>
            <span className="bg-neutral-100 text-neutral-600 font-mono text-xs px-2 py-0.5 rounded border border-neutral-200/80">
              v0.1-deterministic
            </span>
          </div>

          {/* Right system status chips */}
          <div className="hidden sm:flex items-center gap-2 font-mono text-xs text-neutral-500">
            <span className="bg-neutral-50 border border-neutral-200 px-2 py-0.5 rounded">
              ENGINE: INTEGER-CENTS
            </span>
            <span className="text-neutral-300 select-none">•</span>
            <span className="bg-neutral-50 border border-neutral-200 px-2 py-0.5 rounded">
              OCR: GEMINI-3.8-FLASH
            </span>
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
            <span className="text-[11px] font-mono text-neutral-400">PO-2026-0881</span>
          </div>

          {/* Action Bar: Ingestion Contract & Architecture Verification Suite & Dropzone */}
          <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs flex flex-col gap-3.5">
            {/* Ingestion Contract Checklist */}
            <div className="bg-neutral-50 border border-neutral-200/80 rounded p-2.5 text-[11px] font-mono space-y-1.5">
              <div className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">
                Ingestion Contract Checklist
              </div>
              <div className="flex items-start gap-1.5 text-neutral-700">
                <span className="text-emerald-600 font-bold shrink-0">✓</span>
                <span>
                  <strong className="text-neutral-900">SCOPE:</strong> Single Invoice PDF/PNG/JPG (1 Invoice : 1 PO)
                </span>
              </div>
              <div className="flex items-start gap-1.5 text-neutral-700">
                <span className="text-emerald-600 font-bold shrink-0">✓</span>
                <span>
                  <strong className="text-neutral-900">CONTENT:</strong> Must contain itemized Qty &amp; Unit Price column
                </span>
              </div>
              <div className="flex items-start gap-1.5 text-neutral-700">
                <span className="text-emerald-600 font-bold shrink-0">✓</span>
                <span>
                  <strong className="text-neutral-900">LIMITS:</strong> Max 4.0 MB • Max 50 line items (8K JSON token guard)
                </span>
              </div>
            </div>

            {/* Architecture Verification Suite (3 Benchmark Buttons) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold text-neutral-500 tracking-wider">
                  Architecture Verification Suite
                </span>
                <span className="text-[10px] font-mono text-neutral-400">Instant Benchmarks</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleRunBenchmark('verified_match')}
                  disabled={isLoading}
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-neutral-300 p-2 rounded text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-mono font-medium text-neutral-800 text-[11px] group-hover:text-neutral-900">
                      1. Verified Match ($0.00)
                    </div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      10x M8 Bolts @ $12.50, 4x Bearings @ $45.00
                    </div>
                  </div>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
                    APPROVED
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRunBenchmark('float_trap')}
                  disabled={isLoading}
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-neutral-300 p-2 rounded text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-mono font-medium text-neutral-800 text-[11px] group-hover:text-neutral-900">
                      2. Float-Trap Drift (-$0.50)
                    </div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      10x @ $12.79, 4x @ $44.15 (IEEE 754 drift)
                    </div>
                  </div>
                  <span className="bg-rose-50 text-rose-700 border border-rose-200 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
                    FLAGGED_DRIFT
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRunBenchmark('ocr_guardrail')}
                  disabled={isLoading}
                  className="w-full text-left bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-neutral-300 p-2 rounded text-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between group"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-mono font-medium text-neutral-800 text-[11px] group-hover:text-neutral-900">
                      3. OCR Guardrail (Ambiguous Scan)
                    </div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      Confidence 0.78 • Obscured line price
                    </div>
                  </div>
                  <span className="bg-amber-50 text-amber-700 border border-amber-200 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
                    MANUAL_REVIEW
                  </span>
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="relative flex items-center justify-center my-0.5">
              <div className="border-t border-neutral-200 w-full" />
              <span className="bg-white px-2 font-mono text-[10px] uppercase text-neutral-400 absolute">
                or upload live invoice
              </span>
            </div>

            {/* File Dropzone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-dashed border-neutral-300 hover:border-neutral-400 bg-neutral-50/50 rounded-lg p-5 text-center text-sm cursor-pointer transition-colors ${
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

            <button
              type="button"
              onClick={handleManualUpload}
              disabled={!selectedFile || selectedFile.size === 0 || isLoading}
              className={`w-full font-medium text-xs py-2.5 px-3 rounded-md transition-all flex items-center justify-center gap-2 ${
                selectedFile && selectedFile.size > 0 && !isLoading
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800 border border-neutral-900 shadow-sm cursor-pointer active:translate-y-[1px]'
                  : 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
              }`}
            >
              {isLoading && (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              <span>{isLoading ? 'Processing Extraction...' : 'Extract & Reconcile File'}</span>
            </button>
          </div>

          {/* Active PO Baseline Card */}
          <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs">
            <div className="flex items-center justify-between pb-2.5 border-b border-neutral-200">
              <span className="font-mono font-bold text-xs text-neutral-900">
                PO-2026-0881
              </span>
              <span className="bg-neutral-100 text-neutral-700 font-mono text-[10px] px-1.5 py-0.5 rounded border border-neutral-200">
                AUTHORIZED
              </span>
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
                  {formatCurrency(activePO.subtotal_cents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Tax (1000 bps):</span>
                <span className="font-mono text-neutral-900 font-medium">
                  {formatCurrency(activePO.tax_cents)}
                </span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-neutral-200 font-semibold">
                <span className="text-neutral-800">Total:</span>
                <span className="font-mono text-neutral-900">
                  {formatCurrency(activePO.total_cents)}
                </span>
              </div>
            </div>

            {/* 2 Contracted PO Line Items */}
            <div className="mt-4 pt-3 border-t border-neutral-200">
              <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 block mb-2 font-medium">
                Contracted Items (2)
              </span>
              <div className="space-y-1.5">
                {activePO.items.map((poItem) => (
                  <div
                    key={poItem.sku}
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
                      {formatCurrency(poItem.unit_price_cents)}/ea
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
                <span className="text-[10px] text-neutral-400 font-normal hidden sm:inline">(Raw VLM vs Engine)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {reconciliation ? (
                <span className="text-[11px] font-mono text-neutral-500">
                  STATUS: <strong className="text-neutral-800">{reconciliation.status}</strong>
                </span>
              ) : (
                <span className="text-[11px] font-mono text-neutral-400">
                  Integer Arithmetic Engine
                </span>
              )}
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

          {/* Clean Dotted Empty State */}
          {!reconciliation && !isLoading && (
            <div className="border border-dashed border-neutral-300 bg-white rounded-md p-8 text-center shadow-xs">
              <div className="max-w-md mx-auto">
                <span className="font-mono text-xs text-neutral-400 block mb-1">
                  NO ACTIVE RECONCILIATION
                </span>
                <p className="text-sm font-semibold text-neutral-800 mb-1">
                  Deterministic Ingestion &amp; Reconciliation Workbench
                </p>
                <p className="text-xs text-neutral-500 leading-relaxed mb-4">
                  Select an invoice file or load an instant benchmark from the{' '}
                  <strong className="text-neutral-700">Architecture Verification Suite</strong> on the left to inspect the boundary between non-deterministic VLM extraction and deterministic integer math.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRunBenchmark('verified_match')}
                    className="inline-flex items-center gap-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-mono text-[11px] px-2.5 py-1.5 rounded border border-neutral-300 transition-colors cursor-pointer"
                  >
                    <span>1. Verified Match ($0.00)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunBenchmark('float_trap')}
                    className="inline-flex items-center gap-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-mono text-[11px] px-2.5 py-1.5 rounded border border-neutral-300 transition-colors cursor-pointer"
                  >
                    <span>2. Float-Trap Drift (-$0.50)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRunBenchmark('ocr_guardrail')}
                    className="inline-flex items-center gap-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-mono text-[11px] px-2.5 py-1.5 rounded border border-neutral-300 transition-colors cursor-pointer"
                  >
                    <span>3. OCR Guardrail</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 1: Reinforced Ledger Content */}
          {reconciliation && !isLoading && activeTab === 'ledger' && (
            <div className="flex flex-col gap-4">
              {/* Header Row: Document Identifiers & Flat Status Chip */}
              <div className="bg-white border border-neutral-200/80 rounded-md p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-neutral-500">MATCH:</span>
                  <span className="font-mono text-xs font-bold text-neutral-900">
                    {reconciliation.invoice_number}
                  </span>
                  <span className="text-neutral-300 font-mono">against</span>
                  <span className="font-mono text-xs font-bold text-neutral-700">
                    {reconciliation.po_number}
                  </span>
                  <span className="text-neutral-300">•</span>
                  <span className="text-xs text-neutral-600 font-medium">
                    {reconciliation.vendor_name}
                  </span>
                </div>

                <div>{renderStatusBadge(reconciliation.status)}</div>
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
                      {formatCurrency(invoicedSubtotalCents)}
                    </span>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">
                      vs {formatCurrency(activePO.subtotal_cents)}
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
                      {formatCurrency(totalVarianceCents, { showPositiveSign: true })}
                    </span>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">
                      ({totalVarianceCents > 0 ? '+' : ''}{totalVarianceCents}¢)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-400 block mt-1">
                    {totalVarianceCents === 0
                      ? 'Exact zero-drift match'
                      : `Pre-tax variance: ${formatCurrency(totalVarianceCents, { showPositiveSign: true })}`}
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
                    {rawExtraction && rawExtraction.unresolved_ambiguities.length === 0
                      ? 'Zero visual ambiguities'
                      : `${rawExtraction?.unresolved_ambiguities.length} ambiguities noted`}
                  </span>
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
                      {reconciliation.line_items.map((line, idx) => {
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
                                {formatCurrency(line.invoiced_unit_price_cents)}
                              </span>{' '}
                              <span className="text-neutral-400 text-[10px]">
                                / {formatCurrency(line.expected_unit_price_cents)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {hasVariance ? (
                                <span className="bg-rose-50 text-rose-700 font-mono font-medium text-[11px] px-1.5 py-0.5 rounded border border-rose-200/60 tabular-nums">
                                  {formatCurrency(line.variance_unit_price_cents, { showPositiveSign: true })}
                                </span>
                              ) : (
                                <span className="font-mono text-neutral-400 tabular-nums">$0.00</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-neutral-900 tabular-nums">
                              {formatCurrency(line.invoiced_line_total_cents)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unmatched Contract Lines if any */}
              {reconciliation.unmatched_po_items.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs">
                  <span className="font-mono font-bold text-amber-800 uppercase text-[11px] block mb-1.5">
                    Unmatched Contract Items on PO ({reconciliation.unmatched_po_items.length})
                  </span>
                  <div className="space-y-1">
                    {reconciliation.unmatched_po_items.map((item) => (
                      <div
                        key={item.sku}
                        className="flex justify-between items-center bg-white p-2 rounded border border-amber-200/60"
                      >
                        <span className="font-medium text-neutral-800">
                          {item.description} ({item.sku}) • Qty: {item.quantity}
                        </span>
                        <span className="font-mono text-neutral-700 font-semibold">
                          {formatCurrency(item.total_cents)}
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
                    AUDIT TRAIL ({reconciliation.audit_notes.length} NOTES)
                  </span>
                  <span className="text-[10px] text-neutral-400">TRACE ID: LOG-{activePO.po_number}</span>
                </div>

                <div className="space-y-1">
                  {reconciliation.audit_notes.length === 0 ? (
                    <p className="text-neutral-400 text-[11px] italic">No anomalies logged by reconciliation engine.</p>
                  ) : (
                    reconciliation.audit_notes.map((note, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                        <span className="text-neutral-400 select-none">&gt;</span>
                        <span>{note}</span>
                      </div>
                    ))
                  )}
                </div>
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
                      Gemini 3.8 Flash
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
                        {rawExtraction && rawExtraction.unresolved_ambiguities.length > 0 ? (
                          <span className="text-amber-700 underline decoration-amber-400">
                            {rawExtraction.unresolved_ambiguities.join(', ')}
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
                      {rawExtraction?.items.map((item, idx) => (
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
                      {reconciliation.line_items.map((line, idx) => (
                        <div key={idx} className="bg-neutral-50 border border-neutral-200 rounded p-2 text-[11px]">
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="font-medium text-neutral-900 truncate">
                              SKU: <strong className="text-neutral-900">{line.po_sku || 'UNMATCHED'}</strong>
                            </span>
                            <span className="font-bold">
                              {line.variance_unit_price_cents !== 0 ? (
                                <span className="text-rose-700">
                                  Variance: {formatCurrency(line.variance_unit_price_cents, { showPositiveSign: true })}
                                </span>
                              ) : (
                                <span className="text-emerald-700">Zero Drift</span>
                              )}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-[10px] text-neutral-600">
                            <div>Invoiced: {line.invoiced_unit_price_cents}¢ ({formatCurrency(line.invoiced_unit_price_cents)})</div>
                            <div>Expected PO: {line.expected_unit_price_cents}¢ ({formatCurrency(line.expected_unit_price_cents)})</div>
                            <div className="col-span-2 text-neutral-500 pt-0.5 border-t border-neutral-200/40">
                              Calculated Total: {line.invoiced_quantity} × {line.invoiced_unit_price_cents}¢ = {line.invoiced_line_total_cents}¢ ({formatCurrency(line.invoiced_line_total_cents)})
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
                    <div>Invoiced Subtotal: <strong className="text-neutral-900">{invoicedSubtotalCents}¢</strong> ({formatCurrency(invoicedSubtotalCents)})</div>
                    <div>Baseline PO Subtotal: <strong className="text-neutral-900">{activePO.subtotal_cents}¢</strong> ({formatCurrency(activePO.subtotal_cents)})</div>
                    <div>Exact Net Variance: <strong className={totalVarianceCents !== 0 ? 'text-rose-700' : 'text-emerald-700'}>{totalVarianceCents > 0 ? '+' : ''}{totalVarianceCents}¢ ({formatCurrency(totalVarianceCents, { showPositiveSign: true })})</strong></div>
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
    </div>
  );
}
