import { z } from 'zod';

/**
 * Zod schema defining a configurable tolerance policy for automated
 * Straight-Through Processing (STP) reconciliation.
 */
export const TolerancePolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  max_variance_cents: z.number().int().nonnegative(),
  max_variance_bps: z.number().int().nonnegative().max(10000),
  strict_quantity_match: z.boolean(),
  allow_unexpected_items: z.boolean(),
});

export type TolerancePolicy = z.infer<typeof TolerancePolicySchema>;

/**
 * Standard enterprise AP tolerance policy presets.
 */
export const TOLERANCE_PRESETS: Record<'STRICT_ZERO' | 'STANDARD_AP' | 'HIGH_VOLUME', TolerancePolicy> = {
  STRICT_ZERO: {
    id: 'strict-zero',
    name: 'Zero Tolerance (Strict)',
    max_variance_cents: 0,
    max_variance_bps: 0,
    strict_quantity_match: true,
    allow_unexpected_items: false,
  },
  STANDARD_AP: {
    id: 'standard-ap',
    name: 'Standard AP ($1.00 / 100 bps)',
    max_variance_cents: 100,
    max_variance_bps: 100,
    strict_quantity_match: true,
    allow_unexpected_items: false,
  },
  HIGH_VOLUME: {
    id: 'high-volume',
    name: 'High-Volume Operations ($5.00 / 200 bps)',
    max_variance_cents: 500,
    max_variance_bps: 200,
    strict_quantity_match: true,
    allow_unexpected_items: false,
  },
};
