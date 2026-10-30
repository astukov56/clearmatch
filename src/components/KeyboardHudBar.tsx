'use client';

import React from 'react';
import { OperatorCommandLog } from '../lib/hooks/useOperatorHotkeys';

interface KeyboardHudBarProps {
  lastCommand?: OperatorCommandLog | null;
  isHudVisible: boolean;
  onToggleHudVisible: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onToggleOperatorAuth?: () => void;
  isHelpModalOpen: boolean;
  onToggleHelpModal: () => void;
  onRunBenchmark: (scenario: 'verified_match' | 'float_trap' | 'ocr_guardrail') => void;
  onStageSyntheticPdf: (type: 'clean' | 'drift') => void;
  onExtractStagedFile: () => void;
  onCyclePolicy: () => void;
  onToggleView: () => void;
  onToggleAuditHistory: () => void;
  canExtract: boolean;
}

const HOTKEY_REFERENCE_LIST: { key: string; label: string; category: string }[] = [
  { key: '1', label: 'Run Benchmark 1: Verified Match ($0.00)', category: 'Benchmarks' },
  { key: '2', label: 'Run Benchmark 2: Float-Trap Drift (-$0.50)', category: 'Benchmarks' },
  { key: '3', label: 'Run Benchmark 3: OCR Guardrail (Manual Review)', category: 'Benchmarks' },
  { key: 'Q', label: 'Quick-Load Sample Clean Match PDF (INV-2026-4401)', category: 'Sample PDFs' },
  { key: 'W', label: 'Quick-Load Sample Price Drift PDF (INV-2026-4402)', category: 'Sample PDFs' },
  { key: 'E', label: 'Extract & Reconcile Staged Invoice File', category: 'Ingestion' },
  { key: 'S', label: 'Cycle STP Tolerance Policy ($0 -> $1 -> $5)', category: 'Governance' },
  { key: 'T', label: 'Toggle View: Reinforced Ledger / Trust Boundary', category: 'Inspection' },
  { key: 'H', label: 'Toggle Audit Ledger History Drawer', category: 'Audit Trail' },
  { key: 'A', label: 'Open Magic Link Sign-In Modal', category: 'Identity' },
  { key: 'C', label: 'Copy Formal Dispute Notice (when drift/review active)', category: 'Resolution' },
  { key: 'D', label: 'Toggle Light / Dark Carbon-Slate Theme', category: 'Appearance' },
  { key: 'K', label: 'Hide / Show Bottom Keyboard HUD Bar', category: 'Workspace' },
  { key: '?', label: 'Toggle Keyboard Shortcut Reference Modal', category: 'System' },
  { key: 'ESC', label: 'Close Active Modal / Drawer or Dismiss Banner', category: 'System' },
];

