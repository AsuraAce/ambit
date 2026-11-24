import { commands } from '../bindings';

const REASON_MAX_CHARS = 200;
// Absolute Windows, UNC and POSIX paths, then bare media or sidecar file names.
const PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>|]*/g;
const FILE_NAME_PATTERN = /[^\s"'<>|\\/]+\.(?:png|jpe?g|webp|gif|bmp|tiff?|avif|heic|mp4|webm|mov|mkv|avi|m4v|json|txt)\b/gi;

/** An error text with paths and file names removed, on one line and capped, so it can go in Ambit.log. */
export const sanitizeFailureReason = (reason: string | undefined): string => {
    if (!reason) return 'unknown';
    const cleaned = reason.replace(PATH_PATTERN, '<path>').replace(FILE_NAME_PATTERN, '<file>').replace(/\s+/g, ' ').trim();
    if (!cleaned) return 'unknown';
    return cleaned.length > REASON_MAX_CHARS ? `${cleaned.slice(0, REASON_MAX_CHARS)}…` : cleaned;
};

export interface LiveWatchFailureSummary {
    failedCount: number;
    retryCount: number;
    leftForCatchUpCount: number;
    /** The highest attempt number among the paths that will be retried. */
    nextAttempt?: number;
    maxAttempts: number;
    retryInMs?: number;
    reason?: string;
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
    parts.push(`reason=${sanitizeFailureReason(summary.reason)}`);
    return parts.join(' ');
};

/** Writes one failed Live Watch cycle to Ambit.log at WARN. Never throws: outside Tauri the call fails. */
export const logLiveWatchFailure = (summary: LiveWatchFailureSummary): void => {
    const line = formatLiveWatchFailure(summary);
    console.warn(line);
    try {
        commands.logFrontendWarning(line).catch(() => undefined);
    } catch {
        // ignore
    }
};
