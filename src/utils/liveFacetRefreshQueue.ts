import { FacetType } from '../types';
import { debugLiveWatchPerf, elapsedMs, infoLiveWatchPerf, liveWatchNow } from './liveWatchPerf';
import {
    createEmptyTouchedFacetResources,
    hasTouchedFacetResources,
    mergeTouchedFacetResources,
    orderFacetTypes,
    TouchedFacetResources,
    touchedFacetResourcesToTypes
} from './touchedFacetTypes';

export interface LiveFacetRefreshQueueMeta {
    source: 'generic' | 'invoke' | 'mixed';
    cycleId?: string;
    changedImageCount?: number;
    mergedRunCount?: number;
}

interface LiveFacetRefreshQueueOptions {
    onRefreshApplied: () => void | Promise<void>;
    runFullFallback: () => Promise<number>;
    runIncremental: (facetTypes: FacetType[]) => Promise<number>;
    runResourceIncremental: (resources: TouchedFacetResources) => Promise<number>;
}

const formatErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
};

const mergeSource = (
    current: LiveFacetRefreshQueueMeta['source'] | undefined,
    next: LiveFacetRefreshQueueMeta['source']
): LiveFacetRefreshQueueMeta['source'] => {
    if (!current || current === next) {
        return next;
    }

    return 'mixed';
};

const mergeMeta = (
    current: LiveFacetRefreshQueueMeta | null,
    next: LiveFacetRefreshQueueMeta
): LiveFacetRefreshQueueMeta => {
    if (!current) {
        return {
            ...next,
            mergedRunCount: next.mergedRunCount ?? 1
        };
    }

    return {
        source: mergeSource(current.source, next.source),
        cycleId: current.cycleId === next.cycleId ? current.cycleId : undefined,
        changedImageCount: (current.changedImageCount ?? 0) + (next.changedImageCount ?? 0),
        mergedRunCount: (current.mergedRunCount ?? 1) + (next.mergedRunCount ?? 1)
    };
};

export const createLiveFacetRefreshQueue = ({
    onRefreshApplied,
    runFullFallback,
    runIncremental,
    runResourceIncremental
}: LiveFacetRefreshQueueOptions) => {
    let activePromise: Promise<void> | null = null;
    let pendingFacetTypes = new Set<FacetType>();
    let pendingResources = createEmptyTouchedFacetResources();
    let pendingMeta: LiveFacetRefreshQueueMeta | null = null;

    const queue = (
        facetTypes: FacetType[],
        meta: LiveFacetRefreshQueueMeta,
        resources = createEmptyTouchedFacetResources()
    ): Promise<void> => {
        const resourceFacetTypes = touchedFacetResourcesToTypes(resources);
        const orderedFacetTypes = orderFacetTypes([...facetTypes, ...resourceFacetTypes]);

        if (orderedFacetTypes.length === 0) {
            debugLiveWatchPerf('Live facet refresh skipped', {
                cycleId: meta.cycleId,
                source: meta.source,
                changedImageCount: meta.changedImageCount ?? 0,
                reason: 'no-touched-facet-types'
            });
            return Promise.resolve();
        }

        orderedFacetTypes.forEach(type => pendingFacetTypes.add(type));
        pendingResources = mergeTouchedFacetResources(pendingResources, resources);
        pendingMeta = mergeMeta(pendingMeta, meta);

        if (activePromise) {
            debugLiveWatchPerf('Live facet refresh merged', {
                cycleId: pendingMeta.cycleId,
                source: pendingMeta.source,
                facetTypes: orderFacetTypes(pendingFacetTypes),
                changedImageCount: pendingMeta.changedImageCount ?? 0,
                mergedRunCount: pendingMeta.mergedRunCount ?? 1
            });
            return activePromise;
        }

        activePromise = (async () => {
            while (pendingFacetTypes.size > 0) {
                const currentTypes = orderFacetTypes(pendingFacetTypes);
                const currentResources = pendingResources;
                const currentMeta = pendingMeta ?? meta;
                pendingFacetTypes = new Set<FacetType>();
                pendingResources = createEmptyTouchedFacetResources();
                pendingMeta = null;

                const refreshStartedAt = liveWatchNow();
                const incrementalStartedAt = liveWatchNow();

                try {
                    const useResourceRefresh = hasTouchedFacetResources(currentResources);
                    const entryCount = useResourceRefresh
                        ? await runResourceIncremental(currentResources)
                        : await runIncremental(currentTypes);
                    const incrementalMs = elapsedMs(incrementalStartedAt);
                    await onRefreshApplied();

                    infoLiveWatchPerf('Live facet refresh complete', {
                        cycleId: currentMeta.cycleId,
                        source: currentMeta.source,
                        facetTypes: currentTypes,
                        changedImageCount: currentMeta.changedImageCount ?? 0,
                        mergedRunCount: currentMeta.mergedRunCount ?? 1,
                        mode: useResourceRefresh ? 'resource-incremental' : 'incremental',
                        entryCount,
                        incrementalMs,
                        totalMs: elapsedMs(refreshStartedAt)
                    });
                } catch (incrementalError) {
                    const incrementalMs = elapsedMs(incrementalStartedAt);

                    debugLiveWatchPerf('Live facet refresh incremental failed', {
                        cycleId: currentMeta.cycleId,
                        source: currentMeta.source,
                        facetTypes: currentTypes,
                        changedImageCount: currentMeta.changedImageCount ?? 0,
                        mergedRunCount: currentMeta.mergedRunCount ?? 1,
                        incrementalMs,
                        error: formatErrorMessage(incrementalError)
                    });

                    const fullRefreshStartedAt = liveWatchNow();

                    try {
                        const entryCount = await runFullFallback();
                        const fullRefreshMs = elapsedMs(fullRefreshStartedAt);
                        await onRefreshApplied();

                        infoLiveWatchPerf('Live facet refresh complete', {
                            cycleId: currentMeta.cycleId,
                            source: currentMeta.source,
                            facetTypes: currentTypes,
                            changedImageCount: currentMeta.changedImageCount ?? 0,
                            mergedRunCount: currentMeta.mergedRunCount ?? 1,
                            mode: 'fallback-full',
                            entryCount,
                            incrementalMs,
                            fullRefreshMs,
                            totalMs: elapsedMs(refreshStartedAt)
                        });
                    } catch (fullRefreshError) {
                        console.error('[LiveWatch] Failed to refresh facet cache after live changes', fullRefreshError);
                    }
                }
            }
        })().finally(() => {
            activePromise = null;
        });

        return activePromise;
    };

    return {
        queue
    };
};
