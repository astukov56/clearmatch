import { describe, it, expect } from 'vitest';
import {
  TolerancePolicySchema,
  TOLERANCE_PRESETS,
  TolerancePolicy,
} from './tolerance';

describe('TolerancePolicySchema and Presets', () => {
  it('validates all built-in presets successfully against the schema', () => {
    Object.values(TOLERANCE_PRESETS).forEach((preset) => {
      const parsed = TolerancePolicySchema.safeParse(preset);
      expect(parsed.success).toBe(true);
    });
  });

  it('rejects negative max_variance_cents', () => {
    const invalid = {
      ...TOLERANCE_PRESETS.STRICT_ZERO,
      max_variance_cents: -1,
    };
    const parsed = TolerancePolicySchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects max_variance_bps exceeding 10000', () => {
    const invalid = {
      ...TOLERANCE_PRESETS.STRICT_ZERO,
      max_variance_bps: 10001,
    };
    const parsed = TolerancePolicySchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('rejects floating-point variance cents', () => {
    const invalid = {
      ...TOLERANCE_PRESETS.STANDARD_AP,
      max_variance_cents: 100.5,
    };
    const parsed = TolerancePolicySchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('defines the expected parameters for STANDARD_AP', () => {
    const standard: TolerancePolicy = TOLERANCE_PRESETS.STANDARD_AP;
    expect(standard.id).toBe('standard-ap');
    expect(standard.max_variance_cents).toBe(100);
    expect(standard.max_variance_bps).toBe(100);
    expect(standard.strict_quantity_match).toBe(true);
    expect(standard.allow_unexpected_items).toBe(false);
  });
});
