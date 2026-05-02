import { describe, expect, it } from 'vitest';
import { formatHashResolutionMessage, isHashResolutionPartial } from '../hashResolution';

describe('hash resolution formatting', () => {
    it('includes verified, harvested, failed, fallback, and unknown counts', () => {
        expect(formatHashResolutionMessage({
            resolvedCount: 3,
            harvestedCount: 7,
            failedCount: 2,
            namedFallbackCount: 5,
            unknownCount: 1
        })).toBe('Resolution: 3 verified online, 7 harvested locally, 2 failed online, 5 named fallback, 1 unknown.');
    });

    it('marks results partial when failed or unknown counts are present', () => {
        expect(isHashResolutionPartial({
            resolvedCount: 3,
            harvestedCount: 7,
            failedCount: 1,
            namedFallbackCount: 0,
            unknownCount: 0
        })).toBe(true);

        expect(isHashResolutionPartial({
            resolvedCount: 3,
            harvestedCount: 7,
            failedCount: 0,
            namedFallbackCount: 0,
            unknownCount: 1
        })).toBe(true);

        expect(isHashResolutionPartial({
            resolvedCount: 3,
            harvestedCount: 7,
            failedCount: 0,
            namedFallbackCount: 4,
            unknownCount: 0
        })).toBe(false);
    });
});
