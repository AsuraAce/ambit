import { describe, expect, it } from 'vitest';
import { calculateLevenshteinDistance, calculateSimilarity } from '../analysisUtils';

describe('analysisUtils', () => {
    it('measures insertion, deletion, substitution, and identical text', () => {
        expect(calculateLevenshteinDistance('', 'ambit')).toBe(5);
        expect(calculateLevenshteinDistance('ambit', '')).toBe(5);
        expect(calculateLevenshteinDistance('ambit', 'ambit')).toBe(0);
        expect(calculateLevenshteinDistance('kitten', 'sitting')).toBe(3);
        expect(calculateLevenshteinDistance('image', 'images')).toBe(1);
    });

    it('normalizes distance against the longer string', () => {
        expect(calculateSimilarity('', '')).toBe(1);
        expect(calculateSimilarity('abc', 'abc')).toBe(1);
        expect(calculateSimilarity('abc', 'ab')).toBeCloseTo(2 / 3);
        expect(calculateSimilarity('ab', 'abc')).toBeCloseTo(2 / 3);
        expect(calculateSimilarity('abc', 'xyz')).toBe(0);
    });
});
