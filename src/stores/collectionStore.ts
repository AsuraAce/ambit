import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Collection, SmartCollection } from '../types';
import { appRepository } from '../services/repository';
import { shouldAutoRefreshSmartCollectionSummary } from '../utils/smartCollectionRefresh';
import {
    addImagesToCollection,
    deleteCollectionFromDb,
    ensureCollectionSchema,
    getAllCollectionsWithStats,
    getCollectionImageIds,
    getCollectionThumbnailSummaries,
    getSmartCollectionSummaries,
    upsertCollection,
} from '../services/db/collectionRepo';
import { useLibraryStore } from './libraryStore';

let initPromise: Promise<void> | null = null;
let collectionRefreshRunId = 0;
let smartCountRunId = 0;
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

const shouldShowThumbnailHydrationPending = (collection: Collection, force = false): boolean => {
    if (collection.filters) return false;
    if (collection.customThumbnail) return true;

    const imageCount = collection.count ?? collection.imageIds.length;
    if (force) return imageCount > 0;
    if (collection.thumbnail) return false;

    return imageCount > 0;
};

const shouldHydrateCollectionThumbnail = (collection: Collection, force = false): boolean => (
    shouldShowThumbnailHydrationPending(collection, force)
);

const sortForThumbnailHydration = (collections: Collection[]): Collection[] => (
    [...collections].sort((a, b) => {
        if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
    })
);

const buildPendingThumbnailMap = (collections: Collection[], force = false): Record<string, true> => (
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
}

type RefreshSmartCountsInput = RefreshSmartCountsOptions | Collection[];

interface CollectionState {
    collections: Collection[];
    isLoaded: boolean;
    thumbnailHydrationPendingIds: Record<string, true>;
    smartSummaryPendingIds: Record<string, true>;

