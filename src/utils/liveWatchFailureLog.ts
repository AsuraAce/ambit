import { commands } from '../bindings';

/**
 * Why a Live Watch path was not imported, as a fixed kind. Error texts can contain file paths
 * and prompt-like file names, so only the kind ever reaches Ambit.log.
 */
export type LiveImportFailureKind = 'db_locked' | 'scope' | 'scan_error' | 'video_error' | 'sync_rejected' | 'other';

/** The kind for an error text; `fallback` when it is neither a lock nor a scope refusal. */
export const classifyImportFailure = (error: unknown, fallback: LiveImportFailureKind): LiveImportFailureKind => {
    const text = String(error);
    if (/database is (locked|busy)|SQLITE_BUSY|SQLITE_LOCKED/i.test(text)) return 'db_locked';
    if (/outside the allowed filesystem scope/i.test(text)) return 'scope';
    return fallback;
};

export interface LiveWatchFailureSummary {
    failedCount: number;
    retryCount: number;
    leftForCatchUpCount: number;
    /** The highest attempt number among the paths that will be retried. */
    nextAttempt?: number;
    maxAttempts: number;
    retryInMs?: number;
    reason?: LiveImportFailureKind;
}

export const formatLiveWatchFailure = (summary: LiveWatchFailureSummary): string => {
    const parts = [
        `[LiveWatch] import failed paths=${summary.failedCount}`,
        `retrying=${summary.retryCount}`,
        `left_for_catch_up=${summary.leftForCatchUpCount}`,
    ];
    if (summary.retryCount > 0 && summary.nextAttempt !== undefined && summary.retryInMs !== undefined) {
        parts.push(`retry=${summary.nextAttempt}/${summary.maxAttempts}`, `retry_in_ms=${summary.retryInMs}`);
    }
    parts.push(`reason=${summary.reason ?? 'other'}`);
    return parts.join(' ');
};

/** Writes one failed Live Watch cycle to Ambit.log at WARN. Never throws: outside Tauri the call fails. */
export const logLiveWatchFailure = (summary: LiveWatchFailureSummary): void => {
    writeWarning(formatLiveWatchFailure(summary));
};

/** The background owner-cache repair kinds Live Watch can stop. */
export type LiveWatchStoppableRepairKind = 'startup' | 'idle' | 'catch-up';

export const formatLiveWatchRepairStopped = (kind: LiveWatchStoppableRepairKind): string =>
    `[LiveWatch] owner-cache repair stopped for an import kind=${kind} reason=live_import; the idle repair redoes it`;

/** Writes to Ambit.log at WARN that Live Watch stopped a background owner-cache repair. Never throws. */
export const logLiveWatchRepairStopped = (kind: LiveWatchStoppableRepairKind): void => {
    writeWarning(formatLiveWatchRepairStopped(kind));
};

const writeWarning = (line: string): void => {
    console.warn(line);
    try {
        commands.logFrontendWarning(line).catch(() => undefined);
    } catch {
        // ignore
    }
};
