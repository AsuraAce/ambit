import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Collection, SmartCollection } from '../types';
import { appRepository } from '../services/repository';
import { shouldAutoRefreshSmartCollectionSummary } from '../utils/smartCollectionRefresh';
import {
    cacheSmartCollectionCount,
    deleteCollectionFromDb,
    ensureCollectionSchema,
    getAllCollectionsWithStats,
    getCollectionImageIdsStrict,
    getCollectionThumbnailSummaries,
    getScopedCollectionRows,
    getSmartCollectionSummaries,
    migrateLegacyCollections,
} from '../services/db/collectionRepo';
import { useLibraryStore } from './libraryStore';
import { startupDiagnostics } from '../utils/startupDiagnostics';

let preparationPromise: Promise<void> | null = null;
let initPromise: Promise<boolean> | null = null;
let initPromiseGeneration: number | null = null;
let initializationGeneration = 0;
let initialHydrationCompleted = false;
let pendingInitialHydrationGeneration: number | null = null;
let collectionRefreshRunId = 0;
let smartCountRunId = 0;
const smartCountRunsByCollection = new Map<string, { runId: number; includesPromptSearch: boolean }>();
let thumbnailRefreshRunId = 0;

const invalidateCollectionRefreshes = () => {
    collectionRefreshRunId += 1;
    return collectionRefreshRunId;
};

const STARTUP_SMART_COUNT_DELAY_MS = 1500;
const SMART_COUNT_YIELD_MS = 25;
const COLLECTION_THUMBNAIL_CHUNK_SIZE = 48;
const COLLECTION_THUMBNAIL_YIELD_MS = 25;
const COLLECTION_REFRESH_SUPERSEDED_ERROR = 'Collection refresh was superseded by initialization generation.';
const COLLECTION_SUMMARIES_SUPERSEDED_ERROR = 'Collection summary refresh was superseded by initialization generation.';

const prepareCollectionStorage = async (): Promise<void> => {
    const schemaStartedAt = performance.now();
    await ensureCollectionSchema();
    console.info(`[Startup] Collection schema check completed in ${Math.round(performance.now() - schemaStartedAt)}ms`);

    // This is intentionally a row-only read. The first counted snapshot belongs to
    // the owner that is admitted after storage preparation completes.
    const existingScopedRows = await getScopedCollectionRows();

    try {
        const legacyState = await appRepository.load();
        const shouldMigrate = (legacyState.collectionStorageVersion ?? 0) < 1;

        if (shouldMigrate) {
            const legacyCols = legacyState.collections || [];
            const legacySmart = legacyState.smartCollections || [];
            const hasLegacyData = legacyCols.length > 0 || legacySmart.length > 0;

            if (hasLegacyData) {
                console.log(`[CollectionStore] Starting migration from JSON (${legacyCols.length} regular, ${legacySmart.length} smart)...`);
                await migrateLegacyCollections([...legacyCols, ...legacySmart]);
            }

            // The native import receipt makes a retry safe when this JSON marker
            // write fails after the import has already committed.
            await appRepository.update(current => ({
                ...current,
                collections: [],
                smartCollections: [],
                collectionStorageVersion: 1,
            }));
            console.log('[CollectionStore] Legacy collection migration completed.');
        }
    } catch (error) {
        // Keep the JSON arrays and storage-version marker unchanged. A future
        // startup can safely retry because the native import has its own receipt.
        console.error('[CollectionStore] Migration failed', error);
    }

    for (const collection of existingScopedRows) {
        if (!['c1', 'c2', 'c3'].includes(collection.id)) continue;

        try {
            const imageIds = await getCollectionImageIdsStrict(collection.id);
            if (imageIds.length === 0) {
                console.log(`[CollectionStore] Removing legacy empty collection: ${collection.name} (${collection.id})`);
                await deleteCollectionFromDb(collection.id);
            }
        } catch (error) {
            // A failed lookup is unknown membership, never evidence that deletion is safe.
            console.error('[CollectionStore] Failed to inspect legacy mock collection', error);
        }
    }
};

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const chunk = <T,>(items: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const shouldShowThumbnailHydrationPending = (collection: Collection, force: boolean): boolean => {
    if (collection.filters) return false;
    if (collection.customThumbnail) return true;

    const imageCount = collection.count ?? collection.imageIds.length;
    if (force) return imageCount > 0;
    if (collection.thumbnail) return false;

    return imageCount > 0;
};

const shouldHydrateCollectionThumbnail = (collection: Collection, force: boolean): boolean => (
    shouldShowThumbnailHydrationPending(collection, force)
);

const sortForThumbnailHydration = (collections: Collection[]): Collection[] => (
    [...collections].sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
    })
);

