'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PurchaseOrder } from '../lib/reconcile';
import {
  PurchaseOrderSchema,
  PURCHASE_ORDER_PRESETS,
  PurchaseOrderPreset,
} from '../lib/constants/purchaseOrders';

interface PoBaselineModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePO: PurchaseOrder;
  onApply: (newPO: PurchaseOrder) => void;
}

export default function PoBaselineModal({
  isOpen,
  onClose,
  activePO,
  onApply,
}: PoBaselineModalProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('PO-2026-0881');
  const [jsonText, setJsonText] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);

  // Sync state whenever the modal opens or activePO changes
  useEffect(() => {
    if (isOpen) {
      // Find matching preset or default to CUSTOM
      const matched = PURCHASE_ORDER_PRESETS.find(
        (p) => p.po.po_number === activePO.po_number
      );
      setSelectedPresetId(matched ? matched.id : 'CUSTOM');
      setJsonText(JSON.stringify(activePO, null, 2));
      setValidationErrors(null);
    }
  }, [isOpen, activePO]);

  // Handle ESC key press
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

  // Quick preset selection
  const handleSelectPreset = useCallback((presetId: string) => {
    setSelectedPresetId(presetId);
    setValidationErrors(null);
    const preset = PURCHASE_ORDER_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setJsonText(JSON.stringify(preset.po, null, 2));
    }
  }, []);

  // Textarea edit handler
  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setJsonText(e.target.value);
    setValidationErrors(null);
    // If text modified away from preset, designate as CUSTOM
    const currentPreset = PURCHASE_ORDER_PRESETS.find((p) => p.id === selectedPresetId);
    if (currentPreset && e.target.value !== JSON.stringify(currentPreset.po, null, 2)) {
      setSelectedPresetId('CUSTOM');
    }
  };

  // Re-format JSON button
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setValidationErrors(null);
    } catch (err) {
      setValidationErrors([
        `JSON Syntax Error: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
      ]);
    }
  };

  // Reset to currently selected preset
  const handleResetToPreset = () => {
    const preset = PURCHASE_ORDER_PRESETS.find((p) => p.id === selectedPresetId);
    if (preset) {
      setJsonText(JSON.stringify(preset.po, null, 2));
      setValidationErrors(null);
    }
  };

  // Validate with Zod and apply
  const handleApply = () => {
    setValidationErrors(null);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (err) {
      setValidationErrors([
        `Malformed JSON: ${err instanceof Error ? err.message : 'Unexpected parsing error'}`,
      ]);
      return;
    }

    const result = PurchaseOrderSchema.safeParse(parsedJson);

    if (!result.success) {
      const formattedErrors = result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `${path}: ${issue.message}`;
      });
      setValidationErrors(formattedErrors);
      return;
    }

    // Successfully validated against PurchaseOrderSchema
    onApply(result.data as PurchaseOrder);
    onClose();
  };

  if (!isOpen) return null;

  const activePreset = PURCHASE_ORDER_PRESETS.find((p) => p.id === selectedPresetId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="po-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-neutral-300 rounded-lg shadow-2xl max-w-3xl w-full flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5 bg-neutral-50/80">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
            <div>
              <h3
                id="po-modal-title"
                className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900 flex items-center gap-2"
              >
                PO Baseline Contract Editor
                <span className="bg-neutral-200 text-neutral-700 font-mono text-[10px] px-1.5 py-0.2 rounded font-normal">
                  {activePO.po_number}
                </span>
              </h3>
              <p className="text-[11px] font-mono text-neutral-500 mt-0.5">
                Configure baseline purchase order contract values used for deterministic cross-checking
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close PO editor modal"
            className="text-neutral-400 hover:text-neutral-700 font-mono text-sm p-1 rounded hover:bg-neutral-200/60 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Quick Preset Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-600">
                Procurement Baseline Preset:
              </span>
              <span className="text-[10px] font-mono text-neutral-400">
                Switch presets or edit JSON below
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PURCHASE_ORDER_PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`text-left p-2.5 rounded border transition-all cursor-pointer font-mono ${
                      isSelected
                        ? 'border-neutral-900 bg-neutral-900 text-white shadow-xs'
                        : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-800'
                    }`}
                  >
                    <div className="font-bold text-xs truncate">{preset.name}</div>
                    <div
                      className={`text-[10px] truncate mt-0.5 ${
                        isSelected ? 'text-neutral-300' : 'text-neutral-500'
                      }`}
                    >
                      {preset.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preset Context Info */}
          {activePreset && (
            <div className="bg-neutral-50 border border-neutral-200 rounded p-2.5 text-xs font-mono flex items-center justify-between text-neutral-600">
              <span className="truncate">
                Active Template: <strong className="text-neutral-900">{activePreset.label}</strong>
              </span>
              <span className="text-[11px] text-neutral-500 shrink-0 ml-2">
                {activePreset.po.items.length} Line Items • Total: $
                {(activePreset.po.total_cents / 100).toFixed(2)}
              </span>
            </div>
          )}

          {/* Monospace JSON Editor Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-600">
                Purchase Order Contract JSON:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleFormatJson}
                  className="text-[11px] font-mono text-neutral-600 hover:text-neutral-900 bg-white hover:bg-neutral-100 border border-neutral-300 rounded px-2 py-0.5 transition-colors cursor-pointer"
                >
                  Format JSON
                </button>
                <button
                  type="button"
                  onClick={handleResetToPreset}
                  className="text-[11px] font-mono text-neutral-600 hover:text-neutral-900 bg-white hover:bg-neutral-100 border border-neutral-300 rounded px-2 py-0.5 transition-colors cursor-pointer"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="relative">
              <textarea
                value={jsonText}
                onChange={handleJsonChange}
                spellCheck={false}
                rows={14}
                className="w-full font-mono text-xs p-3.5 bg-neutral-950 text-neutral-100 rounded-md border border-neutral-800 focus:outline-hidden focus:ring-1 focus:ring-neutral-400 focus:border-neutral-400 shadow-inner leading-relaxed resize-y"
                placeholder="Enter valid PurchaseOrder JSON..."
              />
            </div>

            <p className="text-[10px] font-mono text-neutral-500">
              * Engineering Invariant #2: All monetary fields (<code className="text-neutral-700 font-semibold">unit_price_cents</code>, <code className="text-neutral-700 font-semibold">subtotal_cents</code>, <code className="text-neutral-700 font-semibold">tax_cents</code>, <code className="text-neutral-700 font-semibold">total_cents</code>) must be strictly non-negative integers.
            </p>
          </div>

          {/* Inline Validation Guardrail Errors */}
          {validationErrors && validationErrors.length > 0 && (
            <div className="bg-rose-50 border border-rose-300 rounded-md p-3.5 text-xs font-mono text-rose-900 animate-in fade-in duration-100">
              <div className="flex items-center gap-2 font-bold text-rose-800 text-[11px] mb-1.5 uppercase">
                <span>⚠️ [SCHEMA_VALIDATION_ERROR]:</span>
                <span>The PO JSON contract failed Zod validation ({validationErrors.length} issues)</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-rose-700 max-h-36 overflow-y-auto">
                {validationErrors.map((err, idx) => (
                  <li key={idx} className="leading-snug">
                    <span className="font-semibold">{err}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3 bg-neutral-50">
          <span className="text-[11px] font-mono text-neutral-500">
            Validated against <code className="text-neutral-700 font-semibold">PurchaseOrderSchema</code>
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center font-mono text-xs px-3.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 shadow-xs transition-colors cursor-pointer font-medium"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 font-mono text-xs px-4 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 text-white shadow-xs transition-all cursor-pointer font-medium active:translate-y-[1px]"
            >
              <span>✓</span>
              <span>Apply Baseline &amp; Reconcile</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
