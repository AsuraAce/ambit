import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Collection, SmartCollection } from '../types';
import { appRepository } from '../services/repository';

let initPromise: Promise<void> | null = null;

interface CollectionState {
    collections: Collection[];
    isLoaded: boolean;

    // Actions
    initialize: () => Promise<void>;
    refreshCollections: () => Promise<void>;
    refreshSmartCounts: () => Promise<void>;
    setCollections: (collections: Collection[] | ((prev: Collection[]) => Collection[])) => void;

    // Legacy support needed? 
    // Usually we just expose collections and let UI derive smart/regular
}

export const useCollectionStore = create<CollectionState>()(
    devtools(
        (set, get) => ({
            collections: [],
            isLoaded: false,

            refreshCollections: async () => {
                try {
                    const { getAllCollectionsWithStats } = await import('../services/db/collectionRepo');
                    const cols = await getAllCollectionsWithStats();
                    set({ collections: cols });

                    // Lazily fetch smart counts in the background
                    get().refreshSmartCounts();
                } catch (e) {
                    console.error('[CollectionStore] Failed to refresh collections', e);
                }
            },

            refreshSmartCounts: async () => {
                try {
                    const { getSmartCollectionCounts } = await import('../services/db/collectionRepo');
                    const currentCols = get().collections;
                    const smartCols = currentCols.filter(c => !!c.filters);

                    if (smartCols.length === 0) return;

                    const counts = await getSmartCollectionCounts(smartCols);

                    // Update only the smart collection counts without replacing entire array reference
                    set({
                        collections: currentCols.map(c =>
                            c.filters && counts[c.id] !== undefined
                                ? { ...c, count: counts[c.id] }
                                : c
                        )
                    });
                } catch (e) {
                    console.error('[CollectionStore] Failed to refresh smart counts', e);
                }
            },

            setCollections: (cols) => {
                if (typeof cols === 'function') {
                    set((state) => ({ collections: cols(state.collections) }));
                } else {
                    set({ collections: cols });
                }
            },

            initialize: async () => {
                if (get().isLoaded) return;
                if (initPromise) return initPromise;

                initPromise = (async () => {
                    try {
                        const { getAllCollectionsWithStats, upsertCollection, addImagesToCollection, ensureCollectionSchema } = await import('../services/db/collectionRepo');

                        // 0. Ensure schema is up to date (add updated_at if missing)
                        await ensureCollectionSchema();

                        // 1. Try to load from SQLite
                        let dbCols = await getAllCollectionsWithStats();

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

                                    // Reload from DB
                                    dbCols = await getAllCollectionsWithStats();
                                    console.log(`[CollectionStore] Migrated ${dbCols.length} collections.`);
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
                        const { deleteCollectionFromDb, getCollectionImageIds } = await import('../services/db/collectionRepo');

                        // Reload from DB first
                        dbCols = await getAllCollectionsWithStats();

                        for (const col of dbCols) {
                            if (legacyIds.includes(col.id)) {
                                // Check if it really is empty
                                const imageIds = await getCollectionImageIds(col.id);
                                if (imageIds.length === 0) {
                                    console.log(`[CollectionStore] Removing legacy empty collection: ${col.name} (${col.id})`);
                                    await deleteCollectionFromDb(col.id);
                                }
                            }
                        }

                        // Final reload
                        dbCols = await getAllCollectionsWithStats();

                        set({ collections: dbCols, isLoaded: true });

                        // Lazily fetch smart collection counts after initial render
                        get().refreshSmartCounts();
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
