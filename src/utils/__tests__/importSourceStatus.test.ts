import { describe, expect, it } from 'vitest';
import type { ImportResult } from '../../services/importService';
import { isImportSourceCancelled, isImportSourceCompleted } from '../importSourceStatus';
import { createEmptyTouchedFacetResources } from '../touchedFacetTypes';

const result = (overrides: Partial<ImportResult> = {}): ImportResult => ({
    images: [],
    stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
    handledPaths: [],
    failedPaths: [],
    touchedFacetTypes: [],
    touchedFacetResources: createEmptyTouchedFacetResources(),
    wasCancelled: false,
    completedSourcePaths: [],
    cancelledSourcePaths: [],
    ...overrides,
});

describe('importSourceStatus', () => {
    it('uses aggregate completion when per-source paths are absent', () => {
        const legacy = { ...result(), completedSourcePaths: undefined } as unknown as ImportResult;
        expect(isImportSourceCompleted(legacy, 'C:/images')).toBe(true);
        expect(isImportSourceCompleted(undefined, 'C:/images')).toBe(false);
    });

    it('uses aggregate cancellation when per-source paths are absent', () => {
        const legacy = {
            ...result({ wasCancelled: true }),
            cancelledSourcePaths: undefined,
        } as unknown as ImportResult;
        expect(isImportSourceCancelled(legacy, 'C:/images')).toBe(true);
        expect(isImportSourceCancelled(result(), 'C:/images')).toBe(false);
    });
});
