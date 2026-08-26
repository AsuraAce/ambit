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
    getCollectionImageIds,
    getCollectionThumbnailSummaries,
    getSmartCollectionSummaries,
    migrateLegacyCollections,
} from '../services/db/collectionRepo';
import { useLibraryStore } from './libraryStore';

let initPromise: Promise<void> | null = null;
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

type RefreshSmartCountsInput = RefreshSmartCountsOptions | Collection[];

interface CollectionState {
    collections: Collection[];
    isLoaded: boolean;
    thumbnailHydrationPendingIds: Record<string, true>;
    smartSummaryPendingIds: Record<string, true>;

    // Actions
    initialize: () => Promise<void>;
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
            thumbnailHydrationPendingIds: {},
            smartSummaryPendingIds: {},

            refreshCollections: async (debounced = false, options = {}) => {
                const isAuthoritative = options.consistency === 'authoritative';
                const run = async (initialRunId: number) => {
                    let currentRunId = initialRunId;
                    try {
                        while (true) {
                            const cols = await getAllCollectionsWithStats({
                                includeThumbnails: options.includeThumbnails,
                            });
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
                const run = async () => {
                    const runId = ++thumbnailRefreshRunId;
                    let wasSuperseded = false;
                    try {
                        const currentCollections = sortForThumbnailHydration(
                            get().collections.filter(collection => shouldHydrateCollectionThumbnail(collection, force))
                        );
                        set({ thumbnailHydrationPendingIds: buildPendingThumbnailMap(currentCollections, force) });

                        if (currentCollections.length === 0) return;

                        for (const collectionBatch of chunk(currentCollections, COLLECTION_THUMBNAIL_CHUNK_SIZE)) {
                            if (runId !== thumbnailRefreshRunId) {
                                wasSuperseded = true;
                                break;
                            }

                            const summaries = await getCollectionThumbnailSummaries(collectionBatch);
                            if (runId !== thumbnailRefreshRunId) {
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
                const includeThumbnails = options.includeThumbnails !== false;
                const shouldManagePending = includeThumbnails && options.markPending;
                let runId = 0;
                let smartCols: Collection[] = [];

                try {
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

                    let wasSuperseded = false;
                    for (const smartCol of smartCols) {
                        if (smartCountRunsByCollection.get(smartCol.id)?.runId !== runId) {
                            wasSuperseded = true;
                            continue;
                        }

                        const summaries = await getSmartCollectionSummaries([smartCol], { includeThumbnails });
                        if (smartCountRunsByCollection.get(smartCol.id)?.runId !== runId) {
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
                            if (smartCountRunsByCollection.get(smartCol.id)?.runId !== runId) {
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

            initialize: async () => {
                if (get().isLoaded) return;
                if (initPromise) return initPromise;

                initPromise = (async () => {
                    const startedAt = performance.now();
                    try {
                        // 0. Ensure schema is up to date (add updated_at if missing)
                        const schemaStartedAt = performance.now();
                        await ensureCollectionSchema();
                        console.info(`[Startup] Collection schema check completed in ${Math.round(performance.now() - schemaStartedAt)}ms`);

                        // 1. Try to load from SQLite
                        const loadStartedAt = performance.now();
                        let dbCols = await getAllCollectionsWithStats({ includeThumbnails: false });
                        console.info(`[Startup] collection load completed in ${Math.round(performance.now() - loadStartedAt)}ms`);
                        let needsReload = false;

                        // 2. Import the legacy JSON collection store exactly once. This marker is
                        // persisted with the JSON source so deleting all SQLite collections later
                        // cannot accidentally replay stale data.
                        try {
                            const legacyState = await appRepository.load();
                            const shouldMigrate = (legacyState.collectionStorageVersion ?? 0) < 1;
                            console.log(`[CollectionStore] Initial load: ${dbCols.length} visible, shouldMigrate: ${shouldMigrate}`);

                            if (shouldMigrate) {
                                const legacyCols = legacyState.collections || [];
                                const legacySmart = legacyState.smartCollections || [];
                                const hasLegacyData = legacyCols.length > 0 || legacySmart.length > 0;

                                if (hasLegacyData) {
                                    console.log(`[CollectionStore] Starting migration from JSON (${legacyCols.length} regular, ${legacySmart.length} smart)...`);
                                    await migrateLegacyCollections([...legacyCols, ...legacySmart]);
                                    needsReload = true;
                                }

                                await appRepository.update(current => ({
                                    ...current,
                                    collections: [],
                                    smartCollections: [],
                                    collectionStorageVersion: 1,
                                }));
                                console.log('[CollectionStore] Legacy collection migration completed.');
                            }
                        } catch (migrationErr) {
                            // Keep both the legacy arrays and version unchanged so startup can
                            // safely retry. Generic upserts preserve any existing scope identity.
                            console.error('[CollectionStore] Migration failed', migrationErr);
                        }

                        // 3. Cleanup Legacy Mock Collections (for existing users who might have them)
                        // If they are empty/unmodified, remove them.
                        const legacyIds = ['c1', 'c2', 'c3'];

                        for (const col of dbCols) {
                            if (legacyIds.includes(col.id)) {
                                // Check if it really is empty
                                const imageIds = await getCollectionImageIds(col.id);
                                if (imageIds.length === 0) {
                                    console.log(`[CollectionStore] Removing legacy empty collection: ${col.name} (${col.id})`);
                                    await deleteCollectionFromDb(col.id);
                                    needsReload = true;
                                }
                            }
                        }

                        // Final reload ONLY if the DB was mutated during init
                        if (needsReload) {
                            dbCols = await getAllCollectionsWithStats({ includeThumbnails: false });
                        }

                        set({ collections: dbCols, isLoaded: true });
                        console.info(`[Startup] Collection initialization completed in ${Math.round(performance.now() - startedAt)}ms`);

                        void get().refreshCollectionThumbnails();

                        // Defer smart summaries so startup remains responsive: counts first,
                        // then thumbnails for non-prompt smart collections after the list is visible.
                        void get().refreshSmartCounts({
                            includeArchived: false,
                            delayMs: STARTUP_SMART_COUNT_DELAY_MS,
                            includeThumbnails: false
                        }).then(() => get().refreshSmartCounts({
                            includeArchived: false,
                            delayMs: 500,
                            markPending: true
                        }));
                    } catch (e) {
                        console.error('[CollectionStore] Failed to initialize', e);
                        set({ isLoaded: true });
                    }
                })();
                return initPromise;
            }
        }),
        { name: 'CollectionStore' }
    )
);
