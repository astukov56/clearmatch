import { describe, it, expect, vi } from 'vitest';
import {
  dispatchOperatorKeyEvent,
  getNextTolerancePolicy,
  isEditableElement,
  OperatorHotkeyHandlers,
} from '../hooks/useOperatorHotkeys';
import { TOLERANCE_PRESETS } from '../types/tolerance';

describe('useOperatorHotkeys dispatcher & guards', () => {
  function createMockHandlers(
    overrides: Partial<OperatorHotkeyHandlers> = {}
  ): OperatorHotkeyHandlers {
    return {
      onRunBenchmark: vi.fn(),
      onStageSyntheticPdf: vi.fn(),
      onExtractStagedFile: vi.fn(() => true),
      onToggleAuditHistory: vi.fn(),
      onCycleTolerancePolicy: vi.fn(() => 'Standard AP ($1.00 / 100 bps)'),
      onToggleLedgerView: vi.fn(() => 'trust_boundary'),
      onCopyDisputeNotice: vi.fn(() => true),
      onToggleHelpModal: vi.fn(),
      onToggleHud: vi.fn(() => false),
      onToggleTheme: vi.fn<() => 'light' | 'dark'>(() => 'dark'),
      onToggleOperatorAuth: vi.fn(),
      onEscape: vi.fn(),
      onCommandTriggered: vi.fn(),
      ...overrides,
    };
  }

  it('cycles STP tolerance policies deterministically ($0 -> $1 -> $5 -> $0)', () => {
    const step1 = getNextTolerancePolicy(TOLERANCE_PRESETS.STRICT_ZERO.id);
    expect(step1.id).toBe(TOLERANCE_PRESETS.STANDARD_AP.id);

    const step2 = getNextTolerancePolicy(step1.id);
    expect(step2.id).toBe(TOLERANCE_PRESETS.HIGH_VOLUME.id);

    const step3 = getNextTolerancePolicy(step2.id);
    expect(step3.id).toBe(TOLERANCE_PRESETS.STRICT_ZERO.id);
  });

  it('identifies INPUT, TEXTAREA, SELECT, and contentEditable elements as editable', () => {
    expect(isEditableElement({ tagName: 'INPUT' } as unknown as Element)).toBe(true);
    expect(isEditableElement({ tagName: 'TEXTAREA' } as unknown as Element)).toBe(true);
    expect(isEditableElement({ tagName: 'SELECT' } as unknown as Element)).toBe(true);
    expect(
      isEditableElement({
        tagName: 'DIV',
        isContentEditable: true,
      } as unknown as Element)
    ).toBe(true);
    expect(isEditableElement({ tagName: 'BUTTON' } as unknown as Element)).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });

  it('strictly ignores hotkeys when typing inside an INPUT or TEXTAREA', () => {
    const handlers = createMockHandlers();
    const inputEl = { tagName: 'INPUT' } as unknown as Element;

    const resultFromTarget = dispatchOperatorKeyEvent(
      { key: '1', target: inputEl as unknown as EventTarget },
      null,
      handlers
    );
    expect(resultFromTarget).toBeNull();
    expect(handlers.onRunBenchmark).not.toHaveBeenCalled();

    const resultFromActiveElement = dispatchOperatorKeyEvent(
      { key: 'q' },
      { tagName: 'TEXTAREA' } as unknown as Element,
      handlers
    );
    expect(resultFromActiveElement).toBeNull();
    expect(handlers.onStageSyntheticPdf).not.toHaveBeenCalled();
  });

  it('strictly ignores hotkeys when ctrlKey, metaKey, or altKey is pressed', () => {
    const handlers = createMockHandlers();

    expect(
      dispatchOperatorKeyEvent({ key: 'c', ctrlKey: true }, null, handlers)
    ).toBeNull();
    expect(
      dispatchOperatorKeyEvent({ key: '1', metaKey: true }, null, handlers)
    ).toBeNull();
    expect(
      dispatchOperatorKeyEvent({ key: 'q', altKey: true }, null, handlers)
    ).toBeNull();
    expect(handlers.onCopyDisputeNotice).not.toHaveBeenCalled();
    expect(handlers.onRunBenchmark).not.toHaveBeenCalled();
  });

  it('dispatches benchmark keys 1, 2, 3 and formats KEY_CMD logs', () => {
    const handlers = createMockHandlers();
    const fixedDate = new Date('2026-10-30T15:00:00Z');

    const cmd1 = dispatchOperatorKeyEvent({ key: '1' }, null, handlers, fixedDate);
    expect(handlers.onRunBenchmark).toHaveBeenCalledWith('verified_match');
    expect(cmd1?.command).toBe('KEY_CMD: [1] -> LOAD_BENCHMARK_VERIFIED_MATCH');

    const cmd2 = dispatchOperatorKeyEvent({ key: '2' }, null, handlers, fixedDate);
    expect(handlers.onRunBenchmark).toHaveBeenCalledWith('float_trap');
    expect(cmd2?.command).toBe('KEY_CMD: [2] -> LOAD_BENCHMARK_FLOAT_DRIFT');

    const cmd3 = dispatchOperatorKeyEvent({ key: '3' }, null, handlers, fixedDate);
    expect(handlers.onRunBenchmark).toHaveBeenCalledWith('ocr_guardrail');
    expect(cmd3?.command).toBe('KEY_CMD: [3] -> LOAD_BENCHMARK_OCR_GUARDRAIL');
  });

  it('dispatches Q, W, E, H, S, T, C, D, K, ?, and Escape operator commands', () => {
    const handlers = createMockHandlers();

    expect(dispatchOperatorKeyEvent({ key: 'q' }, null, handlers)?.command).toBe(
      'KEY_CMD: [Q] -> STAGE_PDF_CLEAN_4401'
    );
    expect(handlers.onStageSyntheticPdf).toHaveBeenCalledWith('clean');

    expect(dispatchOperatorKeyEvent({ key: 'W' }, null, handlers)?.command).toBe(
      'KEY_CMD: [W] -> STAGE_PDF_DRIFT_4402'
    );
    expect(handlers.onStageSyntheticPdf).toHaveBeenCalledWith('drift');

    expect(dispatchOperatorKeyEvent({ key: 'e' }, null, handlers)?.command).toBe(
      'KEY_CMD: [E] -> EXTRACT_AND_RECONCILE_FILE'
    );
    expect(handlers.onExtractStagedFile).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 'h' }, null, handlers)?.command).toBe(
      'KEY_CMD: [H] -> TOGGLE_AUDIT_LEDGER_HISTORY'
    );
    expect(handlers.onToggleAuditHistory).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 's' }, null, handlers)?.command).toContain(
      'KEY_CMD: [S] -> CYCLE_STP_POLICY'
    );
    expect(handlers.onCycleTolerancePolicy).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 't' }, null, handlers)?.command).toBe(
      'KEY_CMD: [T] -> TOGGLE_VIEW_TRUST_BOUNDARY'
    );
    expect(handlers.onToggleLedgerView).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 'c' }, null, handlers)?.command).toBe(
      'KEY_CMD: [C] -> COPY_DISPUTE_NOTICE'
    );
    expect(handlers.onCopyDisputeNotice).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 'd' }, null, handlers)?.command).toBe(
      'KEY_CMD: [D] -> SWITCH_THEME_DARK'
    );
    expect(handlers.onToggleTheme).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 'k' }, null, handlers)?.command).toBe(
      'KEY_CMD: [K] -> HIDE_HUD_BAR'
    );
    expect(handlers.onToggleHud).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 'a' }, null, handlers)?.command).toBe(
      'KEY_CMD: [A] -> TOGGLE_OPERATOR_AUTH_MODAL'
    );
    expect(handlers.onToggleOperatorAuth).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: '?' }, null, handlers)?.command).toBe(
      'KEY_CMD: [?] -> TOGGLE_HOTKEY_REFERENCE'
    );
    expect(handlers.onToggleHelpModal).toHaveBeenCalled();

    expect(dispatchOperatorKeyEvent({ key: 'Escape' }, null, handlers)?.command).toBe(
      'KEY_CMD: [ESC] -> DISMISS_ACTIVE_OVERLAY'
    );
    expect(handlers.onEscape).toHaveBeenCalled();
  });
});