    // Actions
    initialize: () => Promise<void>;
    refreshCollections: (debounced?: boolean) => Promise<void>;
    refreshCollectionThumbnails: (debounced?: boolean, force?: boolean) => Promise<void>;
    refreshSmartCounts: (input?: RefreshSmartCountsInput) => Promise<void>;
    setCollections: (collections: Collection[] | ((prev: Collection[]) => Collection[])) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let thumbnailDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useCollectionStore = create<CollectionState>()(
    devtools(
        (set, get) => ({
            collections: [],
            isLoaded: false,
            thumbnailHydrationPendingIds: {},
            smartSummaryPendingIds: {},

            refreshCollections: async (debounced = false) => {
                const runId = invalidateCollectionRefreshes();
                const run = async (currentRunId: number) => {
                    try {
                        const cols = await getAllCollectionsWithStats();
                        if (currentRunId !== collectionRefreshRunId) return;

                        set({ collections: cols });

                        // Lazily fetch visible smart counts in the background.
                        void get().refreshSmartCounts({ includeArchived: false, delayMs: 500, markPending: true });
                    } catch (e) {
                        console.error('[CollectionStore] Failed to refresh collections', e);
                    }
                };

                if (debounced) {
                    if (debounceTimer) clearTimeout(debounceTimer);
                    return new Promise((resolve) => {
                        debounceTimer = setTimeout(async () => {
                            await run(runId);
                            debounceTimer = null;
                            resolve();
                        }, 300);
                    });
                } else {
                    await run(runId);
                }
            },

            refreshCollectionThumbnails: async (debounced = false, force = false) => {
                const run = async () => {
                    const runId = ++thumbnailRefreshRunId;
                    try {
                        const currentCollections = sortForThumbnailHydration(
                            get().collections.filter(collection => shouldHydrateCollectionThumbnail(collection, force))
                        );
                        set({ thumbnailHydrationPendingIds: buildPendingThumbnailMap(currentCollections, force) });

                        if (currentCollections.length === 0) return;

                        for (const collectionBatch of chunk(currentCollections, COLLECTION_THUMBNAIL_CHUNK_SIZE)) {
                            if (runId !== thumbnailRefreshRunId) return;

                            const summaries = await getCollectionThumbnailSummaries(collectionBatch);
                            if (runId !== thumbnailRefreshRunId) return;

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
                    } catch (e) {
                        if (runId === thumbnailRefreshRunId) {
                            set({ thumbnailHydrationPendingIds: {} });
                        }
                        console.error('[CollectionStore] Failed to refresh collection thumbnails', e);
                    }
                };

                if (debounced) {
                    if (thumbnailDebounceTimer) clearTimeout(thumbnailDebounceTimer);
                    thumbnailRefreshRunId += 1;
                    return new Promise((resolve) => {
                        thumbnailDebounceTimer = setTimeout(async () => {
                            await run();
                            thumbnailDebounceTimer = null;
                            resolve();
                        }, 300);
                    });
                }

                await run();
            },

            refreshSmartCounts: async (input = {}) => {
                const runId = ++smartCountRunId;
                const collectionsSnapshot = Array.isArray(input) ? input : undefined;
                const options: RefreshSmartCountsOptions = Array.isArray(input)
                    ? { includePromptSearch: true }
                    : input;
                const includeThumbnails = options.includeThumbnails !== false;
                const shouldManagePending = includeThumbnails && options.markPending;

                if (!shouldManagePending) {
                    set({ smartSummaryPendingIds: {} });
                }

                try {
                    if (useLibraryStore.getState().isImporting) {
                        console.log('[CollectionStore] Skipping smart counts refresh - Import already in progress');
                        if (shouldManagePending && runId === smartCountRunId) {
                            set({ smartSummaryPendingIds: {} });
                        }
                        return;
                    }

                    if (options.delayMs && options.delayMs > 0) {
                        await delay(options.delayMs);
                        if (runId !== smartCountRunId) return;
                    }

                    const currentCols = collectionsSnapshot ?? get().collections;
                    const allowedIds = options.collectionIds ? new Set(options.collectionIds) : null;
                    const smartCols = currentCols.filter(c =>
                        !!c.filters
                        && (!!collectionsSnapshot || options.includeArchived || !c.isArchived)
                        && (!allowedIds || allowedIds.has(c.id))
                        && (options.includePromptSearch || shouldAutoRefreshSmartCollectionSummary(c))
                    );

                    if (smartCols.length === 0) {
                        if (shouldManagePending) {
                            set({ smartSummaryPendingIds: {} });
                        }
                        return;
                    }

                    if (shouldManagePending) {
                        set({
                            smartSummaryPendingIds: Object.fromEntries(
                                smartCols
                                    .filter(collection => !collection.thumbnail && !collection.customThumbnail)
                                    .map(collection => [collection.id, true] as const)
                            )
                        });
                    }

                    for (const smartCol of smartCols) {
                        if (runId !== smartCountRunId) return;

                        const summaries = await getSmartCollectionSummaries([smartCol], { includeThumbnails });
                        if (runId !== smartCountRunId) return;
                        const summary = summaries[smartCol.id];

                        if (summary) {
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

                        await delay(SMART_COUNT_YIELD_MS);
                    }
                } catch (e) {
                    if (runId === smartCountRunId) {
                        set({ smartSummaryPendingIds: {} });
                    }
                    console.error('[CollectionStore] Failed to refresh smart counts', e);
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

                        // 2. Only migrate if DB is EMPTY - if it has any collections (invoke or ambit), skip migration
                        const shouldMigrate = dbCols.length === 0;
                        console.log(`[CollectionStore] Initial load: ${dbCols.length} total, shouldMigrate: ${shouldMigrate}`);

                        if (shouldMigrate) {
                            try {
                                // Check if library.json has any collections to migrate
                                const state = await appRepository.load();
                                const legacyCols = state.collections || [];
                                const legacySmart = state.smartCollections || [];
                                const hasLegacyData = legacyCols.length > 0 || legacySmart.length > 0;

                                if (hasLegacyData) {
                                    console.log(`[CollectionStore] Starting migration from JSON (${legacyCols.length} regular, ${legacySmart.length} smart)...`);

                                    // Migrate regular collections
                                    for (const col of legacyCols) {
                                        await upsertCollection({ ...col, source: 'ambit' });
                                        if (col.imageIds && col.imageIds.length > 0) {
                                            await addImagesToCollection(col.id, col.imageIds);
                                        }
                                    }

                                    // Migrate smart collections
                                    for (const scol of legacySmart) {
                                        await upsertCollection({ ...scol, source: 'ambit' });
                                    }

                                    // Flag for reload after all migrations are pushed
                                    needsReload = true;
                                    console.log(`[CollectionStore] Migration commands dispatched.`);
                                } else {
                                    console.log('[CollectionStore] No legacy data to migrate.');
                                }
                            } catch (migrationErr) {
                                console.error('[CollectionStore] Migration failed', migrationErr);
                            }
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