const buildPendingThumbnailMap = (collections: Collection[], force: boolean): Record<string, true> => (
    Object.fromEntries(
        collections
            .filter(collection => shouldShowThumbnailHydrationPending(collection, force))
            .map(collection => [collection.id, true] as const)
    )
);

interface RefreshSmartCountsOptions {
    includeArchived?: boolean;
    collectionIds?: string[];
    delayMs?: number;
    includeThumbnails?: boolean;
    includePromptSearch?: boolean;
    markPending?: boolean;
    consistency?: 'best_effort' | 'authoritative';
}

export interface CollectionRefreshOptions {
    includeThumbnails?: boolean;
    scheduleSmartRefresh?: boolean;
    consistency?: 'best_effort' | 'authoritative';
}

export interface CollectionInitializationOptions {
    generation?: number;
    deferHydration?: boolean;
}

type RefreshSmartCountsInput = RefreshSmartCountsOptions | Collection[];

interface CollectionState {
    collections: Collection[];
    isLoaded: boolean;
    initializationError: boolean;
    thumbnailHydrationPendingIds: Record<string, true>;
    smartSummaryPendingIds: Record<string, true>;

    // Actions
    prepareInitialization: () => Promise<void>;
    invalidateInitialization: () => number;
    getInitializationGeneration: () => number;
    initialize: (options?: CollectionInitializationOptions) => Promise<boolean>;
    finishInitializationHydration: (generation: number, authoritativeSummaries?: boolean) => void;
    refreshCollections: (debounced?: boolean, options?: CollectionRefreshOptions) => Promise<void>;
    refreshCollectionThumbnails: (debounced?: boolean, force?: boolean, options?: CollectionRefreshOptions) => Promise<void>;
    refreshSmartCounts: (input?: RefreshSmartCountsInput) => Promise<void>;
    setCollections: (collections: Collection[] | ((prev: Collection[]) => Collection[])) => void;
}

interface SupersedingDebounce {
    timer: ReturnType<typeof setTimeout> | null;
    resolve: (() => void) | null;
}

const collectionDebounce: SupersedingDebounce = { timer: null, resolve: null };
const thumbnailDebounce: SupersedingDebounce = { timer: null, resolve: null };
const scheduleSupersedingDebounce = (
    state: SupersedingDebounce,
    task: () => Promise<void>
): Promise<void> => {
    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
        state.resolve?.();
        state.resolve = null;
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
            try {
                await task();
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                if (state.timer === timer) {
                    state.timer = null;
                    state.resolve = null;
                }
            }
        }, 300);
        state.timer = timer;
        state.resolve = resolve;
    });
};
let authoritativeCollectionRefreshTail: Promise<void> = Promise.resolve();

