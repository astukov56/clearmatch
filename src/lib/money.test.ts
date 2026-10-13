import { describe, it, expect } from 'vitest';
import {
    dollarsToCents,
    centsToDollars,
    calculateTaxFromBps,
    calculateVarianceCents,
} from './money';

describe('dollarsToCents', () => {
    it('accurately parses standard decimals without floating-point drift', () => {
        expect(dollarsToCents(10.5)).toBe(1050);
        expect(dollarsToCents(19.99)).toBe(1999);
        expect(dollarsToCents(0.01)).toBe(1);
        expect(dollarsToCents(0)).toBe(0);
    });

    it('safely parses string inputs', () => {
        expect(dollarsToCents('10.50')).toBe(1050);
        expect(dollarsToCents('1045.23')).toBe(104523);
        expect(dollarsToCents(' 49.90 ')).toBe(4990);
    });

    it('throws TypeError on invalid numbers', () => {
        expect(() => dollarsToCents(NaN)).toThrow(TypeError);
        expect(() => dollarsToCents(Infinity)).toThrow(TypeError);
        expect(() => dollarsToCents('abc')).toThrow(TypeError);
    });
});

describe('centsToDollars', () => {
    it('formats positive integers to two-decimal strings', () => {
        expect(centsToDollars(1050)).toBe('10.50');
        expect(centsToDollars(1999)).toBe('19.99');
        expect(centsToDollars(5)).toBe('0.05');
        expect(centsToDollars(0)).toBe('0.00');
    });

    it('formats negative integers correctly', () => {
        expect(centsToDollars(-45)).toBe('-0.45');
        expect(centsToDollars(-1250)).toBe('-12.50');
    });

    it('throws on non-integer inputs', () => {
        expect(() => centsToDollars(10.5)).toThrow(TypeError);
    });
});

describe('calculateTaxFromBps', () => {
    it('calculates 10% tax (1000 bps) correctly', () => {
        expect(calculateTaxFromBps(10000, 1000)).toBe(1000);
    });

    it('calculates 8.25% tax (825 bps) correctly with rounding', () => {
        expect(calculateTaxFromBps(1235, 825)).toBe(102);
    });

    it('calculates zero tax when bps is 0', () => {
        expect(calculateTaxFromBps(5000, 0)).toBe(0);
    });

    it('throws on negative inputs', () => {
        expect(() => calculateTaxFromBps(-100, 1000)).toThrow(TypeError);
        expect(() => calculateTaxFromBps(100, -500)).toThrow(TypeError);
    });
});

describe('calculateVarianceCents', () => {
    it('identifies price drift (invoiced higher than expected)', () => {
        expect(calculateVarianceCents(1045, 1000)).toBe(45);
    });

    it('identifies undercharges (invoiced lower than expected)', () => {
        expect(calculateVarianceCents(900, 1000)).toBe(-100);
    });

    it('reports 0 when prices match exactly', () => {
        expect(calculateVarianceCents(1500, 1500)).toBe(0);
    });
});