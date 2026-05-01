import { FacetType } from '../types';
import {
    hasTouchedFacetResources,
    orderFacetTypes,
    TouchedFacetResources,
    touchedFacetResourcesToTypes
} from './touchedFacetTypes';
import { elapsedMs, liveWatchNow } from './liveWatchPerf';

export const STARTUP_INCREMENTAL_MAX_PROCESSED = 500;
export const STARTUP_INCREMENTAL_MAX_TOUCHED_RESOURCES = 64;

export type StartupFacetRefreshSource = 'invoke' | 'folder';

export type StartupFacetRefreshStrategy =
    | 'skipped'
    | 'resource-incremental'
    | 'full'
    | 'fallback-full';

export interface StartupFacetRefreshOptions {
    source: StartupFacetRefreshSource;
    totalProcessed: number;
    touchedFacetTypes: FacetType[];
    touchedFacetResources?: TouchedFacetResources;
    orphanScanEnabled?: boolean;
    maxProcessed?: number;
    maxTouchedResources?: number;
    onRefreshApplied: () => void | Promise<void>;
}

export interface StartupFacetRefreshResult {
    strategy: StartupFacetRefreshStrategy;
    reason: string;
    entryCount: number;
    touchedFacetTypes: FacetType[];
    touchedResourceCount: number;
    incrementalMs?: number;
    fullRefreshMs?: number;
}

export const countTouchedFacetResources = (resources?: TouchedFacetResources): number => {
    if (!resources) return 0;
    return Object.values(resources).reduce((total, values) => total + values.length, 0);
};

const formatErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
};

const resolveFacetTypes = (
    touchedFacetTypes: FacetType[],
    touchedFacetResources?: TouchedFacetResources
): FacetType[] => {
    return orderFacetTypes([
        ...touchedFacetTypes,
        ...(touchedFacetResources ? touchedFacetResourcesToTypes(touchedFacetResources) : [])
    ]);
};

const logDecision = (
    options: StartupFacetRefreshOptions,
    strategy: StartupFacetRefreshStrategy,
    reason: string,
    touchedFacetTypes: FacetType[],
    touchedResourceCount: number
) => {
    console.info('[Startup Facets] Refresh decision', {
        source: options.source,
        strategy,
        reason,
        totalProcessed: options.totalProcessed,
        orphanScanEnabled: options.orphanScanEnabled ?? false,
        touchedFacetTypes,
        touchedResourceCount,
        maxProcessed: options.maxProcessed ?? STARTUP_INCREMENTAL_MAX_PROCESSED,
        maxTouchedResources: options.maxTouchedResources ?? STARTUP_INCREMENTAL_MAX_TOUCHED_RESOURCES
    });
};

const runFullRefresh = async (
    options: StartupFacetRefreshOptions,
    reason: string,
    touchedFacetTypes: FacetType[],
    touchedResourceCount: number,
    strategy: Extract<StartupFacetRefreshStrategy, 'full' | 'fallback-full'>,
    incrementalMs?: number
): Promise<StartupFacetRefreshResult> => {
    const fullRefreshStartedAt = liveWatchNow();
    const { rebuildFacetCacheStrict } = await import('../services/db/imageRepo');
    const entryCount = await rebuildFacetCacheStrict();
    const fullRefreshMs = elapsedMs(fullRefreshStartedAt);
    await options.onRefreshApplied();

    console.info('[Startup Facets] Refresh complete', {
        source: options.source,
        strategy,
        reason,
        entryCount,
        totalProcessed: options.totalProcessed,
        touchedFacetTypes,
        touchedResourceCount,
        incrementalMs,
        fullRefreshMs
    });

    return {
        strategy,
        reason,
        entryCount,
        touchedFacetTypes,
        touchedResourceCount,
        incrementalMs,
        fullRefreshMs
    };
};

export const refreshStartupFacetCache = async (
    options: StartupFacetRefreshOptions
): Promise<StartupFacetRefreshResult> => {
    const maxProcessed = options.maxProcessed ?? STARTUP_INCREMENTAL_MAX_PROCESSED;
    const maxTouchedResources = options.maxTouchedResources ?? STARTUP_INCREMENTAL_MAX_TOUCHED_RESOURCES;
    const touchedResourceCount = countTouchedFacetResources(options.touchedFacetResources);
    const touchedFacetTypes = resolveFacetTypes(options.touchedFacetTypes, options.touchedFacetResources);

    if (options.totalProcessed <= 0) {
        const reason = 'no-changes';
        logDecision(options, 'skipped', reason, touchedFacetTypes, touchedResourceCount);
        return {
            strategy: 'skipped',
            reason,
            entryCount: 0,
            touchedFacetTypes,
            touchedResourceCount
        };
    }

    if (options.orphanScanEnabled) {
        const reason = 'orphan-scan-enabled';
        logDecision(options, 'full', reason, touchedFacetTypes, touchedResourceCount);
        return runFullRefresh(options, reason, touchedFacetTypes, touchedResourceCount, 'full');
    }

    if (!options.touchedFacetResources || !hasTouchedFacetResources(options.touchedFacetResources)) {
        const reason = 'missing-touched-resources';
        logDecision(options, 'full', reason, touchedFacetTypes, touchedResourceCount);
        return runFullRefresh(options, reason, touchedFacetTypes, touchedResourceCount, 'full');
    }

    if (options.totalProcessed > maxProcessed) {
        const reason = 'delta-too-large';
        logDecision(options, 'full', reason, touchedFacetTypes, touchedResourceCount);
        return runFullRefresh(options, reason, touchedFacetTypes, touchedResourceCount, 'full');
    }

    if (touchedResourceCount > maxTouchedResources) {
        const reason = 'too-many-touched-resources';
        logDecision(options, 'full', reason, touchedFacetTypes, touchedResourceCount);
        return runFullRefresh(options, reason, touchedFacetTypes, touchedResourceCount, 'full');
    }

    const reason = 'small-known-delta';
    logDecision(options, 'resource-incremental', reason, touchedFacetTypes, touchedResourceCount);
    const incrementalStartedAt = liveWatchNow();

    try {
        const { refreshFacetCacheForResourcesStrict } = await import('../services/db/imageRepo');
        const entryCount = await refreshFacetCacheForResourcesStrict(options.touchedFacetResources);
        const incrementalMs = elapsedMs(incrementalStartedAt);
        await options.onRefreshApplied();

        console.info('[Startup Facets] Refresh complete', {
            source: options.source,
            strategy: 'resource-incremental',
            reason,
            entryCount,
            totalProcessed: options.totalProcessed,
            touchedFacetTypes,
            touchedResourceCount,
            incrementalMs
        });

        return {
            strategy: 'resource-incremental',
            reason,
            entryCount,
            touchedFacetTypes,
            touchedResourceCount,
            incrementalMs
        };
    } catch (incrementalError) {
        const incrementalMs = elapsedMs(incrementalStartedAt);
        const fallbackReason = 'incremental-failure';
        console.warn('[Startup Facets] Incremental refresh failed; falling back to full rebuild.', {
            source: options.source,
            reason: fallbackReason,
            totalProcessed: options.totalProcessed,
            touchedFacetTypes,
            touchedResourceCount,
            incrementalMs,
            error: formatErrorMessage(incrementalError)
        });
        return runFullRefresh(
            options,
            fallbackReason,
            touchedFacetTypes,
            touchedResourceCount,
            'fallback-full',
            incrementalMs
        );
    }
};