export const useCollectionStore = create<CollectionState>()(
    devtools(
        (set, get) => ({
            collections: [],
            isLoaded: false,
            initializationError: false,
            thumbnailHydrationPendingIds: {},
            smartSummaryPendingIds: {},

            refreshCollections: async (debounced = false, options = {}) => {
                const isAuthoritative = options.consistency === 'authoritative';
                const refreshGeneration = initializationGeneration;
                const run = async (initialRunId: number) => {
                    let currentRunId = initialRunId;
                    try {
                        while (true) {
                            if (refreshGeneration !== initializationGeneration) {
                                if (isAuthoritative) throw new Error(COLLECTION_REFRESH_SUPERSEDED_ERROR);
                                return;
                            }
                            const cols = await getAllCollectionsWithStats({
                                includeThumbnails: options.includeThumbnails,
                            });
                            if (refreshGeneration !== initializationGeneration) {
                                if (isAuthoritative) throw new Error(COLLECTION_REFRESH_SUPERSEDED_ERROR);
                                return;
                            }
                            if (currentRunId !== collectionRefreshRunId) {
                                if (isAuthoritative) {
                                    currentRunId = invalidateCollectionRefreshes();
                                    continue;
                                }
                                return;
                            }

                            set({ collections: cols });

                            // Lazily fetch visible smart counts in the background.
                            if (options.scheduleSmartRefresh !== false) {
                                void get().refreshSmartCounts({ includeArchived: false, delayMs: 500, markPending: true });
                            }
                            return;
                        }
                    } catch (e) {
                        console.error('[CollectionStore] Failed to refresh collections', e);
                        if (isAuthoritative) throw e;
                    }
                };

                if (isAuthoritative) {
                    const authoritativeRun = authoritativeCollectionRefreshTail.then(() => (
                        run(invalidateCollectionRefreshes())
                    ));
                    authoritativeCollectionRefreshTail = authoritativeRun.catch(() => undefined);
                    await authoritativeRun;
                    return;
                }

                const runId = invalidateCollectionRefreshes();

                if (debounced) {
                    return scheduleSupersedingDebounce(collectionDebounce, () => run(runId));
                }
                await run(runId);
            },

            refreshCollectionThumbnails: async (debounced = false, force = false, options = {}) => {
                const isAuthoritative = options.consistency === 'authoritative';
                const refreshGeneration = initializationGeneration;
                const run = async () => {
                    const runId = ++thumbnailRefreshRunId;
                    let wasSuperseded = false;
                    try {
                        if (refreshGeneration !== initializationGeneration) {
                            if (isAuthoritative) throw new Error(COLLECTION_SUMMARIES_SUPERSEDED_ERROR);
                            return;
                        }
                        const currentCollections = sortForThumbnailHydration(
                            get().collections.filter(collection => shouldHydrateCollectionThumbnail(collection, force))
                        );
                        set({ thumbnailHydrationPendingIds: buildPendingThumbnailMap(currentCollections, force) });

                        if (currentCollections.length === 0) return;

                        for (const collectionBatch of chunk(currentCollections, COLLECTION_THUMBNAIL_CHUNK_SIZE)) {
                            if (refreshGeneration !== initializationGeneration || runId !== thumbnailRefreshRunId) {
                                wasSuperseded = true;
                                break;
                            }

                            const summaries = await getCollectionThumbnailSummaries(collectionBatch);
                            if (refreshGeneration !== initializationGeneration || runId !== thumbnailRefreshRunId) {
                                wasSuperseded = true;
                                break;
                            }

                            set((state) => ({
                                collections: state.collections.map((collection) => {
                                    const summary = summaries[collection.id];
                                    return summary ? { ...collection, ...summary } : collection;
                                }),
                                thumbnailHydrationPendingIds: Object.fromEntries(
                                    Object.entries(state.thumbnailHydrationPendingIds)
                                        .filter(([collectionId]) => !collectionBatch.some(collection => collection.id === collectionId))
                                ) as Record<string, true>
                            }));

                            await delay(COLLECTION_THUMBNAIL_YIELD_MS);
                        }
                        if (wasSuperseded) {
                            if (isAuthoritative) {
                                if (refreshGeneration !== initializationGeneration) {
                                    throw new Error(COLLECTION_SUMMARIES_SUPERSEDED_ERROR);
                                }
                                await get().refreshCollectionThumbnails(false, force, options);
                                return;
                            }
                        }
                    } catch (e) {
                        if (runId === thumbnailRefreshRunId) {
                            set({ thumbnailHydrationPendingIds: {} });
                        }
                        console.error('[CollectionStore] Failed to refresh collection thumbnails', e);
                        if (isAuthoritative) throw e;
                    }
                };

                if (debounced) {
                    thumbnailRefreshRunId += 1;
                    return scheduleSupersedingDebounce(thumbnailDebounce, run);
                }

                await run();
            },

            refreshSmartCounts: async (input = {}) => {
                const collectionsSnapshot = Array.isArray(input) ? input : undefined;
                const options: RefreshSmartCountsOptions = Array.isArray(input)
                    ? { includePromptSearch: true }
                    : input;
                const isAuthoritative = options.consistency === 'authoritative';
                const refreshGeneration = initializationGeneration;
                const includeThumbnails = options.includeThumbnails !== false;
                const shouldManagePending = includeThumbnails && options.markPending;
                let runId = 0;
                let smartCols: Collection[] = [];

                try {
                    if (refreshGeneration !== initializationGeneration) {
                        if (isAuthoritative) throw new Error(COLLECTION_SUMMARIES_SUPERSEDED_ERROR);
                        return;
                    }
                    if (useLibraryStore.getState().isImporting) {
                        console.log('[CollectionStore] Skipping smart counts refresh - Import already in progress');
                        smartCountRunsByCollection.clear();
                        set({ smartSummaryPendingIds: {} });
                        if (isAuthoritative) {
                            throw new Error('Smart collection summaries cannot refresh while an import is active.');
                        }
                        return;
                    }

                    const currentCols = collectionsSnapshot ?? get().collections;
                    const allowedIds = options.collectionIds ? new Set(options.collectionIds) : null;
                    const eligibleSmartCols = currentCols.filter(c =>
                        !!c.filters
                        && (!!collectionsSnapshot || options.includeArchived || !c.isArchived)
                        && (!allowedIds || allowedIds.has(c.id))
                        && (options.includePromptSearch || shouldAutoRefreshSmartCollectionSummary(c))
                    );

                    if (eligibleSmartCols.length === 0) return;

                    runId = ++smartCountRunId;
                    const includesPromptSearch = !!options.includePromptSearch;
                    smartCols = eligibleSmartCols.filter(collection => {
                        const activeRun = smartCountRunsByCollection.get(collection.id);
                        if (activeRun?.includesPromptSearch && !includesPromptSearch) return false;

                        smartCountRunsByCollection.set(collection.id, { runId, includesPromptSearch });
                        return true;
                    });

                    if (smartCols.length === 0) return;

                    if (shouldManagePending) {
                        set((state) => {
                            const pending = { ...state.smartSummaryPendingIds };
                            smartCols.forEach(collection => {
                                delete pending[collection.id];
                                if (!collection.thumbnail && !collection.customThumbnail) {
                                    pending[collection.id] = true;
                                }
                            });
                            return { smartSummaryPendingIds: pending };
                        });
                    } else {
                        set((state) => {
                            const pending = { ...state.smartSummaryPendingIds };
                            smartCols.forEach(collection => delete pending[collection.id]);
                            return { smartSummaryPendingIds: pending };
                        });
                    }

                    if (options.delayMs && options.delayMs > 0) {
                        await delay(options.delayMs);
                    }
                    if (refreshGeneration !== initializationGeneration) {
                        if (isAuthoritative) throw new Error(COLLECTION_SUMMARIES_SUPERSEDED_ERROR);
                        return;
                    }

                    let wasSuperseded = false;
                    for (const smartCol of smartCols) {
                        if (
                            refreshGeneration !== initializationGeneration
                            || smartCountRunsByCollection.get(smartCol.id)?.runId !== runId
                        ) {
                            wasSuperseded = true;
                            continue;
                        }

                        const summaries = await getSmartCollectionSummaries([smartCol], { includeThumbnails });
                        if (
                            refreshGeneration !== initializationGeneration
                            || smartCountRunsByCollection.get(smartCol.id)?.runId !== runId
                        ) {
                            wasSuperseded = true;
                            continue;
                        }
                        const summary = summaries[smartCol.id];

                        if (summary) {
                            await cacheSmartCollectionCount(
                                smartCol.id,
                                summary.count,
                                smartCol.updatedAt ?? smartCol.createdAt
                            );
                            if (
                                refreshGeneration !== initializationGeneration
                                || smartCountRunsByCollection.get(smartCol.id)?.runId !== runId
                            ) {
                                wasSuperseded = true;
                                continue;
                            }

                            set((state) => ({
                                collections: state.collections.map(c =>
                                    c.id === smartCol.id && c.filters
                                        ? c.customThumbnail || !includeThumbnails
                                            ? {
                                                ...c,
                                                count: summary.count
                                            }
                                            : {
                                                ...c,
                                                count: summary.count,
                                                thumbnail: summary.thumbnail,
                                                safeThumbnail: summary.safeThumbnail,
                                                thumbnailIsSensitive: summary.thumbnailIsSensitive,
                                                thumbnailSourceKind: summary.thumbnailSourceKind
                                            }
                                        : c
                                )
                            }));
                            if (shouldManagePending) {
                                set((state) => {
                                    const remaining = { ...state.smartSummaryPendingIds };
                                    delete remaining[smartCol.id];
                                    return { smartSummaryPendingIds: remaining };
                                });
                            }
                        } else if (shouldManagePending) {
                            set((state) => {
                                const remaining = { ...state.smartSummaryPendingIds };
                                delete remaining[smartCol.id];
                                return { smartSummaryPendingIds: remaining };
                            });
                        }

                        if (smartCountRunsByCollection.get(smartCol.id)?.runId === runId) {
                            smartCountRunsByCollection.delete(smartCol.id);
                        }

                        await delay(SMART_COUNT_YIELD_MS);
                    }
                    if (wasSuperseded) {
                        if (isAuthoritative) {
                            if (refreshGeneration !== initializationGeneration) {
                                throw new Error(COLLECTION_SUMMARIES_SUPERSEDED_ERROR);
                            }
                            await get().refreshSmartCounts({ ...options, delayMs: undefined });
                            return;
                        }
                        if (isAuthoritative) {
                            throw new Error('Smart collection summary refresh was superseded before it completed.');
                        }
                    }
                } catch (e) {
                    if (runId > 0) {
                        const ownedIds = smartCols
                            .filter(collection => smartCountRunsByCollection.get(collection.id)?.runId === runId)
                            .map(collection => collection.id);
                        if (ownedIds.length > 0) {
                            set((state) => {
                                const remaining = { ...state.smartSummaryPendingIds };
                                ownedIds.forEach(id => delete remaining[id]);
                                return { smartSummaryPendingIds: remaining };
                            });
                            ownedIds.forEach(id => smartCountRunsByCollection.delete(id));
                        }
                    }
                    console.error('[CollectionStore] Failed to refresh smart counts', e);
                    if (isAuthoritative) throw e;
                }
            },

            setCollections: (cols) => {
                set((state) => {
                    const nextCollections = typeof cols === 'function'
                        ? cols(state.collections)
                        : cols;

                    if (nextCollections !== state.collections) {
                        invalidateCollectionRefreshes();
                    }

                    return { collections: nextCollections };
                });
            },

            prepareInitialization: async () => {
                if (preparationPromise) return preparationPromise;

                preparationPromise = prepareCollectionStorage();
                try {
                    await preparationPromise;
                } catch (error) {
                    if (preparationPromise) preparationPromise = null;
                    throw error;
                }
            },

            invalidateInitialization: () => {
                invalidateCollectionRefreshes();
                thumbnailRefreshRunId += 1;
                smartCountRunId += 1;
                smartCountRunsByCollection.clear();
                initializationGeneration += 1;
                set({
                    initializationError: false,
                    thumbnailHydrationPendingIds: {},
                    smartSummaryPendingIds: {},
                });
                return initializationGeneration;
            },

            getInitializationGeneration: () => initializationGeneration,

            finishInitializationHydration: (generation, authoritativeSummaries = false) => {
                if (
                    generation !== initializationGeneration ||
                    !get().isLoaded ||
                    initialHydrationCompleted
                ) return;

                if (authoritativeSummaries) {
                    pendingInitialHydrationGeneration = null;
                    initialHydrationCompleted = true;
                    return;
                }
                if (pendingInitialHydrationGeneration === generation) return;

                pendingInitialHydrationGeneration = generation;
                const thumbnailHydration = Promise.resolve(get().refreshCollectionThumbnails());
                const smartHydration = Promise.resolve(get().refreshSmartCounts({
                    includeArchived: false,
                    delayMs: STARTUP_SMART_COUNT_DELAY_MS,
                    includeThumbnails: false
                })).then(() => {
                    if (
                        generation !== initializationGeneration
                        || pendingInitialHydrationGeneration !== generation
                    ) return;
                    return get().refreshSmartCounts({
                        includeArchived: false,
                        delayMs: 500,
                        markPending: true
                    });
                });

                void Promise.all([thumbnailHydration, smartHydration])
                    .then(() => {
                        if (
                            generation === initializationGeneration
                            && pendingInitialHydrationGeneration === generation
                        ) {
                            pendingInitialHydrationGeneration = null;
                            initialHydrationCompleted = true;
                        }
                    })
                    .catch((error) => {
                        if (pendingInitialHydrationGeneration === generation) {
                            pendingInitialHydrationGeneration = null;
                        }
                        console.error('[CollectionStore] Failed to finish initial hydration', error);
                    });
            },

            initialize: async (options = {}) => {
                const generation = options.generation ?? initializationGeneration;
                if (generation !== initializationGeneration) return false;
                if (get().isLoaded) {
                    if (!options.deferHydration) get().finishInitializationHydration(generation);
                    return true;
                }
                if (initPromise && initPromiseGeneration === generation) return initPromise;

                const initialization = (async (): Promise<boolean> => {
                    const startedAt = performance.now();
                    const finishDiagnostics = startupDiagnostics.start('collections');
                    try {
                        await get().prepareInitialization();
                        if (generation !== initializationGeneration) {
                            finishDiagnostics('cancelled');
                            return false;
                        }

                        const loadStartedAt = performance.now();
                        await get().refreshCollections(false, {
                            includeThumbnails: false,
                            scheduleSmartRefresh: false,
                            consistency: 'authoritative',
                        });
                        console.info(`[Startup] collection load completed in ${Math.round(performance.now() - loadStartedAt)}ms`);
                        if (generation !== initializationGeneration) {
                            finishDiagnostics('cancelled');
                            return false;
                        }

                        set({ isLoaded: true, initializationError: false });
                        finishDiagnostics();
                        console.info(`[Startup] Collection initialization completed in ${Math.round(performance.now() - startedAt)}ms`);
                        if (!options.deferHydration) get().finishInitializationHydration(generation);
                        return true;
                    } catch (error) {
                        if (generation !== initializationGeneration) {
                            finishDiagnostics('cancelled');
                            return false;
                        }

                        finishDiagnostics('failed');
                        console.error('[CollectionStore] Failed to initialize', error);
                        set({ initializationError: true });
                        throw error;
                    }
                })();
                initPromise = initialization;
                initPromiseGeneration = generation;
                try {
                    return await initialization;
                } finally {
                    if (initPromise === initialization) {
                        initPromise = null;
                        initPromiseGeneration = null;
                    }
                }
            }
        }),
        { name: 'CollectionStore' }
    )
);
