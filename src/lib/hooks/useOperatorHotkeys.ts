import { useEffect } from 'react';
import { TolerancePolicy, TOLERANCE_PRESETS } from '../types/tolerance';

export interface OperatorCommandLog {
  key: string;
  command: string;
  timestamp: string;
}

export interface OperatorHotkeyHandlers {
  onRunBenchmark: (scenario: 'verified_match' | 'float_trap' | 'ocr_guardrail') => void;
  onStageSyntheticPdf: (type: 'clean' | 'drift') => void;
  onExtractStagedFile: () => boolean;
  onToggleAuditHistory: () => void;
  onCycleTolerancePolicy: () => string;
  onToggleLedgerView: () => string;
  onCopyDisputeNotice: () => boolean;
  onToggleHud?: () => boolean;
  onToggleTheme?: () => 'light' | 'dark';
  onToggleOperatorAuth?: () => void;
  onToggleHelpModal: () => void;
  onEscape: () => void;
  onCommandTriggered?: (entry: OperatorCommandLog) => void;
}

const STP_POLICY_CYCLE_ORDER: TolerancePolicy[] = [
  TOLERANCE_PRESETS.STRICT_ZERO,
  TOLERANCE_PRESETS.STANDARD_AP,
  TOLERANCE_PRESETS.HIGH_VOLUME,
];

/**
 * Deterministically returns the next STP TolerancePolicy in the cycle:
 * Strict ($0.00) -> Standard AP ($1.00) -> High-Volume ($5.00) -> Strict ($0.00).
 */
export function getNextTolerancePolicy(currentPolicyId: string): TolerancePolicy {
  const currentIndex = STP_POLICY_CYCLE_ORDER.findIndex((p) => p.id === currentPolicyId);
  if (currentIndex === -1) {
    return STP_POLICY_CYCLE_ORDER[0];
  }
  const nextIndex = (currentIndex + 1) % STP_POLICY_CYCLE_ORDER.length;
  return STP_POLICY_CYCLE_ORDER[nextIndex];
}

/**
 * Returns true if the given event target or active element is an editable form control
 * (INPUT, TEXTAREA, SELECT, or contentEditable), preventing hotkeys from firing while typing.
 */
export function isEditableElement(element: EventTarget | Element | null): boolean {
  if (!element || typeof element !== 'object') {
    return false;
  }

  const el = element as HTMLElement;
  const tagName = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';

  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (el.isContentEditable) {
    return true;
  }

  if (typeof el.getAttribute === 'function') {
    const contentEditableAttr = el.getAttribute('contenteditable');
    if (contentEditableAttr === '' || contentEditableAttr?.toLowerCase() === 'true') {
      return true;
    }
  }

  return false;
}

/**
 * Formats an ISO or Date object into a compact HH:MM:SS timestamp for the HUD bar.
 */
export function formatHudTimestamp(date: Date = new Date()): string {
  return date.toTimeString().split(' ')[0] || '00:00:00';
}

/**
 * Pure dispatcher that evaluates a keyboard event against the operator hotkey table.
 * Returns the triggered OperatorCommandLog if handled, or null if ignored.
 */
