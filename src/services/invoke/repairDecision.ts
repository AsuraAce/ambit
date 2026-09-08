import type { StartupRepairDecision } from '../../bindings';
import type { InvokeSourceFingerprint } from '../../types';

/** Describes already-made admission decisions; never authorizes repair or visibility. */
export function describeInvokeRepairDecision(input: {
    scope: StartupRepairDecision['scope'];
    forcedRefresh: boolean;
    snapshotPresent: boolean;
    snapshotCompatible: boolean;
    savedFingerprint?: InvokeSourceFingerprint;
    currentFingerprint?: InvokeSourceFingerprint;
    fingerprintCurrent: boolean;
    reconcileSourceFacts: boolean;
    canCatchUpAllUsers: boolean;
}): StartupRepairDecision {
    const saved = input.savedFingerprint;
    const current = input.currentFingerprint;
    const compare = (before: number | string, after: number | string) =>
        after === before ? 'equal' : after < before ? 'decreased' : 'increased';
    return {
        decision: input.scope === 'none' ? 'no-admitted-scope'
            : input.reconcileSourceFacts ? 'full-repair'
                : input.canCatchUpAllUsers && !input.fingerprintCurrent ? 'incremental-catch-up' : 'unchanged',
        scope: input.scope,
        forcedRefresh: input.forcedRefresh,
        snapshot: !input.snapshotPresent ? 'missing' : input.snapshotCompatible ? 'compatible' : 'incompatible',
        savedFingerprint: !saved ? 'unavailable' : saved.schemaVersion === 1 ? 'supported' : 'unsupported',
        currentFingerprint: !current ? 'unavailable' : current.schemaVersion === 1 ? 'supported' : 'unsupported',
        countComparison: saved && current ? compare(saved.imageCount, current.imageCount) : 'unavailable',
        timestampComparison: !saved || !current ? 'unavailable'
            : saved.imageUpdatedAt === null ? 'saved-absent'
                : current.imageUpdatedAt === null ? 'current-absent'
                    : compare(saved.imageUpdatedAt, current.imageUpdatedAt),
        fingerprintCurrent: current ? input.fingerprintCurrent : null,
    };
}
