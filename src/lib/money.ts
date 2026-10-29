/**
 * ClearMatch Monetary Domain Utilities
 * Strict integer-cent arithmetic to eliminate IEEE 754 floating-point drift.
 */

/**
 * Safely converts a dollar decimal or string representation into integer cents.
 * Handles IEEE 754 rounding artifacts (e.g. 19.99 * 100 = 1998.9999999999998 -> 1999).
 */
export function dollarsToCents(amount: number | string): number {
    const numericAmount = typeof amount === 'string' ? parseFloat(amount.trim()) : amount;

    if (!Number.isFinite(numericAmount)) {
        throw new TypeError(`Cannot convert non-finite value to cents: ${String(amount)}`);
    }

    return Math.round(numericAmount * 100);
}

/**
 * Formats an integer cent amount into a 2-decimal monetary string (e.g. 1050 -> "10.50").
 */
export function centsToDollars(cents: number): string {
    if (!Number.isInteger(cents)) {
        throw new TypeError(`Cents value must be an integer, received: ${cents}`);
    }

    const isNegative = cents < 0;
    const absoluteCents = Math.abs(cents);
    const dollars = Math.floor(absoluteCents / 100);
    const remainder = absoluteCents % 100;

    const paddedRemainder = remainder.toString().padStart(2, '0');
    const sign = isNegative ? '-' : '';

    return `${sign}${dollars}.${paddedRemainder}`;
}

/**
 * Computes tax from basis points (bps) where 100 bps = 1.00%, 1000 bps = 10.00%.
 * Rounds to the nearest integer cent.
 */
export function calculateTaxFromBps(subtotalCents: number, taxRateBps: number): number {
    if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
        throw new TypeError(`Subtotal cents must be a non-negative integer: ${subtotalCents}`);
    }

    if (!Number.isInteger(taxRateBps) || taxRateBps < 0) {
        throw new TypeError(`Tax rate bps must be a non-negative integer: ${taxRateBps}`);
    }

    return Math.round((subtotalCents * taxRateBps) / 10000);
}

/**
 * Computes variance: invoiced - expected.
 * Positive variance = overbilled (drift).
 * Negative variance = underbilled.
 */
export function calculateVarianceCents(invoicedCents: number, expectedCents: number): number {
    if (!Number.isInteger(invoicedCents) || !Number.isInteger(expectedCents)) {
        throw new TypeError('Variance calculations require integer cent inputs');
    }

    return invoicedCents - expectedCents;
}

/**
 * Formats an integer cent amount into a formatted currency string with the dollar sign.
 * Guarantees the negative sign precedes the currency symbol: "-$0.50" rather than "$-0.50".
 */
export function formatCurrency(
    cents: number,
    options?: { showPositiveSign?: boolean }
): string {
    if (!Number.isInteger(cents)) {
        throw new TypeError(`Cents value must be an integer, received: ${cents}`);
    }

    const isNegative = cents < 0;
    const absoluteCents = Math.abs(cents);
    const dollars = Math.floor(absoluteCents / 100);
    const remainder = absoluteCents % 100;
    const paddedRemainder = remainder.toString().padStart(2, '0');

    if (isNegative) {
        return `-$${dollars}.${paddedRemainder}`;
    }
    if (options?.showPositiveSign && cents > 0) {
        return `+$${dollars}.${paddedRemainder}`;
    }
    return `$${dollars}.${paddedRemainder}`;
}

/**
 * Minor units (integer cents) currency formatting helper.
 */
export const formatMinorUnits = formatCurrency;