export function dispatchOperatorKeyEvent(
  event: {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
    preventDefault?: () => void;
  },
  activeElement: Element | null,
  handlers: OperatorHotkeyHandlers,
  now: Date = new Date()
): OperatorCommandLog | null {
  // Preserve native browser shortcuts when Ctrl, Cmd, or Alt is held
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  // Strictly ignore hotkeys when typing inside inputs, textareas, selects, or contentEditable
  if (isEditableElement(event.target ?? null) || isEditableElement(activeElement)) {
    return null;
  }

  const rawKey = event.key;
  const lowerKey = rawKey.toLowerCase();
  const timestamp = formatHudTimestamp(now);

  const recordCmd = (keyLabel: string, actionCode: string): OperatorCommandLog => {
    const entry: OperatorCommandLog = {
      key: keyLabel,
      command: `KEY_CMD: [${keyLabel}] -> ${actionCode}`,
      timestamp,
    };
    handlers.onCommandTriggered?.(entry);
    return entry;
  };

  if (rawKey === '1') {
    event.preventDefault?.();
    handlers.onRunBenchmark('verified_match');
    return recordCmd('1', 'LOAD_BENCHMARK_VERIFIED_MATCH');
  }

  if (rawKey === '2') {
    event.preventDefault?.();
    handlers.onRunBenchmark('float_trap');
    return recordCmd('2', 'LOAD_BENCHMARK_FLOAT_DRIFT');
  }

  if (rawKey === '3') {
    event.preventDefault?.();
    handlers.onRunBenchmark('ocr_guardrail');
    return recordCmd('3', 'LOAD_BENCHMARK_OCR_GUARDRAIL');
  }

  if (lowerKey === 'q') {
    event.preventDefault?.();
    handlers.onStageSyntheticPdf('clean');
    return recordCmd('Q', 'STAGE_PDF_CLEAN_4401');
  }

  if (lowerKey === 'w') {
    event.preventDefault?.();
    handlers.onStageSyntheticPdf('drift');
    return recordCmd('W', 'STAGE_PDF_DRIFT_4402');
  }

  if (lowerKey === 'e') {
    const triggered = handlers.onExtractStagedFile();
    if (triggered) {
      event.preventDefault?.();
      return recordCmd('E', 'EXTRACT_AND_RECONCILE_FILE');
    }
    return recordCmd('E', 'EXTRACT_SKIPPED_NO_STAGED_FILE');
  }

  if (lowerKey === 'h') {
    event.preventDefault?.();
    handlers.onToggleAuditHistory();
    return recordCmd('H', 'TOGGLE_AUDIT_LEDGER_HISTORY');
  }

  if (lowerKey === 's') {
    event.preventDefault?.();
    const nextPolicyName = handlers.onCycleTolerancePolicy();
    return recordCmd('S', `CYCLE_STP_POLICY (${nextPolicyName})`);
  }

  if (lowerKey === 't') {
    event.preventDefault?.();
    const nextView = handlers.onToggleLedgerView();
    return recordCmd('T', `TOGGLE_VIEW_${nextView.toUpperCase()}`);
  }

  if (lowerKey === 'c') {
    const copied = handlers.onCopyDisputeNotice();
    if (copied) {
      event.preventDefault?.();
      return recordCmd('C', 'COPY_DISPUTE_NOTICE');
    }
    return null;
  }

  if (lowerKey === 'k') {
    if (handlers.onToggleHud) {
      event.preventDefault?.();
      const isVisible = handlers.onToggleHud();
      return recordCmd('K', isVisible ? 'SHOW_HUD_BAR' : 'HIDE_HUD_BAR');
    }
    return null;
  }

  if (lowerKey === 'd') {
    if (handlers.onToggleTheme) {
      event.preventDefault?.();
      const nextTheme = handlers.onToggleTheme();
      return recordCmd('D', `SWITCH_THEME_${nextTheme.toUpperCase()}`);
    }
    return null;
  }

  if (lowerKey === 'a') {
    if (handlers.onToggleOperatorAuth) {
      event.preventDefault?.();
      handlers.onToggleOperatorAuth();
      return recordCmd('A', 'TOGGLE_OPERATOR_AUTH_MODAL');
    }
    return null;
  }

  if (rawKey === '?') {
    event.preventDefault?.();
    handlers.onToggleHelpModal();
    return recordCmd('?', 'TOGGLE_HOTKEY_REFERENCE');
  }

  if (rawKey === 'Escape') {
    handlers.onEscape();
    return recordCmd('ESC', 'DISMISS_ACTIVE_OVERLAY');
  }

  return null;
}

/**
 * Global React hook that registers the deterministic keyboard triage dispatcher.
 */
export function useOperatorHotkeys(handlers: OperatorHotkeyHandlers): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      dispatchOperatorKeyEvent(event, activeEl, handlers);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlers]);
}
