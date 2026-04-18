export interface InvokeLiveWatchPerfContext {
    cycleId: string;
    firstEventAt: number;
    lastEventAt: number;
    eventCount: number;
    pathCount: number;
    debounceScheduledAt: number;
    debounceDelayMs: number;
    debounceFireDelayMs: number;
    mergedCycleCount?: number;
}

export interface TargetedLiveSyncPerfContext {
    cycleId: string;
    source: string;
    firstEventAt: number;
    lastEventAt: number;
    eventCount: number;
    pathCount: number;
    queueDepthAtStart?: number;
    mergedCycleCount?: number;
}

const PREFIX = '[LiveWatchPerf]';

export const liveWatchNow = (): number => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }

    return Date.now();
};

export const elapsedMs = (start: number): number => {
    return Math.round(liveWatchNow() - start);
};

export const createLiveWatchPerfId = (prefix: string): string => {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const stringifyPerfData = (data?: Record<string, unknown>): string => {
    if (!data || Object.keys(data).length === 0) {
        return '';
    }

    try {
        return ` ${JSON.stringify(data)}`;
    } catch {
        return ` ${JSON.stringify({ serializationError: true })}`;
    }
};

export const debugLiveWatchPerf = (label: string, data?: Record<string, unknown>) => {
    console.debug(`${PREFIX} ${label}${stringifyPerfData(data)}`);
};

export const infoLiveWatchPerf = (label: string, data?: Record<string, unknown>) => {
    console.info(`${PREFIX} ${label}${stringifyPerfData(data)}`);
};
