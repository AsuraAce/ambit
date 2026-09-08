import { describe, expect, it } from 'vitest';
import { describeInvokeRepairDecision } from '../repairDecision';
import type { InvokeSourceFingerprint } from '../../../types';

const fingerprint: InvokeSourceFingerprint = {
    schemaVersion: 1, imageCount: 150000, imageUpdatedAt: 'private-timestamp',
    boardCount: 1, boardUpdatedAt: null, membershipCount: 0, membershipMaxRowId: null,
};
const input: Parameters<typeof describeInvokeRepairDecision>[0] = {
    scope: 'all', forcedRefresh: false, snapshotPresent: true, snapshotCompatible: true,
    savedFingerprint: fingerprint, currentFingerprint: fingerprint, fingerprintCurrent: true,
    reconcileSourceFacts: false, canCatchUpAllUsers: true,
};

describe('repair decision description is not an admission policy', () => {
    it.each([
        [{}, 'unchanged'],
        [{ fingerprintCurrent: false }, 'incremental-catch-up'],
        [{ reconcileSourceFacts: true }, 'full-repair'],
        [{ scope: 'none' as const }, 'no-admitted-scope'],
    ])('describes the already-selected decision without leaking source values', (override, expected) => {
        const result = describeInvokeRepairDecision({ ...input, ...override });
        expect(result.decision).toBe(expected);
        expect(JSON.stringify(result)).not.toMatch(/private|150000/);
    });
    it('distinguishes missing evidence from actual decrease and absent timestamps', () => {
        expect(describeInvokeRepairDecision({ ...input, currentFingerprint: undefined })).toMatchObject({
            currentFingerprint: 'unavailable', countComparison: 'unavailable',
            timestampComparison: 'unavailable', fingerprintCurrent: null,
        });
        expect(describeInvokeRepairDecision({ ...input,
            currentFingerprint: { ...fingerprint, imageCount: 149999, imageUpdatedAt: null },
        })).toMatchObject({ countComparison: 'decreased', timestampComparison: 'current-absent' });
        expect(describeInvokeRepairDecision({ ...input,
            savedFingerprint: { ...fingerprint, imageUpdatedAt: null },
        })).toMatchObject({ timestampComparison: 'saved-absent' });
    });
});
