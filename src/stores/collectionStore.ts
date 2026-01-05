import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Collection, SmartCollection } from '../types';
import { appRepository } from '../services/repository';


interface CollectionState {
    collections: Collection[];
    isLoaded: boolean;

    // Actions
    initialize: () => Promise<void>;
    refreshCollections: () => Promise<void>;
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
                } catch (e) {
                    console.error('[CollectionStore] Failed to refresh collections', e);
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

                try {
                    const { getAllCollectionsWithStats, upsertCollection, addImagesToCollection } = await import('../services/db/collectionRepo');

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

                    set({ collections: dbCols, isLoaded: true });
                } catch (e) {
                    console.error('[CollectionStore] Failed to initialize', e);
                    set({ isLoaded: true });
                }
            }
        }),
        { name: 'CollectionStore' }
    )
);
