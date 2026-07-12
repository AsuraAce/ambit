import { describe, expect, it } from 'vitest';
import { GeneratorTool } from '../../types';
import {
    GeminiFilterResponseSchema,
    isValidGeneratorTool,
    parseOrThrow,
} from '../validation';

describe('GeminiFilterResponseSchema', () => {
    it('accepts real optional date inputs', () => {
        const result = GeminiFilterResponseSchema.safeParse({
            dateRange: 'custom',
            dateFrom: '2026-04-30',
            dateTo: '2026-04-30'
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dateFrom).toBe('2026-04-30');
            expect(result.data.dateTo).toBe('2026-04-30');
        }
    });

    it('rejects impossible optional date inputs', () => {
        expect(GeminiFilterResponseSchema.safeParse({
            dateRange: 'custom',
            dateFrom: '2026-02-30'
        }).success).toBe(false);
        expect(GeminiFilterResponseSchema.safeParse({
            dateRange: 'custom',
            dateTo: '2026-13-01'
        }).success).toBe(false);
    });

    it('normalizes empty optional date inputs to undefined', () => {
        const result = GeminiFilterResponseSchema.safeParse({
            dateRange: 'custom',
            dateFrom: '',
            dateTo: ''
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dateFrom).toBeUndefined();
            expect(result.data.dateTo).toBeUndefined();
        }
    });

    it('parses valid data or throws the original Zod validation error', () => {
        expect(parseOrThrow(GeminiFilterResponseSchema, { searchQuery: 'sunset' }))
            .toMatchObject({ searchQuery: 'sunset', models: [], tools: [] });
        expect(() => parseOrThrow(GeminiFilterResponseSchema, { models: 'not-an-array' }))
            .toThrow();
    });

    it('recognizes only declared generator tool values', () => {
        expect(isValidGeneratorTool(GeneratorTool.COMFYUI)).toBe(true);
        expect(isValidGeneratorTool('NotAGenerator')).toBe(false);
    });
});