export default function KeyboardHudBar({
  isHudVisible,
  onToggleHudVisible,
  theme,
  onToggleTheme,
  isHelpModalOpen,
  onToggleHelpModal,
  onRunBenchmark,
  onStageSyntheticPdf,
  onExtractStagedFile,
  onCyclePolicy,
  onToggleView,
  onToggleAuditHistory,
  canExtract,
}: KeyboardHudBarProps) {
  return (
    <>
      {isHudVisible ? (
        /* Single-Line Sticky Bottom Speed-Run Triage HUD Bar */
        <div
          role="region"
          aria-label="Operator Keyboard Triage HUD"
          className="sticky bottom-0 z-30 border-t border-neutral-800 bg-neutral-950 text-neutral-200 px-4 sm:px-6 py-1.5 font-mono text-[11px] shadow-lg"
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 overflow-x-auto">
            {/* Left: Compact High-Contrast Keycap Badges */}
            <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                HUD
              </span>

              <button
                type="button"
                onClick={() => onRunBenchmark('verified_match')}
                title="Press 1, 2, or 3 to run test presets"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 transition-colors cursor-pointer"
              >
                <kbd className="text-amber-300 font-bold">[1-3]</kbd>
                <span>Presets</span>
              </button>

              <button
                type="button"
                onClick={() => onStageSyntheticPdf('clean')}
                title="Press Q (Clean Match) or W (Price Drift) to stage sample PDFs"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 transition-colors cursor-pointer"
              >
                <kbd className="text-amber-300 font-bold">[Q/W]</kbd>
                <span>Sample PDF</span>
              </button>

              <button
                type="button"
                onClick={onExtractStagedFile}
                disabled={!canExtract}
                title="Press E to extract and reconcile the staged invoice file"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                  canExtract
                    ? 'bg-neutral-900 hover:bg-neutral-800 border-neutral-700 text-white cursor-pointer'
                    : 'bg-neutral-900/40 border-neutral-800/60 text-neutral-500 cursor-not-allowed'
                }`}
              >
                <kbd className={canExtract ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                  [E]
                </kbd>
                <span>Extract</span>
              </button>

              <button
                type="button"
                onClick={onCyclePolicy}
                title="Press S to cycle STP Tolerance Policy"
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 transition-colors cursor-pointer"
              >
                <kbd className="text-amber-300 font-bold">[S]</kbd>
                <span>Policy</span>
              </button>

              <button
                type="button"
                onClick={onToggleView}
                title="Press T to toggle Reinforced Ledger / Trust Boundary view"
                className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 transition-colors cursor-pointer"
              >
                <kbd className="text-amber-300 font-bold">[T]</kbd>
                <span>Trust View</span>
              </button>

              <button
                type="button"
                onClick={onToggleAuditHistory}
                title="Press H to toggle Audit Ledger History drawer"
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 transition-colors cursor-pointer"
              >
                <kbd className="text-amber-300 font-bold">[H]</kbd>
                <span>History</span>
              </button>

              <button
                type="button"
                onClick={onToggleTheme}
                title="Press D to toggle Light / Dark mode"
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 transition-colors cursor-pointer"
              >
                <kbd className="text-amber-300 font-bold">[D]</kbd>
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleHelpModal}
                title="Press ? to view all operator keyboard shortcuts"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-100 transition-colors cursor-pointer font-semibold"
              >
                <kbd className="text-amber-300 font-bold">[?]</kbd>
                <span>Keys</span>
              </button>
            </div>

            {/* Right: [K] Hide Button */}
            <button
              type="button"
              onClick={onToggleHudVisible}
              title="Press K to collapse the bottom HUD bar"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 hover:text-white transition-colors cursor-pointer text-[11px] shrink-0"
            >
              <kbd className="text-amber-300 font-bold">[K]</kbd>
              <span>Hide</span>
            </button>
          </div>
        </div>
      ) : (
        /* Unobtrusive Floating Mini Restore Pill in Bottom-Right Corner */
        <div className="fixed bottom-4 right-4 z-40">
          <button
            type="button"
            onClick={onToggleHudVisible}
            title="Restore Operator Keyboard Triage HUD (Shortcut: K)"
            className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded-full bg-neutral-950/95 hover:bg-neutral-900 text-neutral-100 border border-neutral-700 shadow-lg transition-all cursor-pointer active:translate-y-[1px]"
          >
            <span>⌨️</span>
            <span className="font-semibold">[ ⌨️ Show HUD (K) ]</span>
          </button>
        </div>
      )}

      {/* Hotkey Reference Modal (?) */}
      {isHelpModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="hotkey-reference-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs"
          onClick={onToggleHelpModal}
        >
          <div
            className="bg-white border border-neutral-300 rounded-lg shadow-xl max-w-xl w-full overflow-hidden font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between bg-neutral-950 text-white px-5 py-3.5 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="bg-amber-400 text-neutral-950 font-bold px-2 py-0.5 rounded text-[10px]">
                  KEYBOARD TRIAGE
                </span>
                <h3
                  id="hotkey-reference-modal-title"
                  className="text-xs font-bold uppercase tracking-wider"
                >
                  Operator Shortcut Reference
                </h3>
              </div>
              <button
                type="button"
                onClick={onToggleHelpModal}
                className="text-neutral-400 hover:text-white text-xs px-2 py-0.5 rounded border border-neutral-800 hover:border-neutral-600 cursor-pointer"
              >
                [ESC]
              </button>
            </div>

            <div className="p-4 space-y-2 max-h-[75vh] overflow-y-auto text-xs">
              <p className="text-[11px] text-neutral-500 pb-2 border-b border-neutral-200 font-sans">
                Single-key shortcuts are active globally across the workbench and automatically suspended when typing inside any text input or form control.
              </p>

              <div className="divide-y divide-neutral-200/70">
                {HOTKEY_REFERENCE_LIST.map((item) => (
                  <div
                    key={item.key}
                    className="py-2 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <kbd className="bg-neutral-900 text-amber-300 font-bold text-[11px] px-2 py-0.5 rounded border border-neutral-800 shrink-0 min-w-[36px] text-center">
                        [{item.key}]
                      </kbd>
                      <span className="text-neutral-800 text-[11px] truncate font-sans font-medium">
                        {item.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral-400 uppercase shrink-0">
                      {item.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-neutral-50 border-t border-neutral-200 px-5 py-2.5 flex items-center justify-between text-[11px] text-neutral-500">
              <span>Guardrail: Disabled inside INPUT / TEXTAREA / SELECT</span>
              <button
                type="button"
                onClick={onToggleHelpModal}
                className="bg-neutral-900 hover:bg-neutral-800 text-white px-3 py-1 rounded text-xs font-semibold cursor-pointer"
              >
                Close Reference
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
